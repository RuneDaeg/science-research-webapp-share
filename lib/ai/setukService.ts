import { createAdminClient } from "@/lib/supabase/admin";
import { getServerCredential } from "./serverCredential";
import { classifyAiError, logAiUsage } from "./usage";
import {
  collectStudentClassFiles,
  GradingNotReadyError,
  loadFile,
  MAX_INLINE_PDF_BYTES,
} from "./gradingService";
import { GradingError, type GradingFile, type OverallGradingFile } from "./grading";
import { computeSetukSignature, draftSetukWithAi } from "./setuk";

// 교사 관찰 메모는 짧은 메모를 받는다. 길게 받으면 프롬프트가 메모에 끌려가고 비용도 는다.
export const SETUK_MEMO_MAX = 1000;

export interface SetukOutcome {
  status: "created" | "cached" | "memo-saved";
}

// 세특 참고 초안을 만든다(또는 메모만 저장한다). 교사가 실행한다 — 학생 일일 상한과 무관하다.
//
// memo가 문자열이면 먼저 저장한다(빈 문자열이면 메모를 지운다). undefined면 저장된 메모를 쓴다 —
// 반 전체 일괄 생성은 메모를 보내지 않고 학생마다 저장해 둔 것을 쓴다.
// force가 없으면 근거(signature)가 같은 기존 초안을 그대로 둔다.
export async function draftStudentSetuk(
  classId: string,
  studentId: string,
  opts: { memo?: string; force?: boolean; memoOnly?: boolean } = {},
): Promise<SetukOutcome> {
  const admin = createAdminClient();

  const { data: enrollment } = await admin
    .from("class_enrollments")
    .select("id, profiles(display_name)")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle()
    .overrideTypes<{ id: string; profiles: { display_name: string } | null }, { merge: false }>();
  if (!enrollment) throw new GradingNotReadyError("이 클래스 학생이 아닙니다.");

  const { data: existing } = await admin
    .from("student_setuk_drafts")
    .select("teacher_memo, signature")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle();

  let memo = existing?.teacher_memo ?? null;
  if (typeof opts.memo === "string") {
    const trimmed = opts.memo.trim();
    if (trimmed.length > SETUK_MEMO_MAX) {
      throw new GradingNotReadyError(`관찰 메모는 ${SETUK_MEMO_MAX}자까지 적을 수 있습니다.`);
    }
    memo = trimmed || null;
    const { error } = await admin.from("student_setuk_drafts").upsert(
      { class_id: classId, student_id: studentId, teacher_memo: memo, updated_at: new Date().toISOString() },
      { onConflict: "class_id,student_id" },
    );
    if (error) throw new GradingError("관찰 메모 저장에 실패했습니다.");
    if (opts.memoOnly) return { status: "memo-saved" };
  }

  const { data: cls } = await admin
    .from("classes")
    .select("rubric_path, rubric_filename")
    .eq("id", classId)
    .maybeSingle();

  const collected = await collectStudentClassFiles(classId, studentId);
  if (collected.length === 0 && !memo) {
    throw new GradingNotReadyError("이 학생이 낸 파일도, 관찰 메모도 없어 초안을 만들 수 없습니다.");
  }

  const signature = computeSetukSignature({
    rubricPath: cls?.rubric_path ?? null,
    filePaths: collected.map((f) => f.path),
    teacherMemo: memo,
  });
  if (!opts.force && existing?.signature === signature) return { status: "cached" };

  const cred = getServerCredential();

  let rubric: GradingFile | null = null;
  if (cls?.rubric_path) {
    const loaded = await loadFile(cls.rubric_path, cls.rubric_filename ?? "평가 계획서");
    // 평가 계획서는 표현을 빌리는 참고 자료라, 못 읽어도 초안은 만든다.
    rubric = loaded.unreadable ? null : loaded;
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

  const pdfBytes = [rubric, ...files].reduce((n, f) => n + (f?.pdfBuffer?.length ?? 0), 0);
  if (pdfBytes > MAX_INLINE_PDF_BYTES) {
    throw new GradingNotReadyError(
      "이 학생의 파일이 너무 많거나 커서 한 번에 읽을 수 없습니다(PDF 합계 50MB 초과).",
    );
  }

  const projectTitles = [
    ...new Set(collected.map((f) => f.projectTitle).filter((t): t is string => !!t)),
  ];

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await draftSetukWithAi(
      cred,
      { teacherMemo: memo, rubric, files },
      { projectTitles, studentName: enrollment.profiles?.display_name?.trim() || null },
    );
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

  const { error } = await admin.from("student_setuk_drafts").upsert(
    {
      class_id: classId,
      student_id: studentId,
      teacher_memo: memo,
      result: outcome.result,
      provider: cred.provider,
      model: outcome.model,
      signature,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "class_id,student_id" },
  );
  if (error) throw new GradingError("세특 초안 저장에 실패했습니다.");

  // 채점과 같은 'grade'로 남긴다 — 교사가 돌리는 무거운 작업이라 응답 상태 배지 집계에서 빠지고,
  // 학생 일일 상한에도 잡히지 않는다.
  await logAiUsage({
    studentId: null,
    classId,
    documentId: null,
    kind: "grade",
    cred: { ...cred, model: outcome.model },
    durationMs,
  });
  // 1,500바이트를 넘어 한 번 더 부른 '줄이기' 호출도 따로 남긴다(비용 집계가 어긋나지 않게).
  for (const call of outcome.extraCalls) {
    await logAiUsage({
      studentId: null,
      classId,
      documentId: null,
      kind: "grade",
      cred: call.model ? { ...cred, model: call.model } : cred,
      durationMs: call.durationMs,
      ok: call.error === null,
      errorKind: call.error === null ? null : classifyAiError(call.error),
    });
  }

  return { status: "created" };
}
