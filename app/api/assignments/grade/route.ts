import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { gradeSubmission, GradingNotReadyError } from "@/lib/ai/gradingService";
import { MissingCredentialError } from "@/lib/ai/serverCredential";
import { isCapacityError } from "@/lib/ai/index";
import { AiError, AiRefusalError } from "@/lib/ai/types";

export const runtime = "nodejs";
// 채점기준과 제출 파일 여러 개를 한꺼번에 읽으므로 피드백(120초)보다 넉넉히 잡는다.
export const maxDuration = 300;

// 과제 제출물 하나를 AI로 채점한다. 교사만 실행할 수 있다.
//
// '전체 채점'도 이 라우트를 학생 수만큼 차례로 부른다. 한 요청에서 반 전체를 채점하면 몇 분이
// 걸려 함수 제한을 넘기고, 중간에 끊기면 어디까지 됐는지 알 수 없다(AGENTS.md의 업로드·피드백
// 분리와 같은 이유).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 AI 채점을 실행할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const submissionId = body?.submissionId;
  const force = body?.force === true;
  if (typeof submissionId !== "string") {
    return NextResponse.json({ error: "submissionId가 필요합니다." }, { status: 400 });
  }

  // RLS: 담당 과제의 제출물만 조회된다 — 조회되면 곧 채점 권한이 있는 것
  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("assignment_submissions")
    .select("id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission) {
    return NextResponse.json(
      { error: "제출물을 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  try {
    const result = await gradeSubmission(submissionId, { force });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof GradingNotReadyError || err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AiRefusalError) {
      return NextResponse.json(
        { error: "AI가 이 제출물의 채점을 거절했습니다. 직접 채점해 주세요." },
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
    console.error("grade route error:", err);
    return NextResponse.json({ error: "AI 채점 중 오류가 발생했습니다." }, { status: 500 });
  }
}
