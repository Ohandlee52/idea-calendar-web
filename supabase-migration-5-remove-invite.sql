-- =============================================================
--  아이디어 캘린더 - 추가 SQL (5번째): 초대코드 검사를 끈다
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  언제 쓰나요?
--   supabase-migration-4.sql 로 켠 "초대코드가 있어야 가입됨" 검사를
--   다시 끄고 싶을 때 씁니다. 예를 들어:
--     · 초대코드 관리가 번거로워져서 그냥 누구나 가입되게 되돌리고 싶을 때
--     · 나중에 코드 없이 검색으로 찾아오는 사람도 받고 싶을 때
--
--  무엇을 하나요?
--   가입을 막던 두 트리거만 뗍니다. idea_invite_codes 표와 그 안의
--   기록(누가 어떤 코드로 언제 가입했는지)은 그대로 남습니다.
--   나중에 supabase-migration-4.sql 을 다시 실행하면 그대로 부활합니다.
-- =============================================================

drop trigger if exists idea_invite_code_check on auth.users;
drop trigger if exists idea_invite_code_mark on auth.users;

-- 이제부터는 초대코드 없이도 누구나 가입됩니다.
-- (앱 화면의 "초대코드" 입력칸은 그대로 남아 있지만, 아무 값이나
--  넣어도, 심지어 비워 둬도 더는 검사하지 않습니다.
--  칸까지 없애려면 이 SQL 만으로는 안 되고 앱 코드를 고쳐야 하니
--  필요하면 말씀해 주세요.)

-- =============================================================
--  ⚠️ 표까지 완전히 지우고 싶다면 (되돌릴 수 없습니다)
--   위 트리거만 떼면 검사는 꺼지지만, 코드 목록과 "누가 언제 썼는지"
--   기록은 남습니다. 그 기록까지 전부 지우려면 아래 두 줄의 주석을
--   벗기고 실행하세요. 보통은 남겨두는 것을 권합니다 — 나중에
--   "누가 이미 가입했었는지" 확인할 자료가 되기 때문입니다.
--
-- drop table if exists public.idea_invite_codes;
-- drop function if exists public.idea_check_invite_code();
-- drop function if exists public.idea_mark_invite_code_used();
