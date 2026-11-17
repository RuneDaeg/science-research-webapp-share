"use client";

import { useState } from "react";
import { parseJsonResponse } from "@/lib/fetchJson";

type DownloadEntry = {
  url: string | null; // 저장소에서 사라진 파일이면 null
  studentId: string;
  student: string;
  filename: string;
  uploadedAt: string;
};

// 한꺼번에 너무 많이 받으면 브라우저가 줄을 세우고 느린 연결에서 링크가 먼저 만료될 수 있다.
const CONCURRENCY = 4;

// Windows에서 폴더·파일 이름으로 쓸 수 없는 글자를 바꾼다. 끝의 점·공백은 Windows가 지워 버린다.
function safeName(name: string, fallback: string): string {
  const s = [...name]
    .filter((c) => c.charCodeAt(0) >= 32)
    .join("")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  return s || fallback;
}

// 같은 폴더에 같은 이름이 있으면 "보고서 (2).pdf"처럼 번호를 붙인다.
// Windows는 대소문자를 가리지 않으므로 소문자로 비교한다.
function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// 과제 하나에 제출된 파일 전체를 학생별 폴더로 묶어 zip 하나로 내려받는다. 교사 화면 전용이다.
//
// 파일은 브라우저가 Storage에서 직접 받아 브라우저 안에서 묶는다. 서버 함수를 거치지 않으므로
// 반 전체 용량이 커도 함수 제한에 걸리지 않는다(app/api/assignments/download는 링크만 준다).
// 이미 압축된 형식(pdf·hwpx·docx·이미지)이 대부분이라 다시 압축하지 않고 담기만 한다.
export function DownloadAllButton({
  assignmentId,
  fileCount,
  totalBytes,
}: {
  assignmentId: string;
  fileCount: number;
  totalBytes: number;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = progress !== null || zipping;

  async function run() {
    setError(null);
    setNotice(null);
    setProgress({ done: 0, total: fileCount });
    try {
      const res = await fetch("/api/assignments/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });
      const data = await parseJsonResponse<{
        title?: string;
        files?: DownloadEntry[];
        error?: string;
      }>(res);
      if (!res.ok || !data.files) throw new Error(data.error ?? "파일 목록을 받지 못했습니다.");
      if (data.files.length === 0) throw new Error("내려받을 파일이 없습니다.");

      // 학생마다 폴더 하나. 이름이 같은 학생이 있으면 폴더 이름에 번호를 붙여 섞이지 않게 한다.
      const folderTaken = new Set<string>();
      const folderByStudent = new Map<string, { name: string; taken: Set<string> }>();
      const targets = data.files.map((f) => {
        let folder = folderByStudent.get(f.studentId);
        if (!folder) {
          folder = { name: uniqueName(safeName(f.student, "이름 없음"), folderTaken), taken: new Set() };
          folderByStudent.set(f.studentId, folder);
        }
        return { ...f, zipPath: `${folder.name}/${uniqueName(safeName(f.filename, "파일"), folder.taken)}` };
      });

      // jszip은 이 버튼을 누를 때만 쓰므로 그때 불러온다.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const failed: string[] = [];
      let next = 0;
      let done = 0;
      setProgress({ done: 0, total: targets.length });
      const worker = async () => {
        while (next < targets.length) {
          const t = targets[next++];
          try {
            if (!t.url) throw new Error("missing");
            const r = await fetch(t.url);
            if (!r.ok) throw new Error(String(r.status));
            zip.file(t.zipPath, await r.blob(), { date: new Date(t.uploadedAt) });
          } catch {
            failed.push(t.zipPath);
          }
          setProgress({ done: ++done, total: targets.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

      if (failed.length === targets.length) {
        throw new Error("파일을 하나도 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (failed.length > 0) {
        zip.file(
          "받지 못한 파일.txt",
          `아래 파일은 내려받지 못했습니다. 과제 화면에서 하나씩 다시 받아 주세요.\r\n\r\n${failed.join("\r\n")}\r\n`,
        );
      }

      setProgress(null);
      setZipping(true);
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${safeName(data.title ?? "", "과제")} 제출 파일.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);

      if (failed.length > 0) {
        setNotice(`${failed.length}개 파일은 받지 못했습니다. zip 안의 '받지 못한 파일.txt'를 확인해 주세요.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "내려받지 못했습니다.");
    } finally {
      setProgress(null);
      setZipping(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy || fileCount === 0}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        {zipping
          ? "압축 파일 만드는 중..."
          : progress
            ? `파일 받는 중... (${progress.done}/${progress.total})`
            : `제출 파일 모두 받기 (${fileCount}개${totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ""})`}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {notice && <span className="text-xs text-amber-700">{notice}</span>}
    </div>
  );
}
