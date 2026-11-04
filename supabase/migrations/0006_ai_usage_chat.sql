-- 사용법 안내 챗봇 호출을 ai_usage_log에 기록할 수 있게 kind에 'chat'을 추가한다.
--
-- 별도 테이블을 만들지 않는 이유: 상한 계산·실패 기록·관리자 호출량 집계가 이미 이 테이블에
-- 붙어 있어서, 종류만 늘리면 그 장치들을 그대로 재사용할 수 있다.
--
-- [주의] 챗봇 호출은 피드백 생성보다 훨씬 빠르다(수 초 대 수십 초). 학생 화면의 응답 상태
-- 배지가 두 종류를 섞어 집계하면 중앙값이 낮아져 실제보다 원활해 보인다.
-- lib/ai/health.ts가 kind in ('draft','verify')만 보도록 되어 있어야 한다.
alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_kind_check;

alter table public.ai_usage_log
  add constraint ai_usage_log_kind_check check (kind in ('draft', 'verify', 'chat'));

comment on column public.ai_usage_log.kind is
  'draft=피드백 생성, verify=2단계 검증, chat=사용법 안내 챗봇';
