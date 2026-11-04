import { getAiHealth, AI_HEALTH_LABEL, AI_HEALTH_NOTE, type AiHealthLevel } from "@/lib/ai/health";

// 최근 AI 응답 속도를 원활/주의/혼잡으로 보여준다.
// 표본이 부족하거나 집계가 실패하면 아무것도 렌더링하지 않는다 — 근거 없는 상태를 띄우느니
// 안 보이는 편이 낫다.

const STYLE: Record<AiHealthLevel, { dot: string; text: string; chip: string }> = {
  smooth: { dot: "bg-emerald-500", text: "text-emerald-800", chip: "bg-emerald-50" },
  busy: { dot: "bg-amber-500", text: "text-amber-800", chip: "bg-amber-50" },
  congested: { dot: "bg-red-500", text: "text-red-800", chip: "bg-red-50" },
};

export async function AiHealthBadge() {
  const health = await getAiHealth();
  if (!health) return null;

  const style = STYLE[health.level];
  const seconds = Math.round(health.medianMs / 1000);
  const failurePercent = Math.round(health.failureRate * 100);
  const failurePart = `실패 ${health.failureCount}건(${failurePercent}%)`;
  // 성공 건이 하나도 없으면 중앙값이 존재하지 않는다. 0초라고 적지 않는다.
  const detail =
    health.medianMs === 0
      ? `최근 ${health.sampleCount}건이 모두 실패했습니다`
      : health.failureCount > 0
        ? `최근 ${health.sampleCount}건 중 중앙값 ${seconds}초, ${failurePart}`
        : `최근 ${health.sampleCount}건 기준 중앙값 ${seconds}초`;

  return (
    <span
      title={`${AI_HEALTH_NOTE[health.level]} (${detail})`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style.chip} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      AI 응답 {AI_HEALTH_LABEL[health.level]}
      {/* 최근 성공 건이 하나도 없으면 중앙값이 없다. '약 0초'로 잘못 보이지 않게 감춘다. */}
      {health.medianMs > 0 && <span className="font-normal opacity-75">약 {seconds}초</span>}
    </span>
  );
}
