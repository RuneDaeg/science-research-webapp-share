"use client";

import { useActionState } from "react";
import { createTeacherAction, type CreateTeacherResult } from "@/app/admin/actions";

export function CreateTeacherForm() {
  const [state, formAction, pending] = useActionState<CreateTeacherResult | null, FormData>(
    createTeacherAction,
    null,
  );

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="displayName" className="text-sm font-medium text-gray-700">
              이름
            </label>
            <input
              id="displayName"
              name="displayName"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">
              이메일
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>
        </div>

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "발급 중..." : "교사 계정 발급"}
        </button>
      </form>

      {state?.ok && state.tempPassword && (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-5">
          <p className="text-sm font-semibold text-green-900">
            계정이 발급되었습니다. 아래 정보를 선생님께 전달해주세요.
          </p>
          <dl className="space-y-1 text-sm text-green-900">
            <div className="flex gap-2">
              <dt className="w-24 text-green-700">이메일</dt>
              <dd className="font-mono font-medium">{state.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 text-green-700">임시 비밀번호</dt>
              <dd className="font-mono font-medium">{state.tempPassword}</dd>
            </div>
          </dl>
          <p className="text-xs text-green-700">
            이 비밀번호는 지금 한 번만 표시됩니다. 화면을 벗어나면 다시 볼 수 없으니 지금
            복사해두세요. 선생님께는 첫 로그인 후 계정 설정에서 비밀번호를 바꾸도록 안내해주세요.
          </p>
        </div>
      )}
    </div>
  );
}
