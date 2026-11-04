import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { formatKstDateTime } from "@/lib/datetime";
import { FIELD_LABEL, documentDisplayLabel } from "@/lib/research/stage";
import type { DocumentStage, ResearchField } from "@/lib/types/db";

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

export default async function TeacherDashboardPage() {
  const session = await requireRole("teacher");
  const supabase = await createClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, school_year, join_code")
    .eq("teacher_id", session.userId)
    .order("created_at", { ascending: false });

  const classIds = (classes ?? []).map((c) => c.id);

  const { data: enrollments } = classIds.length
    ? await supabase.from("class_enrollments").select("class_id, student_id").in("class_id", classIds)
    : { data: [] as Array<{ class_id: string; student_id: string }> };

  // RLS: 담당 클래스의 과제만 조회된다
  const { data: projects } = classIds.length
    ? await supabase
        .from("research_projects")
        .select("id, class_id, title, field, status, updated_at")
        .in("class_id", classIds)
        .order("updated_at", { ascending: false })
        .overrideTypes<
          Array<{
            id: string;
            class_id: string;
            title: string;
            field: ResearchField;
            status: string;
            updated_at: string;
          }>,
          { merge: false }
        >()
    : { data: [] as Array<{
        id: string;
        class_id: string;
        title: string;
        field: ResearchField;
        status: string;
        updated_at: string;
      }> };

  const projectIds = (projects ?? []).map((p) => p.id);

  const { data: documents } = projectIds.length
    ? await supabase
        .from("research_documents")
        .select("id, project_id, stage, title, round_no, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(50)
        .overrideTypes<
          Array<{
            id: string;
            project_id: string;
            stage: DocumentStage;
            title: string;
            round_no: number | null;
            created_at: string;
          }>,
          { merge: false }
        >()
    : { data: [] as Array<{
        id: string;
        project_id: string;
        stage: DocumentStage;
        title: string;
        round_no: number | null;
        created_at: string;
      }> };

  const docIds = (documents ?? []).map((d) => d.id);

  const { data: teacherFeedbacks } = docIds.length
    ? await supabase.from("teacher_feedbacks").select("document_id").in("document_id", docIds)
    : { data: [] as Array<{ document_id: string }> };

  // 교사는 ai_feedbacks 테이블을 직접 읽을 수 있다 — 별점(rating)은 교사 전용 지표다.
  const { data: aiFeedbacks } = docIds.length
    ? await supabase
        .from("ai_feedbacks")
        .select("document_id, rating, verified")
        .in("document_id", docIds)
    : { data: [] as Array<{ document_id: string; rating: number | null; verified: boolean }> };

  const reviewed = new Set((teacherFeedbacks ?? []).map((f) => f.document_id));
  const aiByDoc = new Map((aiFeedbacks ?? []).map((f) => [f.document_id, f]));
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));
  const classNameById = new Map((classes ?? []).map((c) => [c.id, c.name]));

  const pending = (documents ?? []).filter((d) => !reviewed.has(d.id));
  const studentCount = new Set((enrollments ?? []).map((e) => e.student_id)).size;

  // 별점이 3점 이하인 AI 피드백 — 사실 오류가 섞였을 가능성이 상대적으로 높아 먼저 검토할 대상
  const lowRated = (documents ?? []).filter((d) => {
    const ai = aiByDoc.get(d.id);
    return ai?.rating !== null && ai?.rating !== undefined && ai.rating <= 3;
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
        <Link
          href="/teacher/classes/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + 클래스 만들기
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="클래스" value={classes?.length ?? 0} />
        <Tile label="학생" value={studentCount} />
        <Tile label="연구 과제" value={projects?.length ?? 0} />
        <Tile label="검토 대기" value={pending.length} />
      </div>

      {lowRated.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">먼저 확인이 필요한 AI 피드백</h2>
          <p className="text-xs text-gray-500">
            AI가 스스로 매긴 완성도 별점이 3점 이하인 산출물입니다. 사실 오류가 섞였을 수 있으니
            먼저 확인해주세요.
          </p>
          <ul className="divide-y divide-gray-200 rounded-lg border border-amber-200 bg-amber-50">
            {lowRated.slice(0, 10).map((d) => {
              const project = projectById.get(d.project_id);
              const ai = aiByDoc.get(d.id);
              return (
                <li key={d.id}>
                  <Link
                    href={`/teacher/projects/${d.project_id}#doc-${d.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-amber-100"
                  >
                    <div>
                      <p className="text-sm font-medium text-amber-950">{d.title}</p>
                      <p className="text-xs text-amber-700">
                        {project?.title ?? "연구"} · {documentDisplayLabel(d.stage, d.round_no)}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-amber-800">
                      {"★".repeat(ai?.rating ?? 0)}
                      {"☆".repeat(5 - (ai?.rating ?? 0))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">검토 대기 산출물</h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            검토를 기다리는 산출물이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {pending.slice(0, 15).map((d) => {
              const project = projectById.get(d.project_id);
              const ai = aiByDoc.get(d.id);
              return (
                <li key={d.id}>
                  <Link
                    href={`/teacher/projects/${d.project_id}#doc-${d.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{d.title}</p>
                      <p className="text-xs text-gray-500">
                        {project ? classNameById.get(project.class_id) : "클래스"} ·{" "}
                        {project?.title ?? "연구"} · {documentDisplayLabel(d.stage, d.round_no)} ·{" "}
                        {formatKstDateTime(d.created_at)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        ai ? "bg-indigo-100 text-indigo-700" : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {ai ? "AI 피드백 완료" : "AI 피드백 없음"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">클래스</h2>
        {!classes || classes.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">아직 만든 클래스가 없습니다.</p>
            <Link
              href="/teacher/classes/new"
              className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              클래스 만들기
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {classes.map((c) => {
              const count = (enrollments ?? []).filter((e) => e.class_id === c.id).length;
              return (
                <li key={c.id}>
                  <Link
                    href={`/teacher/classes/${c.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.school_year ? `${c.school_year} · ` : ""}학생 {count}명
                      </p>
                    </div>
                    <span className="rounded-md bg-gray-100 px-2.5 py-1 font-mono text-xs tracking-widest text-gray-700">
                      {c.join_code}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {projects && projects.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">연구 과제</h2>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {projects.slice(0, 20).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/teacher/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.title}</p>
                    <p className="text-xs text-gray-500">
                      {classNameById.get(p.class_id) ?? "클래스"} · {FIELD_LABEL[p.field]}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500">
                    {formatKstDateTime(p.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
