import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("admin");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold text-gray-900">
              과학과제연구 탐구 도우미
            </Link>
            <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
              관리자
            </Link>
            <Link href="/guide" className="text-sm text-gray-600 hover:text-gray-900">
              사용 설명서
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/account" className="text-sm text-gray-600 hover:text-gray-900">
              {session.profile.display_name?.trim() || "관리자"}
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
