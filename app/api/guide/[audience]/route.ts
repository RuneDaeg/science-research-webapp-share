import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { findGuide } from "@/lib/guides";

export const runtime = "nodejs";
// 역할을 확인해 내려주는 파일이라 정적으로 굳히면 안 된다.
export const dynamic = "force-dynamic";

// 사용 설명서 PDF 내려주기. 파일이 배포본에 포함되도록 next.config.ts의
// outputFileTracingIncludes에 guides/를 등록해 두었다 — 빠지면 운영에서만 404가 난다.
export async function GET(_request: Request, { params }: { params: Promise<{ audience: string }> }) {
  const { audience } = await params;
  const guide = findGuide(audience);
  if (!guide) return new NextResponse("설명서를 찾을 수 없습니다.", { status: 404 });

  const session = await getSession();
  if (!session) return new NextResponse("로그인이 필요합니다.", { status: 401 });
  if (!guide.allowed.includes(session.profile.role)) {
    return new NextResponse("이 설명서를 볼 권한이 없습니다.", { status: 403 });
  }

  const pdf = await readFile(path.join(process.cwd(), "guides", guide.file));

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      // 역할로 걸러 내려주는 파일이라 공유 캐시에 남기면 안 된다.
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${guide.file}"; filename*=UTF-8''${encodeURIComponent(guide.filename)}`,
    },
  });
}
