-- 실패한 AI 호출도 기록한다.
--
-- 지금까지는 성공한 호출만 로그에 남아서, 응답이 느려지다 결국 타임아웃으로 끊기는 상황이
-- 지표에 전혀 잡히지 않았다. 오히려 느린 호출이 실패로 빠지면서 성공 건들의 중앙값만
-- 남아 "원활"로 보이는 역전까지 생긴다. 학생 화면의 응답 상태를 믿을 수 있게 하려면
-- 실패율이 필요하다.
--
-- 기존 행은 전부 성공 기록이므로 기본값 true가 맞다.
alter table public.ai_usage_log
  add column if not exists ok boolean not null default true;

-- 실패 원인 구분. 모든 실패가 '혼잡'을 뜻하지는 않기 때문에 반드시 나눠서 봐야 한다.
--   timeout    : 제공사 응답 지연/끊김 — 혼잡 판정에 반영한다
--   ai_error   : 그 밖의 제공사 오류 — 혼잡 판정에 반영한다
--   refusal    : 안전 분류기 거절 — 특정 문서의 문제지 몰림이 아니다
--   rate_limit : 학생 일일 상한 초과 — 정상 동작이지 장애가 아니다
--   config     : 키 미설정 등 설정 문제 — 몰림과 무관하다
alter table public.ai_usage_log
  add column if not exists error_kind text;

comment on column public.ai_usage_log.ok is
  'AI 호출 성공 여부. 0005 이전 기록은 모두 성공이라 기본값 true.';
comment on column public.ai_usage_log.error_kind is
  '실패 원인 구분(timeout/ai_error/refusal/rate_limit/config). 성공이면 null.';

-- 최근 구간의 성공/실패를 함께 훑는 쿼리를 위한 인덱스.
create index if not exists ai_usage_log_recent_ok_idx
  on public.ai_usage_log (created_at desc, ok);
