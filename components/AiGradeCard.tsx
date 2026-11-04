import FeedbackMarkdown from "@/components/FeedbackMarkdown";
import { RegradeButton } from "@/components/GradeButtons";
import { setGradeReleasedAction } from "@/app/teacher/actions";
import { formatKstDateTime } from "@/lib/datetime";
import type { AssignmentAiGrade } from "@/lib/types/db";

// 교사 화면 전용 — 점수와 근거가 들어 있다. 학생 화면에서 쓰지 말 것(학생은
// student_assignment_feedbacks 뷰의 피드백 문장만 본다).
export function AiGradeCard({
  grade,
  stale,
  revalidate,
}: {
  grade: AssignmentAiGrade;
  // 채점 뒤에 제출 파일·채점기준·과제 안내가 바뀌었는지
  stale: boolean;
  // 공개 여부를 바꾼 뒤 다시 그릴 화면 경로
  revalidate: string;
}) {
  const { result } = grade;
  const pending = result.criteria.filter((c) => c.score === null).length;

  return (
    <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-indigo-950">AI 채점 초안</span>
          {grade.total_score !== null && grade.max_score !== null && (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-indigo-900">
              {grade.total_score} / {grade.max_score}점
            </span>
          )}
          {pending > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              판단 보류 {pending}개
            </span>
          )}
          {stale && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
              채점 뒤 제출 파일이 바뀜 — 다시 채점 필요
            </span>
          )}
          {grade.released && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              학생에게 피드백 공개됨
            </span>
          )}
        </div>
        <RegradeButton submissionId={grade.submission_id} label="다시 채점" />
      </div>

      {result.ungradable.length > 0 && (
        <p className="text-xs text-indigo-900">
          <span className="font-medium">채점 제외(제출 파일로 볼 수 없음): </span>
          {result.ungradable.map((u) => u.name).join(", ")} — 합계와 만점에서 빠져 있습니다.
        </p>
      )}

      <details className="rounded-md bg-white p-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-800">
          평가요소별 점수와 근거 보기 · {result.rubric_used}
        </summary>
        <ul className="mt-3 space-y-3">
          {result.criteria.map((c, i) => (
            <li key={`${c.name}-${i}`} className="space-y-1 border-t border-gray-100 pt-3 first:border-0 first:pt-0">
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
          {result.ungradable.map((u, i) => (
            <li key={`u-${i}`} className="space-y-1 border-t border-gray-100 pt-3">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-gray-500">{u.name}</span>
                <span className="text-xs text-gray-500">채점 제외</span>
              </p>
              <p className="text-xs text-gray-600">{u.reason}</p>
            </li>
          ))}
        </ul>
      </details>

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

      <div className="space-y-2 rounded-md bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-800">
            학생에게 줄 피드백 <span className="font-normal text-gray-500">(점수는 들어 있지 않습니다)</span>
          </p>
          <form action={setGradeReleasedAction}>
            <input type="hidden" name="submissionId" value={grade.submission_id} />
            <input type="hidden" name="released" value={grade.released ? "false" : "true"} />
            <input type="hidden" name="revalidate" value={revalidate} />
            <button
              type="submit"
              className={
                grade.released
                  ? "rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  : "rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800"
              }
            >
              {grade.released ? "공개 취소" : "학생에게 공개"}
            </button>
          </form>
        </div>
        <FeedbackMarkdown className="text-gray-800">{grade.student_feedback}</FeedbackMarkdown>
      </div>

      <p className="text-[11px] text-gray-500">
        {formatKstDateTime(grade.updated_at)} · {grade.model} · AI 점수는 참고용 초안입니다. 최종
        점수는 선생님이 정해 주세요.
      </p>
    </div>
  );
}
