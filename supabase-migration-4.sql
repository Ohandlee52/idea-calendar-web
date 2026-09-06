-- =============================================================
--  아이디어 캘린더 - 추가 SQL (4번째): 초대코드로 가입 제한
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  왜 필요한가요?
--   지금은 앱 주소만 알면 누구나 가입할 수 있습니다. 아는 사람에게만
--   나눠주고 싶다면, 가입할 때 미리 정한 "초대코드"를 함께 받아야
--   가입이 되게 합니다.
--
--  코드 하나는 한 사람만 씁니다. 한 번 쓰면 그 코드는 다시 못 씁니다.
--
--  ⚠️ 이 검사는 앱 화면(자바스크립트)이 아니라 데이터베이스 안에서
--     합니다. 화면 쪽 검사만 있으면 개발자도구로 우회해 가입할 수
--     있지만, 이렇게 데이터베이스에 걸어두면 우회할 수 없습니다.
-- =============================================================

-- 1) 초대코드를 담을 표 ------------------------------------------
--    RLS 만 켜고 규칙은 하나도 안 만듭니다. 그러면 앱(REST API)에서는
--    아무도 이 표를 못 보고 못 고칩니다. 오직 Supabase 대시보드의
--    SQL Editor(대표님만 접근)에서만 다룰 수 있습니다.
create table if not exists public.idea_invite_codes (
  code       text primary key,
  note       text not null default '',        -- 누구에게 줄 코드인지 메모 (예: '엄마', '친구 민수')
  used_by    uuid references auth.users(id) on delete set null,   -- 계정을 지우면 이 기록만 비운다 (안 그러면 계정 삭제가 막힌다)
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.idea_invite_codes enable row level security;

-- 2) 가입 직전에 코드를 검사만 한다 --------------------------------
--    아직 가입 전이라 new.id 가 auth.users 에 실제로 없으므로,
--    여기서는 "코드가 있고, 안 쓴 것인가"만 확인하고 기록은 안 한다.
--    security definer 로 만들어야 이 함수가 idea_invite_codes 표를
--    들여다볼 수 있다 (가입은 대표님이 아니라 앱을 쓰는 사람이 하므로).
create or replace function public.idea_check_invite_code()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code text;
  v_row  public.idea_invite_codes;
begin
  v_code := trim(new.raw_user_meta_data ->> 'invite_code');

  if v_code is null or v_code = '' then
    raise exception '초대코드가 필요합니다';
  end if;

  select * into v_row from public.idea_invite_codes
  where code = v_code
  for update;                 -- 같은 코드로 동시에 두 명이 가입해도 하나만 통과하도록 잠근다

  if not found then
    raise exception '초대코드가 올바르지 않습니다';
  end if;

  if v_row.used_by is not null then
    raise exception '이미 사용된 초대코드입니다';
  end if;

  return new;
end;
$$;

-- 3) 가입이 실제로 끝난 뒤에 "이 코드는 이제 썼다"고 기록한다 -------
--    new.id 가 이 시점에는 진짜로 auth.users 에 존재하므로 안전하다.
create or replace function public.idea_mark_invite_code_used()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code text;
begin
  v_code := trim(new.raw_user_meta_data ->> 'invite_code');
  update public.idea_invite_codes
  set used_by = new.id, used_at = now()
  where code = v_code;
  return new;
end;
$$;

drop trigger if exists idea_invite_code_check on auth.users;
create trigger idea_invite_code_check
  before insert on auth.users
  for each row execute function public.idea_check_invite_code();

drop trigger if exists idea_invite_code_mark on auth.users;
create trigger idea_invite_code_mark
  after insert on auth.users
  for each row execute function public.idea_mark_invite_code_used();

-- =============================================================
--  ⚠️ 알아두실 것
--   Supabase 인증 서버는 위 함수가 던진 자세한 문구(예: "이미
--   사용된 초대코드입니다")를 그대로 화면에 보여주지 않고
--   "Database error saving new user" 라는 공통 오류로 뭉뚱그립니다.
--   그래서 폰 앱에는 "초대코드가 올바르지 않거나 이미 사용됐어요"
--   라고만 뜹니다. (코드가 없는 것/틀린 것/이미 쓴 것을 구분해서
--   알려줄 수는 없지만, 막는 것 자체는 확실하게 됩니다)
-- =============================================================

-- 4) 나눠줄 초대코드를 여기에 추가하세요 --------------------------
--    코드는 아무 글자나 됩니다. 사람마다 다른 코드를 주시는 것을
--    권합니다 — 그래야 누구에게 준 코드가 밖으로 새는지 알 수 있습니다.
--    필요한 만큼 줄을 늘리거나 줄여서 실행하세요. (이미 있는 코드는
--    건드리지 않고 새 코드만 더합니다)
insert into public.idea_invite_codes (code, note) values
  ('가족-2026', '가족용')
on conflict (code) do nothing;

-- 나중에 코드를 더 추가하고 싶으면 이 SQL만 다시 실행하면 됩니다:
--
-- insert into public.idea_invite_codes (code, note) values
--   ('친구-이름1', '누구인지 메모'),
--   ('친구-이름2', '누구인지 메모')
-- on conflict (code) do nothing;

-- 어떤 코드를 누가 언제 썼는지 확인하려면:
--
-- select code, note, used_by, used_at from public.idea_invite_codes order by created_at;
