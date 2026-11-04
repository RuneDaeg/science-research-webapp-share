// 연구 과제 삭제 화면 2종을 캡처한다.
//
// [경고] 이 스크립트는 운영 DB에 임시 과제를 만들었다 지운다.
//
// 두 상태 모두 특정한 데이터가 있어야만 화면에 나타나서 평상시에는 찍을 수 없다.
//   14-delete-confirm : 선생님 피드백이 없는 과제 → 삭제 확인 상자
//   15-delete-blocked : 선생님 피드백이 달린 과제 → 삭제 불가 안내
// 하나의 임시 과제를 만들어 앞을 찍고, 피드백을 붙여 뒤를 찍은 뒤 finally에서 지운다.
//
// 중간에 강제 종료되면 제목이 "[캡처용]"으로 시작하는 과제와 그 파일이 남는다.
// 화면이 바뀌지 않는 한 다시 돌릴 일이 없다. shots/14~15는 커밋되어 있다.
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

const TITLE = "[캡처용] 임시 연구 과제";
let projectId = null;
let filePath = null;

async function setup() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const student = users.users.find((u) => u.email === process.env.GUIDE_STUDENT_EMAIL);
  const teacher = users.users.find((u) => u.email === process.env.GUIDE_TEACHER_EMAIL);
  const { data: cls } = await admin
    .from("class_enrollments").select("class_id").eq("student_id", student.id).limit(1).single();

  const { data: proj } = await admin.from("research_projects").insert({
    class_id: cls.class_id, owner_id: student.id, title: TITLE, field: "biology", status: "planning",
  }).select("id").single();
  projectId = proj.id;

  await admin.from("project_members").insert({
    project_id: proj.id, student_id: student.id, role_in_team: "leader",
  });

  filePath = `${student.id}/${proj.id}/${Date.now()}_sample.txt`;
  await admin.storage.from("research-files").upload(filePath, Buffer.from("캡처용"), {
    contentType: "text/plain",
  });
  const { data: doc } = await admin.from("research_documents").insert({
    project_id: proj.id, uploaded_by: student.id, stage: "plan", title: "연구 계획서",
    file_path: filePath, file_mime: "text/plain", file_size: 9,
    original_filename: "계획서.txt", extraction_status: "ok",
  }).select("id").single();

  return { documentId: doc.id, teacherId: teacher.id };
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--lang=ko-KR", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

try {
  const { documentId, teacherId } = await setup();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type("#email", process.env.GUIDE_STUDENT_EMAIL);
  await page.type("#password", process.env.GUIDE_STUDENT_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click("button[type=submit]"),
  ]);

  // 1) 삭제 확인 상자 — 선생님 피드백이 없는 상태
  await page.goto(`${BASE}/student/projects/${projectId}`, { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "연구 과제 삭제");
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const section = await page.$$("section");
  await section[section.length - 1].screenshot({ path: path.join(OUT, "14-delete-confirm.png") });
  console.log("  ✓ 14-delete-confirm.png");

  // 2) 삭제 불가 안내 — 선생님 피드백을 붙인 뒤
  await admin.from("teacher_feedbacks").insert({
    document_id: documentId, teacher_id: teacherId,
    body: "변인 통제 부분을 조금 더 구체적으로 적어보면 좋겠습니다.", visible_to_student: true,
  });
  await page.goto(`${BASE}/student/projects/${projectId}`, { waitUntil: "networkidle2" });
  const section2 = await page.$$("section");
  await section2[section2.length - 1].screenshot({ path: path.join(OUT, "15-delete-blocked.png") });
  console.log("  ✓ 15-delete-blocked.png");
} finally {
  if (projectId) {
    await admin.from("research_projects").delete().eq("id", projectId);
    if (filePath) await admin.storage.from("research-files").remove([filePath]);
    console.log("임시 과제와 파일 삭제 완료");
  }
  await browser.close();
}
