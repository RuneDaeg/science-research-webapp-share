-- 연구 과제 생성이 RLS에 막히던 문제 수정.
--
-- 증상: 학생이 연구를 등록하면 "연구 과제 생성에 실패했습니다"만 뜨고 아무 것도 만들어지지 않음.
-- 원인: INSERT 자체는 통과하지만, 서버 액션이 `.insert(...).select("id")`로 생성된 행을 되받는다.
--       그 RETURNING은 SELECT 정책의 적용을 받는데, 기존 정책은 접근 조건이
--       `is_project_member(id) or is_teacher_of_class(class_id)` 뿐이었다.
--       팀원(project_members) 행은 과제가 만들어진 *다음에* 삽입되므로, INSERT 시점에는
--       만든 본인조차 아직 팀원이 아니어서 SELECT가 거부되고 42501로 전체가 실패했다.
-- 수정: 소유자(owner_id = auth.uid())를 항상 읽고 수정할 수 있게 한다. 팀원 행이 어떤 이유로
--       사라져도 만든 학생이 자기 과제에서 잠기지 않는다는 장점도 있다.

drop policy if exists research_projects_select on public.research_projects;
create policy research_projects_select on public.research_projects
  for select using (
    owner_id = auth.uid()
    or public.is_project_member(id)
    or public.is_teacher_of_class(class_id)
  );

drop policy if exists research_projects_update on public.research_projects;
create policy research_projects_update on public.research_projects
  for update using (
    owner_id = auth.uid()
    or public.is_project_member(id)
  );
