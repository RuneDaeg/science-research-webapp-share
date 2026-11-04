import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/getSession";
import { guidesFor } from "@/lib/guides";

export const metadata = { title: "사용 설명서 — 과학과제연구 탐구 도우미" };

export default async function GuidePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // 학생에게는 학생용 한 권만 나온다. 선생님용은 lib/guides.ts에서 걸러진다.
  const guides = guidesFor(session.profile.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">사용 설명서</h1>
        <p className="mt-1 text-sm text-gray-500">
          화면 사진이 들어간 PDF입니다. 눌러서 바로 보거나 내려받아 두고 쓰세요.
        </p>
      </div>

      <ul className="space-y-3">
        {guides.map((guide) => (
          <li key={guide.audience}>
            <a
              href={`/api/guide/${guide.audience}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-400"
            >
              <span>
                <span className="block font-medium text-gray-900">{guide.title}</span>
                <span className="mt-0.5 block text-sm text-gray-500">{guide.summary}</span>
              </span>
              <span className="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">
                PDF 열기
              </span>
            </a>
          </li>
        ))}
      </ul>

      <p className="text-xs text-gray-500">
        설명서 내용은 화면이 바뀔 때마다 갱신됩니다. 설명과 실제 화면이 다르면 선생님께
        알려주세요.
      </p>
    </div>
  );
}
