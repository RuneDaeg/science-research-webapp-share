import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { SignedFileLink } from "@/components/SignedFileLink";
import { AiGradeCard } from "@/components/AiGradeCard";
import { computeGradeSignature } from "@/lib/ai/grading";
import { formatKstDate, formatKstDateTime } from "@/lib/datetime";
import { FIELD_LABEL, STATUS_LABEL, documentDisplayLabel } from "@/lib/research/stage";
import type {
  AssignmentAiGrade,
  DocumentStage,
  ProjectStatus,
  ResearchField,
} from "@/lib/types/db";

// 학생 한 명이 이 클래스에서 쓴 것을 한 화면에 모은다 — 연구 산출물과 과제 제출물.
// 클래스 화면의 학생 명단에서 이름을 누르면 온다. 상담이나 수행평가 확인 때 여기저기 열어 보지
// 않아도 되게 하려는 화면이다. 모든 조회는 RLS가 걸린 교사 세션으로 한다.
export default async function TeacherStudentPage({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  await requireRole("teacher");
  const { id: classId, studentId } = await params;
  const supabase = await createClient();

  // RLS: 담당 클래스만 조회된다
  const { data: classRow } = await supabase
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) notFound();

  // 이 클래스 학생이 아니면 보여줄 것이 없다(다른 반 학생 id를 주소에 넣는 경우)
  const { data: enrollment } = await supabase
    .from("class_enrollments")
    .select("joined_at, profiles(display_name)")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle()
    .overrideTypes<
      { joined_at: string; profiles: { display_name: string } | null },
      { merge: false }
    >();
  if (!enrollment) notFound();

  const studentName = enrollment.profiles?.display_name?.trim() || "(이름 없음)";

  // ── 연구 산출물 ─────────────────────────────────────────
  // 팀 연구도 있으므로 소유 여부가 아니라 팀원 명단으로 찾는다.
  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("student_id", studentId);
  const memberProjectIds = (memberships ?? []).map((m) => m.project_id);

  const { data: projects } = memberProjectIds.length
    ? await supabase
        .from("research_projects")
        .select("id, title, field, status, updated_at")
        .eq("class_id", classId)
        .in("id", memberProjectIds)
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
        >()
    : { data: [] as Array<{
        id: string;
        title: string;
        field: ResearchField;
        status: ProjectStatus;
        updated_at: string;
      }> };
  const projectIds = (projects ?? []).map((p) => p.id);

  const { data: teamRows } = projectIds.length
    ? await supabase
        .from("project_members")
        .select("project_id, student_id, profiles(display_name)")
        .in("project_id", projectIds)
        .overrideTypes<
          Array<{ project_id: string; student_id: string; profiles: { display_name: string } | null }>,
          { merge: false }
        >()
    : { data: [] as Array<{ project_id: string; student_id: string; profiles: { display_name: string } | null }> };
  const nameById = new Map(
    (teamRows ?? []).map((t) => [t.student_id, t.profiles?.display_name?.trim() || "(이름 없음)"]),
  );
  const teamSizeByProject = new Map<string, number>();
  for (const t of teamRows ?? []) {
    teamSizeByProject.set(t.project_id, (teamSizeByProject.get(t.project_id) ?? 0) + 1);
  }

  const { data: documents } = projectIds.length
    ? await supabase
        .from("research_documents")
        .select(
          "id, project_id, uploaded_by, stage, title, round_no, note, file_path, extracted_text, created_at",
        )
        .in("project_id", projectIds)
        .order("created_at", { ascending: true })
        .overrideTypes<
          Array<{
            id: string;
            project_id: string;
            uploaded_by: string;
            stage: DocumentStage;
            title: string;
            round_no: number | null;
            note: string | null;
            file_path: string;
            extracted_text: string | null;
            created_at: string;
          }>,
          { merge: false }
        >()
    : { data: [] as Array<{
        id: string;
        project_id: string;
        uploaded_by: string;
        stage: DocumentStage;
        title: string;
        round_no: number | null;
        note: string | null;
        file_path: string;
        extracted_text: string | null;
        created_at: string;
      }> };
  const docIds = (documents ?? []).map((d) => d.id);

  const { data: teacherFeedbacks } = docIds.length
    ? await supabase.from("teacher_feedbacks").select("document_id").in("document_id", docIds)
    : { data: [] as Array<{ document_id: string }> };
  const reviewed = new Set((teacherFeedbacks ?? []).map((f) => f.document_id));

  // ── 과제 · 평가 ─────────────────────────────────────────
  const { data: assignments } = await supabase
    .from("class_assignments")
    .select("id, title, body, due_at, rubric_path, created_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  const assignmentIds = (assignments ?? []).map((a) => a.id);

  const { data: submissions } = assignmentIds.length
    ? await supabase
        .from("assignment_submissions")
        .select("id, assignment_id, note, submitted_at")
        .eq("student_id", studentId)
        .in("assignment_id", assignmentIds)
    : { data: [] as Array<{ id: string; assignment_id: string; note: string | null; submitted_at: string }> };
  const submissionByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));
  const submissionIds = (submissions ?? []).map((s) => s.id);

  const { data: files } = submissionIds.length
    ? await supabase
        .from("assignment_submission_files")
        .select("id, submission_id, file_path, original_filename")
        .in("submission_id", submissionIds)
        .order("uploaded_at", { ascending: true })
    : { data: [] as Array<{ id: string; submission_id: string; file_path: string; original_filename: string }> };
  const filesBySubmission = new Map<string, Array<{ id: string; file_path: string; original_filename: string }>>();
  for (const f of files ?? []) {
    const list = filesBySubmission.get(f.submission_id) ?? [];
    list.push(f);
    filesBySubmission.set(f.submission_id, list);
  }

  const { data: grades } = submissionIds.length
    ? await supabase.from("assignment_ai_grades").select("*").in("submission_id", submissionIds)
    : { data: [] as AssignmentAiGrade[] };
  const gradeBySubmission = new Map((grades ?? []).map((g) => [g.submission_id, g]));

  const pagePath = `/teacher/classes/${classId}/students/${studentId}`;
  const submittedCount = submissions?.length ?? 0;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href={`/teacher/classes/${classId}`} className="text-sm text-gray-500 hover:text-gray-900">
          ← {classRow.name}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{studentName}</h1>
        <p className="text-sm text-gray-500">
          {formatKstDate(enrollment.joined_at)} 참여 · 연구 {projects?.length ?? 0}건 · 산출물{" "}
          {documents?.length ?? 0}건 · 과제 제출 {submittedCount} / {assignments?.length ?? 0}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">연구 산출물</h2>
        {!projects || projects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            이 클래스에서 참여한 연구가 없습니다.
          </p>
        ) : (
          projects.map((p) => {
            const docs = (documents ?? []).filter((d) => d.project_id === p.id);
            const isTeam = (teamSizeByProject.get(p.id) ?? 1) > 1;
            return (
              <div key={p.id} className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/teacher/projects/${p.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {p.title}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {FIELD_LABEL[p.field]} · {STATUS_LABEL[p.status]}
                    {isTeam && ` · 팀 ${teamSizeByProject.get(p.id)}명`}
                  </span>
                </div>

                {docs.length === 0 ? (
                  <p className="text-sm text-gray-500">아직 올린 산출물이 없습니다.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {docs.map((d) => {
                      // 제목을 비워 두고 올리면 단계 이름이 제목이 된다. 같은 말을 두 번 쓰지 않는다.
                      const label = documentDisplayLabel(d.stage, d.round_no);
                      return (
                        <li key={d.id} className="space-y-1 py-2 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Link
                              href={`/teacher/projects/${p.id}#doc-${d.id}`}
                              className="text-gray-900 hover:underline"
                            >
                              {d.title.trim() !== label && (
                                <span className="text-xs text-gray-500">{label} · </span>
                              )}
                              {d.title}
                            </Link>
                            <span className="flex items-center gap-2 text-xs text-gray-500">
                              {/* 팀 연구는 다른 팀원이 올린 것도 섞여 있다. 누가 썼는지 밝혀 둔다. */}
                              {d.uploaded_by !== studentId && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5">
                                  {nameById.get(d.uploaded_by) ?? "팀원"} 올림
                                </span>
                              )}
                              {reviewed.has(d.id) ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                                  피드백 완료
                                </span>
                              ) : (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                                  검토 대기
                                </span>
                              )}
                              {formatKstDate(d.created_at)}
                            </span>
                          </div>
                          {d.note && (
                            <p className="text-xs whitespace-pre-wrap text-gray-600">
                              <span className="font-medium">학생 메모 </span>
                              {d.note}
                            </p>
                          )}
                          {/* hwpx·docx·txt는 올릴 때 뽑아 둔 본문을 바로 펼쳐 본다. PDF는 원본을 연다
                              (PDF는 AI가 원본을 보므로 본문을 따로 뽑지 않는다 — AGENTS.md). */}
                          {d.extracted_text?.trim() ? (
                            <details className="rounded-md bg-gray-50 p-2">
                              <summary className="cursor-pointer text-xs text-gray-700">본문 보기</summary>
                              <p className="mt-2 max-h-96 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-gray-800">
                                {d.extracted_text}
                              </p>
                            </details>
                          ) : (
                            d.file_path.toLowerCase().endsWith(".pdf") && (
                              <SignedFileLink documentId={d.id} label="PDF 열기" />
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">과제 · 평가 제출</h2>
        {!assignments || assignments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            이 클래스에 낸 과제가 없습니다.
          </p>
        ) : (
          <ul className="space-y-3">
            {assignments.map((a) => {
              const s = submissionByAssignment.get(a.id);
              const sFiles = s ? (filesBySubmission.get(s.id) ?? []) : [];
              const late = s && a.due_at ? new Date(s.submitted_at) > new Date(a.due_at) : false;
              const grade = s ? gradeBySubmission.get(s.id) : undefined;
              const stale =
                !!grade &&
                !!a.rubric_path &&
                !!s &&
                grade.signature !==
                  computeGradeSignature({
                    assignmentTitle: a.title,
                    assignmentBody: a.body,
                    rubricPath: a.rubric_path,
                    filePaths: sFiles.map((f) => f.file_path),
                    studentNote: s.note,
                  });
              return (
                <li key={a.id} className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/teacher/assignments/${a.id}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {a.title}
                    </Link>
                    <span className="text-xs">
                      {!s ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">미제출</span>
                      ) : late ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                          지각 제출 · {formatKstDateTime(s.submitted_at)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                          제출 · {formatKstDateTime(s.submitted_at)}
                        </span>
                      )}
                    </span>
                  </div>
                  {sFiles.length > 0 && (
                    <ul className="space-y-1 pl-1">
                      {sFiles.map((f) => (
                        <li key={f.id} className="flex items-center gap-2">
                          <span className="text-gray-400">·</span>
                          <SignedFileLink submissionFileId={f.id} label={f.original_filename} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {s?.note && (
                    <p className="rounded-md bg-gray-50 p-2 text-xs whitespace-pre-wrap text-gray-600">
                      <span className="font-medium">학생 메모 </span>
                      {s.note}
                    </p>
                  )}
                  {grade && <AiGradeCard grade={grade} stale={stale} revalidate={pagePath} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
