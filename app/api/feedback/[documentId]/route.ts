import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { ensureNudgeFeedback, reverifyNudgeFeedback } from "@/lib/ai/feedbackService";
import { MissingCredentialError } from "@/lib/ai/serverCredential";
import { RateLimitError } from "@/lib/ai/usage";
import { AiError } from "@/lib/ai/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// mode "draft"  : 업로드 직후 실패했거나 아직 없는 피드백을 (다시) 생성 — 학생/교사 모두 가능
// mode "verify" : 기존 피드백을 2단계 검증 프롬프트로 재작성 — 교사만 가능
export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { documentId } = await params;
  const body = await request.json().catch(() => null);
  const mode = body?.mode === "verify" ? "verify" : "draft";

  const supabase = await createClient();

  // RLS: 팀원이거나 담당 교사인 문서만 조회된다 — 조회되면 접근 권한이 검증된 것
  const { data: doc } = await supabase
    .from("research_documents")
    .select("id, uploaded_by")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json(
      { error: "산출물을 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  if (mode === "verify" && session.profile.role !== "teacher") {
    return NextResponse.json({ error: "2단계 검증은 교사만 실행할 수 있습니다." }, { status: 403 });
  }

  try {
    const result =
      mode === "verify"
        ? await reverifyNudgeFeedback(documentId)
        : // 일일 상한은 산출물을 올린 학생 기준으로 센다(교사가 대신 눌러도 학생 몫으로 잡히지 않게
          // 교사가 실행한 경우에는 상한 대상이 되지 않도록 uploaded_by를 그대로 사용한다).
          await ensureNudgeFeedback(documentId, doc.uploaded_by);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("feedback route error:", err);
    return NextResponse.json({ error: "AI 피드백 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
