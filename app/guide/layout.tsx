import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/getSession";
import { SignOutButton } from "@/components/SignOutButton";

const HOME_BY_ROLE = {
  admin: "/admin",
  teacher: "/teacher/dashboard",
  student: "/student/dashboard",
} as const;

export default async function GuideLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href={HOME_BY_ROLE[session.profile.role]} className="font-semibold text-gray-900">
            과학과제연구 탐구 도우미
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {session.profile.display_name?.trim() || "사용자"}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
