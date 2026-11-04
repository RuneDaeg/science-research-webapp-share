// fetch 응답이 JSON이 아닐 수 있다 (예: Vercel 함수 타임아웃/크래시 시 반환되는 "An error occurred..."
// 같은 HTML/텍스트 에러 페이지) — res.json()을 그대로 호출하면 "Unexpected token ... is not valid JSON"
// 이라는 알아보기 힘든 에러가 사용자에게 그대로 노출된다. 여기서 한 번 걸러 이해할 수 있는 메시지로 바꾼다.
export async function parseJsonResponse<T = Record<string, unknown>>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    if (!res.ok) {
      throw new Error(
        `서버 처리 시간이 너무 오래 걸리거나 오류가 발생했습니다 (${res.status}). 파일 크기를 줄이거나 잠시 후 다시 시도해주세요.`,
      );
    }
    throw new Error("서버 응답을 처리할 수 없습니다.");
  }
}
