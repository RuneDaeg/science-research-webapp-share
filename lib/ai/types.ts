export type AiProvider = "gemini" | "openai" | "anthropic";

export interface AiCredential {
  provider: AiProvider;
  apiKey: string;
  model: string;
  // 기본 모델이 한도 초과·과부하로 실패했을 때 대신 쓸 모델. 없으면 폴백하지 않는다.
  fallbackModel?: string;
}

// 입력 파트: 텍스트 또는 PDF(base64). 각 제공사 어댑터가 자기 형식으로 변환한다.
export type AiPart = { text: string } | { pdfBase64: string };

export interface RunOptions {
  system?: string;
  parts: AiPart[];
  maxOutputTokens?: number;
  // 사고(thinking)를 얼마나 할지. Gemini 전용(다른 제공사는 무시).
  // 모델 세대마다 조절 방식이 달라(2.5는 토큰 예산, 3.x부터는 단계) 호출부는 의도만 밝히고
  // 실제 값으로 바꾸는 일은 index.ts의 geminiThinkingConfig가 맡는다.
  //   fast    — 짧은 답(사용법 챗봇). 사고를 최대한 줄인다.
  //   bounded — 피드백. 품질에 필요한 만큼만 생각하고 서버리스 제한은 넘기지 않는다.
  thinking?: "fast" | "bounded";
  // 응답을 JSON 하나로 받는다(과제 채점). Gemini·OpenAI는 JSON 모드를 켜고, Anthropic은
  // 프롬프트 지시에만 맡긴다. 어느 쪽이든 호출부가 직접 파싱하고 검증해야 한다.
  json?: boolean;
}

export class AiError extends Error {}

// AI 제공사의 안전 분류기가 요청을 거절한 경우. 학생 보고서에서는 드물지만
// (예: 생물·화학 실험 소재가 위험 주제로 오분류) 발생 시 교사가 원인을 알 수 있게 구분한다.
export class AiRefusalError extends AiError {}

// gemini-3.8-flash로 올린 이유(2026-10): 같은 프롬프트로 비교했을 때 피드백 품질이 2.5 Flash와
// 같거나 나았고(안전 수칙·통제 변인까지 짚음) 더 빨랐다(PDF 계획서 18.8초 → 13.7초).
// [주의] 유료 등급이면 2027-01-01부터 가격이 두 배가 된다(100만 토큰당 입력 $1.50 / 출력 $7.50).
export const DEFAULT_MODEL: Record<AiProvider, string> = {
  gemini: "gemini-3.8-flash",
  openai: "gpt-4o",
  anthropic: "claude-opus-5",
};

// 기본 모델이 한도 초과·과부하로 실패하면 넘어갈 모델. 무료 한도는 모델마다 따로 세므로
// 마감 직전에 몰려 기본 모델 한도가 바닥나도 피드백이 끊기지 않는다.
// [주의] 2.5 계열은 예전에 써 본 프로젝트만 쓸 수 있다(새 프로젝트는 막혀 있다). 키를 새 Google
// 프로젝트로 옮기면 폴백이 실패하므로 AI_FALLBACK_MODEL을 3.x 모델로 바꿀 것.
export const FALLBACK_MODEL: Partial<Record<AiProvider, string>> = {
  gemini: "gemini-2.5-flash",
};

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};
