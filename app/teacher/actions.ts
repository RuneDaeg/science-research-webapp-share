"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJoinCode } from "@/lib/joinCode";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createClassAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole("teacher");

  const name = String(formData.get("name") ?? "").trim();
  const schoolYear = String(formData.get("schoolYear") ?? "").trim();
  if (!name) return { ok: false, error: "클래스 이름을 입력해주세요." };

  const supabase = await createClient();

  // join_code는 unique — 드물게 충돌하면 몇 번 더 시도한다
  let classId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("classes")
      .insert({
        teacher_id: session.userId,
        name,
        school_year: schoolYear || null,
        join_code: generateJoinCode(),
      })
      .select("id")
      .single();

    if (data) {
      classId = data.id;
      break;
    }
    if (error && error.code !== "23505") {
      return { ok: false, error: "클래스 생성에 실패했습니다." };
    }
  }

  if (!classId) return { ok: false, error: "참여 코드 생성에 실패했습니다. 다시 시도해주세요." };

  revalidatePath("/teacher/dashboard");
  redirect(`/teacher/classes/${classId}`);
}

export async function createAnnouncementAction(formData: FormData): Promise<void> {
  const session = await requireRole("teacher");

  const classId = String(formData.get("classId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!classId || !body) return;

  const supabase = await createClient();
  await supabase
    .from("class_announcements")
    .insert({ class_id: classId, teacher_id: session.userId, body });

  revalidatePath(`/teacher/classes/${classId}`);
}

export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
  await requireRole("teacher");

  const classId = String(formData.get("classId") ?? "");
  const announcementId = String(formData.get("announcementId") ?? "");
  if (!announcementId) return;

  const supabase = await createClient();
  await supabase.from("class_announcements").delete().eq("id", announcementId);

  revalidatePath(`/teacher/classes/${classId}`);
}

// 산출물별 교사 피드백 저장 (문서당 1건 — 다시 저장하면 수정된다).
export async function saveTeacherFeedbackAction(formData: FormData): Promise<void> {
  const session = await requireRole("teacher");

  const documentId = String(formData.get("documentId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const visibleToStudent = formData.get("visibleToStudent") === "on";
  if (!documentId || !body) return;

  const supabase = await createClient();

  // RLS(teacher_feedbacks_insert/update): 담당 교사만 쓸 수 있다
  await supabase.from("teacher_feedbacks").upsert(
    {
      document_id: documentId,
      teacher_id: session.userId,
      body,
      visible_to_student: visibleToStudent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "document_id" },
  );

  revalidatePath(`/teacher/projects/${projectId}`);
}

// 담당 선생님이 학생 연구 과제를 삭제한다 — 잘못 만들어진 과제 정리용.
//
// 학생 삭제와 달리 선생님 피드백이 있어도 막지 않는다. 지도 기록을 지울지 판단하는 주체가
// 선생님 본인이기 때문이다.
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const session = await requireRole("teacher");

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const supabase = await createClient();

  // RLS: 담당 클래스의 과제만 조회된다. class_id로 담당 여부를 한 번 더 확인한다.
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, class_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return;

  const { data: cls } = await supabase
    .from("classes")
    .select("id")
    .eq("id", project.class_id)
    .eq("teacher_id", session.userId)
    .maybeSingle();

  if (!cls) return;

  const { data: docs } = await supabase
    .from("research_documents")
    .select("file_path")
    .eq("project_id", projectId);

  const { error } = await supabase.from("research_projects").delete().eq("id", projectId);
  if (error) return;

  // [주의] Storage 정책(research_files_owner_all)은 업로더 본인 폴더만 허용한다.
  // 선생님 세션으로는 학생이 올린 파일을 지울 수 없으므로 service-role로 지운다.
  // 안 지우면 DB 기록 없는 고아 파일이 남는다.
  const paths = (docs ?? []).map((d) => d.file_path).filter(Boolean);
  if (paths.length > 0) {
    await createAdminClient().storage.from("research-files").remove(paths);
  }

  revalidatePath("/teacher/dashboard");
  redirect("/teacher/dashboard");
}

// 과제/평가 글 등록. 학생은 이 글에 파일을 제출한다.
export async function createAssignmentAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole("teacher");

  const classId = String(formData.get("classId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const bodyText = String(formData.get("body") ?? "").trim();
  const dueLocal = String(formData.get("dueAt") ?? "").trim();

  if (!classId) return { ok: false, error: "클래스를 찾을 수 없습니다." };
  if (!title) return { ok: false, error: "과제 제목을 입력해주세요." };

  // datetime-local은 타임존 없는 문자열("2026-09-30T23:59")로 온다. 학생도 교사도 한국에
  // 있으므로 KST로 해석해 UTC로 저장한다. 그대로 new Date()에 넣으면 서버(UTC) 기준으로
  // 읽혀 9시간 어긋난다.
  let dueAt: string | null = null;
  if (dueLocal) {
    const parsed = new Date(`${dueLocal}:00+09:00`);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "마감 일시 형식이 올바르지 않습니다." };
    }
    dueAt = parsed.toISOString();
  }

  const supabase = await createClient();

  // RLS: 본인 클래스에만 등록된다
  const { error } = await supabase.from("class_assignments").insert({
    class_id: classId,
    teacher_id: session.userId,
    title,
    body: bodyText || null,
    due_at: dueAt,
  });

  if (error) return { ok: false, error: "과제 등록에 실패했습니다." };

  revalidatePath(`/teacher/classes/${classId}`);
  return { ok: true };
}

// 과제 삭제. 학생 제출물도 함께 사라진다(캐스케이드) — Storage 파일은 캐스케이드 대상이
// 아니므로 경로를 미리 모아 직접 지운다.
//
// [주의] Storage 정책(research_files_owner_all)은 업로더 본인 폴더만 허용한다. 교사 세션으로는
// 학생이 올린 파일을 지울 수 없어 service-role을 쓴다.
export async function deleteAssignmentAction(formData: FormData): Promise<void> {
  await requireRole("teacher");

  const assignmentId = String(formData.get("assignmentId") ?? "");
  const classId = String(formData.get("classId") ?? "");
  if (!assignmentId) return;

  const supabase = await createClient();

  // RLS: 담당 클래스의 과제만 조회·삭제된다
  const { data: assignment } = await supabase
    .from("class_assignments")
    .select("id, rubric_path")
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment) return;

  // 파일은 assignment_submission_files에 달려 있다(0009). 제출물 → 파일 순으로 모은다.
  const { data: submissionRows } = await supabase
    .from("assignment_submissions")
    .select("id")
    .eq("assignment_id", assignmentId);

  const submissionIds = (submissionRows ?? []).map((s) => s.id);
  const { data: submissions } = submissionIds.length
    ? await supabase
        .from("assignment_submission_files")
        .select("file_path")
        .in("submission_id", submissionIds)
    : { data: [] as Array<{ file_path: string }> };

  const { error } = await supabase.from("class_assignments").delete().eq("id", assignmentId);
  if (error) return;

  // 채점기준 파일(0011)도 함께 지운다. 과제 행이 사라지면 경로를 다시 찾을 길이 없다.
  const paths = [
    ...(submissions ?? []).map((s) => s.file_path),
    ...(assignment.rubric_path ? [assignment.rubric_path] : []),
  ].filter(Boolean);
  if (paths.length > 0) {
    await createAdminClient().storage.from("research-files").remove(paths);
  }

  revalidatePath(`/teacher/classes/${classId}`);
  redirect(`/teacher/classes/${classId}`);
}

// AI 채점 피드백을 학생에게 공개하거나 거둔다. 점수는 어느 쪽이든 학생에게 보이지 않는다
// (학생은 student_assignment_feedbacks 뷰로 피드백 문장만 읽는다).
export async function setGradeReleasedAction(formData: FormData): Promise<void> {
  await requireRole("teacher");

  const submissionId = String(formData.get("submissionId") ?? "");
  const released = formData.get("released") === "true";
  const revalidate = String(formData.get("revalidate") ?? "");
  if (!submissionId) return;

  // RLS: 담당 과제의 채점 결과만 바뀐다(assignment_ai_grades_update_teacher)
  const supabase = await createClient();
  await supabase.from("assignment_ai_grades").update({ released }).eq("submission_id", submissionId);

  // 폼이 보낸 경로는 다시 그리는 데만 쓴다. 교사 화면 경로가 아니면 무시한다.
  if (revalidate.startsWith("/teacher/")) revalidatePath(revalidate);
}
