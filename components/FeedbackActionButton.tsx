"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";

// mode "draft"  : 피드백이 없거나 실패했을 때 다시 생성
// mode "verify" : 기존 피드백을 2단계 검증 프롬프트로 재작성 (교사 전용)
export function FeedbackActionButton({
  documentId,
  mode,
  label,
  pendingLabel,
  variant = "primary",
}: {
  documentId: string;
  mode: "draft" | "verify";
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await parseJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const className =
    variant === "primary"
      ? "rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      : "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50";

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={handleClick} disabled={loading} className={className}>
        {loading ? pendingLabel : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
