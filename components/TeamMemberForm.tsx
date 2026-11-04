"use client";

import { useActionState } from "react";
import { addTeamMemberAction, type ActionResult } from "@/app/student/actions";

export function TeamMemberForm({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    addTeamMemberAction,
    null,
  );

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        같은 클래스에 추가할 수 있는 다른 학생이 없습니다.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="studentId"
          required
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {pending ? "추가 중..." : "팀원 추가"}
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
