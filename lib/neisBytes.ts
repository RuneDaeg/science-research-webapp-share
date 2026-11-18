// 나이스(NEIS) 입력란 분량을 바이트로 센다. 서버(세특 초안 검사)와 교사 화면(글자 수 표시)이 함께 쓴다 —
// lib/ai/setuk.ts는 서버 전용 모듈을 불러와 클라이언트에서 import할 수 없어 따로 둔다.
//
// UTF-8 바이트 길이다: 한글 한 글자 3바이트, 공백·영어·숫자·마침표 같은 기호 1바이트.
// '·'(2바이트), '℃'(3바이트)처럼 ASCII가 아닌 기호는 UTF-8 길이대로 센다.

// 기재요령 [참고자료 08] 과목별 세부능력 및 특기사항: 500자(1,500바이트).
export const SETUK_MAX_BYTES = 1500;

// AI에게 맞추라고 하는 범위. 넘으면 한 번 줄이게 할 때도 이 범위를 목표로 준다.
export const SETUK_TARGET_MIN_BYTES = 1350;
export const SETUK_TARGET_MAX_BYTES = 1480;

const encoder = new TextEncoder();

export function neisByteLength(text: string): number {
  return encoder.encode(text).length;
}
