import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { ProjectForm } from "@/components/ProjectForm";

export default async function NewProjectPage() {
  const session = await requireRole("student");
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("class_enrollments")
    .select("class_id, classes(name)")
    .eq("student_id", session.userId)
    .overrideTypes<
      Array<{ class_id: string; classes: { name: string } | null }>,
      { merge: false }
    >();

  const classes = (enrollments ?? []).map((e) => ({
    id: e.class_id,
    name: e.classes?.name ?? "클래스",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">연구 등록</h1>
        <p className="mt-1 text-sm text-gray-500">
          개인 연구도 팀 연구도 같은 방식으로 등록합니다. 등록 후 팀원을 추가할 수 있어요.
        </p>
      </div>

      {classes.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            먼저 클래스에 참여해야 연구를 등록할 수 있습니다.
          </p>
          <Link
            href="/student/join"
            className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            클래스 참여하러 가기
          </Link>
        </div>
      ) : (
        <ProjectForm classes={classes} />
      )}
    </div>
  );
}
