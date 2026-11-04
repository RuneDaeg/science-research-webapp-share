import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { JoinClassForm } from "@/components/JoinClassForm";
import { formatKstDate } from "@/lib/datetime";

export default async function StudentJoinPage() {
  const session = await requireRole("student");
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("class_enrollments")
    .select("id, joined_at, classes(name, school_year)")
    .eq("student_id", session.userId)
    .order("joined_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string;
        joined_at: string;
        classes: { name: string; school_year: string | null } | null;
      }>,
      { merge: false }
    >();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">클래스 참여</h1>
        <p className="mt-1 text-sm text-gray-500">
          선생님께 받은 참여 코드를 입력하면 그 수업의 연구 과제를 등록할 수 있습니다.
        </p>
      </div>

      <JoinClassForm />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">참여 중인 클래스</h2>
        {!enrollments || enrollments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 참여한 클래스가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {enrollments.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-gray-900">{e.classes?.name ?? "클래스"}</p>
                  {e.classes?.school_year && (
                    <p className="text-xs text-gray-500">{e.classes.school_year}</p>
                  )}
                </div>
                <span className="text-xs text-gray-500">{formatKstDate(e.joined_at)} 참여</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
