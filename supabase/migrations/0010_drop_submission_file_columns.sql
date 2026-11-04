-- 0009에서 남겨둔 과제 제출물의 옛 파일 컬럼을 지운다.
--
-- 0009는 파일을 assignment_submission_files로 옮기면서도 이 컬럼들을 남겼다. 배포 직전
-- 몇 초 동안 옛 코드가 돌 때 제출이 깨지지 않게 하기 위함이었다(실제 학생이 쓰는 중이었다).
-- 새 코드 배포가 끝나 아무도 이 컬럼을 읽지도 쓰지도 않으므로 이제 지운다.
--
-- 데이터는 0009에서 이미 전부 옮겼고 누락이 없음을 확인했다.
alter table public.assignment_submissions
  drop column if exists file_path,
  drop column if exists file_mime,
  drop column if exists file_size,
  drop column if exists original_filename;
