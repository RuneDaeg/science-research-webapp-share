import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/db";

export interface SessionInfo {
  userId: string;
  email: string | undefined;
  profile: Profile;
}

// 레이아웃과 페이지가 각각 requireRole()/getSession()을 호출해도 실제 Supabase 요청은
// 요청당 한 번만 나가도록 React의 요청 단위 캐시로 감싼다. 이 패턴을 깨지 않도록 주의.
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (!profile) return null;

  return { userId: user.id, email: user.email, profile };
});
