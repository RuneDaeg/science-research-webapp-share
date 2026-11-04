"use client";

import { useEffect, useRef, useState } from "react";
import { parseJsonResponse } from "@/lib/fetchJson";
import { MAX_QUESTION_LENGTH, type ChatTurn } from "@/lib/ai/helpBot";

// 사용법 안내 챗봇. 학생·교사 레이아웃 오른쪽 아래에 떠 있다.
//
// 대화는 저장하지 않는다. 사용법 질문은 한 번 답을 들으면 끝나는 성격이고,
// 저장하면 DB와 개인정보 처리 범위만 늘어난다. 새로고침하면 초기화된다.

const SUGGESTIONS = [
  "한글 파일이 안 올라가요",
  "AI 피드백이 안 보여요",
  "참여 코드는 어디서 봐요?",
];

export function HelpChat() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 새 답변이 오면 아래로 붙인다.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setError(null);
    setInput("");
    // 질문을 먼저 화면에 올려 반응이 있게 한다. 답변은 그다음에 붙는다.
    const history = turns;
    setTurns([...history, { role: "user", content: trimmed }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      });
      const data = await parseJsonResponse<{ answer?: string; error?: string }>(res);
      if (!res.ok || !data.answer) throw new Error(data.error ?? "답변을 받지 못했습니다.");
      setTurns((prev) => [...prev, { role: "assistant", content: data.answer as string }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-gray-800"
        aria-label="사용법 도우미 열기"
      >
        <span aria-hidden="true">💬</span>
        사용법 도우미
      </button>
    );
  }

  return (
    <div className="fixed right-5 bottom-5 z-40 flex h-[30rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">사용법 도우미</p>
          <p className="text-xs text-gray-500">앱 사용 방법을 안내합니다</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              앱 사용 방법을 물어보세요. 탐구 내용에 대한 질문은 산출물을 올리면 AI 탐구 조력자가
              피드백해 드립니다.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <p
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                t.role === "user"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {t.content}
            </p>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">답변을 찾는 중...</p>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-center gap-2 border-t border-gray-200 px-3 py-2"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="예: 연구 일지는 어떻게 올려요?"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          보내기
        </button>
      </form>
    </div>
  );
}
