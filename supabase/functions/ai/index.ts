// Faisla Desk — AI proxy (Supabase Edge Function, Deno)
//
// The browser never sees an AI key. Every request must carry a logged-in user's
// Supabase JWT, and the user must belong to a team. The function forwards the prompt
// (and record pictures) to the chosen AI provider and streams the answer back.
//
// Secrets (Supabase Dashboard → Edge Functions → Secrets):
//   AI_PROVIDER         optional: "gemini" or "anthropic". If not set, the provider whose key
//                       is set is used (Anthropic first when both keys are set).
//   GEMINI_API_KEY      key from Google AI Studio (for AI_PROVIDER gemini)
//   GEMINI_MODEL        optional; if not set, the best Gemini Pro model available to the key is
//                       picked automatically (Google renames its models often)
//   ANTHROPIC_API_KEY   key from console.anthropic.com (for AI_PROVIDER anthropic)
//   AI_MODEL_COMPLEX    optional, Anthropic model, default claude-opus-5-5
//   AI_MODEL_DEFAULT    optional, Anthropic model for sorting samples, default = AI_MODEL_COMPLEX
//   AI_EFFORT           optional, Anthropic only, default high: low | medium | high | xhigh | max
//   AI_TIME_LIMIT_SECONDS optional, default 140. Supabase stops a function after 150 s on the Free
//                       plan (400 s on paid plans). The function ends the answer itself a little
//                       before that, so the part already written reaches the app, which can then
//                       ask the AI to continue from there. On a paid plan set it to 390.
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
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const PROVIDER: "anthropic" | "gemini" = (() => {
  const p = (Deno.env.get("AI_PROVIDER") ?? "").trim().toLowerCase();
  if (p === "gemini" || p === "google") return "gemini";
  if (p === "anthropic" || p === "claude") return "anthropic";
  return ANTHROPIC_API_KEY ? "anthropic" : GEMINI_API_KEY ? "gemini" : "anthropic";
})();

const MODEL_COMPLEX = Deno.env.get("AI_MODEL_COMPLEX") || "claude-opus-5-5";
const MODEL_DEFAULT = Deno.env.get("AI_MODEL_DEFAULT") || MODEL_COMPLEX;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = typeof EFFORTS[number];
const EFFORT_COMPLEX: Effort = (EFFORTS as readonly string[]).includes(Deno.env.get("AI_EFFORT") ?? "") ? Deno.env.get("AI_EFFORT") as Effort : "high";

const GEMINI_BASE = (Deno.env.get("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_MODEL = (Deno.env.get("GEMINI_MODEL") ?? "").trim().replace(/^models\//, "");

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
type Stop = "end" | "max_tokens" | "refusal" | "incomplete";
type Meter = { model: string; input: number; output: number; cache: number };
type Job = { mode: "text" | "json"; prompt: string; images: { media_type: string; data: string }[]; tier: "complex" | "default"; maxTokens: number };

/** An error with the short code the app shows to the user. */
class AiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Turns provider / runtime errors into the short codes the app shows to the user.
function mapError(e: unknown): { status: number; body: ErrBody } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof AiError) return { status: e.status, body: { code: e.code, message: e.message } };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { status: 500, body: { code: "no_key", message: "The Anthropic key saved in the Edge Function secrets is wrong or disabled." } };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { status: 429, body: { code: "rate_limited", message: msg } };
  }
  if (e instanceof Anthropic.BadRequestError) {
    if (/image/i.test(msg)) return { status: 400, body: { code: "image_rejected", message: msg } };
    if (/too long|too large|exceed|maximum/i.test(msg)) return { status: 413, body: { code: "prompt_too_large", message: msg } };
    return { status: 400, body: { code: "bad_request", message: msg } };
  }
  if (e instanceof Anthropic.APIUserAbortError || (e instanceof DOMException && e.name === "AbortError")) {
    return { status: 499, body: { code: "cancelled", message: "Stopped." } };
  }
  if (e instanceof Anthropic.APIConnectionError || e instanceof TypeError) {
    return { status: 502, body: { code: "network", message: "Could not reach the AI service. Please try again." } };
  }
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 502;
    return { status: status >= 500 ? 502 : status, body: { code: "ai_error", message: msg } };
  }
  return { status: 500, body: { code: "server", message: msg } };
}

/* ======================= Anthropic (Claude) ======================= */

let claude: Anthropic | null = null;

async function runClaude(job: Job, onText: (t: string) => void, signal: AbortSignal, meter: Meter): Promise<Stop> {
  claude ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 2 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...job.images.map((im) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: im.media_type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: im.data },
    })),
    { type: "text" as const, text: job.prompt },
  ];
  // Thinking is adaptive (always on for Opus 5.5); effort steers depth.
  // Server-side refusal fallback ("default") re-runs a declined request on another model.
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: job.tier === "complex" ? MODEL_COMPLEX : MODEL_DEFAULT,
    max_tokens: job.maxTokens,
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: { effort: job.tier === "complex" ? EFFORT_COMPLEX : "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  meter.model = params.model;
  const stream = claude.beta.messages.stream(params, { signal });
  for await (const event of stream) {
    if (event.type === "message_start") {
      meter.model = event.message.model;
      meter.input = event.message.usage?.input_tokens ?? meter.input;
      meter.cache = event.message.usage?.cache_read_input_tokens ?? meter.cache;
    } else if (event.type === "message_delta") {
      meter.output = event.usage?.output_tokens ?? meter.output;
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  meter.model = final.model;
  meter.input = final.usage?.input_tokens ?? meter.input;
  meter.output = final.usage?.output_tokens ?? meter.output;
  meter.cache = final.usage?.cache_read_input_tokens ?? meter.cache;
  return final.stop_reason === "refusal" ? "refusal" : final.stop_reason === "max_tokens" ? "max_tokens" : "end";
}

/* ======================= Google Gemini ======================= */

let geminiModelCache = "";

/** Picks the best text model from the key's model list: the newest Pro (a stable one before a
 *  preview of the same version), else the newest Flash. If a picked preview is withdrawn later,
 *  the 404 makes the function pick again. Exported for tests. */
export function pickGeminiModel(names: string[]): string {
  const skip = /(tts|image|embed|live|audio|aqa|robotics|computer-use|nano|veo|imagen|learnlm|gemma|native|dialog|exp)/i;
  const usable = names.filter((n) => /^gemini-/i.test(n) && !skip.test(n));
  if (usable.includes("gemini-pro-latest")) return "gemini-pro-latest";
  const info = (n: string) => {
    const m = n.match(/^gemini-(\d+)(?:\.(\d+))?/i);
    const version = m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
    const tier = /-pro\b/i.test(n) ? 3 : /flash-lite/i.test(n) ? 1 : /flash/i.test(n) ? 2 : 0;
    const stable = /preview|latest/i.test(n) ? 0 : 1;
    const dated = /-\d{2}-\d{2}$|-\d{3,}$/.test(n) ? 0 : 1;   // "gemini-x-pro" before "gemini-x-pro-06-05"
    return { tier, stable, version, dated };
  };
  const ranked = usable
    .map((n) => ({ n, ...info(n) }))
    .filter((x) => x.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.version - a.version || b.stable - a.stable || b.dated - a.dated || a.n.localeCompare(b.n));
  if (ranked.length) return ranked[0].n;
  return usable.includes("gemini-flash-latest") ? "gemini-flash-latest" : "";
}

async function geminiError(res: Response): Promise<AiError> {
  let msg = "", details = "";
  try {
    const j = await res.json();
    msg = String(j?.error?.message ?? "");
    details = JSON.stringify(j?.error?.details ?? "") + String(j?.error?.status ?? "");
  } catch { /* no JSON body */ }
  const all = msg + " " + details;
  if (/API_KEY_INVALID|API key not valid|API_KEY_/i.test(all) || res.status === 401) {
    return new AiError(500, "no_key", "The Gemini key saved in the Edge Function secrets is wrong. " + msg);
  }
  if (res.status === 403) return new AiError(500, "no_key", "The Gemini key is not allowed to use this API. " + msg);
  if (res.status === 429) return new AiError(429, "rate_limited", msg || "Too many requests to Gemini.");
  if (res.status === 404) return new AiError(502, "no_model", "This Gemini model is not available: " + msg);
  if (res.status === 400 && /image|inline|mime/i.test(msg)) return new AiError(400, "image_rejected", msg);
  if (res.status === 400 && /token|too long|exceed|size/i.test(msg)) return new AiError(413, "prompt_too_large", msg);
  if (res.status === 400) return new AiError(400, "bad_request", msg);
  return new AiError(502, "ai_error", msg || `Gemini error ${res.status}`);
}

async function geminiModel(signal: AbortSignal): Promise<string> {
  if (GEMINI_MODEL) return GEMINI_MODEL;
  if (geminiModelCache) return geminiModelCache;
  const names: string[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url = `${GEMINI_BASE}/v1beta/models?pageSize=1000${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": GEMINI_API_KEY }, signal });
    if (!res.ok) throw await geminiError(res);
    const j = await res.json();
    for (const m of j?.models ?? []) {
      const methods: string[] = m?.supportedGenerationMethods ?? [];
      if (methods.includes("generateContent")) names.push(String(m.name ?? "").replace(/^models\//, ""));
    }
    pageToken = j?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  geminiModelCache = pickGeminiModel(names);
  if (!geminiModelCache) {
    throw new AiError(500, "no_model", "No Gemini text model is available for this key. Set GEMINI_MODEL in the Edge Function secrets.");
  }
  console.log("Gemini model picked:", geminiModelCache);
  return geminiModelCache;
}

const GEMINI_REFUSALS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

async function runGemini(job: Job, onText: (t: string) => void, signal: AbortSignal, meter: Meter, timeLeft: () => number): Promise<Stop> {
  // Court records quote FIRs, injuries and allegations; Google's default filters can block them.
  const safetySettings = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
    .map((category) => ({ category, threshold: "BLOCK_NONE" }));
  const body = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        ...job.images.map((im) => ({ inline_data: { mime_type: im.media_type, data: im.data } })),
        { text: job.prompt },
      ],
    }],
    // No maxOutputTokens: each model then allows its own full output length.
    generationConfig: job.mode === "json" ? { responseMimeType: "application/json" } : {},
    safetySettings,
  });

  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    const model = await geminiModel(signal);
    meter.model = model;
    res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body,
      signal,
    });
    if (res.ok) break;
    // The picked model was withdrawn: pick again once.
    if (res.status === 404 && !GEMINI_MODEL && attempt === 0) { geminiModelCache = ""; await res.body?.cancel(); continue; }
    // Busy / overloaded: try again a couple of times while there is time.
    const retryable = res.status === 429 || res.status === 500 || res.status === 503;
    if (retryable && attempt < 2 && timeLeft() > 30_000) { await res.body?.cancel(); await sleep(attempt === 0 ? 2000 : 6000, signal); continue; }
    throw await geminiError(res);
  }

  // Server-sent events: each `data:` line is one GenerateContentResponse chunk.
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = "", finish = "", blocked = false;
  // deno-lint-ignore no-explicit-any
  const handle = (chunk: Record<string, any>) => {
    if (chunk?.promptFeedback?.blockReason) blocked = true;
    const cand = chunk?.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) {
      if (typeof p?.text === "string" && !p.thought) onText(p.text);
    }
    if (cand?.finishReason) finish = String(cand.finishReason);
    const u = chunk?.usageMetadata;
    if (u) {
      meter.input = u.promptTokenCount ?? meter.input;
      meter.output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      meter.cache = u.cachedContentTokenCount ?? meter.cache;
    }
    if (chunk?.modelVersion) meter.model = String(chunk.modelVersion);
  };
  const handleEvent = (ev: string) => {
    for (const line of ev.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { handle(JSON.parse(line.slice(5))); } catch { /* ignore a malformed chunk */ }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) { handleEvent(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  handleEvent(buf);
  if (blocked || GEMINI_REFUSALS.has(finish)) return "refusal";
  if (finish === "MAX_TOKENS") return "max_tokens";
  if (!finish) return "incomplete";   // the stream ended without saying it was finished
  return "end";
}

/* ======================= Request handler ======================= */

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  // Time left before our own limit; at least 1 s so the timer always fires after the stream starts
  const timeLeft = () => Math.max(1000, TIME_LIMIT_MS - (Date.now() - startedAt));
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "bad_request", message: "POST only" });
  if (PROVIDER === "anthropic" && !ANTHROPIC_API_KEY) {
    return json(500, { code: "no_key", message: "No AI key is set. Add GEMINI_API_KEY (and AI_PROVIDER = gemini) or ANTHROPIC_API_KEY to the Edge Function secrets." });
  }
  if (PROVIDER === "gemini" && !GEMINI_API_KEY) {
    return json(500, { code: "no_key", message: "AI_PROVIDER is gemini, but GEMINI_API_KEY is not set in the Edge Function secrets." });
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
  const requested = Number(body.max_tokens);
  const job: Job = {
    mode,
    prompt,
    images,
    tier: body.tier === "default" ? "default" : "complex",
    maxTokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(1000, Number.isFinite(requested) && requested > 0 ? requested : mode === "json" ? 24_000 : 32_000)),
  };
  const wantStream = mode === "text" && body.stream !== false;

  // 3. One AbortController for: the user pressing Stop / closing the page, and our own time limit.
  const ac = new AbortController();
  let timedOut = false;
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });
  const guard = setTimeout(() => { timedOut = true; ac.abort(); }, timeLeft());

  const meter: Meter = { model: "", input: 0, output: 0, cache: 0 };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const logUsage = async () => {
    if (!meter.input && !meter.output) return;
    try {
      await admin.from("ai_usage").insert({
        team_id: teamId, user_id: user.id, model: meter.model, mode,
        input_tokens: meter.input, output_tokens: meter.output, cache_read_tokens: meter.cache,
      });
    } catch (e) {
      console.error("ai_usage insert failed", e);
    }
  };
  const run = (onText: (t: string) => void) =>
    PROVIDER === "gemini" ? runGemini(job, onText, ac.signal, meter, timeLeft) : runClaude(job, onText, ac.signal, meter);
  const REFUSED = { code: "refused", message: "The AI declined this request." };

  // 4a. One answer (JSON mode). A JSON answer is useless when cut short, so at the time limit
  //     it returns a clear error instead.
  if (!wantStream) {
    let text = "";
    try {
      const stop = await run((t) => { text += t; });
      await logUsage();
      if (stop === "refusal") return json(422, REFUSED);
      return json(200, { text, truncated: stop === "max_tokens" || stop === "incomplete", stop_reason: stop, model: meter.model });
    } catch (e) {
      await logUsage();
      if (timedOut) return json(504, { code: "time_limit", message: "This took longer than the server allows." });
      const m = mapError(e);
      return json(m.status, m.body);
    } finally {
      clearTimeout(guard);
    }
  }

  // 4b. Streamed draft: text deltas as SSE, a ping every 10 s while the AI is still thinking.
  //     At the time limit the text written so far is delivered with stop_reason "time_limit".
  const enc = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* client gone */ }
      };
      const ping = setInterval(() => send({ ping: true }), 10_000);
      try {
        const stop = await run((t) => send({ text: t }));
        await logUsage();
        if (stop === "refusal") send({ error: REFUSED });
        else send({ done: true, truncated: stop === "max_tokens" || stop === "incomplete", stop_reason: stop, model: meter.model });
      } catch (e) {
        await logUsage();
        if (timedOut) send({ done: true, truncated: true, stop_reason: "time_limit", model: meter.model });
        else send({ error: mapError(e).body });
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
