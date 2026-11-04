import { createAdminClient } from "@/lib/supabase/admin";

// Supabase Free 플랜의 스토리지 한도. 관리자 화면에서 "얼마나 남았나"를 보여주는 기준선일 뿐,
// 코드가 이 값으로 업로드를 막지는 않는다(실제 상한은 버킷의 file_size_limit).
export const FREE_PLAN_STORAGE_BYTES = 1024 * 1024 * 1024; // 1GB

export interface StorageUsage {
  /** db = research_documents.file_size 합계(빠름) / scan = Storage 순회(느림, 0003 이전 폴백) */
  source: "db" | "scan";
  totalBytes: number;
  fileCount: number;
  largestBytes: number;
  /** file_size가 null인 산출물 수 — 0003 마이그레이션 이전에 올라온 것들 */
  unmeasuredCount: number;
  /** DB에 기록이 없는 오브젝트. 순회했을 때만 알 수 있어 db 경로에서는 null. */
  orphanCount: number | null;
  orphanBytes: number;
  byExtension: { ext: string; count: number; bytes: number }[];
}

function extensionOf(name: string): string {
  return name.toLowerCase().split(".").pop() || "기타";
}

function tally(rows: { name: string; size: number }[]) {
  const byExt = new Map<string, { count: number; bytes: number }>();
  let totalBytes = 0;
  let largestBytes = 0;

  for (const r of rows) {
    totalBytes += r.size;
    if (r.size > largestBytes) largestBytes = r.size;
    const ext = extensionOf(r.name);
    const cur = byExt.get(ext) ?? { count: 0, bytes: 0 };
    byExt.set(ext, { count: cur.count + 1, bytes: cur.bytes + r.size });
  }

  return {
    totalBytes,
    largestBytes,
    byExtension: [...byExt.entries()]
      .map(([ext, v]) => ({ ext, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

// ============================================================
// 기본 경로: DB 한 번 조회
// ============================================================
async function usageFromDb(): Promise<StorageUsage | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("research_documents")
    .select("original_filename, file_size");

  // 0003 마이그레이션 전이면 컬럼이 없어 실패한다. 그때만 순회 방식으로 넘어간다.
  if (error) return null;

  const rows = (data ?? []) as { original_filename: string; file_size: number | null }[];
  const measured = rows.filter((r) => typeof r.file_size === "number");

  return {
    source: "db",
    fileCount: measured.length,
    unmeasuredCount: rows.length - measured.length,
    orphanCount: null,
    orphanBytes: 0,
    ...tally(measured.map((r) => ({ name: r.original_filename, size: r.file_size as number }))),
  };
}

// ============================================================
// 폴백 경로: Storage 순회
// ============================================================
// Storage API에 재귀 조회가 없어 폴더마다 호출해야 한다. 느리지만 0003 적용 전까지는
// 이것뿐이고, 그 시점의 데이터는 작다. 고아 파일은 이 경로에서만 알 수 있다.
const CONCURRENCY = 8;

async function mapWithLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  }
  return results;
}

async function listAll(prefix: string, depth: number): Promise<{ path: string; size: number }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("research-files").list(prefix, { limit: 1000 });
  if (error || !data) return [];

  const files: { path: string; size: number }[] = [];
  const folders: string[] = [];

  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Storage list는 폴더를 id === null 인 항목으로 돌려준다.
    if (entry.id === null) {
      if (depth > 0) folders.push(path);
    } else {
      files.push({ path, size: entry.metadata?.size ?? 0 });
    }
  }

  const nested = await mapWithLimit(folders, (f) => listAll(f, depth - 1));
  return files.concat(...nested);
}

async function usageFromScan(): Promise<StorageUsage> {
  const admin = createAdminClient();
  const [objects, { data: docs }] = await Promise.all([
    listAll("", 2),
    admin.from("research_documents").select("file_path"),
  ]);

  const registered = new Set((docs ?? []).map((d) => d.file_path));
  const orphans = objects.filter((o) => !registered.has(o.path));

  return {
    source: "scan",
    fileCount: objects.length,
    unmeasuredCount: 0,
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((s, o) => s + o.size, 0),
    ...tally(objects.map((o) => ({ name: o.path, size: o.size }))),
  };
}

export async function collectStorageUsage(): Promise<StorageUsage> {
  return (await usageFromDb()) ?? (await usageFromScan());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 지금 평균 크기가 유지된다면 1GB에 몇 건이 들어가는지 — 추측 대신 실측으로 판단하기 위한 지표.
export function projectCapacity(usage: StorageUsage): number | null {
  if (usage.fileCount === 0 || usage.totalBytes <= 0) return null;
  return Math.floor(FREE_PLAN_STORAGE_BYTES / (usage.totalBytes / usage.fileCount));
}
