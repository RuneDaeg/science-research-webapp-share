"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProjectStatus, isResearchField } from "@/lib/research/stage";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// 연구 과제 생성. 만든 학생이 자동으로 팀장(leader)으로 등록된다.
// 개인 연구는 팀원이 본인 1명뿐인 팀으로 취급하므로 별도 분기가 필요 없다.
export async function createProjectAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole("student");

  const classId = String(formData.get("classId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const field = String(formData.get("field") ?? "");
  const researchQuestion = String(formData.get("researchQuestion") ?? "").trim();

  if (!classId) return { ok: false, error: "클래스를 선택해주세요." };
  if (!title) return { ok: false, error: "연구 제목을 입력해주세요." };
  if (!isResearchField(field)) return { ok: false, error: "탐구 분야를 선택해주세요." };

  const supabase = await createClient();

  // RLS(research_projects_insert)가 본인이 등록된 클래스인지까지 검증한다
  const { data: project, error } = await supabase
    .from("research_projects")
    .insert({
      class_id: classId,
      owner_id: session.userId,
      title,
      field,
      research_question: researchQuestion || null,
    })
    .select("id")
    .single();

  if (error || !project) {
    return { ok: false, error: "연구 과제 생성에 실패했습니다. 참여한 클래스인지 확인해주세요." };
  }

  const { error: memberError } = await supabase
    .from("project_members")
    .insert({ project_id: project.id, student_id: session.userId, role_in_team: "leader" });

  if (memberError) {
    // 팀장 등록에 실패하면 본인조차 접근할 수 없는 과제가 남으므로 되돌린다.
    await createAdminClient().from("research_projects").delete().eq("id", project.id);
    return { ok: false, error: "팀 정보 저장에 실패했습니다. 다시 시도해주세요." };
  }

  revalidatePath("/student/dashboard");
  redirect(`/student/projects/${project.id}`);
}

// 팀원 추가 — 같은 클래스에 참여한 학생만 추가할 수 있다(RLS + 아래 검증).
export async function addTeamMemberAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("student");

  const projectId = String(formData.get("projectId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  if (!projectId || !studentId) return { ok: false, error: "팀원을 선택해주세요." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .insert({ project_id: projectId, student_id: studentId, role_in_team: "member" });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "이미 팀에 있는 학생입니다." };
    return { ok: false, error: "팀원 추가에 실패했습니다. 팀장만 추가할 수 있습니다." };
  }

  revalidatePath(`/student/projects/${projectId}`);
  return { ok: true };
}

export async function removeTeamMemberAction(formData: FormData): Promise<void> {
  await requireRole("student");

  const projectId = String(formData.get("projectId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  if (!projectId || !memberId) return;

  const supabase = await createClient();
  // RLS(project_members_delete): 팀장만 삭제할 수 있다
  await supabase.from("project_members").delete().eq("id", memberId);

  revalidatePath(`/student/projects/${projectId}`);
}

export async function updateProjectStatusAction(formData: FormData): Promise<void> {
  await requireRole("student");

  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!projectId || !isProjectStatus(status)) return;

  const supabase = await createClient();
  await supabase
    .from("research_projects")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  revalidatePath(`/student/projects/${projectId}`);
}

// 산출물 삭제 — 올린 본인만 가능(RLS). Storage 파일도 함께 정리한다.
export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const session = await requireRole("student");

  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return;

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("research_documents")
    .select("file_path, uploaded_by")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc || doc.uploaded_by !== session.userId) return;

  const { error } = await supabase.from("research_documents").delete().eq("id", documentId);
  if (!error) {
    await supabase.storage.from("research-files").remove([doc.file_path]);
  }

  revalidatePath(`/student/projects/${projectId}`);
}

// 연구 과제 삭제 — 만든 학생(소유자)만 할 수 있다.
//
// DB는 캐스케이드로 팀원·산출물·AI 피드백·선생님 피드백까지 함께 지우지만,
// **Storage에 올라간 파일은 캐스케이드 대상이 아니다.** 먼저 경로를 모아두었다가
// 삭제 후 지운다. 안 그러면 DB에 기록 없는 고아 파일이 남아 용량만 차지한다.
// (관리자 화면의 저장공간 사용량이 이런 파일을 '고아 파일'로 잡아낸다.)
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const session = await requireRole("student");

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const supabase = await createClient();

  // RLS: 팀원이면 조회된다. 삭제는 소유자만 가능하므로 여기서 소유자인지 직접 확인한다
  // (RLS의 delete 정책도 owner_id = auth.uid()이지만, 팀원이 눌렀을 때 조용히
  //  아무 일도 안 일어나는 대신 여기서 먼저 걸러 의도를 분명히 한다).
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.owner_id !== session.userId) return;

  // 선생님 피드백이 하나라도 달렸으면 학생은 지울 수 없다 — 지도 기록까지 함께 사라지기
  // 때문이다. 비공개 메모도 포함해야 하므로 service-role로 센다(학생 RLS로는 공개된
  // 피드백만 보인다). 같은 규칙이 RLS에도 걸려 있다(0007).
  const { count: teacherFeedbackCount } = await createAdminClient()
    .from("teacher_feedbacks")
    .select("id, research_documents!inner(project_id)", { count: "exact", head: true })
    .eq("research_documents.project_id", projectId);

  if ((teacherFeedbackCount ?? 0) > 0) return;

  const { data: docs } = await supabase
    .from("research_documents")
    .select("file_path")
    .eq("project_id", projectId);

  const { error } = await supabase.from("research_projects").delete().eq("id", projectId);
  if (error) return;

  const paths = (docs ?? []).map((d) => d.file_path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from("research-files").remove(paths);
  }

  revalidatePath("/student/dashboard");
  redirect("/student/dashboard");
}

// 과제 제출 파일 한 개를 지운다.
//
// 마지막 파일을 지우면 제출물 행도 함께 지운다 — 파일 0개짜리 제출물이 남으면 목록에
// '제출 완료'로 표시되는데 실제로는 낸 것이 없는 상태가 된다.
export async function deleteSubmissionFileAction(formData: FormData): Promise<void> {
  const session = await requireRole("student");

  const fileId = String(formData.get("fileId") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!fileId) return;

  const supabase = await createClient();

  // RLS: 본인 제출물이거나 담당 교사인 파일만 조회된다. 학생 경로이므로 소유도 직접 확인한다.
  const { data: file } = await supabase
    .from("assignment_submission_files")
    .select("id, file_path, submission_id, assignment_submissions!inner(student_id)")
    .eq("id", fileId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        file_path: string;
        submission_id: string;
        assignment_submissions: { student_id: string };
      },
      { merge: false }
    >();

  if (!file || file.assignment_submissions.student_id !== session.userId) return;

  const { error } = await supabase
    .from("assignment_submission_files")
    .delete()
    .eq("id", fileId);
  if (error) return;

  await supabase.storage.from("research-files").remove([file.file_path]);

  const { count } = await supabase
    .from("assignment_submission_files")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", file.submission_id);

  if ((count ?? 0) === 0) {
    await supabase.from("assignment_submissions").delete().eq("id", file.submission_id);
  }

  revalidatePath(`/student/assignments/${assignmentId}`);
}
