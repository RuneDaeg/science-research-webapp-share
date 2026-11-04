import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { SignedFileLink } from "@/components/SignedFileLink";
import { TeacherFeedbackForm } from "@/components/TeacherFeedbackForm";
import { FeedbackActionButton } from "@/components/FeedbackActionButton";
import FeedbackMarkdown from "@/components/FeedbackMarkdown";
import { LatexHelp } from "@/components/LatexHelp";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { deleteProjectAction } from "@/app/teacher/actions";
import { formatKstDateTime } from "@/lib/datetime";
import { FIELD_LABEL, STATUS_LABEL, documentDisplayLabel } from "@/lib/research/stage";
import type { DocumentStage, ProjectStatus, ResearchField, TeamRole } from "@/lib/types/db";

function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  return (
    <span
      title={`AI 자기평가 완성도 ${rating}/5 — 선생님에게만 보입니다`}
      className="text-xs font-medium text-indigo-700"
    >
      {"★".repeat(rating)}
      {"☆".repeat(Math.max(0, 5 - rating))}
    </span>
  );
}

export default async function TeacherProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("teacher");
  const { id: projectId } = await params;
  const supabase = await createClient();

  // RLS: 담당 클래스의 과제만 조회된다 — 조회되면 접근 권한이 검증된 것
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, class_id, title, field, research_question, status, classes(name)")
    .eq("id", projectId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        class_id: string;
        title: string;
        field: ResearchField;
        research_question: string | null;
        status: ProjectStatus;
        classes: { name: string } | null;
      },
      { merge: false }
    >();

  if (!project) notFound();

  const { data: members } = await supabase
    .from("project_members")
    .select("student_id, role_in_team, profiles(display_name)")
    .eq("project_id", projectId)
    .order("joined_at", { ascending: true })
    .overrideTypes<
      Array<{
        student_id: string;
        role_in_team: TeamRole;
        profiles: { display_name: string } | null;
      }>,
      { merge: false }
    >();

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

  // 교사는 ai_feedbacks를 직접 읽는다 — rating(자기평가 별점)은 교사 전용 지표다.
  const { data: aiFeedbacks } = docIds.length
    ? await supabase
        .from("ai_feedbacks")
        .select("document_id, body, rating, verified, model, updated_at")
        .in("document_id", docIds)
    : { data: [] as Array<{
        document_id: string;
        body: string;
        rating: number | null;
        verified: boolean;
        model: string;
        updated_at: string;
      }> };

  const { data: teacherFeedbacks } = docIds.length
    ? await supabase
        .from("teacher_feedbacks")
        .select("document_id, body, visible_to_student, updated_at")
        .in("document_id", docIds)
    : { data: [] as Array<{
        document_id: string;
        body: string;
        visible_to_student: boolean;
        updated_at: string;
      }> };

  const aiByDoc = new Map((aiFeedbacks ?? []).map((f) => [f.document_id, f]));
  const teacherByDoc = new Map((teacherFeedbacks ?? []).map((f) => [f.document_id, f]));
  const memberNameById = new Map(
    (members ?? []).map((m) => [m.student_id, m.profiles?.display_name?.trim() || "(이름 없음)"]),
  );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href={`/teacher/classes/${project.class_id}`}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← {project.classes?.name ?? "클래스"}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
        <p className="text-sm text-gray-500">
          {FIELD_LABEL[project.field]} · {STATUS_LABEL[project.status]} · 팀원{" "}
          {(members ?? []).map((m) => m.profiles?.display_name?.trim() || "(이름 없음)").join(", ")}
        </p>
        {project.research_question && (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm whitespace-pre-wrap text-gray-700">
            <span className="font-medium text-gray-900">연구 질문 </span>
            {project.research_question}
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          산출물 {documents?.length ? `(${documents.length})` : ""}
        </h2>

        {!documents || documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            아직 제출된 산출물이 없습니다.
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
                        {memberNameById.get(doc.uploaded_by) ?? "학생"} 제출 ·{" "}
                        {formatKstDateTime(doc.created_at)}
                      </p>
                    </div>
                    <SignedFileLink documentId={doc.id} label={doc.original_filename} />
                  </div>

                  {doc.note && (
                    <p className="rounded-md bg-gray-50 p-3 text-xs whitespace-pre-wrap text-gray-600">
                      <span className="font-medium">학생 메모 </span>
                      {doc.note}
                    </p>
                  )}

                  {ai ? (
                    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-indigo-700">AI 탐구 조력자</p>
                          <RatingStars rating={ai.rating} />
                          {ai.verified && (
                            <span className="rounded-full bg-indigo-200 px-2 py-0.5 text-xs font-medium text-indigo-900">
                              2단계 검증됨
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-indigo-600">
                          {ai.model} · {formatKstDateTime(ai.updated_at)}
                        </p>
                      </div>
                      <FeedbackMarkdown className="text-indigo-950">{ai.body}</FeedbackMarkdown>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <FeedbackActionButton
                          documentId={doc.id}
                          mode="verify"
                          label="2단계 검증 재실행"
                          pendingLabel="검증 중..."
                          variant="secondary"
                        />
                      </div>
                      <p className="text-xs text-indigo-600">
                        별점은 AI가 스스로 매긴 완성도 점수이며 학생에게는 보이지 않습니다. 낮으면
                        2단계 검증으로 사실관계를 다시 확인해보세요.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm text-amber-900">
                        AI 피드백이 아직 생성되지 않았습니다.
                      </p>
                      <FeedbackActionButton
                        documentId={doc.id}
                        mode="draft"
                        label="AI 피드백 생성"
                        pendingLabel="생성 중..."
                      />
                    </div>
                  )}

                  <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    {teacher && (
                      <p className="text-xs text-blue-600">
                        최종 수정 {formatKstDateTime(teacher.updated_at)} ·{" "}
                        {teacher.visible_to_student ? "학생에게 공개됨" : "비공개 (나만 보기)"}
                      </p>
                    )}
                    <TeacherFeedbackForm
                      documentId={doc.id}
                      projectId={projectId}
                      initialBody={teacher?.body ?? null}
                      initialVisible={teacher?.visible_to_student ?? true}
                    />
                    <LatexHelp />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 담당 선생님은 학생 피드백이 달려 있어도 지울 수 있다 — 판단 주체가 선생님이다. */}
      <section className="space-y-2 border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold text-gray-900">연구 과제 삭제</h2>
        <p className="text-xs text-gray-500">
          학생이 제출한 산출물과 피드백이 모두 함께 삭제되며 되돌릴 수 없습니다.
        </p>
        <DeleteProjectButton
          projectId={projectId}
          documentCount={documents?.length ?? 0}
          action={deleteProjectAction}
          extraWarning="학생에게는 별도 안내가 가지 않으니 미리 알려주세요."
        />
      </section>
    </div>
  );
}
