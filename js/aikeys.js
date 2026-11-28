// The team's own AI key: the choices shown when a court is created (team screen) and in
// Settings → Team → AI key, and the calls that send a key to the AI function once. The function
// checks the key with Google / Anthropic, encrypts it and stores it; the browser never keeps it.
import { SUPABASE_ANON_KEY, AI_FUNCTION_URL } from "./config.js";

export const MODELS = {
  gemini: [
    ["gemini-flash-latest", "Gemini Flash (fast, works with a free key)"],
    ["gemini-pro-latest", "Gemini Pro (best, needs billing)"],
    ["", "Automatic (best for this key)"],
  ],
  anthropic: [
    ["claude-opus-5-5", "Claude Opus 5.5 (best)"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5 (faster, cheaper)"],
  ],
};
export const PROVIDER_LABEL = { gemini: "Google Gemini", anthropic: "Anthropic Claude" };

// Where to get a key, in Urdu (shown under the key box)
export const KEY_HELP = {
  gemini: "Gemini کی key: aistudio.google.com کھولیں → Get API key → Create API key → key کاپی کر کے یہاں لگائیں (عموماً AIza سے شروع ہوتی ہے)۔ مفت key پر Google عدالت کا ڈیٹا اپنی سروس بہتر کرنے کے لیے استعمال کر سکتا ہے اور Pro ماڈل اکثر نہیں چلتا؛ عدالتی ریکارڈ کے لیے Google میں billing آن کریں۔",
  anthropic: "Claude کی key: console.anthropic.com کھولیں → Billing میں رقم ڈالیں → Settings → API keys → Create key → key کاپی کر کے یہاں لگائیں (sk-ant- سے شروع ہوتی ہے)۔",
};

export function fillModels(select, provider, current) {
  const list = MODELS[provider] || [];
  const pick = list.some(([v]) => v === current) ? current : list[0][0];
  select.innerHTML = list.map(([v, l]) => `<option value="${v}"${v === pick ? " selected" : ""}>${l}</option>`).join("");
}
export function modelLabel(provider, model) {
  const m = (MODELS[provider] || []).find(([v]) => v === (model || ""));
  return m ? m[1].split(" (")[0] : (model || "automatic");
}

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

/** Sends one key action to the AI function: setup_team, set_key or test_key. */
export async function keyRequest(sb, body) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw err("session_expired", "Please sign in again.");
  let res;
  try {
    res = await fetch(AI_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
  } catch (e) { throw err("network", "Could not reach the server. Check your internet connection."); }
  let j = {};
  try { j = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw err(j.code || "server", j.message || `Server error ${res.status}`);
  return j;
}

/** The message to show for a failed key action. */
export function keyErrText(e) {
  if (e?.code === "server_setup") return "The app's server is not fully set up yet: KEY_ENCRYPTION_SECRET is missing in the Supabase Edge Function secrets. Ask the person who set up Supabase.";
  if (e?.code === "rate_limited") return "The AI service is busy or this key's free limit is used up. Try again later. (" + String(e.message || "").slice(0, 200) + ")";
  if (e?.code === "not_found" || /Failed to send|404/i.test(String(e?.message))) return "The AI function is not deployed yet in Supabase.";
  return String(e?.message || "Something went wrong. Please try again.");
}
