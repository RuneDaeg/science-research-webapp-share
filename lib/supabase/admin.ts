import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/db";

// service-role 키로 RLS를 우회하는 서버 전용 클라이언트.
// API 라우트/서버 액션에서 소유권을 직접 검증한 뒤에만 사용할 것 — 절대 클라이언트로 내보내지 않는다.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
