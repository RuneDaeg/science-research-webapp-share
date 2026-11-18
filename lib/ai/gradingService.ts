import { createAdminClient } from "@/lib/supabase/admin";
import { extractText } from "@/lib/extraction";
import { getServerCredential } from "./serverCredential";
import { classifyAiError, logAiUsage } from "./usage";
import { formatKstDate, formatKstDateOnly, kstDateOnlyToIso } from "@/lib/datetime";
import { documentDisplayLabel } from "@/lib/research/stage";
import type { DocumentStage } from "@/lib/types/db";
import {
  computeGradeSignature,
  computeOverallGradeSignature,
  gradeOverallWithAi,
  gradeWithAi,
  GradingError,
  type GradingFile,
  type OverallGradingFile,
} from "./grading";

// 채점을 시작할 수 없는 상태(채점기준 없음, 제출 파일 없음 등). AI를 부르기 전에 걸러지므로
// 호출 기록에 남기지 않는다.
export class GradingNotReadyError extends GradingError {}

// Gemini는 PDF를 파일당 50MB까지 받고, 함께 보내는 자료 전체가 문맥 창 안에 들어가야 한다.
// 제출 파일은 하나에 20MB까지라 여러 개가 쌓이면 넘을 수 있어 미리 막는다.
export const MAX_INLINE_PDF_BYTES = 50 * 1024 * 1024;

export interface GradeOutcome {
  status: "created" | "cached";
  totalScore: number | null;
  maxScore: number | null;
}

export async function loadFile(path: string, name: string): Promise<GradingFile> {
  const { data, error } = await createAdminClient().storage.from("research-files").download(path);
  if (error || !data) return { name, unreadable: "저장소에서 파일을 불러오지 못했습니다." };

  const buffer = Buffer.from(await data.arrayBuffer());
  // PDF는 AI가 원본을 그대로 본다(표·그래프·사진 포함). 나머지는 텍스트로 뽑아 보낸다.
  if (path.toLowerCase().endsWith(".pdf")) return { name, pdfBuffer: buffer };
  try {
    return { name, text: await extractText(buffer, name, "", { allowSparseText: true }) };
  } catch (err) {
    return { name, unreadable: err instanceof Error ? err.message : "텍스트를 뽑지 못했습니다." };
  }
}

// 제출물 하나를 채점한다. 교사가 실행한다 — 학생 일일 상한과 무관하다.
//
// force가 없으면 채점 근거(signature)가 같은 기존 결과를 그대로 돌려준다. '전체 채점'을 여러 번
// 눌러도 이미 채점한 학생에게 다시 비용을 쓰지 않기 위해서다. '다시 채점'은 force로 부른다.
export async function gradeSubmission(
  submissionId: string,
  opts: { force?: boolean } = {},
): Promise<GradeOutcome> {
  const cred = getServerCredential();
  const admin = createAdminClient();

  const { data: submission } = await admin
    .from("assignment_submissions")
    .select("id, assignment_id, note")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission) throw new GradingNotReadyError("제출물을 찾을 수 없습니다.");

  const { data: assignment } = await admin
    .from("class_assignments")
    .select("id, class_id, title, body, rubric_path, rubric_filename")
    .eq("id", submission.assignment_id)
    .maybeSingle();
  if (!assignment) throw new GradingNotReadyError("과제를 찾을 수 없습니다.");
  if (!assignment.rubric_path) {
    throw new GradingNotReadyError("채점기준 파일을 먼저 올려주세요.");
  }

  const { data: files } = await admin
    .from("assignment_submission_files")
    .select("file_path, original_filename")
    .eq("submission_id", submissionId)
    .order("uploaded_at", { ascending: true });
  if (!files || files.length === 0) throw new GradingNotReadyError("제출한 파일이 없습니다.");

  const signature = computeGradeSignature({
    assignmentTitle: assignment.title,
    assignmentBody: assignment.body,
    rubricPath: assignment.rubric_path,
    filePaths: files.map((f) => f.file_path),
    studentNote: submission.note,
  });

  if (!opts.force) {
    const { data: existing } = await admin
      .from("assignment_ai_grades")
      .select("signature, total_score, max_score")
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (existing?.signature === signature) {
      return { status: "cached", totalScore: existing.total_score, maxScore: existing.max_score };
    }
  }

  const rubric = await loadFile(assignment.rubric_path, assignment.rubric_filename ?? "채점기준");
  if (rubric.unreadable) {
    throw new GradingNotReadyError(`채점기준 파일을 읽지 못했습니다: ${rubric.unreadable}`);
  }
  const submissions = await Promise.all(
    files.map((f) => loadFile(f.file_path, f.original_filename)),
  );

  const pdfBytes = [rubric, ...submissions].reduce((n, f) => n + (f.pdfBuffer?.length ?? 0), 0);
  if (pdfBytes > MAX_INLINE_PDF_BYTES) {
    throw new GradingNotReadyError(
      "파일이 너무 커서 AI 채점을 할 수 없습니다(PDF 합계 50MB 초과). 직접 채점해 주세요.",
    );
  }

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await gradeWithAi(cred, {
      assignmentTitle: assignment.title,
      assignmentBody: assignment.body,
      studentNote: submission.note,
      rubric,
      submissions,
    });
  } catch (err) {
    await logAiUsage({
      studentId: null,
      classId: assignment.class_id,
      documentId: null,
      kind: "grade",
      cred,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorKind: classifyAiError(err),
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;

  const { error } = await admin.from("assignment_ai_grades").upsert(
    {
      submission_id: submissionId,
      result: outcome.result,
      total_score: outcome.totalScore,
      max_score: outcome.maxScore,
      student_feedback: outcome.result.student_feedback,
      // 다시 채점하면 공개를 거둔다. 교사가 새 피드백을 읽기 전에 학생에게 나가면 안 된다.
      released: false,
      provider: cred.provider,
      model: outcome.model,
      signature,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "submission_id" },
  );
  if (error) throw new GradingError("채점 결과 저장에 실패했습니다.");

  await logAiUsage({
    studentId: null,
    classId: assignment.class_id,
    documentId: null,
    kind: "grade",
    cred: { ...cred, model: outcome.model },
    durationMs,
  });

  return { status: "created", totalScore: outcome.totalScore, maxScore: outcome.maxScore };
}

// ============================================================
// 수행평가 종합 채점
// ============================================================

export interface OverallGradeOutcome {
  status: "created" | "cached";
}

export interface CollectedFile {
  path: string;
  label: string;
  sortKey: string;
  // 연구 산출물이면 그 연구의 제목. 세특 초안에 연구 제목이 그대로 들어갔는지 검사하는 데 쓴다.
  projectTitle?: string;
  // docx·hwpx·txt 산출물은 올릴 때 뽑아 둔 본문이 있다. 있으면 파일을 다시 내려받지 않는다.
  extractedText?: string | null;
  name: string;
}

// 학생 한 명이 이 클래스에서 낸 파일을 모두 모은다 — 참여한 연구의 산출물(팀원이 올린 것 포함),
// 이 클래스 과제에 낸 파일, 학생이 따로 보내 선생님이 올려 둔 파일(0014). 교사 화면(학생별 모아
// 보기)과 클래스 화면 명단 배지가 같은 범위로 signature를 만든다 — 한 곳만 바꾸지 말 것(AGENTS.md).
export async function collectStudentClassFiles(
  classId: string,
  studentId: string,
): Promise<CollectedFile[]> {
  const admin = createAdminClient();
  const files: CollectedFile[] = [];

  const { data: memberships } = await admin
    .from("project_members")
    .select("project_id")
    .eq("student_id", studentId);
  const memberProjectIds = (memberships ?? []).map((m) => m.project_id);

  const { data: projects } = memberProjectIds.length
    ? await admin
        .from("research_projects")
        .select("id, title")
        .eq("class_id", classId)
        .in("id", memberProjectIds)
    : { data: [] as Array<{ id: string; title: string }> };
  const projectTitle = new Map((projects ?? []).map((p) => [p.id, p.title]));

  if (projectTitle.size > 0) {
    const { data: docs } = await admin
      .from("research_documents")
      .select("project_id, uploaded_by, stage, title, round_no, file_path, original_filename, extracted_text, created_at")
      .in("project_id", [...projectTitle.keys()]);
    for (const d of docs ?? []) {
      const stageLabel = documentDisplayLabel(d.stage as DocumentStage, d.round_no);
      const title = d.title.trim() && d.title.trim() !== stageLabel ? ` · ${d.title.trim()}` : "";
      const byTeammate = d.uploaded_by !== studentId ? " · 팀원이 올림" : "";
      files.push({
        path: d.file_path,
        name: d.original_filename,
        extractedText: d.extracted_text,
        sortKey: d.created_at,
        projectTitle: projectTitle.get(d.project_id),
        label: `연구 '${projectTitle.get(d.project_id)}' · ${stageLabel}${title} · ${formatKstDate(d.created_at)} 제출${byTeammate}`,
      });
    }
  }

  const { data: assignments } = await admin
    .from("class_assignments")
    .select("id, title")
    .eq("class_id", classId);
  const assignmentTitle = new Map((assignments ?? []).map((a) => [a.id, a.title]));

  const { data: submissions } = assignmentTitle.size
    ? await admin
        .from("assignment_submissions")
        .select("id, assignment_id")
        .eq("student_id", studentId)
        .in("assignment_id", [...assignmentTitle.keys()])
    : { data: [] as Array<{ id: string; assignment_id: string }> };
  const assignmentOfSubmission = new Map((submissions ?? []).map((s) => [s.id, s.assignment_id]));

  if (assignmentOfSubmission.size > 0) {
    const { data: subFiles } = await admin
      .from("assignment_submission_files")
      .select("submission_id, file_path, original_filename, uploaded_at")
      .in("submission_id", [...assignmentOfSubmission.keys()]);
    for (const f of subFiles ?? []) {
      const title = assignmentTitle.get(assignmentOfSubmission.get(f.submission_id) ?? "") ?? "과제";
      files.push({
        path: f.file_path,
        name: f.original_filename,
        sortKey: f.uploaded_at,
        label: `과제 '${title}' 제출 · ${f.original_filename} · ${formatKstDate(f.uploaded_at)} 제출`,
      });
    }
  }

  // 따로 받은 자료는 올린 날이 아니라 선생님이 받은 날을 쓴다. 9월에 받은 계획서를 12월에 올려도
  // AI가 평가 시기를 맞게 짝짓도록 하기 위해서다.
  const { data: received } = await admin
    .from("student_received_files")
    .select("file_path, original_filename, note, received_on")
    .eq("class_id", classId)
    .eq("student_id", studentId);
  for (const r of received ?? []) {
    const note = r.note?.trim() ? ` · ${r.note.trim()}` : "";
    files.push({
      path: r.file_path,
      name: r.original_filename,
      sortKey: kstDateOnlyToIso(r.received_on),
      label: `학생이 선생님께 따로 보낸 파일${note} · ${r.original_filename} · ${formatKstDateOnly(r.received_on)} 받음`,
    });
  }

  // 낸 순서대로 놓는다. AI가 평가 시기와 제출일을 맞춰 보며 파일을 수행평가에 짝짓는다.
  return files.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

// 학생 한 명의 파일 전체를 클래스의 평가 계획서로 채점한다. 교사가 실행한다 — 학생 일일 상한과 무관하다.
// force가 없으면 채점 근거(signature)가 같은 기존 결과를 그대로 돌려준다(전체 채점을 여러 번 눌러도
// 이미 채점한 학생에게 다시 비용을 쓰지 않는다).
export async function gradeStudentOverall(
  classId: string,
  studentId: string,
  opts: { force?: boolean } = {},
): Promise<OverallGradeOutcome> {
  const cred = getServerCredential();
  const admin = createAdminClient();

  const { data: cls } = await admin
    .from("classes")
    .select("id, rubric_path, rubric_filename")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) throw new GradingNotReadyError("클래스를 찾을 수 없습니다.");
  if (!cls.rubric_path) throw new GradingNotReadyError("평가 계획서 파일을 먼저 올려주세요.");

  const { data: enrollment } = await admin
    .from("class_enrollments")
    .select("id")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!enrollment) throw new GradingNotReadyError("이 클래스 학생이 아닙니다.");

  const collected = await collectStudentClassFiles(classId, studentId);
  if (collected.length === 0) throw new GradingNotReadyError("이 학생이 낸 파일이 없습니다.");

  const signature = computeOverallGradeSignature({
    rubricPath: cls.rubric_path,
    filePaths: collected.map((f) => f.path),
  });

  if (!opts.force) {
    const { data: existing } = await admin
      .from("student_overall_grades")
      .select("signature")
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (existing?.signature === signature) return { status: "cached" };
  }

  const rubric = await loadFile(cls.rubric_path, cls.rubric_filename ?? "평가 계획서");
  if (rubric.unreadable) {
    throw new GradingNotReadyError(`평가 계획서 파일을 읽지 못했습니다: ${rubric.unreadable}`);
  }

  const files: OverallGradingFile[] = await Promise.all(
    collected.map(async (f) => {
      const isPdf = f.path.toLowerCase().endsWith(".pdf");
      const loaded =
        !isPdf && f.extractedText?.trim()
          ? { name: f.name, text: f.extractedText }
          : await loadFile(f.path, f.name);
      return { ...loaded, label: f.label };
    }),
  );

  const pdfBytes = [rubric, ...files].reduce((n, f) => n + (f.pdfBuffer?.length ?? 0), 0);
  if (pdfBytes > MAX_INLINE_PDF_BYTES) {
    throw new GradingNotReadyError(
      "이 학생의 파일이 너무 많거나 커서 한 번에 채점할 수 없습니다(PDF 합계 50MB 초과). 과제별 채점을 이용해 주세요.",
    );
  }

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await gradeOverallWithAi(cred, { rubric, files });
  } catch (err) {
    await logAiUsage({
      studentId: null,
      classId,
      documentId: null,
      kind: "grade",
      cred,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorKind: classifyAiError(err),
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;

  const { error } = await admin.from("student_overall_grades").upsert(
    {
      class_id: classId,
      student_id: studentId,
      result: outcome.result,
      provider: cred.provider,
      model: outcome.model,
      signature,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "class_id,student_id" },
  );
  if (error) throw new GradingError("채점 결과 저장에 실패했습니다.");

  await logAiUsage({
    studentId: null,
    classId,
    documentId: null,
    kind: "grade",
    cred: { ...cred, model: outcome.model },
    durationMs,
  });

  return { status: "created" };
}
