-- 수행평가 종합 채점: 반 전체에 쓰는 평가 계획서 하나로, 학생 한 명이 이 클래스에 낸 파일 전체를
-- 채점한다. 계획서에 수행평가가 여러 개(가, 나 …) 있으면 각각 채점한다.
--
-- 0011의 과제별 채점과 무엇이 다른가: 그쪽은 과제 하나에 채점기준 하나를 붙여 그 과제 제출물만 본다.
-- 이쪽은 학생 한 명의 연구 산출물(계획서·일지·보고서)과 과제 제출물을 모두 모아 보고, 어느 파일이
-- 어느 수행평가의 근거인지도 AI가 가린다. 수행평가는 여러 산출물에 걸쳐 평가하기 때문이다.
--
-- [설계] 결과는 교사 화면에만 보인다. 학생용 뷰를 만들지 않았다 — 종합 채점은 교사의 성적 산출
-- 보조라서 학생에게 내보낼 문장을 만들지 않는다(과제별 채점의 '학생에게 공개'와 다르다).

-- 평가 계획서 파일. 클래스당 하나이고, 다시 올리면 바뀐다(이전 파일은 Storage에서 지운다).
-- 경로는 {교사 uid}/classes/{클래스 id}/rubric/... — 최상위가 업로더 uid라 기존 스토리지
-- 정책(research_files_owner_all)을 그대로 통과한다.
alter table public.classes
  add column rubric_path text,
  add column rubric_mime text,
  add column rubric_size bigint,
  add column rubric_filename text;

create table public.student_overall_grades (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  -- 채점 때 보낸 파일 목록, 수행평가별 평가요소 점수·근거, 교사 확인 사항. 화면이 그린다.
  result jsonb not null,
  provider text not null,
  model text not null,
  -- 채점 근거(평가 계획서 경로, 학생 파일 경로 전체, 프롬프트 버전)의 지문.
  -- 학생이 파일을 더 내거나 계획서를 바꾸면 달라져서 화면에 '다시 채점 필요'가 뜬다.
  signature text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id)
);

alter table public.student_overall_grades enable row level security;

-- 점수가 들어 있으므로 담당 교사만 읽는다. 쓰기는 서버(service-role)에서만 한다.
create policy student_overall_grades_select_teacher on public.student_overall_grades
  for select using (public.is_teacher_of_class(class_id));
