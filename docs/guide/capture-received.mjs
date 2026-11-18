// 학생별 모아 보기 전체와 '따로 받은 자료' 칸을 캡처한다.
//
// [경고] 이 스크립트는 운영 DB의 테스트 클래스에 예시 평가 계획서와 '따로 받은 자료' 두 건을 잠시
// 붙였다가 되돌린다. AI는 부르지 않는다.
//
//   23-teacher-student-detail 학생별 모아 보기 전체 (채점 전 — 화면 구성을 보여 주는 용도)
//   28-student-received       학생별 모아 보기의 '따로 받은 자료' 칸 (두 건 올린 뒤)
//
// 23은 capture-overall.mjs도 찍는다. 그쪽을 다시 돌리면 AI 결과(26·27)가 바뀌어 설명서의 예시 문장을
// 고쳐야 하므로, 화면 구성만 바뀌었을 때는 이 스크립트로 23만 다시 찍는다.
// 중간에 강제 종료되면 classes.rubric_filename이 '[예시]'로 시작하는 채로 남고, 테스트 학생의
// 따로 받은 자료에 아래 RECEIVED의 두 건(연구 일지 3회차.txt, 중간 보고서 수정본.txt)이 남으니 손으로 지울 것.
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.GUIDE_BASE_URL ?? "https://science-research-webapp.vercel.app";
const OUT = path.resolve(import.meta.dirname, "shots");
const ENV_PATH = path.resolve(import.meta.dirname, "..", "..", ".env.local");

const env = Object.fromEntries(
  fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
  }),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 23에서 종합 채점 칸이 '채점하기' 상태로 보이려면 평가 계획서가 붙어 있어야 한다. 내용은 화면에
// 나오지 않으므로 짧은 예시로 둔다.
const RUBRIC_FILENAME = "[예시] 2학기 수행평가 계획.txt";
const RUBRIC = "[예시] 2학기 과학과제연구 수행평가 계획 (캡처용)";

// '받은 날'이 올린 날과 다르다는 것이 드러나도록 한 건은 한 달 전으로 둔다.
function kstDateDaysAgo(days) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
const RECEIVED = [
  {
    name: "연구 일지 3회차.txt",
    content: "10월 둘째 주 실험 기록",
    note: "3회차 연구 일지 — 메신저로 받음",
    daysAgo: 30,
  },
  {
    name: "중간 보고서 수정본.txt",
    content: "중간 보고서 수정본",
    note: "중간 보고서 수정본 — 메일로 받음",
    daysAgo: 6,
  },
];

async function shot(el, name) {
  if (!el) {
    console.log(`  ! ${name}: 요소 없음`);
    return;
  }
  await el.evaluate(() =>
    // 오른쪽 아래 '사용법 질문' 버튼이 요소 가장자리에 겹쳐 찍히지 않게 숨긴다.
    document.querySelectorAll(".fixed.bottom-5").forEach((e) => (e.style.visibility = "hidden")),
  );
  await el.scrollIntoView();
  await new Promise((r) => setTimeout(r, 300));
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click("button[type=submit]"),
  ]);
}

async function sectionByHeading(page, heading) {
  const h = await page.evaluateHandle(
    (t) =>
      [...document.querySelectorAll("section")].find(
        (s) => s.querySelector("h2")?.textContent?.trim() === t,
      ) ?? null,
    heading,
  );
  return h.asElement();
}

const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const student = users.users.find((u) => u.email === process.env.GUIDE_STUDENT_EMAIL);
const teacher = users.users.find((u) => u.email === process.env.GUIDE_TEACHER_EMAIL);
const { data: enr } = await admin
  .from("class_enrollments").select("class_id").eq("student_id", student.id).limit(1).single();
const classId = enr.class_id;

// 되돌릴 것들을 먼저 챙긴다.
const RUBRIC_COLUMNS = "rubric_path, rubric_mime, rubric_size, rubric_filename";
const { data: originalRubric } = await admin
  .from("classes").select(RUBRIC_COLUMNS).eq("id", classId).single();
const { data: originalOverall } = await admin
  .from("student_overall_grades").select("*").eq("class_id", classId).eq("student_id", student.id).maybeSingle();
const { data: originalSetuk } = await admin
  .from("student_setuk_drafts").select("*").eq("class_id", classId).eq("student_id", student.id).maybeSingle();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--lang=ko-KR", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

const storagePaths = [];
const receivedIds = [];
try {
  const rubricBuf = Buffer.from(RUBRIC);
  const rubricPath = `${teacher.id}/classes/${classId}/rubric/${Date.now()}_plan.txt`;
  await admin.storage.from("research-files").upload(rubricPath, rubricBuf, { contentType: "text/plain" });
  storagePaths.push(rubricPath);
  await admin.from("classes").update({
    rubric_path: rubricPath,
    rubric_mime: "text/plain",
    rubric_size: rubricBuf.length,
    rubric_filename: RUBRIC_FILENAME,
  }).eq("id", classId);
  // 원래 결과가 있으면 '채점 전' 화면이 안 나오므로 잠시 치운다(끝나면 되살린다).
  await admin.from("student_overall_grades").delete().eq("class_id", classId).eq("student_id", student.id);
  await admin.from("student_setuk_drafts").delete().eq("class_id", classId).eq("student_id", student.id);

  for (const r of RECEIVED) {
    const buf = Buffer.from(r.content);
    const fp = `${teacher.id}/classes/${classId}/received/${student.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`;
    await admin.storage.from("research-files").upload(fp, buf, { contentType: "text/plain" });
    storagePaths.push(fp);
    const { data: row, error } = await admin.from("student_received_files").insert({
      class_id: classId,
      student_id: student.id,
      uploaded_by: teacher.id,
      file_path: fp,
      file_mime: "text/plain",
      file_size: buf.length,
      original_filename: r.name,
      note: r.note,
      received_on: kstDateDaysAgo(r.daysAgo),
    }).select("id").single();
    if (error) throw new Error(`따로 받은 자료 등록 실패: ${error.message}`);
    receivedIds.push(row.id);
  }

  console.log("교사 화면");
  await login(page, process.env.GUIDE_TEACHER_EMAIL, process.env.GUIDE_TEACHER_PASSWORD);
  await page.goto(`${BASE}/teacher/classes/${classId}/students/${student.id}`, {
    waitUntil: "networkidle2",
  });
  await shot(await page.$("main"), "23-teacher-student-detail");
  await shot(await sectionByHeading(page, "따로 받은 자료"), "28-student-received");
} finally {
  if (receivedIds.length) await admin.from("student_received_files").delete().in("id", receivedIds);
  await admin.from("classes").update(originalRubric).eq("id", classId);
  if (storagePaths.length) await admin.storage.from("research-files").remove(storagePaths);
  if (originalOverall) await admin.from("student_overall_grades").insert(originalOverall);
  if (originalSetuk) await admin.from("student_setuk_drafts").insert(originalSetuk);
  console.log("예시 평가 계획서와 따로 받은 자료를 지우고 원래대로 돌렸습니다");
  await browser.close();
}
