import { createAdminClient } from "@/lib/supabase/admin";
import { extractText } from "@/lib/extraction";
import { getServerCredential } from "./serverCredential";
import { classifyAiError, logAiUsage } from "./usage";
import { computeGradeSignature, gradeWithAi, GradingError, type GradingFile } from "./grading";

// 채점을 시작할 수 없는 상태(채점기준 없음, 제출 파일 없음 등). AI를 부르기 전에 걸러지므로
// 호출 기록에 남기지 않는다.
export class GradingNotReadyError extends GradingError {}

// Gemini는 PDF를 파일당 50MB까지 받고, 함께 보내는 자료 전체가 문맥 창 안에 들어가야 한다.
// 제출 파일은 하나에 20MB까지라 여러 개가 쌓이면 넘을 수 있어 미리 막는다.
const MAX_INLINE_PDF_BYTES = 50 * 1024 * 1024;

export interface GradeOutcome {
  status: "created" | "cached";
  totalScore: number | null;
  maxScore: number | null;
}

async function loadFile(path: string, name: string): Promise<GradingFile> {
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
