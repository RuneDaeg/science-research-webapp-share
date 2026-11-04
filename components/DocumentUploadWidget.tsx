"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/fetchJson";
import { createClient } from "@/lib/supabase/client";
import { STAGE_LABEL, STAGE_ORDER } from "@/lib/research/stage";
import { validateUploadedFile, FileValidationError } from "@/lib/validation/fileValidation";
import type { DocumentStage } from "@/lib/types/db";

export function DocumentUploadWidget({
  projectId,
  nextJournalRound,
}: {
  projectId: string;
  nextJournalRound: number;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<DocumentStage>("plan");
  const [title, setTitle] = useState("");
  const [roundNo, setRoundNo] = useState(String(nextJournalRound));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // null이면 대기 상태. 단계마다 걸리는 시간이 많이 달라서 구분해 보여준다 —
  // 특히 'feedback' 단계에 들어갔다는 것은 제출이 이미 확정됐다는 뜻이다.
  const [phase, setPhase] = useState<"uploading" | "registering" | "feedback" | null>(null);
  const loading = phase !== null;

  // 파일은 이 컴포넌트에서 Storage로 곧장 올라간다. 서버 함수를 거치지 않으므로
  // Vercel의 요청 본문 한도(4.5MB)에 걸리지 않는다. 서버는 앞뒤로 권한과 크기만 확인한다.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("파일을 선택해주세요.");
      return;
    }

    setError(null);
    setWarning(null);

    // 서버도 같은 규칙으로 다시 검사한다. 여기서 먼저 거르는 건 20MB 파일을 다 올린
    // 뒤에야 "형식이 틀렸다"는 말을 듣는 상황을 막기 위해서다.
    try {
      validateUploadedFile(file);
    } catch (err) {
      setError(err instanceof FileValidationError ? err.message : "파일을 확인할 수 없습니다.");
      return;
    }

    setPhase("uploading");

    try {
      // 1단계: 올릴 자리와 일회용 업로드 티켓을 받는다.
      const ticketRes = await fetch("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filename: file.name, size: file.size }),
      });
      const ticket = await parseJsonResponse<{ path?: string; token?: string; error?: string }>(
        ticketRes,
      );
      if (!ticketRes.ok || !ticket.path || !ticket.token) {
        throw new Error(ticket.error ?? "업로드 준비에 실패했습니다.");
      }

      // 2단계: 브라우저 → Storage 직접 전송.
      const { error: uploadError } = await createClient()
        .storage.from("research-files")
        .uploadToSignedUrl(ticket.path, ticket.token, file);
      if (uploadError) {
        throw new Error(`파일 업로드에 실패했습니다: ${uploadError.message}`);
      }

      // 3단계: 산출물로 등록한다. 여기까지 성공하면 제출은 확정이다.
      setPhase("registering");
      const res = await fetch("/api/documents/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          path: ticket.path,
          stage,
          title,
          note,
          roundNo: stage === "journal" ? roundNo : null,
          originalFilename: file.name,
        }),
      });
      const data = await parseJsonResponse<{ document?: { id: string }; error?: string }>(res);
      if (!res.ok || !data.document) throw new Error(data.error ?? "산출물 등록에 실패했습니다.");

      // 여기서부터는 실패해도 '제출 실패'가 아니다. 입력칸을 먼저 비우고 목록을 갱신해
      // 학생이 자기 제출물이 등록된 것을 바로 확인할 수 있게 한다.
      setTitle("");
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();

      // 4단계: AI 피드백 요청. 별도 요청이라 오래 걸리거나 실패해도 산출물은 남는다.
      setPhase("feedback");
      await requestFeedback(data.document.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setPhase(null);
    }
  }

  // 피드백 생성 실패는 오류가 아니라 경고로 다룬다 — 제출은 이미 끝났고, 산출물 목록의
  // '다시 받기' 버튼으로 언제든 복구할 수 있기 때문이다.
  async function requestFeedback(documentId: string) {
    try {
      const res = await fetch(`/api/feedback/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "draft" }),
      });
      const data = await parseJsonResponse<{ error?: string }>(res);
      if (!res.ok) {
        setWarning(
          `${data.error ?? "AI 피드백 생성에 실패했습니다."} 제출은 정상 완료되었으니, 아래 목록에서 '다시 받기'를 눌러주세요.`,
        );
      }
      router.refresh();
    } catch (err) {
      setWarning(
        `${err instanceof Error ? err.message : "AI 피드백 생성에 실패했습니다."} 제출은 정상 완료되었습니다. 아래 목록에서 '다시 받기'를 눌러주세요.`,
      );
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="stage" className="text-sm font-medium text-gray-700">
            산출물 단계
          </label>
          <select
            id="stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as DocumentStage)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          >
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400">
            선택한 단계에 맞는 기준으로 AI 피드백이 생성됩니다.
          </p>
        </div>

        {stage === "journal" && (
          <div className="space-y-1">
            <label htmlFor="roundNo" className="text-sm font-medium text-gray-700">
              일지 회차
            </label>
            <input
              id="roundNo"
              type="number"
              min={1}
              value={roundNo}
              onChange={(e) => setRoundNo(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="docTitle" className="text-sm font-medium text-gray-700">
          제목 <span className="font-normal text-gray-400">(비워두면 파일명을 씁니다)</span>
        </label>
        <input
          id="docTitle"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 온도에 따른 효소 활성 측정 1차"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="note" className="text-sm font-medium text-gray-700">
          메모 <span className="font-normal text-gray-400">(선택 — AI에게 함께 전달됩니다)</span>
        </label>
        <textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 3회차부터 온도 간격을 5℃로 바꿨어요. 이 부분이 타당한지 봐주세요."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.hwpx,.txt"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-white"
      />
      <p className="text-xs text-gray-400">pdf, docx, hwpx, txt 지원 (최대 20MB)</p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {warning && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {phase === "uploading"
          ? "파일 올리는 중..."
          : phase === "registering"
            ? "제출하는 중..."
            : phase === "feedback"
              ? "AI 피드백 받는 중..."
              : "제출하고 AI 피드백 받기"}
      </button>
      {phase === "feedback" && (
        <p className="text-xs text-gray-500">
          제출은 완료되었습니다. AI가 산출물을 읽고 있으며 최대 1~2분 걸릴 수 있어요 — 이 화면을
          닫아도 제출은 그대로 남고, 피드백은 아래 목록에서 다시 받을 수 있습니다.
        </p>
      )}
    </form>
  );
}
