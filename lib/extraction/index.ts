import { extractTextFromPdf } from "./pdf";
import { extractTextFromDocx } from "./docx";
import { extractTextFromHwpx } from "./hwpx";
import { extractTextFromTxt } from "./txt";

export class ExtractionError extends Error {}

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "hwpx", "txt"] as const;

interface ExtractOptions {
  // PDF는 피드백 생성 시 원본 파일을 AI가 직접 보므로(그림/그래프/표/스캔 포함),
  // 텍스트가 거의 없는 PDF도 업로드를 거부하지 않아야 한다. true면 최소 길이 검증을 건너뛴다.
  allowSparseText?: boolean;
}

export async function extractText(
  buffer: Buffer,
  filename: string,
  mime: string,
  options: ExtractOptions = {},
): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  let text: string;
  if (ext === "pdf" || mime === "application/pdf") {
    text = await extractTextFromPdf(buffer);
  } else if (
    ext === "docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    text = await extractTextFromDocx(buffer);
  } else if (ext === "hwpx") {
    text = await extractTextFromHwpx(buffer);
  } else if (ext === "hwp") {
    throw new ExtractionError(
      "이 앱은 .hwp가 아닌 .hwpx만 지원합니다. 한글에서 '다른 이름으로 저장' → HWPX로 저장한 뒤 다시 업로드해주세요.",
    );
  } else if (ext === "txt" || mime === "text/plain") {
    text = await extractTextFromTxt(buffer);
  } else {
    throw new ExtractionError(`지원하지 않는 파일 형식입니다: .${ext || "알 수 없음"}`);
  }

  if (!options.allowSparseText && text.trim().length < 10) {
    throw new ExtractionError(
      "파일에서 텍스트를 추출할 수 없습니다. 스캔된 이미지 파일이거나 손상된 파일일 수 있습니다.",
    );
  }

  return text;
}
