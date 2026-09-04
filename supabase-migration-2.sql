-- =============================================================
--  아이디어 캘린더 - 추가 SQL (2번째)
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  왜 필요한가요?
--   PC 앱에서 캘린더(.ics)로 가져온 메모는 고유번호가 'ics-...' 형태라
--   지금의 uuid 형식에 맞지 않습니다. 어떤 형태든 받도록 text 로 바꿉니다.
-- =============================================================

alter table public.idea_memos
  alter column id type text;

-- 끝. "Success. No rows returned" 이 나오면 정상입니다.
