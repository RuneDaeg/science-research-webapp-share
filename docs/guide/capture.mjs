// 사용 설명서용 스크린샷을 캡처한다. 실행 방법은 README.md 참고.
//
// 설치된 Chrome을 헤드리스로 띄워 실제 배포 사이트에 로그인해서 찍는다. 화면이 바뀌면
// 이 스크립트를 다시 돌려 shots/를 갱신한 뒤 render.mjs로 PDF를 다시 만든다.
//
// [주의] 계정 정보는 환경변수로 받는다. 테스트 계정이라도 비밀번호를 저장소에 넣지 않는다.
import puppeteer from "puppeteer-core";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.GUIDE_BASE_URL ?? "https://science-research-webapp.vercel.app";
const OUT = path.resolve(import.meta.dirname, "shots");

const TEACHER = { email: process.env.GUIDE_TEACHER_EMAIL, password: process.env.GUIDE_TEACHER_PASSWORD };
const STUDENT = { email: process.env.GUIDE_STUDENT_EMAIL, password: process.env.GUIDE_STUDENT_PASSWORD };
// 산출물이 이미 올라와 있고 AI 피드백이 붙은 연구 과제의 id.
// [주의] 실제 학생 이름이 파일명에 들어간 산출물이 있는 과제는 쓰지 말 것 —
// 파일명이 화면에 그대로 노출되므로 배포용 문서에 들어가면 안 된다.
const PROJECT = process.env.GUIDE_PROJECT_ID;

for (const [k, v] of Object.entries({
  GUIDE_TEACHER_EMAIL: TEACHER.email,
  GUIDE_TEACHER_PASSWORD: TEACHER.password,
  GUIDE_STUDENT_EMAIL: STUDENT.email,
  GUIDE_STUDENT_PASSWORD: STUDENT.password,
  GUIDE_PROJECT_ID: PROJECT,
})) {
  if (!v) {
    console.error(`환경변수 ${k}가 필요합니다. README.md를 참고하세요.`);
    process.exit(1);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--lang=ko-KR", "--font-render-hinting=none"],
});

const page = await browser.newPage();
// deviceScaleFactor 2 — PDF에 넣었을 때 글자가 뭉개지지 않게 2배로 찍는다.
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

async function logout() {
  const [btn] = await page.$$("xpath/.//button[contains(text(),'로그아웃')]");
  if (btn) {
    await btn.click();
    await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
  }
}

async function login({ email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  if (!(await page.$("#email"))) {
    await logout();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  }
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click("button[type=submit]"),
  ]);
}

// 요소 캡처는 element.screenshot()에 맡긴다. clip 좌표를 직접 계산하면 문서 좌표와
// 뷰포트 좌표가 어긋나 화면이 잘린다.
async function shot(name, selector) {
  const file = path.join(OUT, `${name}.png`);
  const el = selector ? await page.$(selector) : null;
  if (selector && !el) {
    console.log(`  ! ${name}: 요소 없음 (${selector}) — 전체 화면으로 대체`);
    await page.screenshot({ path: file, fullPage: true });
  } else if (el) {
    await el.scrollIntoView();
    await new Promise((r) => setTimeout(r, 250));
    await el.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
  console.log(`  ✓ ${name}.png`);
}

// ── 로그인 화면 (로그인 전) ──────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
if (!(await page.$("#email"))) {
  await logout();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
}
console.log("로그인 화면");
await shot("01-login", "form");

// ── 학생 화면 ────────────────────────────────────────────────
console.log("학생 화면");
await login(STUDENT);

await page.goto(`${BASE}/student/join`, { waitUntil: "networkidle2" });
await shot("02-join", "main");

await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle2" });
await shot("03-student-dashboard", "main");

await page.goto(`${BASE}/student/projects/new`, { waitUntil: "networkidle2" });
await shot("04-project-new", "main");

await page.goto(`${BASE}/student/projects/${PROJECT}`, { waitUntil: "networkidle2" });
await shot("05-upload", "form.space-y-3");
// 산출물 카드 전체 — 제출물 + AI 피드백이 한 장에 들어간다 (학생 화면이라 별점 없음)
await shot("06-ai-feedback", 'li[id^="doc-"]');

// ── 교사 화면 ────────────────────────────────────────────────
console.log("교사 화면");
await logout();
await login(TEACHER);

await page.goto(`${BASE}/teacher/dashboard`, { waitUntil: "networkidle2" });
await shot("07-teacher-dashboard", "main");

await page.goto(`${BASE}/teacher/projects/${PROJECT}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 600));
// 교사가 보는 산출물 카드 — AI 피드백에 별점과 2단계 검증 버튼이 함께 보인다
await shot("08-teacher-review", 'li[id^="doc-"]');

// 피드백 입력 + 미리보기 켜기. 저장은 하지 않으므로 실제 데이터는 바뀌지 않는다.
await page.evaluate(() => {
  const d = document.querySelector("details");
  if (d) d.open = true;
  const ta = document.querySelector("textarea[name=body]");
  if (ta) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(
      ta,
      "온도 구간을 5℃ 간격으로 좁혀 보면 어떨까요?\n\n반응 속도는 $v_0 = \\dfrac{V_{max}[S]}{K_m + [S]}$ 로 정리할 수 있습니다.",
    );
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "미리보기");
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 1200));
await shot("09-teacher-feedback-form", "form.space-y-2");
await shot("10-latex-help", "details");

await browser.close();
console.log("\n캡처 완료 →", OUT);
