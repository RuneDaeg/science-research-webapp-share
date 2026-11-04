"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    // 학생만 자율 가입 가능. 교사·관리자 계정은 관리자가 발급한다
    // (역할은 서버 트리거가 항상 student로 강제하므로 여기서 role을 보낼 필요가 없다).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });

    if (error) {
      setError(
        error.message.includes("already registered") ? "이미 가입된 이메일입니다." : error.message,
      );
      setLoading(false);
      return;
    }

    if (!data.session) {
      // 프로젝트에 이메일 확인이 켜져 있는 경우
      setNeedsEmailConfirm(true);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (needsEmailConfirm) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-bold text-gray-900">이메일을 확인해주세요</h1>
        <p className="text-sm text-gray-600">
          {email}로 발송된 확인 메일의 링크를 클릭한 뒤 로그인해주세요.
        </p>
        <Link href="/login" className="inline-block text-sm font-medium text-gray-900 underline">
          로그인으로 이동
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">학생 회원가입</h1>
      <p className="text-sm text-gray-500">선생님 계정은 관리자에게 문의해 발급받으세요.</p>

      <div className="space-y-1">
        <label htmlFor="displayName" className="text-sm font-medium text-gray-700">
          이름
        </label>
        <input
          id="displayName"
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
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
          minLength={6}
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
        {loading ? "가입 중..." : "회원가입"}
      </button>

      <p className="text-center text-sm text-gray-500">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="font-medium text-gray-900 underline">
          로그인
        </Link>
      </p>
    </form>
  );
}
