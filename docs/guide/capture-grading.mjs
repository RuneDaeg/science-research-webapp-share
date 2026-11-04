// 과제 AI 채점 화면 4종을 캡처한다.
//
// [경고] 이 스크립트는 운영 DB에 임시 과제·채점기준·제출물을 만들었다 지우고, AI 채점을 실제로
// 한 번 돌린다(공용 키 호출 1회).
//
// 네 화면 모두 채점기준 파일과 채점 결과가 있어야 나타나서 평상시에는 찍을 수 없다.
//   21-assignment-rubric      교사 과제 화면의 '채점기준 · AI 채점' 칸 (채점 전)
//   22-assignment-ai-grade    AI 채점 결과 카드 (근거 펼침)
//   23-teacher-student-detail 학생별 모아 보기 (클래스 학생 명단에서 이름을 눌렀을 때)
//   24-student-grade-feedback 학생 과제 화면의 '선생님이 공개한 피드백'
//
// 채점기준은 아래 RUBRIC 예시를 쓴다. 실제 학교 평가 계획서를 저장소에 넣지 않기 위해서다.
// 중간에 강제 종료되면 제목이 '[캡처용]'으로 시작하는 과제와 그 파일이 남는다.
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

const TITLE = "[캡처용] 1차 수행평가 - 탐구 계획서";
const RUBRIC = `[예시] 1차 수행평가 - 탐구 계획서 채점기준 (100점)
평가요소 | 채점기준 | 배점
가설 설정 | 연구 목적에 대한 연구 문제와 연구 가설을 과학적으로 설정함 | 40
가설 설정 | 연구 목적에 대한 연구 문제와 연구 가설을 설정함 | 32
가설 설정 | 연구 문제와 연구 가설을 설정함 | 28
가설 설정 | 연구 문제를 고민함 | 16
탐구 설계 | 관련 자료를 찾아 분석한 뒤, 변인을 통제한 구체적인 실험을 설계함 | 40
탐구 설계 | 변인을 통제한 구체적인 실험을 설계함 | 32
탐구 설계 | 실험 방법을 설계함 | 28
탐구 설계 | 실험 주제를 정함 | 16
자료 정리 | 예비 자료를 표나 그래프로 정리하고 변인의 관계를 해석함 | 20
자료 정리 | 예비 자료를 표나 그래프로 정리함 | 16
자료 정리 | 예비 자료를 기록함 | 12
자료 정리 | 자료 수집 계획을 세움 | 8
유의사항: AI를 활용했다면 활용 과정을 표기해야 한다.`;

// 학생이 낸 것처럼 보일 계획서. 흔한 실수를 일부러 넣어 채점 근거가 드러나게 한다.
const PLAN_HTML = `<!doctype html><meta charset="utf-8">
<body style="font-family:'Malgun Gothic';font-size:11pt;line-height:1.6;margin:20mm">
<h2>탐구 계획서 — 물병 로켓에 넣는 물의 양에 따른 비행 거리</h2>
<p><b>연구 동기</b> 과학 시간에 물병 로켓을 날려 보니 친구마다 날아간 거리가 크게 달랐다.</p>
<p><b>가설</b> 물의 양이 많을수록 로켓은 반드시 더 멀리 날아갈 것이다. 뒤로 뿜는 질량이 커져 추진력이 커지기 때문이다.</p>
<p><b>실험 방법</b> 1.5 L 페트병에 물을 0.2~1.0 L 넣고 각각 한 번씩 발사한다. 공기는 적당히 넣고, 발사대는 대략 45도로 둔다. 거리는 걸음 수로 잰다.</p>
<p><b>변인</b> 조작 변인: 물의 양 / 종속 변인: 비행 거리 / 통제 변인: 같은 로켓</p>
<h3>예비 실험 기록</h3>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>물의 양(L)</th><th>걸음 수</th><th>거리(m)</th></tr>
<tr><td>0.2</td><td>31</td><td>18.6</td></tr>
<tr><td>0.5</td><td>52</td><td>31.2</td></tr>
<tr><td>1.0</td><td>40</td><td>24.0</td></tr></table>
<p>1.0 L일 때 거리가 줄었는데, 바람 때문인 것 같아 무시한다.</p>
</body>`;

let assignmentId = null;
const storagePaths = [];

async function shot(el, name) {
  if (!el) {
    console.log(`  ! ${name}: 요소 없음`);
    return;
  }
  await el.scrollIntoView();
  await new Promise((r) => setTimeout(r, 300));
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  if (!(await page.$("#email"))) {
    const [btn] = await page.$$("xpath/.//button[contains(text(),'로그아웃')]");
    if (btn) {
      await btn.click();
      await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
    }
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  }
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click("button[type=submit]"),
  ]);
}

// 제목(h2)으로 section을, 들어 있는 글자로 li를 찾는다. nth-child는 화면 구성이 바뀌면 깨진다.
async function sectionByHeading(page, heading) {
  const h = await page.evaluateHandle(
    (t) => [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.includes(t)) ?? null,
    heading,
  );
  return h.asElement();
}
async function itemContaining(page, text) {
  const h = await page.evaluateHandle(
    (t) => [...document.querySelectorAll("main li")].find((l) => l.innerText.includes(t)) ?? null,
    text,
  );
  return h.asElement();
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--lang=ko-KR", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
// 'AI 채점하기'의 확인 상자는 그대로 승인한다.
page.on("dialog", (d) => d.accept());

try {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const student = users.users.find((u) => u.email === process.env.GUIDE_STUDENT_EMAIL);
  const teacher = users.users.find((u) => u.email === process.env.GUIDE_TEACHER_EMAIL);
  const { data: enr } = await admin
    .from("class_enrollments").select("class_id").eq("student_id", student.id).limit(1).single();
  const classId = enr.class_id;

  // ── 임시 과제 + 채점기준 + 제출물 ────────────────────────
  const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { data: a } = await admin.from("class_assignments").insert({
    class_id: classId,
    teacher_id: teacher.id,
    title: TITLE,
    body: "탐구 계획서를 PDF로 제출하세요. 예비 실험 기록을 꼭 넣어 주세요.",
    due_at: due.toISOString(),
  }).select("id").single();
  assignmentId = a.id;

  const rubricBuf = Buffer.from(RUBRIC);
  const rubricPath = `${teacher.id}/assignments/${assignmentId}/rubric/${Date.now()}_rubric.txt`;
  await admin.storage.from("research-files").upload(rubricPath, rubricBuf, { contentType: "text/plain" });
  storagePaths.push(rubricPath);
  await admin.from("class_assignments").update({
    rubric_path: rubricPath,
    rubric_mime: "text/plain",
    rubric_size: rubricBuf.length,
    rubric_filename: "1차 수행평가 채점기준.txt",
  }).eq("id", assignmentId);

  const pdfPage = await browser.newPage();
  await pdfPage.setContent(PLAN_HTML, { waitUntil: "networkidle0" });
  const planPdf = Buffer.from(await pdfPage.pdf({ format: "A4", printBackground: true }));
  await pdfPage.close();

  const { data: sub } = await admin.from("assignment_submissions").insert({
    assignment_id: assignmentId,
    student_id: student.id,
    note: "예비 실험 기록을 표로 넣었습니다.",
  }).select("id").single();
  const planPath = `${student.id}/assignments/${assignmentId}/${Date.now()}_plan.pdf`;
  await admin.storage.from("research-files").upload(planPath, planPdf, { contentType: "application/pdf" });
  storagePaths.push(planPath);
  await admin.from("assignment_submission_files").insert({
    submission_id: sub.id,
    file_path: planPath,
    file_mime: "application/pdf",
    file_size: planPdf.length,
    original_filename: "탐구 계획서.pdf",
  });

  // ── 교사 화면 ────────────────────────────────────────────
  console.log("교사 화면");
  await login(page, process.env.GUIDE_TEACHER_EMAIL, process.env.GUIDE_TEACHER_PASSWORD);
  await page.goto(`${BASE}/teacher/assignments/${assignmentId}`, { waitUntil: "networkidle2" });
  await shot(await sectionByHeading(page, "채점기준 · AI 채점"), "21-assignment-rubric");

  // 실제로 채점을 돌린다. 끝나면 결과 카드가 나타난다.
  const [gradeBtn] = await page.$$("xpath/.//button[contains(text(),'AI 채점하기')]");
  await gradeBtn.click();
  await page.waitForFunction(() => document.body.innerText.includes("AI 채점 초안"), {
    timeout: 180_000,
  });
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await shot(await itemContaining(page, "AI 채점 초안"), "22-assignment-ai-grade");

  // 공개해야 학생 화면에 피드백이 나온다.
  const [releaseBtn] = await page.$$("xpath/.//button[normalize-space(text())='학생에게 공개']");
  await releaseBtn.click();
  await page.waitForFunction(() => document.body.innerText.includes("학생에게 피드백 공개됨"), {
    timeout: 30_000,
  });

  await page.goto(`${BASE}/teacher/classes/${classId}/students/${student.id}`, {
    waitUntil: "networkidle2",
  });
  await shot(await page.$("main"), "23-teacher-student-detail");

  // ── 학생 화면 ────────────────────────────────────────────
  console.log("학생 화면");
  await login(page, process.env.GUIDE_STUDENT_EMAIL, process.env.GUIDE_STUDENT_PASSWORD);
  await page.goto(`${BASE}/student/assignments/${assignmentId}`, { waitUntil: "networkidle2" });
  await shot(await sectionByHeading(page, "선생님이 공개한 피드백"), "24-student-grade-feedback");
} finally {
  if (assignmentId) {
    // 제출물·채점 결과는 과제를 지우면 함께 지워진다(on delete cascade). 파일만 따로 지운다.
    await admin.from("class_assignments").delete().eq("id", assignmentId);
    if (storagePaths.length) await admin.storage.from("research-files").remove(storagePaths);
    console.log("임시 과제와 채점기준·제출 파일 삭제 완료");
  }
  await browser.close();
}
