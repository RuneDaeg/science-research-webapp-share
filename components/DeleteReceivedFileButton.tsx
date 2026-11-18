"use client";

import { useState } from "react";
import { deleteReceivedFileAction } from "@/app/teacher/actions";

// '따로 받은 자료'의 파일 하나를 지운다. 되돌릴 수 없으므로 한 번 더 묻는다.
export function DeleteReceivedFileButton({ fileId }: { fileId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-gray-400 hover:text-red-600"
      >
        지우기
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        setDeleting(true);
        try {
          await deleteReceivedFileAction(formData);
        } finally {
          setDeleting(false);
          setConfirming(false);
        }
      }}
      className="flex items-center gap-2 text-xs"
    >
      <input type="hidden" name="fileId" value={fileId} />
      <span className="text-red-700">지울까요? 되돌릴 수 없습니다.</span>
      <button
        type="submit"
        disabled={deleting}
        className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {deleting ? "지우는 중..." : "지우기"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={deleting}
        className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        취소
      </button>
    </form>
  );
}
