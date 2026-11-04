import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { validateFileMeta, FileValidationError } from "@/lib/validation/fileValidation";

export const runtime = "nodejs";
export const maxDuration = 60;

// 과제 제출 2단계: 브라우저가 Storage에 올린 파일을 제출물에 더한다.
//
// 한 과제에 파일을 여러 개 낼 수 있다. 제출물(assignment_submissions)은 학생당 하나이고,
// 파일(assignment_submission_files)이 그 아래 여러 건 달린다. 이 라우트는 파일 하나를
// 더하며, 제출물 행이 없으면 만든다.
//
// 파일은 이미 Storage에 있고 이 함수는 경로만 받는다. 클라이언트가 보낸 경로를 그대로 믿으면
// 남의 파일 경로를 적어 자기 제출물로 등록할 수 있으므로, 아래에서 접두사를 직접 대조한다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "student") {
    return NextResponse.json({ error: "학생만 제출할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const assignmentId = body?.assignmentId;
  const path = body?.path;
  const originalFilename = body?.originalFilename;

  if (
    typeof assignmentId !== "string" ||
    typeof path !== "string" ||
    typeof originalFilename !== "string"
  ) {
    return NextResponse.json(
      { error: "assignmentId, path, originalFilename이 필요합니다." },
      { status: 400 },
    );
  }

  const expectedPrefix = `${session.userId}/assignments/${assignmentId}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({ error: "잘못된 파일 경로입니다." }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS: 같은 클래스 학생에게만 조회된다
  const { data: assignment } = await supabase
    .from("class_assignments")
    .select("id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment) {
    return NextResponse.json(
      { error: "과제를 찾을 수 없거나 접근 권한이 없습니다." },
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

  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  // 제출물 행을 확보한다. 이미 있으면 제출 시각을 갱신하고, 메모는 이번에 적어 보냈을 때만
  // 덮어쓴다 — 두 번째 파일을 올리며 메모를 비워 보냈다고 먼저 쓴 메모가 지워지면 안 된다.
  const { data: existing } = await supabase
    .from("assignment_submissions")
    .select("id, note")
    .eq("assignment_id", assignmentId)
    .eq("student_id", session.userId)
    .maybeSingle();

  const { data: submission, error: upsertError } = await supabase
    .from("assignment_submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: session.userId,
        note: note ?? existing?.note ?? null,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,student_id" },
    )
    .select("id")
    .single();

  if (upsertError || !submission) {
    await supabase.storage.from("research-files").remove([path]);
    console.error("assignment submit failed:", JSON.stringify(upsertError));
    return NextResponse.json({ error: "제출 등록에 실패했습니다." }, { status: 500 });
  }

  const { error: fileError } = await supabase.from("assignment_submission_files").insert({
    submission_id: submission.id,
    file_path: path,
    file_mime: mime,
    file_size: size,
    original_filename: originalFilename,
  });

  if (fileError) {
    // 파일 등록에 실패했으면 방금 올린 파일은 고아가 되므로 정리한다.
    // 제출물 행은 남겨둔다 — 먼저 낸 다른 파일이 거기 달려 있을 수 있다.
    await supabase.storage.from("research-files").remove([path]);
    console.error("submission file insert failed:", JSON.stringify(fileError));
    return NextResponse.json({ error: "파일 등록에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ submissionId: submission.id });
}
