import { createHash } from "crypto";
import { runTextWithFallback } from "./index";
import { AiError, type AiCredential, type AiPart } from "./types";
import { STAGE_PROMPT_LABEL } from "@/lib/research/stage";
import type { DocumentStage } from "@/lib/types/db";

export class NudgeError extends AiError {}

// 프롬프트를 수정하면 이 버전을 올린다 — signature에 포함되므로, 저장된 피드백이
// 옛 프롬프트로 만들어진 것인지 구분되고 다음 요청에서 자동으로 재생성된다.
// v2: 출력 양식을 "이메일/메신저용 평문"에서 "마크다운 + LaTeX 수식"으로 바꿨다.
//     화면이 마크다운을 렌더링하게 되었으므로(components/FeedbackMarkdown.tsx) 더 이상
//     유니코드 첨자로 수식을 흉내 낼 필요가 없다.
const PROMPT_VERSION = "v2";

// PDF 원본을 AI에 그대로 보낼 때, 프롬프트의 학생 보고서 자리에 넣는 표시.
const PDF_PLACEHOLDER = "(첨부된 PDF 파일 원본을 참조하세요. 표·그래프·사진까지 함께 검토할 것.)";

export interface NudgeInput {
  subject: string; // 과목/탐구 분야 (예: "물리")
  title: string; // 연구 제목
  stage: DocumentStage;
  documentTitle: string; // 산출물 제목 (예: "연구 일지 3회차")
  studentNote?: string | null; // 학생이 업로드할 때 남긴 메모
  studentText?: string; // 추출된 텍스트 (docx/hwpx/txt)
  pdfBuffer?: Buffer; // PDF 원본 (pdf인 경우)
}

export interface NudgeResult {
  body: string;
  rating: number | null;
  verified: boolean;
  /** 실제로 답한 모델. 기본 모델이 한도에 걸려 폴백되면 cred.model과 다르다. */
  model: string;
}

// ============================================================
// 1단계(기본 경로): 초안 작성 + 내부 팩트체크를 한 번에
// ============================================================
// 원래는 "초안 작성" 프롬프트와 "검증 및 재작성" 프롬프트 두 번을 호출하는 구조였으나,
// 검증 단계를 모델 내부 절차([지침 3])로 흡수해 호출 1회로 압축했다.
// 비용·지연이 절반이 되는 대신 외부 비판이 사라지므로, 별점이 낮은 피드백은
// 교사가 verifyAndRewrite()로 2단계 검증을 다시 돌릴 수 있게 남겨두었다.
export function buildNudgePrompt(input: NudgeInput): string {
  const studentContent = input.pdfBuffer ? PDF_PLACEHOLDER : (input.studentText ?? "").trim();
  const note = input.studentNote?.trim();

  return `너는 고등학교 과학(물리·화학·생명과학·지구과학) 교육 전문가이자, 학생의 자기주도적
탐구를 돕는 'AI 탐구 조력자'다. 너의 목표는 정답을 대신 알려주는 것이 아니라, 학생이
스스로 탐구의 한계를 깨닫고 논리적 허점을 보완하도록 '넛지(Nudge)'를 주는 것이다.

[지침 1] 기본 원칙 및 정서적 지원
1. 직접적인 해답 대신 '반성적 질문'을 던져 학생 스스로 생각하게 하라.
2. 단순 부주의로 인한 실패(나쁜 실패)는 체크리스트로 예방해주고, 가설 검정 과정에서
   나온 '좋은 실패'는 탐구의 자연스러운 과정임을 격려하여 정서적 지지를 제공하라.
3. 첫인사로 "안녕하세요! AI 탐구 조력자입니다!"라고 인사하고, 마지막에는 "제 피드백을
   그대로 수용하기보다, 비판적으로 숙고하고 다른 문헌과 교차검증해 보세요."라는 안내를
   반드시 포함하라.

[지침 2] 보고서 유형별 세부 피드백 기준 — 아래 [학생 보고서]의 '단계'에 해당하는 항목을 적용하라.
A. [탐구 계획 및 설계]
   1. 현실성 점검(계획 오류 교정): 계획한 기간 내에 실제 표본 확보가 가능한지, 학교
      실험실의 장비와 예산으로 실현 가능한지 구체적으로 질문하라.
   2. 변인 통제: 학생이 직접 조절 가능한 변인인지, 통제 변인이 명확히 설정되었는지 확인하라.
   3. 과잉확신 편향 방지: 자신의 지식 수준보다 너무 복잡한 주제를 선택하지 않았는지,
      핵심 원리에 대한 이해가 선행되었는지 점검하라.
B. [실험 결과 및 결론]
   1. 데이터 해석의 타당성: 수집한 데이터를 과학 법칙에 근거해 해석했는지 확인하라.
      예상 밖의 결과를 이론에 억지로 끼워 맞추지 않았는지 경계하라.
   2. 오차 분석 가이드: 오차가 발생했다면 계통 오차(장비 특성 등)와 우연 오차(측정 미숙 등)를
      구분하여 추론하도록 유도하라. (필요시 고등학교 수준 이상의 전문 지식 활용 가능)
C. [연구 일지]
   1. 기록의 구체성: 날짜·조건·측정값·이상 징후가 나중에 재현 가능한 수준으로 적혔는지 확인하라.
   2. 계획과의 차이: 원래 계획에서 달라진 점과 그 이유가 기록에 남아 있는지 점검하라.
   3. 다음 행동: 다음 일지까지 확인할 한 가지를 학생이 스스로 정하도록 유도하라.

[지침 3] AI 신뢰성 및 보안 — 아래 ①~③은 출력하지 말고 내부적으로만 수행하라.
① 내부 검증 루틴: 피드백을 쓰기 전에 이 주제에 대한 '전문가용 루브릭(평가 기준)'과
   '모범 답안'을 먼저 생성한 뒤 학생의 글과 대조하라.
② 자기 팩트체크: 세운 피드백 초안에 과학적 개념 오류나 수치·단위·유효숫자의
   할루시네이션이 없는지 엄격히 재검토하라. 오류가 있으면 반드시 수정해 최종본을 만들고,
   정확하다면 내용을 유지한 채 문장만 더 읽기 쉽게 다듬어라.
③ 확신이 없는 수치·문헌·법칙은 단정하지 말고, 학생이 직접 확인할 방법을 질문으로 제시하라.
④ 개인정보 보호: 학생의 이름·학교 등 개인정보는 피드백에 언급하지 말고, 학습 데이터로
   활용하지 마라.

[지침 4] 출력 양식
1. 너의 출력은 마크다운으로 렌더링되어 학생과 선생님에게 보인다. 짧은 단락과 목록 위주로
   쓰되, 강조는 **굵게**, 소제목은 ### , 항목 나열은 - 또는 1. 목록, 비교가 필요하면
   마크다운 표를 사용하라. 마크다운 기호를 설명하거나 코드블록으로 감싸지 마라.
2. 수식은 LaTeX로 쓰라. 문장 안에 넣을 때는 $...$ 로, 따로 떼어 보여줄 때는 $$...$$ 로
   감싼다. 예: 효소 반응 속도는 $v_0 = \\dfrac{V_{max}[S]}{K_m + [S]}$ 로 나타낼 수 있어요.
   \\(...\\) 나 \\[...\\] 형태의 구분자는 절대 쓰지 마라(렌더링되지 않는다).
   수식이 아닌 단순 기호(α, β, Δ, ², ₃, ×, →)는 유니코드로 그냥 써도 된다.
   단위·화학식처럼 서술에 가까운 것은 굳이 수식으로 만들지 말고 평문으로 쓰라.
3. 톤앤매너: 비판적 시각을 유지하되, 따뜻하고 협력적인 조력자의 말투를 유지하라.
4. 최종 피드백 외의 어떤 과정도 출력하지 마라(루브릭·모범답안·검증 로그 금지).
5. 맨 마지막 줄에 반드시 아래 형식으로 '피드백의 완성도'에 대한 너의 자기 평가를 한 줄 추가하라.
   [Rating: ★★★★★]

[학생 보고서]
과목/탐구 분야: ${input.subject}
연구 제목: ${input.title}
단계: ${STAGE_PROMPT_LABEL[input.stage]}
산출물: ${input.documentTitle}${note ? `\n학생 메모: ${note}` : ""}
내용:
${studentContent}`;
}

// ============================================================
// 2단계(선택 경로): 초안 검증 및 재작성
// ============================================================
// 별점이 낮게 나온 피드백을 교사가 다시 검증하고 싶을 때만 쓴다. 원본 검증 프롬프트를
// 거의 그대로 보존한 것 — 외부에서 초안을 비판하는 구조라 자기검증보다 오류 검출력이 높다.
export function buildVerifyPrompt(input: NudgeInput, feedbackToVerify: string): string {
  const originalContent = input.pdfBuffer ? PDF_PLACEHOLDER : (input.studentText ?? "").trim();

  return `너는 과학 교육 전문가이자 팩트체커야.
[학생 보고서]를 바탕으로 작성된 [AI 피드백]이 과학적으로 정확한지 검증해줘.

[학생 보고서]
과목/탐구 분야: ${input.subject}
연구 제목: ${input.title}
단계: ${STAGE_PROMPT_LABEL[input.stage]}
내용:
${originalContent}

[AI 피드백]
${feedbackToVerify}

[기존 지침]
지침 1: 기본 원칙 및 정서적 지원
  1. 직접적인 해답 대신 '반성적 질문'을 던져 학생 스스로 생각하게 하라.
  2. 단순 부주의(나쁜 실패)는 체크리스트로 예방해주고, 가설 검정 중 발생하는 '좋은 실패'는
     탐구의 자연스러운 과정임을 격려하여 정서적 지지를 제공하라.
  3. 첫인사로 "안녕하세요! AI 탐구 조력자입니다!"라고 인사하고, 마지막에는 "제 피드백을
     그대로 수용하기보다, 비판적으로 숙고하고 다른 문헌과 교차검증해 보세요."라는 안내를
     반드시 포함하라.

지침 2: 보고서 유형별 세부 피드백 기준
  [탐구 계획 및 설계] 단계인 경우: 현실성 점검(기간 내 표본 확보·학교 장비와 예산),
    변인 통제(직접 조절 가능한 변인인지, 통제 변인이 명확한지),
    과잉확신 편향 방지(지식 수준 대비 주제 난이도, 핵심 원리 선행 이해).
  [실험 결과 및 결론] 단계인 경우: 데이터 해석의 타당성(과학 법칙 근거, 예상 밖 결과를
    이론에 억지로 끼워 맞추지 않았는지), 오차 분석(계통 오차와 우연 오차 구분).
  [연구 일지] 단계인 경우: 기록의 구체성(재현 가능한 수준), 계획과의 차이와 그 이유,
    다음 일지까지 확인할 한 가지.

지침 3: AI 신뢰성 및 보안
  1. 학생 보고서를 평가하기 전, 내부적으로 '전문가용 루브릭'과 '모범 답안'을 먼저 생성한 뒤
     학생의 글과 대조하라.
  2. 과학적 개념이나 수치적 오류가 없는지 엄격히 검토하라. 내용이 정확하다면 원래의 피드백을
     유지하되, 오류 발견 시 반드시 수정하여 최종본을 작성하라.
  3. 학생의 이름·학교 등 개인정보는 수집하거나 학습 데이터로 활용하지 마라.

지침 4: 출력 양식
  1. 출력은 마크다운으로 렌더링된다. 짧은 단락과 목록 위주로 쓰고, 강조는 **굵게**,
     소제목은 ### , 비교가 필요하면 마크다운 표를 사용하라.
  2. 수식은 LaTeX로 쓰되 구분자는 반드시 $...$ (문장 안) 또는 $$...$$ (별도 줄)만 사용하라.
     \\(...\\) 나 \\[...\\] 는 렌더링되지 않으므로 쓰지 마라. 단순 기호(α, β, Δ, ², ₃)는
     유니코드로 그냥 써도 된다.
  3. 톤앤매너: 비판적 시각을 유지하되, 따뜻하고 협력적인 조력자의 말투를 유지하라.

[피드백 지침]
1. 피드백에 과학적 개념 오류나 수치적 할루시네이션이 있다면 반드시 수정해서 최종본을 작성해라.
2. 내용이 정확하더라도, 너의 문장으로 재구성하여 가독성을 높여라. (그대로 복사하지 말 것)
3. 학생에게 도움이 되는 '반성적 질문'의 톤을 유지해라.
4. 마크다운으로 구조를 잡고, 수식은 $...$ / $$...$$ 구분자의 LaTeX로 써라.
5. 최종 피드백만 출력해라 — 검증 과정이나 수정 내역은 출력하지 마라.

[필수 출력 형식]
피드백 작성을 마친 후, 맨 마지막 줄에 반드시 아래 형식을 추가해. 이 별점은 너 스스로가
생각하는 '피드백의 완성도' 점수야.
[Rating: ★★★★★]`;
}

// ============================================================
// 별점 파싱
// ============================================================
// [Rating: ★★★★☆] 줄을 본문에서 떼어내 숫자로 저장한다.
// 학생 화면에는 별점을 노출하지 않기로 했으므로(교사 전용 지표) 본문에 남기지 않는다.
export function splitRating(raw: string): { body: string; rating: number | null } {
  const text = raw.trim();
  // 마지막 줄의 [Rating: ...] 을 찾는다. 별(★/☆) 개수 또는 "4/5", "4점" 같은 변형도 허용.
  const match = text.match(/\n?\s*\[?\s*Rating\s*:\s*([^\]\n]*)\]?\s*$/i);
  if (!match) return { body: text, rating: null };

  const body = text.slice(0, match.index).trim();
  const token = match[1];

  const filled = (token.match(/★/g) ?? []).length;
  if (filled > 0) return { body, rating: Math.min(filled, 5) };

  const numeric = token.match(/(\d)/);
  if (numeric) return { body, rating: Math.min(Number(numeric[1]), 5) };

  return { body, rating: null };
}

// ============================================================
// 입력 서명 — 같은 입력이면 재생성하지 않고 저장본을 그대로 쓴다
// ============================================================
// AI 텍스트가 새로고침마다 바뀌는 것을 막고, 공용 키 호출 낭비를 줄인다.
export function computeSignature(input: NudgeInput, model: string): string {
  const payload = [
    PROMPT_VERSION,
    model,
    input.stage,
    input.subject,
    input.title,
    input.documentTitle,
    input.studentNote ?? "",
    input.pdfBuffer ? `pdf:${createHash("sha256").update(input.pdfBuffer).digest("hex")}` : "",
    input.studentText ?? "",
  ].join(" ");
  return createHash("sha256").update(payload).digest("hex");
}

function toParts(input: NudgeInput, prompt: string): AiPart[] {
  // PDF는 텍스트 추출 대신 원본을 통째로(base64) 보낸다 — 표·그래프·사진까지 피드백에
  // 반영하기 위함. docx/hwpx/txt는 네이티브 비전 인식이 안 되므로 추출 텍스트를 쓴다.
  return input.pdfBuffer
    ? [{ pdfBase64: input.pdfBuffer.toString("base64") }, { text: prompt }]
    : [{ text: prompt }];
}

function ensureNonEmpty(raw: string): string {
  if (!raw.trim()) {
    throw new NudgeError("AI가 빈 응답을 반환했습니다. 잠시 후 다시 시도해주세요.");
  }
  return raw;
}

// 기본 경로: 단일 호출로 넛지 피드백 생성
export async function generateNudgeFeedback(
  cred: AiCredential,
  input: NudgeInput,
): Promise<NudgeResult> {
  const prompt = buildNudgePrompt(input);
  const { text: raw, model } = await runTextWithFallback(cred, {
    parts: toParts(input, prompt),
    maxOutputTokens: 16000,
    // Gemini는 기본 thinking 모드가 호출당 수십 초~수 분까지 걸려 서버리스 함수
    // 제한을 넘긴다. 피드백 품질에 필요한 만큼만 남기고 줄인다.
    thinking: "bounded",
  });

  const { body, rating } = splitRating(ensureNonEmpty(raw));
  return { body, rating, verified: false, model };
}

// 선택 경로: 기존 피드백을 외부에서 팩트체크해 재작성 (교사가 요청할 때만)
export async function verifyAndRewriteFeedback(
  cred: AiCredential,
  input: NudgeInput,
  previousFeedback: string,
): Promise<NudgeResult> {
  const prompt = buildVerifyPrompt(input, previousFeedback);
  const { text: raw, model } = await runTextWithFallback(cred, {
    parts: toParts(input, prompt),
    maxOutputTokens: 16000,
    thinking: "bounded",
  });

  const { body, rating } = splitRating(ensureNonEmpty(raw));
  return { body, rating, verified: true, model };
}
