"use client";

import { useState } from "react";

// 연구 과제 삭제 버튼. 학생 화면과 교사 화면이 함께 쓴다 — 실행할 서버 액션만 다르다.
//
// 되돌릴 수 없고 산출물과 피드백까지 함께 사라지므로, 한 번 더 확인하고 무엇이 지워지는지
// 숫자로 보여준 뒤 실행한다.
export function DeleteProjectButton({
  projectId,
  documentCount,
  action,
  label = "연구 과제 삭제",
  extraWarning,
}: {
  projectId: string;
  documentCount: number;
  action: (formData: FormData) => Promise<void>;
  label?: string;
  /** 교사 화면처럼 추가로 알려야 할 것이 있을 때 */
  extraWarning?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        {label}
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        setDeleting(true);
        try {
          await action(formData);
        } finally {
          setDeleting(false);
        }
      }}
      className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-sm font-medium text-red-900">정말 삭제할까요?</p>
      <p className="text-xs leading-relaxed text-red-800">
        {documentCount > 0
          ? `제출한 산출물 ${documentCount}건과 그에 달린 AI 피드백·선생님 피드백이 함께 삭제됩니다.`
          : "이 연구 과제가 삭제됩니다."}{" "}
        <strong>되돌릴 수 없습니다.</strong>
        {extraWarning && <> {extraWarning}</>}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={deleting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {deleting ? "삭제 중..." : "삭제합니다"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </form>
  );
}
