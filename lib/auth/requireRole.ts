import { redirect } from "next/navigation";
import { getSession, type SessionInfo } from "./getSession";
import type { Role } from "@/lib/types/db";

const HOME_BY_ROLE: Record<Role, string> = {
  admin: "/admin",
  teacher: "/teacher/dashboard",
  student: "/student/dashboard",
};

export async function requireRole(role: Role): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.role !== role) {
    redirect(HOME_BY_ROLE[session.profile.role] ?? "/login");
  }
  return session;
}
