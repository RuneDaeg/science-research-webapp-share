"use client";

import { useRef, useState } from "react";
import { createAnnouncementAction } from "@/app/teacher/actions";

export function AnnouncementForm({ classId }: { classId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        setSaving(true);
        try {
          await createAnnouncementAction(formData);
          formRef.current?.reset();
        } finally {
          setSaving(false);
        }
      }}
      className="space-y-2 rounded-lg border border-gray-200 bg-white p-4"
    >
      <input type="hidden" name="classId" value={classId} />
      <textarea
        name="body"
        rows={3}
        required
        placeholder="학생 전체에게 보낼 공지를 입력하세요"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
      />
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "게시 중..." : "공지 보내기"}
      </button>
    </form>
  );
}
