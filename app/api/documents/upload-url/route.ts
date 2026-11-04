import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { createClient } from "@/lib/supabase/server";
import {
  validateFileMeta,
  sanitizeFilename,
  FileValidationError,
} from "@/lib/validation/fileValidation";

export const runtime = "nodejs";

// 업로드 1단계: 파일을 올릴 자리를 잡고 일회용 업로드 티켓을 내준다.
//
// 파일 자체는 이 함수를 지나가지 않는다 — 브라우저가 받은 티켓으로 Supabase Storage에
// 직접 올린다. Vercel 서버리스 함수의 요청 본문 한도(4.5MB)가 앱이 허용하는 20MB보다
// 낮아서, 사진이 들어간 보고서가 플랫폼 단에서 막히던 문제를 이렇게 피한다.
//
// 권한 검증은 여기서 끝낸다. 티켓은 아래에서 정한 경로 하나에만 쓸 수 있고,
// 스토리지 정책(research_files_owner_all)이 최상위 폴더 = 업로더 uid를 다시 강제한다.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.profile.role !== "student") {
    return NextResponse.json({ error: "학생만 산출물을 제출할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const filename = body?.filename;
  const size = body?.size;

  if (typeof projectId !== "string" || typeof filename !== "string" || typeof size !== "number") {
    return NextResponse.json(
      { error: "projectId, filename, size가 필요합니다." },
      { status: 400 },
    );
  }

  // 브라우저에서 이미 한 번 걸렀지만 우회할 수 있으므로 서버에서 다시 본다.
  // 여기서 통과해도 업로드 후 실제 크기로 한 번 더 검사한다(confirm 라우트).
  try {
    validateFileMeta(filename, size);
  } catch (err) {
    if (err instanceof FileValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const supabase = await createClient();

  // RLS: 본인이 팀원인 프로젝트만 조회된다 — 조회되면 곧 업로드 권한이 검증된 것
  const { data: project } = await supabase
    .from("research_projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json(
      { error: "연구 과제를 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }

  // 경로 규칙: {uploader_id}/{project_id}/{timestamp}_{filename} — 같은 이름의 재업로드가
  // 이전 산출물을 덮어쓰지 않도록 타임스탬프를 붙인다(산출물은 이력이 남아야 한다).
  const path = `${session.userId}/${projectId}/${Date.now()}_${sanitizeFilename(filename)}`;

  const { data, error } = await supabase.storage
    .from("research-files")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("createSignedUploadUrl failed:", JSON.stringify(error), "path:", path);
    return NextResponse.json({ error: "업로드 준비에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
