-- =============================================================
--  아이디어 캘린더 - 추가 SQL (9번째)
--  AI 분석 결과를 담는 표(idea_analyses)를 만듭니다
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  무엇을 하나요?
--   폰 앱에서 [AI 분석]을 누르면 서버 함수(analyze-idea)가 Claude 에게
--   메모를 분석시키고, 그 결과를 이 표에 저장합니다. 한 번 분석한 결과는
--   메모를 열 때마다 공짜로 다시 볼 수 있습니다.
--
--   같은 메모를 다시 분석하면 새 줄이 쌓입니다 (이전 결과도 남습니다).
--   앱은 가장 최근 것을 보여줍니다.
--
--  보안: idea_memos 와 똑같이 "내 것만" 규칙(RLS)을 겁니다.
--        서버 함수도 사용자의 로그인 토큰으로 이 표에 쓰므로 같은 규칙을 받습니다.
-- =============================================================

-- 1) 표 만들기 ----------------------------------------------------
create table if not exists public.idea_analyses (
  id            uuid primary key default gen_random_uuid(),
  memo_id       text not null references public.idea_memos(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  result        text not null,            -- 분석 글 (한국어)
  model         text,                     -- 어떤 AI 모델이 답했는지
  input_tokens  integer,                  -- 비용 기록용
  output_tokens integer,
  web_searches  integer,
  cost_krw      integer,                  -- 어림 비용(원). 정확한 청구액은 Anthropic 콘솔 기준
  created_at    timestamptz not null default now()
);

-- 2) 보안 규칙: 본인 것만 ------------------------------------------
alter table public.idea_analyses enable row level security;

drop policy if exists "idea_analyses_select_own" on public.idea_analyses;
create policy "idea_analyses_select_own" on public.idea_analyses
  for select using (auth.uid() = user_id);

drop policy if exists "idea_analyses_insert_own" on public.idea_analyses;
create policy "idea_analyses_insert_own" on public.idea_analyses
  for insert with check (auth.uid() = user_id);

drop policy if exists "idea_analyses_delete_own" on public.idea_analyses;
create policy "idea_analyses_delete_own" on public.idea_analyses
  for delete using (auth.uid() = user_id);

-- (update 규칙은 일부러 두지 않습니다. 분석 결과는 고치는 게 아니라 새로 쌓습니다.)

-- 3) 빠른 조회 색인 --------------------------------------------------
--    "이 메모의 최근 분석"과 "이 사람이 오늘 몇 번 돌렸나"를 빨리 찾습니다.
create index if not exists idea_analyses_memo_created_idx
  on public.idea_analyses (memo_id, created_at desc);
create index if not exists idea_analyses_user_created_idx
  on public.idea_analyses (user_id, created_at desc);

-- 끝. "Success. No rows returned" 이 나오면 정상입니다.
