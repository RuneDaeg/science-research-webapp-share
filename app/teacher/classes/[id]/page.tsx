import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { deleteAnnouncementAction } from "@/app/teacher/actions";
import { AssignmentForm } from "@/components/AssignmentForm";
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
    .select("id, name, school_year, join_code, created_at")
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
        .select("assignment_id")
        .in("assignment_id", assignmentIds)
    : { data: [] as Array<{ assignment_id: string }> };

  const submissionCountByAssignment = new Map<string, number>();
  for (const row of submissionRows ?? []) {
    submissionCountByAssignment.set(
      row.assignment_id,
      (submissionCountByAssignment.get(row.assignment_id) ?? 0) + 1,
    );
  }

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
                <span className="text-xs text-gray-500">{formatKstDate(r.joined_at)} 참여</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
