import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { getServerCredential, MissingCredentialError } from "@/lib/ai/serverCredential";
import { answerHelpQuestion, HelpBotError, type ChatTurn } from "@/lib/ai/helpBot";
import { assertWithinChatLimit, classifyAiError, logAiUsage } from "@/lib/ai/usage";
import { RateLimitError } from "@/lib/ai/usage";
import { AiError } from "@/lib/ai/types";

export const runtime = "nodejs";
// 사고 단계를 끈 짧은 답변이라 보통 수 초면 끝난다. 넉넉하게만 잡아둔다.
export const maxDuration = 60;

function isTurn(v: unknown): v is ChatTurn {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
}

// 사용법 안내 챗봇. 로그인한 사용자(학생·교사·관리자)면 누구나 쓸 수 있다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const question = body?.question;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "질문을 입력해주세요." }, { status: 400 });
  }

  // 이력은 클라이언트가 보낸 것을 그대로 믿지 않고 형태만 맞는 항목으로 거른다.
  // 어차피 프롬프트에는 사용법 안내만 근거로 답하라고 못박혀 있다.
  const history: ChatTurn[] = Array.isArray(body?.history) ? body.history.filter(isTurn) : [];

  let cred;
  try {
    cred = getServerCredential();
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    await assertWithinChatLimit(session.userId);
  } catch (err) {
    if (err instanceof RateLimitError) {
      // 상한 초과도 기록해 관리자가 상한값을 조정할 근거로 삼는다.
      await logAiUsage({
        studentId: session.userId,
        classId: null,
        documentId: null,
        kind: "chat",
        cred,
        ok: false,
        errorKind: classifyAiError(err),
      });
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const startedAt = Date.now();
  try {
    const { answer, model } = await answerHelpQuestion(cred, question, history);

    await logAiUsage({
      studentId: session.userId,
      classId: null,
      documentId: null,
      kind: "chat",
      // 폴백됐다면 실제로 답한 모델로 남긴다. 폴백이 얼마나 일어나는지 여기서 보인다.
      cred: { ...cred, model },
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ answer });
  } catch (err) {
    await logAiUsage({
      studentId: session.userId,
      classId: null,
      documentId: null,
      kind: "chat",
      cred,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorKind: classifyAiError(err),
    });

    if (err instanceof HelpBotError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("help chat error:", err);
    return NextResponse.json({ error: "답변 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
