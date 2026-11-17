import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { gradeStudentOverall, GradingNotReadyError } from "@/lib/ai/gradingService";
import { MissingCredentialError } from "@/lib/ai/serverCredential";
import { isCapacityError } from "@/lib/ai/index";
import { AiError, AiRefusalError } from "@/lib/ai/types";

export const runtime = "nodejs";
// 평가 계획서와 학생 파일 전체를 한꺼번에 읽는다. 과제별 채점과 같이 넉넉히 잡는다.
export const maxDuration = 300;

// 학생 한 명의 파일 전체를 클래스의 평가 계획서로 채점한다. 교사만 실행할 수 있다.
//
// 반 전체 채점도 이 라우트를 학생 수만큼 차례로 부른다. 한 요청에서 반 전체를 채점하면 몇 분이
// 걸려 함수 제한을 넘기고, 중간에 끊기면 어디까지 됐는지 알 수 없다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 AI 채점을 실행할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const classId = body?.classId;
  const studentId = body?.studentId;
  const force = body?.force === true;
  if (typeof classId !== "string" || typeof studentId !== "string") {
    return NextResponse.json({ error: "classId와 studentId가 필요합니다." }, { status: 400 });
  }

  // RLS: 담당 클래스의 등록 정보만 조회된다 — 조회되면 곧 이 학생을 채점할 권한이 있는 것
  const supabase = await createClient();
  const { data: enrollment } = await supabase
    .from("class_enrollments")
    .select("id")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!enrollment) {
    return NextResponse.json(
      { error: "학생을 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  try {
    const result = await gradeStudentOverall(classId, studentId, { force });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof GradingNotReadyError || err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AiRefusalError) {
      return NextResponse.json(
        { error: "AI가 이 학생 파일의 채점을 거절했습니다. 직접 채점해 주세요." },
        { status: 502 },
      );
    }
    // 폴백 모델까지 한도에 걸린 경우. 제공사 원문 오류 대신 할 일을 알려준다.
    if (isCapacityError(err)) {
      return NextResponse.json(
        { error: "AI 사용량이 몰려 있습니다. 잠시 뒤 다시 채점해 주세요." },
        { status: 503 },
      );
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("grade-overall route error:", err);
    return NextResponse.json({ error: "AI 채점 중 오류가 발생했습니다." }, { status: 500 });
  }
}
