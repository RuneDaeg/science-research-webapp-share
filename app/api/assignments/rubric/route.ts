import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { validateFileMeta, FileValidationError } from "@/lib/validation/fileValidation";

export const runtime = "nodejs";

// 채점기준 파일 2단계: 브라우저가 Storage에 올린 파일을 과제에 붙인다. 이미 있으면 바꾼다.
//
// 클라이언트가 보낸 경로를 그대로 믿으면 남의 파일을 채점기준으로 붙일 수 있으므로
// 접두사를 직접 대조한다. 크기도 Storage가 알려주는 실제 값으로 다시 검사한다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 올릴 수 있습니다." }, { status: 403 });
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

  const expectedPrefix = `${session.userId}/assignments/${assignmentId}/rubric/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({ error: "잘못된 파일 경로입니다." }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS: 교사에게는 담당 클래스의 과제만 조회된다
  const { data: assignment } = await supabase
    .from("class_assignments")
    .select("id, rubric_path")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) {
    return NextResponse.json(
      { error: "과제를 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

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
    await supabase.storage.from("research-files").remove([path]);
    if (err instanceof FileValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { error } = await supabase
    .from("class_assignments")
    .update({
      rubric_path: path,
      rubric_mime: mime,
      rubric_size: size,
      rubric_filename: originalFilename,
    })
    .eq("id", assignmentId);
  if (error) {
    await supabase.storage.from("research-files").remove([path]);
    return NextResponse.json({ error: "채점기준 등록에 실패했습니다." }, { status: 500 });
  }

  // 이전 파일은 지운다. 교사 본인 폴더라 교사 세션으로 지울 수 있다. 실패해도 등록은 끝난
  // 것이라 오류로 돌려주지 않는다(고아 파일이 하나 남을 뿐이다).
  if (assignment.rubric_path && assignment.rubric_path !== path) {
    await supabase.storage.from("research-files").remove([assignment.rubric_path]);
  }

  return NextResponse.json({ ok: true });
}
