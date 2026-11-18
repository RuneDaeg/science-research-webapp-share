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

// date 컬럼('YYYY-MM-DD')에는 시각이 없다. 한국 정오로 읽어 두면 어느 시간대에서 그려도 같은 날이 된다.
export function kstDateOnlyToIso(value: string): string {
  return new Date(`${value}T12:00:00+09:00`).toISOString();
}

export function formatKstDateOnly(value: string): string {
  return formatKstDate(kstDateOnlyToIso(value));
}

// 오늘 한국 날짜('YYYY-MM-DD'). 서버는 UTC로 돌아서 그냥 자르면 자정~오전 9시 사이에 하루 앞선다.
export function todayKstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// "최근 N일" 조회 범위의 시작 시각(ISO). 서버 컴포넌트 본문에서 Date.now()를 직접 부르면
// react-hooks/purity 규칙(렌더 중 비순수 함수 호출)에 걸리므로 여기로 분리한다.
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
