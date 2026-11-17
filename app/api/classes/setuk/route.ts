import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { draftStudentSetuk } from "@/lib/ai/setukService";
import { GradingNotReadyError } from "@/lib/ai/gradingService";
import { MissingCredentialError } from "@/lib/ai/serverCredential";
import { isCapacityError } from "@/lib/ai/index";
import { AiError, AiRefusalError } from "@/lib/ai/types";

export const runtime = "nodejs";
// 학생 파일 전체를 읽으므로 종합 채점과 같이 넉넉히 잡는다.
export const maxDuration = 300;

// 세특 참고 초안을 만든다. memo를 보내면 먼저 저장하고(memoOnly면 저장만), 없으면 저장된 메모를 쓴다.
// 교사만 실행할 수 있다. 반 전체 생성도 이 라우트를 학생 수만큼 차례로 부른다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 실행할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const classId = body?.classId;
  const studentId = body?.studentId;
  const memo = typeof body?.memo === "string" ? body.memo : undefined;
  if (typeof classId !== "string" || typeof studentId !== "string") {
    return NextResponse.json({ error: "classId와 studentId가 필요합니다." }, { status: 400 });
  }

  // RLS: 담당 클래스의 등록 정보만 조회된다 — 조회되면 곧 이 학생을 다룰 권한이 있는 것
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
    const result = await draftStudentSetuk(classId, studentId, {
      memo,
      force: body?.force === true,
      memoOnly: body?.memoOnly === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof GradingNotReadyError || err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AiRefusalError) {
      return NextResponse.json(
        { error: "AI가 이 학생의 초안 작성을 거절했습니다. 직접 작성해 주세요." },
        { status: 502 },
      );
    }
    if (isCapacityError(err)) {
      return NextResponse.json(
        { error: "AI 사용량이 몰려 있습니다. 잠시 뒤 다시 시도해 주세요." },
        { status: 503 },
      );
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("setuk route error:", err);
    return NextResponse.json({ error: "세특 초안 작성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
