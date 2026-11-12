# Faisla Desk

Court drafting desk: daily order sheet, framing of issues, orders on applications,
judgments (civil, family, rent, guardian, succession) aur Magistrate Section-30 ka
criminal kaam. Record ki tasveerein upload karein, app AI (Google Gemini ya Anthropic
Claude) se record parhwati hai aur Judge ke apne style mein draft likhti hai.

Ek team (court) ke sab log ek hi data share karte hain: History (saved cases),
Samples, Rules aur Settings.

---

## Setup (ek dafa)

### 1. Database: `supabase/schema.sql`

Supabase Dashboard → **SQL Editor** → New query → `supabase/schema.sql` ki poori
file paste karein → **Run**.

- Dobara chalana safe hai.
- Purane AI Drafting ke tables (profiles, cases, glossary_rules, ai_logs,
  live_notes, live_sessions) delete nahi hote: woh `old_ai_drafting` schema mein
  move ho jate hain. Jab yaqeen ho jaye ke purane data ki zaroorat nahi, ye ek line
  chalayein: `drop schema old_ai_drafting cascade;`
- Pehle se registered accounts ki nayi profile khud ban jati hai. Unhein sirf
  dobara team banani / invite accept karna hoga.

### 2. AI function: `supabase/functions/ai/index.ts`

AI ki key (Gemini ya Claude) sirf server par rehti hai; browser ko kabhi nahi milti.

**Dashboard se (aasan):**
1. Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Function ka naam bilkul `ai` rakhein.
3. `supabase/functions/ai/index.ts` ki poori file paste karein → **Deploy**.

**Ya CLI se:**
```bash
npx supabase login
npx supabase functions deploy ai --project-ref atnjolykwqgzouqvorfe
```

### 3. AI key (secret): Gemini ya Claude

Supabase Dashboard → **Edge Functions** → **Secrets** → Add. Do mein se ek option chunein.

**Option A: Google Gemini**

| Name | Value |
|---|---|
| `AI_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | aistudio.google.com → **Get API key** se li hui key (`AIza...`) |
| `GEMINI_MODEL` (optional) | Khali chhor dein: function aap ki key ke liye dastiyab sab se naya **Pro** model khud chunta hai (Google model ke naam aksar badalta hai). Koi khaas model chahiye to us ka naam likhein, masalan `gemini-2.5-pro` |

> **Zaroori (court records):** Google ki terms ke mutabiq free tier (billing ke
> baghair) par bheja gaya data Google apni services behtar banane ke liye istemal
> kar sakta hai aur log usay parh bhi sakte hain. Court ke records ke liye Google
> AI Studio / Cloud mein **billing on** karein (paid tier par ye data is tarah
> istemal nahi hota). Lagu hone se pehle Google ki maujooda terms ek dafa dekh lein.

**Option B: Anthropic Claude**

| Name | Value |
|---|---|
| `AI_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | console.anthropic.com se li hui key (`sk-ant-...`) |
| `AI_EFFORT` (optional) | `high` (default). Har judgment par "Continue" dabana pare to `medium` |
| `AI_MODEL_COMPLEX` (optional) | default `claude-opus-5-5` |

`AI_PROVIDER` na likhein to jis ki key maujood ho woh istemal hota hai (dono hon to
Claude). Baad mein provider badalna ho to `AI_PROVIDER` ki value badal dein (aur
zaroori key add karein); naya setting foran na lage to function ko ek dafa dobara
**Deploy** kar dein.

**Dono ke liye (optional):**

| Name | Value |
|---|---|
| `AI_TIME_LIMIT_SECONDS` | `140` (default, Free plan). Paid plan par `390` |

Kaun sa model istemal ho raha hai, ye **Team** page par "AI usage this month" mein
dikhta hai.

### Time limit (150 second)

Supabase Free plan par ek function zyada se zyada 150 second chal sakta hai
(paid plan par 400 second). Is se kaam zaye nahi hota:

- **Draft / judgment:** function 140 second par khud ruk jata hai aur jitna likha
  ja chuka hai woh page par reh jata hai. Message aata hai aur **Continue** button
  dikhta hai; dabane par AI wahin se aage likhta hai (aakhri adhoori line dobara
  likhi jati hai taake koi lafz na toote). Internet toot jaye ya **Stop** dabayein,
  tab bhi Continue milta hai.
- **Read record:** agar bohat si tasveerein ek dafa mein na parhi ja sakein, jo
  parhi ja chuki hain woh mehfooz rehti hain; dobara **Read record** dabane par
  baqi tasveerein chhote groups mein parhi jati hain.
- Draft khud save nahi hota: kaam mukammal ho jaye to **Save** dabayein. Continue
  sirf usi waqt tak kaam karta hai jab tak page band ya refresh na ho.

### 4. Login settings

Supabase Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: jahan app chalti hai (masalan `https://<username>.github.io/Ai_Drafting/`)
- **Redirect URLs**: wahi URL add karein (password reset aur email confirmation ke links ke liye)

Email confirmation (Authentication → Sign In / Providers → Email → "Confirm email")
on ho to naya user pehle email ka link kholta hai, phir login karta hai.

### 5. App chalayein

Ye ek static website hai (koi build step nahi). GitHub Pages, Netlify ya kisi bhi
static hosting par repo ki files upload karein. `index.html` kholein.

---

## Team kaise banti hai

1. **Pehla user** (masalan Judge ya steno): Create an account → login → **Create team**.
   Ye user team ka **admin** hai.
2. Admin: side panel → **Team** → **Invite a member** → doosre user ki email likhein.
3. **Doosra user**: usi email se Create an account / login → pehli screen par
   invitation dikhegi → **Accept**. Ab woh team ka hissa hai aur team ka saara data dekhta hai.
4. Admin kisi ko **Make admin** / **Remove** kar sakta hai. Aakhri admin team nahi
   chhor sakta jab tak koi aur admin na ho.

Case ya sample **delete** sirf woh kar sakta hai jis ne save kiya, ya admin.

---

## Files

| File | Kaam |
|---|---|
| `index.html` | Login / team screens aur app ka markup |
| `styles.css` | Saara design (light / dark) |
| `js/main.js` | Shuruaat: login ke baad app chalata hai |
| `js/auth.js` | Login, register, password reset, team banana, invite accept |
| `js/app.js` | Faisla Desk: sections, record parhna, drafts, History, Samples, Settings, Team |
| `js/ai.js` | AI function ko request (tasveerein chhoti karke, streaming) |
| `js/db.js` | Team ka data (`docs` table) + realtime updates |
| `js/config.js` | Supabase URL aur public anon key |
| `supabase/schema.sql` | Tables, RLS policies, team functions |
| `supabase/functions/ai/index.ts` | Gemini ya Claude se baat karne wala server function |
| `sw.js`, `manifest.json`, `icon.svg` | Phone par app ki tarah install (PWA) |

## Data

- `teams`, `profiles` (har user ki team aur role: admin / member), `team_invites`
- `docs`: har saved cheez ek row: `kind` = case / sample / lesson (rule) / digest / settings
- `ai_usage`: har AI request ke tokens (Team page par is mahine ka total)

Row Level Security har query par check karti hai ke user sirf apni team ka data
dekh / badal sake.
