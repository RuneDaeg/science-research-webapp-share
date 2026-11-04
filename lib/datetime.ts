// 날짜/시간은 항상 한국 표준시(서울)로 표시한다.
// 서버 컴포넌트는 Vercel(UTC)에서 렌더링되므로 timeZone을 명시하지 않으면 UTC로 표시된다.
// `new Date(...).toLocaleString("ko-KR")`을 직접 쓰지 말 것.
const KST = "Asia/Seoul";

export function formatKstDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("ko-KR", { timeZone: KST });
}

export function formatKstDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("ko-KR", { timeZone: KST });
}

// "최근 N일" 조회 범위의 시작 시각(ISO). 서버 컴포넌트 본문에서 Date.now()를 직접 부르면
// react-hooks/purity 규칙(렌더 중 비순수 함수 호출)에 걸리므로 여기로 분리한다.
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
