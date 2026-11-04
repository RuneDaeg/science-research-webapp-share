// Supabase 환경변수가 채워졌는지 검사한다.
// 값이 없으면 createServerClient/createBrowserClient가 "Your project's URL and Key are required"
// 예외를 던져 모든 요청이 스택 트레이스와 함께 500이 된다. 최초 설치 직후(값을 아직 안 채운
// 상태)에는 그 대신 설정 안내를 보여주기 위해 여기서 미리 판별한다.
export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}
