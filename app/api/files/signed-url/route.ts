import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// 산출물·과제 제출물 원본 파일 열람용 signed URL 발급.
// storage RLS는 업로더 폴더 기준이라 교사(및 같은 팀의 다른 팀원)는 직접 접근할 수 없다.
// 여기서 RLS가 걸린 일반 클라이언트로 문서를 조회해 접근 권한을 검증한 뒤
// (조회되면 곧 권한이 있는 것) service-role로 signed URL을 만든다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const documentId = typeof body?.documentId === "string" ? body.documentId : "";
  const submissionFileId = typeof body?.submissionFileId === "string" ? body.submissionFileId : "";
  const rubricAssignmentId =
    typeof body?.rubricAssignmentId === "string" ? body.rubricAssignmentId : "";
  if (!documentId && !submissionFileId && !rubricAssignmentId) {
    return NextResponse.json(
      { error: "documentId, submissionFileId, rubricAssignmentId 중 하나가 필요합니다." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // 채점기준 파일은 교사 전용이다. class_assignments는 반 학생에게도 조회되므로 역할을 따로 본다.
  if (rubricAssignmentId) {
    if (session.profile.role !== "teacher") {
      return NextResponse.json({ error: "선생님만 볼 수 있습니다." }, { status: 403 });
    }
    const { data: assignment } = await supabase
      .from("class_assignments")
      .select("rubric_path")
      .eq("id", rubricAssignmentId)
      .maybeSingle();
    if (!assignment?.rubric_path) {
      return NextResponse.json({ error: "채점기준 파일을 찾을 수 없습니다." }, { status: 404 });
    }
    const { data, error } = await createAdminClient()
      .storage.from("research-files")
      .createSignedUrl(assignment.rubric_path, 120);
    if (error || !data) {
      return NextResponse.json({ error: "링크 생성에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ url: data.signedUrl });
  }

  // 어느 쪽이든 RLS가 걸린 클라이언트로 조회해 권한을 검증한다 — 조회되면 곧 권한이 있는 것.
  //   산출물: 팀원이거나 담당 교사
  //   과제 제출 파일: 본인이거나 그 과제를 낸 교사
  const { data: doc } = documentId
    ? await supabase
        .from("research_documents")
        .select("file_path")
        .eq("id", documentId)
        .maybeSingle()
    : await supabase
        .from("assignment_submission_files")
        .select("file_path")
        .eq("id", submissionFileId)
        .maybeSingle();

  if (!doc) {
    return NextResponse.json(
      { error: "파일을 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  const { data, error } = await createAdminClient()
    .storage.from("research-files")
    .createSignedUrl(doc.file_path, 120);

  if (error || !data) {
    return NextResponse.json({ error: "링크 생성에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
