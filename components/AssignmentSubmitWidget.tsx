"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";
import { createClient } from "@/lib/supabase/client";
import { validateUploadedFile, FileValidationError } from "@/lib/validation/fileValidation";

// 학생이 과제에 파일을 제출한다.
//
// 파일은 브라우저에서 Storage로 곧장 올라간다 — 서버 함수를 거치지 않으므로 Vercel의
// 요청 본문 한도(4.5MB)에 걸리지 않는다. 산출물 업로드와 같은 구조다(AGENTS.md 참고).
export function AssignmentSubmitWidget({
  assignmentId,
  hasSubmission,
}: {
  assignmentId: string;
  hasSubmission: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"uploading" | "registering" | null>(null);
  // 여러 개를 올릴 때 몇 번째인지 보여준다 — 큰 파일이 섞이면 멈춘 것처럼 보인다.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const loading = phase !== null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      setError("파일을 선택해주세요.");
      return;
    }

    setError(null);

    // 서버도 같은 규칙으로 다시 검사한다. 여기서 먼저 거르는 건 20MB를 다 올린 뒤에야
    // "형식이 틀렸다"는 말을 듣는 상황을 막기 위해서다.
    for (const file of files) {
      try {
        validateUploadedFile(file);
      } catch (err) {
        setError(
          err instanceof FileValidationError
            ? `${file.name}: ${err.message}`
            : "파일을 확인할 수 없습니다.",
        );
        return;
      }
    }

    setProgress({ done: 0, total: files.length });

    // 한 건이라도 성공하면 그만큼은 제출된 것으로 남긴다. 중간에 실패해도 앞서 올린
    // 파일을 되돌리지 않는다 — 학생이 다시 올리면 되고, 되돌리면 오히려 제출물이 사라진다.
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        setPhase('uploading');
        setProgress({ done: index, total: files.length });

        const ticketRes = await fetch("/api/assignments/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId, filename: file.name, size: file.size }),
        });
        const ticket = await parseJsonResponse<{ path?: string; token?: string; error?: string }>(
          ticketRes,
        );
        if (!ticketRes.ok || !ticket.path || !ticket.token) {
          throw new Error(ticket.error ?? "업로드 준비에 실패했습니다.");
        }

        const { error: uploadError } = await createClient()
          .storage.from("research-files")
          .uploadToSignedUrl(ticket.path, ticket.token, file);
        if (uploadError) {
          throw new Error(`${file.name} 업로드에 실패했습니다: ${uploadError.message}`);
        }

        setPhase('registering');
        const res = await fetch("/api/assignments/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignmentId,
            path: ticket.path,
            originalFilename: file.name,
            // 메모는 첫 파일에만 실어 보낸다. 매번 보내면 같은 값이 덮어써질 뿐이다.
            note: index === 0 ? note : undefined,
          }),
        });
        const data = await parseJsonResponse<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error ?? "제출 등록에 실패했습니다.");

        uploaded += 1;
        setProgress({ done: uploaded, total: files.length });
      }

      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : '오류가 발생했습니다.';
      setError(
        uploaded > 0
          ? `${message} (${uploaded}개는 제출되었습니다)`
          : message,
      );
    } finally {
      setPhase(null);
      setProgress(null);
      router.refresh();
    }
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      <div className="space-y-1">
        <label htmlFor="submissionNote" className="text-sm font-medium text-gray-700">
          메모 <span className="font-normal text-gray-400">(선택 — 선생님께 전달됩니다)</span>
        </label>
        <textarea
          id="submissionNote"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 표 3번은 아직 정리 중이라 다음에 보완하겠습니다."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.hwpx,.txt"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-white"
      />
      <p className="text-xs text-gray-400">
        pdf, docx, hwpx, txt 지원 (각 최대 20MB) · 여러 개를 한 번에 고를 수 있습니다
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {phase === "uploading"
          ? progress && progress.total > 1
            ? `파일 올리는 중... (${progress.done + 1}/${progress.total})`
            : "파일 올리는 중..."
          : phase === "registering"
            ? "제출하는 중..."
            : hasSubmission
              ? "파일 더 제출하기"
              : "제출하기"}
      </button>

      {hasSubmission && (
        <p className="text-xs text-gray-500">
          이미 낸 파일은 그대로 두고 새 파일이 더해집니다. 지우려면 위 목록에서 삭제하세요.
        </p>
      )}
    </form>
  );
}
