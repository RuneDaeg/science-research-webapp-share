import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import {
  validateFileMeta,
  sanitizeFilename,
  FileValidationError,
} from "@/lib/validation/fileValidation";

export const runtime = "nodejs";

// 과제 제출 1단계: 올릴 자리를 잡고 일회용 업로드 티켓을 내준다.
//
// 산출물 업로드와 같은 구조다 — 파일은 이 함수를 지나가지 않고 브라우저가 Storage로 직접
// 보낸다. Vercel 서버리스 함수의 요청 본문 한도(4.5MB) 때문이다. 자세한 배경은 AGENTS.md 참고.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "student") {
    return NextResponse.json({ error: "학생만 제출할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const assignmentId = body?.assignmentId;
  const filename = body?.filename;
  const size = body?.size;

  if (typeof assignmentId !== "string" || typeof filename !== "string" || typeof size !== "number") {
    return NextResponse.json(
      { error: "assignmentId, filename, size가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    validateFileMeta(filename, size);
  } catch (err) {
    if (err instanceof FileValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const supabase = await createClient();

  // RLS: 같은 클래스에 등록된 학생에게만 조회된다 — 조회되면 곧 제출 권한이 검증된 것
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

  // 경로 규칙: {student_id}/assignments/{assignment_id}/{timestamp}_{filename}
  // 최상위가 업로더 uid라 기존 스토리지 정책(research_files_owner_all)을 그대로 통과한다.
  const path = `${session.userId}/assignments/${assignmentId}/${Date.now()}_${sanitizeFilename(filename)}`;

  const { data, error } = await supabase.storage
    .from("research-files")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("assignment createSignedUploadUrl failed:", JSON.stringify(error), "path:", path);
    return NextResponse.json({ error: "업로드 준비에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
