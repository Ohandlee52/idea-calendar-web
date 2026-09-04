-- ───────────────────────────────────────────────────────────────
--  아이디어 캘린더 - Supabase 준비 SQL
--  실행 방법: Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query →
--            이 내용을 통째로 붙여넣고 [Run] 클릭 (한 번만 하면 됩니다)
--
--  이 스크립트가 하는 일:
--   1) 메모를 담을 표(idea_memos)를 만듭니다.
--   2) "내 메모는 나만 본다" 보안 규칙(RLS)을 켭니다.
--   3) 날짜·수정시각으로 빠르게 찾도록 색인을 만듭니다.
-- ───────────────────────────────────────────────────────────────

-- 1) 메모 표 만들기 -----------------------------------------------
create table if not exists public.idea_memos (
  id          uuid primary key,                      -- 메모 고유 번호(PC 앱과 동일하게 사용)
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        text not null,                         -- 'YYYY-MM-DD' (어느 날짜의 메모인지)
  title       text not null default '',
  body        text not null default '',              -- 순수 글자 (검색용)
  body_html   text,                                  -- 서식 있는 본문 (굵게/색/이미지)
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  reminders   jsonb  not null default '[]'::jsonb,   -- [{id,date,time,done}, ...]
  deleted     boolean not null default false,        -- 삭제 표시(동기화 안전용)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2) 보안 규칙: 로그인한 본인의 메모만 읽고 쓸 수 있게 ----------------
alter table public.idea_memos enable row level security;

drop policy if exists "내 메모만 조회" on public.idea_memos;
create policy "내 메모만 조회" on public.idea_memos
  for select using (auth.uid() = user_id);

drop policy if exists "내 메모만 추가" on public.idea_memos;
create policy "내 메모만 추가" on public.idea_memos
  for insert with check (auth.uid() = user_id);

drop policy if exists "내 메모만 수정" on public.idea_memos;
create policy "내 메모만 수정" on public.idea_memos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "내 메모만 삭제" on public.idea_memos;
create policy "내 메모만 삭제" on public.idea_memos
  for delete using (auth.uid() = user_id);

-- 3) 빠른 조회를 위한 색인 -----------------------------------------
create index if not exists idea_memos_user_date_idx    on public.idea_memos (user_id, date);
create index if not exists idea_memos_user_updated_idx on public.idea_memos (user_id, updated_at desc);

-- 4) 수정 시각 자동 갱신 (동기화의 핵심: 최신 수정본이 이기도록) --------
-- (이름을 idea_ 로 시작하게 해서, 같은 프로젝트의 다른 앱과 섞이지 않게 합니다)
create or replace function public.idea_touch_updated_at()
returns trigger language plpgsql as $$
begin
  -- 앱이 보낸 updated_at이 있으면 존중하고, 없으면 현재 시각으로 채웁니다.
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
