// Faisla Desk — AI proxy (Supabase Edge Function, Deno)
//
// The browser never sees the Anthropic key. Every request must carry a logged-in
// user's Supabase JWT, and the user must belong to a team. The function forwards
// the prompt (and record pictures) to Claude and streams the answer back.
//
// Secrets (Supabase Dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   required
//   AI_MODEL_COMPLEX    optional, default claude-opus-5-5 (reading the record, drafting)
//   AI_MODEL_DEFAULT    optional, default = AI_MODEL_COMPLEX (sorting samples)
//   AI_EFFORT           optional, default high: low | medium | high | xhigh | max
//   AI_TIME_LIMIT_SECONDS optional, default 140. Supabase stops a function after 150 s on the Free
//                       plan (400 s on paid plans). The function ends Claude's answer itself a little
//                       before that, so the part already written reaches the app, which can then ask
//                       Claude to continue from there. On a paid plan set it to 390.
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are set by Supabase itself.
//
// Request (POST, JSON):
//   { mode: "text" | "json", prompt, images?: [{ media_type, data }], tier?: "complex" | "default",
//     stream?: boolean, max_tokens?: number }
// Response:
//   mode "text" (stream)  → text/event-stream, lines `data: {"text": "..."}`, then `data: {"done": true, ...}`
//                           (stop_reason "time_limit" when the time limit ended it early)
//                           or `data: {"error": {"code", "message"}}`
//   mode "json" / no stream → { text, truncated, stop_reason, model }; 504 { code: "time_limit" } when too slow
//   errors → { code, message } with an HTTP error status

import Anthropic from "npm:@anthropic-ai/sdk@1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL_COMPLEX = Deno.env.get("AI_MODEL_COMPLEX") || "claude-opus-5-5";
const MODEL_DEFAULT = Deno.env.get("AI_MODEL_DEFAULT") || MODEL_COMPLEX;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = typeof EFFORTS[number];
const EFFORT_COMPLEX: Effort = (EFFORTS as readonly string[]).includes(Deno.env.get("AI_EFFORT") ?? "") ? Deno.env.get("AI_EFFORT") as Effort : "high";

const TIME_LIMIT_MS = Math.max(30, Number(Deno.env.get("AI_TIME_LIMIT_SECONDS")) || 140) * 1000;

const MAX_IMAGES = 10;
const MAX_IMAGE_B64 = 7_000_000;      // ~5 MB per picture after base64
const MAX_PROMPT_CHARS = 400_000;
const MAX_OUTPUT_TOKENS = 64_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrBody = { code: string; message: string };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Turns SDK / runtime errors into the short codes the app shows to the user.
function mapError(e: unknown): { status: number; body: ErrBody } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 500, body: { code: "no_key", message: "The AI key saved in the Edge Function secrets is wrong or disabled." } };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { status: 429, body: { code: "rate_limited", message: msg } };
  }
  if (e instanceof Anthropic.BadRequestError) {
    if (/image/i.test(msg)) return { status: 400, body: { code: "image_rejected", message: msg } };
    if (/too long|too large|exceed|maximum/i.test(msg)) return { status: 413, body: { code: "prompt_too_large", message: msg } };
    return { status: 400, body: { code: "bad_request", message: msg } };
  }
  if (e instanceof Anthropic.APIUserAbortError) {
    return { status: 499, body: { code: "cancelled", message: "Stopped." } };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { status: 502, body: { code: "network", message: "Could not reach the AI service. Please try again." } };
  }
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 502;
    return { status: status >= 500 ? 502 : status, body: { code: "ai_error", message: msg } };
  }
  return { status: 500, body: { code: "server", message: msg } };
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  // Time left before our own limit; at least 1 s so the timer always fires after the stream starts
  const timeLeft = () => Math.max(1000, TIME_LIMIT_MS - (Date.now() - startedAt));
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "bad_request", message: "POST only" });
  if (!ANTHROPIC_API_KEY) {
    return json(500, { code: "no_key", message: "ANTHROPIC_API_KEY is not set in the Edge Function secrets." });
  }

  // 1. Who is calling, and are they in a team?
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { code: "session_expired", message: "Please sign in again." });
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json(401, { code: "session_expired", message: "Please sign in again." });
  const { data: profile } = await userClient.from("profiles").select("team_id").eq("id", user.id).maybeSingle();
  const teamId: string | null = profile?.team_id ?? null;
  if (!teamId) return json(403, { code: "not_granted", message: "You are not in a team yet." });

  // 2. Validate the request
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { code: "bad_request", message: "Invalid JSON body." }); }
  const mode = body.mode === "json" ? "json" : "text";
  const prompt = String(body.prompt ?? "");
  if (!prompt.trim()) return json(400, { code: "bad_request", message: "Empty prompt." });
  if (prompt.length > MAX_PROMPT_CHARS) return json(413, { code: "prompt_too_large", message: "The prompt is too long." });
  const rawImages = Array.isArray(body.images) ? body.images : [];
  if (rawImages.length > MAX_IMAGES) return json(400, { code: "image_rejected", message: `At most ${MAX_IMAGES} pictures per request.` });
  const images: { media_type: string; data: string }[] = [];
  for (const im of rawImages) {
    const mt = String((im as Record<string, unknown>)?.media_type ?? "");
    const data = String((im as Record<string, unknown>)?.data ?? "");
    if (!IMAGE_TYPES.has(mt) || !data || data.length > MAX_IMAGE_B64) {
      return json(400, { code: "image_rejected", message: "A picture is too large or not a JPEG/PNG/WebP image." });
    }
    images.push({ media_type: mt, data });
  }
  const tier = body.tier === "default" ? "default" : "complex";
  const model = tier === "complex" ? MODEL_COMPLEX : MODEL_DEFAULT;
  const effort: Effort = tier === "complex" ? EFFORT_COMPLEX : "medium";
  const requested = Number(body.max_tokens);
  const maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(1000, Number.isFinite(requested) && requested > 0 ? requested : mode === "json" ? 24_000 : 32_000));
  const wantStream = mode === "text" && body.stream !== false;

  // 3. Build the Claude request. Thinking is adaptive (always on for Opus 5.5); effort steers depth.
  //    Server-side refusal fallback ("default") re-runs a declined request on another model.
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 2 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.map((im) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: im.media_type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: im.data },
    })),
    { type: "text" as const, text: prompt },
  ];
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const logUsage = async (final: Anthropic.Beta.BetaMessage) => {
    try {
      await admin.from("ai_usage").insert({
        team_id: teamId,
        user_id: user.id,
        model: final.model,
        mode,
        input_tokens: final.usage?.input_tokens ?? 0,
        output_tokens: final.usage?.output_tokens ?? 0,
        cache_read_tokens: final.usage?.cache_read_input_tokens ?? 0,
      });
    } catch (e) {
      console.error("ai_usage insert failed", e);
    }
  };
  const textOf = (final: Anthropic.Beta.BetaMessage) =>
    final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");

  // 4a. One answer (JSON mode). Streaming is used internally so long answers never hit HTTP timeouts.
  //     A JSON answer is useless when cut short, so at the time limit it returns a clear error instead.
  if (!wantStream) {
    let timedOut = false;
    const stream = client.beta.messages.stream(params, { signal: req.signal });
    const guard = setTimeout(() => { timedOut = true; stream.abort(); }, timeLeft());
    try {
      const final = await stream.finalMessage();
      await logUsage(final);
      if (final.stop_reason === "refusal") return json(422, { code: "refused", message: "Claude declined this request." });
      return json(200, { text: textOf(final), truncated: final.stop_reason === "max_tokens", stop_reason: final.stop_reason, model: final.model });
    } catch (e) {
      if (timedOut) {
        const partial = stream.currentMessage;
        if (partial) await logUsage(partial);
        return json(504, { code: "time_limit", message: "This took longer than the server allows." });
      }
      const m = mapError(e);
      return json(m.status, m.body);
    } finally {
      clearTimeout(guard);
    }
  }

  // 4b. Streamed draft: text deltas as SSE, a ping every 10 s while Claude is still thinking.
  const enc = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* client gone */ }
      };
      const ping = setInterval(() => send({ ping: true }), 10_000);
      // End the answer ourselves just before Supabase would kill the function, so the text
      // written so far is delivered with a clear "time_limit" marker and the app can continue it.
      let timedOut = false;
      const stream = client.beta.messages.stream(params, { signal: req.signal });
      const guard = setTimeout(() => { timedOut = true; stream.abort(); }, timeLeft());
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") send({ text: event.delta.text });
        }
        const final = await stream.finalMessage();
        await logUsage(final);
        if (final.stop_reason === "refusal") send({ error: { code: "refused", message: "Claude declined this request." } });
        else send({ done: true, truncated: final.stop_reason === "max_tokens", stop_reason: final.stop_reason, model: final.model });
      } catch (e) {
        if (timedOut) {
          const partial = stream.currentMessage;
          if (partial) await logUsage(partial);
          send({ done: true, truncated: true, stop_reason: "time_limit" });
        } else {
          const m = mapError(e);
          send({ error: m.body });
        }
      } finally {
        clearTimeout(guard);
        clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(readable, {
    headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
});
