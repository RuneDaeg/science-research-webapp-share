"use client";

import { useActionState } from "react";
import { createClassAction, type ActionResult } from "@/app/teacher/actions";

export function ClassForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createClassAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium text-gray-700">
          클래스 이름
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="예: 2학년 과학과제연구 A반"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="schoolYear" className="text-sm font-medium text-gray-700">
          학년도/학기 <span className="font-normal text-gray-400">(선택)</span>
        </label>
        <input
          id="schoolYear"
          name="schoolYear"
          placeholder="예: 2026학년도 1학기"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "만드는 중..." : "클래스 만들기"}
      </button>
    </form>
  );
}
