import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import {
  validateFileMeta,
  sanitizeFilename,
  FileValidationError,
} from "@/lib/validation/fileValidation";

export const runtime = "nodejs";

// 평가 계획서(수행평가 종합 채점용) 1단계: 올릴 자리를 잡고 일회용 업로드 티켓을 내준다.
//
// 과제 채점기준과 같은 구조다 — 파일은 이 함수를 지나가지 않고 브라우저가 Storage로 직접 보낸다.
// 평가 계획서에 그림이 들어가면 Vercel 요청 본문 한도(4.5MB)를 쉽게 넘기 때문이다(AGENTS.md).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 올릴 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const classId = body?.classId;
  const filename = body?.filename;
  const size = body?.size;
  if (typeof classId !== "string" || typeof filename !== "string" || typeof size !== "number") {
    return NextResponse.json({ error: "classId, filename, size가 필요합니다." }, { status: 400 });
  }

  try {
    validateFileMeta(filename, size);
  } catch (err) {
    if (err instanceof FileValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // classes는 반 학생에게도 조회되므로 담당 교사인지 teacher_id로 직접 확인한다.
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

  // 경로 규칙: {teacher_id}/classes/{class_id}/rubric/{timestamp}_{filename}
  // 최상위가 업로더 uid라 기존 스토리지 정책(research_files_owner_all)을 그대로 통과한다.
  const path = `${session.userId}/classes/${classId}/rubric/${Date.now()}_${sanitizeFilename(filename)}`;

  const { data, error } = await supabase.storage
    .from("research-files")
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("class rubric createSignedUploadUrl failed:", JSON.stringify(error), "path:", path);
    return NextResponse.json({ error: "업로드 준비에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
