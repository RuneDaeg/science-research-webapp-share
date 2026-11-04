-- 과제 제출물에 파일을 여러 개 담을 수 있게 한다.
--
-- 지금까지는 assignment_submissions 한 행이 곧 파일 하나였다(학생당 1건, 다시 내면 덮어쓰기).
-- 제출을 '메모 + 파일 여러 개'의 묶음으로 바꾼다.
--
-- [중요] 이 마이그레이션은 **추가만 한다.** 기존 파일 컬럼은 남겨두고 NOT NULL만 푼다.
-- 컬럼을 여기서 지우면 아직 옛 코드가 돌고 있는 배포 직전 몇 초 동안 제출이 깨진다 —
-- 학생이 그 순간에 제출하면 파일은 Storage에 올라가고 DB 기록은 실패해 고아가 된다.
-- 실제 학생이 쓰고 있는 중이라 그 창을 만들지 않는다. 컬럼 삭제는 배포 확인 후 0010에서 한다.

create table public.assignment_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assignment_submissions (id) on delete cascade,
  file_path text not null,
  file_mime text not null,
  file_size bigint,
  original_filename text not null,
  uploaded_at timestamptz not null default now()
);

create index assignment_submission_files_submission_id_idx
  on public.assignment_submission_files (submission_id, uploaded_at);

-- 기존 제출물의 파일을 그대로 옮긴다. 업로드 시각은 제출 시각을 쓴다(따로 기록해두지 않았다).
insert into public.assignment_submission_files
  (submission_id, file_path, file_mime, file_size, original_filename, uploaded_at)
select id, file_path, file_mime, file_size, original_filename, submitted_at
from public.assignment_submissions
where file_path is not null;

-- 새 코드는 이 컬럼들에 쓰지 않는다. NOT NULL이 남아 있으면 제출 자체가 실패한다.
alter table public.assignment_submissions
  alter column file_path drop not null,
  alter column file_mime drop not null,
  alter column original_filename drop not null;

-- ============================================================
-- 접근 판정
-- ============================================================
-- [주의] language sql 함수는 생성 시점에 본문이 검증되므로 테이블 정의 뒤에 둔다.
-- 제출물 파일의 접근 권한은 그 제출물과 같다 — 본인이거나 그 과제를 낸 교사.
create function public.can_access_submission(target_submission_id uuid)
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
      and (s.student_id = auth.uid() or public.is_teacher_of_assignment(s.assignment_id))
  );
$$;

create function public.owns_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignment_submissions s
    where s.id = target_submission_id and s.student_id = auth.uid()
  );
$$;

alter table public.assignment_submission_files enable row level security;

create policy assignment_submission_files_select on public.assignment_submission_files
  for select using (public.can_access_submission(submission_id));

-- [주의] insert(...).select()는 SELECT 정책도 통과해야 한다(RETURNING이 SELECT 정책을 받는다).
-- 위 select 정책이 본인 제출물을 허용하므로 방금 넣은 파일을 그대로 돌려받을 수 있다.
create policy assignment_submission_files_insert on public.assignment_submission_files
  for insert with check (public.owns_submission(submission_id));

-- 학생은 자기 파일을 지울 수 있고, 교사는 잘못 올라온 것을 정리할 수 있다.
create policy assignment_submission_files_delete on public.assignment_submission_files
  for delete using (public.can_access_submission(submission_id));
