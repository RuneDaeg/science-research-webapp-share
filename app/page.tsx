import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/getSession";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/SetupNotice";

export default async function HomePage() {
  // 아직 Supabase 값을 채우지 않았다면 로그인으로 보내봐야 같은 에러만 난다. 설정 안내를 보여준다.
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const session = await getSession();

  if (!session) redirect("/login");
  if (session.profile.role === "admin") redirect("/admin");
  redirect(session.profile.role === "teacher" ? "/teacher/dashboard" : "/student/dashboard");
}
