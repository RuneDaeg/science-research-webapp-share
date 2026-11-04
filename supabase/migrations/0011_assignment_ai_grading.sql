-- 과제 · 평가에 채점기준 파일을 붙이고, AI가 그 기준으로 제출물 채점 초안을 만든다.
--
-- 0008에서 "과제 제출물에는 AI 피드백을 붙이지 않는다"고 정했던 것을 바꾼다. 그때 이유는
-- 넛지 프롬프트가 계획서·일지·보고서 단계에 맞춰 쓰여 있어 임의의 과제에 맞지 않는다는 것이었다.
-- 이번에는 넛지가 아니라 교사가 올린 채점기준표로 채점하므로 그 문제가 없다. 자동으로 돌지 않고
-- 교사가 버튼을 눌러야 돌기 때문에 공용 키 비용도 교사가 통제한다.
--
-- [설계] AI 점수는 초안이다. 교사 화면에만 보이고, 학생에게는 교사가 공개한 피드백 문장만 보인다.
-- 수행평가 점수는 교사가 정한다 — AI 점수를 학생에게 보이면 "AI는 32점을 줬는데" 같은 다툼이
-- 생기고, 교사가 AI와 다르게 판단하기 어려워진다.

-- 채점기준 파일. 과제당 하나이고, 다시 올리면 바뀐다(이전 파일은 Storage에서 지운다).
-- 경로는 {교사 uid}/assignments/{과제 id}/rubric/... — 최상위가 업로더 uid라 기존 스토리지
-- 정책(research_files_owner_all)을 그대로 통과한다.
alter table public.class_assignments
  add column rubric_path text,
  add column rubric_mime text,
  add column rubric_size bigint,
  add column rubric_filename text;

create table public.assignment_ai_grades (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique
    references public.assignment_submissions (id) on delete cascade,
  -- 채점 결과 전체(평가요소별 점수·근거, 채점할 수 없었던 요소, 교사 확인 사항). 화면이 그린다.
  result jsonb not null,
  -- 목록에서 바로 보이도록 따로 둔다. 채점할 수 없는 요소(발표 등)는 둘 다에서 빠진다.
  total_score numeric,
  max_score numeric,
  -- 학생에게 보여줄 피드백. 점수는 들어 있지 않다(프롬프트에서 금지).
  student_feedback text not null,
  -- 교사가 공개해야 학생에게 보인다.
  released boolean not null default false,
  provider text not null,
  model text not null,
  -- 채점 근거(제출 파일 목록·채점기준 파일·과제 안내·프롬프트 버전)의 지문.
  -- 학생이 파일을 더 내거나 채점기준을 바꾸면 달라져서 화면에 '다시 채점 필요'가 뜬다.
  signature text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- [주의] language sql 함수는 생성 시점에 본문이 검증된다. 참조하는 테이블 뒤에 둔다.
-- 정책에서 다른 테이블을 직접 조회하면 그쪽 RLS가 다시 평가돼 42P17이 나므로 security definer로 감싼다.
create function public.is_teacher_of_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignment_submissions s
    where s.id = target_submission_id
      and public.is_teacher_of_assignment(s.assignment_id)
  );
$$;

alter table public.assignment_ai_grades enable row level security;

-- 점수가 들어 있으므로 교사만 직접 읽는다. 학생은 아래 뷰로 공개된 피드백만 읽는다.
-- 생성은 서버(service-role)에서만 한다. 교사는 공개 여부를 바꾸려고 update만 할 수 있다.
create policy assignment_ai_grades_select_teacher on public.assignment_ai_grades
  for select using (public.is_teacher_of_submission(submission_id));

create policy assignment_ai_grades_update_teacher on public.assignment_ai_grades
  for update using (public.is_teacher_of_submission(submission_id));

-- 학생용: 교사가 공개한 피드백 문장만. 점수·근거·교사 확인 사항은 뺀다.
-- [주의] security_invoker를 켜면 안 된다. 켜면 기저 테이블 RLS(교사만 허용)가 학생에게도
-- 적용돼 아무 것도 안 보인다. 대신 where 절에서 본인 제출물만 걸러낸다.
create view public.student_assignment_feedbacks as
select
  g.submission_id,
  g.student_feedback,
  g.updated_at
from public.assignment_ai_grades g
join public.assignment_submissions s on s.id = g.submission_id
where g.released and s.student_id = auth.uid();

grant select on public.student_assignment_feedbacks to authenticated;

-- AI 호출 기록에 채점(grade)을 더한다. 응답 상태 배지(lib/ai/health.ts)는 draft/verify만 보므로
-- 채점은 집계에 섞이지 않는다 — 파일 여러 개를 한꺼번에 읽는 교사 작업이라 학생 대기 시간과 다르다.
alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_kind_check;
alter table public.ai_usage_log
  add constraint ai_usage_log_kind_check check (kind in ('draft', 'verify', 'chat', 'grade'));
comment on column public.ai_usage_log.kind is
  'draft=피드백 생성, verify=2단계 검증, chat=사용법 안내 챗봇, grade=과제 AI 채점';
