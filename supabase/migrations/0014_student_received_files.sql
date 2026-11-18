-- 학생이 앱에 올리지 않고 메신저·메일 등으로 교사에게 따로 보낸 파일을 교사가 대신 올려 두는 곳.
--
-- 과제 제출(assignment_submissions)과 무엇이 다른가: 그쪽은 과제 하나에 학생이 직접 내는 것이고
-- 제출 현황·'제출 파일 모두 받기'·과제별 AI 채점에 쓰인다. 이쪽은 어느 과제에도 딸리지 않는다.
-- 학생별 모아 보기에만 보이고, 수행평가 종합 채점(0012)과 세특 참고 초안(0013)의 근거로만 쓰인다.
--
-- [설계] 교사 전용이다. 학생은 자기 파일이 여기 올라간 것을 보지 못한다 — 교사가 받은 자료를
-- 정리해 두는 칸이라서다. 학생에게 보여야 하면 과제 제출 쪽에 대신 제출하는 기능을 따로 만들 것.
--
-- 파일 경로는 {교사 uid}/classes/{클래스 id}/received/{학생 id}/... — 최상위가 업로더(교사) uid라
-- 기존 스토리지 정책(research_files_owner_all)을 그대로 통과하고, 교사 세션으로 지울 수 있다.
create table public.student_received_files (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  file_path text not null,
  file_mime text not null,
  file_size bigint,
  original_filename text not null,
  -- 어떤 자료인지(예: "2차 연구 일지, 카톡으로 받음"). AI가 파일을 수행평가에 짝지을 때 본다.
  note text,
  -- 교사가 학생에게서 받은 날. 올린 날과 다를 수 있다 — 9월에 받은 계획서를 12월에 올리면
  -- 올린 날로는 AI가 평가 시기를 잘못 맞춘다. 시각은 알 수 없는 경우가 많아 날짜만 받는다.
  received_on date not null default ((now() at time zone 'Asia/Seoul')::date),
  created_at timestamptz not null default now()
);

create index student_received_files_class_student_idx
  on public.student_received_files (class_id, student_id, received_on);

alter table public.student_received_files enable row level security;

-- [주의] insert(...).select()는 SELECT 정책도 통과해야 한다(RETURNING이 SELECT 정책을 받는다).
-- 아래 select 정책이 담당 교사를 허용하므로 방금 넣은 행을 그대로 돌려받을 수 있다.
create policy student_received_files_select_teacher on public.student_received_files
  for select using (public.is_teacher_of_class(class_id));

create policy student_received_files_insert_teacher on public.student_received_files
  for insert with check (public.is_teacher_of_class(class_id) and uploaded_by = auth.uid());

create policy student_received_files_delete_teacher on public.student_received_files
  for delete using (public.is_teacher_of_class(class_id));
