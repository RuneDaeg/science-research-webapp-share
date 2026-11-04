import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

// HWPX는 zip으로 압축된 OWPML(XML) 문서다. 본문은 Contents/section*.xml에 들어있고,
// 문단은 <hp:p>, 텍스트 런은 <hp:t> 요소로 표현된다 (네임스페이스 접두어는 실제로는
// 임의이지만 한글 워드프로세서가 생성하는 실제 파일은 관례적으로 "hp"를 사용한다 —
// 여기서는 접두어에 상관없이 로컬 이름(p/t)만으로 매칭해 안전하게 처리한다).
// 표 셀 안의 텍스트도 <hp:t>로 감싸여 있어 함께 추출되지만, 표의 행/열 구조와
// 이미지(BinData)는 소실된다 — 텍스트 위주 피드백에는 충분하나 알려진 한계로 남긴다.

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true });

type PONode = Record<string, unknown>;

function localName(key: string): string {
  const idx = key.lastIndexOf(":");
  return idx === -1 ? key : key.slice(idx + 1);
}

function extractRawText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return "";
  let text = "";
  for (const child of nodes as PONode[]) {
    if (typeof child === "object" && child !== null && "#text" in child) {
      text += String((child as { "#text": unknown })["#text"]);
    }
  }
  return text;
}

function collectTextRuns(nodes: unknown, out: string[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes as PONode[]) {
    if (typeof node !== "object" || node === null) continue;
    for (const key of Object.keys(node)) {
      if (key === "#text" || key === ":@") continue;
      const value = node[key];
      if (localName(key) === "t") {
        out.push(extractRawText(value));
      } else {
        collectTextRuns(value, out);
      }
    }
  }
}

function collectParagraphs(nodes: unknown, out: string[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes as PONode[]) {
    if (typeof node !== "object" || node === null) continue;
    for (const key of Object.keys(node)) {
      if (key === "#text" || key === ":@") continue;
      const value = node[key];
      if (localName(key) === "p") {
        const runs: string[] = [];
        collectTextRuns(value, runs);
        out.push(runs.join(""));
      } else {
        collectParagraphs(value, out);
      }
    }
  }
}

function sectionNumber(path: string): number {
  const match = path.match(/section(\d+)\.xml$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function listSectionFiles(zip: JSZip): Promise<string[]> {
  const manifest = zip.file("Contents/content.hpf");
  if (manifest) {
    const xml = await manifest.async("text");
    const matches = [...new Set([...xml.matchAll(/Contents\/section\d+\.xml/g)].map((m) => m[0]))];
    if (matches.length > 0) {
      return matches.sort((a, b) => sectionNumber(a) - sectionNumber(b));
    }
  }
  // 매니페스트가 없거나 섹션 참조를 찾지 못하면 zip 안의 section*.xml을 번호순으로 폴백
  return Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => sectionNumber(a) - sectionNumber(b));
}

export async function extractTextFromHwpx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sectionPaths = await listSectionFiles(zip);

  const sectionTexts: string[] = [];
  for (const path of sectionPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("text");
    const tree = parser.parse(xml);
    const paragraphs: string[] = [];
    collectParagraphs(tree, paragraphs);
    sectionTexts.push(paragraphs.filter((p) => p.length > 0).join("\n"));
  }

  return sectionTexts
    .filter((t) => t.length > 0)
    .join("\n\n")
    .trim();
}
