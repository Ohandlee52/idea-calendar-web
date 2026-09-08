// =============================================================
//  아이디어 캘린더 - AI 분석 서버 함수 (Supabase Edge Function)
//
//  하는 일: 폰 앱이 메모 id 를 보내면, 그 메모(제목·본문·태그)를 Claude 에게
//  넘겨 장단점·비슷한 사례·전망을 한국어로 분석받고, 결과를 idea_analyses 표에
//  저장한 뒤 돌려준다.
//
//  왜 서버를 거치나: 앱 코드는 공개라 AI 열쇠를 넣을 수 없다. 열쇠는 이 함수의
//  환경변수(ANTHROPIC_API_KEY)에만 있고, 사용자는 볼 수 없다.
//
//  배포 방법: Supabase 대시보드 → Edge Functions → Deploy a new function
//            → Via Editor → 이름 analyze-idea → 이 파일 내용 붙여넣기 → Deploy
//            → Edge Functions → Secrets 에 ANTHROPIC_API_KEY 등록
//  (SUPABASE_URL, SUPABASE_ANON_KEY 는 Supabase 가 자동으로 넣어 준다)
// =============================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// 절약형 설정 (2026-09-09 대표님 결정). 처음엔 Opus 5 + 검색 6번 + 긴 답이었는데
// 1회 657원이 나왔다. Sonnet 5 + 검색 3번 + 짧은 답으로 약 100원 안팎을 목표로 한다.
// 더 깊게 보고 싶으면 MODEL 을 "claude-opus-5" 로, 검색을 4~6으로 올리면 된다.
const MODEL = "claude-sonnet-5";
const EFFORT = "medium";         // 생각 깊이: low / medium / high
const MAX_TOKENS = 3000;         // 답 길이 상한
const DAILY_LIMIT = 10;          // 한 사람이 하루에 돌릴 수 있는 횟수 (비용 보호)
const MAX_WEB_SEARCHES = 3;      // 한 번 분석에 허용하는 웹 검색 횟수
const MIN_TEXT_LENGTH = 5;

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

const SYSTEM_PROMPT = `당신은 사업 아이디어를 냉정하게 검토해 주는 조언자입니다. 사용자가 적어 둔 짧은 아이디어 메모를 읽고, 아래 항목을 한국어로 정리합니다.

규칙:
- 메모가 짧고 거칠어도 그 안의 핵심 의도를 먼저 한 줄로 요약한 뒤 분석합니다.
- "이미 있는 아이디어인지"는 웹 검색으로 확인하고(최대 3번), 찾은 사례는 이름과 출처(사이트 이름)를 적습니다. 찾지 못했으면 "찾지 못함"이라고 씁니다. 지어내지 않습니다.
- 칭찬으로 채우지 않습니다. 약점과 위험을 구체적으로 씁니다.
- 짧게 씁니다. 각 항목은 2~3문장, 전체 600자 안팎. 표나 코드블록은 쓰지 않습니다.
- 마지막에 "한 줄 판단"으로 실행 가치를 1~5점으로 매기고 이유를 한 문장 붙입니다.

출력 형식 (제목 줄은 이대로, 순서대로):
■ 핵심 요약
■ 강점
■ 약점·위험
■ 이미 있는 것 (웹 검색 결과)
■ 차별화 방향
■ 전망
■ 한 줄 판단 (점수/5)`;

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

    // 2) 어떤 메모인지
    let memoId = "";
    try {
      const body = await req.json();
      memoId = String(body?.memoId ?? "").trim();
    } catch {
      return json({ error: "요청 내용이 올바르지 않습니다" }, 400);
    }
    if (!memoId) return json({ error: "memoId 가 필요합니다" }, 400);

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

    const userPrompt = [
      `날짜: ${memo.date ?? ""}`,
      `제목: ${title || "(없음)"}`,
      tags.length ? `태그: ${tags.join(", ")}` : "",
      "",
      "메모 내용:",
      bodyText || "(본문 없음)",
    ].filter((l) => l !== "").join("\n");

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
    const finish = async (body: unknown) => {
      clearInterval(keepalive);
      try {
        await writer.write(enc.encode(JSON.stringify(body)));
        await writer.close();
      } catch (e) {
        console.error("응답을 쓰지 못함 (폰이 먼저 끊었을 수 있음):", e);
      }
    };

    (async () => {
      try {
        // 출력이 길어야 몇천 토큰이라 스트리밍 없이 한 번에 받는다.
        // (SDK 가 max_tokens 크기에 맞춰 대기 시간을 늘려 준다)
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          thinking: { type: "adaptive" },
          output_config: { effort: EFFORT },
          tools: [{
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_WEB_SEARCHES,
            user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" },
          }],
          messages: [{ role: "user", content: userPrompt }],
        });

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

        // 5) 저장 (같은 메모를 다시 분석하면 새 줄이 쌓인다 — 이전 결과도 남는다)
        //    폰과의 연결이 끊겼어도 여기까지 오면 저장된다. 폰은 표를 다시 읽어 결과를 찾는다.
        const row = {
          memo_id: memoId,
          user_id: user.id,
          result: truncated ? result + "\n\n(답이 길어 여기서 잘렸습니다)" : result,
          model: msg.model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          web_searches: searches,
          cost_krw: estimateCostKrw(msg.model, inputTokens, outputTokens, searches),
        };
        const { data: saved, error: saveErr } = await supabase
          .from("idea_analyses")
          .insert(row)
          .select("id,memo_id,result,model,cost_krw,created_at")
          .single();
        if (saveErr) {
          // 저장에 실패해도 분석 결과는 이미 받았으니 돌려준다. 다만 실패를 숨기지 않는다.
          console.error("분석 결과 저장 실패:", saveErr.message);
          await finish({ ok: true, analysis: { ...row, created_at: new Date().toISOString() }, saveError: saveErr.message });
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
