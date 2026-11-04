import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { CreateTeacherForm } from "@/components/CreateTeacherForm";
import { getServerCredentialStatus, getDailyLimitPerStudent } from "@/lib/ai/serverCredential";
import { PROVIDER_LABEL, type AiProvider } from "@/lib/ai/types";
import { daysAgoIso, formatKstDate } from "@/lib/datetime";
import {
  collectStorageUsage,
  formatBytes,
  projectCapacity,
  FREE_PLAN_STORAGE_BYTES,
} from "@/lib/storage/usage";

const AI_ERROR_LABEL: Record<string, string> = {
  timeout: "응답 지연·끊김",
  ai_error: "제공사 오류",
  refusal: "안전 정책 거절",
  rate_limit: "학생 일일 상한 초과",
  config: "설정 문제 (키 미설정 등)",
};

export default async function AdminPage() {
  await requireRole("admin");

  // 관리자는 전체 교사 목록을 볼 RLS 경로가 없으므로 service-role로 조회한다(서버 전용).
  const admin = createAdminClient();

  const { data: teachers } = await admin
    .from("profiles")
    .select("id, display_name, created_at")
    .eq("role", "teacher")
    .order("created_at", { ascending: false });

  // 학생 목록과 소속 클래스. 학생은 여러 클래스에 속할 수 있어 등록 정보를 따로 모아 붙인다.
  const { data: students } = await admin
    .from("profiles")
    .select("id, display_name, created_at")
    .eq("role", "student")
    .order("created_at", { ascending: false });

  const { data: enrollments } = await admin
    .from("class_enrollments")
    .select("student_id, class_id");

  const since = daysAgoIso(7);
  const { data: recentUsage } = await admin
    .from("ai_usage_log")
    .select("id, kind, class_id, created_at, ok, error_kind")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  // 실패는 원인별로 나눠 본다. 몰림(timeout/ai_error)과 문서 문제(refusal), 상한 초과는
  // 대응이 완전히 다르기 때문이다.
  const failuresByKind = new Map<string, number>();
  for (const row of recentUsage ?? []) {
    if (row.ok) continue;
    const key = row.error_kind ?? "unknown";
    failuresByKind.set(key, (failuresByKind.get(key) ?? 0) + 1);
  }
  const failureRows = [...failuresByKind.entries()].sort((a, b) => b[1] - a[1]);
  const failureTotal = failureRows.reduce((s, [, n]) => s + n, 0);

  const { data: classes } = await admin.from("classes").select("id, name");
  const classNameById = new Map((classes ?? []).map((c) => [c.id, c.name]));

  const usageByClass = new Map<string, number>();
  for (const row of recentUsage ?? []) {
    const key = row.class_id ?? "unknown";
    usageByClass.set(key, (usageByClass.get(key) ?? 0) + 1);
  }
  const usageRows = [...usageByClass.entries()].sort((a, b) => b[1] - a[1]);

  // 클래스 이름은 위 classNameById(호출량 집계용)를 그대로 재사용한다.
  const classNamesByStudent = new Map<string, string[]>();
  for (const e of enrollments ?? []) {
    const name = classNameById.get(e.class_id);
    if (!name) continue;
    const list = classNamesByStudent.get(e.student_id) ?? [];
    list.push(name);
    classNamesByStudent.set(e.student_id, list);
  }

  // 클래스별로 묶여 보이도록 정렬한다. 아직 어느 클래스에도 참여하지 않은 학생은 맨 뒤로
  // 보낸다 — 가입만 하고 참여 코드를 넣지 않은 경우라 따로 챙겨야 한다.
  const studentRows = (students ?? [])
    .map((s) => ({
      id: s.id,
      name: s.display_name?.trim() || "(이름 없음)",
      classes: (classNamesByStudent.get(s.id) ?? []).sort((a, b) => a.localeCompare(b, "ko")),
    }))
    .sort((a, b) => {
      const ac = a.classes[0] ?? "";
      const bc = b.classes[0] ?? "";
      if (!ac !== !bc) return ac ? -1 : 1;
      return ac.localeCompare(bc, "ko") || a.name.localeCompare(b.name, "ko");
    });

  const unassignedCount = studentRows.filter((s) => s.classes.length === 0).length;

  const cred = getServerCredentialStatus();
  const dailyLimit = getDailyLimitPerStudent();

  const { count: documentCount } = await admin
    .from("research_documents")
    .select("id", { count: "exact", head: true });

  // 버킷을 폴더 단위로 훑어야 해서 산출물이 많아지면 이 페이지가 느려진다.
  // 관리자만 가끔 여는 화면이라 감수한다.
  const storage = await collectStorageUsage();
  const storagePercent = (storage.totalBytes / FREE_PLAN_STORAGE_BYTES) * 100;
  const capacity = projectCapacity(storage);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">관리자</h1>
        <p className="mt-1 text-sm text-gray-500">
          교사 계정 발급과 AI 사용량을 관리합니다.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">생성형 AI 설정</h2>
        <dl className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white text-sm">
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">API 키</dt>
            <dd className={`font-medium ${cred.hasKey ? "text-green-700" : "text-red-600"}`}>
              {cred.hasKey ? "설정됨" : "설정되지 않음 (AI_API_KEY 환경변수 필요)"}
            </dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">제공사</dt>
            <dd className="font-medium text-gray-900">
              {PROVIDER_LABEL[cred.provider as AiProvider] ?? cred.provider}
            </dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">모델</dt>
            <dd className="font-mono font-medium text-gray-900">{cred.model ?? "-"}</dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">폴백 모델 (한도 초과 · 과부하 시)</dt>
            <dd className="font-mono font-medium text-gray-900">{cred.fallbackModel ?? "없음"}</dd>
          </div>
          <div className="flex justify-between px-4 py-3">
            <dt className="text-gray-500">학생 1인당 일일 상한</dt>
            <dd className="font-medium text-gray-900">
              {dailyLimit > 0 ? `${dailyLimit}회` : "제한 없음"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-gray-400">
          키는 서버 환경변수에만 저장되며 DB나 브라우저로 내려가지 않습니다. 값을 바꾸려면
          배포 환경변수를 수정한 뒤 재배포하세요.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">저장공간 사용량</h2>

        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-gray-900">
              <span className="text-2xl font-bold">{formatBytes(storage.totalBytes)}</span>
              <span className="text-gray-500"> / {formatBytes(FREE_PLAN_STORAGE_BYTES)}</span>
            </p>
            <p className="text-sm font-medium text-gray-700">{storagePercent.toFixed(1)}% 사용</p>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${
                storagePercent > 80
                  ? "bg-red-500"
                  : storagePercent > 50
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(storagePercent, 100)}%` }}
            />
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-gray-500">산출물</dt>
              <dd className="font-medium text-gray-900">{documentCount ?? 0}건</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">파일</dt>
              <dd className="font-medium text-gray-900">{storage.fileCount}개</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">평균 크기</dt>
              <dd className="font-medium text-gray-900">
                {storage.fileCount > 0
                  ? formatBytes(Math.round(storage.totalBytes / storage.fileCount))
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">최대 크기</dt>
              <dd className="font-medium text-gray-900">
                {storage.fileCount > 0 ? formatBytes(storage.largestBytes) : "-"}
              </dd>
            </div>
          </dl>

          {capacity !== null && (
            <p className="text-xs text-gray-500">
              지금 평균 크기({formatBytes(Math.round(storage.totalBytes / storage.fileCount))})가
              유지되면 <span className="font-medium text-gray-700">약 {capacity.toLocaleString()}건</span>
              까지 담을 수 있습니다. 사진이 많이 들어간 보고서가 늘면 이 수치는 빠르게 줄어듭니다.
            </p>
          )}

          {storage.unmeasuredCount > 0 && (
            <p className="text-xs text-gray-500">
              이 중 {storage.unmeasuredCount}건은 파일 크기를 기록하기 전에 올라와 합계에 빠져
              있습니다. 새로 올라오는 산출물부터는 모두 집계됩니다.
            </p>
          )}

          {storage.byExtension.length > 0 && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100 pt-1 text-sm">
              {storage.byExtension.map((row) => (
                <li key={row.ext} className="flex items-center justify-between py-1.5">
                  <span className="font-mono text-xs text-gray-600">.{row.ext}</span>
                  <span className="text-gray-500">
                    {row.count}개 · {formatBytes(row.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {storage.orphanCount !== null && storage.orphanCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">
              고아 파일 {storage.orphanCount}개 ({formatBytes(storage.orphanBytes)})
            </p>
            <p className="mt-1 text-xs leading-relaxed">
              업로드는 됐지만 산출물로 등록되지 않은 파일입니다. 학생이 업로드 도중 화면을 닫으면
              생깁니다. 학생에게도 선생님에게도 보이지 않으며 용량만 차지하므로, 쌓이면 정리하면
              됩니다.
            </p>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Supabase Free 플랜 기준 1GB입니다. 한도에 가까워지면 학기가 끝난 산출물의 원본 파일을
          삭제하는 것만으로도 대부분 회수됩니다(AI 피드백과 기록은 DB에 남습니다).
          {storage.source === "scan" &&
            " 지금은 Storage를 직접 훑어 집계하고 있어 산출물이 늘면 이 화면이 느려집니다 — 0003 마이그레이션을 적용하면 DB 합계로 바뀝니다."}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">최근 7일 AI 호출량</h2>
        {usageRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            최근 7일간 AI 호출 기록이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {usageRows.map(([classId, count]) => (
              <li key={classId} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-gray-900">
                  {classNameById.get(classId) ?? "(클래스 정보 없음)"}
                </span>
                <span className="font-medium text-gray-700">{count}회</span>
              </li>
            ))}
          </ul>
        )}
        {failureTotal > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">실패 {failureTotal}회</p>
            <ul className="space-y-1 text-xs">
              {failureRows.map(([kind, count]) => (
                <li key={kind} className="flex items-center justify-between">
                  <span>{AI_ERROR_LABEL[kind] ?? kind}</span>
                  <span className="font-medium">{count}회</span>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-relaxed">
              응답 지연·제공사 오류가 잦으면 학생 화면의 AI 응답 상태가 &lsquo;혼잡&rsquo;으로
              바뀝니다. 안전 거절은 특정 산출물의 문제이고, 일일 상한 초과는 정상 동작입니다.
            </p>
          </div>
        )}

        <p className="text-xs text-gray-400">
          전체 {recentUsage?.length ?? 0}회 (최근 500건까지 집계)
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">교사 계정 발급</h2>
        <p className="text-sm text-gray-500">
          교사는 스스로 가입할 수 없습니다. 여기서 발급한 임시 비밀번호를 전달해주세요.
        </p>
        <CreateTeacherForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">교사 목록</h2>
        {!teachers || teachers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 발급된 교사 계정이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {teachers.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">
                  {t.display_name?.trim() || "(이름 없음)"}
                </span>
                <span className="text-gray-500">{formatKstDate(t.created_at)} 발급</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          학생 목록 {studentRows.length > 0 && `(${studentRows.length}명)`}
        </h2>
        {studentRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            아직 가입한 학생이 없습니다.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {studentRows.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="font-medium text-gray-900">{s.name}</span>
                  {s.classes.length > 0 ? (
                    <span className="text-gray-600">{s.classes.join(", ")}</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      클래스 미참여
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {unassignedCount > 0 && (
              <p className="text-xs text-gray-500">
                {unassignedCount}명이 아직 어느 클래스에도 참여하지 않았습니다. 가입은 했지만
                참여 코드를 입력하지 않은 상태입니다.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
