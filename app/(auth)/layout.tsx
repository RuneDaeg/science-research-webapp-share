import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        {children}
      </div>
      {/* 가입 전에도 개인정보 처리 내용을 확인할 수 있도록 로그인/가입 화면에 노출한다 */}
      <Link href="/privacy" className="mt-6 text-xs text-gray-500 underline hover:text-gray-700">
        개인정보처리방침
      </Link>
    </div>
  );
}
