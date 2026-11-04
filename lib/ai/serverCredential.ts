import {
  AiError,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  type AiCredential,
  type AiProvider,
} from "./types";

// 서버 공용 AI 키가 설정되지 않았을 때 던진다. 라우트에서 사용자 안내 메시지로 변환.
export class MissingCredentialError extends AiError {}

const PROVIDERS: AiProvider[] = ["gemini", "openai", "anthropic"];

// [보안] 키는 서버 환경변수에서만 읽는다 — 클라이언트로 절대 내려가지 않고 DB에도 저장하지 않는다.
// NEXT_PUBLIC_ 접두어를 붙이면 브라우저 번들에 박히므로 절대 붙이지 말 것.
export function getServerCredential(): AiCredential {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingCredentialError(
      "서버에 생성형 AI API 키(AI_API_KEY)가 설정되지 않았습니다. 관리자에게 문의해주세요.",
    );
  }

  const raw = (process.env.AI_PROVIDER ?? "gemini").trim().toLowerCase();
  if (!PROVIDERS.includes(raw as AiProvider)) {
    throw new MissingCredentialError(
      `AI_PROVIDER 값이 올바르지 않습니다: "${raw}". gemini / openai / anthropic 중 하나여야 합니다.`,
    );
  }
  const provider = raw as AiProvider;

  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL[provider];
  const fallback = process.env.AI_FALLBACK_MODEL?.trim() || FALLBACK_MODEL[provider];

  return {
    provider,
    apiKey,
    model,
    // 기본 모델과 같으면 폴백할 의미가 없다(같은 한도를 다시 두드릴 뿐이다).
    fallbackModel: fallback && fallback !== model ? fallback : undefined,
  };
}

// 키 값은 빼고 설정 여부/제공사/모델만 — 관리자 화면 표시용.
export function getServerCredentialStatus(): {
  hasKey: boolean;
  provider: string;
  model: string | null;
  fallbackModel: string | null;
} {
  try {
    const cred = getServerCredential();
    return {
      hasKey: true,
      provider: cred.provider,
      model: cred.model,
      fallbackModel: cred.fallbackModel ?? null,
    };
  } catch {
    return {
      hasKey: false,
      provider: process.env.AI_PROVIDER ?? "gemini",
      model: null,
      fallbackModel: null,
    };
  }
}

// 학생 1인당 하루 AI 피드백 생성 횟수 상한. 0 이하이면 제한 없음.
export function getDailyLimitPerStudent(): number {
  const raw = Number(process.env.AI_DAILY_LIMIT_PER_STUDENT ?? "15");
  return Number.isFinite(raw) ? raw : 15;
}

// 사용법 안내 챗봇의 1인당 하루 질문 수 상한. 0 이하이면 제한 없음.
//
// 피드백과 상한을 따로 두는 이유: 챗봇은 대화라 호출이 훨씬 잦다. 같은 상한을 공유하면
// 사용법 몇 번 물어보다가 정작 산출물 피드백을 못 받는 일이 생긴다.
// 호출당 비용은 피드백보다 훨씬 작지만(짧은 텍스트, 사고 단계 없음) 공용 키라 방어선은 둔다.
export function getChatDailyLimitPerUser(): number {
  const raw = Number(process.env.AI_CHAT_DAILY_LIMIT ?? "30");
  return Number.isFinite(raw) ? raw : 30;
}
