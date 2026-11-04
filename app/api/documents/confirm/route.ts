import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractText, ExtractionError } from "@/lib/extraction";
import { validateFileMeta, FileValidationError } from "@/lib/validation/fileValidation";
import { isDocumentStage } from "@/lib/research/stage";

export const runtime = "nodejs";
// AI 피드백 생성은 여기서 하지 않는다(아래 주석 참고). 남은 일은 docx/hwpx/txt 텍스트 추출뿐이라
// 오래 걸리지 않지만, 큰 첨부의 다운로드와 파싱을 감안해 여유를 둔다.
export const maxDuration = 60;

// 업로드 2단계: 브라우저가 Storage에 올린 파일을 산출물로 등록한다.
//
// 파일은 이미 Storage에 있고 이 함수는 경로만 받는다. 그래서 클라이언트가 보낸 경로를
// 그대로 믿으면 안 된다 — 남의 파일 경로를 적어 보내면 그 파일을 자기 산출물로
// 등록할 수 있게 된다. 아래에서 경로 접두사를 직접 대조하는 이유다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "student") {
    return NextResponse.json({ error: "학생만 산출물을 제출할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const path = body?.path;
  const stage = body?.stage;
  const originalFilename = body?.originalFilename;

  if (typeof projectId !== "string" || typeof path !== "string" || typeof originalFilename !== "string") {
    return NextResponse.json(
      { error: "projectId, path, originalFilename이 필요합니다." },
      { status: 400 },
    );
  }
  if (!isDocumentStage(stage)) {
    return NextResponse.json({ error: "산출물 단계를 선택해주세요." }, { status: 400 });
  }

  // 경로는 upload-url이 만든 형태여야 한다. 업로더 uid와 프로젝트가 모두 일치해야
  // 통과하므로, 남의 파일이나 다른 프로젝트의 파일을 끌어다 등록할 수 없다.
  const expectedPrefix = `${session.userId}/${projectId}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({ error: "잘못된 파일 경로입니다." }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS: 본인이 팀원인 프로젝트만 조회된다
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json(
      { error: "연구 과제를 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  // 실제로 올라왔는지, 크기가 얼마인지는 Storage에 물어본다. 클라이언트가 신고한 크기는
  // 티켓을 받을 때 쓴 값일 뿐이라 실제 업로드된 파일과 다를 수 있다.
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await supabase.storage
    .from("research-files")
    .list(dir, { search: name, limit: 1 });
  const object = listed?.find((o) => o.name === name);

  if (!object) {
    return NextResponse.json(
      { error: "업로드된 파일을 찾을 수 없습니다. 다시 시도해주세요." },
      { status: 400 },
    );
  }

  const size = object.metadata?.size ?? 0;
  const mime = object.metadata?.mimetype ?? "application/octet-stream";

  try {
    validateFileMeta(originalFilename, size);
  } catch (err) {
    if (err instanceof FileValidationError) {
      await supabase.storage.from("research-files").remove([path]);
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const roundNoRaw = body?.roundNo;
  const roundNo =
    stage === "journal" && roundNoRaw !== undefined && roundNoRaw !== null && roundNoRaw !== ""
      ? Number(roundNoRaw)
      : null;
  if (roundNo !== null && (!Number.isInteger(roundNo) || roundNo < 1)) {
    return NextResponse.json({ error: "연구 일지 회차는 1 이상의 정수여야 합니다." }, { status: 400 });
  }

  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : originalFilename;
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  // PDF는 텍스트를 뽑지 않는다. 피드백 생성 때 AI가 원본을 통째로 보므로(표·그래프·사진 포함)
  // 추출 텍스트를 쓰는 곳이 없고, 여기서 뽑으려면 방금 올린 파일을 도로 내려받아야 한다 —
  // 4.5MB를 넘기는 파일은 대부분 PDF라 그 다운로드가 이번 변경의 이득을 그대로 까먹는다.
  // docx/hwpx/txt는 AI가 네이티브로 못 읽으니 추출이 필요한데, 이 형식들은 수백 KB 수준이다.
  const isPdf = (originalFilename.toLowerCase().split(".").pop() ?? "") === "pdf";
  let extractedText: string | null = null;

  if (!isPdf) {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("research-files")
      .download(path);

    if (downloadError || !fileData) {
      await supabase.storage.from("research-files").remove([path]);
      return NextResponse.json({ error: "업로드한 파일을 읽을 수 없습니다." }, { status: 400 });
    }

    try {
      extractedText = await extractText(Buffer.from(await fileData.arrayBuffer()), originalFilename, mime);
    } catch (err) {
      if (err instanceof ExtractionError) {
        await supabase.storage.from("research-files").remove([path]);
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const { data: document, error: insertError } = await supabase
    .from("research_documents")
    .insert({
      project_id: projectId,
      uploaded_by: session.userId,
      stage,
      title,
      round_no: roundNo,
      note,
      file_path: path,
      file_mime: mime,
      file_size: size,
      original_filename: originalFilename,
      extracted_text: extractedText,
      extraction_status: "ok",
    })
    .select()
    .single();

  if (insertError || !document) {
    // DB 기록에 실패했으면 방금 올린 파일은 고아가 되므로 정리한다.
    await supabase.storage.from("research-files").remove([path]);
    return NextResponse.json({ error: "산출물 저장에 실패했습니다." }, { status: 500 });
  }

  // 첫 산출물이 올라오면 프로젝트 상태를 '진행 중'으로 올려준다(학생이 따로 바꾸지 않아도 되게).
  if (project.status === "planning") {
    await createAdminClient()
      .from("research_projects")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", projectId);
  }

  // [중요] AI 피드백은 여기서 만들지 않는다. 클라이언트가 이 응답을 받은 뒤 별도 요청
  // (POST /api/feedback/{id})으로 생성한다.
  //
  // 예전에는 한 요청 안에서 피드백까지 만들고 응답했는데, 실측 28초가 걸렸다. 마감 직전에
  // 수십 명이 몰리면 함수가 그만큼씩 붙잡히고, 플랫폼 타임아웃이 나면 JSON이 아닌 오류
  // 페이지가 돌아온다. 그러면 산출물은 이미 저장됐는데도 학생 화면에는 실패로 보이고,
  // 학생은 다시 제출한다 — 중복 제출과 중복 AI 호출로 상황이 더 나빠진다.
  //
  // 제출 확정과 피드백 생성을 나누면 제출은 1초 안에 끝나고, 피드백이 실패하더라도
  // 산출물은 남는다. 실패한 피드백은 화면의 '다시 받기' 버튼으로 복구한다.
  return NextResponse.json({ document });
}
