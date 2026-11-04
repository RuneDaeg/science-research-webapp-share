import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/getSession";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { formatKstDate } from "@/lib/datetime";
import type { Role } from "@/lib/types/db";

const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  teacher: "선생님",
  student: "학생",
};

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">계정 설정</h1>
        <p className="mt-1 text-sm text-gray-500">내 정보와 비밀번호를 관리합니다.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">내 정보</h2>
        <dl className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white text-sm">
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">이름</dt>
            <dd className="font-medium text-gray-900">
              {session.profile.display_name?.trim() || "(이름 없음)"}
            </dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">이메일</dt>
            <dd className="font-medium text-gray-900">{session.email}</dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">역할</dt>
            <dd className="font-medium text-gray-900">{ROLE_LABEL[session.profile.role]}</dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">가입일</dt>
            <dd className="font-medium text-gray-900">
              {formatKstDate(session.profile.created_at)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">비밀번호 변경</h2>
        <ChangePasswordForm />
      </section>

      <Link href="/privacy" className="inline-block text-sm text-gray-500 underline">
        개인정보처리방침
      </Link>
    </div>
  );
}
