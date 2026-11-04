-- AI 호출에 걸린 시간을 기록한다.
--
-- 학생 화면에 "지금 AI 응답이 원활한지"를 표시하려면 최근 호출들이 실제로 얼마나 걸렸는지가
-- 필요하다. 호출 건수만으로는 몰림을 알 수 없다 — 같은 건수라도 문서 길이에 따라 소요 시간이
-- 크게 다르기 때문이다.
--
-- 이 마이그레이션 이전 기록은 null로 남고, 집계에서 제외된다.
alter table public.ai_usage_log
  add column if not exists duration_ms integer;

comment on column public.ai_usage_log.duration_ms is
  'AI 제공사 호출에 걸린 시간(밀리초). 성공한 호출만 기록된다. 0004 이전 기록은 null.';

-- 최근 N분치를 소요 시간 기준으로 훑는 쿼리를 위한 인덱스.
-- created_at 단독 인덱스가 이미 있지만, duration_ms가 있는 행만 보므로 부분 인덱스가 더 좁다.
create index if not exists ai_usage_log_duration_recent_idx
  on public.ai_usage_log (created_at desc)
  where duration_ms is not null;
