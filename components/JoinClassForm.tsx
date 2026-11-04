"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";

export function JoinClassForm() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/classes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode }),
      });
      const data = await parseJsonResponse<{ class?: { name: string }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "클래스 참여에 실패했습니다.");
      setMsg({ type: "ok", text: `"${data.class?.name}" 클래스에 참여했습니다.` });
      setJoinCode("");
      router.refresh();
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      <div className="space-y-1">
        <label htmlFor="joinCode" className="text-sm font-medium text-gray-700">
          참여 코드
        </label>
        <input
          id="joinCode"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          required
          maxLength={10}
          placeholder="선생님께 받은 6자리 코드"
          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm tracking-widest text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      {msg && (
        <p className={`text-sm ${msg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? "참여 중..." : "클래스 참여"}
      </button>
    </form>
  );
}
