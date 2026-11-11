// AI adapter: the same `sample` interface the Faisla Desk artifact used inside
// claude.ai, now served by the Supabase Edge Function (supabase/functions/ai).
//
//   sample(prompt, { images, signal, onText, modelTier })  -> { text, truncated }
//   sample.json(prompt, { images, modelTier })              -> parsed object
//   sample.limits()                                          -> { images: { maxCount } }
//
// Errors carry a short `code` (rate_limited, refused, image_rejected, prompt_too_large, time_limit,
// invalid_json, session_expired, not_granted, cancelled, network, no_key, server ...);
// a cancelled or broken stream also carries the partial `text`.
import { SUPABASE_ANON_KEY, AI_FUNCTION_URL } from "./config.js";

export const IMG_MAX = 10;          // pictures per request (matches the Edge Function)
const IMG_MAX_SIDE = 1600;          // pictures are downscaled to this before upload
const IMG_QUALITY = 0.85;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/* Phone photos are 3-6 MB each; Claude reads documents just as well at ~1600 px,
   so pictures are downscaled and re-encoded as JPEG before upload. */
async function toImagePayload(file) {
  const blob = await downscale(file);
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(err("image_rejected", "The picture could not be read."));
    r.readAsDataURL(blob);
  });
  const i = dataUrl.indexOf(",");
  return { media_type: blob.type || "image/jpeg", data: dataUrl.slice(i + 1) };
}

async function downscale(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC and other formats the browser cannot decode (Claude cannot read them either)
    throw err("image_rejected", `"${file.name}" is not a picture format this app can read. Use JPEG or PNG.`);
  }
  const scale = Math.min(1, IMG_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const small = file.size < 900_000 && (file.type === "image/jpeg" || file.type === "image/png");
  if (scale === 1 && small) { bitmap.close?.(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", IMG_QUALITY));
  if (!out) throw err("image_rejected", "The picture could not be converted.");
  return out;
}

/* Claude is asked for "only one JSON object"; this tolerates code fences and stray text around it. */
export function parseJson(raw) {
  const text = String(raw || "").replace(/```[a-z]*\n?|```/gi, "").trim();
  const candidates = [text];
  const o1 = text.indexOf("{"), o2 = text.lastIndexOf("}");
  if (o1 >= 0 && o2 > o1) candidates.push(text.slice(o1, o2 + 1));
  const a1 = text.indexOf("["), a2 = text.lastIndexOf("]");
  if (a1 >= 0 && a2 > a1) candidates.push(text.slice(a1, a2 + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try the next shape */ }
  }
  throw err("invalid_json", "Claude's reply could not be read.");
}

export function createSample(sb) {
  async function accessToken() {
    const { data, error } = await sb.auth.getSession();
    if (error || !data?.session) throw err("session_expired", "Please sign in again.");
    return data.session.access_token;
  }

  async function request(mode, prompt, opts = {}) {
    const files = (opts.images || []).slice(0, IMG_MAX);
    const images = await Promise.all(files.map(toImagePayload));
    const body = {
      mode,
      prompt: String(prompt),
      images,
      tier: opts.modelTier === "default" ? "default" : "complex",
      stream: mode === "text",
      max_tokens: opts.maxTokens,
    };
    let res;
    try {
      res = await fetch(AI_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + await accessToken(), apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") throw err("cancelled", "Stopped.");
      if (e?.code) throw e;
      throw err("network", "Could not reach the AI service. Check your internet connection.");
    }
    if (!res.ok) {
      let j = {};
      try { j = await res.json(); } catch { /* no body */ }
      const code = j.code || (res.status === 401 ? "session_expired" : res.status === 403 ? "not_granted" : res.status === 429 ? "rate_limited" : "server");
      throw err(code, j.message || `AI service error ${res.status}`);
    }
    if (mode !== "text") return res.json();

    // Server-sent events: {text} deltas, {ping}, then {done} or {error}
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", result = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (typeof ev.text === "string") { text += ev.text; opts.onText?.({ text }); }
            else if (ev.error) {
              const e = err(ev.error.code || "server", ev.error.message);
              if (e.code !== "refused") e.text = text;   // a refused draft must not be shown
              throw e;
            } else if (ev.done) result = ev;
          }
        }
      }
    } catch (e) {
      if (e?.name === "AbortError") { const c = err("cancelled", "Stopped."); c.text = text; throw c; }
      if (!e?.code) { const n = err("network", "The connection dropped before the draft was finished."); n.text = text; throw n; }
      throw e;
    }
    if (!result) { const n = err("network", "The connection closed before the draft was finished."); n.text = text; throw n; }
    // stopReason "time_limit": the server ended the answer early; the app can ask Claude to continue it
    return { text, truncated: !!result.truncated, stopReason: result.stop_reason || "" };
  }

  const sample = (prompt, opts) => request("text", prompt, opts);
  sample.json = async (prompt, opts) => parseJson((await request("json", prompt, opts)).text);
  sample.limits = async () => ({ images: { maxCount: IMG_MAX } });
  return sample;
}

/* Word files are plain downloads (the artifact used a claude.ai download capability). */
export const downloads = {
  async save({ filename, data }) {
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  },
};
