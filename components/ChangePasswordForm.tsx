"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 6) {
      setMsg({ type: "err", text: "비밀번호는 6자 이상이어야 합니다." });
      return;
    }
    if (password !== confirm) {
      setMsg({ type: "err", text: "두 비밀번호가 일치하지 않습니다." });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setMsg({
        type: "err",
        text: /same/i.test(error.message)
          ? "이전과 다른 비밀번호를 입력해주세요."
          : "비밀번호 변경에 실패했습니다.",
      });
      return;
    }
    setPassword("");
    setConfirm("");
    setMsg({ type: "ok", text: "비밀번호가 변경되었습니다." });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      <div className="space-y-1">
        <label htmlFor="new-password" className="text-sm font-medium text-gray-700">
          새 비밀번호
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">
          새 비밀번호 확인
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      {msg && (
        <p className={`text-sm ${msg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "변경 중..." : "비밀번호 변경"}
      </button>
    </form>
  );
}
