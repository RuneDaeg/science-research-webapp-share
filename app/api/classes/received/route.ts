import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { validateFileMeta, FileValidationError } from "@/lib/validation/fileValidation";
import { todayKstDate } from "@/lib/datetime";

export const runtime = "nodejs";

const MAX_NOTE_LENGTH = 200;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// 따로 받은 자료(0014) 2단계: 브라우저가 Storage에 올린 파일을 학생의 '따로 받은 자료'로 등록한다.
//
// 클라이언트가 보낸 경로를 그대로 믿으면 남의 파일을 등록할 수 있으므로 접두사를 직접 대조한다.
// 크기도 Storage가 알려주는 실제 값으로 다시 검사한다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 올릴 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const classId = body?.classId;
  const studentId = body?.studentId;
  const path = body?.path;
  const originalFilename = body?.originalFilename;
  if (
    typeof classId !== "string" ||
    typeof studentId !== "string" ||
    typeof path !== "string" ||
    typeof originalFilename !== "string"
  ) {
    return NextResponse.json(
      { error: "classId, studentId, path, originalFilename이 필요합니다." },
      { status: 400 },
    );
  }

  const expectedPrefix = `${session.userId}/classes/${classId}/received/${studentId}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({ error: "잘못된 파일 경로입니다." }, { status: 400 });
  }

  const note =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, MAX_NOTE_LENGTH)
      : null;
  const receivedOn = typeof body?.receivedOn === "string" && body.receivedOn ? body.receivedOn : todayKstDate();
  if (!isValidDate(receivedOn)) {
    return NextResponse.json({ error: "받은 날짜가 올바르지 않습니다." }, { status: 400 });
  }
  if (receivedOn > todayKstDate()) {
    return NextResponse.json({ error: "받은 날짜가 오늘보다 뒤입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: cls } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("teacher_id", session.userId)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json(
      { error: "클래스를 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }
  const { data: enrollment } = await supabase
    .from("class_enrollments")
    .select("id")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!enrollment) {
    await supabase.storage.from("research-files").remove([path]);
    return NextResponse.json({ error: "이 클래스 학생이 아닙니다." }, { status: 404 });
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

  const { error } = await supabase.from("student_received_files").insert({
    class_id: classId,
    student_id: studentId,
    uploaded_by: session.userId,
    file_path: path,
    file_mime: mime,
    file_size: size,
    original_filename: originalFilename,
    note,
    received_on: receivedOn,
  });
  if (error) {
    await supabase.storage.from("research-files").remove([path]);
    console.error("received file insert failed:", JSON.stringify(error));
    return NextResponse.json({ error: "파일 등록에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
