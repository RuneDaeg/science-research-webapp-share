"use client";

import { useActionState } from "react";
import { createProjectAction, type ActionResult } from "@/app/student/actions";
import { FIELD_LABEL } from "@/lib/research/stage";
import type { ResearchField } from "@/lib/types/db";

const FIELDS = Object.keys(FIELD_LABEL) as ResearchField[];

export function ProjectForm({
  classes,
}: {
  classes: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createProjectAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="space-y-1">
        <label htmlFor="classId" className="text-sm font-medium text-gray-700">
          클래스
        </label>
        <select
          id="classId"
          name="classId"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="title" className="text-sm font-medium text-gray-700">
          연구 제목
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="예: 표면 거칠기에 따른 마찰 계수 변화 탐구"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="field" className="text-sm font-medium text-gray-700">
          탐구 분야
        </label>
        <select
          id="field"
          name="field"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        >
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {FIELD_LABEL[f]}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400">AI 피드백의 과목 기준이 됩니다.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="researchQuestion" className="text-sm font-medium text-gray-700">
          연구 질문 <span className="font-normal text-gray-400">(선택)</span>
        </label>
        <textarea
          id="researchQuestion"
          name="researchQuestion"
          rows={3}
          placeholder="예: 사포 번호(입자 크기)가 달라지면 나무 블록의 운동 마찰 계수는 어떻게 변할까?"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "등록 중..." : "연구 등록"}
      </button>
    </form>
  );
}
