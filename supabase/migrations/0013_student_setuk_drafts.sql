-- 세특(세부능력 및 특기사항) 참고 초안. 학생 한 명이 이 클래스에 낸 파일과 교사 관찰 메모로 만든다.
--
-- [설계] 2026학년도 기재요령 「작성 시 유의사항」 5-다: AI로 생성한 자료를 서술형 항목에 그대로
-- 입력하는 행위는 금지되고, 윤문 등 보조 수단으로만 쓸 수 있으며 최종 입력 전에 허위·과장과
-- 기재요령 준수 여부를 교사가 확인해야 한다. 그래서 이 표는 '초안'만 담고, 교사 관찰 메모를 가장
-- 앞선 근거로 받으며, 문장마다 근거 출처를 함께 남겨 교사가 대조할 수 있게 한다. 결과는 교사 전용이다.
create table public.student_setuk_drafts (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  -- 교사가 직접 관찰한 내용(수업 태도, 발표, 모둠 활동 등). 초안보다 먼저 저장될 수 있다.
  teacher_memo text,
  -- 초안·근거·교사가 덧붙일 것·확인할 것·보낸 파일 목록. 아직 만들지 않았으면 null.
  result jsonb,
  provider text,
  model text,
  -- 초안 근거(학생 파일 경로 전체, 평가 계획서 경로, 교사 메모, 프롬프트 버전)의 지문.
  -- 파일이 늘거나 메모를 고치면 달라져서 화면에 '다시 만들기 필요'가 뜬다.
  signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id)
);

alter table public.student_setuk_drafts enable row level security;

-- 담당 교사만 읽는다. 쓰기(메모 저장 포함)는 서버(service-role)에서 권한을 확인한 뒤에만 한다.
create policy student_setuk_drafts_select_teacher on public.student_setuk_drafts
  for select using (public.is_teacher_of_class(class_id));
