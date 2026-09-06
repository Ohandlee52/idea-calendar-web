-- =============================================================
--  아이디어 캘린더 - 추가 SQL (8번째)
--  초대코드를 없애고, 대신 "최대 20명"으로 가입을 막습니다
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  왜 바꾸나요?
--   구글·카카오 로그인은 초대코드를 실어 나를 수 없습니다. 그래서
--   초대코드를 두면 가족분들이 ①이메일 가입 ②초대코드 ③메일인증
--   ④그다음에야 카카오 — 네 단계를 거쳐야 했습니다.
--   초대코드를 없애면 카카오·구글 단추 한 번으로 끝납니다.
--
--   대신 인원을 20명으로 막습니다. 가족·지인이 다 들어오고 나면
--   그 뒤로는 링크가 밖으로 새도 아무도 들어올 수 없습니다.
--
--  ⚠️ 이 검사도 앱 화면이 아니라 데이터베이스 안에서 합니다.
--     개발자도구로 우회할 수 없습니다.
-- =============================================================

-- 1) 초대코드 검사를 뗍니다 --------------------------------------
--    표(idea_invite_codes)와 그동안의 기록은 그대로 둡니다.
--    "누가 어떤 코드로 가입했는지" 자료로 남겨두는 편이 낫습니다.
drop trigger if exists idea_invite_code_check on auth.users;
drop trigger if exists idea_invite_code_mark  on auth.users;

-- 2) 인원 제한 검사를 겁니다 ------------------------------------
--    가입하려는 순간 지금 인원을 세어, 20명이 차 있으면 막습니다.
--    advisory lock 은 두 사람이 동시에 가입을 시도해도 정확히
--    20명에서 끊기게 해 줍니다 (안 걸면 21명이 될 수 있습니다).
create or replace function public.idea_check_user_limit()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_max   int := 20;        -- ← 인원을 바꾸려면 이 숫자만 고치세요
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('idea_user_limit'));
  select count(*) into v_count from auth.users;
  if v_count >= v_max then
    raise exception '가입 인원이 가득 찼습니다 (최대 %명)', v_max;
  end if;
  return new;
end;
$$;

drop trigger if exists idea_user_limit_check on auth.users;
create trigger idea_user_limit_check
  before insert on auth.users
  for each row execute function public.idea_check_user_limit();

-- =============================================================
--  ⚠️ 알아두실 것
--   Supabase 인증 서버는 위 문구를 그대로 보여주지 않고
--   "Database error saving new user" 로 뭉갭니다. 그래서 앱에는
--   "가입 인원이 다 찼어요" 라고만 뜹니다.
-- =============================================================

-- 지금 인원과 남은 자리를 확인하려면:
--
-- select count(*) as "지금 인원", 20 - count(*) as "남은 자리" from auth.users;
--
-- 인원을 늘리거나 줄이려면 위 v_max 숫자를 고쳐 이 SQL 을 다시 실행하세요.
--
-- 아예 아무도 못 들어오게 잠그려면 v_max 를 0 으로 두거나,
-- Supabase -> Authentication -> Sign In / Providers 맨 위의
-- "Allow new users to sign up" 을 끄면 됩니다.
