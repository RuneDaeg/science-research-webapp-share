import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "student") {
    return NextResponse.json({ error: "학생만 클래스에 참여할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const joinCode = typeof body?.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";
  if (!joinCode) return NextResponse.json({ error: "참여 코드를 입력해주세요." }, { status: 400 });

  const admin = createAdminClient();

  const { data: classRow, error: classError } = await admin
    .from("classes")
    .select("id, name")
    .eq("join_code", joinCode)
    .maybeSingle();

  if (classError) return NextResponse.json({ error: "클래스 조회에 실패했습니다." }, { status: 500 });
  if (!classRow) {
    return NextResponse.json({ error: "유효하지 않은 참여 코드입니다." }, { status: 404 });
  }

  const { error: enrollError } = await admin
    .from("class_enrollments")
    .insert({ class_id: classRow.id, student_id: session.userId });

  // 23505 = unique_violation (이미 참여한 클래스) — 오류로 취급하지 않는다
  if (enrollError && enrollError.code !== "23505") {
    return NextResponse.json({ error: "클래스 참여에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ class: classRow });
}
