import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Content-Security-Policy — 이 앱이 실제로 필요한 것만 허용한다.
// - script: Next.js가 인라인 부트스트랩 스크립트를 쓰므로 'unsafe-inline' 필요.
//           개발 모드에서는 React Fast Refresh 때문에 'unsafe-eval'도 필요.
// - style : Tailwind 인라인 스타일 때문에 'unsafe-inline' 필요.
// - connect: Supabase REST/Auth
// (my-webapp22와 달리 클라이언트 pdf.js를 쓰지 않으므로 wasm/worker/blob 허용이 필요 없다.)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'", // 클릭재킹 방지 (X-Frame-Options의 최신 대체재)
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // guides/의 설명서 PDF는 코드에서 import하지 않아 추적에 잡히지 않는다. 적어두지 않으면
  // 배포본에서 통째로 빠져 /api/guide/{audience}가 운영에서만 실패한다(로컬은 멀쩡하다).
  outputFileTracingIncludes: { "/api/guide/*": ["./guides/**"] },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb", // 산출물 파일(최대 20MB) 업로드를 위해 기본 1MB에서 상향
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
