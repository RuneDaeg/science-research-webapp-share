"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { saveTeacherFeedbackAction } from "@/app/teacher/actions";

// 미리보기를 켤 때만 내려받는다. react-markdown과 KaTeX는 덩치가 커서 정적으로 import하면
// 미리보기를 쓰지 않는 선생님에게도 전부 실린다. 산출물이 여러 개인 페이지라 더 그렇다.
const FeedbackMarkdown = dynamic(() => import("@/components/FeedbackMarkdown"), {
  ssr: false,
  loading: () => <p className="text-xs text-blue-600">미리보기를 불러오는 중...</p>,
});

export function TeacherFeedbackForm({
  documentId,
  projectId,
  initialBody,
  initialVisible,
}: {
  documentId: string;
  projectId: string;
  initialBody: string | null;
  initialVisible: boolean;
}) {
  const [saving, setSaving] = useState(false);
  // 미리보기를 실시간으로 갱신하려면 textarea가 제어 컴포넌트여야 한다.
  const [body, setBody] = useState(initialBody ?? "");
  const [preview, setPreview] = useState(false);

  return (
    <form
      action={async (formData) => {
        setSaving(true);
        try {
          await saveTeacherFeedbackAction(formData);
        } finally {
          setSaving(false);
        }
      }}
      className="space-y-2"
    >
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-semibold text-blue-800">선생님 피드백</label>
        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          className="text-xs font-medium text-blue-700 underline underline-offset-2"
        >
          {preview ? "미리보기 닫기" : "미리보기"}
        </button>
      </div>
      <textarea
        name="body"
        rows={4}
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="AI 피드백을 확인한 뒤, 학생에게 직접 남길 지도 내용을 적어주세요."
        className="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
      />

      {preview && (
        <div className="space-y-1">
          <p className="text-xs text-blue-700">학생에게 보이는 모습</p>
          <div className="rounded-md border border-blue-200 bg-white p-3">
            {body.trim() ? (
              <FeedbackMarkdown className="text-blue-950">{body}</FeedbackMarkdown>
            ) : (
              <p className="text-xs text-gray-400">내용을 입력하면 여기에 표시됩니다.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-blue-800">
          <input
            type="checkbox"
            name="visibleToStudent"
            defaultChecked={initialVisible}
            className="h-4 w-4 rounded border-blue-300"
          />
          학생에게 공개
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "저장 중..." : initialBody ? "피드백 수정" : "피드백 저장"}
        </button>
      </div>
    </form>
  );
}
