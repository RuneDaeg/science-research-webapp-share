import { createAdminClient } from "@/lib/supabase/admin";
import { getChatDailyLimitPerUser, getDailyLimitPerStudent } from "./serverCredential";
import { AiError, AiRefusalError, type AiCredential } from "./types";
import type { AiUsageErrorKind, AiUsageKind } from "@/lib/types/db";

export class RateLimitError extends AiError {}

// 실패를 원인별로 나눈다. 모든 실패가 '몰림'을 뜻하지는 않기 때문이다 —
// 안전 거절은 그 문서의 문제이고, 상한 초과는 정상 동작이다.
export function classifyAiError(err: unknown): AiUsageErrorKind {
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof AiRefusalError) return "refusal";
  if (err instanceof AiError) {
    return /timeout|timed out|deadline|504|econnreset|aborted/i.test(err.message)
      ? "timeout"
      : "ai_error";
  }
  return "ai_error";
}

// 서버 공용 키를 쓰므로 비용이 한 곳에 몰린다. 학생 1인당 하루 호출 횟수를 제한해
// 실수/남용으로 인한 폭주를 막는다. (교사·관리자가 돌리는 재검증은 세지 않는다.)
export async function assertWithinDailyLimit(studentId: string): Promise<void> {
  const limit = getDailyLimitPerStudent();
  if (limit <= 0) return;

  // 실패한 호출은 상한에서 빼준다. 안 그러면 제공사 장애로 실패한 날에 학생이 자기 몫을
  // 다 태우고 정작 피드백은 한 번도 못 받는 상황이 된다. 재시도는 버튼을 눌러야 하는
  // 수동 동작이라 이렇게 열어둬도 폭주 위험은 낮다.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await createAdminClient()
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("kind", "draft")
    .eq("ok", true)
    .gte("created_at", since);

  // 집계 자체가 실패하면 피드백을 막지 않는다 — 상한은 남용 방어용이지 기능 차단이 목적이 아니다.
  if (error) return;

  if ((count ?? 0) >= limit) {
    throw new RateLimitError(
      `오늘 사용할 수 있는 AI 피드백 횟수(${limit}회)를 모두 사용했습니다. 내일 다시 시도하거나 선생님께 문의해주세요.`,
    );
  }
}

// 챗봇 상한은 피드백 상한과 별개로 센다(kind='chat'). 교사도 대상이라 '학생'이 아니라
// 사용자 단위다. 피드백과 마찬가지로 실패한 호출은 차감하지 않는다.
export async function assertWithinChatLimit(userId: string): Promise<void> {
  const limit = getChatDailyLimitPerUser();
  if (limit <= 0) return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await createAdminClient()
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("student_id", userId)
    .eq("kind", "chat")
    .eq("ok", true)
    .gte("created_at", since);

  if (error) return;

  if ((count ?? 0) >= limit) {
    throw new RateLimitError(
      `오늘 사용할 수 있는 도우미 질문 횟수(${limit}회)를 모두 사용했습니다. 내일 다시 이용해주세요.`,
    );
  }
}

export async function logAiUsage(params: {
  studentId: string | null;
  classId: string | null;
  documentId: string | null;
  kind: AiUsageKind;
  cred: AiCredential;
  /** AI 제공사 호출에 걸린 시간(ms). 실패한 호출도 걸린 시간을 남긴다. */
  durationMs?: number;
  /** 기본값 true. 실패를 기록할 때만 false로 넘긴다. */
  ok?: boolean;
  errorKind?: AiUsageErrorKind | null;
}): Promise<void> {
  // 로그 기록이 실패해도 피드백 흐름을 막지 않는다 — 로그는 관측용이지 기능이 아니다.
  try {
    await createAdminClient()
      .from("ai_usage_log")
      .insert({
        student_id: params.studentId,
        class_id: params.classId,
        document_id: params.documentId,
        kind: params.kind,
        provider: params.cred.provider,
        model: params.cred.model,
        duration_ms: params.durationMs ?? null,
        ok: params.ok ?? true,
        error_kind: params.errorKind ?? null,
      });
  } catch (err) {
    console.error("logAiUsage failed:", err);
  }
}
