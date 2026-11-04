// 과제/평가 화면 4종을 캡처한다.
//
// [경고] 이 스크립트는 운영 DB에 임시 과제와 제출물을 만들었다 지운다.
//
// 네 화면 모두 실제 데이터가 있어야 나타나서 평상시에는 찍을 수 없다.
//   16-assignment-teacher-list   교사 클래스 화면의 '과제 · 평가' 섹션 + 등록 폼
//   17-assignment-teacher-detail 제출 현황(제출자 목록 + 다운로드)
//   18-assignment-student-list   학생 대시보드의 과제 목록 (제출 완료 배지)
//   19-assignment-student-submit 학생 제출 화면 (제출 전)
//
// 중간에 강제 종료되면 제목이 '[캡처용]'으로 시작하는 과제와 그 제출 파일이 남는다.
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

const TITLE = "[캡처용] 1차 중간 보고서 제출";
let assignmentId = null;
let filePaths = [];
// 학생 목록(18번)에 세 가지 상태(제출 완료 / 미제출 / 미제출 · 마감 지남)가 모두 보이도록 함께
// 만드는 임시 과제들. 테스트 학생의 반에 다른 과제가 없으면 목록이 한 줄뿐이라 설명이 안 된다.
const extraIds = [];

async function shot(page, name, selector) {
  const el = await page.$(selector);
  if (!el) {
    console.log(`  ! ${name}: 요소 없음 (${selector})`);
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

// '과제 · 평가' 제목을 가진 section을 찾는다. nth-child로 잡으면 페이지 구성이 바뀔 때 깨진다.
async function sectionByHeading(page, heading) {
  const handle = await page.evaluateHandle((h) => {
    const el = [...document.querySelectorAll("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes(h),
    );
    return el ?? null;
  }, heading);
  return handle.asElement() ? handle : null;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--lang=ko-KR", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

try {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const student = users.users.find((u) => u.email === process.env.GUIDE_STUDENT_EMAIL);
  const teacher = users.users.find((u) => u.email === process.env.GUIDE_TEACHER_EMAIL);
  const { data: enr } = await admin
    .from("class_enrollments").select("class_id").eq("student_id", student.id).limit(1).single();
  const classId = enr.class_id;

  // 마감은 넉넉히 뒤로 잡는다 — '마감 지남'이 아니라 평상시 모습을 찍기 위해서다.
  const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { data: a } = await admin.from("class_assignments").insert({
    class_id: classId,
    teacher_id: teacher.id,
    title: TITLE,
    body: "A4 3장 내외로 작성하고, 실험 데이터 표를 반드시 포함해 주세요. PDF로 제출합니다.",
    due_at: due.toISOString(),
  }).select("id").single();
  assignmentId = a.id;

  const { data: extras } = await admin.from("class_assignments").insert([
    {
      class_id: classId,
      teacher_id: teacher.id,
      title: "[캡처용] 연구 일지 2회차 제출",
      due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      class_id: classId,
      teacher_id: teacher.id,
      title: "[캡처용] 탐구 계획서 제출",
      due_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ]).select("id");
  extraIds.push(...(extras ?? []).map((x) => x.id));

  // ── 학생 화면: 제출 전 ────────────────────────────────────
  console.log("학생 화면 (제출 전)");
  await login(page, process.env.GUIDE_STUDENT_EMAIL, process.env.GUIDE_STUDENT_PASSWORD);

  await page.goto(`${BASE}/student/assignments/${assignmentId}`, { waitUntil: "networkidle2" });
  await shot(page, "19-assignment-student-submit", "main");

  // ── 제출물 생성 후 학생 목록(제출 완료 배지) ──────────────
  // 파일 여러 개를 단 제출물을 만든다(0009). 설명서에서 보여줄 것이 '파일 목록'이라
  // 한 개만 올리면 기능이 드러나지 않는다.
  const { data: sub } = await admin.from("assignment_submissions").insert({
    assignment_id: assignmentId,
    student_id: student.id,
    note: "표 정리는 다음 보고서에서 보완하겠습니다.",
  }).select("id").single();

  const samples = [
    ["1차 중간보고서.txt", "중간 보고서 내용"],
    ["실험 데이터표.txt", "측정값 정리"],
    ["참고문헌 목록.txt", "참고한 논문 목록"],
  ];
  for (const [name, content] of samples) {
    const fp = `${student.id}/assignments/${assignmentId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`;
    await admin.storage.from("research-files").upload(fp, Buffer.from(content), {
      contentType: "text/plain",
    });
    await admin.from("assignment_submission_files").insert({
      submission_id: sub.id,
      file_path: fp,
      file_mime: "text/plain",
      file_size: Buffer.byteLength(content),
      original_filename: name,
    });
    filePaths.push(fp);
  }


  console.log("학생 화면 (제출 후)");
  // 파일 목록과 개별 삭제 버튼이 보이는 화면. 여러 개 제출의 핵심이라 따로 찍는다.
  await page.goto(`${BASE}/student/assignments/${assignmentId}`, { waitUntil: "networkidle2" });
  await shot(page, "20-assignment-student-files", "main");

  await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle2" });
  const studentSection = await sectionByHeading(page, "과제 · 평가");
  if (studentSection) {
    await studentSection.asElement().screenshot({
      path: path.join(OUT, "18-assignment-student-list.png"),
    });
    console.log("  ✓ 18-assignment-student-list.png");
  }

  // ── 교사 화면 ────────────────────────────────────────────
  console.log("교사 화면");
  await login(page, process.env.GUIDE_TEACHER_EMAIL, process.env.GUIDE_TEACHER_PASSWORD);

  await page.goto(`${BASE}/teacher/classes/${classId}`, { waitUntil: "networkidle2" });
  const teacherSection = await sectionByHeading(page, "과제 · 평가");
  if (teacherSection) {
    await teacherSection.asElement().screenshot({
      path: path.join(OUT, "16-assignment-teacher-list.png"),
    });
    console.log("  ✓ 16-assignment-teacher-list.png");
  }

  await page.goto(`${BASE}/teacher/assignments/${assignmentId}`, { waitUntil: "networkidle2" });
  await shot(page, "17-assignment-teacher-detail", "main");
} finally {
  if (assignmentId) {
    await admin.from("class_assignments").delete().eq("id", assignmentId);
    if (extraIds.length) await admin.from("class_assignments").delete().in("id", extraIds);
    if (filePaths.length) await admin.storage.from("research-files").remove(filePaths);
    console.log("임시 과제와 제출 파일 삭제 완료");
  }
  await browser.close();
}
