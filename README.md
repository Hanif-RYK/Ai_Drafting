# Faisla Desk

Court drafting desk: daily order sheet, framing of issues, orders on applications,
judgments (civil, family, rent, guardian, succession) aur Magistrate Section-30 ka
criminal kaam. Record ki tasveerein upload karein, app AI (Google Gemini ya Anthropic
Claude) se record parhwati hai aur Judge ke apne style mein draft likhti hai.

Ek team (court) ke sab log ek hi History (saved cases) dekhte hain. Settings, Samples aur
Rules admin banata hai aur sab ke drafts unhi ke mutabiq bante hain. Har user ka apna
**Inbox** aur apne **quick words** hain.

**Menu:** side panel (phone par upar wali patti) mein sirf roz ke kaam hain: Order, Issues,
Misc, Judgment, Criminal, History aur Inbox. Ek dafa set hone wali cheezein **⚙ Settings**
mein hain (computer par side panel ke neeche, phone par patti ke aakhir mein gear ka nishan,
jo scroll nahi hota). Settings ke tab:

| Tab | Kis ko dikhta hai | Kya hai |
|---|---|---|
| Court | Sirf admin | Judge ka naam, district, court designations, ADA / ADPP, A.S. Jail ke naam |
| Drafting | Sirf admin | Standing instructions, Rules, apna case law, prompt layers (debug) |
| Samples | Sirf admin | Judge ke samples |
| Team | Sirf admin | Members, invite, team ka naam, AI usage |
| Quick words | Sab | Built-in quick words (sirf app update se badalte hain) + apne quick words |
| Account | Sab | Apna naam, Leave team, Sign out |

Har setting ke saath Urdu mein likha hai ke woh kis liye hai. Settings sirf screen par
chhupi nahi: database (RLS) bhi member ko settings, samples aur rules badalne nahi deta.

**Send / Inbox:** draft ke neeche **Send** dabayein → team ke logon ke naam aate hain
(note likhna optional) → naam dabayein. Draft pehle History mein save hota hai, phir us
shakhs ke **Inbox** mein aa jata hai (menu mein laal ginti, aur browser tab ke title mein
bhi). Woh **Open** dabaye to case apne section mein khulta hai; badal kar Save kare to wahi
case History mein update hota hai, aur Send se wapas bhej sakta hai. Har user ka Inbox sirf
usi ko dikhta hai (database bhi yahi rokta hai). History poori team ki saanjhi hai, is liye
bheja hua case History mein sab ko nazar aata hai.

**Quick words:** order box ke neeche ke chhote buttons. Built-in (CPA, CPB, PA, PB, EV, AR,
SEEK, PRES, ABS, PW, WS) sab ke liye ek jaise hain aur sirf app update (code mein
`PARTY_CHIPS` / `DEFAULT_CHIPS`) se badalte hain. Har user Settings → Quick words mein apne
words banata hai; woh sirf usi ko dikhte hain.

**Rules** kisi sample par nahi, naye drafts par lagte hain: "Applies to" mein All sections ho
to har draft par, warna sirf chune gaye section ke drafts par.

"← Back to work" (ya menu ka koi section) wapas usi kaam par le jata hai. Kuch likh kar Save
na kiya ho to Settings chhorte waqt yaad dilaya jata hai. App hamesha kaam wale section par
khulti hai, Settings par nahi.

---

## Setup (ek dafa)

### 1. Database: `supabase/schema.sql`

> **Pehle se chalti app (Inbox / quick words update):** agar `schema.sql` pehle chala
> chuke hain to sirf `supabase/update_inbox_quickwords.sql` ek dafa SQL Editor mein Run
> karein. Is ke baghair Send / Inbox aur apne quick words save nahi honge (app saaf batati
> hai), baqi sab chalta rehta hai.

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
| `GEMINI_MODEL` (optional) | Khali chhor dein to function aap ki key ke liye dastiyab sab se naya Pro-darje ka model khud chunta hai (Google model ke naam aksar badalta hai). Free tier par Pro models aksar 429 (quota) dete hain; tab Flash model ka naam likhein, masalan `gemini-flash-latest` |

**Gemini kitna soche (thinking):** har kaam ke saath app batati hai ke model kitna
soche, aur function Google ki documentation ke mutabiq setting bhejta hai:

| Kaam | Effort | Gemini 3 / 4 (`thinkingLevel`) | Gemini 2.5 (`thinkingBudget`) |
|---|---|---|---|
| Daily order, sawal check karna, samples ki tarteeb, tasveer se sample | low | `low` | 1024 |
| Issues, Misc application, Criminal, Read record, samples ka mutala | medium | `medium` (jo model na le us par `low`) | 4096 |
| Judgment | high | `high` | -1 (model khud tay kare) |

Model ka naam `gemini-2.` se shuru ho to `thinkingBudget`, warna `thinkingLevel`
bheja jata hai. Agar Google 400 de ke ye setting is model ke liye nahi, to function
khud agli setting aazmata hai (Logs mein `google_error` aur naya `request` nazar aata hai).

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

Kaun sa model istemal ho raha hai, ye **Settings → Team** par "AI usage this month" mein
dikhta hai.

### Logs (masla dhoondne ke liye)

Supabase Dashboard → **Edge Functions** → `ai` → **Logs**. Har request ki lines
`[ai <id>]` se shuru hoti hain:

- `request`: kaun sa model, thinking ki setting, tasveerein, prompt ki lambai
- `google_error`: Google ka asal error paigham (429 quota samet) aur kitna rukne ko kaha
- `done`: nateeja (`end`, `time_limit`, `no_answer`, `error`), `firstChunkSec` (Google
  se pehla jawab kitne second mein aaya), `firstTextSec` (pehla lafz kitne second mein),
  `finishReason`, `promptTokens`, `outputTokens`, `thoughtsTokens`

Agar model 140 second mein ek lafz bhi na likhe (`no_answer`) to app saaf batati hai
ke jawab shuru hi nahi hua; us surat mein Continue nahi aata kyunke likha hua kuch nahi.

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
2. Admin: **⚙ Settings** → **Team** → **Invite a member** → doosre user ki email likhein.
3. **Doosra user**: usi email se Create an account / login → pehli screen par
   invitation dikhegi → **Accept**. Ab woh team ka hissa hai aur team ka saara data dekhta hai.
4. Admin kisi ko **Make admin** / **Remove** kar sakta hai. Aakhri admin team nahi
   chhor sakta jab tak koi aur admin na ho.

Case **delete** sirf woh kar sakta hai jis ne save kiya, ya admin. Settings, samples,
rules aur "seekhe hue notes" sirf admin likh / badal / hata sakta hai.

---

## Drafting kaise hoti hai (prompt ke 4 layers)

AI ki saari hidayat `js/app.js` mein hain (Edge Function sirf AI tak pahunchata hai, us
mein koi drafting hidayat nahi). Har draft ka prompt in 4 layers se banta hai:

| Layer | Kya hai | Kahan se aata hai |
|---|---|---|
| 1. Base | Pakistani court practice aur default style (Mian Ijaz Ahmad ka style), global rules, case-law list, har type ka template | `GLOBAL RULES` (`globalRules`), `STYLE`, `SECTIONS`, `TYPE_INFO`, `CASE_LAW` |
| 2. Judge style | Judge ke apne Samples (sab se qareeb samples hoo-ba-hoo) aur un se seekhe notes | Settings → Samples (`docs`: sample / digest) |
| 3. Rules | Settings → Drafting ki "Standing instructions" aur "Rules" | `docs`: settings / lesson |
| 4. Case data | Is case ki details, faisla, conditional decree, parade details, record notes | Work page |

Jahan farq ho: Rules > Judge style > Base. Samples na hon to Base ka style chalta hai.
Settings → Drafting mein **"Show the prompt layers"** tick karein to har draft ke neeche dikhta hai
ke kaun si hidayat kis layer se aayi.

**Global rules (har draft):** English court language, Urdu bayanat / huliya / objections
Urdu mein; faisla diya ho to foran draft (sawal ke liye nahi rukta); tareekh na ho to aaj
ki; na parha jane wala lafz `____` aur Notes mein; har draft ke baad **Roman Urdu Notes**
(blanks, shak wali reading, plaint vs jamabandi / FRC ke farq, minors, assumptions);
**Corrections** box: AI usi draft ko badalta hai, naya nahi likhta (Undo bhi hai); Judge ka naam
"Ahmad" (kabhi "Ahmed" nahi, app khud bhi theek kar deti hai); `[Signature]`, `Sd/-`,
seal ki koi line nahi; daily order mein "ORDER" heading aur paragraph numbers nahi.

**Case law:** sirf app ki list (`CASE_LAW`) aur Settings → Drafting → "Your case law" mein likhe
cases cite hote hain. Draft mein koi bhi citation ho to upar **"Verify citation from
official report"** dikhta hai, aur jo citation list mein nahi woh laal likha aata hai.

**Naye types:** Judgment → Civil Judgment: permanent injunction (owner in possession),
heirship (vehicle), heirship (housing scheme plot / shop), seller's suit (cancellation +
possession, conditional decree); Rent: ejectment PRPA 2009 ex-parte order. Misc → withdrawal
of sale proceeds (partition after auction), amendment to add partition (O.VI R.17).
Criminal → identification parade card (rows, har witness ka nateeja, dummy No., A.S. Jail
ke naam Settings → Court se, 18 saal ya kam umar ka flag).

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
| `supabase/schema.sql` | Tables, RLS policies, team functions (naye install ke liye poori file) |
| `supabase/update_inbox_quickwords.sql` | Pehle se chalti app ke liye: Inbox, apne quick words, settings sirf admin |
| `supabase/functions/ai/index.ts` | Gemini ya Claude se baat karne wala server function |
| `sw.js`, `manifest.json`, `icon.svg` | Phone par app ki tarah install (PWA) |

## Data

- `teams`, `profiles` (har user ki team aur role: admin / member), `team_invites`
- `docs`: har saved cheez ek row: `kind` = case / sample / lesson (rule) / digest / settings
- `ai_usage`: har AI request ke tokens (Team page par is mahine ka total)
- `inbox`: bheje hue drafts (sirf bhejne wala aur receiver dekh sakte hain; case History mein)
- `profiles.quick_words`: har user ke apne quick words

Row Level Security har query par check karti hai ke user sirf apni team ka data
dekh / badal sake.
