-- =============================================================
--  아이디어 캘린더 - 추가 SQL (10번째)
--  AI 분석 표(idea_analyses)가 "기간 총평"도 담을 수 있게 칸을 늘립니다
--  실행 방법: Supabase -> SQL Editor -> New query -> 붙여넣고 Run
--
--  무엇을 하나요?
--   9번 SQL 은 "메모 하나의 분석"만 담았습니다 (memo_id 필수).
--   폰 앱 모아보기에 "이 기간 AI 총평"이 생겨, 메모 하나가 아니라
--   기간(예: 8월 한 달)에 대한 결과도 저장해야 합니다.
--
--   - memo_id 를 비워 둘 수 있게 하고
--   - kind('memo' 또는 'period'), period_from, period_to 칸을 더합니다
--   - 종류별로 필요한 칸이 비어 있지 않도록 검사 규칙을 겁니다
--
--  ⚠️ 이 SQL 을 실행하기 전에도 기간 총평은 동작합니다. 다만 결과가 저장되지
--     않아 다시 볼 때 또 돈이 듭니다. 실행하면 저장됩니다.
--  두 번 실행해도 안전합니다.
-- =============================================================

-- 1) memo_id 를 비워 둘 수 있게 ----------------------------------
alter table public.idea_analyses alter column memo_id drop not null;

-- 2) 새 칸 -------------------------------------------------------
alter table public.idea_analyses add column if not exists kind        text not null default 'memo';
alter table public.idea_analyses add column if not exists period_from date;
alter table public.idea_analyses add column if not exists period_to   date;

-- 3) 검사 규칙: 메모 분석은 memo_id 가, 기간 총평은 기간이 있어야 한다 ----
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'idea_analyses_kind_check') then
    alter table public.idea_analyses add constraint idea_analyses_kind_check check (
      (kind = 'memo'   and memo_id is not null)
      or
      (kind = 'period' and period_from is not null and period_to is not null and period_from <= period_to)
    );
  end if;
end $$;

-- 4) 기간 총평을 빨리 찾는 색인 ------------------------------------
create index if not exists idea_analyses_user_period_idx
  on public.idea_analyses (user_id, kind, period_from, period_to, created_at desc);

-- 끝. "Success. No rows returned" 이 나오면 정상입니다.
