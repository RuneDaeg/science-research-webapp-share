import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { SignedFileLink } from "@/components/SignedFileLink";
import { RubricUploadWidget } from "@/components/RubricUploadWidget";
import { GradeAllButton, RegradeButton } from "@/components/GradeButtons";
import { AiGradeCard } from "@/components/AiGradeCard";
import { deleteAssignmentAction } from "@/app/teacher/actions";
import { computeGradeSignature } from "@/lib/ai/grading";
import { formatKstDateTime } from "@/lib/datetime";
import type { AssignmentAiGrade } from "@/lib/types/db";

export default async function TeacherAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("teacher");
  const { id: assignmentId } = await params;
  const supabase = await createClient();

  // RLS: 담당 클래스의 과제만 조회된다 — 조회되면 접근 권한이 검증된 것
  const { data: assignment } = await supabase
    .from("class_assignments")
    .select(
      "id, class_id, title, body, due_at, created_at, rubric_path, rubric_filename, classes(name)",
    )
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
        rubric_path: string | null;
        rubric_filename: string | null;
        classes: { name: string } | null;
      },
      { merge: false }
    >();

  if (!assignment) notFound();

  // RLS: 이 과제의 제출물만 조회된다
  const { data: submissions } = await supabase
    .from("assignment_submissions")
    .select("id, student_id, note, submitted_at, profiles(display_name)")
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string;
        student_id: string;
        note: string | null;
        submitted_at: string;
        profiles: { display_name: string } | null;
      }>,
      { merge: false }
    >();

  // 파일은 제출물마다 여러 개일 수 있다(0009). 한 번에 받아 제출물별로 묶는다.
  // file_path는 AI 채점이 낡았는지(학생이 파일을 더 냈는지) 판단하는 데 쓴다.
  const submissionIds = (submissions ?? []).map((s) => s.id);
  const { data: submissionFiles } = submissionIds.length
    ? await supabase
        .from("assignment_submission_files")
        .select("id, submission_id, file_path, original_filename, uploaded_at")
        .in("submission_id", submissionIds)
        .order("uploaded_at", { ascending: true })
    : {
        data: [] as Array<{
          id: string;
          submission_id: string;
          file_path: string;
          original_filename: string;
          uploaded_at: string;
        }>,
      };

  const filesBySubmission = new Map<
    string,
    Array<{ id: string; file_path: string; original_filename: string; uploaded_at: string }>
  >();
  for (const f of submissionFiles ?? []) {
    const list = filesBySubmission.get(f.submission_id) ?? [];
    list.push(f);
    filesBySubmission.set(f.submission_id, list);
  }

  // AI 채점 결과(0011). 점수가 들어 있어 교사에게만 조회된다.
  const { data: grades } = submissionIds.length
    ? await supabase.from("assignment_ai_grades").select("*").in("submission_id", submissionIds)
    : { data: [] as AssignmentAiGrade[] };
  const gradeBySubmission = new Map((grades ?? []).map((g) => [g.submission_id, g]));

  // 채점 뒤에 학생이 파일을 더 내거나 교사가 채점기준·안내를 바꾸면 낡은 채점이 된다.
  const isStale = (submissionId: string, note: string | null) => {
    const grade = gradeBySubmission.get(submissionId);
    if (!grade || !assignment.rubric_path) return false;
    return (
      grade.signature !==
      computeGradeSignature({
        assignmentTitle: assignment.title,
        assignmentBody: assignment.body,
        rubricPath: assignment.rubric_path,
        filePaths: (filesBySubmission.get(submissionId) ?? []).map((f) => f.file_path),
        studentNote: note,
      })
    );
  };

  // '전체 채점' 대상: 파일이 있는데 아직 채점하지 않았거나 채점이 낡은 제출물
  const toGrade = (submissions ?? [])
    .filter((s) => (filesBySubmission.get(s.id) ?? []).length > 0)
    .filter((s) => !gradeBySubmission.has(s.id) || isStale(s.id, s.note))
    .map((s) => s.id);

  // 미제출자를 알려면 반 전체 명단이 필요하다. 교사에게 가장 쓸모 있는 정보다.
  const { data: roster } = await supabase
    .from("class_enrollments")
    .select("student_id, profiles(display_name)")
    .eq("class_id", assignment.class_id)
    .overrideTypes<
      Array<{ student_id: string; profiles: { display_name: string } | null }>,
      { merge: false }
    >();

  const submittedIds = new Set((submissions ?? []).map((s) => s.student_id));
  const notSubmitted = (roster ?? [])
    .filter((r) => !submittedIds.has(r.student_id))
    .map((r) => r.profiles?.display_name?.trim() || "(이름 없음)")
    .sort((a, b) => a.localeCompare(b, "ko"));

  const total = roster?.length ?? 0;
  const done = submissions?.length ?? 0;
  const overdue = assignment.due_at ? new Date(assignment.due_at) < new Date() : false;
  const pagePath = `/teacher/assignments/${assignmentId}`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href={`/teacher/classes/${assignment.class_id}`}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← {assignment.classes?.name ?? "클래스"}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{assignment.title}</h1>
        <p className="text-sm text-gray-500">
          {formatKstDateTime(assignment.created_at)} 등록
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">채점기준 · AI 채점</h2>
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <div className="space-y-2">
            {assignment.rubric_path ? (
              <p className="flex flex-wrap items-center gap-2 text-gray-700">
                <span className="text-gray-500">채점기준 파일</span>
                <SignedFileLink
                  rubricAssignmentId={assignmentId}
                  label={assignment.rubric_filename ?? "채점기준"}
                />
              </p>
            ) : (
              <p className="text-gray-600">
                채점기준표(평가 계획서 등)를 올리면 AI가 그 기준으로 학생 제출물의 채점 초안과
                피드백을 만듭니다. 계획서에 평가가 여러 개 있으면 과제 제목에 맞는 것을 골라 씁니다.
              </p>
            )}
            <RubricUploadWidget assignmentId={assignmentId} hasRubric={!!assignment.rubric_path} />
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-4">
            <GradeAllButton
              submissionIds={toGrade}
              disabledReason={
                assignment.rubric_path ? undefined : "채점기준 파일을 먼저 올려주세요."
              }
            />
            <p className="text-xs text-gray-500">
              아직 채점하지 않았거나 채점 뒤 파일이 바뀐 학생만 채점합니다. AI 점수는 선생님이
              검토할 초안이며 학생에게 보이지 않습니다. 학생에게는 &lsquo;학생에게 공개&rsquo;를
              누른 피드백 문장만 보입니다.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          제출 현황 {total > 0 && `(${done} / ${total}명)`}
        </h2>

        {done === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            아직 제출한 학생이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {(submissions ?? []).map((s) => {
              const late = assignment.due_at
                ? new Date(s.submitted_at) > new Date(assignment.due_at)
                : false;
              const grade = gradeBySubmission.get(s.id);
              const files = filesBySubmission.get(s.id) ?? [];
              return (
                <li key={s.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">
                      <Link
                        href={`/teacher/classes/${assignment.class_id}/students/${s.student_id}`}
                        className="hover:underline"
                      >
                        {s.profiles?.display_name?.trim() || "(이름 없음)"}
                      </Link>
                      {late && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          지각 제출
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatKstDateTime(s.submitted_at)}
                    </span>
                  </div>

                  {/* 파일은 제출물마다 여러 개일 수 있다. 올린 순서대로 보여준다. */}
                  <ul className="space-y-1 pl-1">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400">·</span>
                        <SignedFileLink submissionFileId={f.id} label={f.original_filename} />
                      </li>
                    ))}
                  </ul>
                  {s.note && (
                    <p className="rounded-md bg-gray-50 p-2 text-xs whitespace-pre-wrap text-gray-600">
                      <span className="font-medium">학생 메모 </span>
                      {s.note}
                    </p>
                  )}

                  {grade ? (
                    <AiGradeCard grade={grade} stale={isStale(s.id, s.note)} revalidate={pagePath} />
                  ) : (
                    assignment.rubric_path &&
                    files.length > 0 && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        아직 AI 채점 전입니다.
                        <RegradeButton submissionId={s.id} label="이 학생만 AI 채점" />
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {notSubmitted.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">미제출 {notSubmitted.length}명</p>
            <p className="mt-1 text-xs leading-relaxed">{notSubmitted.join(", ")}</p>
          </div>
        )}
      </section>

      <section className="space-y-2 border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold text-gray-900">과제 삭제</h2>
        <p className="text-xs text-gray-500">
          학생이 제출한 파일과 채점기준 파일, AI 채점 결과도 모두 함께 삭제되며 되돌릴 수 없습니다.
        </p>
        <form action={deleteAssignmentAction}>
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="classId" value={assignment.class_id} />
          <button
            type="submit"
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            과제 삭제
          </button>
        </form>
      </section>
    </div>
  );
}
