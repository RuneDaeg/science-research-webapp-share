import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { ClassForm } from "@/components/ClassForm";

export default async function NewClassPage() {
  await requireRole("teacher");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/teacher/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          ← 대시보드
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">클래스 만들기</h1>
        <p className="mt-1 text-sm text-gray-500">
          만들면 참여 코드가 발급됩니다. 학생들에게 코드를 알려주세요.
        </p>
      </div>

      <ClassForm />
    </div>
  );
}
