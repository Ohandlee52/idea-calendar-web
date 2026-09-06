-- =============================================================
--  아이디어 캘린더 - 추가 SQL (7번째): 계정 삭제가 막히던 문제 수정
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  무엇이 잘못됐나요?
--   4번 SQL에서 초대코드 표에 "이 코드를 누가 썼는지"를 기록하도록
--   만들면서, 그 연결이 걸려 있으면 해당 계정을 지울 수 없게 되어
--   있었습니다. 그래서 Authentication -> Users 에서 계정을 지우려 하면
--   "Database error deleting user" 오류가 났습니다.
--
--  어떻게 고치나요?
--   계정이 지워지면 그 기록만 비우도록(on delete set null) 바꿉니다.
--   계정은 정상적으로 지워지고, 그 사람이 썼던 초대코드는 다시
--   쓸 수 있는 상태가 됩니다.
--
--  이 SQL은 표의 내용을 지우지 않습니다. 연결 방식만 바꿉니다.
-- =============================================================

alter table public.idea_invite_codes
  drop constraint if exists idea_invite_codes_used_by_fkey;

alter table public.idea_invite_codes
  add constraint idea_invite_codes_used_by_fkey
  foreign key (used_by) references auth.users(id) on delete set null;

-- 끝. "Success. No rows returned" 이 나오면 정상입니다.
-- 이제 Authentication -> Users 에서 계정을 지울 수 있습니다.
