"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";

// 과제별 채점(/api/assignments/grade, { submissionId })과 수행평가 종합 채점
// (/api/classes/grade-overall, { classId, studentId })이 함께 쓴다. 요청 본문만 다르다.
type GradeRequest = Record<string, string>;

async function requestGrade(endpoint: string, request: GradeRequest, force: boolean): Promise<void> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, force }),
  });
  const data = await parseJsonResponse<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "AI 채점에 실패했습니다.");
}

// 아직 채점하지 않았거나 채점 뒤 파일이 바뀐 학생을 차례로 채점한다.
//
// 한 요청에 한 명씩 보낸다. 반 전체를 한 요청으로 보내면 몇 분이 걸려 함수 제한을 넘기고,
// 끊기면 어디까지 됐는지 알 수 없다. 한 명이 실패해도 나머지는 계속한다.
export function GradeAllButton({
  endpoint,
  requests,
  confirmMessage,
  disabledReason,
  label = "AI 채점하기",
  runningLabel = "AI 채점 중",
}: {
  endpoint: string;
  requests: GradeRequest[];
  // 세특 초안처럼 채점이 아닌 일괄 작업에도 쓴다.
  label?: string;
  runningLabel?: string;
  // 확인 상자에 띄울 안내. 몇 명을 채점하는지는 앞에 붙여 준다.
  confirmMessage: string;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const running = progress !== null;

  async function run() {
    if (requests.length === 0) return;
    if (!window.confirm(`${requests.length}명 — ${label}. ${confirmMessage}`)) return;

    setFailures([]);
    const failed: string[] = [];
    for (const [i, request] of requests.entries()) {
      setProgress({ done: i, total: requests.length });
      try {
        await requestGrade(endpoint, request, false);
        router.refresh();
      } catch (err) {
        failed.push(err instanceof Error ? err.message : "알 수 없는 오류");
      }
    }
    setProgress(null);
    setFailures(failed);
    router.refresh();
  }

  const disabled = running || !!disabledReason || requests.length === 0;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {running
          ? `${runningLabel}... (${progress.done + 1}/${progress.total})`
          : requests.length > 0
            ? `${label} (${requests.length}명)`
            : `${label} — 대상 학생 없음`}
      </button>
      {disabledReason && <p className="text-xs text-gray-500">{disabledReason}</p>}
      {failures.length > 0 && (
        <p className="text-xs text-red-600">
          {failures.length}명은 처리하지 못했습니다: {[...new Set(failures)].join(" / ")}
        </p>
      )}
    </div>
  );
}

// 한 학생을 (다시) 채점한다. 결과가 이미 있어도 새로 만든다.
export function RegradeButton({
  endpoint,
  request,
  label,
}: {
  endpoint: string;
  request: GradeRequest;
  label: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      await requestGrade(endpoint, request, true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 채점에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
      >
        {loading ? "채점 중..." : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
