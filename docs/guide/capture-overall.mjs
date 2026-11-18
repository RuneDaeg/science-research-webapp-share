// 학생별 모아 보기와 수행평가 종합 채점 · 세특 참고 초안 화면 4종을 캡처한다.
//
// [경고] 이 스크립트는 운영 DB의 테스트 클래스에 예시 평가 계획서를 잠시 붙였다가 되돌리고,
// 종합 채점과 세특 초안을 실제로 한 번씩 돌린다(공용 키 호출 2회).
//
// 평가 계획서와 결과가 있어야 나타나서 평상시에는 찍을 수 없다.
//   23-teacher-student-detail 학생별 모아 보기 전체 (채점 전 — 화면 구성을 보여 주는 용도)
//   25-class-overall        클래스 화면의 '수행평가 종합 채점 · 세특 초안' 칸 (계획서를 올린 뒤)
//   26-student-overall      학생별 모아 보기의 종합 채점 결과 (근거 펼침)
//   27-student-setuk        학생별 모아 보기의 세특 참고 초안 (관찰 메모 + 초안 + 근거)
//
// GUIDE_ONLY_SETUK=1이면 27만 다시 찍는다(종합 채점은 부르지 않아 AI 호출 1회). 26의 결과와 설명서의
// 예시 설명을 건드리지 않고 세특 화면만 바뀌었을 때 쓴다.
//
// 학생 파일은 테스트 학생이 이미 올려 둔 시연용 산출물을 그대로 쓴다. 평가 계획서와 관찰 메모는
// 아래 예시를 쓴다 — 실제 학교 평가 계획서를 저장소에 넣지 않기 위해서다.
// 끝나면 클래스의 평가 계획서를 원래대로 돌리고, 이번에 만든 채점 결과·세특 초안을 지운다
// (원래 있던 것이 있으면 되살린다). 중간에 강제 종료되면 classes.rubric_filename이
// '[예시]'로 시작하는 채로 남으니 손으로 비울 것.
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import os from "node:os";
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

const RUBRIC_FILENAME = "[예시] 2학기 수행평가 계획.txt";
const RUBRIC = `[예시] 2학기 과학과제연구 수행평가 계획 (100점)

1. 탐구 계획서 (30점, 9월)
평가요소 | 채점기준 | 배점
연구 문제와 가설 | 연구 문제와 검증 가능한 가설을 과학적으로 설정함 | 15
연구 문제와 가설 | 연구 문제와 가설을 설정함 | 12
연구 문제와 가설 | 연구 문제를 제시함 | 8
탐구 설계 | 변인을 통제한 구체적인 실험을 설계함 | 15
탐구 설계 | 실험 방법을 설계함 | 12
탐구 설계 | 실험 주제를 정함 | 8

2. 연구 수행 과정 (30점, 10~11월) — 연구 일지와 중간 보고서
평가요소 | 채점기준 | 배점
과정 기록 | 실험 과정과 결과를 날짜별로 구체적으로 기록하고 계획 대비 변경 사항과 그 이유를 적음 | 15
과정 기록 | 실험 과정과 결과를 기록함 | 12
과정 기록 | 일부 과정을 기록함 | 8
자료 해석 | 측정 자료를 표나 그래프로 정리하고 오차와 한계를 분석함 | 15
자료 해석 | 측정 자료를 표나 그래프로 정리함 | 12
자료 해석 | 측정 자료를 나열함 | 8

3. 최종 보고서와 발표 (40점, 12월)
평가요소 | 채점기준 | 배점
결론 도출 | 자료에 근거해 가설을 검토하고 결론과 후속 연구를 제시함 | 20
결론 도출 | 자료에 근거해 결론을 제시함 | 16
결론 도출 | 결론을 제시함 | 10
발표 | 탐구 과정과 결과를 논리적으로 발표하고 질문에 근거를 들어 답함 | 20
발표 | 탐구 과정과 결과를 발표함 | 16
발표 | 발표에 참여함 | 10
유의사항: 발표는 수업 중 관찰로 평가한다.`;

// 선생님이 수업 중에 적어 둔 것처럼 보일 관찰 메모. 파일로는 알 수 없는 내용이어야
// 초안이 메모를 어떻게 쓰는지 드러난다.
const ONLY_SETUK = process.env.GUIDE_ONLY_SETUK === "1";

const MEMO =
  "예비 실험에서 거품이 넘쳐 부피를 못 잰 문제를 스스로 찾아 과산화수소 양을 줄여 다시 실험함. " +
  "중간 발표에서 40℃ 이후 기체 발생량이 줄어든 까닭을 묻는 질문에 효소 변성 가능성과 추가 측정 계획을 들어 답함.";

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

// 제목(h2)으로 section을 찾는다. nth-child는 화면 구성이 바뀌면 깨진다.
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

async function clickButton(page, text) {
  const [btn] = await page.$$(`xpath/.//button[contains(normalize-space(.),'${text}')]`);
  if (!btn) throw new Error(`버튼 없음: ${text}`);
  await btn.click();
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
  protocolTimeout: 400_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
// '종합 채점'·'세특 초안'의 확인 상자는 그대로 승인한다.
page.on("dialog", (d) => d.accept());

let rubricPath = null;
try {
  const rubricBuf = Buffer.from(RUBRIC);
  rubricPath = `${teacher.id}/classes/${classId}/rubric/${Date.now()}_plan.txt`;
  await admin.storage.from("research-files").upload(rubricPath, rubricBuf, { contentType: "text/plain" });
  await admin.from("classes").update({
    rubric_path: rubricPath,
    rubric_mime: "text/plain",
    rubric_size: rubricBuf.length,
    rubric_filename: RUBRIC_FILENAME,
  }).eq("id", classId);
  // 원래 결과가 있으면 '채점 전' 화면이 안 나오므로 잠시 치운다(끝나면 되살린다).
  await admin.from("student_overall_grades").delete().eq("class_id", classId).eq("student_id", student.id);
  await admin.from("student_setuk_drafts").delete().eq("class_id", classId).eq("student_id", student.id);

  console.log("교사 화면");
  await login(page, process.env.GUIDE_TEACHER_EMAIL, process.env.GUIDE_TEACHER_PASSWORD);
  if (!ONLY_SETUK) {
    await page.goto(`${BASE}/teacher/classes/${classId}`, { waitUntil: "networkidle2" });
    await shot(await sectionByHeading(page, "수행평가 종합 채점 · 세특 초안"), "25-class-overall");
  }

  await page.goto(`${BASE}/teacher/classes/${classId}/students/${student.id}`, {
    waitUntil: "networkidle2",
  });
  if (!ONLY_SETUK) {
    await shot(await page.$("main"), "23-teacher-student-detail");
    await clickButton(page, "종합 채점하기");
    await page.waitForFunction(() => document.body.innerText.includes("AI 채점 초안"), {
      timeout: 300_000,
    });
    // 전부 펼치면 A4에 넣었을 때 글자가 너무 작아진다. 첫 수행평가의 근거와 보낸 파일 목록만 펼친다.
    const overallSection = await sectionByHeading(page, "수행평가 종합 채점");
    await overallSection.evaluate((sec) => {
      const ds = sec.querySelectorAll("details");
      if (ds.length) ds[0].open = true;
      if (ds.length > 1) ds[ds.length - 1].open = true;
    });
    await shot(overallSection, "26-student-overall");
  }

  await page.type(`#memo-${student.id}`, MEMO);
  // 초안이 없을 때는 메모를 고쳤어도 버튼 이름이 '세특 초안 만들기'다. 누르면 메모도 함께 저장된다.
  await clickButton(page, "세특 초안 만들기");
  await page.waitForFunction(() => document.body.innerText.includes("AI 참고 초안"), {
    timeout: 300_000,
  });
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await shot(await sectionByHeading(page, "세특 참고 초안"), "27-student-setuk");
  // 설명서의 '그대로 입력하지 마세요' 예시 문장은 이 초안을 가리킨다. 다시 찍었으면 대조할 수 있게 남긴다.
  const { data: made } = await admin
    .from("student_setuk_drafts").select("result").eq("class_id", classId).eq("student_id", student.id).maybeSingle();
  if (made?.result) {
    const out = path.join(os.tmpdir(), "guide-setuk-draft.json");
    fs.writeFileSync(out, JSON.stringify(made.result, null, 2));
    console.log(`  초안을 ${out}에 남겼습니다`);
  }
} finally {
  await admin.from("classes").update(originalRubric).eq("id", classId);
  if (rubricPath) await admin.storage.from("research-files").remove([rubricPath]);
  await admin.from("student_overall_grades").delete().eq("class_id", classId).eq("student_id", student.id);
  await admin.from("student_setuk_drafts").delete().eq("class_id", classId).eq("student_id", student.id);
  if (originalOverall) await admin.from("student_overall_grades").insert(originalOverall);
  if (originalSetuk) await admin.from("student_setuk_drafts").insert(originalSetuk);
  console.log("평가 계획서를 원래대로 돌리고 이번 결과를 지웠습니다");
  await browser.close();
}
