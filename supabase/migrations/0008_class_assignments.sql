-- 교사가 올리는 과제/평가 글과, 거기에 학생이 제출하는 파일.
--
-- research_documents와 무엇이 다른가: 그쪽은 '연구 과제(research_projects)'에 딸린 산출물이고
-- 단계별 AI 넛지 피드백이 자동으로 붙는다. 이쪽은 '클래스'에 딸린 과제로, 교사가 글을 올리면
-- 반 학생이 각자 파일 하나를 낸다. 성격이 달라 테이블을 나눈다.
--
-- [설계] AI 피드백은 붙이지 않는다. 넛지 프롬프트는 계획서·일지·보고서 단계에 맞춰 쓰여 있어
-- 임의의 과제에는 맞지 않고, 공용 키 비용도 늘어난다. 필요해지면 그때 따로 설계할 것.

create table public.class_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  -- 마감은 선택이다. 지나도 제출 자체를 막지는 않고 화면에 '마감 지남'으로만 표시한다 —
  -- 사정이 있는 학생을 코드로 잘라내는 것보다 교사가 보고 판단하는 편이 낫다.
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create index class_assignments_class_id_idx on public.class_assignments (class_id, created_at desc);

-- 한 과제에 학생 한 명당 한 건. 다시 내면 기존 행을 덮어쓴다(파일도 교체).
-- 이력을 남기지 않는 것은 '최신 제출본이 곧 제출물'이라는 과제 제출의 통념을 따른 것이다.
create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.class_assignments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  file_path text not null,
  file_mime text not null,
  file_size bigint,
  original_filename text not null,
  note text,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index assignment_submissions_assignment_id_idx
  on public.assignment_submissions (assignment_id, submitted_at desc);
create index assignment_submissions_student_id_idx on public.assignment_submissions (student_id);

-- ============================================================
-- 접근 판정 헬퍼
-- ============================================================
-- [주의] language sql 함수는 생성 시점에 본문이 검증된다. 위 테이블 정의 뒤에 두어야 한다.
-- 정책 안에서 다른 테이블을 직접 조회하면 그쪽 RLS가 다시 평가되어 무한 재귀(42P17)가 나므로
-- security definer로 감싼다.

create function public.is_teacher_of_assignment(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_assignments a
    join public.classes c on c.id = a.class_id
    where a.id = target_assignment_id and c.teacher_id = auth.uid()
  );
$$;

create function public.can_submit_to_assignment(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_assignments a
    join public.class_enrollments e on e.class_id = a.class_id
    where a.id = target_assignment_id and e.student_id = auth.uid()
  );
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.class_assignments enable row level security;
alter table public.assignment_submissions enable row level security;

-- ---- class_assignments ----
create policy class_assignments_select on public.class_assignments
  for select using (
    public.is_teacher_of_class(class_id) or public.is_enrolled_in_class(class_id)
  );

create policy class_assignments_insert on public.class_assignments
  for insert with check (public.is_teacher_of_class(class_id) and teacher_id = auth.uid());

create policy class_assignments_update on public.class_assignments
  for update using (public.is_teacher_of_class(class_id));

create policy class_assignments_delete on public.class_assignments
  for delete using (public.is_teacher_of_class(class_id));

-- ---- assignment_submissions ----
-- [주의] insert(...).select()는 INSERT 정책뿐 아니라 SELECT 정책도 통과해야 한다(RETURNING이
-- SELECT 정책의 적용을 받는다). 아래 select 정책에 student_id = auth.uid()가 있어
-- 학생이 방금 넣은 제출물을 그대로 돌려받을 수 있다.
create policy assignment_submissions_select on public.assignment_submissions
  for select using (
    student_id = auth.uid() or public.is_teacher_of_assignment(assignment_id)
  );

create policy assignment_submissions_insert on public.assignment_submissions
  for insert with check (
    student_id = auth.uid() and public.can_submit_to_assignment(assignment_id)
  );

-- 다시 제출(파일 교체)은 본인만.
create policy assignment_submissions_update on public.assignment_submissions
  for update using (student_id = auth.uid());

-- 학생은 자기 제출을 거둬들일 수 있고, 교사는 잘못 올라온 것을 정리할 수 있다.
create policy assignment_submissions_delete on public.assignment_submissions
  for delete using (
    student_id = auth.uid() or public.is_teacher_of_assignment(assignment_id)
  );
