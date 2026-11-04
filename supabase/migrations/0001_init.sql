-- 과학과제연구 탐구 지원 웹앱 — 초기 스키마 + RLS
-- 적용: npx supabase db push  (또는 Supabase Dashboard SQL Editor에 붙여넣기)
--
-- 도메인 구조
--   classes (과목 클래스) ── class_enrollments ── profiles
--        └─ research_projects (연구 과제 1건, 개인 또는 팀)
--               ├─ project_members (팀원)
--               └─ research_documents (계획서 / 연구 일지 n회차 / 중간·최종 보고서)
--                      ├─ ai_feedbacks     (넛지 피드백 + 자기평가 별점)
--                      └─ teacher_feedbacks (교사 피드백, 학생 공개 토글)

-- ============================================================
-- 0. 확장 기능
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- 1. profiles
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'teacher', 'student')),
  display_name text not null default '',
  school_name text,
  created_at timestamptz not null default now()
);

-- 신규 auth.users 가입 시 profiles 행을 자동 생성.
-- [보안] role은 항상 'student'로 강제한다 — 클라이언트가 보낸 metadata.role을 신뢰하면
--        누구나 교사로 가입할 수 있다. 교사/관리자는 service_role로만 승격한다.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'student', coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- role 변경은 service_role만 허용 (관리자 서버 액션이 admin 클라이언트로 승격한다)
create function public.prevent_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role <> old.role and current_user <> 'service_role' then
    raise exception 'role은 변경할 수 없습니다';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- 재귀적 RLS 조회를 피하기 위한 헬퍼
create function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- 2. classes / class_enrollments / class_announcements
-- ============================================================
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  school_year text,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create index classes_teacher_id_idx on public.classes (teacher_id);

create table public.class_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (class_id, student_id)
);

create index class_enrollments_class_id_idx on public.class_enrollments (class_id);
create index class_enrollments_student_id_idx on public.class_enrollments (student_id);

create table public.class_announcements (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index class_announcements_class_id_idx on public.class_announcements (class_id);

-- classes와 class_enrollments의 SELECT 정책은 서로를 참조한다. EXISTS 서브쿼리를 정책 안에
-- 직접 쓰면 상대 테이블의 RLS를 다시 평가하다가 무한 재귀(42P17)에 빠지므로, security definer
-- 함수로 감싸 RLS를 우회한 채 조회한다.
create function public.is_teacher_of_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.classes c
    where c.id = target_class_id and c.teacher_id = auth.uid()
  );
$$;

create function public.is_enrolled_in_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_enrollments ce
    where ce.class_id = target_class_id and ce.student_id = auth.uid()
  );
$$;

-- 같은 클래스를 공유하는지 (팀 구성 시 학생이 반 친구 이름을 골라야 하므로 필요)
create function public.shares_class_with(other_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_enrollments mine
    join public.class_enrollments theirs on theirs.class_id = mine.class_id
    where mine.student_id = auth.uid() and theirs.student_id = other_id
  );
$$;

-- ============================================================
-- 3. research_projects / project_members
-- ============================================================
create table public.research_projects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  field text not null check (field in ('physics', 'chemistry', 'biology', 'earth', 'convergence')),
  research_question text,
  status text not null default 'planning' check (status in ('planning', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_projects_class_id_idx on public.research_projects (class_id);
create index research_projects_owner_id_idx on public.research_projects (owner_id);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  role_in_team text not null default 'member' check (role_in_team in ('leader', 'member')),
  joined_at timestamptz not null default now(),
  unique (project_id, student_id)
);

create index project_members_project_id_idx on public.project_members (project_id);
create index project_members_student_id_idx on public.project_members (student_id);

-- research_projects ↔ project_members도 상호 참조하므로 definer 함수로 감싼다
create function public.is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = target_project_id and pm.student_id = auth.uid()
  );
$$;

create function public.is_project_owner(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.research_projects p
    where p.id = target_project_id and p.owner_id = auth.uid()
  );
$$;

create function public.is_teacher_of_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.research_projects p
    join public.classes c on c.id = p.class_id
    where p.id = target_project_id and c.teacher_id = auth.uid()
  );
$$;

-- ============================================================
-- 4. research_documents
-- ============================================================
create table public.research_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  -- plan: 탐구 계획 및 설계 / journal: 연구 일지 / interim: 중간 보고서 / final: 최종 보고서
  stage text not null check (stage in ('plan', 'journal', 'interim', 'final')),
  title text not null,
  round_no integer, -- 연구 일지 회차 (그 외 단계에서는 null)
  note text,        -- 학생이 남기는 메모 (AI 피드백 입력에 함께 전달)
  file_path text not null,
  file_mime text not null,
  original_filename text not null,
  extracted_text text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'ok', 'failed')),
  created_at timestamptz not null default now()
);

create index research_documents_project_id_idx on public.research_documents (project_id);
create index research_documents_uploaded_by_idx on public.research_documents (uploaded_by);

-- 문서 id로부터 접근 권한을 판정 (ai_feedbacks / teacher_feedbacks 정책에서 재사용).
-- [주의] `language sql` 함수는 생성 시점에 본문이 검증되므로, 참조하는 테이블보다 먼저 정의하면
-- `relation "public.research_documents" does not exist`로 마이그레이션이 통째로 실패한다.
-- 반드시 research_documents 생성 이후에 둘 것.
create function public.is_teacher_of_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.research_documents d
    join public.research_projects p on p.id = d.project_id
    join public.classes c on c.id = p.class_id
    where d.id = target_document_id and c.teacher_id = auth.uid()
  );
$$;

create function public.is_member_of_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.research_documents d
    join public.project_members pm on pm.project_id = d.project_id
    where d.id = target_document_id and pm.student_id = auth.uid()
  );
$$;

-- ============================================================
-- 5. ai_feedbacks / teacher_feedbacks
-- ============================================================
create table public.ai_feedbacks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.research_documents (id) on delete cascade,
  body text not null,
  rating integer, -- AI 자기평가 별점 1~5 (교사에게만 노출)
  provider text not null,
  model text not null,
  -- 같은 입력(문서 내용)에 대해 재생성하지 않기 위한 서명. 입력이 같으면 저장본을 그대로 쓴다.
  signature text not null,
  -- 2단계 검증(초안 → 팩트체크 재작성)을 거쳤는지. 기본 경로는 단일 호출(false).
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_feedbacks_document_id_idx on public.ai_feedbacks (document_id);

create table public.teacher_feedbacks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.research_documents (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  visible_to_student boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teacher_feedbacks_document_id_idx on public.teacher_feedbacks (document_id);

-- ============================================================
-- 6. ai_usage_log — 공용 키 남용 방어 + 관리자 모니터
-- ============================================================
create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles (id) on delete set null,
  class_id uuid references public.classes (id) on delete set null,
  document_id uuid references public.research_documents (id) on delete set null,
  kind text not null check (kind in ('draft', 'verify')),
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index ai_usage_log_student_created_idx on public.ai_usage_log (student_id, created_at desc);
create index ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);

-- ============================================================
-- 7. RLS 활성화
-- ============================================================
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.class_announcements enable row level security;
alter table public.research_projects enable row level security;
alter table public.project_members enable row level security;
alter table public.research_documents enable row level security;
alter table public.ai_feedbacks enable row level security;
alter table public.teacher_feedbacks enable row level security;
alter table public.ai_usage_log enable row level security; -- 정책 없음 = service_role 전용

-- ---- profiles ----
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

-- 교사는 자기 클래스 학생을, 학생은 담당 교사와 같은 클래스 친구를 볼 수 있어야
-- 로스터/팀 구성 화면에 이름이 뜬다 (같은 command의 정책은 OR로 합쳐진다).
create policy profiles_select_classmates on public.profiles
  for select using (
    exists (
      select 1 from public.class_enrollments ce
      join public.classes c on c.id = ce.class_id
      where ce.student_id = profiles.id and c.teacher_id = auth.uid()
    )
    or exists (
      select 1 from public.class_enrollments ce
      join public.classes c on c.id = ce.class_id
      where c.teacher_id = profiles.id and ce.student_id = auth.uid()
    )
    or public.shares_class_with(profiles.id)
  );

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

-- insert는 handle_new_user 트리거(security definer)로만 수행되므로 클라이언트 정책 없음

-- ---- classes ----
create policy classes_select on public.classes
  for select using (teacher_id = auth.uid() or public.is_enrolled_in_class(id));

create policy classes_insert on public.classes
  for insert with check (public.current_role() = 'teacher' and teacher_id = auth.uid());

create policy classes_update on public.classes
  for update using (teacher_id = auth.uid());

create policy classes_delete on public.classes
  for delete using (teacher_id = auth.uid());

-- ---- class_enrollments ----
-- insert는 /api/classes/join(service-role)에서만 수행 — 클라이언트 insert 정책 없음
create policy class_enrollments_select on public.class_enrollments
  for select using (student_id = auth.uid() or public.is_teacher_of_class(class_id));

create policy class_enrollments_delete on public.class_enrollments
  for delete using (public.is_teacher_of_class(class_id));

-- ---- class_announcements ----
create policy class_announcements_select on public.class_announcements
  for select using (public.is_teacher_of_class(class_id) or public.is_enrolled_in_class(class_id));

create policy class_announcements_insert on public.class_announcements
  for insert with check (public.is_teacher_of_class(class_id) and teacher_id = auth.uid());

create policy class_announcements_delete on public.class_announcements
  for delete using (public.is_teacher_of_class(class_id));

-- ---- research_projects ----
create policy research_projects_select on public.research_projects
  for select using (public.is_project_member(id) or public.is_teacher_of_class(class_id));

create policy research_projects_insert on public.research_projects
  for insert with check (
    public.current_role() = 'student'
    and owner_id = auth.uid()
    and public.is_enrolled_in_class(class_id)
  );

create policy research_projects_update on public.research_projects
  for update using (public.is_project_member(id));

create policy research_projects_delete on public.research_projects
  for delete using (owner_id = auth.uid());

-- ---- project_members ----
create policy project_members_select on public.project_members
  for select using (
    student_id = auth.uid()
    or public.is_project_member(project_id)
    or public.is_teacher_of_project(project_id)
  );

-- 팀원 추가/삭제는 프로젝트를 만든 학생(팀장)만
create policy project_members_insert on public.project_members
  for insert with check (public.is_project_owner(project_id));

create policy project_members_delete on public.project_members
  for delete using (public.is_project_owner(project_id));

-- ---- research_documents ----
create policy research_documents_select on public.research_documents
  for select using (public.is_project_member(project_id) or public.is_teacher_of_project(project_id));

create policy research_documents_insert on public.research_documents
  for insert with check (public.is_project_member(project_id) and uploaded_by = auth.uid());

create policy research_documents_delete on public.research_documents
  for delete using (uploaded_by = auth.uid());

-- update(추출 텍스트 갱신 등)는 서버(service-role)에서만 수행 — 클라이언트 정책 없음

-- ---- ai_feedbacks ----
-- 모든 쓰기는 서버(service-role)에서만. 학생은 아래 student_ai_feedbacks 뷰로 읽는다
-- (rating은 교사 전용이라 뷰에서 제외).
create policy ai_feedbacks_select_teacher on public.ai_feedbacks
  for select using (public.is_teacher_of_document(document_id));

-- ---- teacher_feedbacks ----
create policy teacher_feedbacks_select on public.teacher_feedbacks
  for select using (
    public.is_teacher_of_document(document_id)
    or (visible_to_student and public.is_member_of_document(document_id))
  );

create policy teacher_feedbacks_insert on public.teacher_feedbacks
  for insert with check (public.is_teacher_of_document(document_id) and teacher_id = auth.uid());

create policy teacher_feedbacks_update on public.teacher_feedbacks
  for update using (public.is_teacher_of_document(document_id));

create policy teacher_feedbacks_delete on public.teacher_feedbacks
  for delete using (public.is_teacher_of_document(document_id));

-- ============================================================
-- 8. 학생용 AI 피드백 뷰 (rating 제외)
-- ============================================================
-- security_invoker를 켜면 학생이 조회할 때 ai_feedbacks의 기저 RLS(교사만 허용)까지 적용되어
-- 아무 것도 안 보이게 된다. 기본값(정의자 권한)으로 두고 아래 WHERE 절로만 접근을 제한한다.
create view public.student_ai_feedbacks as
select
  f.id,
  f.document_id,
  f.body,
  f.verified,
  f.created_at,
  f.updated_at
from public.ai_feedbacks f
join public.research_documents d on d.id = f.document_id
where exists (
  select 1 from public.project_members pm
  where pm.project_id = d.project_id and pm.student_id = auth.uid()
);

grant select on public.student_ai_feedbacks to authenticated;

-- ============================================================
-- 9. Storage 버킷 + 정책
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('research-files', 'research-files', false, 20971520)
on conflict (id) do nothing;

-- 경로 규칙: research-files/{uploader_id}/{project_id}/{filename} — 최상위 폴더가 업로더 uid와 일치
create policy research_files_owner_all on storage.objects
  for all using (
    bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 교사/팀원의 타인 업로드 파일 열람은 storage RLS로 처리하지 않고
-- 서버 API(service-role, DB 소유권 검증 후 signed URL 발급)로만 처리한다.
