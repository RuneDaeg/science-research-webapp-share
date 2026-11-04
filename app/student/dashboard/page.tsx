import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { formatKstDate, formatKstDateTime } from "@/lib/datetime";
import { FIELD_LABEL, STATUS_LABEL, documentDisplayLabel } from "@/lib/research/stage";
import type { DocumentStage, ProjectStatus, ResearchField } from "@/lib/types/db";

const STATUS_STYLE: Record<ProjectStatus, string> = {
  planning: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
};

export default async function StudentDashboardPage() {
  const session = await requireRole("student");
  const supabase = await createClient();

  // RLS: 본인이 팀원인 과제만 조회된다
  const { data: projects } = await supabase
    .from("research_projects")
    .select("id, class_id, title, field, status, updated_at, classes(name)")
    .order("updated_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string;
        class_id: string;
        title: string;
        field: ResearchField;
        status: ProjectStatus;
        updated_at: string;
        classes: { name: string } | null;
      }>,
      { merge: false }
    >();

  const { data: enrollments } = await supabase
    .from("class_enrollments")
    .select("class_id, classes(name)")
    .eq("student_id", session.userId)
    .overrideTypes<
      Array<{ class_id: string; classes: { name: string } | null }>,
      { merge: false }
    >();

  const classNameById = new Map(
    (enrollments ?? []).map((e) => [e.class_id, e.classes?.name ?? "클래스"]),
  );

  // 등록된 클래스의 공지 (RLS: 본인 클래스만)
  const { data: announcements } = await supabase
    .from("class_announcements")
    .select("id, class_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  // 등록된 클래스의 과제/평가 (RLS: 본인 클래스만). 제출 여부를 함께 표시해야
  // 학생이 무엇이 남았는지 한눈에 본다.
  const { data: assignments } = await supabase
    .from("class_assignments")
    .select("id, class_id, title, due_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const { data: mySubmissions } = assignmentIds.length
    ? await supabase
        .from("assignment_submissions")
        .select("assignment_id")
        .in("assignment_id", assignmentIds)
        .eq("student_id", session.userId)
    : { data: [] as Array<{ assignment_id: string }> };

  const submittedAssignmentIds = new Set(
    (mySubmissions ?? []).map((s) => s.assignment_id),
  );

  const projectIds = (projects ?? []).map((p) => p.id);

  // 최근 산출물 + 그에 달린 피드백 (RLS: 팀원인 과제만)
  const { data: documents } = projectIds.length
    ? await supabase
        .from("research_documents")
        .select("id, project_id, stage, title, round_no, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: [] as Array<{
        id: string;
        project_id: string;
        stage: DocumentStage;
        title: string;
        round_no: number | null;
        created_at: string;
      }> };

  const docIds = (documents ?? []).map((d) => d.id);

  // 학생은 rating이 빠진 뷰로 읽는다 (별점은 선생님 전용 지표)
  const { data: aiFeedbacks } = docIds.length
    ? await supabase.from("student_ai_feedbacks").select("document_id").in("document_id", docIds)
    : { data: [] as Array<{ document_id: string }> };

  const { data: teacherFeedbacks } = docIds.length
    ? await supabase
        .from("teacher_feedbacks")
        .select("document_id")
        .in("document_id", docIds)
    : { data: [] as Array<{ document_id: string }> };

  const hasAi = new Set((aiFeedbacks ?? []).map((f) => f.document_id));
  const hasTeacher = new Set((teacherFeedbacks ?? []).map((f) => f.document_id));
  const projectTitleById = new Map((projects ?? []).map((p) => [p.id, p.title]));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">내 연구</h1>
        <Link
          href="/student/projects/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + 연구 등록
        </Link>
      </div>

      {announcements && announcements.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">공지</h2>
          <ul className="space-y-2">
            {announcements.map((n) => (
              <li key={n.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs text-emerald-700">
                  {classNameById.get(n.class_id) ?? "클래스"}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-emerald-900">{n.body}</p>
                <p className="mt-1 text-xs text-emerald-600">{formatKstDateTime(n.created_at)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {assignments && assignments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">과제 · 평가</h2>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {assignments.map((a) => {
              const submitted = submittedAssignmentIds.has(a.id);
              const overdue = a.due_at ? new Date(a.due_at) < new Date() : false;
              return (
                <li key={a.id}>
                  <Link
                    href={`/student/assignments/${a.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{a.title}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {classNameById.get(a.class_id) ?? "클래스"}
                        {a.due_at && <> · 마감 {formatKstDateTime(a.due_at)}</>}
                      </span>
                    </span>
                    {submitted ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        제출 완료
                      </span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          overdue
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {overdue ? "미제출 · 마감 지남" : "미제출"}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">연구 과제</h2>
        {!projects || projects.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">
              아직 등록한 연구가 없습니다. 클래스에 참여한 뒤 연구를 등록해보세요.
            </p>
            <div className="flex justify-center gap-2">
              <Link
                href="/student/join"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                클래스 참여
              </Link>
              <Link
                href="/student/projects/new"
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                연구 등록
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/student/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium text-gray-900">{p.title}</p>
                    <p className="text-xs text-gray-500">
                      {p.classes?.name ?? classNameById.get(p.class_id) ?? "클래스"} ·{" "}
                      {FIELD_LABEL[p.field]} · 최근 활동 {formatKstDate(p.updated_at)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {documents && documents.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">최근 제출한 산출물</h2>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {documents.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/student/projects/${d.project_id}#doc-${d.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{d.title}</p>
                    <p className="text-xs text-gray-500">
                      {projectTitleById.get(d.project_id) ?? "연구"} ·{" "}
                      {documentDisplayLabel(d.stage, d.round_no)} ·{" "}
                      {formatKstDate(d.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        hasAi.has(d.id)
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {hasAi.has(d.id) ? "AI 피드백" : "피드백 대기"}
                    </span>
                    {hasTeacher.has(d.id) && (
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                        선생님 피드백
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
