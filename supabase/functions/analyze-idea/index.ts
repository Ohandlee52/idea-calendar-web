// =============================================================
//  아이디어 캘린더 - AI 분석 서버 함수 (Supabase Edge Function)
//
//  하는 일 (두 가지):
//   ① 메모 하나 분석  { memoId }            → 장단점·기존 사례(웹 검색)·예전 메모와의 연관·전망
//   ② 기간 묶음 총평  { period: {from,to} } → 그 기간 메모 전체를 읽고 반복 주제·밀고 갈 것·보류할 것
//  결과는 idea_analyses 표에 저장하고 돌려준다.
//
//  왜 서버를 거치나: 앱 코드는 공개라 AI 열쇠를 넣을 수 없다. 열쇠는 이 함수의
//  환경변수(ANTHROPIC_API_KEY)에만 있고, 사용자는 볼 수 없다.
//
//  배포 방법: Supabase 대시보드 → Edge Functions → analyze-idea → Code
//            → 전체 지우고 이 파일 내용 붙여넣기 → Deploy
//            (처음이면 Deploy a new function → Via Editor → 이름 analyze-idea)
//            → Secrets 에 ANTHROPIC_API_KEY 등록. SUPABASE_URL 등은 자동.
//
//  ⚠️ 시간 한도: Supabase 무료 등급은 함수 하나가 150초를 넘기면 끊는다.
//     effort high + 웹 검색 4번은 넘겼다 (실제로 끊김). 아래 설정은 한도 안이다.
// =============================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// 절약형 설정 (2026-09-09 대표님 결정). Opus 5 + 검색 6번 + 긴 답은 1회 657원이었다.
// Sonnet 5 + 검색 3번 + 짧은 답으로 1회 120~200원. 깊게 보려면 MODEL 을 "claude-opus-5" 로.
const MODEL = "claude-sonnet-5";
const EFFORT = "medium";         // 생각 깊이: low / medium / high (high 는 시간 한도에 걸림)
const MAX_TOKENS = 2500;         // 답 길이 상한 (길이가 곧 비용이다)
const DAILY_LIMIT = 10;          // 한 사람이 하루에 돌릴 수 있는 횟수 (메모 분석 + 기간 총평 합산)
const MAX_WEB_SEARCHES = 3;      // 메모 분석에서 허용하는 웹 검색 횟수 (4번은 시간 한도에 걸림)
const MIN_TEXT_LENGTH = 5;
const RELATED_LIMIT = 300;       // 연관성 판단용으로 넘기는 "내 다른 메모" 개수 (제목·태그만)
const PERIOD_LIMIT = 300;        // 기간 총평에 넣는 메모 개수 상한
const PERIOD_BODY_CHARS = 120;   // 기간 총평에서 메모 본문을 앞에서 몇 글자까지 넣나

// 1회 비용 어림값 (원). 표시용이며 정확한 청구액은 Anthropic 콘솔이 기준이다.
// 100만 토큰당 단가(달러): Opus 5 입력 5 / 출력 25, Sonnet 5 입력 2 / 출력 10.
// 웹 검색은 1000회당 $10. 환율 1,400원 가정.
const PRICE: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
};
function estimateCostKrw(model: string, inputTokens: number, outputTokens: number, searches: number): number {
  const p = PRICE[model] ?? PRICE["claude-opus-5"];   // 모르는 모델이면 비싼 쪽으로 어림
  const usd = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output + (searches / 1000) * 10;
  return Math.round(usd * 1400);
}

// 두 지시문에 공통으로 붙는 글쓰기 규칙
const STYLE_RULES = `글쓰기 규칙:
- 서두("분석을 정리하겠습니다" 등)와 맺음말을 쓰지 않습니다. 첫 줄부터 "■" 제목으로 시작합니다.
- 표·코드블록·굵게 표시를 쓰지 않습니다. 짧은 문장으로 씁니다.
- 숫자(시장 규모, 성장률, 사용자 수 등)는 검색 결과에 출처 사이트 이름이 있을 때만, 출처와 함께 씁니다. 출처가 없으면 숫자를 쓰지 않습니다.
- "직접 검색해 보세요", "별도 확인이 필요합니다" 같은 말은 쓰지 않습니다. 확인은 당신이 하는 일입니다.
- "검색 한도", "도구 사용 횟수" 같은 내부 사정은 답에 쓰지 않습니다.
- 검색 결과나 메모 목록에 없는 제품·회사 이름을 지어내지 않습니다.`;

const MEMO_PROMPT = `당신은 사업 아이디어를 냉정하게 검토해 주는 조언자입니다. 사용자가 적어 둔 짧은 아이디어 메모를 읽고, 아래 항목을 한국어로 정리합니다.

일하는 순서:
- 웹 검색은 3번까지 됩니다. 1번째·2번째 검색은 반드시 "같은 아이디어가 이미 있는지"(기존 제품·서비스·앱)를 찾는 데 씁니다. 한국어로 한 번, 영어로 한 번 검색합니다. 3번째만 시장·정책 확인에 씁니다.
- "이미 있는 것" 항목에는 검색에서 나온 가장 가까운 기존 제품·서비스를 2~3개, 각각 이름 + 무엇을 하는지 한 문장 + 출처(사이트 이름)로 적습니다. 이 항목이 이 분석의 핵심입니다.
- 정확히 같은 것이 없으면 "똑같은 것은 없고, 가장 가까운 것은 ○○"라고 씁니다. 두 번 검색해도 관련 결과가 전혀 없을 때만 "찾지 못함"이라고 씁니다.
- "예전 아이디어와의 연관" 항목은 함께 주어지는 "내 다른 메모 목록"만 보고 씁니다. 이 아이디어와 이어지거나 겹치는 메모가 있으면 날짜와 제목으로 2~3개를 들고 어떻게 이어지는지 한 문장씩 씁니다. 없으면 "연관된 메모 없음"이라고만 씁니다.
- 칭찬으로 채우지 않습니다. 약점과 위험을 구체적으로 씁니다.

길이: 각 항목은 3문장 이내, 전체 800자 이내. 이 길이를 넘기지 않습니다.

${STYLE_RULES}

출력 형식 (제목 줄은 이대로, 순서대로):
■ 핵심 요약
■ 강점
■ 약점·위험
■ 이미 있는 것 (웹 검색 결과)
■ 예전 아이디어와의 연관
■ 차별화 방향
■ 전망
■ 한 줄 판단 (점수/5)`;

const PERIOD_PROMPT = `당신은 한 사람이 일정 기간 동안 적어 둔 아이디어 메모 전체를 읽고, 그 흐름을 정리해 주는 조언자입니다. 웹 검색 없이 메모만 보고 한국어로 씁니다.

일하는 순서:
- 먼저 메모 전체를 훑어 반복해서 나오는 주제를 찾습니다. 주제마다 관련 메모를 날짜와 제목으로 듭니다.
- "밀고 갈 만한 것"은 메모 중에서 3개까지 고르고, 왜 그런지 한 문장씩 씁니다. 근거는 메모에 적힌 내용이어야 합니다.
- "접거나 보류할 것"도 근거와 함께 씁니다. 없으면 "없음"이라고 씁니다.
- 메모가 많으면 개수와 날짜 분포를 한 줄로 적습니다.

길이: 각 항목은 4문장 이내, 전체 900자 이내. 이 길이를 넘기지 않습니다.

${STYLE_RULES}

출력 형식 (제목 줄은 이대로, 순서대로):
■ 이 기간 한눈에
■ 반복되는 주제
■ 밀고 갈 만한 것
■ 접거나 보류할 것
■ 다음 한 달 제안`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

const isDateKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const cut = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

type MemoRow = { id: string; date: string; title: string | null; body: string | null; tags: string[] | null };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST 만 받습니다" }, 405);

  try {
    // 1) 누가 요청했는지 (폰 앱이 보낸 로그인 토큰으로 확인)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "로그인이 필요합니다" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // 공개 키: 옛 이름(SUPABASE_ANON_KEY)이 없으면 새 방식(SUPABASE_PUBLISHABLE_KEYS, JSON 묶음)에서 꺼낸다.
    let anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!anonKey) {
      try {
        const dict = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
        anonKey = String(Object.values(dict)[0] ?? "");
      } catch (e) {
        console.error("SUPABASE_PUBLISHABLE_KEYS 를 읽지 못함:", e);
      }
    }
    if (!supabaseUrl || !anonKey) return json({ error: "서버 설정(SUPABASE_URL / 공개 키)이 없습니다" }, 500);

    // 사용자 토큰을 그대로 넘겨서, 표를 읽고 쓸 때 RLS(내 것만) 규칙이 그대로 적용되게 한다.
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: "로그인이 만료됐습니다. 다시 로그인해 주세요." }, 401);

    // 2) 무엇을 분석할지
    let body: { memoId?: unknown; period?: { from?: unknown; to?: unknown } };
    try {
      body = await req.json();
    } catch {
      return json({ error: "요청 내용이 올바르지 않습니다" }, 400);
    }
    const memoId = String(body?.memoId ?? "").trim();
    const period = body?.period;
    const isPeriod = !!period;
    if (!memoId && !isPeriod) return json({ error: "memoId 또는 period 가 필요합니다" }, 400);

    let systemPrompt = MEMO_PROMPT;
    let userPrompt = "";
    let useSearch = true;
    let label = "";                                   // 로그·저장용 이름표
    let periodFrom = "", periodTo = "";

    if (isPeriod) {
      // ── ② 기간 묶음 총평 ──
      if (!isDateKey(period.from) || !isDateKey(period.to)) return json({ error: "기간(from/to)은 YYYY-MM-DD 형식이어야 합니다" }, 400);
      periodFrom = period.from; periodTo = period.to;
      if (periodFrom > periodTo) return json({ error: "시작이 끝보다 늦습니다" }, 400);

      const { data: memos, error: memosErr } = await supabase
        .from("idea_memos")
        .select("id,date,title,body,tags")
        .eq("deleted", false)
        .gte("date", periodFrom)
        .lte("date", periodTo)
        .order("date", { ascending: true })
        .limit(PERIOD_LIMIT + 1);
      if (memosErr) return json({ error: `메모를 읽지 못했습니다: ${memosErr.message}` }, 500);
      const list = (memos ?? []) as MemoRow[];
      if (list.length === 0) return json({ error: "이 기간에는 메모가 없습니다" }, 404);
      const truncatedList = list.length > PERIOD_LIMIT;
      const used = list.slice(0, PERIOD_LIMIT);

      const lines = used.map((m) => {
        const tags = Array.isArray(m.tags) && m.tags.length ? ` (#${m.tags.join(" #")})` : "";
        const b = cut(m.body, PERIOD_BODY_CHARS);
        return `- ${m.date} [${cut(m.title, 60) || "(제목 없음)"}]${tags}${b ? ` — ${b}` : ""}`;
      });
      userPrompt = [
        `기간: ${periodFrom} ~ ${periodTo}`,
        `메모 수: ${used.length}개${truncatedList ? ` (너무 많아 앞의 ${PERIOD_LIMIT}개만 넣음)` : ""}`,
        "",
        "메모 목록 (날짜 [제목] (#태그) — 본문 앞부분):",
        ...lines,
      ].join("\n");
      systemPrompt = PERIOD_PROMPT;
      useSearch = false;
      label = `기간 ${periodFrom}~${periodTo} (${used.length}개)`;
    } else {
      // ── ① 메모 하나 분석 ──
      const { data: memo, error: memoErr } = await supabase
        .from("idea_memos")
        .select("id,title,body,tags,date")
        .eq("id", memoId)
        .eq("deleted", false)
        .maybeSingle();
      if (memoErr) return json({ error: `메모를 읽지 못했습니다: ${memoErr.message}` }, 500);
      if (!memo) return json({ error: "메모를 찾을 수 없습니다" }, 404);

      const title = String(memo.title ?? "").trim();
      const bodyText = String(memo.body ?? "").trim();
      const tags: string[] = Array.isArray(memo.tags) ? memo.tags : [];
      if ((title + bodyText).length < MIN_TEXT_LENGTH) {
        return json({ error: "분석할 내용이 너무 짧습니다. 제목이나 본문을 조금 더 적어 주세요." }, 400);
      }

      // 내 다른 메모 목록 (제목·태그만) — "예전 아이디어와의 연관" 판단용.
      // 경쟁 서비스에는 없는 재료다. 제목만 넘기므로 비용은 회당 10원 안팎이다.
      const { data: others, error: othersErr } = await supabase
        .from("idea_memos")
        .select("id,date,title,tags")
        .eq("deleted", false)
        .neq("id", memoId)
        .order("updated_at", { ascending: false })
        .limit(RELATED_LIMIT);
      if (othersErr) console.error("다른 메모 목록을 읽지 못함 (연관성 항목 없이 진행):", othersErr.message);
      const otherLines = ((others ?? []) as MemoRow[])
        .map((m) => {
          const t = cut(m.title, 40);
          const tg = Array.isArray(m.tags) && m.tags.length ? ` (#${m.tags.join(" #")})` : "";
          return t ? `- ${m.date} ${t}${tg}` : "";
        })
        .filter((l) => l !== "");

      userPrompt = [
        `날짜: ${memo.date ?? ""}`,
        `제목: ${title || "(없음)"}`,
        tags.length ? `태그: ${tags.join(", ")}` : "",
        "",
        "메모 내용:",
        bodyText || "(본문 없음)",
        "",
        `내 다른 메모 목록 (연관성 판단용, 최근 ${otherLines.length}개, 날짜 제목 (#태그)):`,
        otherLines.length ? otherLines.join("\n") : "(다른 메모 없음)",
      ].filter((l) => l !== "").join("\n");
      label = `메모 ${memoId}`;
    }

    // 3) 하루 횟수 제한 (누가 실수로 연타해도 돈이 새지 않게)
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("idea_analyses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (countErr) return json({ error: `횟수를 확인하지 못했습니다: ${countErr.message}` }, 500);
    if ((count ?? 0) >= DAILY_LIMIT) {
      return json({ error: `하루 ${DAILY_LIMIT}번까지만 분석할 수 있어요. 내일 다시 해주세요.` }, 429);
    }

    // 4) AI 에게 묻기 — 여기서부터 30초~2분이 걸린다.
    //    그동안 아무것도 안 보내면 중간 서버(Cloudflare)가 100초쯤에 연결을 끊고,
    //    폰은 "서버에 연결하지 못했어요"를 본다 (실제로 그랬다).
    //    그래서 응답 머리를 먼저 열고 5초마다 빈칸 한 글자를 흘려보낸 뒤, 끝에 JSON 을 쓴다.
    //    JSON 앞의 빈칸은 규격상 허용되어 폰 쪽(supabase-js)이 그대로 읽는다.
    //    머리를 먼저 보내므로 이 뒤의 오류는 HTTP 상태가 아니라 본문 {ok:false, error} 로 전한다.
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "서버에 AI 열쇠(ANTHROPIC_API_KEY)가 등록되지 않았습니다" }, 500);
    const client = new Anthropic({ apiKey });

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let clientGone = false;
    const keepalive = setInterval(() => {
      writer.write(enc.encode(" ")).catch((e) => {
        if (!clientGone) console.warn("폰과의 연결이 끊긴 듯함 (분석은 계속해서 저장함):", e?.message ?? e);
        clientGone = true;
      });
    }, 5000);
    const finish = async (payload: unknown) => {
      clearInterval(keepalive);
      try {
        await writer.write(enc.encode(JSON.stringify(payload)));
        await writer.close();
      } catch (e) {
        console.error("응답을 쓰지 못함 (폰이 먼저 끊었을 수 있음):", e);
      }
    };

    (async () => {
      const t0 = Date.now();
      try {
        // 출력이 길어야 몇천 토큰이라 스트리밍 없이 한 번에 받는다.
        // (SDK 가 max_tokens 크기에 맞춰 대기 시간을 늘려 준다)
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          thinking: { type: "adaptive" },
          output_config: { effort: EFFORT },
          ...(useSearch
            ? {
              tools: [{
                type: "web_search_20260209",
                name: "web_search",
                max_uses: MAX_WEB_SEARCHES,
                user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" },
              }],
            }
            : {}),
          messages: [{ role: "user", content: userPrompt }],
        });

        console.log(`[${label}] AI 응답까지 ${Math.round((Date.now() - t0) / 1000)}초 (한도 150초)`);
        // 검색을 실제로 어떻게 썼는지 서버 기록에 남긴다 (Supabase → Edge Functions → Logs 에서 봄).
        // "찾지 못함"이 자꾸 나오면 여기서 검색어가 이상한지, 결과가 비었는지 확인한다.
        for (const b of msg.content as Array<Record<string, unknown>>) {
          if (b.type === "server_tool_use") {
            console.log("검색어:", JSON.stringify((b.input as { query?: string })?.query ?? b.input));
          } else if (b.type === "web_search_tool_result") {
            const c = b.content as unknown;
            const n = Array.isArray(c) ? c.length : -1;
            const err = !Array.isArray(c) && c && typeof c === "object" ? (c as { error_code?: string }).error_code : undefined;
            console.log("검색 결과:", n >= 0 ? `${n}건` : `오류 ${err ?? "?"}`);
          }
        }

        if (msg.stop_reason === "refusal") {
          await finish({ ok: false, error: "AI 가 이 내용의 분석을 거절했습니다." });
          return;
        }
        const result = msg.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n")
          .trim();
        if (!result) {
          await finish({ ok: false, error: "AI 가 빈 답을 돌려줬습니다. 다시 시도해 주세요." });
          return;
        }

        const usage = msg.usage as {
          input_tokens?: number; output_tokens?: number;
          server_tool_use?: { web_search_requests?: number };
        };
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const searches = usage.server_tool_use?.web_search_requests ?? 0;
        const truncated = msg.stop_reason === "max_tokens";

        // 5) 저장 (같은 대상을 다시 분석하면 새 줄이 쌓인다 — 이전 결과도 남는다)
        //    폰과의 연결이 끊겼어도 여기까지 오면 저장된다. 폰은 표를 다시 읽어 결과를 찾는다.
        const base = {
          user_id: user.id,
          result: truncated ? result + "\n\n(답이 길어 여기서 잘렸습니다)" : result,
          model: msg.model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          web_searches: searches,
          cost_krw: estimateCostKrw(msg.model, inputTokens, outputTokens, searches),
        };
        // 기간 총평은 memo_id 가 없고 kind/period_from/period_to 를 쓴다 (SQL 10번이 만든 칸).
        const row = isPeriod
          ? { ...base, memo_id: null, kind: "period", period_from: periodFrom, period_to: periodTo }
          : { ...base, memo_id: memoId, kind: "memo" };

        const { data: saved, error: saveErr } = await supabase
          .from("idea_analyses")
          .insert(row)
          .select("id,memo_id,kind,period_from,period_to,result,model,cost_krw,created_at")
          .single();
        if (saveErr) {
          // 저장에 실패해도 분석 결과는 이미 받았으니 돌려준다. 다만 실패를 숨기지 않는다.
          // (kind 칸이 없다는 오류면 SQL 10번을 아직 안 돌린 것이다)
          console.error("분석 결과 저장 실패:", saveErr.message);
          const hint = /kind|period_from|period_to|column/i.test(saveErr.message)
            ? "결과가 저장되지 않았어요. Supabase 에서 SQL 10번(supabase-migration-10)을 실행하면 저장됩니다."
            : `결과가 저장되지 않았어요: ${saveErr.message}`;
          await finish({ ok: true, analysis: { ...row, created_at: new Date().toISOString() }, saveError: hint });
          return;
        }
        await finish({ ok: true, analysis: saved });
      } catch (e) {
        await finish({ ok: false, error: describeAiError(e) });
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "X-Accel-Buffering": "no" },
    });
  } catch (e) {
    console.error("분석 함수 오류:", e);
    return json({ error: `서버 오류: ${(e as Error)?.message ?? e}` }, 500);
  }
});

// Anthropic 쪽 오류를 종류별로 사람이 읽을 수 있는 말로 바꾼다.
function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) {
    return "AI 열쇠(ANTHROPIC_API_KEY)가 잘못됐습니다. Secrets 를 확인해 주세요.";
  }
  if (e instanceof Anthropic.RateLimitError) {
    return "AI 서버가 지금 붐빕니다. 잠시 뒤 다시 해주세요.";
  }
  if (e instanceof Anthropic.APIError) {
    const status = (e as { status?: number }).status ?? 0;
    if (status === 400 && /credit|billing|balance/i.test(e.message)) {
      return "AI 사용 잔액이 부족합니다. Anthropic 콘솔에서 충전해 주세요.";
    }
    return `AI 서버 오류 (${status}): ${e.message}`;
  }
  console.error("분석 중 오류:", e);
  return `분석 중 오류: ${(e as Error)?.message ?? e}`;
}
