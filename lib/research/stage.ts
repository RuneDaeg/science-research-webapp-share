import type { DocumentStage, ProjectStatus, ResearchField } from "@/lib/types/db";

export const STAGE_LABEL: Record<DocumentStage, string> = {
  plan: "탐구 계획 및 설계",
  journal: "연구 일지",
  interim: "중간 보고서",
  final: "최종 보고서",
};

// AI 프롬프트의 [지침 2] 분기 이름. 계획서는 A, 결과·결론은 B, 일지는 C 기준을 적용한다.
// 중간/최종 보고서는 둘 다 "실험 결과 및 결론" 기준으로 본다.
export const STAGE_PROMPT_LABEL: Record<DocumentStage, string> = {
  plan: "탐구 계획 및 설계",
  journal: "연구 일지",
  interim: "실험 결과 및 결론 (중간 보고서)",
  final: "실험 결과 및 결론 (최종 보고서)",
};

export const STAGE_ORDER: DocumentStage[] = ["plan", "journal", "interim", "final"];

export const FIELD_LABEL: Record<ResearchField, string> = {
  physics: "물리",
  chemistry: "화학",
  biology: "생명과학",
  earth: "지구과학",
  convergence: "융합",
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "계획 중",
  in_progress: "진행 중",
  completed: "완료",
};

export function isDocumentStage(value: unknown): value is DocumentStage {
  return typeof value === "string" && value in STAGE_LABEL;
}

export function isResearchField(value: unknown): value is ResearchField {
  return typeof value === "string" && value in FIELD_LABEL;
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && value in STATUS_LABEL;
}

// 산출물 표시 이름 — 연구 일지는 회차를 붙인다.
export function documentDisplayLabel(stage: DocumentStage, roundNo: number | null): string {
  if (stage === "journal" && roundNo) return `연구 일지 ${roundNo}회차`;
  return STAGE_LABEL[stage];
}
