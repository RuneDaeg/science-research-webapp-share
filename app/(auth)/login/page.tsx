"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // 자격 증명 오류만 "비밀번호가 틀렸다"로 안내한다. 설정 누락·네트워크 장애·서버 오류까지
        // 같은 문구로 뭉뚱그리면 실제 장애 상황에서 원인을 전혀 알 수 없다.
        const isBadCredentials =
          error.status === 400 || /invalid login credentials/i.test(error.message);
        setError(
          isBadCredentials
            ? "이메일 또는 비밀번호가 올바르지 않습니다."
            : `로그인에 실패했습니다: ${error.message}`,
        );
        setLoading(false);
        return;
      }
    } catch (err) {
      // createClient() 단계에서 던지는 설정 오류(환경변수 누락 등)도 화면에 드러낸다.
      setError(`로그인 처리 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">로그인</h1>
        <p className="mt-1 text-sm text-gray-500">과학과제연구 탐구 도우미</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-gray-700">
          이메일
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium text-gray-700">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? "로그인 중..." : "로그인"}
      </button>

      <p className="text-center text-sm text-gray-500">
        계정이 없으신가요?{" "}
        <Link href="/signup" className="font-medium text-gray-900 underline">
          회원가입
        </Link>
      </p>
    </form>
  );
}
