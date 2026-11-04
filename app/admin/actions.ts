"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";

// 관리자가 교사 계정을 발급한다. 임시 비밀번호를 생성해 1회 표시하고, 관리자가 교사에게 전달한다.
// (SMTP 없이 운영할 수 있게 메일 발송 대신 화면 표시 방식을 쓴다.)
export interface CreateTeacherResult {
  ok: boolean;
  email?: string;
  tempPassword?: string;
  error?: string;
}

function generateTempPassword(): string {
  // 읽고 전달하기 쉬운 12자리 임시 비밀번호
  return randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) + "1a";
}

export async function createTeacherAction(
  _prev: CreateTeacherResult | null,
  formData: FormData,
): Promise<CreateTeacherResult> {
  await requireRole("admin");

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!email || !email.includes("@")) return { ok: false, error: "올바른 이메일을 입력해주세요." };
  if (!displayName) return { ok: false, error: "이름을 입력해주세요." };

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  // 1. auth 계정 생성 (이메일 확인 없이 바로 사용 가능). 트리거가 profiles를 role='student'로 생성.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (createErr || !created?.user) {
    const msg = /already|exist|registered/i.test(createErr?.message ?? "")
      ? "이미 가입된 이메일입니다."
      : "계정 생성에 실패했습니다.";
    return { ok: false, error: msg };
  }

  // 2. service_role로 role을 teacher로 승격 (prevent_role_change가 service_role만 허용).
  const { error: roleErr } = await admin
    .from("profiles")
    .update({ role: "teacher" })
    .eq("id", created.user.id);
  if (roleErr) {
    // 승격 실패 시 방금 만든 계정을 정리해 학생 계정이 남지 않게 한다.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "교사 권한 부여에 실패했습니다." };
  }

  revalidatePath("/admin");
  return { ok: true, email, tempPassword };
}
