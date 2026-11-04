import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

// 학생 화면에 "지금 AI 응답이 원활한가"를 보여주기 위한 집계.
//
// 왜 필요한가: 제출과 피드백 생성을 분리한 뒤 제출은 몇 초 만에 끝나지만 피드백은 여전히
// 수십 초가 걸린다. 마감 직전에 몰리면 더 느려지는데, 학생 입장에서는 "고장인지 밀린 건지"
// 구분이 안 된다. 상태를 미리 알려주면 불필요한 재제출을 줄일 수 있다.

export type AiHealthLevel = "smooth" | "busy" | "congested";

export interface AiHealth {
  level: AiHealthLevel;
  medianMs: number;
  sampleCount: number;
  /** 몰림 신호로 취급하는 실패(timeout/ai_error)의 비율 0~1 */
  failureRate: number;
  failureCount: number;
}

// 집계 구간과 최소 표본. 표본이 너무 적으면 한두 건의 튀는 값이 그대로 '혼잡'이 되므로
// 아래 개수 미만이면 아예 표시하지 않는다(null 반환).
const WINDOW_MINUTES = 30;
const MIN_SAMPLES = 3;

// [주의] 이 값들은 잠정치다. gemini-2.5-flash로 실측했을 때 한산한 상태가 30~50초였다.
// 기본 모델을 gemini-3.8-flash로 바꿀 때(2026-10) 같은 테스트 계획서로 재 보니 2.5는 18.8초,
// 3.8은 13.7초였다 — 지금 임계값은 넉넉한 쪽이니 실측이 쌓이면 낮출 것.
// 실제 수업에서 데이터가 쌓이면 관리자 화면의 호출량과 대조해 조정할 것.
// 여기 한 곳만 고치면 학생 화면 문구까지 함께 바뀐다.
const BUSY_MS = 60_000;
const CONGESTED_MS = 100_000;

// 실패율 임계값. 응답 시간만 보면 사각지대가 생긴다 — 느린 호출이 타임아웃으로 끊기면
// 그 건들이 성공 집계에서 통째로 빠지고 빠른 성공 건만 남아 오히려 '원활'로 보인다.
// 실패율을 함께 보면 그 역전을 막을 수 있다.
const BUSY_FAILURE_RATE = 0.15;
const CONGESTED_FAILURE_RATE = 0.35;

// 몰림의 신호로 볼 실패만 센다. 안전 거절은 특정 문서의 문제이고, 학생 일일 상한 초과와
// 설정 오류는 애초에 장애가 아니다.
const CONGESTION_ERROR_KINDS = new Set(["timeout", "ai_error"]);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

// 평균이 아니라 중앙값을 쓴다. 유난히 긴 보고서 하나가 평균을 끌어올려 실제보다
// 나쁘게 보이는 것을 막기 위함이다.
export const getAiHealth = cache(async (): Promise<AiHealth | null> => {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  // ai_usage_log는 RLS 정책이 없어(service_role 전용) 학생 세션으로는 읽을 수 없다.
  // 서버 컴포넌트에서 admin 클라이언트로 집계해 결과 등급만 화면에 내보낸다.
  // [중요] 챗봇 호출(kind='chat')은 제외한다. 사용법 안내는 수 초면 끝나는데 피드백 생성은
  // 수십 초라, 섞어서 중앙값을 내면 챗봇 호출이 많을수록 실제보다 원활해 보인다.
  // 이 배지가 말하는 것은 '피드백이 언제 오는가'이므로 피드백 계열만 봐야 한다.
  const { data, error } = await createAdminClient()
    .from("ai_usage_log")
    .select("duration_ms, ok, error_kind")
    .in("kind", ["draft", "verify"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  // 상태 표시는 부가 기능이다. 집계가 실패하면 조용히 감춘다 — 이것 때문에 학생 화면이
  // 깨지면 안 된다.
  if (error || !data) return null;

  // 상한 초과·안전 거절·설정 오류는 몰림과 무관하므로 분모에서도 뺀다. 남겨두면 실패율이
  // 부풀려져 멀쩡한 상황이 '혼잡'으로 보인다.
  const relevant = data.filter((r) => r.ok || CONGESTION_ERROR_KINDS.has(r.error_kind ?? ""));
  if (relevant.length < MIN_SAMPLES) return null;

  const durations = relevant
    .filter((r) => r.ok)
    .map((r) => r.duration_ms)
    .filter((d): d is number => typeof d === "number");

  const failureCount = relevant.filter((r) => !r.ok).length;
  const failureRate = failureCount / relevant.length;

  // 전부 실패해 성공 표본이 없으면 응답 시간을 알 수 없다. 그 상태야말로 최악이므로
  // 중앙값 0으로 얼버무리지 말고 바로 '혼잡'으로 본다.
  if (durations.length === 0) {
    return { level: "congested", medianMs: 0, sampleCount: relevant.length, failureRate, failureCount };
  }

  const medianMs = median(durations);

  const byDuration: AiHealthLevel =
    medianMs >= CONGESTED_MS ? "congested" : medianMs >= BUSY_MS ? "busy" : "smooth";
  const byFailure: AiHealthLevel =
    failureRate >= CONGESTED_FAILURE_RATE
      ? "congested"
      : failureRate >= BUSY_FAILURE_RATE
        ? "busy"
        : "smooth";

  // 둘 중 나쁜 쪽을 택한다. 어느 한쪽만 나빠도 학생 입장에서는 피드백이 제때 안 오는 것이다.
  const RANK: Record<AiHealthLevel, number> = { smooth: 0, busy: 1, congested: 2 };
  const level = RANK[byFailure] > RANK[byDuration] ? byFailure : byDuration;

  return { level, medianMs, sampleCount: relevant.length, failureRate, failureCount };
});

export const AI_HEALTH_LABEL: Record<AiHealthLevel, string> = {
  smooth: "원활",
  busy: "주의",
  congested: "혼잡",
};

export const AI_HEALTH_NOTE: Record<AiHealthLevel, string> = {
  smooth: "AI 피드백이 평소 속도로 생성되고 있습니다.",
  busy: "지금 제출이 몰려 피드백이 평소보다 오래 걸립니다. 제출 자체는 바로 완료됩니다.",
  congested:
    "제출이 많이 몰려 피드백이 많이 지연되고 있습니다. 제출은 정상 완료되니 다시 올리지 마세요 — 피드백은 나중에 '다시 받기'로 받을 수 있습니다.",
};
