-- =============================================================
--  아이디어 캘린더 - Supabase 준비 SQL
--  실행 방법: Supabase 대시보드 -> SQL Editor -> New query ->
--            이 내용을 통째로 붙여넣고 [Run] 클릭 (한 번만 하면 됩니다)
--
--  이 스크립트가 하는 일:
--   1) 메모를 담을 표(idea_memos)를 만듭니다.
--   2) "내 메모는 나만 본다" 보안 규칙(RLS)을 켭니다.
--   3) 날짜/수정시각으로 빠르게 찾도록 색인을 만듭니다.
--
--  이름을 모두 idea_ 로 시작하게 해서, 같은 프로젝트의 다른 앱과
--  절대 섞이지 않도록 했습니다.
-- =============================================================

-- 1) 메모 표 만들기 -------------------------------------------
create table if not exists public.idea_memos (
  id          text primary key,   -- PC 앱의 다양한 id 형식을 그대로 받기 위해 text
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        text not null,
  title       text not null default '',
  body        text not null default '',
  body_html   text,
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  reminders   jsonb  not null default '[]'::jsonb,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2) 보안 규칙: 로그인한 본인의 메모만 읽고 쓸 수 있게 -----------
alter table public.idea_memos enable row level security;

drop policy if exists "idea_select_own" on public.idea_memos;
create policy "idea_select_own" on public.idea_memos
  for select using (auth.uid() = user_id);

drop policy if exists "idea_insert_own" on public.idea_memos;
create policy "idea_insert_own" on public.idea_memos
  for insert with check (auth.uid() = user_id);

drop policy if exists "idea_update_own" on public.idea_memos;
create policy "idea_update_own" on public.idea_memos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "idea_delete_own" on public.idea_memos;
create policy "idea_delete_own" on public.idea_memos
  for delete using (auth.uid() = user_id);

-- 3) 빠른 조회를 위한 색인 --------------------------------------
create index if not exists idea_memos_user_date_idx
  on public.idea_memos (user_id, date);
create index if not exists idea_memos_user_updated_idx
  on public.idea_memos (user_id, updated_at desc);

-- 4) 수정 시각 자동 채우기 --------------------------------------
create or replace function public.idea_touch_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null then
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists idea_memos_touch_updated_at on public.idea_memos;
create trigger idea_memos_touch_updated_at
  before insert or update on public.idea_memos
  for each row execute function public.idea_touch_updated_at();

-- 끝. "Success. No rows returned" 이 나오면 정상입니다.
