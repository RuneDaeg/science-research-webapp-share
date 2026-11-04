-- 연구 과제 삭제 규칙을 바꾼다.
--
-- 1) 선생님 피드백이 하나라도 달린 과제는 학생이 지울 수 없다.
--    학생이 지우면 선생님이 남긴 지도 기록까지 되돌릴 수 없이 함께 사라진다.
-- 2) 담당 선생님은 자기 클래스의 과제를 지울 수 있다(잘못 만든 과제 정리용).
--
-- 서버 액션에서도 같은 판정을 하지만, 학생 세션은 anon 키로 DB에 직접 접근할 수 있으므로
-- 규칙 자체는 RLS에 둔다.

-- teacher_feedbacks와 research_documents를 함께 봐야 해서 definer 함수로 감싼다.
-- (정책 안에서 다른 테이블을 직접 조회하면 그쪽 RLS에 걸려 무한 재귀나 오판이 생긴다.)
-- 공개 여부(visible_to_student)는 보지 않는다 — 비공개 메모도 선생님이 남긴 기록이다.
create or replace function public.project_has_teacher_feedback(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_feedbacks tf
    join public.research_documents d on d.id = tf.document_id
    where d.project_id = p_project_id
  );
$$;

drop policy if exists research_projects_delete on public.research_projects;

create policy research_projects_delete on public.research_projects
  for delete using (
    (owner_id = auth.uid() and not public.project_has_teacher_feedback(id))
    or public.is_teacher_of_class(class_id)
  );
