-- =============================================================
--  아이디어 캘린더 - 보안 점검 SQL
--
--  실행 방법: Supabase 대시보드 -> SQL Editor -> New query ->
--            이 내용을 통째로 붙여넣고 [Run] 클릭
--
--  아무것도 바꾸지 않습니다. 읽기만 합니다. 몇 번을 실행해도 안전합니다.
--  결과의 "판정" 칸만 보시면 됩니다. 다섯 줄이 전부 ✅ 면 정상입니다.
-- =============================================================

with
-- ① 메모 표에 보안규칙(RLS)이 켜져 있는가
tbl as (
  select c.relrowsecurity as rls_on
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'idea_memos'
),
-- ② 네 가지 규칙(읽기·쓰기·수정·삭제)이 다 있는가
--    cmd 가 ALL 인 규칙 하나로 네 가지를 다 덮는 경우도 인정한다
pol as (
  select
    count(*) filter (where cmd in ('SELECT', 'ALL')) as sel,
    count(*) filter (where cmd in ('INSERT', 'ALL')) as ins,
    count(*) filter (where cmd in ('UPDATE', 'ALL')) as upd,
    count(*) filter (where cmd in ('DELETE', 'ALL')) as del,
    count(*) as total
  from pg_policies
  where schemaname = 'public' and tablename = 'idea_memos'
),
-- ③ 누구나 통과하는 헐거운 규칙이 섞여 있지 않은가
loose as (
  select count(*) as n
  from pg_policies
  where schemaname = 'public' and tablename = 'idea_memos'
    and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
),
-- ④ 주인 없는 메모가 있는가 (있으면 안 된다)
orphan as (
  select count(*) as n from public.idea_memos where user_id is null
),
-- ⑤ 이 프로젝트의 다른 표 중 보안규칙이 꺼진 것이 있는가
others as (
  select count(*) as n
  from pg_class c
  join pg_namespace n2 on n2.oid = c.relnamespace
  where n2.nspname = 'public'
    and c.relkind = 'r'
    and c.relname <> 'idea_memos'
    and c.relrowsecurity = false
)
select * from (
  select 1 as "순",
         '① 메모 표 보안규칙(RLS)' as "항목",
         coalesce((select case when rls_on then '켜짐' else '꺼짐' end from tbl),
                  '표를 찾을 수 없음') as "결과",
         case
           when not exists (select 1 from tbl)
             then '⚠️ idea_memos 표가 없습니다. supabase-setup.sql 부터 실행하세요'
           when (select rls_on from tbl) then '✅ 정상'
           else '🚨 위험 — supabase-setup.sql 을 지금 실행하세요'
         end as "판정"

  union all
  select 2,
         '② 규칙 개수 (읽기·쓰기·수정·삭제)',
         (select total || '개 · 읽기' || sel || ' 쓰기' || ins
                 || ' 수정' || upd || ' 삭제' || del from pol),
         case when (select sel >= 1 and ins >= 1 and upd >= 1 and del >= 1 from pol)
              then '✅ 네 가지가 모두 있습니다'
              else '⚠️ 빠진 규칙이 있습니다' end

  union all
  select 3,
         '③ 누구나 통과하는 헐거운 규칙',
         (select n || '개' from loose),
         case when (select n from loose) = 0 then '✅ 없음'
              else '🚨 위험 — 그 규칙은 남의 메모까지 보여줍니다' end

  union all
  select 4,
         '④ 주인 없는 메모',
         (select n || '건' from orphan),
         case when (select n from orphan) = 0 then '✅ 없음'
              else '⚠️ 확인 필요 — 아무나 볼 수 있는 메모일 수 있습니다' end

  union all
  select 5,
         '⑤ 보안규칙이 꺼진 다른 표',
         (select n || '개' from others),
         case when (select n from others) = 0 then '✅ 없음'
              else '⚠️ 확인 필요 — 이 앱과 무관한 표일 수도 있습니다' end
) t
order by "순";


-- ─────────────────────────────────────────────────────────────
--  규칙 내용을 눈으로 보고 싶으시면 아래도 함께 실행하세요.
--  "읽기조건"과 "쓰기조건"이 모두 (auth.uid() = user_id) 여야 정상입니다.
--  그 자리에 true 가 있으면 누구나 남의 메모를 볼 수 있다는 뜻입니다.
-- ─────────────────────────────────────────────────────────────
select policyname as "규칙이름",
       cmd        as "동작",
       roles      as "적용대상",
       qual       as "읽기조건",
       with_check as "쓰기조건"
from pg_policies
where schemaname = 'public' and tablename = 'idea_memos'
order by cmd, policyname;
