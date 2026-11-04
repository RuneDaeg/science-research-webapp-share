import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { SignedFileLink } from "@/components/SignedFileLink";
import { AssignmentSubmitWidget } from "@/components/AssignmentSubmitWidget";
import { deleteSubmissionFileAction } from "@/app/student/actions";
import { formatKstDateTime } from "@/lib/datetime";
import FeedbackMarkdown from "@/components/FeedbackMarkdown";

export default async function StudentAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("student");
  const { id: assignmentId } = await params;
  const supabase = await createClient();

  // RLS: 등록된 클래스의 과제만 조회된다 — 조회되면 접근 권한이 검증된 것
  const { data: assignment } = await supabase
    .from("class_assignments")
    .select("id, class_id, title, body, due_at, created_at, classes(name)")
    .eq("id", assignmentId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        class_id: string;
        title: string;
        body: string | null;
        due_at: string | null;
        created_at: string;
        classes: { name: string } | null;
      },
      { merge: false }
    >();

  if (!assignment) notFound();

  // RLS: 본인 제출물만 조회된다
  const { data: submission } = await supabase
    .from("assignment_submissions")
    .select("id, note, submitted_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", session.userId)
    .maybeSingle();

  const { data: files } = submission
    ? await supabase
        .from("assignment_submission_files")
        .select("id, original_filename, uploaded_at")
        .eq("submission_id", submission.id)
        .order("uploaded_at", { ascending: true })
    : { data: [] as Array<{ id: string; original_filename: string; uploaded_at: string }> };

  const fileList = files ?? [];

  // 선생님이 공개한 AI 채점 피드백(0011). 점수·근거는 뷰에서 빠져 있어 학생에게 내려오지 않는다.
  const { data: feedback } = submission
    ? await supabase
        .from("student_assignment_feedbacks")
        .select("student_feedback, updated_at")
        .eq("submission_id", submission.id)
        .maybeSingle()
    : { data: null };
  const hasFiles = fileList.length > 0;

  const overdue = assignment.due_at ? new Date(assignment.due_at) < new Date() : false;
  // 지각 여부는 가장 먼저 낸 파일이 아니라 마지막으로 낸 시각으로 본다 — 마감 뒤에 파일을
  // 더 올렸다면 그것도 지각 제출이다.
  const late =
    submission && assignment.due_at
      ? new Date(submission.submitted_at) > new Date(assignment.due_at)
      : false;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/student/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          ← 내 연구
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{assignment.title}</h1>
        <p className="text-sm text-gray-500">
          {assignment.classes?.name ?? "클래스"}
          {assignment.due_at && (
            <>
              {" · 마감 "}
              {formatKstDateTime(assignment.due_at)}
              {overdue && <span className="ml-1 text-amber-700">(지남)</span>}
            </>
          )}
        </p>
        {assignment.body && (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm whitespace-pre-wrap text-gray-700">
            {assignment.body}
          </p>
        )}
      </div>

      {hasFiles ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">
            내 제출물 ({fileList.length}개)
          </h2>
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-emerald-900">
                제출 완료
                {late && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    지각 제출
                  </span>
                )}
              </span>
              <span className="text-xs text-emerald-700">
                마지막 제출 {formatKstDateTime(submission!.submitted_at)}
              </span>
            </div>

            <ul className="divide-y divide-emerald-200 rounded-md border border-emerald-200 bg-white">
              {fileList.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <SignedFileLink submissionFileId={f.id} label={f.original_filename} />
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {formatKstDateTime(f.uploaded_at)}
                    </span>
                    <form action={deleteSubmissionFileAction}>
                      <input type="hidden" name="fileId" value={f.id} />
                      <input type="hidden" name="assignmentId" value={assignmentId} />
                      <button type="submit" className="text-xs text-red-600 underline">
                        삭제
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>

            {submission?.note && (
              <p className="rounded-md bg-white/70 p-2 text-xs whitespace-pre-wrap text-emerald-900">
                <span className="font-medium">내 메모 </span>
                {submission.note}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">제출 상태</h2>
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 제출하지 않았습니다.
            {overdue && " 마감이 지났지만 제출할 수 있습니다."}
          </p>
        </section>
      )}

      {feedback && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">선생님이 공개한 피드백</h2>
          <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <FeedbackMarkdown className="text-indigo-950">{feedback.student_feedback}</FeedbackMarkdown>
            <p className="text-xs text-indigo-700">
              AI가 채점기준에 비추어 쓰고 선생님이 확인해 공개한 피드백입니다. 점수는 선생님이
              따로 알려주십니다.
            </p>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {hasFiles ? "파일 더 제출" : "파일 제출"}
        </h2>
        <AssignmentSubmitWidget assignmentId={assignmentId} hasSubmission={hasFiles} />
      </section>
    </div>
  );
}
