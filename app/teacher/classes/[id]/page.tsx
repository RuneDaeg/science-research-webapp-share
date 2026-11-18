import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { deleteAnnouncementAction } from "@/app/teacher/actions";
import { AssignmentForm } from "@/components/AssignmentForm";
import { RubricUploadWidget } from "@/components/RubricUploadWidget";
import { SignedFileLink } from "@/components/SignedFileLink";
import { GradeAllButton } from "@/components/GradeButtons";
import { computeOverallGradeSignature } from "@/lib/ai/grading";
import { computeSetukSignature } from "@/lib/ai/setuk";
import { formatKstDate, formatKstDateTime } from "@/lib/datetime";
import { FIELD_LABEL, STATUS_LABEL } from "@/lib/research/stage";
import type { ProjectStatus, ResearchField } from "@/lib/types/db";

export default async function TeacherClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("teacher");
  const { id: classId } = await params;
  const supabase = await createClient();

  // RLS: 본인이 담당하는 클래스만 조회된다
  const { data: classRow } = await supabase
    .from("classes")
    .select("id, name, school_year, join_code, created_at, rubric_path, rubric_filename")
    .eq("id", classId)
    .maybeSingle();

  if (!classRow) notFound();

  const { data: roster } = await supabase
    .from("class_enrollments")
    .select("id, student_id, joined_at, profiles(display_name)")
    .eq("class_id", classId)
    .order("joined_at", { ascending: true })
    .overrideTypes<
      Array<{
        id: string;
        student_id: string;
        joined_at: string;
        profiles: { display_name: string } | null;
      }>,
      { merge: false }
    >();

  const { data: projects } = await supabase
    .from("research_projects")
    .select("id, title, field, status, updated_at")
    .eq("class_id", classId)
    .order("updated_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string;
        title: string;
        field: ResearchField;
        status: ProjectStatus;
        updated_at: string;
      }>,
      { merge: false }
    >();

  const { data: announcements } = await supabase
    .from("class_announcements")
    .select("id, body, created_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });

  // 과제/평가 글과 제출 건수. 제출물 수는 교사가 목록에서 바로 가늠할 수 있어야 한다.
  const { data: assignments } = await supabase
    .from("class_assignments")
    .select("id, title, due_at, created_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const { data: submissionRows } = assignmentIds.length
    ? await supabase
        .from("assignment_submissions")
        .select("id, assignment_id, student_id")
        .in("assignment_id", assignmentIds)
    : { data: [] as Array<{ id: string; assignment_id: string; student_id: string }> };

  const submissionCountByAssignment = new Map<string, number>();
  for (const row of submissionRows ?? []) {
    submissionCountByAssignment.set(
      row.assignment_id,
      (submissionCountByAssignment.get(row.assignment_id) ?? 0) + 1,
    );
  }

  // ── 수행평가 종합 채점(0012) ─────────────────────────────
  // 학생마다 이 클래스에 낸 파일 경로를 모아 signature를 만든다. 아직 채점하지 않았거나 채점 뒤
  // 파일이 바뀐 학생만 '전체 채점' 대상이 된다(gradingService의 collectStudentClassFiles와 같은 범위).
  const projectIds = (projects ?? []).map((p) => p.id);
  const { data: members } = projectIds.length
    ? await supabase.from("project_members").select("project_id, student_id").in("project_id", projectIds)
    : { data: [] as Array<{ project_id: string; student_id: string }> };
  const { data: docPaths } = projectIds.length
    ? await supabase.from("research_documents").select("project_id, file_path").in("project_id", projectIds)
    : { data: [] as Array<{ project_id: string; file_path: string }> };
  const submissionIds = (submissionRows ?? []).map((s) => s.id);
  const { data: subFilePaths } = submissionIds.length
    ? await supabase
        .from("assignment_submission_files")
        .select("submission_id, file_path")
        .in("submission_id", submissionIds)
    : { data: [] as Array<{ submission_id: string; file_path: string }> };
  const { data: overallGrades } = await supabase
    .from("student_overall_grades")
    .select("student_id, signature")
    .eq("class_id", classId);

  const pathsByStudent = new Map<string, string[]>();
  const addPath = (studentId: string, p: string) =>
    pathsByStudent.set(studentId, [...(pathsByStudent.get(studentId) ?? []), p]);
  for (const m of members ?? []) {
    for (const d of (docPaths ?? []).filter((d) => d.project_id === m.project_id)) {
      addPath(m.student_id, d.file_path);
    }
  }
  const studentOfSubmission = new Map((submissionRows ?? []).map((s) => [s.id, s.student_id]));
  for (const f of subFilePaths ?? []) {
    const sid = studentOfSubmission.get(f.submission_id);
    if (sid) addPath(sid, f.file_path);
  }
  // 학생이 따로 보내 선생님이 올려 둔 파일(0014)도 같은 범위에 든다.
  const { data: receivedPaths } = await supabase
    .from("student_received_files")
    .select("student_id, file_path")
    .eq("class_id", classId);
  for (const r of receivedPaths ?? []) addPath(r.student_id, r.file_path);
  const overallSignature = new Map((overallGrades ?? []).map((g) => [g.student_id, g.signature]));

  // 세특 참고 초안(0013). 메모만 저장되고 초안이 없는 학생도 있다(result null).
  const { data: setukRows } = await supabase
    .from("student_setuk_drafts")
    .select("student_id, teacher_memo, signature, result")
    .eq("class_id", classId);
  const setukByStudent = new Map((setukRows ?? []).map((r) => [r.student_id, r]));
  const setukStatus = (studentId: string): "none" | "todo" | "stale" | "done" => {
    const row = setukByStudent.get(studentId);
    const paths = pathsByStudent.get(studentId) ?? [];
    if (paths.length === 0 && !row?.teacher_memo) return "none";
    if (!row?.result) return "todo";
    return row.signature ===
      computeSetukSignature({
        rubricPath: classRow.rubric_path,
        filePaths: paths,
        teacherMemo: row.teacher_memo,
      })
      ? "done"
      : "stale";
  };
  const setukTargets = (roster ?? [])
    .filter((r) => ["todo", "stale"].includes(setukStatus(r.student_id)))
    .map((r) => ({ classId, studentId: r.student_id }));

  type OverallStatus = "no-files" | "todo" | "stale" | "done";
  const overallStatus = (studentId: string): OverallStatus => {
    const paths = pathsByStudent.get(studentId) ?? [];
    if (paths.length === 0) return "no-files";
    const saved = overallSignature.get(studentId);
    if (!saved) return "todo";
    if (!classRow.rubric_path) return "done";
    return saved ===
      computeOverallGradeSignature({ rubricPath: classRow.rubric_path, filePaths: paths })
      ? "done"
      : "stale";
  };
  const overallTargets = (roster ?? [])
    .filter((r) => ["todo", "stale"].includes(overallStatus(r.student_id)))
    .map((r) => ({ classId, studentId: r.student_id }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/teacher/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          ← 대시보드
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{classRow.name}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {classRow.school_year ? `${classRow.school_year} · ` : ""}
          학생 {roster?.length ?? 0}명 · 연구 {projects?.length ?? 0}건
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">참여 코드</h2>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-gray-900">
            {classRow.join_code}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            학생이 [클래스 참여] 화면에서 이 코드를 입력하면 이 수업에 참여합니다.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">공지</h2>
        <AnnouncementForm classId={classId} />
        {announcements && announcements.length > 0 && (
          <ul className="space-y-2">
            {announcements.map((n) => (
              <li
                key={n.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div>
                  <p className="whitespace-pre-wrap text-sm text-gray-800">{n.body}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatKstDateTime(n.created_at)}</p>
                </div>
                <form action={deleteAnnouncementAction}>
                  <input type="hidden" name="classId" value={classId} />
                  <input type="hidden" name="announcementId" value={n.id} />
                  <button type="submit" className="text-xs text-red-600 underline">
                    삭제
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">과제 · 평가</h2>

        {!assignments || assignments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 등록한 과제가 없습니다. 아래에서 등록하면 학생이 파일을 제출할 수 있습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {assignments.map((a) => {
              const overdue = a.due_at ? new Date(a.due_at) < new Date() : false;
              return (
                <li key={a.id}>
                  <Link
                    href={`/teacher/assignments/${a.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{a.title}</span>
                      {a.due_at && (
                        <span className="ml-2 text-xs text-gray-500">
                          마감 {formatKstDateTime(a.due_at)}
                          {overdue && <span className="ml-1 text-amber-700">(지남)</span>}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-600">
                      제출 {submissionCountByAssignment.get(a.id) ?? 0}건
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <AssignmentForm classId={classId} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">연구 과제</h2>
        {!projects || projects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 등록된 연구 과제가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/teacher/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.title}</p>
                    <p className="text-xs text-gray-500">
                      {FIELD_LABEL[p.field]} · {STATUS_LABEL[p.status]}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500">{formatKstDate(p.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">수행평가 종합 채점 · 세특 초안</h2>
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <div className="space-y-2">
            {classRow.rubric_path ? (
              <p className="flex flex-wrap items-center gap-2 text-gray-700">
                <span className="text-gray-500">평가 계획서</span>
                <SignedFileLink
                  rubricClassId={classId}
                  label={classRow.rubric_filename ?? "평가 계획서"}
                />
              </p>
            ) : (
              <p className="text-gray-600">
                수행평가 채점기준이 들어 있는 평가 계획서를 올리면, AI가 학생마다 이 클래스에 낸 파일
                전체(연구 산출물과 과제 제출물)를 보고 계획서 안의 수행평가를 하나씩 채점합니다.
              </p>
            )}
            <RubricUploadWidget
              classId={classId}
              hasRubric={!!classRow.rubric_path}
              noun="평가 계획서"
            />
          </div>
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <GradeAllButton
              endpoint="/api/classes/grade-overall"
              requests={overallTargets}
              confirmMessage={
                "한 명에 30초~1분쯤 걸립니다.\n결과는 선생님 화면에만 보이고 학생에게는 보이지 않습니다."
              }
              disabledReason={classRow.rubric_path ? undefined : "평가 계획서를 먼저 올려주세요."}
            />
            <p className="text-xs text-gray-500">
              아직 채점하지 않았거나 채점 뒤 파일이 바뀐 학생만 채점합니다. 결과는 아래 명단에서
              학생 이름을 누르면 볼 수 있습니다. AI 점수는 선생님이 검토할 초안입니다.
            </p>
          </div>
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <GradeAllButton
              endpoint="/api/classes/setuk"
              requests={setukTargets}
              label="세특 초안 만들기"
              runningLabel="세특 초안 만드는 중"
              confirmMessage={
                "학생마다 낸 파일과 저장해 둔 관찰 메모로 세특 참고 초안을 만듭니다. 한 명에 10~30초쯤 걸립니다.\n기재요령상 AI 생성 자료는 그대로 입력할 수 없으니 반드시 고쳐 쓰세요."
              }
            />
            <p className="text-xs text-gray-500">
              초안이 없거나 파일·메모가 바뀐 학생만 만듭니다. 관찰 메모는 학생 이름을 눌러 학생마다
              적어 두면 초안의 가장 앞선 근거가 됩니다. 평가 계획서가 있으면 성취기준 표현을 참고합니다.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">학생 명단</h2>
        <p className="text-xs text-gray-500">
          이름을 누르면 그 학생이 올린 연구 산출물과 과제 제출물을 한 화면에서 봅니다.
        </p>
        {!roster || roster.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 참여한 학생이 없습니다. 위 참여 코드를 알려주세요.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {roster.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link
                  href={`/teacher/classes/${classId}/students/${r.student_id}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {r.profiles?.display_name?.trim() || "(이름 없음)"}
                </Link>
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  {classRow.rubric_path &&
                    {
                      "no-files": null,
                      todo: (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                          채점 전
                        </span>
                      ),
                      stale: (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">
                          다시 채점 필요
                        </span>
                      ),
                      done: (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-800">
                          AI 채점됨
                        </span>
                      ),
                    }[overallStatus(r.student_id)]}
                  {
                    {
                      none: null,
                      todo: null,
                      stale: (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">
                          세특 다시 만들기
                        </span>
                      ),
                      done: (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                          세특 초안
                        </span>
                      ),
                    }[setukStatus(r.student_id)]
                  }
                  {formatKstDate(r.joined_at)} 참여
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
