-- 산출물 파일 크기를 DB에 함께 기록한다.
--
-- 관리자 화면에서 저장공간 사용량을 보여주려면 전체 파일 크기의 합이 필요한데, Storage API에는
-- 재귀 조회가 없어서 폴더마다 list를 호출해야 한다. 경로가 {uid}/{projectId}/{파일} 구조라
-- 학생 수만큼 폴더가 늘고, 운영 DB 리전(시드니)까지 왕복이 한 번에 1초가 넘는다.
-- 실측으로 파일 3개에 4.2초가 걸렸으니 학생 100명 규모에서는 함수 타임아웃을 넘긴다.
--
-- 업로드를 확정하는 시점(confirm 라우트)에 Storage가 알려주는 실제 크기를 이 컬럼에 적어두면
-- 집계가 쿼리 한 번으로 끝난다.
--
-- 이 마이그레이션 이전에 올라온 산출물은 null로 남는다. 관리자 화면이 '미집계'로 구분해 보여준다.
alter table public.research_documents
  add column if not exists file_size bigint;

comment on column public.research_documents.file_size is
  '업로드된 파일의 바이트 크기. confirm 시점에 Storage가 보고한 실제 값. 0003 이전 산출물은 null.';
