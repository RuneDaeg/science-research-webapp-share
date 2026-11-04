import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { AiError, AiRefusalError, type AiCredential, type AiPart, type RunOptions } from "./types";

// ============================================================
// 제공사-무관 통합 인터페이스
// ============================================================
// 이 앱은 자유 텍스트 생성(넛지 피드백)만 필요하므로 runText 하나만 노출한다.
// runText는 1회 호출만 한다. 호출부는 재시도와 폴백을 함께 처리하는 runTextWithFallback을 쓴다.

export async function runText(cred: AiCredential, opts: RunOptions): Promise<string> {
  switch (cred.provider) {
    case "gemini":
      return geminiText(cred, opts);
    case "openai":
      return openaiText(cred, opts);
    case "anthropic":
      return anthropicText(cred, opts);
  }
}

// 레이트리밋/과부하(429/529/overload) 시에만 짧게 재시도한다.
export async function withBackoff<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // 안전 분류기 거절은 재시도해도 같은 결과이므로 즉시 던진다.
      if (e instanceof AiRefusalError) throw e;
      const retriable = e instanceof Error && /429|rate|overload|529|timeout/i.test(e.message);
      if (!retriable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new AiError("AI 호출에 실패했습니다.");
}

// 한도 초과·과부하처럼 '용량' 때문에 실패했을 때만 true. 이때만 폴백 모델로 넘긴다 —
// 잘못된 요청(400)이나 안전 거절까지 넘기면 진짜 버그가 폴백 뒤에 숨는다.
export function isCapacityError(e: unknown): boolean {
  if (e instanceof AiRefusalError) return false;
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429 || status === 503 || status === 529) return true;
  return (
    e instanceof Error &&
    /\b(429|503|529)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|overload/i.test(e.message)
  );
}

export interface RunResult {
  text: string;
  /** 실제로 답한 모델. 폴백되면 cred.model과 다르다. */
  model: string;
}

// 기본 모델로 한 번 시도하고, 용량 문제로 실패하면 폴백 모델로 넘긴다.
//
// 기본 모델은 재시도하지 않는다. 하루 한도 초과는 1.5초 뒤에 다시 해도 그대로라 기다림만
// 길어진다. 타임아웃도 넘기지 않는다 — 기본 모델이 오래 붙잡은 뒤라 폴백까지 기다리면
// 함수 제한(피드백 120초)을 넘길 수 있다.
export async function runTextWithFallback(
  cred: AiCredential,
  opts: RunOptions,
): Promise<RunResult> {
  if (!cred.fallbackModel) {
    return { text: await withBackoff(() => runText(cred, opts)), model: cred.model };
  }
  try {
    return { text: await runText(cred, opts), model: cred.model };
  } catch (e) {
    if (!isCapacityError(e)) throw e;
    const reason = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.warn(`[ai] ${cred.model} 용량 초과로 ${cred.fallbackModel}에 넘김: ${reason}`);
    const fallback = { ...cred, model: cred.fallbackModel };
    return { text: await withBackoff(() => runText(fallback, opts)), model: fallback.model };
  }
}

// ============================================================
// Gemini
// ============================================================
function geminiContents(parts: AiPart[]) {
  return parts.map((p) =>
    "text" in p
      ? { text: p.text }
      : { inlineData: { data: p.pdfBase64, mimeType: "application/pdf" } },
  );
}

// 사고량 조절 방식이 세대마다 다르다. 2.5는 토큰 예산(thinkingBudget), 3.x부터는 단계(thinkingLevel).
// 3.x에 thinkingBudget을 보내면 모델마다 결과가 갈린다 — 3.6·3.8 Flash는 문서에 없는 방식으로
// 받아들였지만 3.5 Flash-Lite는 thinkingBudget: 0을 400으로 거절했다(실측). 그래서 세대를 보고 나눈다.
function geminiThinkingConfig(model: string, thinking: NonNullable<RunOptions["thinking"]>) {
  if (/^gemini-2\./.test(model)) {
    // 기본 thinking은 호출당 수십 초~수 분이 걸려 서버리스 제한(504)을 넘긴다. 반드시 묶어 둔다.
    return { thinkingBudget: thinking === "fast" ? 0 : 2048 };
  }
  // 피드백·챗봇 모두 low. 3.8 Flash에서 low와 기본값(medium)을 비교했더니 피드백 품질은 같았고
  // 13.7초 대 18.3초였다. 3.8 Flash는 minimal을 지원하지 않아 챗봇도 low가 가장 낮은 단계다.
  return { thinkingLevel: ThinkingLevel.LOW };
}

async function geminiText(cred: AiCredential, opts: RunOptions): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: cred.apiKey });
  const parts = opts.system
    ? [{ text: opts.system }, ...geminiContents(opts.parts)]
    : geminiContents(opts.parts);
  const res = await ai.models.generateContent({
    model: cred.model,
    contents: parts,
    config: {
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(opts.thinking ? { thinkingConfig: geminiThinkingConfig(cred.model, opts.thinking) } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return res.text?.trim() ?? "";
}

// ============================================================
// OpenAI (Responses API — PDF 입력 + 긴 출력 지원)
// ============================================================
function openaiContent(parts: AiPart[]) {
  return parts.map((p) =>
    "text" in p
      ? { type: "input_text" as const, text: p.text }
      : {
          type: "input_file" as const,
          filename: "document.pdf",
          file_data: `data:application/pdf;base64,${p.pdfBase64}`,
        },
  );
}

async function openaiText(cred: AiCredential, opts: RunOptions): Promise<string> {
  const client = new OpenAI({ apiKey: cred.apiKey });
  const maxTokens = opts.maxOutputTokens ? Math.min(opts.maxOutputTokens, 16384) : undefined;
  const res = await client.responses.create({
    model: cred.model,
    ...(opts.system ? { instructions: opts.system } : {}),
    input: [{ role: "user", content: openaiContent(opts.parts) }],
    ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    // json_object는 프롬프트에 'JSON'이라는 낱말이 있어야 받아들여진다(채점 프롬프트에 있다).
    ...(opts.json ? { text: { format: { type: "json_object" as const } } } : {}),
  });
  return res.output_text?.trim() ?? "";
}

// ============================================================
// Anthropic Claude (document 블록으로 PDF 네이티브 지원)
// ============================================================
function anthropicContent(parts: AiPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((p) =>
    "text" in p
      ? { type: "text", text: p.text }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.pdfBase64 } },
  );
}

async function anthropicText(cred: AiCredential, opts: RunOptions): Promise<string> {
  const client = new Anthropic({ apiKey: cred.apiKey });
  // [주의] Claude Opus 5는 확장 사고(thinking)가 기본으로 켜져 있고, max_tokens는
  // 사고 토큰 + 응답 텍스트를 합쳐서 제한한다. 넉넉히 잡지 않으면 피드백이 중간에 잘린다.
  const msg = await client.messages.create({
    model: cred.model,
    max_tokens: Math.min(opts.maxOutputTokens ?? 16000, 16000),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: anthropicContent(opts.parts) }],
  });

  // 안전 분류기가 거절하면 HTTP 200 + stop_reason "refusal"로 돌아온다 (content는 비거나 일부).
  // content[0]을 그대로 읽으면 조용히 빈 피드백이 저장되므로 먼저 걸러낸다.
  if (msg.stop_reason === "refusal") {
    throw new AiRefusalError(
      "AI 제공사의 안전 정책에 따라 이 문서에 대한 피드백 생성이 거절되었습니다. 선생님께 문의해주세요.",
    );
  }

  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
