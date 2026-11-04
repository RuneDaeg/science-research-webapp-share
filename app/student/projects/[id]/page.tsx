import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocumentUploadWidget } from "@/components/DocumentUploadWidget";
import { TeamMemberForm } from "@/components/TeamMemberForm";
import { SignedFileLink } from "@/components/SignedFileLink";
import { FeedbackActionButton } from "@/components/FeedbackActionButton";
import FeedbackMarkdown from "@/components/FeedbackMarkdown";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import {
  deleteDocumentAction,
  deleteProjectAction,
  removeTeamMemberAction,
  updateProjectStatusAction,
} from "@/app/student/actions";
import { formatKstDateTime } from "@/lib/datetime";
import { FIELD_LABEL, STATUS_LABEL, documentDisplayLabel } from "@/lib/research/stage";
import type { DocumentStage, ProjectStatus, ResearchField, TeamRole } from "@/lib/types/db";

const STATUSES: ProjectStatus[] = ["planning", "in_progress", "completed"];

export default async function StudentProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("student");
  const { id: projectId } = await params;
  const supabase = await createClient();

  // RLS: 본인이 팀원인 과제만 조회된다 — 조회되면 접근 권한이 검증된 것
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, class_id, owner_id, title, field, research_question, status, classes(name)")
    .eq("id", projectId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        class_id: string;
        owner_id: string;
        title: string;
        field: ResearchField;
        research_question: string | null;
        status: ProjectStatus;
        classes: { name: string } | null;
      },
      { merge: false }
    >();

  if (!project) notFound();

  const isOwner = project.owner_id === session.userId;

  const { data: members } = await supabase
    .from("project_members")
    .select("id, student_id, role_in_team, profiles(display_name)")
    .eq("project_id", projectId)
    .order("joined_at", { ascending: true })
    .overrideTypes<
      Array<{
        id: string;
        student_id: string;
        role_in_team: TeamRole;
        profiles: { display_name: string } | null;
      }>,
      { merge: false }
    >();

  // 팀원 후보: 같은 클래스에 등록된 학생 중 아직 팀에 없는 사람
  const memberIds = new Set((members ?? []).map((m) => m.student_id));
  const { data: classmates } = isOwner
    ? await supabase
        .from("class_enrollments")
        .select("student_id, profiles(display_name)")
        .eq("class_id", project.class_id)
        .overrideTypes<
          Array<{ student_id: string; profiles: { display_name: string } | null }>,
          { merge: false }
        >()
    : { data: [] as Array<{ student_id: string; profiles: { display_name: string } | null }> };

  const candidates = (classmates ?? [])
    .filter((c) => !memberIds.has(c.student_id))
    .map((c) => ({
      id: c.student_id,
      name: c.profiles?.display_name?.trim() || "(이름 없음)",
    }));

  const { data: documents } = await supabase
    .from("research_documents")
    .select("id, stage, title, round_no, note, original_filename, uploaded_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string;
        stage: DocumentStage;
        title: string;
        round_no: number | null;
        note: string | null;
        original_filename: string;
        uploaded_by: string;
        created_at: string;
      }>,
      { merge: false }
    >();

  const docIds = (documents ?? []).map((d) => d.id);

  // [보안] 학생은 rating이 빠진 student_ai_feedbacks 뷰로 읽는다.
  // ai_feedbacks 테이블을 직접 조회하면 RLS에 막혀 아무 것도 안 나온다(교사 전용).
  const { data: aiFeedbacks } = docIds.length
    ? await supabase
        .from("student_ai_feedbacks")
        .select("document_id, body, verified, updated_at")
        .in("document_id", docIds)
    : { data: [] as Array<{
        document_id: string;
        body: string;
        verified: boolean;
        updated_at: string;
      }> };

  // RLS: visible_to_student가 true인 것만 조회된다
  const { data: teacherFeedbacks } = docIds.length
    ? await supabase
        .from("teacher_feedbacks")
        .select("document_id, body, updated_at")
        .in("document_id", docIds)
    : { data: [] as Array<{ document_id: string; body: string; updated_at: string }> };

  const aiByDoc = new Map((aiFeedbacks ?? []).map((f) => [f.document_id, f]));
  const teacherByDoc = new Map((teacherFeedbacks ?? []).map((f) => [f.document_id, f]));
  const memberNameById = new Map(
    (members ?? []).map((m) => [m.student_id, m.profiles?.display_name?.trim() || "(이름 없음)"]),
  );

  // 선생님 피드백이 하나라도 있으면 학생은 과제를 지울 수 없다(0007). 비공개 메모까지
  // 세야 하므로 service-role로 조회한다 — 위의 teacherFeedbacks는 학생 RLS를 거쳐
  // 공개된 것만 담고 있어서 판정에 쓸 수 없다.
  const { count: allTeacherFeedbackCount } = isOwner
    ? await createAdminClient()
        .from("teacher_feedbacks")
        .select("id, research_documents!inner(project_id)", { count: "exact", head: true })
        .eq("research_documents.project_id", projectId)
    : { count: 0 };

  const nextJournalRound =
    (documents ?? []).filter((d) => d.stage === "journal").length + 1;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/student/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          ← 내 연구
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
        <p className="text-sm text-gray-500">
          {project.classes?.name ?? "클래스"} · {FIELD_LABEL[project.field]} ·{" "}
          {STATUS_LABEL[project.status]}
        </p>
        {project.research_question && (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm whitespace-pre-wrap text-gray-700">
            <span className="font-medium text-gray-900">연구 질문 </span>
            {project.research_question}
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">팀</h2>
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {(members ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-gray-900">
                {m.profiles?.display_name?.trim() || "(이름 없음)"}
                {m.role_in_team === "leader" && (
                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    팀장
                  </span>
                )}
              </span>
              {isOwner && m.role_in_team !== "leader" && (
                <form action={removeTeamMemberAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <button type="submit" className="text-xs text-red-600 underline">
                    제외
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {isOwner && <TeamMemberForm projectId={projectId} candidates={candidates} />}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">진행 상태</h2>
        <form action={updateProjectStatusAction} className="flex items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <select
            name="status"
            defaultValue={project.status}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            변경
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">산출물 제출</h2>
        <DocumentUploadWidget projectId={projectId} nextJournalRound={nextJournalRound} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          제출한 산출물 {documents?.length ? `(${documents.length})` : ""}
        </h2>

        {!documents || documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            아직 제출한 산출물이 없습니다. 계획서나 연구 일지를 올리면 AI 탐구 조력자가 바로
            피드백을 줍니다.
          </p>
        ) : (
          <ul className="space-y-4">
            {documents.map((doc) => {
              const ai = aiByDoc.get(doc.id);
              const teacher = teacherByDoc.get(doc.id);
              return (
                <li
                  key={doc.id}
                  id={`doc-${doc.id}`}
                  className="space-y-3 rounded-lg border border-gray-200 bg-white p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{doc.title}</p>
                      <p className="text-xs text-gray-500">
                        {documentDisplayLabel(doc.stage, doc.round_no)} ·{" "}
                        {memberNameById.get(doc.uploaded_by) ?? "팀원"} 제출 ·{" "}
                        {formatKstDateTime(doc.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <SignedFileLink documentId={doc.id} label={doc.original_filename} />
                      {doc.uploaded_by === session.userId && (
                        <form action={deleteDocumentAction}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="documentId" value={doc.id} />
                          <button type="submit" className="text-xs text-red-600 underline">
                            삭제
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  {doc.note && (
                    <p className="rounded-md bg-gray-50 p-3 text-xs whitespace-pre-wrap text-gray-600">
                      <span className="font-medium">내 메모 </span>
                      {doc.note}
                    </p>
                  )}

                  {ai ? (
                    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-indigo-700">AI 탐구 조력자</p>
                        <p className="text-xs text-indigo-600">
                          {formatKstDateTime(ai.updated_at)}
                        </p>
                      </div>
                      <FeedbackMarkdown className="text-indigo-950">{ai.body}</FeedbackMarkdown>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      {/* 제출 확정과 피드백 생성이 분리돼 있어, 방금 올린 산출물은 생성이
                          진행 중인 상태로 이 자리에 먼저 나타난다. 실패로 단정하지 않는다. */}
                      <p className="text-sm text-amber-900">
                        AI 피드백이 아직 없습니다. 생성 중이거나 실패했을 수 있어요. 잠시 뒤에도
                        보이지 않으면 아래 버튼을 눌러주세요.
                      </p>
                      <FeedbackActionButton
                        documentId={doc.id}
                        mode="draft"
                        label="AI 피드백 다시 받기"
                        pendingLabel="생성 중..."
                      />
                    </div>
                  )}

                  {teacher && (
                    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-blue-700">선생님 피드백</p>
                        <p className="text-xs text-blue-600">
                          {formatKstDateTime(teacher.updated_at)}
                        </p>
                      </div>
                      <FeedbackMarkdown className="text-blue-950">{teacher.body}</FeedbackMarkdown>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 삭제는 만든 학생(팀장)만 할 수 있다. 팀원에게는 아예 보이지 않는다. */}
      {isOwner && (
        <section className="space-y-2 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold text-gray-900">연구 과제 삭제</h2>
          {(allTeacherFeedbackCount ?? 0) > 0 ? (
            <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
              선생님 피드백이 달린 연구 과제는 삭제할 수 없습니다. 선생님이 남긴 지도 기록이
              함께 사라지기 때문입니다. 삭제가 필요하면 담당 선생님께 요청해주세요.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                제출한 산출물과 받은 피드백이 모두 함께 삭제되며 되돌릴 수 없습니다.
              </p>
              <DeleteProjectButton
                projectId={projectId}
                documentCount={documents?.length ?? 0}
                action={deleteProjectAction}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
