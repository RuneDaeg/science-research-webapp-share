// AI 응답 상태 배지(원활/주의/혼잡)의 세 등급을 캡처한다.
//
// [경고] 이 스크립트는 운영 DB에 임시 행을 넣었다 지운다.
//
// 배지는 최근 30분의 실제 호출 기록이 있어야 뜨기 때문에, 평상시에는 세 등급을 찍을 방법이
// 없다. 그래서 ai_usage_log에 model='guide-badge-temp'인 행을 넣어 상태를 만든 뒤 찍고
// finally에서 지운다. 실제 AI는 호출하지 않으므로 과금은 없다.
//
// 중간에 강제 종료되면 임시 행이 남아 관리자 화면의 호출량 통계가 부풀려진다. 그럴 때는
// ai_usage_log에서 model='guide-badge-temp'인 행을 지우면 된다.
//
// 배지 디자인이 바뀌지 않는 한 다시 돌릴 일이 없다. shots/11~13은 커밋되어 있다.
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs
    .readFileSync("C:\\Users\\rune_\\science-research-webapp\\.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MARKER = "guide-badge-temp";
const BASE = "https://science-research-webapp.vercel.app";
const OUT = "C:\\Users\\rune_\\science-research-webapp\\docs\\guide\\shots";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const STATES = [
  // [파일 이름, 성공 호출 소요시간 목록, 타임아웃 실패 건수]
  ["11-badge-smooth", [31000, 34000, 29000, 33000], 0],
  ["12-badge-busy", [68000, 72000, 70000, 66000], 0],
  ["13-badge-congested", [31000, 33000, 30000], 2],
];

async function seed(durations, failures) {
  await admin.from("ai_usage_log").delete().eq("model", MARKER);
  const rows = durations.map((d) => ({
    kind: "draft", provider: "gemini", model: MARKER, duration_ms: d, ok: true,
  }));
  for (let i = 0; i < failures; i++) {
    rows.push({
      kind: "draft", provider: "gemini", model: MARKER,
      duration_ms: 118000, ok: false, error_kind: "timeout",
    });
  }
  const { error } = await admin.from("ai_usage_log").insert(rows);
  if (error) throw error;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--lang=ko-KR", "--font-render-hinting=none"],
});
const page = await browser.newPage();
// 배지가 작아 확대해도 뭉개지지 않도록 3배로 찍는다.
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 3 });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.type("#email", process.env.GUIDE_STUDENT_EMAIL);
await page.type("#password", process.env.GUIDE_STUDENT_PASSWORD);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2" }),
  page.click("button[type=submit]"),
]);

try {
  for (const [name, durations, failures] of STATES) {
    await seed(durations, failures);
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle2" });
    const badge = await page.$("header span.rounded-full");
    if (!badge) {
      console.log(`  ! ${name}: 배지를 찾지 못함`);
      continue;
    }
    await badge.screenshot({ path: path.join(OUT, `${name}.png`) });
    const text = await page.evaluate((el) => el.textContent, badge);
    console.log(`  ✓ ${name}.png  "${text}"`);
  }
} finally {
  // 임시 행은 무슨 일이 있어도 지운다 — 남으면 관리자 화면의 호출량 통계가 오염된다.
  const { count } = await admin
    .from("ai_usage_log")
    .delete({ count: "exact" })
    .eq("model", MARKER);
  console.log(`임시 행 ${count}개 삭제`);
  await browser.close();
}
