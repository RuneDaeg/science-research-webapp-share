import type { GradeCriterion } from "@/lib/types/db";

// 평가요소별 점수·기준·근거·판단 목록. 과제별 채점 카드와 수행평가 종합 채점 카드가 함께 쓴다.
// 교사 화면 전용 — 점수가 들어 있다.
export function GradeCriteriaList({
  criteria,
  ungradable,
}: {
  criteria: GradeCriterion[];
  ungradable: Array<{ name: string; reason: string }>;
}) {
  return (
    <ul className="space-y-3">
      {criteria.map((c, i) => (
        <li
          key={`${c.name}-${i}`}
          className="space-y-1 border-t border-gray-100 pt-3 first:border-0 first:pt-0"
        >
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-gray-900">{c.name}</span>
            <span className="text-xs font-semibold text-gray-700">
              {c.score === null ? "판단 보류" : `${c.score} / ${c.max}점`}
            </span>
          </p>
          {c.level && <p className="text-xs text-gray-600">기준: {c.level}</p>}
          <p className="text-xs text-gray-700">
            <span className="font-medium">근거 </span>
            {c.evidence}
          </p>
          {c.reason && (
            <p className="text-xs text-gray-700">
              <span className="font-medium">판단 </span>
              {c.reason}
            </p>
          )}
        </li>
      ))}
      {ungradable.map((u, i) => (
        <li key={`u-${i}`} className="space-y-1 border-t border-gray-100 pt-3">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-gray-500">{u.name}</span>
            <span className="text-xs text-gray-500">채점 제외</span>
          </p>
          <p className="text-xs text-gray-600">{u.reason}</p>
        </li>
      ))}
    </ul>
  );
}
