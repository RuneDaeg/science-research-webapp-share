"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";
import type { SetukDraftResult } from "@/lib/types/db";

// 기재요령의 과목별 세특 최대 글자수(한글 기준). lib/ai/setuk.ts의 SETUK_MAX_CHARS와 같은 값이다 —
// 그 파일은 서버 전용 모듈을 불러와 클라이언트에서 import할 수 없어 여기 다시 적는다.
const MAX_CHARS = 500;
const MEMO_MAX = 1000;

// 세특 참고 초안. 교사 화면 전용이다.
//
// 관찰 메모를 먼저 받는 이유: 기재요령상 서술형 항목은 교사가 직접 관찰·평가한 내용을 바탕으로 쓰는
// 것이 원칙이고, AI 생성 자료를 그대로 입력하는 것은 금지된다(「작성 시 유의사항」 5-다). 메모가
// 초안의 가장 앞선 근거가 되고, 파일로만 쓴 초안은 '교사가 덧붙일 것'을 함께 보여 준다.
export function SetukPanel({
  classId,
  studentId,
  initialMemo,
  result,
  stale,
  meta,
}: {
  classId: string;
  studentId: string;
  initialMemo: string;
  result: SetukDraftResult | null;
  stale: boolean;
  meta: string | null; // "2026. 11. 17. 오전 1:24 · gemini-3.8-flash"
}) {
  const router = useRouter();
  const [memo, setMemo] = useState(initialMemo);
  const [busy, setBusy] = useState<"memo" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const memoDirty = memo.trim() !== initialMemo.trim();

  async function send(memoOnly: boolean) {
    setBusy(memoOnly ? "memo" : "draft");
    setError(null);
    try {
      const res = await fetch("/api/classes/setuk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, studentId, memo, memoOnly, force: !memoOnly }),
      });
      const data = await parseJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("복사하지 못했습니다. 초안을 직접 선택해 복사해 주세요.");
    }
  }

  const length = result?.draft.length ?? 0;

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <div className="space-y-1">
        <label htmlFor={`memo-${studentId}`} className="text-sm font-medium text-gray-800">
          선생님 관찰 메모{" "}
          <span className="font-normal text-gray-400">
            (선택 — 수업 태도, 발표, 질의응답, 모둠 활동처럼 파일로 알 수 없는 것)
          </span>
        </label>
        <textarea
          id={`memo-${studentId}`}
          rows={3}
          maxLength={MEMO_MAX}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="예: 예비 실험에서 거품이 넘친 문제를 스스로 찾아 시약 양을 줄여 다시 실험함. 발표 때 이상값을 숨기지 않고 측정 과정을 들어 질문에 답함."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => send(false)}
            disabled={busy !== null}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {busy === "draft"
              ? "초안 만드는 중... (30초쯤)"
              : result
                ? memoDirty
                  ? "메모 저장하고 다시 만들기"
                  : "다시 만들기"
                : "세특 초안 만들기"}
          </button>
          {memoDirty && (
            <button
              type="button"
              onClick={() => send(true)}
              disabled={busy !== null}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === "memo" ? "저장 중..." : "메모만 저장"}
            </button>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>

      {result && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">AI 참고 초안</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${length > MAX_CHARS ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700"}`}
              >
                {length} / {MAX_CHARS}자
              </span>
              {stale && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                  파일이나 메모가 바뀜 — 다시 만들기 필요
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              {copied ? "복사됨" : "초안 복사"}
            </button>
          </div>

          <p className="rounded-md bg-gray-50 p-3 leading-relaxed whitespace-pre-wrap text-gray-900">
            {result.draft}
          </p>

          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <span className="font-medium">그대로 입력하지 마세요.</span> 2026학년도 기재요령은 AI로
            생성한 자료를 서술형 항목에 그대로 입력하는 것을 금지합니다. 아래 근거와 선생님의 관찰을
            대조해 허위·과장이 없는지 확인하고 직접 고쳐 쓴 뒤 입력해 주세요.
          </div>

          {result.evidence.length > 0 && (
            <details className="text-xs text-gray-700">
              <summary className="cursor-pointer font-medium text-gray-800">
                내용별 근거 {result.evidence.length}개
              </summary>
              <ul className="mt-2 space-y-1">
                {result.evidence.map((e, i) => (
                  <li key={i}>
                    {e.point} <span className="text-gray-500">← {e.source}</span>
                  </li>
                ))}
              </ul>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-gray-500">
                {result.files.map((f) => (
                  <li key={f.no}>{f.label}</li>
                ))}
              </ol>
            </details>
          )}

          {result.checks.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              <p className="mb-1 font-medium">기재요령상 확인할 것</p>
              <ul className="list-disc space-y-1 pl-4">
                {result.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {result.teacher_additions.length > 0 && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
              <p className="mb-1 font-medium">선생님이 관찰해서 덧붙이면 좋을 것</p>
              <ul className="list-disc space-y-1 pl-4">
                {result.teacher_additions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {meta && <p className="text-[11px] text-gray-500">{meta}</p>}
        </div>
      )}
    </div>
  );
}
