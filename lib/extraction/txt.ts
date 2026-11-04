import iconv from "iconv-lite";

// 오래된 한글 워드프로세서로 저장된 .txt는 EUC-KR인 경우가 많다.
// UTF-8 디코딩 결과에 대체 문자(U+FFFD)가 많으면 EUC-KR로 재시도한다.
export async function extractTextFromTxt(buffer: Buffer): Promise<string> {
  const utf8 = buffer.toString("utf-8");
  const replacementCount = (utf8.match(/�/g) ?? []).length;

  if (replacementCount > 0 && replacementCount > utf8.length * 0.01) {
    const decoded = iconv.decode(buffer, "euc-kr");
    if (!decoded.includes("�")) return decoded.trim();
  }

  return utf8.trim();
}
