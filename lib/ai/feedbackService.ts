import { createAdminClient } from "@/lib/supabase/admin";
import { FIELD_LABEL, documentDisplayLabel } from "@/lib/research/stage";
import type { DocumentStage, ResearchField } from "@/lib/types/db";
import {
  computeSignature,
  generateNudgeFeedback,
  verifyAndRewriteFeedback,
  type NudgeInput,
} from "./nudge";
import { getServerCredential } from "./serverCredential";
import { assertWithinDailyLimit, classifyAiError, logAiUsage } from "./usage";
import { AiError } from "./types";

export class DocumentNotFoundError extends AiError {}

interface DocumentContext {
  documentId: string;
  projectId: string;
  classId: string;
  stage: DocumentStage;
  filePath: string;
  input: NudgeInput;
}

// 문서 + 프로젝트 정보를 모아 AI 입력을 구성한다. service-role로 읽으므로
// 호출부에서 반드시 접근 권한을 먼저 검증할 것.
async function loadDocumentContext(documentId: string): Promise<DocumentContext> {
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("research_documents")
    .select("id, project_id, stage, title, round_no, note, file_path, extracted_text")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) throw new DocumentNotFoundError("산출물을 찾을 수 없습니다.");

  const { data: project } = await admin
    .from("research_projects")
    .select("id, class_id, title, field, research_question")
    .eq("id", doc.project_id)
    .maybeSingle();

  if (!project) throw new DocumentNotFoundError("연구 과제 정보를 찾을 수 없습니다.");

  const isPdf = doc.file_path.toLowerCase().endsWith(".pdf");
  let pdfBuffer: Buffer | undefined;

  if (isPdf) {
    const { data: fileData, error } = await admin.storage
      .from("research-files")
      .download(doc.file_path);
    if (error || !fileData) {
      throw new DocumentNotFoundError("업로드한 파일을 불러올 수 없습니다.");
    }
    pdfBuffer = Buffer.from(await fileData.arrayBuffer());
  }

  const stage = doc.stage as DocumentStage;
  const questionLine = project.research_question?.trim()
    ? `\n연구 질문: ${project.research_question.trim()}`
    : "";

  return {
    documentId: doc.id,
    projectId: project.id,
    classId: project.class_id,
    stage,
    filePath: doc.file_path,
    input: {
      subject: FIELD_LABEL[project.field as ResearchField] ?? "과학",
      title: `${project.title}${questionLine}`,
      stage,
      documentTitle: `${documentDisplayLabel(stage, doc.round_no)} — ${doc.title}`,
      studentNote: doc.note,
      studentText: doc.extracted_text ?? "",
      pdfBuffer,
    },
  };
}

export interface FeedbackOutcome {
  status: "created" | "cached";
  rating: number | null;
  verified: boolean;
}

// 업로드 직후 자동 실행되는 기본 경로.
// 같은 입력(signature 일치)에 대해서는 재호출하지 않고 저장본을 그대로 쓴다 —
// 새로고침해도 피드백이 바뀌지 않고, 공용 키 호출도 낭비되지 않는다.
export async function ensureNudgeFeedback(
  documentId: string,
  studentId: string,
): Promise<FeedbackOutcome> {
  const cred = getServerCredential();
  const ctx = await loadDocumentContext(documentId);
  const admin = createAdminClient();

  const signature = computeSignature(ctx.input, cred.model);

  const { data: existing } = await admin
    .from("ai_feedbacks")
    .select("id, signature, rating, verified")
    .eq("document_id", documentId)
    .maybeSingle();

  if (existing?.signature === signature) {
    return { status: "cached", rating: existing.rating, verified: existing.verified };
  }

  // 상한 초과도 기록한다. 장애는 아니지만(그래서 혼잡 판정에서는 제외된다) 관리자가
  // "학생들이 상한에 걸리고 있다"를 알아야 값을 조정할 수 있다.
  // ok=false로 남으므로 이 행 자체가 상한 계산에 다시 잡히지는 않는다.
  try {
    await assertWithinDailyLimit(studentId);
  } catch (err) {
    await logAiUsage({
      studentId,
      classId: ctx.classId,
      documentId,
      kind: "draft",
      cred,
      ok: false,
      errorKind: classifyAiError(err),
    });
    throw err;
  }

  // 학생 화면의 응답 상태 표시가 이 값으로 계산된다. 저장·집계가 아니라 제공사 호출
  // 자체에 걸린 시간만 재야 몰림을 제대로 반영한다.
  //
  // 실패도 반드시 남긴다. 성공만 기록하면, 느려지다 타임아웃으로 끊기는 상황에서 느린
  // 호출들이 통째로 로그에서 빠지고 빠른 성공 건만 남아 오히려 '원활'로 보인다.
  const startedAt = Date.now();
  let result;
  try {
    result = await generateNudgeFeedback(cred, ctx.input);
  } catch (err) {
    await logAiUsage({
      studentId,
      classId: ctx.classId,
      documentId,
      kind: "draft",
      cred,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorKind: classifyAiError(err),
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;

  const { error } = await admin.from("ai_feedbacks").upsert(
    {
      document_id: documentId,
      body: result.body,
      rating: result.rating,
      provider: cred.provider,
      // 실제로 답한 모델(폴백됐다면 2.5 Flash). signature는 기본 모델 기준 그대로 둔다 —
      // 폴백본도 이 입력에 대한 정상 피드백이라 다시 만들라고 표시할 이유가 없다.
      model: result.model,
      signature,
      verified: result.verified,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "document_id" },
  );

  if (error) throw new AiError("AI 피드백 저장에 실패했습니다.");

  await logAiUsage({
    studentId,
    classId: ctx.classId,
    documentId,
    kind: "draft",
    cred: { ...cred, model: result.model },
    durationMs,
  });

  return { status: "created", rating: result.rating, verified: result.verified };
}

// 선택 경로: 교사가 기존 피드백을 2단계 검증으로 다시 다듬는다.
// 학생 일일 상한과 무관하게 동작한다(교사 판단으로 실행하는 검토 작업이므로).
export async function reverifyNudgeFeedback(documentId: string): Promise<FeedbackOutcome> {
  const cred = getServerCredential();
  const ctx = await loadDocumentContext(documentId);
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("ai_feedbacks")
    .select("id, body")
    .eq("document_id", documentId)
    .maybeSingle();

  if (!existing?.body) {
    throw new DocumentNotFoundError("먼저 AI 피드백이 생성되어 있어야 재검증할 수 있습니다.");
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await verifyAndRewriteFeedback(cred, ctx.input, existing.body);
  } catch (err) {
    await logAiUsage({
      studentId: null,
      classId: ctx.classId,
      documentId,
      kind: "verify",
      cred,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorKind: classifyAiError(err),
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;

  // 재검증본은 원본과 다른 텍스트이므로 signature를 무효화해 두면 다음 자동 실행에서
  // 덮어써진다. 검증 결과를 유지하기 위해 현재 입력의 signature를 그대로 다시 쓴다.
  const signature = computeSignature(ctx.input, cred.model);

  const { error } = await admin
    .from("ai_feedbacks")
    .update({
      body: result.body,
      rating: result.rating,
      provider: cred.provider,
      model: result.model,
      signature,
      verified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("document_id", documentId);

  if (error) throw new AiError("재검증 결과 저장에 실패했습니다.");

  await logAiUsage({
    studentId: null,
    classId: ctx.classId,
    documentId,
    kind: "verify",
    cred: { ...cred, model: result.model },
    durationMs,
  });

  return { status: "created", rating: result.rating, verified: true };
}
