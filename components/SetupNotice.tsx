// 설치 직후 .env.local을 아직 채우지 않았을 때 보여주는 안내 화면.
// (환경변수가 없으면 Supabase 클라이언트 생성 자체가 실패하므로 로그인 화면조차 뜨지 않는다.)
export function SetupNotice() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">설정이 필요합니다</h1>
      <p className="mt-2 text-sm text-gray-600">
        아직 Supabase 연결 정보가 채워지지 않았습니다. 아래 순서를 마치면 앱이 동작합니다.
      </p>

      <ol className="mt-8 space-y-5 text-sm text-gray-700">
        <li className="space-y-1">
          <p className="font-semibold text-gray-900">1. Supabase 프로젝트 만들기</p>
          <p>
            supabase.com 대시보드에서 프로젝트를 만들고 Project Settings → API 에서 URL과 키를
            복사합니다.
          </p>
        </li>
        <li className="space-y-1">
          <p className="font-semibold text-gray-900">2. .env.local 채우기</p>
          <p>
            프로젝트 루트의 <code className="rounded bg-gray-100 px-1 py-0.5">.env.local</code> 에
            아래 세 값을 넣습니다.
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
            {`NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=`}
          </pre>
        </li>
        <li className="space-y-1">
          <p className="font-semibold text-gray-900">3. 스키마 적용</p>
          <p>
            <code className="rounded bg-gray-100 px-1 py-0.5">
              supabase/migrations/0001_init.sql
            </code>{" "}
            을 Supabase SQL Editor에 붙여넣어 실행하거나{" "}
            <code className="rounded bg-gray-100 px-1 py-0.5">npx supabase db push</code> 를
            실행합니다.
          </p>
        </li>
        <li className="space-y-1">
          <p className="font-semibold text-gray-900">4. 생성형 AI 키 설정</p>
          <p>
            <code className="rounded bg-gray-100 px-1 py-0.5">AI_PROVIDER</code> 와{" "}
            <code className="rounded bg-gray-100 px-1 py-0.5">AI_API_KEY</code> 를 채웁니다. 이 값이
            없으면 로그인·업로드는 되지만 AI 피드백 생성만 실패합니다.
          </p>
        </li>
        <li className="space-y-1">
          <p className="font-semibold text-gray-900">5. 개발 서버 재시작</p>
          <p>환경변수는 서버 시작 시에만 읽히므로 값을 채운 뒤 다시 시작해야 합니다.</p>
        </li>
      </ol>

      <p className="mt-8 text-xs text-gray-500">
        자세한 설명과 첫 관리자 계정 만드는 방법은 README.md 를 참고하세요.
      </p>
    </div>
  );
}
