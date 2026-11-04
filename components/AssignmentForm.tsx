"use client";

import { useActionState } from "react";
import { createAssignmentAction, type ActionResult } from "@/app/teacher/actions";

// 교사가 과제/평가 글을 올리는 폼.
export function AssignmentForm({ classId }: { classId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createAssignmentAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
      // 등록에 성공하면 입력칸을 비운다. key를 바꾸는 방법도 있지만 폼이 통째로 다시
      // 마운트되면서 포커스가 튀어 이쪽을 택했다.
      key={state?.ok ? "reset" : "form"}
    >
      <input type="hidden" name="classId" value={classId} />

      <div className="space-y-1">
        <label htmlFor="assignmentTitle" className="text-sm font-medium text-gray-700">
          과제 제목
        </label>
        <input
          id="assignmentTitle"
          name="title"
          required
          placeholder="예: 1차 중간 보고서 제출"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="assignmentBody" className="text-sm font-medium text-gray-700">
          안내 <span className="font-normal text-gray-400">(선택)</span>
        </label>
        <textarea
          id="assignmentBody"
          name="body"
          rows={3}
          placeholder="제출 형식, 분량, 평가 기준 등을 적어주세요."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="assignmentDue" className="text-sm font-medium text-gray-700">
          마감 일시 <span className="font-normal text-gray-400">(선택)</span>
        </label>
        <input
          id="assignmentDue"
          name="dueAt"
          type="datetime-local"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <p className="text-xs text-gray-400">
          마감이 지나도 제출은 막지 않습니다. 목록에 &lsquo;마감 지남&rsquo;으로만 표시됩니다.
        </p>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "등록 중..." : "과제 등록"}
      </button>
    </form>
  );
}
