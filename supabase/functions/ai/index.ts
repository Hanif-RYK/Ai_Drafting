// AI Drafting — AI proxy (Supabase Edge Function, Deno)
//
// Every team brings its own AI key (Google Gemini or Anthropic Claude). The team admin enters it once in
// the app; this function checks it with the provider, encrypts it (AES-GCM, KEY_ENCRYPTION_SECRET) and
// stores it in the team_ai table, which browsers can neither read nor write. A drafting request is
// answered with the caller's own team's key; there is no shared key.
//
// Secrets (Supabase Dashboard → Edge Functions → Secrets):
//   KEY_ENCRYPTION_SECRET required: a long random text (at least 32 characters). Never change it later:
//                       the saved keys could no longer be read and every team admin would have to enter
//                       the key again.
//   GEMINI_MODEL        optional default Gemini model when a team did not choose one; if not set, the best
//                       Gemini Pro model available to the team's key is picked automatically
//   AI_MODEL_COMPLEX    optional default Claude model, default claude-opus-5-5
//   AI_MODEL_DEFAULT    optional Claude model for sorting samples, default = the team's / complex model
//   AI_EFFORT           optional, Claude only, default high: low | medium | high | xhigh | max
//   AI_TIME_LIMIT_SECONDS optional, default 140. Supabase stops a function after 150 s on the Free
//                       plan (400 s on paid plans). The function ends the answer itself a little
//                       before that, so the part already written reaches the app, which can then
//                       ask the AI to continue from there. On a paid plan set it to 390.
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are set by Supabase itself.
//
// Requests (POST, JSON, with the signed-in user's Supabase JWT):
//   { action: "setup_team", team_name, provider: "gemini" | "anthropic", key, model? }
//       a user who is not in a team yet: checks the key, creates the team (the user becomes its admin)
//       and stores the key → { ok, team_id, provider, model, last4 }
//   { action: "set_key", provider, key, model? }   team admin: checks and replaces the team's key
//   { action: "test_key" }                         team admin: checks the saved key → { ok, provider, model }
//   { mode: "text" | "json", prompt, images?: [{ media_type, data }], tier?: "complex" | "default",
//     effort?: "low" | "medium" | "high", stream?: boolean, max_tokens?: number }   a drafting request
//   `effort` says how much the model may think: low for a daily order, high for a judgment.
// Response to a drafting request:
//   mode "text" (stream)  → text/event-stream, lines `data: {"text": "..."}`, then `data: {"done": true, ...}`
//                           (stop_reason "time_limit" when the time limit ended it after some text)
//                           or `data: {"error": {"code", "message"}}` (code "no_answer" when the time
//                           limit came before the model wrote anything)
//   mode "json" / no stream → { text, truncated, stop_reason, model }; 504 { code: "time_limit" | "no_answer" }
//   errors → { code, message } with an HTTP error status
//
// Every request writes lines starting with "[ai <id>]" to the function's Logs (Supabase Dashboard →
// Edge Functions → ai → Logs): the model and thinking setting used, the AI provider's own error
// message, and a final "done" line with the seconds to the first chunk and the first text,
// finishReason, prompt / output / thinking tokens and how the request ended. Keys are never logged.

import Anthropic from "npm:@anthropic-ai/sdk@1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ENC_SECRET = Deno.env.get("KEY_ENCRYPTION_SECRET") ?? "";

const MODEL_COMPLEX = Deno.env.get("AI_MODEL_COMPLEX") || "claude-opus-5-5";
const MODEL_DEFAULT = Deno.env.get("AI_MODEL_DEFAULT") || "";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = typeof EFFORTS[number];
const EFFORT_COMPLEX: Effort = (EFFORTS as readonly string[]).includes(Deno.env.get("AI_EFFORT") ?? "") ? Deno.env.get("AI_EFFORT") as Effort : "high";

const GEMINI_BASE = (Deno.env.get("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_MODEL = (Deno.env.get("GEMINI_MODEL") ?? "").trim().replace(/^models\//, "");
const ANTHROPIC_BASE = Deno.env.get("ANTHROPIC_BASE_URL") || undefined;   // tests only

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
type TaskEffort = "low" | "medium" | "high";
type Job = {
  mode: "text" | "json"; prompt: string; images: { media_type: string; data: string }[];
  tier: "complex" | "default"; effort: TaskEffort; maxTokens: number;
};
/** What happened during one request; filled in as the answer arrives, written to the Logs at the end. */
type Meter = {
  model: string; input: number; output: number; cache: number; thoughts: number;
  finish: string; thinking: string; chars: number; firstChunkMs: number | null; firstTextMs: number | null;
};
type Log = (event: string, data: Record<string, unknown>) => void;
type Provider = "gemini" | "anthropic";
/** One team's AI: its provider, its own key (decrypted, kept only in memory) and the model it chose ("" = default). */
type TeamAi = { provider: Provider; key: string; model: string };

/** An error with the short code the app shows to the user. */
class AiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const secs = (ms: number | null) => (ms == null ? null : Math.round(ms / 100) / 10);

// Turns provider / runtime errors into the short codes the app shows to the user.
function mapError(e: unknown): { status: number; body: ErrBody } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof AiError) return { status: e.status, body: { code: e.code, message: e.message } };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { status: 500, body: { code: "no_key", message: "The team's Claude key is wrong or disabled. The team admin can change it in Settings → Team → AI key." } };
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

/* ======================= The teams' keys: encrypted at rest ======================= */

let aesKey: CryptoKey | null = null;
async function cryptoKey(): Promise<CryptoKey> {
  if (ENC_SECRET.length < 32) {
    throw new AiError(500, "server_setup", "KEY_ENCRYPTION_SECRET is missing or shorter than 32 characters in the Edge Function secrets.");
  }
  aesKey ??= await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ENC_SECRET)), "AES-GCM", false, ["encrypt", "decrypt"]);
  return aesKey;
}
const toB64 = (u: Uint8Array) => { let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** "v1:<iv>:<ciphertext>"; the team id is bound in, so a key copied to another team's row cannot be opened. */
export async function encryptKey(plain: string, teamId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(teamId) }, await cryptoKey(), new TextEncoder().encode(plain)));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}
export async function decryptKey(cipher: string, teamId: string): Promise<string> {
  const [v, iv, ct] = String(cipher).split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("unknown key format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: new TextEncoder().encode(teamId) }, await cryptoKey(), fromB64(ct));
  return new TextDecoder().decode(pt);
}

/* Checks a key with its provider without spending tokens (the model list) and returns the model to use.
   Exported for tests. */
const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{2,79}$/i;
export function keyLooksRight(provider: Provider, key: string): boolean {
  return provider === "gemini" ? /^[A-Za-z0-9_\-]{20,120}$/.test(key) : /^sk-ant-[A-Za-z0-9_\-]{20,200}$/.test(key);
}
async function checkKey(ai: TeamAi, signal: AbortSignal, log: Log): Promise<string> {
  if (!keyLooksRight(ai.provider, ai.key)) {
    throw new AiError(400, "bad_key", ai.provider === "gemini"
      ? "This does not look like a Gemini key (it usually starts with AIza). Copy the whole key from aistudio.google.com."
      : "This does not look like a Claude key (it starts with sk-ant-). Copy the whole key from console.anthropic.com.");
  }
  if (ai.model && !MODEL_RE.test(ai.model)) throw new AiError(400, "bad_request", "The model name is not valid.");
  if (ai.provider === "gemini") {
    const { name } = await geminiModel(ai, signal, log, true);
    return name;
  }
  const client = claudeClient(ai.key);
  const ids: string[] = [];
  try {
    for await (const m of client.models.list({ limit: 100 }, { signal })) { ids.push(m.id); if (ids.length >= 300) break; }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new AiError(400, "bad_key", "Anthropic did not accept this key. Check that it is copied completely and is active.");
    }
    throw e;
  }
  const model = ai.model || MODEL_COMPLEX;
  if (ids.length && !ids.includes(model)) throw new AiError(400, "no_model", `This key cannot use the model ${model}. Choose another model.`);
  return model;
}

/* ======================= Anthropic (Claude) ======================= */

const claudeClients = new Map<string, Anthropic>();
function claudeClient(key: string): Anthropic {
  let c = claudeClients.get(key);
  if (!c) { c = new Anthropic({ apiKey: key, maxRetries: 2, ...(ANTHROPIC_BASE ? { baseURL: ANTHROPIC_BASE } : {}) }); claudeClients.set(key, c); }
  return c;
}

async function runClaude(ai: TeamAi, job: Job, onText: (t: string) => void, signal: AbortSignal, meter: Meter, log: Log,
                         sinceStart: () => number): Promise<Stop> {
  const claude = claudeClient(ai.key);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...job.images.map((im) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: im.media_type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: im.data },
    })),
    { type: "text" as const, text: job.prompt },
  ];
  // Thinking is adaptive (always on for Opus 5.5); effort steers depth.
  // Server-side refusal fallback ("default") re-runs a declined request on another model.
  const effort = job.tier === "complex" ? EFFORT_COMPLEX : "medium";
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: job.tier === "complex" ? (ai.model || MODEL_COMPLEX) : (MODEL_DEFAULT || ai.model || MODEL_COMPLEX),
    max_tokens: job.maxTokens,
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  meter.model = params.model;
  meter.thinking = "adaptive, effort " + effort;
  log("request", { provider: "anthropic", model: params.model, mode: job.mode, effort, images: job.images.length, promptChars: job.prompt.length });
  const stream = claude.beta.messages.stream(params, { signal });
  for await (const event of stream) {
    if (meter.firstChunkMs == null) meter.firstChunkMs = sinceStart();
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
  meter.finish = String(final.stop_reason ?? "");
  return final.stop_reason === "refusal" ? "refusal" : final.stop_reason === "max_tokens" ? "max_tokens" : "end";
}

/* ======================= Google Gemini ======================= */

const geminiPicked = new Map<string, string>();   // team key -> model picked from its list
const geminiOutputLimit = new Map<string, number>();   // model name -> outputTokenLimit from Google

/** Picks the best text model from the key's model list: the newest Pro-class model (a stable one
 *  before a preview of the same version), else the newest Flash. If a picked preview is withdrawn
 *  later, the 404 makes the function pick again. Exported for tests. */
export function pickGeminiModel(names: string[]): string {
  const skip = /(tts|image|embed|live|audio|aqa|robotics|computer-use|nano|veo|imagen|learnlm|gemma|native|dialog|exp)/i;
  const usable = names.filter((n) => /^gemini-/i.test(n) && !skip.test(n));
  if (usable.includes("gemini-pro-latest")) return "gemini-pro-latest";
  const info = (n: string) => {
    const m = n.match(/^gemini-(\d+)(?:\.(\d+))?/i);
    const version = m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
    // Gemini 4 names have no "pro" / "flash": Carbon is the deeper thinker, Argon the lighter one.
    const tier = /-(pro|carbon)\b/i.test(n) ? 3 : /flash-lite/i.test(n) ? 1 : /-(flash|argon)\b/i.test(n) ? 2 : 0;
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

/* Thinking settings, from Google's Gemini documentation (google-gemini/cookbook, "Get started
   thinking", November 2026):
   - Gemini 3 and Gemini 4 models take generationConfig.thinkingConfig.thinkingLevel:
     "low", "medium" or "high" ("high" is the default on Gemini 3, "medium" on Gemini 4).
     Gemini 4 rejects thinkingBudget with a 400.
   - Gemini 2.5 models take thinkingBudget (tokens): about 1024 is "low", 4096–8192 "medium",
     -1 lets the model decide ("dynamic", like "high"). Pro models cannot turn thinking off.
   An unknown or alias name ("gemini-flash-latest") starts with thinkingLevel; if Google answers
   400 about thinking, the next setting in nextThinking() is tried. */
type Thinking = { thinkingLevel: TaskEffort } | { thinkingBudget: number } | null;
const THINKING_BUDGET: Record<TaskEffort, number> = { low: 1024, medium: 4096, high: -1 };
export function firstThinking(model: string, effort: TaskEffort): Thinking {
  if (/^gemini-(1|2)\./i.test(model)) return { thinkingBudget: THINKING_BUDGET[effort] };
  return { thinkingLevel: effort };
}
/** The setting to try after Google rejected `t` (400 about thinking); undefined = nothing left. */
export function nextThinking(t: Thinking, effort: TaskEffort): Thinking | undefined {
  if (t && "thinkingLevel" in t) return t.thinkingLevel === "medium" ? { thinkingLevel: "low" } : { thinkingBudget: THINKING_BUDGET[effort] };
  if (t && "thinkingBudget" in t) return null;   // no thinking setting at all: the model's default
  return undefined;
}

type GoogleError = { httpStatus: number; status: string; message: string; details: string; retrySec: number | null };

async function readGeminiError(res: Response): Promise<GoogleError> {
  const raw = await res.text().catch(() => "");
  let status = "", message = raw.slice(0, 500), details = "", retrySec: number | null = null;
  try {
    const j = JSON.parse(raw);
    status = String(j?.error?.status ?? "");
    message = String(j?.error?.message ?? message);
    const d = Array.isArray(j?.error?.details) ? j.error.details : [];
    details = JSON.stringify(d).slice(0, 1500);
    // RetryInfo: how long Google asks us to wait, e.g. "37s"
    const r = d.find((x: Record<string, unknown>) => String(x?.["@type"] ?? "").endsWith("RetryInfo"));
    if (r?.retryDelay) retrySec = parseFloat(String(r.retryDelay));
  } catch { /* not JSON */ }
  return { httpStatus: res.status, status, message, details, retrySec };
}

function geminiAiError(g: GoogleError): AiError {
  const all = g.message + " " + g.details + " " + g.status;
  if (/API_KEY_INVALID|API key not valid|API_KEY_/i.test(all) || g.httpStatus === 401) {
    return new AiError(500, "no_key", "The team's Gemini key is wrong. The team admin can change it in Settings → Team → AI key. " + g.message);
  }
  if (g.httpStatus === 403) return new AiError(500, "no_key", "The team's Gemini key is not allowed to use this API. " + g.message);
  if (g.httpStatus === 429) return new AiError(429, "rate_limited", g.message || "Too many requests to Gemini.");
  if (g.httpStatus === 404) return new AiError(502, "no_model", "This Gemini model is not available: " + g.message);
  if (g.httpStatus === 400 && /image|inline|mime/i.test(g.message)) return new AiError(400, "image_rejected", g.message);
  if (g.httpStatus === 400 && /token|too long|exceed|size/i.test(g.message)) return new AiError(413, "prompt_too_large", g.message);
  if (g.httpStatus === 400) return new AiError(400, "bad_request", g.message);
  return new AiError(502, "ai_error", g.message || `Gemini error ${g.httpStatus}`);
}

/** The model to use and its output limit: the team's choice, else GEMINI_MODEL, else one picked from the
 *  key's list. `check` (when a key is entered) always reads the list, which also proves the key works. */
async function geminiModel(ai: TeamAi, signal: AbortSignal, log: Log, check = false): Promise<{ name: string; outputLimit: number }> {
  const headers = { "x-goog-api-key": ai.key };
  const chosen = ai.model || GEMINI_MODEL;
  if (chosen && !check) {
    if (!geminiOutputLimit.has(chosen)) {
      // Only to learn the output limit; if this fails, the generate call reports the real error.
      const res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(chosen)}`, { headers, signal });
      if (res.ok) {
        const j = await res.json();
        geminiOutputLimit.set(chosen, Number(j?.outputTokenLimit) || 0);
      } else {
        const g = await readGeminiError(res);
        log("google_error", { during: "model info", model: chosen, httpStatus: g.httpStatus, status: g.status, message: g.message });
        geminiOutputLimit.set(chosen, 0);
      }
    }
    return { name: chosen, outputLimit: geminiOutputLimit.get(chosen) ?? 0 };
  }
  if (!geminiPicked.has(ai.key) || check) {
    const names: string[] = [];
    let pageToken = "";
    for (let page = 0; page < 5; page++) {
      const url = `${GEMINI_BASE}/v1beta/models?pageSize=1000${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
      const res = await fetch(url, { headers, signal });
      if (!res.ok) {
        const g = await readGeminiError(res);
        log("google_error", { during: "model list", httpStatus: g.httpStatus, status: g.status, message: g.message, details: g.details });
        if (check && (g.httpStatus === 400 || g.httpStatus === 401 || g.httpStatus === 403)) {
          throw new AiError(400, "bad_key", "Google did not accept this key. Check that it is copied completely and that it is active. " + g.message);
        }
        throw geminiAiError(g);
      }
      const j = await res.json();
      for (const m of j?.models ?? []) {
        const methods: string[] = m?.supportedGenerationMethods ?? [];
        if (!methods.includes("generateContent")) continue;
        const name = String(m.name ?? "").replace(/^models\//, "");
        names.push(name);
        geminiOutputLimit.set(name, Number(m?.outputTokenLimit) || 0);
      }
      pageToken = j?.nextPageToken ?? "";
      if (!pageToken) break;
    }
    if (check && chosen) {
      if (names.length && !names.includes(chosen)) throw new AiError(400, "no_model", `This key cannot use the model ${chosen}. Choose another model.`);
      return { name: chosen, outputLimit: geminiOutputLimit.get(chosen) ?? 0 };
    }
    const picked = pickGeminiModel(names);
    if (!picked) {
      throw new AiError(400, "no_model", "No Gemini text model is available for this key. Choose a model in Settings → Team → AI key.");
    }
    geminiPicked.set(ai.key, picked);
    log("model_picked", { model: picked, from: names.length + " models" });
  }
  const name = geminiPicked.get(ai.key)!;
  return { name, outputLimit: geminiOutputLimit.get(name) ?? 0 };
}

const GEMINI_REFUSALS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

async function runGemini(ai: TeamAi, job: Job, onText: (t: string) => void, signal: AbortSignal, meter: Meter, log: Log,
                         timeLeft: () => number, sinceStart: () => number): Promise<Stop> {
  // Court records quote FIRs, injuries and allegations; Google's default filters can block them.
  const safetySettings = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
    .map((category) => ({ category, threshold: "BLOCK_NONE" }));
  const parts = [
    ...job.images.map((im) => ({ inline_data: { mime_type: im.media_type, data: im.data } })),
    { text: job.prompt },
  ];
  const makeBody = (thinking: Thinking, outputLimit: number) => JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      // The output limit covers thinking + answer; use the model's full limit so thinking cannot use it all up.
      ...(outputLimit > 0 ? { maxOutputTokens: Math.min(outputLimit, 65536) } : {}),
      ...(job.mode === "json" ? { responseMimeType: "application/json" } : {}),
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
    safetySettings,
  });

  let thinking: Thinking | undefined;
  let repicked = false, busyRetries = 0, thinkingRetries = 0;
  let res: Response;
  for (;;) {
    const { name: model, outputLimit } = await geminiModel(ai, signal, log);
    meter.model = model;
    if (thinking === undefined) thinking = firstThinking(model, job.effort);
    meter.thinking = thinking ? JSON.stringify(thinking) : "model default";
    log("request", {
      provider: "gemini", model, mode: job.mode, effort: job.effort, thinking: meter.thinking,
      maxOutputTokens: outputLimit > 0 ? Math.min(outputLimit, 65536) : "model default",
      images: job.images.length, promptChars: job.prompt.length,
    });
    res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ai.key },
      body: makeBody(thinking, outputLimit),
      signal,
    });
    if (res.ok) break;
    const g = await readGeminiError(res);
    log("google_error", { during: "generate", model, httpStatus: g.httpStatus, status: g.status, message: g.message, retryAfterSec: g.retrySec, details: g.details });
    // The picked model was withdrawn: pick again once.
    if (g.httpStatus === 404 && !ai.model && !GEMINI_MODEL && !repicked) { repicked = true; geminiPicked.delete(ai.key); thinking = undefined; continue; }
    // This model does not accept that thinking setting: try the next one.
    if (g.httpStatus === 400 && /thinking/i.test(g.message) && thinkingRetries < 3) {
      const next = nextThinking(thinking, job.effort);
      if (next !== undefined) { thinkingRetries++; thinking = next; continue; }
    }
    // Busy / overloaded: try again a couple of times while there is time, unless Google asks for a long wait.
    const busy = g.httpStatus === 429 || g.httpStatus === 500 || g.httpStatus === 503;
    if (busy && busyRetries < 2 && timeLeft() > 30_000 && (g.retrySec == null || g.retrySec <= 10)) {
      busyRetries++;
      await sleep(g.retrySec != null ? g.retrySec * 1000 : busyRetries === 1 ? 2000 : 6000, signal);
      continue;
    }
    throw geminiAiError(g);
  }

  // Server-sent events: each `data:` line is one GenerateContentResponse chunk (a JSON object on one line).
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = "", blocked = "";
  // deno-lint-ignore no-explicit-any
  const handle = (chunk: Record<string, any>) => {
    if (chunk?.promptFeedback?.blockReason) blocked = String(chunk.promptFeedback.blockReason);
    const cand = chunk?.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) {
      if (typeof p?.text === "string" && !p.thought) onText(p.text);
    }
    if (cand?.finishReason) meter.finish = String(cand.finishReason);
    const u = chunk?.usageMetadata;
    if (u) {
      meter.input = u.promptTokenCount ?? meter.input;
      meter.thoughts = u.thoughtsTokenCount ?? meter.thoughts;
      meter.output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      meter.cache = u.cachedContentTokenCount ?? meter.cache;
    }
    if (chunk?.modelVersion) meter.model = String(chunk.modelVersion);
  };
  const handleLine = (line: string) => {
    line = line.trim();
    if (!line.startsWith("data:")) return;
    if (meter.firstChunkMs == null) meter.firstChunkMs = sinceStart();
    try { handle(JSON.parse(line.slice(5))); }
    catch { log("bad_chunk", { sample: line.slice(0, 200) }); }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) { handleLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  handleLine(buf);
  if (blocked) { meter.finish = "PROMPT_BLOCKED:" + blocked; return "refusal"; }
  if (GEMINI_REFUSALS.has(meter.finish)) return "refusal";
  if (meter.finish === "MAX_TOKENS") return "max_tokens";
  if (!meter.finish) return "incomplete";   // the stream ended without saying it was finished
  return "end";
}

/* ======================= Request handler ======================= */

/** The caller's team's AI settings with the key decrypted (in memory only). */
// deno-lint-ignore no-explicit-any
async function teamAi(admin: any, teamId: string): Promise<TeamAi> {
  const { data, error } = await admin.from("team_ai").select("provider, model, key_cipher").eq("team_id", teamId).maybeSingle();
  if (error) throw new AiError(500, "server", "The team's AI key could not be read: " + error.message);
  if (!data) throw new AiError(400, "no_key", "Your team has no AI key yet. The team admin can add it in Settings → Team → AI key.");
  let key: string;
  try { key = await decryptKey(String(data.key_cipher), teamId); }
  catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(500, "no_key", "The team's saved AI key could not be opened (was KEY_ENCRYPTION_SECRET changed?). The team admin must enter the key again in Settings → Team → AI key.");
  }
  return { provider: data.provider === "anthropic" ? "anthropic" : "gemini", key, model: String(data.model ?? "") };
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const sinceStart = () => Date.now() - startedAt;
  // Time left before our own limit; at least 1 s so the timer always fires after the stream starts
  const timeLeft = () => Math.max(1000, TIME_LIMIT_MS - sinceStart());
  const rid = crypto.randomUUID().slice(0, 8);
  const log: Log = (event, data) => console.log(`[ai ${rid}] ${event} ${JSON.stringify(data)}`);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "bad_request", message: "POST only" });
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
  const { data: profile } = await userClient.from("profiles").select("team_id, role").eq("id", user.id).maybeSingle();
  let teamId: string | null = profile?.team_id ?? null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { code: "bad_request", message: "Invalid JSON body." }); }

  // 2. Team set-up and key changes: the key is checked with its provider, then stored encrypted.
  const action = String(body.action ?? "");
  if (action) {
    const setupAc = new AbortController();
    const setupGuard = setTimeout(() => setupAc.abort(), 40_000);
    req.signal.addEventListener("abort", () => setupAc.abort(), { once: true });
    try {
      const store = async (tid: string, ai: TeamAi) => {
        const { error } = await admin.from("team_ai").upsert({
          team_id: tid, provider: ai.provider, model: ai.model, key_cipher: await encryptKey(ai.key, tid),
          key_last4: ai.key.slice(-4), updated_by: user.id, updated_at: new Date().toISOString(),
        }, { onConflict: "team_id" });
        if (error) throw new AiError(500, "server", "The key could not be saved: " + error.message);
      };
      const given = (): TeamAi => {
        const provider = body.provider === "anthropic" ? "anthropic" : body.provider === "gemini" ? "gemini" : null;
        if (!provider) throw new AiError(400, "bad_request", "Choose Gemini or Claude.");
        return { provider, key: String(body.key ?? "").trim(), model: String(body.model ?? "").trim() };
      };
      if (action === "setup_team") {
        if (teamId) throw new AiError(400, "bad_request", "You are already in a team.");
        const name = String(body.team_name ?? "").trim();
        if (name.length < 2 || name.length > 80) throw new AiError(400, "bad_request", "Write the court (team) name, 2 to 80 letters.");
        const ai = given();
        await cryptoKey();   // the secret must be set before anything is created
        const model = await checkKey(ai, setupAc.signal, log);
        const { data: tid, error } = await userClient.rpc("create_team", { p_name: name });
        if (error || !tid) throw new AiError(400, "bad_request", error?.message || "The team could not be created.");
        teamId = String(tid);
        await store(teamId, ai);
        log("team_created", { team: teamId, provider: ai.provider, model });
        return json(200, { ok: true, team_id: teamId, provider: ai.provider, model, last4: ai.key.slice(-4) });
      }
      if (!teamId) throw new AiError(403, "not_granted", "You are not in a team yet.");
      if (profile?.role !== "admin") throw new AiError(403, "not_granted", "Only the team admin can change the AI key.");
      if (action === "set_key") {
        const ai = given();
        await cryptoKey();
        const model = await checkKey(ai, setupAc.signal, log);
        await store(teamId, ai);
        log("key_changed", { team: teamId, provider: ai.provider, model });
        return json(200, { ok: true, provider: ai.provider, model, last4: ai.key.slice(-4) });
      }
      if (action === "test_key") {
        const ai = await teamAi(admin, teamId);
        const model = await checkKey(ai, setupAc.signal, log);
        return json(200, { ok: true, provider: ai.provider, model });
      }
      throw new AiError(400, "bad_request", "Unknown action.");
    } catch (e) {
      const m = mapError(e);
      log("setup_error", { action, code: m.body.code, error: m.body.message });
      return json(m.status, m.body);
    } finally {
      clearTimeout(setupGuard);
    }
  }

  // 3. A drafting request: the caller's team and its key
  if (!teamId) return json(403, { code: "not_granted", message: "You are not in a team yet." });
  let ai: TeamAi;
  try { ai = await teamAi(admin, teamId); } catch (e) { const m = mapError(e); log("key_error", { code: m.body.code, error: m.body.message }); return json(m.status, m.body); }
  // 4. Validate the request
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
    effort: (["low", "medium", "high"] as const).find((e) => e === body.effort) ?? "medium",
    maxTokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(1000, Number.isFinite(requested) && requested > 0 ? requested : mode === "json" ? 24_000 : 32_000)),
  };
  const wantStream = mode === "text" && body.stream !== false;

  // 5. One AbortController for: the user pressing Stop / closing the page, and our own time limit.
  const ac = new AbortController();
  let timedOut = false;
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });
  const guard = setTimeout(() => { timedOut = true; ac.abort(); }, timeLeft());

  const meter: Meter = { model: "", input: 0, output: 0, cache: 0, thoughts: 0, finish: "", thinking: "", chars: 0, firstChunkMs: null, firstTextMs: null };
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
  // One line in the Logs per request, whatever the outcome
  const done = (outcome: string, extra: Record<string, unknown> = {}) => log("done", {
    outcome, provider: ai.provider, model: meter.model, mode, effort: job.effort, thinking: meter.thinking,
    seconds: secs(sinceStart()), firstChunkSec: secs(meter.firstChunkMs), firstTextSec: secs(meter.firstTextMs),
    finishReason: meter.finish || null, promptTokens: meter.input, outputTokens: meter.output,
    thoughtsTokens: meter.thoughts, textChars: meter.chars, ...extra,
  });
  const run = (sink: (t: string) => void) => {
    const onText = (t: string) => {
      if (!t) return;
      if (meter.firstTextMs == null) meter.firstTextMs = sinceStart();
      meter.chars += t.length;
      sink(t);
    };
    return ai.provider === "gemini"
      ? runGemini(ai, job, onText, ac.signal, meter, log, timeLeft, sinceStart)
      : runClaude(ai, job, onText, ac.signal, meter, log, sinceStart);
  };
  const REFUSED = { code: "refused", message: "The AI declined this request." };
  const EMPTY = () => ({ code: "empty_answer", message: `The AI finished without writing anything (finishReason ${meter.finish || "none"}).` });
  // The time limit came before the model wrote a single word (it was still thinking)
  const NO_ANSWER = () => ({
    code: "no_answer",
    message: `Model ${meter.model || "?"} was still thinking after ${Math.round(sinceStart() / 1000)} seconds.`,
  });

  // 6a. One answer (JSON mode). A JSON answer is useless when cut short, so at the time limit
  //     it returns a clear error instead.
  if (!wantStream) {
    let text = "";
    try {
      const stop = await run((t) => { text += t; });
      await logUsage();
      done(stop);
      if (stop === "refusal") return json(422, REFUSED);
      if (stop === "end" && !text.trim()) return json(502, EMPTY());
      return json(200, { text, truncated: stop === "max_tokens" || stop === "incomplete", stop_reason: stop, model: meter.model });
    } catch (e) {
      await logUsage();
      if (timedOut) {
        done(meter.chars ? "time_limit" : "no_answer");
        return json(504, meter.chars ? { code: "time_limit", message: "This took longer than the server allows." } : NO_ANSWER());
      }
      const m = mapError(e);
      done("error", { code: m.body.code, error: m.body.message });
      return json(m.status, m.body);
    } finally {
      clearTimeout(guard);
    }
  }

  // 6b. Streamed draft: text deltas as SSE, a ping every 10 s while the AI is still thinking.
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
        done(stop);
        if (stop === "refusal") send({ error: REFUSED });
        else if (stop === "end" && !meter.chars) send({ error: EMPTY() });
        else send({ done: true, truncated: stop === "max_tokens" || stop === "incomplete", stop_reason: stop, model: meter.model });
      } catch (e) {
        await logUsage();
        if (timedOut && meter.chars) { done("time_limit"); send({ done: true, truncated: true, stop_reason: "time_limit", model: meter.model }); }
        else if (timedOut) { done("no_answer"); send({ error: NO_ANSWER() }); }
        else { const m = mapError(e); done("error", { code: m.body.code, error: m.body.message }); send({ error: m.body }); }
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
