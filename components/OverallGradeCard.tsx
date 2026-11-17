import { RegradeButton } from "@/components/GradeButtons";
import { GradeCriteriaList } from "@/components/GradeCriteriaList";
import { formatKstDateTime } from "@/lib/datetime";
import type { StudentOverallGrade } from "@/lib/types/db";

// 수행평가 종합 채점 결과. 교사 화면 전용 — 점수가 들어 있고, 학생에게 내보내는 경로가 없다.
export function OverallGradeCard({
  grade,
  stale,
}: {
  grade: StudentOverallGrade;
  // 채점 뒤에 학생 파일이나 평가 계획서가 바뀌었는지
  stale: boolean;
}) {
  const { result } = grade;
  const fileLabel = new Map(result.files.map((f) => [f.no, f.label]));

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-indigo-950">AI 채점 초안</span>
          {stale && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
              채점 뒤 파일이 바뀜 — 다시 채점 필요
            </span>
          )}
        </div>
        <RegradeButton
          endpoint="/api/classes/grade-overall"
          request={{ classId: grade.class_id, studentId: grade.student_id }}
          label="다시 채점"
        />
      </div>

      {result.evaluations.map((e, i) => {
        const pending = e.criteria.filter((c) => c.score === null).length;
        return (
          <div key={`${e.name}-${i}`} className="space-y-2 rounded-md bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{e.name}</span>
              {e.total_score !== null && e.max_score !== null && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-900">
                  {e.total_score} / {e.max_score}점
                </span>
              )}
              {pending > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  판단 보류 {pending}개
                </span>
              )}
            </div>
            {e.summary && <p className="text-xs text-gray-700">{e.summary}</p>}
            <p className="text-xs text-gray-600">
              <span className="font-medium">근거 파일 </span>
              {e.files_used.length > 0
                ? e.files_used.map((no) => fileLabel.get(no) ?? `파일 ${no}`).join(" / ")
                : "관련 제출물 없음"}
            </p>
            {e.ungradable.length > 0 && (
              <p className="text-xs text-indigo-900">
                <span className="font-medium">채점 제외(파일로 볼 수 없음): </span>
                {e.ungradable.map((u) => u.name).join(", ")} — 합계와 만점에서 빠져 있습니다.
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-xs font-medium text-gray-800">
                평가요소별 점수와 근거 보기
              </summary>
              <div className="mt-3">
                <GradeCriteriaList criteria={e.criteria} ungradable={e.ungradable} />
              </div>
            </details>
          </div>
        );
      })}

      {result.teacher_notes.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="mb-1 font-medium">선생님이 확인할 것</p>
          <ul className="list-disc space-y-1 pl-4">
            {result.teacher_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">AI에게 보낸 파일 {result.files.length}개</summary>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5">
          {result.files.map((f) => (
            <li key={f.no}>{f.label}</li>
          ))}
        </ol>
      </details>

      <p className="text-[11px] text-gray-500">
        {formatKstDateTime(grade.updated_at)} · {grade.model} · AI 점수는 참고용 초안입니다. 최종
        점수는 선생님이 정해 주세요.
      </p>
    </div>
  );
}
