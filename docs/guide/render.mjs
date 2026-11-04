// guide.html을 대상별 A4 PDF 두 벌(학생용 · 선생님용)로 인쇄한다. 실행 방법은 README.md 참고.
//
// PDF 라이브러리(reportlab 등) 대신 Chrome 인쇄를 쓰는 이유: 한글 폰트를 따로 등록할
// 필요가 없고, 스크린샷 배치를 CSS로 그대로 잡을 수 있다.
//
// 원본은 guide.html 하나뿐이고 여기서 장을 골라 두 벌을 뽑는다. HTML을 둘로 쪼개면
// 공통 장(시작하기 · 자주 묻는 것)이 양쪽에 복사돼 한쪽만 고치는 일이 생긴다.
//
// 출력은 docs가 아니라 guides/ 아래다 — .vercelignore가 docs를 통째로 빼므로 거기 두면
// 배포본에 올라가지 않는다. 파일 이름을 ASCII로 두는 것도 의도적이다. 서버 함수가 읽어
// 내려주는 파일이라 경로에 한글이 섞이면 환경에 따라 말썽이 난다. 내려받을 때 보이는
// 한글 이름은 app/api/guide/[audience]/route.ts가 Content-Disposition으로 붙인다.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HTML = path.resolve(import.meta.dirname, "guide.html");
const OUT_DIR = path.resolve(import.meta.dirname, "..", "..", "guides");

// keep은 장에 붙은 역할 배지(.role)의 클래스다. 배지가 없는 장(시작하기 · 자주 묻는 것)은
// 양쪽 모두에 들어간다.
const AUDIENCES = [
  { keep: "student", label: "학생용", out: "guide-student.pdf" },
  { keep: "teacher", label: "선생님용", out: "guide-teacher.pdf" },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });

for (const audience of AUDIENCES) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "networkidle0" });

  await page.evaluate(({ keep, label }) => {
    for (const section of document.querySelectorAll("section.page")) {
      const badge = section.querySelector(".role");
      if (badge && !badge.classList.contains(keep)) {
        section.remove();
        continue;
      }
      // 한 대상만 담은 책자라 장마다 붙은 역할 배지는 군더더기다. 표지에 이미 쓰여 있다.
      badge?.remove();
    }

    // 장을 걸러내면 번호가 비므로 다시 매긴다. 번호가 없는 h2(개인정보 안내)는 건드리지 않는다.
    let n = 0;
    for (const h2 of document.querySelectorAll("section.page > h2")) {
      if (!/^\d+\.\s/.test(h2.textContent)) continue;
      h2.textContent = h2.textContent.replace(/^\d+\.\s*/, `${++n}. `);
    }

    const cover = document.querySelector(".cover");
    const tag = document.createElement("div");
    tag.className = "audience";
    tag.textContent = label;
    cover.querySelector("h1").after(tag);
    cover.querySelector(".meta").textContent = `2026학년도 2학기 · ${label}`;
    document.title = `과학과제연구 탐구 도우미 ${label} 사용 설명서`;
  }, audience);

  // 로컬 이미지가 모두 디코딩될 때까지 기다린다 — 안 그러면 빈 칸으로 인쇄된다.
  await page.evaluate(() =>
    Promise.all(
      [...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {})),
    ),
  );

  const out = path.join(OUT_DIR, audience.out);
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    // guide.html의 @page 설정(A4, 여백)을 그대로 따르게 한다.
    preferCSSPageSize: true,
  });
  await page.close();
  console.log(`PDF 생성: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

await browser.close();
