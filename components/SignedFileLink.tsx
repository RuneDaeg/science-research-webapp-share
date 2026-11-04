"use client";

import { useState } from "react";
import { parseJsonResponse } from "@/lib/fetchJson";

// 산출물(documentId), 과제 제출 파일(submissionFileId), 채점기준 파일(rubricAssignmentId) 중
// 하나를 받는다. 권한 검증은 서버가 한다.
export function SignedFileLink({
  documentId,
  submissionFileId,
  rubricAssignmentId,
  label,
}: {
  documentId?: string;
  submissionFileId?: string;
  rubricAssignmentId?: string;
  label: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/files/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          documentId ? { documentId } : rubricAssignmentId ? { rubricAssignmentId } : { submissionFileId },
        ),
      });
      const data = await parseJsonResponse<{ url?: string; error?: string }>(res);
      if (!res.ok || !data.url) throw new Error(data.error ?? "링크 생성에 실패했습니다.");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span>
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-sm font-medium text-gray-900 underline disabled:opacity-50"
      >
        {loading ? "불러오는 중..." : label}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}
