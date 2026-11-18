"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";
import { createClient } from "@/lib/supabase/client";
import { validateUploadedFile, FileValidationError } from "@/lib/validation/fileValidation";

// 학생이 메신저·메일로 따로 보낸 파일을 선생님이 학생별 모아 보기에 올린다(0014).
//
// 파일은 브라우저에서 Storage로 곧장 올라간다 — 다른 업로드와 같은 구조다(AGENTS.md 참고).
// 여러 개를 고르면 메모와 받은 날을 모두에 똑같이 붙인다.
export function ReceivedFileUploadWidget({
  classId,
  studentId,
  today,
}: {
  classId: string;
  studentId: string;
  /** 오늘 한국 날짜('YYYY-MM-DD'). 서버가 정해 준다 — 브라우저 시간대가 달라도 같게 하려고. */
  today: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const loading = progress !== null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      setError("파일을 선택해주세요.");
      return;
    }
    for (const file of files) {
      try {
        validateUploadedFile(file);
      } catch (err) {
        setError(
          err instanceof FileValidationError
            ? `${file.name}: ${err.message}`
            : "파일을 확인할 수 없습니다.",
        );
        return;
      }
    }

    setError(null);
    setProgress({ done: 0, total: files.length });

    // 한 건이라도 성공하면 그만큼은 남긴다. 중간에 실패해도 앞서 올린 파일을 되돌리지 않는다.
    let uploaded = 0;
    try {
      for (const file of files) {
        const ticketRes = await fetch("/api/classes/received/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId, studentId, filename: file.name, size: file.size }),
        });
        const ticket = await parseJsonResponse<{ path?: string; token?: string; error?: string }>(
          ticketRes,
        );
        if (!ticketRes.ok || !ticket.path || !ticket.token) {
          throw new Error(ticket.error ?? "업로드 준비에 실패했습니다.");
        }

        const { error: uploadError } = await createClient()
          .storage.from("research-files")
          .uploadToSignedUrl(ticket.path, ticket.token, file);
        if (uploadError) {
          throw new Error(`${file.name} 업로드에 실패했습니다: ${uploadError.message}`);
        }

        const res = await fetch("/api/classes/received", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId,
            studentId,
            path: ticket.path,
            originalFilename: file.name,
            note,
            receivedOn,
          }),
        });
        const data = await parseJsonResponse<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error ?? "파일 등록에 실패했습니다.");

        uploaded += 1;
        setProgress({ done: uploaded, total: files.length });
      }

      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "오류가 발생했습니다.";
      setError(uploaded > 0 ? `${message} (${uploaded}개는 올라갔습니다)` : message);
    } finally {
      setProgress(null);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`received-note-${studentId}`} className="text-xs font-medium text-gray-700">
            어떤 자료인지 <span className="font-normal text-gray-400">(선택)</span>
          </label>
          <input
            id={`received-note-${studentId}`}
            type="text"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 2차 연구 일지 — 메신저로 받음"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`received-on-${studentId}`} className="text-xs font-medium text-gray-700">
            받은 날
          </label>
          <input
            id={`received-on-${studentId}`}
            type="date"
            value={receivedOn}
            max={today}
            required
            onChange={(e) => setReceivedOn(e.target.value)}
            className="block rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.hwpx,.txt"
          disabled={loading}
          className="min-w-0 flex-1 text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:text-gray-800"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {progress
            ? `올리는 중... (${progress.done}/${progress.total})`
            : "올리기"}
        </button>
      </div>
      <p className="text-xs text-gray-400">
        pdf, docx, hwpx, txt (각 최대 20MB) · 여러 개를 한 번에 고를 수 있습니다
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
