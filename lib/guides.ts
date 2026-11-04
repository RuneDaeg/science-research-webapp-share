import type { Role } from "@/lib/types/db";

// 사용 설명서 PDF 목록. 본체는 guides/ 아래에 있고 docs/guide/render.mjs가 만든다.
//
// public/에 두지 않는 이유가 이것이다 — public은 로그인 없이도 열리므로 '선생님만'
// 조건을 지킬 수 없다. 대신 /api/guide/{audience}가 역할을 확인하고 내려준다.
//
// 디스크 이름은 ASCII로 둔다. 서버 함수가 읽어 내려주는 파일이라 경로에 한글이 섞이면
// 환경에 따라 말썽이 난다. 내려받을 때 보이는 한글 이름은 filename이 맡는다.
export interface Guide {
  audience: "student" | "teacher";
  file: string;
  filename: string;
  title: string;
  summary: string;
  allowed: Role[];
}

export const GUIDES: Guide[] = [
  {
    audience: "student",
    file: "guide-student.pdf",
    filename: "과학과제연구 탐구 도우미 - 학생용 설명서.pdf",
    title: "학생용 설명서",
    summary: "연구 등록부터 산출물 제출, AI 피드백 확인, 과제 제출까지",
    // 선생님도 학생 화면을 알아야 지도할 수 있어 함께 연다.
    allowed: ["student", "teacher", "admin"],
  },
  {
    audience: "teacher",
    file: "guide-teacher.pdf",
    filename: "과학과제연구 탐구 도우미 - 선생님용 설명서.pdf",
    title: "선생님용 설명서",
    summary: "클래스 운영, 산출물 검토와 피드백 작성, 과제 · 평가 내주기",
    allowed: ["teacher", "admin"],
  },
];

export function findGuide(audience: string): Guide | undefined {
  return GUIDES.find((g) => g.audience === audience);
}

export function guidesFor(role: Role): Guide[] {
  return GUIDES.filter((g) => g.allowed.includes(role));
}
