import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// 링크를 한꺼번에 발급한 뒤 브라우저가 차례로 받는다. 반 전체를 받는 데 몇 분이 걸려도 끊기지 않게
// 넉넉히 잡는다(파일마다 받기 시작할 때만 유효하면 된다).
const URL_TTL_SECONDS = 15 * 60;

// 과제 하나에 제출된 파일 전체의 signed URL을 발급한다. 교사만 쓸 수 있다.
//
// zip은 브라우저가 만든다(components/DownloadAllButton.tsx). 서버에서 묶어 내려보내면 반 전체
// 파일이 함수를 거치게 되어 응답 크기와 실행 시간 제한에 걸린다 — 업로드를 Storage 직접 전송으로
// 바꾼 것과 같은 이유다. 여기서는 권한만 확인하고 링크를 준다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "teacher") {
    return NextResponse.json({ error: "선생님만 내려받을 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const assignmentId = typeof body?.assignmentId === "string" ? body.assignmentId : "";
  if (!assignmentId) {
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }

  // RLS: 담당 클래스의 과제만 조회된다 — 조회되면 곧 이 과제의 제출물을 볼 권한이 있는 것
  const supabase = await createClient();
  const { data: assignment } = await supabase
    .from("class_assignments")
    .select("id, title")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) {
    return NextResponse.json(
      { error: "과제를 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  const { data: submissions } = await supabase
    .from("assignment_submissions")
    .select("id, student_id, profiles(display_name)")
    .eq("assignment_id", assignmentId)
    .overrideTypes<
      Array<{ id: string; student_id: string; profiles: { display_name: string } | null }>,
      { merge: false }
    >();
  const bySubmission = new Map((submissions ?? []).map((s) => [s.id, s]));

  const { data: files } = bySubmission.size
    ? await supabase
        .from("assignment_submission_files")
        .select("submission_id, file_path, original_filename, file_size, uploaded_at")
        .in("submission_id", [...bySubmission.keys()])
        .order("uploaded_at", { ascending: true })
    : { data: [] };
  if (!files?.length) return NextResponse.json({ title: assignment.title, files: [] });

  const { data: signed, error } = await createAdminClient()
    .storage.from("research-files")
    .createSignedUrls(
      files.map((f) => f.file_path),
      URL_TTL_SECONDS,
    );
  if (error || !signed) {
    return NextResponse.json({ error: "링크 생성에 실패했습니다." }, { status: 500 });
  }
  // 저장소에서 사라진 파일은 항목마다 error가 붙어 온다. 빼지 않고 url을 비워 보내
  // 브라우저가 '받지 못한 파일'로 알리게 한다.
  const urlByPath = new Map(signed.map((s) => [s.path, s.error ? null : s.signedUrl]));

  return NextResponse.json({
    title: assignment.title,
    files: files.map((f) => {
      const submission = bySubmission.get(f.submission_id);
      return {
        url: urlByPath.get(f.file_path) ?? null,
        studentId: submission?.student_id ?? f.submission_id,
        student: submission?.profiles?.display_name?.trim() || "(이름 없음)",
        filename: f.original_filename,
        uploadedAt: f.uploaded_at,
      };
    }),
  });
}
