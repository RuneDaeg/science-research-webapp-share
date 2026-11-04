"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";
import { createClient } from "@/lib/supabase/client";
import { validateUploadedFile, FileValidationError } from "@/lib/validation/fileValidation";

// 교사가 과제에 채점기준 파일을 붙인다(이미 있으면 바꾼다).
//
// 파일은 브라우저에서 Storage로 곧장 올라간다 — 학생 제출과 같은 구조다(AGENTS.md 참고).
export function RubricUploadWidget({
  assignmentId,
  hasRubric,
}: {
  assignmentId: string;
  hasRubric: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("파일을 선택해주세요.");
      return;
    }
    try {
      validateUploadedFile(file);
    } catch (err) {
      setError(err instanceof FileValidationError ? err.message : "파일을 확인할 수 없습니다.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const ticketRes = await fetch("/api/assignments/rubric/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, filename: file.name, size: file.size }),
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
      if (uploadError) throw new Error(`업로드에 실패했습니다: ${uploadError.message}`);

      const res = await fetch("/api/assignments/rubric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, path: ticket.path, originalFilename: file.name }),
      });
      const data = await parseJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "채점기준 등록에 실패했습니다.");

      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.hwpx,.txt"
        disabled={loading}
        className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:text-gray-800"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? "올리는 중..." : hasRubric ? "채점기준 바꾸기" : "채점기준 올리기"}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
