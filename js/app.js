/* Faisla Desk — main app.
   Ported from the claude.ai artifact: window.claude (sample / db / user / downloads) is replaced by the
   Supabase adapters in ai.js (Edge Function) and db.js (team-shared `docs` table). The drafting logic,
   prompts and style guide are unchanged. */
export function startFaislaDesk(ctx) {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map((n, i) => i < 2 ? String(n).padStart(2, "0") : n).join("."); };
/* Dates in the Judge's form dd.mm.yyyy, however they were typed (12-11-26 -> 12.11.2026). */
const fmtDate = s => { const v = String(s || "").trim(), m = v.match(/^(\d{1,2})\D+(\d{1,2})\D+(\d{2}|\d{4})$/); return m ? `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[3].length === 2 ? "20" + m[3] : m[3]}` : v; };

/* Calendar buttons next to date fields: the picked date is written as dd.mm.yyyy; typing by hand still works.
   The weekday shows under the field, with Sunday marked as the court holiday. */
const toISO = s => { const m = fmtDate(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CAL_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>`;
function dateField(id, value, ph) {
  return `<span class="datewrap"><input id="${id}" data-day-target placeholder="${esc(ph || "dd.mm.yyyy")}" value="${esc(value || "")}"><span class="calbtn" title="Pick a date">${CAL_SVG}<input type="date" class="datepick" data-for="${id}" aria-label="Pick the date from a calendar"></span></span><span class="weekday" data-day-for="${id}"></span>`;
}
function showWeekday(input) {
  const out = input && document.querySelector(`[data-day-for="${input.id}"]`); if (!out) return;
  const iso = toISO(input.value), d = iso ? new Date(iso + "T00:00:00") : null;
  const ok = !!d && !isNaN(d) && d.getDate() === +iso.slice(8, 10);
  out.textContent = ok ? WEEKDAYS[d.getDay()] + (d.getDay() === 0 ? " · court holiday" : "") : "";
  out.classList.toggle("sun", ok && d.getDay() === 0);
}
// Open the calendar on the date already typed, if any.
document.addEventListener("pointerdown", e => {
  const pick = e.target.closest?.(".datepick"); if (!pick) return;
  const iso = toISO(document.getElementById(pick.dataset.for)?.value); if (iso) pick.value = iso;
}, true);
document.addEventListener("change", e => {
  const pick = e.target.closest?.(".datepick"); if (!pick || !pick.value) return;
  const [y, m, d] = pick.value.split("-"), field = document.getElementById(pick.dataset.for);
  if (!field) return;
  field.value = `${d}.${m}.${y}`;
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
document.addEventListener("input", e => { if (e.target.matches?.("[data-day-target]")) showWeekday(e.target); });
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- The Judge's style, taken from the judgment skills ---------- */
const STYLE = {
civil: `CIVIL SUIT JUDGMENT (the Judge's own style; use it for ex-parte, contested and conceded suits)
HEADING (always this layout; the three court lines are bold and centred):
THE COURT OF <JUDGE NAME IN CAPITALS>,
<DESIGNATION IN CAPITALS, keeping "1st" as written, e.g. CIVIL JUDGE 1st CLASS>,
<DISTRICT IN CAPITALS>.
CMS No.<..>
Civil Suit No.<no>/<yyyy>
Date of Institution: <dd.mm.yyyy>
Date of Decision: <dd.mm.yyyy>
**<Plaintiff name>** S/O <..>, caste <..>, R/O <..>, Tehsil & District Rahim Yar Khan.
**Plaintiff** (on its own line, to the right)
**VERSUS** (centred)
1. **<Defendant name>** S/O <..>, caste <..>, R/O <..>.
2. **<Defendant name>** ...
A deceased defendant: "1. **<Name>** S/O <..> (deceased) through legal heirs:-" then "1/1. **<name>** widow of <deceased>", "1/2. **<name>**" ... then one line "Sons and daughters of <deceased>, caste <..>, R/O <..>." Common residence of several defendants: one line after the list ("Both residents of ..." / "All residents of ...").
**Defendants** (on its own line, to the right)
SUIT FOR <RELIEF IN CAPITALS>.
Party names always bold; parentage, caste and address in normal type.
Contested / conceded cases put the hearing block before the heading word:
<dd.mm.yyyy>
Present.  Mr. <name> Advocate, learned counsel for the plaintiff.
          Mr. <name> Advocate, learned counsel for defendants.
JUDGMENT:
Ex-parte cases: no Present block and no date line; the heading word is just "JUDGMENT" and the case is decided on a POINT OF DETERMINATION ending "? OPP".
Admin Judge: when the record shows that the issues were framed by the Admin Judge and the file then came to this court, say so after the issues: "Out of the divergent pleadings of the parties, issues were framed vide order dated <dd.mm.yyyy> by the learned Civil Judge (Admin Court) and the file was entrusted to this Court for further proceedings."

PARAGRAPHS
ORDER OF THE BODY (default): facts ("Succinctly, the facts of the case are that ...") -> the defendants' side ("Conversely, defendants ...", or the ex-parte paragraph) -> ISSUES exactly as framed with (OPP) / (OPD), or the POINT OF DETERMINATION -> PLAINTIFF'S ORAL EVIDENCE / PLAINTIFF'S DOCUMENTARY EVIDENCE -> DEFENDANTS' EVIDENCE -> "I have heard final arguments as delivered by learned counsel for the parties and perused the record deeply. My issue wise findings are as under: -" -> ISSUE NO.1, ISSUE NO.2 ... -> RELIEF:- -> closing lines -> Announced -> certificate.
1. Facts open with "Succinctly, the facts of the case are that ..." (or "Synoptically, the facts of case are that ..." only when the samples use it). Flowing narrative sentences, not a semicolon chain: property / transaction details, payments with dates and receipts, death of a party and legal heirs, refusal, "The grievance of the plaintiff is that ...", "The plaintiff asserts that he has always been ready and willing ...", ending "... hence, this case." / "Hence this suit."
2. Defendant's side.
   Ex-parte: "On the other hand, defendant was summoned through all possible mode of summoning but he did not turn up before the court, hence, defendant was proceeded against ex-parte vide order dated <date> and plaintiff was directed to produce his ex-parte evidence."
   Contested: "Conversely, defendants No.<..> contested the suit by filing controverted written statement [along with a counter-claim] that ..." summarise their version and admissions, ending "On these premises, the defendants have prayed for dismissal of the suit of plaintiff." If the defendants' right of evidence was closed, add DEFENDANTS' EVIDENCE: "Defendants did not produce any oral or documentary evidence and their right to produce evidence was closed vide order dated <..>."
3. Conceding statements (if any): "It is pertinent to mention here that during the proceedings of the suit, defendants No.<..> put their appearance before the court on <date> and they got recorded their conceding statement wherein they stated that ... and they have no objection if suit of plaintiff be decreed. Similarly, defendant No.<..> also present before the court on <date> and she also recorded her conceding statement ... It is also noted that defendants No.<..> are minors and their guardian (defendant No.<..>) also admitted the plaintiff claim by recording her conceding statement."
4. Point of determination is used (a) in ex-parte suits, (b) when issues were never framed (defendants ex-parte / right of written statement closed / conceding), (c) when asked for even in a contested case, (d) when the case was fixed for framing of issues but decided at once on admissions (Order XV Rule 1 CPC and Order XII Rule 6 CPC: "parties are not at issue on any question of law or of fact"). Form: "Out of the pleadings of plaintiff, point of determination is made out:-" then the point as a question ending "? OPP". Contested (not conceded): "Out of the divergent pleadings of the parties, following issues were framed:-" ISSUES 1..n with OPP/OPD and "Relief." (copy the issues exactly as framed).
5. Evidence, in either style.
   List style: **PLAINTIFF'S ORAL EVIDENCE** "Plaintiff has produced following witnesses in support of his stance:-" "PW-1: <name> (Plaintiff himself)."; **PLAINTIFF'S DOCUMENTARY EVIDENCE** "Plaintiff has produced following documents in his documentary evidence:-" "Exh.P-1: <description>." "Mark-A: Copy of <..> dated <..>." Contested: also DEFENDANTS' ORAL / DOCUMENTARY EVIDENCE (DW, Exh.D).
   Narrative style (short / conceded cases): "Plaintiff, <name> himself appeared in the witness box as PW-1 and reiterated the same facts as mentioned in the suit. He has produced <names> in his support in the witnesses box as PW-2 & PW-3 and they have supported the version of the plaintiff. In documentary evidence plaintiff have produced ... as Exh.P-1 ..., which further strengthen his version. After recording of evidence counsel for the plaintiff has recorded his statement regarding closure of plaintiff's evidence."
6. "I have heard final arguments as delivered by learned counsel for plaintiff and perused the record deeply. My issue wise findings are as under: -" (short orders and conceded cases may use "Arguments heard. Record perused.").
7. Discussion under **POINT OF DETERMINATION** / **ISSUE NO.x** / **ISSUES NO.x & y** (when interlinked), or straight paragraphs in conceded cases:
   - Opens with "Ratiocination set by plaintiff in his plaint is that ..." (recap).
   - "In order to substantiate his version, plaintiff appeared as PW-1 ... and reiterated the contents of the plaint. However/Moreover ..."
   - Discuss what each PW said in chief AND the admissions / denials in cross-examination.
   - Scrutinise the evidence even in ex-parte cases: missing date / time / place, omissions, contradictions between PWs, facts not pleaded ("It is settled law that evidence beyond pleadings cannot be relied upon"), interested / related witnesses without independent corroboration ("his testimony does not inspire confidence"), an attorney deposing beyond personal knowledge.
   - Documents: proof under the Qanun-e-Shahadat Order 1984, Articles 17 & 79 (attesting witnesses, signatures, author / scribe); an unproved document "cannot be relied upon for passing a favorable decision". Best evidence withheld by official defendants: adverse presumption under Article 129(g).
   - A governing legal principle is quoted as: "This principle has been authoritatively settled by the Hon'ble Supreme Court in <case> (<citation>), wherein it was held that:-" then the quotation in inverted commas.
   - Burden of proof paragraph (always in ex-parte suits; also when deciding against the plaintiff): "Although this suit is being decided without recording the statement of defendant, however as per law the initial burden to prove this case was placed upon plaintiff which he could/could not discharge through producing sufficient and reliable evidence. In this regard reliance is placed upon case titled “Mushtaq-ul-Arfin and others Vs. Mumtaz Muhammad and others” 2022 SCMR 55 in which it was held that:- “It was always the prime responsibility of plaintiff to discharge initial burden of prove with regard to her claim as per the plaint”. Further reliance is placed on case titled “FEDERATION OF PAKISTAN through Secretary, Ministry of Defence Rawalpindi and another Vs. Messrs FARRUKH INTERNATIONAL (PVT.) LTD. Through Proprietor” 2023 SCMR 1118 and “Aj Muhammad Khan Vs. Munawar Jan and others” PLJ 2009 SC 375."
   - Conceded cases: "From the perusal of record, it is evident that now the defendants are no more at variance with the plaintiff as they put their appearance before the court and got recorded their conceding statement. ... Execution of agreement ..., receiving of sale consideration and delivery of possession ... is admitted, which makes the plaintiff's case, prima facie, arguable in his favor." Then: "The plaintiff was asked to prove his case beside the conceding statement of defendants U/O VIII Rule 5 CPC. In view of this, plaintiff <name> recorded his statement as PW-1 ... There is nothing in rebuttal, so, keeping in view the conceding statement of the defendants and affirmative oral as well as documentary evidence of the plaintiff, the plaintiff has successfully proved his claim as ordained in his plaint. There is no embargo left to accede the prayer of suit." A conceding statement cannot confer a title the conceding party never had, nor bind State / TMA defendants.
   - OPD issues where the defendants produced no evidence: "Mere assertions made in the written statement, without any evidence in support thereof, are not sufficient ..." decided in negative against the defendants. Failure of a suit alone does not make it false / vexatious under Section 35-A CPC.
   - Standard: "on the touchstone of preponderance of probabilities".
   - Finding line: "... could not succeed to discharge the onus of this issue in his favour which is accordingly decided in negative against the plaintiff." / "... has succeeded to discharge the onus ... decided in affirmative in favour of the plaintiff."
8. RELIEF:- "In the light of my findings on above issue(s), suit of the plaintiff is hereby dismissed / decreed (ex-parte) as prayed for / decreed to the extent of ..." with the operative terms spelled out (declaration, injunction, direction to execute the sale deed failing which through process of Court). Short conceded judgments may instead end the last discussion paragraph with "Hence, suit of the plaintiff is decreed in his favour as prayed." Then exactly: "No order as to costs. Decree-sheet be drawn up accordingly. Ahlmad is hereby directed to consign the file to the record room after its due completion and compilation."

SIGNATURE AND CERTIFICATE
Announced:
<dd.mm.yyyy>        <Judge name>
                    <Designation>
                    <District>
It is certified that this judgment consists of ____-Pages, each of which has been dictated, read over, corrected and signed by me.
                    <Judge name>
                    <Designation>
                    <District>

PRECEDENTS AND PRINCIPLES THE JUDGE USES (citations only from the CASE LAW LIST)
- Rendition of accounts: maintainable only where a fiduciary relationship exists (principal-agent, partners, trustee-beneficiary, guardian-ward); a mere contractual relation is not enough; see the CASE LAW LIST under "Rendition of accounts" for the citations and the quotation “A suit for accounts is an equitable relief and is not maintainable in cases of simple contractual obligations, where the plaintiff is himself in a position to ascertain his alleged dues and seek recovery through a money suit”.
- Specific performance of an agreement to sell: execution of the agreement (Exh.P-1) proved by marginal witnesses and the scribe, payment of sale consideration in instalments with receipts / bank record, delivery of possession, the plaintiff's readiness and willingness, revenue record of the suit land, authority of a general attorney who executed the agreement; legal heirs of a deceased vendor are bound by the agreement; on conceding statements proof is still required under Order VIII Rule 5 CPC; a vendor without title (e.g. Kachi Abadi / State land) cannot pass title.
- Declaration against warabandi / an official order: an order passed without notice or hearing violates audi alteram partem and is void; civil court jurisdiction is not ousted; relief = declaration + injunction, with liberty to the authority to pass a fresh order after notice and hearing.
- Declaration (S.42), permanent / mandatory injunction (S.54 / 55 Specific Relief Act), recovery and possession suits use the same structure.

COMPROMISE AFTER ISSUES WERE FRAMED
Keep the contested shape (facts, written statement, issues as framed), then paragraphs on the statements of the defendants and the plaintiff regarding the compromise recorded on oath (identified by counsel, free will, no coercion) and amounts paid / deposited / withdrawn. Issue 1 decided on admissions under Order XXIII Rule 3 and Order XII Rule 6 CPC; OPD issues "not pressed in view of the compromise". Relief: "decreed in terms of the compromise" with numbered terms. If the order sheet says so, add: "In view of the new amendments in Order XXI Rule 10 CPC, on passing of an executable decree the suit shall stand converted into execution proceedings and no separate application or fresh notice to the judgment debtor shall be necessary. File be put up on <date> for further proceedings."

CONDITIONAL DECREE
"decreed, subject to deposit of the remaining sale consideration of Rs.<..> by the plaintiff in the Court within one month from today"; terms: execution of the sale deed / mutation, failing which through process of Court; the defendants may withdraw the deposit as per their shares; "In case the plaintiffs fail to deposit ... within the stipulated period, the suit shall stand dismissed."

ORDER XVII RULE 3 CPC (WANT OF EVIDENCE)
When the plaintiff failed to produce evidence despite the last opportunity, his evidence was closed under Order XVII Rule 3 CPC and the suit is decided forthwith on the material available on the record. Narrate the dates on which opportunities were given; the initial burden of proof lay on the plaintiff (use the burden-of-proof paragraph) and the decision follows as the Judge directs.`,

applications: `ORDERS ON APPLICATIONS (the Judge's court style)
Heading: the court lines (bold, centred), "<Plaintiff> VS. <Defendant> etc.", the suit title, the application title in capitals, CMS No., date, the Present block (counsel; "already ex-parte" lines; "Nemo for ..."), then "ORDER:".
Paragraphs: 1 "Through this order, I intend to dispose of an application ...". 2 "Briefly stated facts of the application are that ...". 3 The reply / ex-parte / right closed. 4 "Arguments heard. Record perused." 5+ The reasoning. Last paragraph: the decision and "Now, to come up for <purpose> on <date>." Then "Announced:" with the date and the signature only (no certificate).
- Restoration of suit (Order IX Rule 9 CPC): date of dismissal, filing within 30 days (Article 163 Limitation Act), the reason (e.g. counsel's clerk noted a wrong date / counsel busy in other courts / appeared the same day at 02:20 PM), affidavit unrebutted, the mistake of counsel's clerk is not to be visited on the party, cases are to be decided on merits; "accepted and the suit is restored to its original number and stage". If a respondent failed to file a reply on the fixed date: "the right of respondent No.<..> to submit written reply is hereby closed."
- Setting aside ex-parte proceedings: accepted, subject to costs if so directed; adjourned for written statement and payment of costs.
- List of witnesses (Order XVI Rule 1 CPC): accept both parties' applications in one order; only REFER to the lists annexed with the applications and do NOT write the witnesses' names; evidence has not yet commenced, no prejudice, cases are to be decided on merits; direct diet money / process fee within seven days; next date for the plaintiff's evidence.
- Substitute witness for a deceased witness whose examination-in-chief was recorded: dismiss even if the other side has no objection, because a witness deposes to his own personal knowledge, one witness's testimony cannot be completed or substituted by another, consent cannot confer a power not given by law, and the evidentiary value of the uncross-examined chief will be weighed at the final decision.
- Temporary injunction (Order XXXIX Rules 1 & 2 CPC): facts of the application, the replies, "Arguments heard. Record perused.", the three ingredients (prima facie case, balance of convenience, irreparable loss) discussed tentatively; lis pendens under Section 52 TPA; observations are tentative. In specific performance suits: an agreement to sell creates no interest (Section 54 TPA), vendor dead / execution disputed, forgery alleged, loss compensable in money; vacate the ad-interim order.
- When issues are framed in the same order: heading "ISSUES:", frame them from the written statement (e.g. forged / fictitious agreement OPD, Order VII Rule 11 CPC, clean hands, Section 53-A TPA possession) and close with "The parties were asked whether they want to produce any additional issue, to which they did not press for any further issue. Now, to come up for evidence of the plaintiff on <date>. The plaintiff is directed to produce his evidence on the date fixed at his own responsibility."
- Amendment of plaint (Order VI Rule 17 CPC): the proposed amendments listed i., ii. ...; liberal approach at the initial stage, the nature of the suit unchanged, no prejudice; accepted subject to costs if so directed (e.g. Rs.1,500/-); direct the amended plaint and the amended written statement.
- Execution petition adjourned sine die: narrate the order history (musawada approved, court representative appointed / changed, fee fixed, repeated dates for fee deposit), decree-holder not interested; "adjourned sine die for non-deposit of the fee of the Court Representative ... at liberty to get the execution petition restored/revived, subject to the deposit of the requisite fee".
- Succession: application for requisition of the file and permission to submit a surety bond: accepted, submit the bond as per the earlier order, certificate to issue after verification, preserve the conditions for minors' shares.`,

ordersheet: `DAILY ORDER SHEET (the Judge's style)
<dd.mm.yyyy>
Present. <who appeared, e.g. "Mr. <name> Advocate, learned counsel for the plaintiff.", "Defendant No.1 already ex-parte.", "Nemo for the defendants.">
Then a short order in plain court English, usually 2 to 5 lines: what the case was fixed for, what happened today, any right closed, ex-parte proceedings or costs, and the last line "Now, to come up for <purpose> on <next date>."
Standard phrases, to be used ONLY when the stenographer asks for them (a ticked box or the instructions), never on your own: "Last opportunity is granted to the plaintiff to produce his evidence."; "subject to payment of costs of Rs.<..>/-"; "failing which his right to produce evidence shall be closed under Order XVII Rule 3 CPC"; "Right of the defendant to file written statement is struck off."; "Defendant is proceeded against ex-parte."; "Evidence of the plaintiff is closed under Order XVII Rule 3 CPC."
Write it so that it continues the same order sheet as the previous entry: the same names and spellings, the same way of writing the Present block, the same name and designation lines at the end.
The last line must state the full proceedings for which the case is fixed on the next date, in the same words the order sheet uses for that stage, not merely the pending step. Example: when the case is fixed for summoning of the judgment debtor through non-bailable warrant of arrest subject to deposit of process fee and the fee has not been deposited, write "Now, to come up for summoning of judgment debtor through issuance of his non-bailable warrant of arrest subject to deposit of process fee on <next date>." and not "Now, to come up for deposit of process fee on <next date>." Add a time limit such as "within 3 days" only when the user writes it or the previous order carries it.
Do not write the heading "ORDER" (or any other heading) in a daily order: the text of the order starts directly on the line after the Present block, even if the previous order in the picture carries such a heading. The only exception: the Judge's own SAMPLES of daily orders (Layer 2) consistently use such a heading.
Do not use spaces or tabs to indent or line up anything, and do not break a Present entry over two lines: write each Present entry on one line starting at the left margin. The page layout is done separately.
Do not number the paragraphs of a daily order: no "1.", "2." or similar before any sentence, including the "File be put up ..." / "Now, to come up ..." line, even if the previous order in the picture carries such numbers.
Every order ends with "Announced:" and, on the line below it, the date of the order; after that come the Judge's name and designation lines.
The Judge signs the printed order by hand: never write "[Signature]", "Sd/-", "(signed)" or any note about a stamp, seal or handwritten signature seen in the pictures.`,

rent: `RENT / EJECTMENT PETITION (Punjab Rented Premises Act, 2009)
Heading designation: "CIVIL JUDGE 1st CLASS/JUDGE RENT TRIBUNAL," (or the designation given). Parties "**Petitioner/Landlord**" / "**Respondent/Tenant**"; title "EJECTMENT PETITION UNDER SECTION 15 OF THE PUNJAB RENTED PREMISES ACT, 2009."; a contested petition ends in "JUDGMENT:", an ex-parte one is decided by an "ORDER:" written after the Present block. The same bold-name heading layout as the civil suit.
Paragraphs: facts ("Briefly stated facts of the instant petition are that ...; that ...; hence, this petition."), service / ex-parte (refusal report, registered AD, publication with the newspaper name and date), evidence (AW-1, AW-2 ..., Exh.A-1 .., Mark-A ..), "Arguments heard and record perused.", then the discussion in this order:
- Relationship of landlord and tenant (rent agreement, ownership, registration of the tenancy at the Police Khidmat Markaz; the legal heir of a deceased landlord steps into his shoes).
- Registration of the tenancy under Section 5 / penalty of 10% of the annual rent deposited (date), where the record shows it.
- The ground (default in rent, personal need, etc.) under Section 15; unrebutted evidence; once the landlord states on oath that the rent was not paid, the onus shifts to the tenant to show payment / tender / deposit.
- Arrears of rent (period, rate, amount); security adjusted as per the agreement.
- Contested: leave to contest under Section 22 granted / refused; then issues and findings.
Terms i., ii., iii.; "No order as to costs. File be consigned to the record room after its due completion and compilation."; Announced; a judgment also has the certificate, an order does not.
Defaults: the period to hand over vacant possession is the one given by the stenographer (otherwise "____"); security adjusted at vacation; on failure, implemented through process of law.`,

guardian: `GUARDIANSHIP (Guardians and Wards Act, 1890), using the civil-style heading and paragraphs
- Petition under Section 25 (custody) or Sections 7 / 10 (appointment as guardian of the person / property); the minors' names, ages and present custody.
- The welfare of the minor is paramount (Section 17): age, sex, who is maintaining the minor, conduct of the parties, the minor's preference if of an intelligent age.
- Permission to sell property (Section 29): purpose, benefit to the minor, safeguards (amount deposited in the minor's account / a profit-bearing scheme till majority).
- Terms: appointment / custody, visitation schedule for the other parent, guardian bond / surety where needed. Anything not given (custody to whom, visitation days, bond amount): write "____".`,

succession: `SUCCESSION CERTIFICATE (Succession Act, 1925, Sections 372 / 373), using the civil-style heading and paragraphs
- Death of the deceased (death certificate), legal heirs (family registration / NADRA FRC), debts and securities (bank, pension, GP fund) with amounts.
- Proclamation / publication issued, no objection received (or the objection decided).
- Certificate granted in favour of the petitioner(s) for the listed assets, on furnishing a surety bond equal to the amount; shares as per Shariah / Muslim law if specified. Anything not given (asset amounts, shares, surety amount, no-objection affidavits): write "____".`,

family: `FAMILY COURT JUDGMENT (the Judge's style)
EX-PARTE TEMPLATE
IN THE COURT OF <JUDGE NAME>,
JUDGE FAMILY COURT, <CITY>.
CMS No.<..>
Family Suit No: <..>,
Instituted on: <dd.mm.yyyy>,
Decided on: <dd.mm.yyyy>.
<Plaintiff(s) with parentage, caste, address; a minor "through his/her real mother/next friend i.e. plaintiff No.1">
VERSUS
<Defendant(s)>
SUIT FOR <ALL RELIEFS IN CAPITALS>.
EXPARTE JUDGMENT:
1. Briefly stated facts of the instant suit are that ...; ... hence, this suit. (one long paragraph, facts separated by "; that")
2. Process was issued ... (ordinary mode / registered post AD / publication) ... proceeded against ex-parte on <date> and file was fixed for ex-parte evidence.
3. <PW-1 ..., PW-2 ... produced affidavits Exh.P-1 ...; documents Exh./Mark ...>. Thereafter learned counsel closed the ex-parte evidence.
4. Arguments heard and record perused.
5. PW-1 reiterated on oath ...; corroborated by PW-2 ...; unchallenged and unrebutted as defendant chose not to contest ... and the first claim.
6..n. One paragraph per claim (dissolution, maintenance of wife, maintenance of minor, iddat, dower, delivery expenses, dowry, gold, valuables) with reasoning and finding.
Last paragraph: "In view of the foregoing discussion, the suit of the plaintiff(s) succeeds partially / is decreed ex-parte in the following terms:" i., ii., iii. ...
"Decree sheet be prepared accordingly. No order as to costs. File be consigned to the record room after due compliance."
Announced: <date>   <Judge>, Judge Family Court, <City>.
Certified that this judgment consists of ____ pages and each page has been dictated, corrected, read and signed by me.
<date>   Judge Family Court, <City>.
Then an ORDER SHEET:
<Plaintiff> VS. <Defendant>
<SHORT TITLE ETC.>
<date>
Present: <counsel>, counsel for the plaintiff(s).
Defendant is already ex-parte.
ORDER
Vide my separate judgment of even date in English, suit of the plaintiff(s) is partially decreed ex-parte in the following terms: <same terms>
Decree sheet ... consigned ...
Announced: <date>   <Judge>
CONTESTED (differences): heading "JUDGMENT:"; after the facts "Defendant(s) appeared and contested the suit by filing written statement, wherein ..." (preliminary objections and reply on facts); "Pre-trial reconciliation proceedings remained unsuccessful."; "Out of the divergent pleadings of the parties, following issues were framed:" ISSUES with (OPP)/(OPD) and "Relief."; evidence of the plaintiff (PWs, Exh.P) and the defendant (DWs, Exh.D); "Arguments heard and record perused. My issue-wise findings are as under:" then ISSUE NO.1: discussion with reference to specific evidence and cross-examination admissions, finding "decided in favour of plaintiff/defendant"; preliminary-objection issues last or together; "RELIEF:" with the decree terms; the same certificate and order sheet ("contested", both counsel present).
DEFAULTS (unless told otherwise): maintenance of a minor with 10% annual increase "till legal entitlement"; iddat maintenance per month "for the period of Iddat" from the decree date; a relief not claimed but granted comes under "any other relief" and the Court can mould relief; a khula decree cites Mst. Khurshid Bibi v. Baboo Muhammad Amin (PLD 1967 SC 97) and the proviso to Section 10(4), Family Courts Act 1964; a dissolution decree directs that a certified copy be sent to the Chairman Union Council under Section 21, Family Courts Act 1964; gold ornaments declined: no goldsmith produced, receipt not proved by its executant, receipt shows purchase not entrustment, ornaments ordinarily remain in the lady's own possession; dowry partly granted: depreciation since the year of marriage, no shopkeeper produced, depreciated value as the Judge fixes; delivery / medical expenses without bills: strict rules of evidence do not apply in family cases, fair assessment.`,

magistrate: `MAGISTRATE SECTION-30 (the Judge's style)
Heading: "IN THE COURT OF <JUDGE NAME IN CAPITALS>, MAGISTRATE SECTION-30, <DISTRICT>."; "<Petitioner> VS. The State / SHO ..."; FIR No. and date, offence, P/S; the title of the application; CMS No.; date; Present (counsel; "Police report received"); ORDER paragraphs as in orders on applications; signed "Magistrate Section-30".
Superdari (Section 516-A Cr.P.C) allowed: the petitioner is the last owner and last possessor (agreement / registration Form G / token tax), no other claimant per the police report, not required for investigation, deteriorating in the police station; release on a superdari bond of Rs.<..> with one surety; conditions: no sale or alteration of shape, engine, chassis or registration till the decision; produce when required; the I.O to prepare photographs and a memo before handing over; copy to the SHO.
Superdari rejected (e.g. wheat under the Punjab Foodstuffs (Control) Act 1958): the applicant is only the driver, the owner is not the applicant, the claimed lawful purpose (seed) is not substantiated by a purchase receipt / permit / seed-processing record, the accused fled the spot, wheat shortage and restrictions on movement / smuggling, the case property is the corpus of the offence liable to confiscation and lies safe in the Food Department godown; Section 516-A is discretionary; observations are tentative; copy to the SHO and the Food Grain Inspector.`,

idparade: `IDENTIFICATION PARADE REPORT (the Judge's jail format). The report is in English, but the suspect's huliya, the witnesses' statements (in the first person) and the accused's objections stay in Urdu exactly as recorded.
IN THE COURT OF <JUDGE NAME> MAGISTRATE SECTION-30, <DISTRICT>
REPORT OF IDENTIFICATION PARADE
FIR NO.<..>/<yyyy> [DATED <..>]
OFFENCE U/S <..> PPC.
P/S <..>, <DISTRICT>.
"In order to hold identification parade of suspect(s) <names>, I approached District Jail, Rahim Yar Khan today i.e. <date> at about <time>. On the outer gate of the jail, I.O <name rank>, Police Station <..> along with record and identifying witnesses namely:-" 1. <name S/O, caste, age about __-years, <profession> by profession, R/O ...> (complainant). 2. ... "were present there. Mr. <name>, Assistant Superintendent Jail, Rahim Yar Khan was also present there." (Take the Assistant Superintendent's name from the IDENTIFICATION PARADE DETAILS, else from the record; if it is not shown write "____" and mention it in the notes.) "I ordered I.O to stay outside jail premises and police file was temporarily taken from him." Then the precautionary directions i. witnesses kept separate; ii. sent turn by turn; iii. after identification sent to another place, no communication; iv. mobile phones kept in the office of the Superintendent Jail; v. a warder / jail official to keep an eye; vi. the suspect placed among other persons in the proportion of nine to one (a separate row for each suspect) with the same physique, height, features and complexion. "I was informed after some time ... arrangements completed in the hall of jail."
For each suspect (heading "ROW NO.x (SUSPECT <NAME>)" when more than one): "I started identification parade proceeding of the suspect <name>. The Assistant Superintendent ... escorted me towards the place where suspect having features:-" then in Urdu: ملزم: <نام ولدیت، قوم، عمر، پیشہ، سکنہ>۔ حلیہ:- <چہرہ، داڑھی مونچھ، جسم، رنگ، قد>۔ "has been placed amongst nine other persons in a row. Particulars of whom are as under:-" 1..10 (English transliteration: Name S/O ..., caste ..., R/O ...; mark "(suspect)"). "All the persons have almost similar physique ... I asked ... to summon first identifying witness." "The first identifying witness <name> (complainant) was brought ... He identified the suspect and put his hand on the head of suspect sitting at Serial No.<n> from right to left in a row. He stated that:" <Urdu statement>. Objection, if any: "At this stage, the accused raised an objection that: <Urdu>" and "The impact of such objection will be adjudged by the trial court and I do not deem it proper to comment on it." "When the first identifying witness completed ... sent to some other place ..." "Before summoning the other witness, the suspect was asked whether he wants to change his position in the row, to which he did not change his position." Then the next witness the same way. Later rows may say "He reiterated the same statement as recorded above." A collective objection of all suspects is recorded once under "OBJECTION OF THE SUSPECTS:". If a witness fails to identify or points at a dummy, record it plainly ("He failed to identify the suspect and put his hand on the head of a dummy sitting at Serial No.x") and reflect it in the conclusion.
CONCLUSION: "The complainant <..> and witness(es) <..> have rightly identified the accused <..>." Dated: <date>   <Judge>, Magistrate Sec-30, <District>
CERTIFICATE: "It is certified that the above report of identification parade is a true and correct record of my proceedings comprising of ____ pages and that no collusion with police and witnesses or among the witnesses themselves was possible." Dated: <date>   Magistrate Section-30, <District>.
Disposal order: <date>. "Present: <I.O name rank>/IO along with record. Complainant alongwith witness(es) are in attendance. Identification parade has been carried out in the jail premises. The very object of this petition has been achieved and accomplished; therefore, the petition for holding of identification parade is hereby disposed of. Identification parade proceedings along with this order be sent to the Worthy District & Sessions Judge, Rahim Yar Khan for onward transmission to the concerned competent court. Ahlmad is directed to dispatch the file immediately." Announced. <date>   <JUDGE NAME>, Magistrate Section 30, <District>.`
};

/* ---------- Case law the drafts may cite (Layer 1). Nothing outside this list (or the team's own list in Settings) may be cited. ---------- */
const CASE_LAW = [
  { topic: "Burden of proof: the initial burden lies on the plaintiff", principle: "The initial burden to prove the claim made in the plaint is always on the plaintiff; it does not shift merely because the defendant is absent or his case is weak.",
    quote: "It was always the prime responsibility of plaintiff to discharge initial burden of prove with regard to her claim as per the plaint.", quoteFrom: "2022 SCMR 55",
    cases: [["Mushtaq-ul-Arfin and others Vs. Mumtaz Muhammad and others", "2022 SCMR 55"], ["Federation of Pakistan through Secretary, Ministry of Defence Rawalpindi and another Vs. Messrs Farrukh International (Pvt.) Ltd. through Proprietor", "2023 SCMR 1118"], ["Aj Muhammad Khan Vs. Munawar Jan and others", "PLJ 2009 SC 375"]] },
  { topic: "Written statement is not evidence", principle: "Assertions made in a written statement are not evidence; without evidence in support they cannot be relied upon.",
    cases: [["Mrs. Shahina Shahid Vs. Qamran Construction", "2024 CLC 914"], ["Faiz Muhammad Vs. Province of Sindh", "2024 MLD 644"]] },
  { topic: "Amendment of pleadings (Order VI Rule 17 CPC): liberal approach", principle: "Amendment of pleadings is to be allowed liberally so that the real question in controversy is decided, if the nature of the suit is not changed and the other side can be compensated by costs.",
    cases: [["Mst. Ghulam Bibi and others Vs. Sarsa Khan and others", "PLD 1985 SC 345"]] },
  { topic: "Late amendment: closer scrutiny", principle: "An amendment sought at a late stage is examined more strictly: the delay, its explanation, the bona fides and the prejudice to the other side.",
    cases: [["Muhammad Arif Tarar Vs. Matloob Ahmad Warraich", "2026 SCLR 1"]] },
  { topic: "Partition added by amendment in a suit for declaration of inheritance", principle: "The relief of partition can be added by amendment in a suit for declaration of inheritance, which avoids multiplicity of proceedings.",
    cases: [["Mian Muhammad Saeed Vs. Mian Abdul Ghafoor", "PLD 2006 Lahore 456"], ["Syed Mohsin Raza Bukhari Vs. Syeda Azra Zenab Bukhari", "1993 CLC 31"]] },
  { topic: "No limitation against inheritance", principle: "Limitation does not run against a legal heir's claim to his share in inheritance.",
    cases: [["Ghulam Ali Vs. Mst. Ghulam Sarwar Naqvi", "PLD 1990 SC 1"]] },
  { topic: "Rendition of accounts", principle: "A suit for rendition of accounts lies only where a fiduciary relationship exists (principal-agent, partners, trustee-beneficiary, guardian-ward); a simple contractual relation is not enough.",
    quote: "A suit for accounts is an equitable relief and is not maintainable in cases of simple contractual obligations, where the plaintiff is himself in a position to ascertain his alleged dues and seek recovery through a money suit.", quoteFrom: "PLD 1972 Karachi 8",
    cases: [["Engineering Corporation, The Mall, Lahore Vs. Government of Punjab and others", "1991 SCMR 2324"], ["Abdul Karim Vs. Iqbal-ur-Rehman", "1980 CLC 1283"], ["Province of West Pakistan Vs. Allah Ditta", "PLD 1972 Karachi 8"]] },
  { topic: "Khula (Family Court)", principle: "A wife is entitled to dissolution of marriage on the basis of khula when the court is satisfied that the spouses cannot live together within the limits prescribed by Allah.",
    cases: [["Mst. Khurshid Bibi Vs. Baboo Muhammad Amin", "PLD 1967 SC 97"]] }
];
/* The team's own case law from Settings: one per line, "Case title | Citation | What it decides". */
function myCaseLaw() {
  return String(settings.caseLaw || "").split("\n").map(l => l.split("|").map(x => x.trim())).filter(p => p.length >= 2 && p[0] && p[1]).slice(0, 60)
    .map(([title, cite, ...rest]) => ({ title, cite, principle: rest.join(" | ") }));
}
function caseLawBlock() {
  const lines = CASE_LAW.map(c => `- ${c.topic}. Principle: ${c.principle}${c.quote ? `\n  Quotation (from ${c.quoteFrom}, the only words that may be put in inverted commas): “${c.quote}”` : ""}\n  Cite: ${c.cases.map(([t, ci]) => `“${t}” ${ci}`).join("; ")}`);
  const mine = myCaseLaw();
  return `CASE LAW LIST (the ONLY precedents that may be cited; never invent or alter a name, year, journal, court or page; never put words in inverted commas as a quotation from a judgment unless the quotation is given here)
${lines.join("\n")}${mine.length ? "\nAdded by the team (Settings):\n" + mine.map(c => `- “${c.title}” ${c.cite}${c.principle ? ". Principle: " + c.principle : ""}`).join("\n") : ""}
If none of these fits a point, state the legal principle in plain words without any citation.`;
}
/* Citations found in a draft, each marked as in the app's list or not, for the "Verify citation" badge. */
const CITE_RE = /\b(?:(?:PLD|PLJ|NLR|PCr\.?\s?LJ)\s+(?:19|20)\d{2}\s+(?:SC|FSC|Lahore|Lah\.?|Karachi|Kar\.?|Peshawar|Pesh\.?|Quetta|Islamabad|[A-Z][a-z]{2,})\s+\d{1,4}|(?:19|20)\d{2}\s+(?:SCMR|CLC|MLD|YLR|SCLR|CLD|PTD|PLC|MLR|KLR|NLR|CLR|GBLR|PCr\.?\s?LJ|P\.?\s?Cr\.?\s?L\.?\s?J\.?)\s+\d{1,4})\b/g;
const citeKey = c => String(c).toUpperCase().replace(/LAHORE/g, "LAH").replace(/KARACHI/g, "KAR").replace(/PESHAWAR/g, "PESH").replace(/[^A-Z0-9]/g, "");
function citationsIn(text) {
  const known = new Set([...CASE_LAW.flatMap(c => c.cases.map(x => citeKey(x[1]))), ...myCaseLaw().map(c => citeKey(c.cite))]);
  const seen = new Map();
  for (const m of String(text || "").matchAll(CITE_RE)) { const k = citeKey(m[0]); if (!seen.has(k)) seen.set(k, { cite: m[0].replace(/\s+/g, " "), known: known.has(k) }); }
  return [...seen.values()];
}
/* The Judge's name is always written as in Settings (e.g. "Ahmad", never "Ahmed"), in capitals where the draft uses capitals. */
function fixJudgeName(t) {
  const j = norm(settings.judge);
  if (!/ahmad/i.test(j)) return t;
  const re = new RegExp(j.split(" ").map(w => /^ahmad$/i.test(w) ? "Ahm[ae]d" : w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "gi");
  return String(t || "").replace(re, m => m === m.toUpperCase() ? j.toUpperCase() : j);
}

/* ---------- Global rules (Layer 1): apply to every draft and order ---------- */
function globalRules(isOrder) {
  const j = settings.judge, ahmad = /ahmad/i.test(j) ? ` (never "${j.replace(/ahmad/i, "Ahmed")}")` : "";
  return `GLOBAL RULES (apply to every draft)
1. Language: English court language. Statements of witnesses, the suspect's huliya and objections of the accused that were recorded in Urdu stay in Urdu script, exactly as recorded.
2. When the decision is given, draft at once on that decision. Never stop to ask a question and never refuse to draft for want of a detail: an unknown detail is written as "____".
3. Date: the date of the order / decision given; if none is given, today's date (${today()}).
4. Unreadable or missing words, names, numbers or dates: write "____" in their place (never guess) and list each one in NOTES.
5. Corrections to an existing draft change only what was asked; a fresh draft is never written in their place.
6. Case law: ${isOrder ? "a daily order cites no case law." : "cite only precedents from the CASE LAW LIST (or supplied by the stenographer in this request). A citation that appears only in the samples or the learned notes is not in the list, so do not cite it. Never invent a citation. If no listed case fits, state the principle without a citation."}
7. Judge's name: exactly "${j}"${ahmad}.
8. Never write "[Signature]", "Sd/-", "(signed)", "[Stamp]", "[Seal]" or any note about a stamp, seal or handwritten signature: the signature block is only the name and designation lines.${isOrder ? `
9. Daily order: no "ORDER" heading unless the Judge's samples of daily orders use one; no paragraph numbers; it ends with "Announced:", then the date of the order on the next line, then the Judge's name and designation lines.` : ""}`;
}
/* NOTES: after every draft, a short checklist for the stenographer in Roman Urdu. */
function notesSpec(isOrder) {
  return `a line with exactly ===NOTES=== and after it ${isOrder ? "1-5" : "3-10"} short lines in Roman Urdu (Urdu written in English letters, e.g. "Plaint mein khata No.123 hai magar jamabandi mein 132; check karein."), each starting with "- ", covering: every blank (____) and what should go there; uncertain readings; mismatches between documents (khata / khewat No. in the plaint vs the jamabandi, area or share, names in the NADRA FRC vs the plaint, dates, amounts); minors (anyone 18 or under) and how their share or interest is protected; every assumption made; and every citation used, with the reminder to verify it from the official report. If nothing needs checking, one line: "- Kuch check karne ki zaroorat nahi."`;
}

/* ---------- Types with their own drafting template (Layer 1) ---------- */
const TYPE_INFO = {
  "Permanent injunction: owner in possession": { base: "Civil suit",
    hint: "e.g. suit decreed; defendants permanently restrained from interfering in the plaintiff's possession; PWs were not cross-examined",
    docs: "Revenue record (jamabandi / fard / girdawari) / exhibits",
    guide: `TYPE TEMPLATE: SUIT FOR PERMANENT INJUNCTION, OWNER IN POSSESSION (usually decreed; the PWs were not cross-examined)
- The civil suit heading and closing; "SUIT FOR PERMANENT INJUNCTION." (add "DECLARATION AND" only when also claimed).
- Facts: the plaintiff is the owner in possession of the suit property (khewat / khatooni / khasra Nos., area, mauza, as per the jamabandi / fard); the defendants, having no concern with it, are threatening to interfere in / dispossess him and refused to desist; hence the suit (Section 54, Specific Relief Act, 1877).
- The defendants' side exactly as the record shows: ex-parte; or written statement filed but no evidence; or right of cross-examination closed.
- POINT OF DETERMINATION (ex-parte / no issues) or the ISSUES exactly as framed.
- Evidence: PW-1 (plaintiff or his attorney), PW-2 / PW-3 (witnesses of possession); Exh.P-1 jamabandi / fard, Exh.P-2 khasra girdawari and the rest as on the record.
- Discussion: (a) ownership from the revenue record (an entry in the record of rights is presumed to be true until the contrary is proved, Section 52 of the Punjab Land Revenue Act, 1967); (b) possession from the PWs and the girdawari; (c) "The PWs were not cross-examined [despite opportunity / as the right of cross-examination was closed vide order dated <..>], so their statements on oath have gone unchallenged and unrebutted; a statement on oath which is not challenged in cross-examination is deemed to have been admitted." (no listed case covers this, so no citation); (d) the initial burden still lay on the plaintiff (the burden-of-proof paragraph with the listed citations); (e) if a written statement was filed but no evidence led, cite the listed cases under "Written statement is not evidence".
- Do not decide title beyond what the revenue record shows.
- RELIEF:- "suit of the plaintiff is hereby decreed as prayed for. The defendants are permanently restrained from interfering in the peaceful possession of the plaintiff over the suit property and from dispossessing him therefrom except in due course of law." Then the standard closing lines.` },
  "Declaration of heirship: inherited vehicle": { base: "Civil suit",
    hint: "e.g. suit decreed; plaintiffs and defendants 1-3 declared legal heirs; Motor Registering Authority to transfer the vehicle as per Shari shares; minors' shares through the Guardian Court",
    docs: "Registration book / death certificate / NADRA FRC / Decline Certificate / bank NOC",
    guide: `TYPE TEMPLATE: DECLARATION OF HEIRSHIP, INHERITED VEHICLE
- "SUIT FOR DECLARATION" (add "AND MANDATORY INJUNCTION" when claimed). Defendants as on the plaint: usually the other legal heirs, the Motor Registering Authority (Excise, Taxation & Narcotics Control Department) and the bank, if any.
- Facts: the vehicle (make, model, registration No., engine No., chassis No.) stood registered in the name of the deceased <name>, who died on <date> (death certificate); his legal heirs as per the NADRA Family Registration Certificate (FRC); NADRA declined to issue a letter of administration / succession certificate (NADRA Decline Certificate dated <..>, with the reason written in it); if the vehicle was financed, the bank's NOC / clearance; the Motor Registering Authority refuses to transfer the vehicle without a declaration of the court; hence the suit.
- The defendants' side as on the record (conceding statements of the other heirs; the Authority's reply; ex-parte).
- POINT OF DETERMINATION or the issues; evidence: PW-1, PW-2; registration book, death certificate, FRC, Decline Certificate, bank NOC, conceding statements, with the exhibit numbers on the record.
- Discussion: death, relationship and the list of legal heirs proved by the FRC and the death certificate; the vehicle was owned by the deceased and devolves on all his legal heirs according to their Shari shares; no other claimant; conceding statements still need proof (Order VIII Rule 5 CPC). Compare the names in the FRC with the plaint; any difference goes in NOTES.
- Shari shares: write each heir's fraction only when the stenographer gives it; otherwise "according to their Shari shares".
- Minors: "The shares of the minor legal heirs <names> shall remain protected and shall not be alienated or transferred, nor shall any amount be received on their behalf, without the permission of the learned Guardian Court under the Guardians and Wards Act, 1890."
- RELIEF:- declaration that the plaintiffs and defendants No.<..> are the legal heirs of the deceased <name> and are entitled to the vehicle No.<..> according to their Shari shares; direction to the Motor Registering Authority to transfer / record the vehicle accordingly (or in the name of the heir the other adult heirs consented to, if that is the decision) after completion of codal formalities and payment of the due tax / fee. Then the standard closing lines.` },
  "Declaration of heirship: housing scheme plot / shop": { base: "Civil suit",
    hint: "e.g. suit decreed; plaintiffs declared legal heirs; PHATA to enter their names against plot No.12 subject to Government dues and codal formalities",
    docs: "Allotment / transfer letter / death certificate / NADRA FRC / receipts",
    guide: `TYPE TEMPLATE: DECLARATION OF HEIRSHIP, PLOT / SHOP IN A HOUSING SCHEME (PHATA or the concerned authority)
- "SUIT FOR DECLARATION" (add "AND MANDATORY INJUNCTION" when claimed). Defendants usually the Punjab Housing and Town Planning Agency (PHATA) / the concerned authority through its officer, and the other legal heirs.
- Facts: plot / shop No.<..>, measuring <..>, in <scheme>, <city>, allotted / transferred to the deceased <name> (allotment letter / transfer letter / receipts); death on <date>; legal heirs as per the NADRA FRC; the department refuses to enter the names of the legal heirs without a declaration of the court; hence the suit.
- The defendants' side as on the record (the department's reply; conceding heirs; ex-parte).
- Evidence: PW-1, PW-2; allotment letter, death certificate, FRC, receipts / challans, the department's letter, with the exhibit numbers on the record.
- Discussion: death, legal heirs, the deceased's title in the department's record, devolution on all legal heirs according to their Shari shares; names in the FRC vs the plaint and the allotment record (any difference goes in NOTES); minors' shares protected through the Guardian Court (as in the inherited-vehicle type).
- RELIEF:- declaration that the plaintiffs and defendants No.<..> are the legal heirs of the deceased and entitled to the plot / shop No.<..> according to their Shari shares; "the defendant department is directed to enter the names of the legal heirs of the deceased in its record against the plot / shop in question as per their Shari shares, subject to payment of the Government dues (if any) and completion of codal formalities." Then the standard closing lines.` },
  "Cancellation of agreement to sell + possession (seller's suit)": { base: "Civil suit", cond: true,
    condWho: "the plaintiff (seller), for payment to the defendant", condWhat: "the amount received under the agreement (earnest money / part payment)",
    hint: "e.g. suit decreed ex-parte subject to deposit of Rs.500,000 by the plaintiff within one month, failing which the suit shall stand dismissed; mesne profits declined",
    docs: "Agreement to sell / legal notice / revenue record",
    guide: `TYPE TEMPLATE: SELLER'S SUIT FOR CANCELLATION OF AGREEMENT TO SELL AND POSSESSION (ex-parte, conditional decree)
- "SUIT FOR CANCELLATION OF AGREEMENT TO SELL DATED <..> AND POSSESSION" (add "AND MESNE PROFITS" when claimed). The plaintiff is the owner / seller, the defendant the buyer.
- Facts: the agreement to sell dated <..> for the suit property <description> for Rs.<..>; earnest money / part payment of Rs.<..> received; the balance Rs.<..> payable by <date>; possession delivered to the defendant under the agreement (if so); the defendant failed to pay the balance within time despite demands / legal notice; hence the suit.
- Ex-parte paragraph, POINT OF DETERMINATION ending "? OPP", ex-parte evidence (PW-1, PW-2, the agreement, the notice, the revenue record).
- Discussion: (a) execution of the agreement and the defendant's default proved; he never came forward to show readiness and willingness; the plaintiff is entitled to cancellation of the agreement and to possession; (b) a clause forfeiting the earnest money is in the nature of a penalty: under Section 74 of the Contract Act, 1872 only reasonable compensation not exceeding the amount stipulated can be awarded, and only on proof of loss; no loss was proved, so the plaintiff cannot keep the amount received; (c) under Section 38 of the Specific Relief Act, 1877, on adjudging the rescission of a contract the Court may require the party to whom the relief is granted to make the compensation to the other side which justice requires; hence the decree is conditional on the deposit set out under CONDITIONAL DECREE; (d) mesne profits: no evidence of the rate or of the loss was produced, so that relief is declined; (e) the burden-of-proof paragraph with the listed citations.
- RELIEF:- "suit of the plaintiff is hereby decreed ex-parte, subject to deposit of Rs.<amount> (Rupees <in words> only) by <who> in the Court within <period> from today, for payment to the defendant. On such deposit, the agreement to sell dated <..> shall stand cancelled and the defendant shall hand over the vacant possession of the suit property to the plaintiff. The defendant shall be at liberty to withdraw the deposited amount. The claim of mesne profits is declined. In case <who> fails to deposit the said amount within the stipulated period, <consequence>." Use the CONDITIONAL DECREE details of the case data exactly. Then the standard closing lines.` },
  "Ejectment petition (PRPA 2009): ex-parte order": { base: "Rent / ejectment petition",
    hint: "e.g. ejectment petition accepted ex-parte; respondent to vacate within 30 days and pay arrears of rent from 01.2025 to 12.2025 at Rs.10,000 per month",
    guide: `TYPE TEMPLATE: EJECTMENT PETITION UNDER THE PUNJAB RENTED PREMISES ACT, 2009 (ex-parte; decided by an ORDER)
HEADING (court lines bold and centred):
THE COURT OF <JUDGE NAME IN CAPITALS>,
CIVIL JUDGE 1st CLASS/JUDGE RENT TRIBUNAL,
<DISTRICT IN CAPITALS>.
Rent Petition No.<..>/<yyyy> (as written on the file)
Date of Institution: <..>
Date of Decision: <..>
**<Landlord>** S/O <..>, caste <..>, R/O <..>.
**Petitioner/Landlord**
**VERSUS**
**<Tenant>** S/O <..>, caste <..>, R/O <..>.
**Respondent/Tenant**
EJECTMENT PETITION UNDER SECTION 15 OF THE PUNJAB RENTED PREMISES ACT, 2009.
<dd.mm.yyyy>
Present.  Mr. <name> Advocate, learned counsel for the petitioner.
          Respondent already ex-parte.
ORDER:
- "Through this order, I intend to dispose of the ejectment petition filed by the petitioner/landlord against the respondent/tenant." Then the facts: the premises, the tenancy (oral / written rent agreement dated <..>), the monthly rent, the ground under Section 15 (default since <..>, personal need ...); hence the petition.
- Service and ex-parte: summoned through <modes on the record> but did not appear; proceeded against ex-parte on <date>.
- Evidence: the petitioner appeared as AW-1 and produced <name> as AW-2; documents Exh.A-.. / Mark-A (rent agreement, registration of the tenancy at the Police Khidmat Markaz, ownership documents).
- "Arguments heard. Record perused."
- Discussion: relationship of landlord and tenant proved (rent agreement / registration at the Police Khidmat Markaz / unrebutted statement on oath); default: "The petitioner has stated on oath that the respondent has not paid the rent since <..>. Payment of rent is a fact within the special knowledge of the tenant; once the landlord states on oath that the rent was not paid, the onus shifts upon the tenant to prove the payment, which the respondent did not even attempt as he chose to remain ex-parte." (no citation unless a listed case fits); the evidence is unrebutted.
- Decision: "the ejectment petition is accepted ex-parte. The respondent/tenant is directed to vacate the premises in question and hand over its vacant possession to the petitioner/landlord within <days as given; otherwise ____> days. The respondent shall also pay the arrears of rent from <..> to <..> at the rate of Rs.<..> per month, amounting to Rs.<..>." (arrears only when claimed and proved; security adjusted only if the record shows one).
- "No order as to costs. File be consigned to the record room after its due completion and compilation."
Then "Announced:" with the date, the Judge's name and "Civil Judge 1st Class/Judge Rent Tribunal, <District>". No certificate.` },
  "Withdrawal of sale proceeds (partition after auction)": {
    hint: "e.g. application accepted; Rs.1,250,000 (1/4 share) be released to the applicant after verification of his CNIC",
    guide: `TYPE TEMPLATE: ORDER ON AN APPLICATION FOR WITHDRAWAL OF DEPOSITED SALE PROCEEDS (partition suit; the property was sold by auction)
- The heading of ORDERS ON APPLICATIONS; title e.g. "APPLICATION FOR RELEASE OF THE SHARE OF THE APPLICANT OUT OF THE SALE PROCEEDS".
- Background: the partition suit was decreed on <date>; the property, not capable of partition by metes and bounds, was put to auction under the Partition Act, 1893 and sold to <purchaser> for Rs.<..>; the sale was confirmed on <date>; the sale proceeds were deposited in the Court's account on <date>.
- The application: the applicant <name>, a co-sharer, prays for release of his share.
- Reports: "Report of the Ahlmad was requisitioned, according to which <amount deposited, earlier withdrawals, each co-sharer's share as per the decree>." and "Report of the Naib Nazir was also called, who reported that <amount available in the account>." Take the figures from the reports exactly; any difference between the reports goes in NOTES.
- Notice to / no objection of the other co-sharers as on the record. "Arguments heard. Record perused."
- Decision: the applicant is entitled to Rs.<figures> (Rupees <in words> only), being his <fraction> share. "The Naib Nazir is directed to release the amount of Rs.<figures> (Rupees <in words> only) to the applicant <name> S/O <..>, holder of CNIC No.<..>, after due verification of his identity and obtaining his receipt." Amounts always in figures AND words. Use the amount given by the stenographer; if only the share and the total are given, work it out and say in NOTES that the figure must be checked. A minor's share is released only as the Guardian Court permits.
- Last line as the instructions say ("Now, to come up for <purpose> on <date>." or the file consigned). Announced; no certificate.` },
  "Amendment to add partition (O.VI R.17)": {
    hint: "e.g. application accepted subject to costs of Rs.2000; amended plaint with the partition relief within 7 days; now to come up for amended written statement",
    guide: `TYPE TEMPLATE: ORDER ON AN APPLICATION UNDER ORDER VI RULE 17 CPC TO ADD THE RELIEF OF PARTITION IN A SUIT FOR DECLARATION OF INHERITANCE
- The heading of ORDERS ON APPLICATIONS. Facts: the suit for declaration (inheritance of the deceased <name>) is pending; the plaintiff seeks to amend the plaint to add the relief of partition of the inherited / joint property; the proposed amendments i., ii. ...; the reply of the defendants.
- "Arguments heard. Record perused."
- Reasoning: amendment is allowed liberally to decide the real controversy and avoid multiplicity of proceedings, if the nature of the suit is not changed and no injustice is done (listed case under "Amendment of pleadings ... liberal approach"); partition flows from the declaration of inheritance and can be added by amendment (listed cases under "Partition added by amendment"); limitation does not run against a claim of inheritance (listed case under "No limitation against inheritance"); a late amendment is examined for delay, bona fides and prejudice (listed case under "Late amendment", only when the stage is late); a partition decree is passed and executed under Order XX Rule 18 CPC read with the Partition Act, 1893.
- Decision (when accepted), with the conditions written out as i., ii. ...:
  i. the plaintiff shall affix the requisite court fee on the relief of partition;
  ii. the valuation of the amended suit must remain within the pecuniary jurisdiction of this Court, otherwise the plaint shall be returned under Order VII Rule 10 CPC for presentation before the competent court;
  iii. all co-sharers / legal heirs shall be impleaded as parties under Order I Rule 10 CPC, if not already on the record;
  iv. complete particulars of the joint property (khewat, khatooni, khasra Nos., area, share of each co-sharer) shall be given in the amended plaint;
  v. the amended plaint shall be filed within <days given; otherwise ____> and the defendants shall be at liberty to file amended written statement(s);
  vi. costs of Rs.<..>/- (only when the decision imposes costs).
- Last line: "Now, to come up for submission of amended plaint / amended written statement on <date>." Announced; no certificate.` },
  "Identification parade": {
    guide: `TYPE TEMPLATE: IDENTIFICATION PARADE (these points add to the jail format in the STYLE GUIDE)
- Date and time of the parade: from the IDENTIFICATION PARADE DETAILS in the case data; if not given there, from the Magistrate's order on the police application; else "____".
- I.O: from the details; else from the Magistrate's order; else from the FIR's endorsement (the "مرتبہ / مرسلہ" part, the officer who wrote / sent the FIR); else "____".
- Assistant Superintendent Jail: the name in the details; else from the record; else "____" with a note.
- One block for each suspect, headed "ROW NO.1 (SUSPECT <NAME>)", "ROW NO.2 (SUSPECT <NAME>)" ... whenever there is more than one suspect; use the serial number given for each suspect.
- From ROW NO.2 onwards, a witness who already made his statement in an earlier row is recorded as: "He reiterated the same statement as recorded above."
- A witness who failed: "He failed to identify the suspect." A witness who pointed at a dummy: "He failed to identify the suspect and put his hand on the head of a dummy sitting at Serial No.<n>."
- Objection of a suspect, in Urdu exactly as given: "At this stage, the suspect raised an objection that: <Urdu>" followed by "The impact of such objection will be adjudged by the trial court and I do not deem it proper to comment on it."
- CONCLUSION: one sentence per witness for each suspect, following the results exactly: "The complainant <name> has rightly identified the suspect <name>." / "The witness <name> failed to identify the suspect <name>." / "The witness <name> failed to identify the suspect <name> and pointed out a dummy sitting at Serial No.<n>." Never write that a witness identified a suspect when the results say otherwise.
- A suspect aged 18 or under: say so in NOTES (age proof to be checked; Juvenile Justice System Act, 2018), not in the report.
- Then the CERTIFICATE and the disposal order as in the STYLE GUIDE.` }
};
const typeBase = st => TYPE_INFO[st]?.base || st;
const isRent = st => /Rent|Ejectment/.test(st || "");

/* ---------- Sections and their types ---------- */
const SECTIONS = {
  order: {
    label: "Order", desc: "Daily order sheet: upload the previous order, then write the next one or just tick a box.",
    subtypes: ["Daily order"], fields: [], opt: []
  },
  issues: {
    label: "Issues", desc: "Framing of issues from the plaint and the written statement.",
    subtypes: ["Framing of issues", "Issues + TI application decision", "Additional issue", "Recasting of issues", "Family suit issues (pre-trial failed)"],
    fields: ["date", "nextDate"], opt: ["title", "cms", "caseNo", "present"],
    guide: `Issues order. "Out of the divergent pleadings of the parties, the following issues are framed:-" numbered issues, each a question ending "? OPP" or "? OPD" (or OPD-<no>); the preliminary objections of the written statement become OPD issues (cause of action, maintainability, Order VII Rule 11 CPC, clean hands, limitation, special costs S.35-A CPC); the last issue is "Relief." Close with the standard closing sentence of the STYLE GUIDE. If a TI application is also decided, write that ORDER first (facts, reply, the three ingredients, lis pendens S.52 TPA, tentative observations) and then the ISSUES.`
  },
  misc: {
    label: "Misc Application", desc: "Orders on applications: accepted, dismissed, or accepted with costs.",
    groups: [
      ["Orders: civil suits", ["Temporary injunction (O.XXXIX R.1&2)", "Restoration of suit (O.IX R.9)", "Setting aside ex-parte (O.IX R.13 / R.7)", "Amendment of pleadings (O.VI R.17)", "Amendment to add partition (O.VI R.17)", "List of witnesses (O.XVI R.1)", "Substitute / additional witness", "Summoning of witness / record", "Impleadment (O.I R.10)", "Legal heirs on record (O.XXII)", "Rejection of plaint (O.VII R.11)", "Return of plaint (O.VII R.10)", "Local commission (O.XXVI)", "Condonation of delay (S.5 Limitation)", "Stay of suit (S.10 CPC)", "Review (O.XLVII)", "Application u/s 12(2) CPC", "Guardian ad litem (O.XXXII)", "Article 76 / 84 Qanun-e-Shahadat"]],
      ["Orders: execution and deposits", ["Execution objections (O.XXI R.58)", "Execution sine die / court representative", "Withdrawal of sale proceeds (partition after auction)"]],
      ["Orders: family, guardian, succession", ["Interim maintenance (S.17-A Family Courts Act)", "Meeting schedule / interim custody", "Succession: surety bond"]],
      ["Other", ["Other application"]]
    ],
    fields: ["date", "nextDate"], opt: ["title", "cms", "caseNo", "present"],
    guide: `Order on an application. Follow ORDERS ON APPLICATIONS in the STYLE GUIDE, using the specific rules for this type of application where the guide has them; otherwise reason under the provision named in the type. End with the decision and the next date.`
  },
  judgment: {
    label: "Judgment", desc: "Final judgments in civil, family, rent, guardian and succession cases.",
    groups: [
      ["Civil Judgment", ["Civil suit", "Permanent injunction: owner in possession", "Declaration of heirship: inherited vehicle", "Declaration of heirship: housing scheme plot / shop", "Cancellation of agreement to sell + possession (seller's suit)"]],
      ["Rent", ["Rent / ejectment petition", "Ejectment petition (PRPA 2009): ex-parte order"]],
      ["Family, guardian, succession", ["Family suit", "Guardian petition", "Succession petition"]],
      ["Execution", ["Execution final order"]]
    ],
    stages: ["Ex-parte", "Contested (issue-wise)", "Point of determination", "Compromise (issues framed)", "Conceding statements", "Order XVII Rule 3 CPC (want of evidence)"],
    fields: ["date"], opt: ["title", "cms", "caseNo", "instDate", "present"],
    points: true,
    guide: `Final judgment. Follow the STYLE GUIDE for this case type, shaped by the stage chosen: Ex-parte (ex-parte paragraphs, point of determination, burden of proof), Contested (issues as framed, issue-wise findings), Point of determination (a contested case decided on a point of determination), Compromise (issues framed; Order XXIII Rule 3 and Order XII Rule 6 CPC; decree in terms of the compromise), Conceding statements (proof under Order VIII Rule 5 CPC), Order XVII Rule 3 CPC (want of evidence, as described in the STYLE GUIDE). Discuss each witness's examination-in-chief and cross-examination. Where a TYPE TEMPLATE is given for this type, follow it for the structure and the relief.`
  },
  criminal: {
    label: "Criminal (Sec-30)", desc: "Criminal orders and judgments as Magistrate Section-30.",
    groups: [
      ["Magistrate: trial", ["Charge (framing of charge)", "Statement u/s 342 Cr.P.C", "Challan judgment (conviction / acquittal)", "Section 512 Cr.P.C (absconding accused, file consigned)", "Section 249 Cr.P.C", "Section 249-A Cr.P.C acquittal"]],
      ["Magistrate: bail, remand, police reports", ["Bail (S.497 Cr.P.C)", "Remand (S.167 Cr.P.C)", "Cancellation / discharge report (S.173 / 63)", "Private complaint (S.200 / 202 / 203)", "Proclamation (S.87 / 88)"]],
      ["Magistrate: case property and identification", ["Superdari (S.516-A Cr.P.C)", "Identification parade"]],
      ["Other", ["Other criminal order"]]
    ],
    fields: ["date", "nextDate"], opt: ["title", "cms", "caseNo", "present"],
    points: true,
    guide: `Magistrate Section-30 work. Charge: formal charge "I, <judge>, Magistrate Section-30, do hereby charge you ..." with date, time, place, offence and section, "and I hereby direct that you be tried by this court on the said charge", and the accused's plea. Statement u/s 342: questions put to the accused on each piece of incriminating evidence with the answers; the last questions on why the case was made and whether he wants to produce defence evidence / make a statement on oath under S.340(2). Challan judgment: prosecution case, charge, PWs and exhibits, the 342 statement, arguments, discussion, then conviction with sentence / fine and the benefit of S.382-B, or acquittal with release and surety discharged; case property. Section 512: accused absconding, proceedings u/s 87/88 complete, evidence recorded if any, perpetual non-bailable warrants, file consigned to the record room to be revived on arrest. Bail: grounds, further inquiry, offence outside the prohibitory clause, recovery, bail with surety bonds of Rs.<..>. Section 249: proceedings stopped. Section 249-A: no probability of conviction, acquittal. Superdari and identification parade: as in the STYLE GUIDE.`
  }
};
// A section with groups gets its flat list of types from them (the order of the groups is the order of the list).
Object.values(SECTIONS).forEach(S => { if (S.groups) S.subtypes = S.groups.flatMap(g => g[1]); });
/* Type choices, grouped (Civil Judgment / Rent / Orders / Magistrate ...). */
function subtypeOptions(S, sel) {
  const opt = t => `<option${t === sel ? " selected" : ""}>${esc(t)}</option>`;
  return S.groups ? S.groups.map(([label, list]) => `<optgroup label="${esc(label)}">${list.map(opt).join("")}</optgroup>`).join("") : S.subtypes.map(opt).join("");
}
const FIELD_DEF = {
  title: ["Case title", "e.g. Hina Ehsan VS. Muhammad Aslam etc.", "input", true],
  cms: ["CMS No.", "", "input"],
  caseNo: ["Suit / petition / FIR No.", "e.g. 253/2020 or FIR 812/2026 U/S ... P/S ...", "input"],
  instDate: ["Date of institution", "dd.mm.yyyy", "input"],
  date: ["Date of order / decision", "dd.mm.yyyy", "input"],
  present: ["Present", "Counsel names, ex-parte, nemo ...", "textarea", true],
  decision: ["Decision / order", "e.g. application accepted subject to costs of Rs.1500; suit decreed ...", "textarea", true],
  nextDate: ["Next date (if any)", "dd.mm.yyyy", "input"],
  nextPurpose: ["Purpose of next date", "e.g. evidence of the plaintiff", "input"],
  instructions: ["Special instructions", "e.g. discuss the cross-examination; do not name the witnesses", "textarea", true]
};
const DECISIONS = ["", "Decreed / allowed", "Dismissed", "Partly", "Affirmative", "Negative", "Conviction", "Acquittal"];

/* ---------- Courts: picked from the case type, designations kept in Settings ---------- */
const DEFAULT_COURTS = { civil: "Civil Judge 1st Class", family: "Judge Family Court", rent: "Civil Judge 1st Class/Judge Rent Tribunal", guardian: "Guardian Judge", magistrate: "Magistrate Section-30" };
const OLD_RENT_COURT = "Special Judge Rent Tribunal/Civil Judge 1st Class";   // the earlier default; a saved copy of it follows the new default
const DEFAULT_ASJ = "Muhammad Shafi\nMumtaz Hussain";
const COURT_KINDS = [["civil", "Civil"], ["family", "Family"], ["rent", "Rent"], ["guardian", "Guardian"], ["magistrate", "Magistrate"]];
const DEFAULT_CHIPS = "EV = evidence\nAR = arguments\nSEEK = seeks an adjournment\nPRES = present\nABS = absent\nPW = PWs\nWS = written statement";
let settings = { judge: "Mian Ijaz Ahmad", district: "Rahim Yar Khan", courts: { ...DEFAULT_COURTS }, rules: "Always spell the Judge's name as 'Mian Ijaz Ahmad' (never 'Ahmed').", chips: DEFAULT_CHIPS, ada: "", adpp: "", caseLaw: "", asJail: DEFAULT_ASJ, debug: false };
/* The law officers attached to the court, for the Present block and wherever the State is represented. */
function officersLine() {
  const o = [], nm = v => v.trim().replace(/,?\s*(the\s+)?learned\s+(ADA|DDA|ADPP|DPP)\b.*$/i, "").trim();
  if (settings.ada?.trim()) o.push(`ADA / DDA (law officer for the Government in civil matters): ${nm(settings.ada)}`);
  if (settings.adpp?.trim()) o.push(`ADPP (public prosecutor for the State in criminal matters): ${nm(settings.adpp)}`);
  return o.length ? `Law officers of this court: ${o.join("; ")}. Always write the designation first and then the name: "Learned ADPP <name> for the State." and "Learned ADA <name> for the Government." (or "Learned DDA <name> ..." when the order sheet says DDA); never "<name>, learned ADPP". Later in the same order write only "learned ADPP" / "learned ADA". Use them only where the record or the stenographer's words show that the ADA / DDA or the ADPP appeared or is concerned (for example in the Present block of a criminal case, or a civil case in which the Government is a party); never add them to a case where the State is not represented.` : "";
}
function autoKind(sec, st) {
  if (sec === "criminal" || /criminal/i.test(st)) return "magistrate";
  if (/family|maintenance|pre-trial/i.test(st)) return "family";
  if (/rent|ejectment/i.test(st)) return "rent";
  if (/guardian|custody|meeting/i.test(st)) return "guardian";
  return "civil";
}
function courtName(kind) { return settings.courts[kind] || DEFAULT_COURTS[kind]; }

/* ---------- Upload boxes: one numbered box per document, by section, type and stage ---------- */
const SL = (key, label, req) => ({ key, label, req: !!req });
const OTHER = SL("other", "Other documents");
function getSlots() {
  const sec = current.section, st = current.subtype, stage = current.stage || "";
  const exparte = /ex-parte/i.test(stage);
  if (sec === "order") return [SL("orders", "Previous order sheet", 1), OTHER];
  if (sec === "issues") {
    const s = [SL("plaint", "Plaint", 1), SL("ws", "Written statement", 1)];
    if (/TI/.test(st)) s.push(SL("tiapp", "TI application (O.XXXIX)"), SL("tireply", "Reply to TI application"));
    if (/Additional|Recasting/.test(st)) s.push(SL("issues", "Issues already framed"));
    return [...s, SL("orders", "Order sheet"), OTHER];
  }
  if (sec === "misc") {
    if (/Withdrawal of sale proceeds/.test(st)) return [SL("app", "Application for release of share", 1), SL("reports", "Ahlmad and Naib Nazir reports", 1), SL("decree", "Partition decree / auction and sale confirmation orders"), SL("reply", "Objections of other co-sharers"), SL("orders", "Order sheet"), OTHER];
    if (/add partition/.test(st)) return [SL("app", "Application u/O VI R.17 with proposed amendments", 1), SL("reply", "Reply / objections"), SL("main", "Plaint / written statement"), SL("orders", "Order sheet"), OTHER];
    return [SL("app", "Application", 1), SL("reply", "Reply / objections"), SL("main", "Plaint / main case papers"), SL("docs", "Annexed documents"), SL("orders", "Order sheet"), OTHER];
  }
  if (sec === "judgment") {
    let first = "Plaint", reply = "Written statement", docs = TYPE_INFO[st]?.docs || "Documents / exhibits";
    if (/Family/.test(st)) docs = "Nikahnama / documents / exhibits";
    if (isRent(st)) { first = "Ejectment petition"; reply = "Reply / leave to contest"; docs = "Rent agreement / Police Khidmat Markaz registration / ownership documents"; }
    if (/PRPA 2009/.test(st)) return [SL("plaint", first, 1), SL("orders", "Order sheet (service, ex-parte)", 1), SL("pw", "Petitioner's evidence (AW statements / affidavits)", 1), SL("docs", docs), OTHER];
    if (/Guardian|Succession/.test(st)) { first = "Petition"; reply = "Reply / objections"; }
    if (/Execution/.test(st)) return [SL("app", "Execution petition", 1), SL("decree", "Decree / judgment"), SL("reply", "Objections"), SL("orders", "Order sheet"), OTHER];
    const s = [SL("plaint", first, 1)];
    const contested = /Contested/i.test(stage), needEv = contested || exparte || /Point of determination/i.test(stage);
    if (!exparte) s.push(SL("ws", reply, contested));
    s.push(SL("orders", "Order sheet / issues / compromise statements", 1), SL("pw", "Plaintiff's evidence (PW statements + cross)", needEv));
    if (!exparte) s.push(SL("dw", "Defendant's evidence (DW statements + cross)"));
    return [...s, SL("docs", docs), OTHER];
  }
  const FIR = SL("fir", "FIR", 1), CH = SL("challan", "Challan / report u/s 173"), PW = SL("pw", "Court statements of PWs + cross"), OS = SL("orders", "Order sheet");
  if (/^Charge/.test(st)) return [FIR, CH, SL("s161", "Statements u/s 161 Cr.P.C"), OTHER];
  if (/342/.test(st)) return [FIR, CH, SL("charge", "Charge"), PW, SL("docs", "Recovery memos / documents"), OTHER];
  if (/Challan judgment/.test(st)) return [FIR, CH, SL("charge", "Charge"), PW, SL("s342", "Statement u/s 342 Cr.P.C"), SL("docs", "Recovery memos / documents / reports"), OS, OTHER];
  if (/512/.test(st)) return [FIR, CH, SL("proc", "Proclamation proceedings (S.87/88)"), PW, OS, OTHER];
  if (/Bail/.test(st)) return [SL("app", "Bail application", 1), FIR, SL("record", "Police record / report"), OTHER];
  if (/249/.test(st)) return [SL("app", "Application", 1), FIR, CH, PW, OS, OTHER];
  if (/Remand/.test(st)) return [SL("app", "Remand application", 1), FIR, SL("zimni", "Zimni / police record"), OTHER];
  if (/Cancellation/.test(st)) return [SL("report", "Police report (cancellation / discharge)", 1), FIR, SL("comp", "Complainant's statement / objections"), OTHER];
  if (/Private complaint/.test(st)) return [SL("app", "Private complaint", 1), SL("prelim", "Preliminary evidence / statements"), SL("inq", "Inquiry report"), OTHER];
  if (/Proclamation/.test(st)) return [SL("app", "Police application / report", 1), FIR, OTHER];
  if (/Superdari/.test(st)) return [SL("app", "Superdari application", 1), FIR, SL("record", "Police report"), SL("docs", "Ownership documents (registration / receipt)"), OTHER];
  if (/Identification/.test(st)) return [SL("app", "Police application", 1), SL("order", "Magistrate's order (date / time of parade)"), SL("fir", "FIR"), SL("forms", "Parade forms"), SL("stm", "Witness statements"), OTHER];
  return [SL("app", "Application / report", 1), FIR, OS, OTHER];
}

/* ---------- State ---------- */
const teamApi = ctx.teamApi;
let sample = ctx.sample, downloads = ctx.downloads, uid = ctx.profile.id, col = ctx.col;
let members = {};   // user id -> name, for "saved by" in History
let cases = [], lessons = [], samples = [], digests = {};
const enc = new TextEncoder();
const bytes = s => enc.encode(String(s)).length;
const PROMPT_LIMIT = 240 * 1024;
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
let view = "order", current = null, images = [], ctl = null, imgMax = 10;

/* ---------- Side panel ---------- */
function setRail(open) {
  $("#app").classList.toggle("rail-closed", !open);
  $("#railOpen").hidden = open;
  try { localStorage.setItem("fd_rail", open ? "open" : "closed"); } catch (e) {}
}
$("#railClose").addEventListener("click", () => { setRail(false); $("#railOpen").focus(); });
$("#railOpen").addEventListener("click", () => { setRail(true); $("#railClose").focus(); });

/* ---------- Navigation ---------- */
const stash = {};
let drafting = false, reading = false;
let readBatch = 0;   // pictures per "Read record" request; halved after the server time limit is reached
/* Settings (court, drafting, samples, team) are one page with tabs, opened from the Settings button; they are not
   among the sections in the side panel, which are used all day. */
const SET_TABS = ["settings", "drafting", "samples", "team"];
let lastWork = "order", lastSetTab = "settings";
try { if (SET_TABS.includes(localStorage.getItem("fd_settab"))) lastSetTab = localStorage.getItem("fd_settab"); } catch (e) {}
function show(v) {
  if (!SECTIONS[v] && v !== "history" && !SET_TABS.includes(v)) v = "order";
  const inSet = SET_TABS.includes(v), leaving = SET_TABS.includes(view) && !inSet;
  if (leaving && setDirty) toast("Your changes in Settings were not saved. Open Settings and press Save to keep them.", 7000);
  view = v;
  if (inSet) lastSetTab = v; else lastWork = v;
  $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.view === v));
  $$("[data-set]").forEach(b => { const on = b.dataset.set === v; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  $$(".setopen").forEach(b => b.classList.toggle("on", inSet));
  const isWork = !!SECTIONS[v];
  $("#workView").hidden = !isWork;
  $("#historyView").hidden = v !== "history";
  $("#setShell").hidden = !inSet;
  $("#settingsView").hidden = v !== "settings";
  $("#draftingView").hidden = v !== "drafting";
  $("#samplesView").hidden = v !== "samples";
  $("#teamView").hidden = v !== "team";
  if (isWork) {
    // Each section keeps its own unfinished work, so moving to another section and back loses nothing.
    if (current) stash[current.section] = { current, images };
    if (!current || current.section !== v) { const s = stash[v]; if (s) { current = s.current; images = s.images; renderWork(); } else newCase(v); }
    else renderWork();
  }
  if (v === "history") renderHistory();
  if (v === "samples") renderSamples();
  if ((v === "settings" || v === "drafting") && !setDirty) renderSettings();
  if (v === "drafting") renderRules();
  if (v === "team") renderTeam();
  try { localStorage.setItem(inSet ? "fd_settab" : "fd_view", v); } catch (e) {}
  scrollToTop();
}
/* Back to the top of the content; on phones also slide the menu so the chosen item is in view. */
function scrollToTop() {
  window.scrollTo(0, 0); $("#main").scrollTop = 0;
  if (matchMedia("(max-width:820px)").matches) $(".nav.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
$$(".nav").forEach(n => n.addEventListener("click", () => show(n.dataset.view)));
$$(".setopen").forEach(b => b.addEventListener("click", () => show(SET_TABS.includes(view) ? view : lastSetTab)));
$$("[data-set]").forEach(b => b.addEventListener("click", () => show(b.dataset.set)));
$("#setBack").addEventListener("click", () => show(lastWork));

/* ---------- Work view ---------- */
function blankCase(section) {
  const st0 = SECTIONS[section].subtypes[0], k0 = autoKind(section, st0);
  return { id: null, section, subtype: st0, stage: SECTIONS[section].stages?.[0] || "", courtKind: k0, court: courtName(k0), found: [], missing: [], questions: [], needCheck: false, readDone: false, dateAuto: true,
    f: { title: "", cms: "", caseNo: "", instDate: "", date: today(), present: "", decision: "", nextDate: "", nextPurpose: "", instructions: "" },
    o: { text: "", date: today(), next: "", same: false, lo: false, loCost: false, loWarn: false, cost: "" },
    cond: blankCond(st0), idp: { date: "", time: "", io: "", asj: "", witnesses: [], rows: [] },
    notes: "", summary: "", flags: [], points: [], draft: "", draftNotes: "", prevDraft: "" };
}
/* Conditional decree: on by default for the types that always end in one (e.g. the seller's suit). */
function blankCond(st) { const t = TYPE_INFO[st]; return { on: !!t?.cond, amount: "", period: t?.cond ? "one month" : "", who: "", consequence: "", asked: false, touched: false }; }
function condAllowed() { return current.section === "judgment" && typeBase(current.subtype) === "Civil suit"; }
function isIdParade() { return current.section === "criminal" && /Identification/.test(current.subtype); }
function newCase(section) {
  current = blankCase(section || view); images = [];
  renderWork();
}
$("#newCase").addEventListener("click", () => newCase(view));

/* The hint inside the order box follows the section and type, so the example always fits the work in hand. */
function decisionHint() {
  const sec = current.section, st = current.subtype;
  if (TYPE_INFO[st]?.hint) return TYPE_INFO[st].hint;
  if (sec === "issues") return /TI/.test(st) ? "e.g. TI application dismissed; issues be framed; now to come up for evidence of the plaintiff" : "e.g. frame the issues; now to come up for evidence of the plaintiff";
  if (sec === "misc") return "e.g. application accepted subject to costs of Rs.1500; now to come up for evidence of the plaintiff";
  if (sec === "judgment") {
    if (/Family/.test(st)) return "e.g. dissolution decreed on the basis of khula; maintenance of minor Rs.5000 per month with 10% annual increase; dowry articles declined";
    if (isRent(st)) return "e.g. ejectment petition accepted; respondent to vacate within 30 days and pay the arrears of rent";
    if (/Guardian/.test(st)) return "e.g. petition accepted; petitioner appointed guardian of the minor";
    if (/Succession/.test(st)) return "e.g. petition accepted; succession certificate be issued subject to surety bond";
    if (/Execution/.test(st)) return "e.g. decree satisfied; execution petition consigned to the record room";
    return "e.g. issue No.1 in favour of the plaintiff, issue No.2 against the defendant; suit decreed with no order as to costs";
  }
  if (/^Charge/.test(st)) return "e.g. frame the charge u/s 379 PPC against both accused; accused pleaded not guilty; now to come up for prosecution evidence";
  if (/342/.test(st)) return "e.g. record the statement u/s 342 Cr.P.C; accused does not want to produce defence evidence; now to come up for final arguments";
  if (/Challan judgment/.test(st)) return "e.g. accused acquitted by giving benefit of doubt; or: convicted u/s 379 PPC, 6 months imprisonment and fine of Rs.5000";
  if (/512/.test(st)) return "e.g. accused declared proclaimed offender; perpetual warrant issued; file consigned to the record room";
  if (/Bail/.test(st)) return "e.g. bail allowed subject to bail bonds of Rs.100,000 with one surety; or: bail dismissed";
  if (/249/.test(st)) return "e.g. application accepted, accused acquitted; or: application dismissed, now to come up for prosecution evidence";
  if (/Remand/.test(st)) return "e.g. 2 days physical remand granted; or: accused sent to judicial lock-up, challan be submitted";
  if (/Cancellation/.test(st)) return "e.g. agreed with the cancellation report; or: disagreed, SHO to submit the challan";
  if (/Private complaint/.test(st)) return "e.g. accused summoned u/s 379 PPC; or: complaint dismissed u/s 203 Cr.P.C";
  if (/Proclamation/.test(st)) return "e.g. proclamation u/s 87 Cr.P.C issued against the accused";
  if (/Superdari/.test(st)) return "e.g. superdari allowed subject to surety bond of Rs.500,000; or: application dismissed";
  if (/Identification/.test(st)) return "e.g. both witnesses identified the suspect; parade held on 10.11.2026 at 10:00 a.m.";
  return "e.g. application accepted; or: application dismissed; now to come up for further proceedings";
}
function renderCourt() {
  current.courtKind = autoKind(current.section, current.subtype);
  current.court = courtName(current.courtKind);
}

function renderWork() {
  const S = SECTIONS[current.section], isOrder = current.section === "order";
  $("#wTitle").textContent = S.label;
  $("#orderCard").hidden = !isOrder; $("#cardType").hidden = isOrder; $("#cardPics").hidden = isOrder; $("#cardFields").hidden = isOrder;
  $("#draftTitle").textContent = isOrder ? "3. Order" : "3. Draft";
  $("#draftBtn").textContent = isOrder ? "Generate order" : "Generate draft";
  if (isOrder) renderOrderCard();
  else {
    $("#f_subtype").innerHTML = subtypeOptions(S, current.subtype);
    $("#stageWrap").hidden = !S.stages;
    if (S.stages) $("#f_stage").innerHTML = S.stages.map(s => `<option${s === current.stage ? " selected" : ""}>${esc(s)}</option>`).join("");
    renderCourt();
    const fieldHtml = k => {
      const [lab, ph, kind, wide] = FIELD_DEF[k];
      const ctrl = kind === "textarea" ? `<textarea id="f_${k}" rows="2" placeholder="${esc(ph)}">${esc(current.f[k])}</textarea>`
        : k === "nextDate" ? dateField(`f_${k}`, current.f[k], ph)
        : `<input id="f_${k}" placeholder="${esc(ph)}" value="${esc(current.f[k])}">`;
      return `<label${wide ? ' class="wide"' : ""}>${esc(lab)}${ctrl}</label>`;
    };
    $("#fields").innerHTML = S.fields.map(fieldHtml).join("");
    $("#optFields").innerHTML = S.opt.map(fieldHtml).join("");
    [...S.fields, ...S.opt].forEach(k => $("#f_" + k).addEventListener("input", e => { current.f[k] = e.target.value; if (k === "date") current.dateAuto = false; }));
    $$("#fields [data-day-target]").forEach(showWeekday);
    $("#f_decision").value = current.f.decision || ""; $("#f_decision").placeholder = decisionHint();
    renderChips(); renderSummary(); renderQuestions(); renderPoints(); renderThumbs(); renderCond(); renderIdp();
  }
  setSheet(current.draft);
  $("#draftNotesWrap").hidden = !current.draftNotes; $("#draftNotes").textContent = current.draftNotes;
  renderAfterDraft();
  status("#saveStatus", current.id ? "Saved case." : ""); status("#draftStatus", ""); status("#readStatus", "");
  renderReady();
}
$("#f_subtype").addEventListener("change", e => {
  current.subtype = e.target.value;
  if (!current.cond?.touched) current.cond = blankCond(current.subtype);
  renderCourt(); refreshMissing(); renderThumbs(); renderChips(); $("#f_decision").placeholder = decisionHint(); renderCond(); renderIdp();
});

/* ---------- Conditional decree: amount, period, who deposits, what happens on failure ---------- */
function renderCond() {
  const show = condAllowed(), c = current.cond;
  $("#condBox").hidden = !show;
  if (!show) return;
  $("#c_on").checked = !!c.on; $("#condFields").hidden = !c.on;
  ["amount", "period", "who", "consequence"].forEach(k => { $("#c_" + k).value = c[k] || ""; });
  const t = TYPE_INFO[current.subtype];
  $("#c_who").placeholder = t?.condWho ? "e.g. " + t.condWho : "e.g. the plaintiff";
}
$("#c_on").addEventListener("change", e => { current.cond.on = e.target.checked; current.cond.touched = true; $("#condFields").hidden = !e.target.checked; });
["amount", "period", "who", "consequence"].forEach(k => $("#c_" + k).addEventListener("input", e => { current.cond[k] = e.target.value; current.cond.touched = true; }));
function condText() {
  const c = current.cond, t = TYPE_INFO[current.subtype];
  if (!condAllowed() || !c?.on) return "";
  return `CONDITIONAL DECREE (write the relief as a decree subject to this deposit; say what happens on failure)
Amount to be deposited: ${c.amount.trim() ? "Rs." + c.amount.trim() + " (write it in figures and in words)" : (t?.condWhat ? t.condWhat + ", as shown by the record (if not clear, ____)" : "as shown by the record (if not clear, ____)")}
Period: ${c.period.trim() || "one month"} from the date of the decree
Who must deposit: ${c.who.trim() || t?.condWho || "the plaintiff"}
If not deposited within the period: ${c.consequence.trim() || "the suit shall stand dismissed"}`;
}

/* ---------- Identification parade: date and time, I.O, Assistant Superintendent, witnesses, one row per suspect ---------- */
const ID_RES = [["", "Result not given"], ["identified", "Identified ✓"], ["failed", "Failed ✗"], ["dummy", "Pointed at a dummy"]];
function asjNames() { return String(settings.asJail || "").split("\n").map(x => x.trim()).filter(Boolean); }
function renderIdp() {
  const show = isIdParade();
  $("#idpBox").hidden = !show;
  if (!show) return;
  const d = current.idp, W = d.witnesses;
  const inp = (k, lab, ph, extra = "") => `<label>${esc(lab)}<input data-idp="${k}" value="${esc(d[k] || "")}" placeholder="${esc(ph)}"${extra}></label>`;
  $("#idpBox").innerHTML = `<strong>Identification parade details</strong>
    <p class="note" style="margin:0">Leave a box empty to let the AI take it from the record (date and time from the Magistrate's order; I.O from the order, or from the FIR's مرتبہ / مرسلہ part).</p>
    <div class="grid">${inp("date", "Date of parade", "dd.mm.yyyy")}${inp("time", "Time", "e.g. 10:00 a.m.")}${inp("io", "I.O (name, rank)", "e.g. Muhammad Akram SI")}${inp("asj", "Assistant Superintendent Jail", "Pick or write the name", ' list="asjList"')}</div>
    <datalist id="asjList">${asjNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <strong>Identifying witnesses</strong>
    ${W.map((w, i) => `<div class="idw"><input data-w="${i}" data-k="name" value="${esc(w.name)}" placeholder="Witness ${i + 1}: name S/O ..." aria-label="Witness ${i + 1} name"><input data-w="${i}" data-k="desc" value="${esc(w.desc)}" placeholder="e.g. complainant / eye-witness" aria-label="Witness ${i + 1} description"><button type="button" class="btn danger" data-wrm="${i}" aria-label="Remove witness ${i + 1}">x</button></div>`).join("")}
    <div class="row"><button type="button" class="btn plain" id="idpAddW">+ Add witness</button></div>
    <strong>Rows (one for each suspect)</strong>
    ${d.rows.map((r, i) => {
      const young = r.age !== "" && +r.age > 0 && +r.age <= 18;
      return `<div class="idrow"><div class="rowhead"><b>ROW NO.${i + 1}</b><button type="button" class="btn danger" data-rrm="${i}">Remove row</button></div>
        <div class="grid"><label>Suspect (name, parentage)<input data-r="${i}" data-k="suspect" value="${esc(r.suspect)}"></label><label>Age (years)<input data-r="${i}" data-k="age" inputmode="numeric" value="${esc(r.age)}"></label><label>Serial No. in the row<input data-r="${i}" data-k="serial" inputmode="numeric" value="${esc(r.serial)}" placeholder="e.g. 4"></label></div>
        ${young ? `<div class="agewarn" role="note">Suspect is 18 or under: check the age proof (juvenile). This will be listed in the Notes.</div>` : ""}
        <label>Huliya (Urdu, as recorded)<textarea data-r="${i}" data-k="huliya" rows="2" dir="auto" class="urdu">${esc(r.huliya)}</textarea></label>
        <label>Objection of the suspect (Urdu, if any)<textarea data-r="${i}" data-k="objection" rows="2" dir="auto" class="urdu">${esc(r.objection)}</textarea></label>
        ${W.length ? W.map((w, j) => { const x = r.res[j] || { r: "", dummy: "" }; return `<div class="idres"><span>${esc(w.name || "Witness " + (j + 1))}</span><select data-res="${i}" data-w="${j}" aria-label="Result for ${esc(w.name || "witness " + (j + 1))}">${ID_RES.map(([v, l]) => `<option value="${v}"${v === x.r ? " selected" : ""}>${l}</option>`).join("")}</select>${x.r === "dummy" ? `<input data-dummy="${i}" data-w="${j}" value="${esc(x.dummy)}" inputmode="numeric" placeholder="Dummy No." aria-label="Dummy serial number">` : "<span></span>"}</div>`; }).join("") : `<p class="note" style="margin:0">Add the witnesses above to record each one's result.</p>`}
      </div>`;
    }).join("")}
    <div class="row"><button type="button" class="btn plain" id="idpAddR">+ Add row (suspect)</button></div>`;
  const box = $("#idpBox");
  box.querySelectorAll("[data-idp]").forEach(el => el.addEventListener("input", e => { d[e.target.dataset.idp] = e.target.value; }));
  box.querySelectorAll("[data-w][data-k]").forEach(el => el.addEventListener("input", e => { W[+e.target.dataset.w][e.target.dataset.k] = e.target.value; }));
  box.querySelectorAll("[data-r][data-k]").forEach(el => el.addEventListener("input", e => { d.rows[+e.target.dataset.r][e.target.dataset.k] = e.target.value; }));
  box.querySelectorAll("[data-r][data-k=age]").forEach(el => el.addEventListener("change", () => renderIdp()));
  box.querySelectorAll("[data-res]").forEach(el => el.addEventListener("change", e => { const r = d.rows[+e.target.dataset.res]; r.res[+e.target.dataset.w] = { ...(r.res[+e.target.dataset.w] || {}), r: e.target.value }; renderIdp(); }));
  box.querySelectorAll("[data-dummy]").forEach(el => el.addEventListener("input", e => { const r = d.rows[+e.target.dataset.dummy]; r.res[+e.target.dataset.w].dummy = e.target.value; }));
  box.querySelectorAll("[data-wrm]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.wrm; W.splice(i, 1); d.rows.forEach(r => r.res.splice(i, 1)); renderIdp(); }));
  box.querySelectorAll("[data-rrm]").forEach(b => b.addEventListener("click", () => { d.rows.splice(+b.dataset.rrm, 1); renderIdp(); }));
  $("#idpAddW").addEventListener("click", () => { W.push({ name: "", desc: "" }); renderIdp(); });
  $("#idpAddR").addEventListener("click", () => { d.rows.push({ suspect: "", age: "", serial: "", huliya: "", objection: "", res: [] }); renderIdp(); });
}
function idpHasData() { const d = current.idp; return !!(d && (d.rows.some(r => r.suspect || r.res.some(x => x?.r)) || d.witnesses.some(w => w.name))); }
function idpText() {
  if (!isIdParade()) return "";
  const d = current.idp, W = d.witnesses;
  if (!d.date && !d.time && !d.io && !d.asj && !W.length && !d.rows.length) return "";
  const wName = j => W[j]?.name?.trim() || `witness No.${j + 1}`;
  const res = (x, r) => !x?.r ? "result not given (take it from the record; if not shown, ____)"
    : x.r === "identified" ? `identified the suspect${r.serial ? ` sitting at Serial No.${r.serial}` : ""}`
    : x.r === "failed" ? "failed to identify the suspect"
    : `failed to identify the suspect and put his hand on the head of a dummy sitting at Serial No.${x.dummy || "____"}`;
  return `IDENTIFICATION PARADE DETAILS (given by the stenographer; they decide the facts below over anything else)
Date of parade: ${d.date.trim() || "not given: take it from the Magistrate's order"}
Time: ${d.time.trim() || "not given: take it from the Magistrate's order"}
I.O: ${d.io.trim() || "not given: take it from the Magistrate's order, else from the FIR (مرتبہ / مرسلہ)"}
Assistant Superintendent Jail: ${d.asj.trim() ? "Mr. " + d.asj.trim().replace(/^Mr\.?\s*/i, "") : "not given: take it from the record, else ____"}
Identifying witnesses: ${W.length ? W.map((w, j) => `${j + 1}. ${w.name.trim() || "____"}${w.desc.trim() ? " (" + w.desc.trim() + ")" : ""}`).join("; ") : "take them from the record"}
${d.rows.map((r, i) => `ROW NO.${i + 1}: suspect ${r.suspect.trim() || "____"}${r.age ? `, age about ${r.age} years` : ""}${+r.age > 0 && +r.age <= 18 ? " [18 OR UNDER: mention in NOTES]" : ""}${r.serial ? `, placed at Serial No.${r.serial}` : ""}
  Huliya (Urdu): ${r.huliya.trim() || "take it from the record"}
  Objection of the suspect: ${r.objection.trim() || "none given (record one only if the record shows it)"}
${W.map((w, j) => `  ${wName(j)}: ${res(r.res[j], r)}`).join("\n")}`).join("\n")}`.trim();
}
$("#f_stage").addEventListener("change", e => { current.stage = e.target.value; refreshMissing(); renderThumbs(); });
$("#f_decision").addEventListener("input", e => { current.f.decision = e.target.value; });

function renderReady() {
  $("#readBtn").disabled = !sample || reading; $("#draftBtn").disabled = !sample || drafting;
  $("#contBtn").hidden = drafting || !current?.cont; $("#contBtn").disabled = !sample;
  renderSamplesBusy();
}

function renderSummary() {
  $("#sumWrap").hidden = !current.summary; $("#sumText").textContent = current.summary || "";
  $("#flagsWrap").hidden = !current.flags.length;
  $("#flags").innerHTML = current.flags.map(f => `<li>${esc(f)}</li>`).join("");
}
function renderQuestions() {
  const qs = current.questions || [];
  $("#qWrap").hidden = !qs.length;
  $("#qHead").textContent = hasDecision() ? "Questions (optional: the draft is made on your decision; anything left unanswered is written as ____ and listed in the Notes)" : "Please answer (required)";
  $("#questions").innerHTML = qs.map((q, i) => `<div class="qa"><p>${i + 1}. ${esc(q.q)}</p><input data-qi="${i}" aria-label="Answer to question ${i + 1}" placeholder="Your answer" value="${esc(q.a || "")}"></div>`).join("");
  $$("#questions [data-qi]").forEach(el => el.addEventListener("input", e => { current.questions[+e.target.dataset.qi].a = e.target.value; current.needCheck = true; }));
}
function renderPoints() {
  const S = SECTIONS[current.section];
  $("#pointsWrap").hidden = !S.points || !current.points.length;
  $("#points").innerHTML = current.points.map((p, i) => `
    <div class="point">
      <p>${esc(p.label)}</p>
      <select data-pi="${i}" data-k="decision" aria-label="Decision">${DECISIONS.map(d => `<option${d === p.decision ? " selected" : ""}>${esc(d)}</option>`).join("")}</select>
      <input data-pi="${i}" data-k="note" placeholder="Amount / condition / reason" value="${esc(p.note || "")}">
    </div>`).join("");
  $$("#points [data-pi]").forEach(el => el.addEventListener("input", e => { current.points[+e.target.dataset.pi][e.target.dataset.k] = e.target.value; }));
}

/* ---------- Pictures ---------- */
/* The picture buttons also accept PDF only so that phones offer the "Camera / Files" choice; only pictures are used. */
function addImages(files, slot) {
  let other = 0;
  for (const f of files) { if (f.type.startsWith("image/")) images.push({ file: f, url: URL.createObjectURL(f), slot }); else other++; }
  if (other) toast(other === 1 ? "That file is not a picture, so it was left out. Choose a photo of the page, or take one with the camera." : `${other} files were not pictures, so they were left out. Choose photos of the pages, or take them with the camera.`);
  if (current.section === "order") renderOrderPics(); else renderThumbs();
}
function renderThumbs() {
  $("#slots").innerHTML = images.map((im, i) => `<div class="thumb"><img src="${im.url}" alt="Record page ${i + 1}"><button data-rm="${i}" aria-label="Remove">x</button></div>`).join("");
  $$("#slots [data-rm]").forEach(b => b.addEventListener("click", () => { URL.revokeObjectURL(images[+b.dataset.rm].url); images.splice(+b.dataset.rm, 1); renderThumbs(); }));
  const unread = images.filter(im => !im.read).length;
  // What to upload for this type and stage; a tick marks the documents already found in the pictures.
  const slots = getSlots().filter(s => s.key !== "other"), found = current.found || [];
  const names = list => list.map(s => found.includes(s.key) ? `<span class="got">✓ ${esc(s.label)}</span>` : esc(s.label)).join(", ");
  const reqd = slots.filter(s => s.req), opt = slots.filter(s => !s.req);
  $("#needList").innerHTML = (reqd.length ? `<div><b>Required:</b> ${names(reqd)}</div>` : "") + (opt.length ? `<div class="opt"><b>Also upload, if on the file:</b> ${names(opt)}</div>` : "");
  $("#recCnt").textContent = images.length ? images.length + (images.length === 1 ? " picture" : " pictures") : "";
  $("#recSlot").classList.toggle("filled", images.length > 0);
  $("#imgNote").textContent = images.length ? (unread ? `${unread} not read yet` : "all read") : "";
  renderMissing();
}
$("#recUp").addEventListener("change", e => { addImages(e.target.files, "all"); e.target.value = ""; });
wireDrop($("#recSlot"), files => addImages(files, "all"));

/* ---------- Missing documents: upload them, or say why they are not on the file ---------- */
function docWord() { return current.section === "judgment" ? "judgment" : current.section === "issues" ? "order" : "order"; }
function refreshMissing() {
  if (!current.readDone) { current.missing = []; return; }
  const slots = getSlots(), found = current.found || [];
  const keep = (current.missing || []).filter(m => slots.some(s => s.key === m.key) && !found.includes(m.key));
  slots.filter(s => s.req && !found.includes(s.key) && !keep.some(m => m.key === s.key)).forEach(s => keep.push({ key: s.key, why: "", reason: "" }));
  current.missing = keep;
}
function renderMissing() {
  const box = $("#missBox"), slots = getSlots(), list = (current.missing || []).filter(m => slots.some(s => s.key === m.key));
  box.hidden = !list.length;
  box.innerHTML = list.map(m => {
    const label = slots.find(s => s.key === m.key).label;
    return `<div class="miss" data-miss="${m.key}">
      <p><strong style="color:var(--warn)">${esc(label)} is missing.</strong> It is needed to complete this ${docWord()}.${m.why ? " " + esc(m.why) : ""} Upload its pictures, or write why it is not available.</p>
      <div class="row"><label class="addpic">+ Pictures<input type="file" accept="image/*,.pdf" multiple class="fileover" data-missup="${m.key}"></label></div>
      <label>Reason it is not available<input data-missreason="${m.key}" placeholder="e.g. defendant is ex-parte, no written statement was filed" value="${esc(m.reason || "")}"></label>
    </div>`;
  }).join("");
  $$("#missBox [data-missup]").forEach(inp => inp.addEventListener("change", e => {
    const before = images.length; addImages(e.target.files, "all");
    if (images.length > before) $("#readBtn").click();
  }));
  $$("#missBox [data-missreason]").forEach(inp => inp.addEventListener("input", e => {
    const m = current.missing.find(x => x.key === inp.dataset.missreason); if (m) m.reason = e.target.value;
    if (e.target.value.trim()) status("#readStatus", "");
  }));
}
/* The stenographer has stated the decision (in the order box, per point, or the parade results): then the draft is written at once. */
function hasDecision() {
  return !!norm(current.f.decision) || (current.points || []).some(p => p.decision) || (isIdParade() && idpHasData());
}
/* Before drafting: every picture must have been read. Without a decision, the questions must be answered and every missing
   document needs pictures or a reason; with a decision, nothing stops the draft: blanks are written as ____ and listed in the Notes. */
function recordReady() {
  if (images.some(im => !im.read)) { status("#readStatus", "Some pictures have not been read yet. Press Read record first.", true); $("#readBtn").scrollIntoView({ block: "center", behavior: "smooth" }); return false; }
  const decided = hasDecision();
  if (!current.readDone && !current.notes && !decided) { status("#readStatus", images.length ? "Press Read record first, or write the decision in the box above." : "Add the record pictures and press Read record, or write the decision in the box above.", true); $("#recSlot").scrollIntoView({ block: "center", behavior: "smooth" }); return false; }
  if (decided) return true;
  const slots = getSlots(), open = (current.missing || []).filter(m => slots.some(s => s.key === m.key) && !String(m.reason || "").trim());
  if ((current.questions || []).some(q => !String(q.a || "").trim())) { status("#readStatus", "Answer every question below (or write the decision in the box above), then press Read record again.", true); $("#qWrap").scrollIntoView({ block: "center", behavior: "smooth" }); return false; }
  if (current.needCheck) { status("#readStatus", "You have answered the questions. Press Read record again before generating the draft.", true); $("#readBtn").scrollIntoView({ block: "center", behavior: "smooth" }); return false; }
  if (open.length) {
    const names = open.map(m => slots.find(s => s.key === m.key).label).join(", ");
    status("#readStatus", `This ${docWord()} cannot be completed yet: ${names} ${open.length === 1 ? "is" : "are"} missing. Upload the pictures, write the reason, or write the decision in the box above.`, true);
    $("#missBox").scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }
  return true;
}
function wireDrop(el, cb) {
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("over"); cb(e.dataTransfer.files); });
}

/* On phones: if the picture chooser does not open after a tap, say what to do instead of failing silently. */
function toast(msg, ms = 9000) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}
document.addEventListener("click", e => {
  const inp = e.target;
  if (!(inp instanceof HTMLInputElement) || inp.type !== "file" || inp.disabled || !matchMedia("(pointer:coarse)").matches) return;  let opened = false;
  const mark = () => { opened = true; };
  window.addEventListener("blur", mark, { once: true });
  document.addEventListener("visibilitychange", mark, { once: true });
  inp.addEventListener("change", mark, { once: true });
  setTimeout(() => {
    window.removeEventListener("blur", mark); document.removeEventListener("visibilitychange", mark); inp.removeEventListener("change", mark);
    if (!opened) toast("The picture chooser did not open in this view. If this keeps happening, open Faisla Desk in Chrome on this phone and add the pictures there.");
  }, 2500);
}, true);

/* ---------- Order: previous order picture + next order + four boxes ---------- */
function renderOrderCard() {
  const o = current.o;
  $("#o_text").value = o.text || ""; $("#o_next").value = o.next || ""; $("#o_cost").value = o.cost || "";
  clearNextError();
  ["same", "lo", "loCost", "loWarn"].forEach(k => { $("#o_" + k).checked = !!o[k]; });
  $("#o_costWrap").hidden = !o.loCost;
  renderOrderPics(); renderChips(); showWeekday($("#o_next"));
}
/* Quick words: tap a short button to put the full words into the order box, at the cursor or at the end. */
function parseChips(s) {
  return String(s || "").split("\n").map(l => { const i = l.indexOf("="); return i > 0 ? { label: l.slice(0, i).trim().slice(0, 12), text: l.slice(i + 1).trim() } : null; }).filter(x => x && x.label && x.text).slice(0, 40);
}
/* Party A is the side that brought the case, party B the other side; their names follow the kind of case. */
function partyNames() {
  const sec = current?.section, st = current?.subtype || "";
  if (sec === "order") return ["party A", "party B"];   // the order sheet in the picture tells Claude which words to use
  if (sec === "criminal") return ["complainant", "accused"];
  if (/Execution/i.test(st)) return ["decree holder", "judgment debtor"];
  if (sec === "misc") return ["applicant", "respondent"];
  if (sec === "judgment" && (isRent(st) || /Guardian|Succession/.test(st))) return ["petitioner", "respondent"];
  return ["plaintiff", "defendant"];
}
const PARTY_CHIPS = "CPA = counsel for the {A}\nCPB = counsel for the {B}\nPA = {A}\nPB = {B}";
function renderChips() {
  const [A, B] = partyNames(), fill = t => t.replace(/\{A\}/gi, A).replace(/\{B\}/gi, B).replace(/\bthe (party [AB])\b/g, "$1");
  const mine = parseChips(settings.chips).filter(ch => !/^(CPA|CPB|PA|PB)$/i.test(ch.label));
  const html = [...parseChips(PARTY_CHIPS), ...mine].map(ch => `<button type="button" class="chipbtn" data-text="${esc(fill(ch.text))}" title="${esc(fill(ch.text))}">${esc(ch.label)}</button>`).join("");
  $("#o_chips").innerHTML = html; $("#f_chips").innerHTML = html;
}
function insertPhrase(ta, phrase) {
  const v = ta.value, focused = document.activeElement === ta;
  const start = focused ? ta.selectionStart : v.length, end = focused ? ta.selectionEnd : v.length;
  const before = v.slice(0, start), after = v.slice(end);
  if (!before.trim() || /[.!?]\s*$/.test(before)) phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  const pre = before && !/\s$/.test(before) ? " " : "", post = /^\s/.test(after) ? "" : " ";
  ta.value = before + pre + phrase + post + after;
  if (focused) { const pos = (before + pre + phrase + post).length; ta.setSelectionRange(pos, pos); }
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
// Keep the cursor (and the phone keyboard) in the order box while tapping the buttons.
[["#o_chips", "#o_text"], ["#f_chips", "#f_decision"]].forEach(([chips, box]) => {
  ["pointerdown", "mousedown"].forEach(t => $(chips).addEventListener(t, e => { if (e.target.closest(".chipbtn")) e.preventDefault(); }));
  $(chips).addEventListener("click", e => { const b = e.target.closest(".chipbtn"); if (b) insertPhrase($(box), b.dataset.text); });
});
function renderOrderPics() {
  $("#oThumbs").innerHTML = images.map((im, i) => `<div class="thumb"><img src="${im.url}" alt="Order page ${i + 1}"><button data-orm="${i}" aria-label="Remove">x</button></div>`).join("");
  $$("#oThumbs [data-orm]").forEach(b => b.addEventListener("click", () => { URL.revokeObjectURL(images[+b.dataset.orm].url); images.splice(+b.dataset.orm, 1); renderOrderPics(); }));
  $("#oCnt").textContent = images.length ? images.length + (images.length === 1 ? " picture" : " pictures") : "";
  $("#oSlot").classList.toggle("filled", images.length > 0);
}
$("#oFile").addEventListener("change", e => { addImages(e.target.files, "orders"); e.target.value = ""; });
wireDrop($("#oSlot"), files => addImages(files, "orders"));
$("#o_text").addEventListener("input", e => { current.o.text = e.target.value; });
$("#o_next").addEventListener("input", e => { current.o.next = e.target.value; clearNextError(); });
/* The order is always dated today; the next date is required, must be a real date and must be after today. */
function nextDateError(v) {
  const s = String(v || "").trim();
  if (!s) return "Please select the next date first.";
  const iso = toISO(s), d = iso ? new Date(iso + "T00:00:00") : null;
  if (!d || isNaN(d) || d.getDate() !== +iso.slice(8, 10)) return "The next date is not a valid date. Pick it from the calendar or write it as dd.mm.yyyy.";
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (d <= t) return "The next date must be after today.";
  return "";
}
function clearNextError() { $("#o_next").classList.remove("invalid"); $("#o_nextErr").hidden = true; }
function showNextError(msg) {
  const f = $("#o_next"), e = $("#o_nextErr");
  f.classList.add("invalid"); e.textContent = msg; e.hidden = false;
  try { f.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) {}
  if (!matchMedia("(pointer:coarse)").matches) f.focus({ preventScroll: true });
  status("#draftStatus", msg, true);
}
$("#o_cost").addEventListener("input", e => { current.o.cost = e.target.value; });
/* "Same order" stands alone; plain "Last opportunity" stands alone; cost and warning can be ticked together. */
function setO(k, v) { current.o[k] = v; $("#o_" + k).checked = v; }
function afterBoxes() { $("#o_costWrap").hidden = !current.o.loCost; }
$("#o_same").addEventListener("change", e => { setO("same", e.target.checked); if (e.target.checked) ["lo", "loCost", "loWarn"].forEach(k => setO(k, false)); afterBoxes(); });
$("#o_lo").addEventListener("change", e => { setO("lo", e.target.checked); if (e.target.checked) ["same", "loCost", "loWarn"].forEach(k => setO(k, false)); afterBoxes(); });
["loCost", "loWarn"].forEach(k => $("#o_" + k).addEventListener("change", e => { setO(k, e.target.checked); if (e.target.checked) ["same", "lo"].forEach(x => setO(x, false)); afterBoxes(); }));

function orderReady() {
  const o = current.o;
  if (!images.length) { status("#draftStatus", "Please upload the previous order first.", true); return false; }
  const dateErr = nextDateError(o.next);
  if (dateErr) { showNextError(dateErr); return false; }
  if (!o.same && !o.lo && !o.loCost && !o.loWarn && !(o.text || "").trim()) { status("#draftStatus", "Write the next order or tick a box.", true); return false; }
  return true;
}
function orderPrompt(examples) {
  const o = current.o, txt = (o.text || "").trim();
  const day = today(), next = fmtDate(o.next) || "____";
  const who = "the party who had to do it (as seen in the previous order)";
  const lo = [];
  if (o.lo) lo.push(`Grant LAST OPPORTUNITY to ${who} for the same purpose, e.g. "Last opportunity is granted to the plaintiff to produce his evidence."`);
  if (o.loCost) lo.push(`Grant last opportunity to ${who} SUBJECT TO PAYMENT OF COSTS of Rs.${o.cost || "____"}/-. Say to whom the costs are payable only if the previous order shows how; otherwise add no payee.`);
  if (o.loWarn) lo.push(`${o.loCost ? "In the same order" : `Grant last opportunity to ${who} and`} add the warning that the right will be closed if it is not done on the next date, worded for the stage: evidence -> "failing which his right to produce evidence shall be closed under Order XVII Rule 3 CPC"; written statement or reply -> "failing which his right to file written statement / reply shall be struck off"; arguments -> "failing which his right of arguments shall be closed and the matter shall be decided on the basis of available record"; anything else -> the nearest equivalent.`);
  let mode;
  if (o.same) mode = `SAME ORDER: reproduce the previous order word for word (the same Present block, the same body, the same purpose). Change ONLY the date of the order to ${day} and the date to which the case is adjourned to ${next}.${txt ? ` Apart from that, make only this change: ${txt}` : " Nothing else changes."}`;
  else if (!txt) mode = `REPEAT WITH LAST OPPORTUNITY: the case was fixed today for the purpose stated at the end of the previous order, and it was not done. Repeat the previous order for that same purpose, keeping its structure and wording as far as possible, and add:\n- ${lo.join("\n- ")}\nAdjourn it for the same purpose to ${next}.`;
  else mode = `NEW ORDER: write today's order from the stenographer's instructions below (they may be in Roman Urdu; write them in court English), keeping in view what the case was fixed for today. If they do not say who was present, use the Present block of the previous order.${lo.length ? "\nAlso:\n- " + lo.join("\n- ") : ""}\nInstructions: ${txt}`;
  // Only what was ticked or written goes into the order; samples and the style guide must not add warnings, costs or opportunities on their own.
  const limits = [];
  if (!o.same) {
    const unless = txt ? ", unless the stenographer's instructions ask for it" : "";
    if (!o.loWarn) limits.push(`Do NOT add any warning of consequences (no "failing which ...", no closing or striking off of any right, no Order XVII Rule 3 CPC)${unless}. The "right close warning" box was NOT ticked.`);
    if (!o.loCost) limits.push(`Do NOT impose any costs${unless}. The "cost" box was NOT ticked.`);
    if (!o.lo && !o.loCost && !o.loWarn) limits.push(`Do NOT grant a last opportunity${unless}. No last-opportunity box was ticked.`);
  }
  const strict = limits.length ? `STRICT LIMITS (from the boxes ticked for this order; they bind over every layer):\n- ${limits.join("\n- ")}` : "";
  const parts = [
    { layer: 1, src: "Built in: global rules", text: globalRules(true) },
    courtPart(null),
    { layer: 1, src: "Built in: reading the order sheet", text: `HOW TO READ THE ORDER SHEET
The attached image(s) show this case's order sheet. Read it first, without writing out what you read: the LAST (most recent) entry is the previous order. Note its Present block, what the case was fixed for today (the purpose in its last line), who had to do it, and any last opportunity, costs or warning already given.
In the stenographer's words, "party A" means the side that brought the proceedings (plaintiff / petitioner / complainant / decree holder / applicant) and "party B" the other side (defendant / respondent / accused / judgment debtor). Never write "party A" or "party B" in the order: use the exact word this order sheet uses for that side.` },
    { layer: 1, src: "Built in: daily order style", text: "STYLE GUIDE\n" + STYLE.ordersheet },
    ...styleParts("order", examples),
    ...rulesParts("order"),
    { layer: 4, src: "This case: today's order (boxes and instructions)", text: `Today's date: ${day}\nNext date: ${next}\n\nWHAT TO WRITE\n${mode}` },
    strict ? { layer: 4, src: "This case: strict limits from the boxes not ticked", text: strict } : null
  ].filter(Boolean);
  return `You write the next entry of the daily ORDER SHEET for ${settings.judge}, ${settings.district}, Punjab, Pakistan, in the Judge's style. Never invent names, dates or facts; unknown items: "____".

${joinLayers(parts)}

${limits.length ? "Before answering, check the order against the STRICT LIMITS and remove anything they forbid.\n\n" : ""}OUTPUT: only today's order, ready to write in the order sheet, ending with "Announced:" and today's date (${day}) on the line below it, and then the Judge's name and designation lines as written under the previous order (if none is visible, end with "${settings.judge}"). The Judge signs the printout by hand, so never write "[Signature]", "Sd/-", "(signed)", "[Stamp]" or anything about a stamp, seal or handwritten signature you see in the picture. No commentary. Then ${notesSpec(true)} Then a line with exactly ===TITLE=== and after it the case title as written on the order sheet (e.g. "Hina Ehsan VS. Muhammad Aslam etc."), or nothing if it is not visible.`;
}

/* ---------- AI calls ---------- */
function errText(e) {
  const m = { rate_limited: "Too many requests, or the usage limit was reached. Please try again a little later.", image_rejected: "A picture could not be used. Please try a different picture.", prompt_too_large: "The record is too long. Try fewer pictures or shorter notes.", invalid_json: "The AI's reply could not be read. Please try again.", refused: "The AI declined this request.", session_expired: "Please sign in again.", cancelled: "Stopped.",
    not_granted: "You are not in a team, so the AI cannot be used.", no_key: "The AI key is missing or wrong. The team admin must check it in the Supabase Edge Function secrets.",
    no_model: "The AI model is not available. The team admin must check GEMINI_MODEL / AI_MODEL_COMPLEX in the Supabase Edge Function secrets.",
    network: "Could not reach the AI service. Check your internet connection and try again.", server: "The AI service had a problem. Please try again.",
    ai_error: "The AI service returned an error. Please try again.", bad_request: "The request could not be processed. Please try again.",
    time_limit: "This took longer than the server allows.",
    no_answer: "The AI did not start answering within the server's time limit, so nothing was written. Press the button again; if it keeps happening, the team admin can choose a faster model.",
    empty_answer: "The AI finished without writing anything. Please try again." };
  // For setup problems the server's own words say exactly what is missing
  if (m[e?.code] && ["no_key", "no_model", "rate_limited", "no_answer"].includes(e.code) && e.message) return m[e.code] + " (" + String(e.message).slice(0, 300) + ")";
  return m[e?.code] || (e?.message ? "Something went wrong: " + e.message : "Something went wrong. Please try again.");
}

$("#readBtn").addEventListener("click", async () => {
  if (!sample || reading) return;
  if (!images.length) { status("#readStatus", "Add the record pictures first.", true); return; }
  const S = SECTIONS[current.section], slots = getSlots(), c = current;
  const ordered = images.filter(im => !im.read);
  const given = () => `WHAT THE STENOGRAPHER HAS GIVEN
Next order / instructions: ${c.f.decision || "(nothing written yet)"}
Date of order / decision: ${fmtDate(c.f.date) || "(not given)"}${S.fields.includes("nextDate") ? `\nNext date: ${fmtDate(c.f.nextDate) || "(not given)"}` : ""}${c.f.title ? `\nCase title: ${c.f.title}` : ""}${c.f.present ? `\nPresent: ${c.f.present}` : ""}${c.questions.some(q => String(q.a || "").trim()) ? "\nHis answers to earlier questions (do not ask these again):\n" + c.questions.filter(q => String(q.a || "").trim()).map(q => `- ${q.q} — ${q.a.trim()}`).join("\n") : ""}`;
  const askRule = `"questions": ask ONLY when it is truly necessary, i.e. when without the answer this ${S.label.toLowerCase()} would come out wrong or with a blank in an essential place: the decision on a claim, issue or application is not stated anywhere, his instructions clearly contradict the record on a material point, or an essential date or amount is missing. Do NOT ask about anything you can settle from the record, from his instructions or answers, or from the usual practice of the court; do not ask for confirmation of what is already stated; do not ask about minor details, spellings, style, or things that can properly be left as "____"; do not ask for documents (those go in "needed"). Usually there is nothing to ask: then return an empty list. ${hasDecision() ? "The stenographer has ALREADY given the decision, so the draft will be written on it at once: ask nothing unless the record flatly contradicts his decision on a material point (any question is optional for him). " : ""}Never more than 3 questions, each short, specific and in plain English.`;
  const addQuestions = list => (Array.isArray(list) ? list : []).forEach(q => { q = norm(q); if (q && !c.questions.some(x => x.q === q)) c.questions.push({ q, a: "" }); });
  const unanswered = () => c.questions.some(q => !String(q.a || "").trim());
  if (!ordered.length) {
    // Nothing new to read: check the instructions and answers against the record already read.
    if (!c.notes && !c.summary) { status("#readStatus", "All pictures have already been read.", false, true); return; }
    if (unanswered()) { status("#readStatus", "Answer every question below first, then press Read record again.", true); $("#qWrap").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    reading = true;
    const btn0 = $("#readBtn"); btn0.disabled = true; btn0.innerHTML = `<span class="spin" aria-hidden="true"></span>Checking`;
    status("#readStatus", "Checking your instructions against the record...");
    try {
      const r = await sample.json(`You are a court stenographer's assistant in Rahim Yar Khan, Punjab, Pakistan. Task: section "${S.label}", type "${c.subtype}"${c.stage ? `, stage "${c.stage}"` : ""}.
${given()}
${c.questions.length ? "Questions already asked (do not repeat them):\n" + c.questions.map(q => `- ${q.q}${q.a ? " — answered: " + q.a : ""}`).join("\n") + "\n" : ""}
RECORD NOTES (already read from the file)
${(c.notes || c.summary).slice(0, 120000)}

Reply with only one JSON object: {"questions": ["..."]}
${askRule}`, { modelTier: "complex", cache: false, effort: "low" });
      addQuestions(r?.questions); c.needCheck = unanswered();
      if (current === c) { renderQuestions(); if (c.needCheck) { status("#readStatus", "One more thing is needed. Answer the new question below, then press Read record again.", true); $("#qWrap").scrollIntoView({ block: "center", behavior: "smooth" }); } else status("#readStatus", "Everything is clear. You can generate the draft.", false, true); }
    } catch (e) { status("#readStatus", errText(e), true); }
    finally { reading = false; btn0.textContent = "Read record"; btn0.disabled = !sample; }
    return;
  }
  const docList = slots.filter(s => s.key !== "other").map(s => `- ${s.key}: ${s.label}${s.req ? " (always required)" : ""}`).join("\n");
  const present = new Set(), needed = new Map();
  reading = true; let failed = null;
  const btn = $("#readBtn"); btn.disabled = true; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>Reading`;
  const size = Math.min(readBatch || imgMax, imgMax);
  const batches = []; for (let i = 0; i < ordered.length; i += size) batches.push(ordered.slice(i, i + size));
  let lastBatch = 0;   // pictures in the request that was running when something failed
  const merged = { summary: [], fields: {}, notes: [], points: [], flags: [] };
  try {
    try {
    for (let b = 0; b < batches.length; b++) {
      lastBatch = batches[b].length;
      if (current === c) status("#readStatus", `Reading the record${batches.length > 1 ? ` (part ${b + 1} of ${batches.length})` : ""}... this can take a minute or two.`);
      const prompt = `You are a court stenographer's assistant in Rahim Yar Khan, Punjab, Pakistan. The attached images are pages from a court file (plaint, written statement, applications, replies, issues, witness statements with cross-examination, exhibits, FIR, order sheets). Many are handwritten Urdu. Read them very carefully. Never invent names, dates or amounts; if a word is unreadable write "____".
Task context: section "${S.label}", type "${current.subtype}"${current.stage ? `, stage "${current.stage}"` : ""}, court: ${courtName(current.courtKind)}.
The pictures were uploaded together and may be in any order. First work out which document each page belongs to, then take each thing from its own document: e.g. the plaint facts only from the plaint pages, and the cross-examination from the evidence pages.${batches.length > 1 ? ` This is part ${b + 1} of ${batches.length}; the other pages are read separately.` : ""}
Documents that this type of work may need:
${docList}
${given()}
Reply with only one JSON object:
{"summary": "6-12 short lines in plain English: who the parties are, what is claimed or applied for, what happened, what the record shows",
 "fields": {"title": "Plaintiff VS. Defendant etc. in English", "cms": "", "caseNo": "", "instDate": "dd.mm.yyyy", "present": "counsel names if visible"},
 "notes": "Detailed English notes for drafting: full party descriptions (name, parentage, caste, address, numbering incl. legal heirs), facts of the plaint para-wise, written statement / reply with preliminary objections, issues as framed, each witness (PW/DW) with examination-in-chief and every admission/denial in cross-examination, exhibits and marks with descriptions, relevant order-sheet dates (ex-parte, right closed, compromise statements), FIR particulars. Keep Urdu quotations of statements in Urdu script where needed.",
 "points": ["each claim / relief / issue / charge that needs a decision, one short line each"],
 "flags": ["plain English: anything unreadable, or conflicting between documents (dates; khata / khewat numbers in the plaint vs the jamabandi; area or shares; names in the NADRA FRC vs the plaint; amounts), and any party or suspect aged 18 or under"],
 "present": ["the keys from the list above whose pages are among these images"],
 "needed": [{"key": "a key from the list above", "why": "one short plain-English line"}],
 "questions": ["..."]}
${askRule}
"needed" holds only documents from the list that are NOT among these images and without which this ${S.label.toLowerCase()} cannot be written correctly, judging from the record itself and the type and stage (for example, do not ask for the defendant's evidence or a written statement when the record shows the defendant is ex-parte, and do not ask for evidence when the suit was conceded or compromised). Leave it empty when nothing necessary is missing.`;
      const r = await sample.json(prompt, { images: batches[b].map(x => x.file), modelTier: "complex", effort: "medium" });
      if (r?.summary) merged.summary.push(r.summary);
      if (r?.notes) merged.notes.push(r.notes);
      for (const [k, v] of Object.entries(r?.fields || {})) if (v && !merged.fields[k]) merged.fields[k] = v;
      (r?.points || []).forEach(p => { if (p && !merged.points.includes(String(p))) merged.points.push(String(p)); });
      (r?.flags || []).forEach(f => f && merged.flags.push(String(f)));
      (Array.isArray(r?.present) ? r.present : []).forEach(k => present.add(String(k)));
      (Array.isArray(r?.needed) ? r.needed : []).forEach(n => { if (n?.key && !needed.has(String(n.key))) needed.set(String(n.key), String(n.why || "")); });
      addQuestions(r?.questions);
      batches[b].forEach(im => { im.read = true; });
    }
    } catch (e) { failed = e; }
    c.summary = [c.summary, merged.summary.join("\n\n")].filter(Boolean).join("\n\n");
    c.notes = [c.notes, merged.notes.join("\n\n")].filter(Boolean).join("\n\n");
    c.flags = [...(c.flags || []), ...merged.flags];
    merged.points.forEach(label => { if (!c.points.some(p => p.label === label)) c.points.push({ label, decision: "", note: "" }); });
    for (const [k, v] of Object.entries(merged.fields)) if (k in c.f && !c.f[k]) c.f[k] = String(v);
    // Which documents are on the file now, and which necessary ones are still missing.
    const keys = slots.map(s => s.key);
    if (failed) {
      // Keep what was read before the failure; the pages not yet read stay marked for the next try.
      c.found = [...new Set([...(c.found || []), ...[...present].filter(k => keys.includes(k))])];
      // Too many pages for one request within the server's time limit: read the rest in smaller groups.
      const timeUp = failed?.code === "time_limit" || failed?.code === "no_answer";
      if (timeUp) readBatch = Math.max(1, Math.ceil(lastBatch / 2));
      const kept = images.some(im => im.read) ? " The pages already read were kept." : "";
      const next = timeUp ? (lastBatch > 1 ? " Press Read record again: the remaining pages will now be read in smaller groups." : " Try a clearer picture of that page, or remove it and write what it says in the instructions.")
        : (kept ? " Press Read record to read the rest." : "");
      if (current === c) { renderWork(); status("#readStatus", errText(failed) + kept + next, true); }
      return;
    }
    c.found = [...new Set([...(c.found || []), ...[...present].filter(k => keys.includes(k))])];
    const old = c.missing || [], miss = [];
    slots.forEach(s => {
      if (s.key === "other" || c.found.includes(s.key)) return;
      const prev = old.find(m => m.key === s.key);
      if (s.req || needed.has(s.key) || prev) miss.push({ key: s.key, why: needed.get(s.key) || prev?.why || "", reason: prev?.reason || "" });
    });
    c.missing = miss; c.readDone = true; c.needCheck = unanswered();
    if (current !== c) return;
    renderWork();
    if (miss.some(m => !m.reason.trim())) { status("#readStatus", "Record read, but a needed document is missing. See below.", true); $("#missBox").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (c.needCheck) { status("#readStatus", "Record read. Answer the questions below, then press Read record again.", true); $("#qWrap").scrollIntoView({ block: "center", behavior: "smooth" }); }
    else status("#readStatus", "Record read. You can generate the draft.", false, true);
  } catch (e) { status("#readStatus", errText(e), true); }
  finally { reading = false; btn.textContent = "Read record"; btn.disabled = !sample; }
});

function styleFor(sec, st) {
  const p = [];
  if (sec === "issues") p.push(STYLE.applications);
  if (sec === "misc") { p.push(STYLE.applications); if (/maintenance|custody|meeting/i.test(st)) p.push(STYLE.family); }
  if (sec === "judgment") {
    if (/Family/.test(st)) p.push(STYLE.family);
    else {
      p.push(STYLE.civil);
      if (isRent(st)) p.push(STYLE.rent);
      if (/Guardian/.test(st)) p.push(STYLE.guardian);
      if (/Succession/.test(st)) p.push(STYLE.succession);
      if (/Execution/.test(st)) p.push(STYLE.applications);
    }
  }
  if (sec === "criminal") { p.push(STYLE.magistrate); if (/Identification/.test(st)) p.push(STYLE.idparade); }
  return p.join("\n\n");
}

/* ---------- Prompt layers ----------
   1 BASE: Pakistani court practice and the default style (the Judge's own, built in), the global rules and the case-law list.
   2 JUDGE STYLE: what the Samples teach (the closest samples word for word, and the notes learned from all of them).
   3 RULES: the standing instructions (Settings) and the team's rules (Samples page).
   4 CASE DATA: this case only.
   The final prompt is BASE + JUDGE STYLE + RULES + CASE DATA. Every part keeps its source, so the debug panel can show
   which layer gave which instruction. */
const LAYER_HEAD = {
  1: "LAYER 1 — BASE: Pakistani court practice and the default drafting style (the style of Mian Ijaz Ahmad)",
  2: "LAYER 2 — JUDGE STYLE: learned from the Judge's own samples",
  3: "LAYER 3 — RULES: standing instructions and the team's rules",
  4: "LAYER 4 — CASE DATA: this case only"
};
const PRECEDENCE = `HOW TO READ THE LAYERS BELOW: where they differ, LAYER 3 (RULES) wins over Layers 1 and 2; LAYER 2 (JUDGE STYLE) wins over LAYER 1 in wording and layout (the heading, the Present block, set phrases and the closing lines); LAYER 1 (BASE) applies wherever the others are silent, and when there are no samples it is the style to use. LAYER 4 gives only the facts and the decision of this case, never the style; its STRICT LIMITS, when present, bind over every layer. No layer allows inventing facts, names, numbers, dates or case law.`;
let lastParts = [];
function joinLayers(parts) {
  lastParts = parts.filter(p => String(p.text || "").trim());
  let out = PRECEDENCE, cur = 0;
  for (const p of lastParts) {
    if (p.layer !== cur) { cur = p.layer; out += `\n\n========== ${LAYER_HEAD[cur]} ==========`; }
    out += "\n\n" + p.text.trim();
  }
  return out;
}
function courtPart(court) {
  return { layer: 1, src: "Settings: judge, court and law officers", text: `COURT DETAILS
- Judge's name: "${settings.judge}" in the heading and the signature.
- Court designation: ${court || "as written under the previous order in the picture"}; district: ${settings.district}.${officersLine() ? "\n- " + officersLine() : ""}` };
}
function styleParts(sec, samplesText) {
  const p = [];
  if (digests[sec]?.text) p.push({ layer: 2, src: `Samples page: notes learned from all ${SECTIONS[sec].label} samples`, text: `COURT KNOWLEDGE LEARNED FROM THE JUDGE'S SAMPLES (${SECTIONS[sec].label}):\n${digests[sec].text}` });
  if (samplesText) p.push({ layer: 2, src: "Samples page: the closest samples, word for word", text: samplesText + "\nWhere the samples and the learned notes differ, follow the samples." });
  return p;
}
function rulesParts(sec) {
  const p = [];
  if (norm(settings.rules)) p.push({ layer: 3, src: "Settings: standing instructions", text: "STANDING INSTRUCTIONS (always follow):\n" + String(settings.rules).trim() });
  const rules = lessons.filter(l => l.section === sec || l.section === "all").sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-60);
  if (rules.length) p.push({ layer: 3, src: "Samples page: your rules", text: "YOUR RULES (always follow; if two conflict, the later one wins, and these win over the standing instructions):\n" + rules.map(l => "- " + String(l.text).slice(0, 400)).join("\n") });
  return p;
}

/* Layer 4 for drafts: the stenographer's details and decision, and what is known to be missing. */
function caseDataText() {
  const S = SECTIONS[current.section], f = current.f, decided = hasDecision();
  const pts = current.points.filter(p => p.decision || p.note).map(p => `- ${p.label}: ${p.decision || "(no decision given)"}${p.note ? " — " + p.note : ""}`).join("\n");
  const answered = (current.questions || []).filter(q => String(q.a || "").trim()), open = decided ? (current.questions || []).filter(q => !String(q.a || "").trim()) : [];
  const slots = getSlots(), label = k => slots.find(s => s.key === k)?.label || k;
  const miss = (current.missing || []).filter(m => slots.some(s => s.key === m.key));
  const withReason = miss.filter(m => String(m.reason || "").trim()), noReason = decided ? miss.filter(m => !String(m.reason || "").trim()) : [];
  return [`CASE TO DRAFT
Type: ${current.subtype}${current.stage ? " — " + current.stage : ""}
Court designation: ${current.court}
Title: ${f.title || "____"}
CMS No.: ${f.cms || "____"}
Suit / petition / FIR No.: ${f.caseNo || "____"}
Date of institution: ${fmtDate(f.instDate) || "____"}
Date of order / decision: ${fmtDate(f.date) || today() + " (today; no date was given)"}
Present: ${f.present || "____"}
Order / decision and instructions given by the stenographer (follow them; they state the Judge's decision): ${f.decision || "(see the points)"}${pts ? "\nDecision on each point:\n" + pts : ""}
Next date: ${fmtDate(f.nextDate) || "(none given)"}${f.nextPurpose ? " for " + f.nextPurpose : " (take the purpose of the next date from the instructions above)"}${f.instructions ? "\nSpecial instructions: " + f.instructions : ""}`,
    answered.length ? "Questions asked to the stenographer and his answers (treat the answers as instructions):\n" + answered.map(q => `- ${q.q}\n  Answer: ${q.a.trim()}`).join("\n") : "",
    open.length ? "Questions the stenographer left unanswered (do not stop: write \"____\" where the answer was needed and list each in NOTES):\n" + open.map(q => "- " + q.q).join("\n") : "",
    condText(), idpText(),
    withReason.length ? "DOCUMENTS NOT ON THE FILE (explained by the stenographer; do not invent their contents, and write the draft consistently with these reasons):\n" + withReason.map(m => `- ${label(m.key)}: ${m.reason.trim()}`).join("\n") : "",
    noReason.length ? "DOCUMENTS NOT RECEIVED (no reason given; do not invent their contents: leave what depends on them as \"____\" and list it in NOTES):\n" + noReason.map(m => "- " + label(m.key)).join("\n") : ""
  ].filter(Boolean).join("\n\n");
}
function draftParts(examples, notesCap) {
  const S = SECTIONS[current.section], st = current.subtype, t = TYPE_INFO[st];
  return [
    { layer: 1, src: "Built in: global rules", text: globalRules(false) },
    courtPart(current.court),
    { layer: 1, src: "Built in: house style", text: `HOUSE STYLE
- Party names in bold. Use **double asterisks** for bold (headings, party names, "VERSUS", signature lines). Do not print layout notes such as "(centred)".
- Use the decision exactly as given; do not change the outcome.
- If the stenographer's words say "party A" / "party B": party A is the side that brought the proceedings (plaintiff / petitioner / complainant / decree holder / applicant) and party B the other side. Never print "party A" or "party B"; use the proper word for this case as the record uses it.` },
    { layer: 1, src: `Built in: task (${S.label})`, text: `TASK (${S.label} / ${st}${current.stage ? " / " + current.stage : ""})\n${S.guide}` },
    t?.guide ? { layer: 1, src: `Built in: type template (${st})`, text: t.guide } : null,
    { layer: 1, src: "Built in: style guide", text: "STYLE GUIDE\n" + styleFor(current.section, st) },
    { layer: 1, src: "Built in + Settings: case-law list", text: caseLawBlock() },
    ...styleParts(current.section, examples),
    ...rulesParts(current.section),
    { layer: 4, src: "This case: details, decision and what is missing", text: caseDataText() },
    { layer: 4, src: "This case: record notes (Read record)", text: "RECORD NOTES\n" + (current.notes || current.summary || "(none: no record was read; use only what the stenographer gave and leave the rest as ____)").slice(0, notesCap || 150000) }
  ].filter(Boolean);
}
function draftPrompt(examples, notesCap) {
  return `You draft court orders and judgments for ${settings.judge}, ${current.court}, ${settings.district}, Punjab, Pakistan, in the Judge's own style. Follow the headings, standard sentences, legal formulae and level of detail given below.

${joinLayers(draftParts(examples, notesCap))}

OUTPUT: First the complete document text only, ready to print, no commentary. Then ${notesSpec(false)}`;
}
/* ---------- Learning from Samples: the closest samples word for word, what the app learned from all of them, and your rules ---------- */
const SAMPLE_CFG = { order: [25, 3000], issues: [6, 12000], misc: [6, 12000], judgment: [4, 25000], criminal: [5, 15000] };
/* Judgments and criminal work use only samples of the same type; a type built on another (e.g. the heirship suits on
   "Civil suit") also uses that type's samples, so the Judge's heading, Present block and closing still come from his samples. */
function matchingSamples() {
  const sec = current.section, strict = sec === "judgment" || sec === "criminal", base = typeBase(current.subtype);
  return samples.filter(s => s.section === sec && (!strict || s.subtype === current.subtype || s.subtype === base));
}
function pickSamples() {
  const base = typeBase(current.subtype);
  return matchingSamples()
    .map(s => ({ s, score: (s.subtype === current.subtype ? 4 : s.subtype === base ? 2 : 0) + (current.stage && s.stage === current.stage ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || (b.s.createdAt || 0) - (a.s.createdAt || 0))
    .slice(0, SAMPLE_CFG[current.section][0]).map(x => x.s);
}
function samplesBlock(list, budget) {
  const per = SAMPLE_CFG[current.section][1];
  let out = "", used = 0, n = 0;
  for (const s of list) {
    const head = `--- SAMPLE ${n + 1} (${s.subtype}${s.stage ? " / " + s.stage : ""}) ---\n`;
    const room = budget - used - bytes(head) - 4;
    if (room < 1000) break;
    let t = String(s.text).slice(0, per);
    while (bytes(t) > room) t = t.slice(0, Math.floor(t.length * 0.8));
    out += head + t + "\n\n"; used += bytes(head + t) + 2; n++;
  }
  return n ? "SAMPLES: final versions of the Judge's own documents, the closest match first. Follow their wording, layout and practice. Never copy their names, dates, amounts or facts into this case.\n\n" + out.trim() : "";
}
/* Safety net: the Judge signs the printout by hand, so markers such as "[Signature]", "(Sd/-)", "[Stamp]"
   or a line that only says "Signature" are taken out of every draft, even if Claude writes them.
   Only markers made of these words are removed, so text like "(Signature of PW-1 is Exh.P-3)" or "(stamp paper)" stays. */
const SIGN_TOKEN = /[\[(]\s*(?:signature|signed|sd\/?-?|stamp|seal|illegible)(?:[\s,\/&.-]+(?:and|with|of|the|court|judge|presiding|officer|signature|signed|stamp|seal|illegible|here|over|name|by|sd))*[\s.]*[\])]/gi;
function stripSignMarks(t) {
  return String(t || "")
    .replace(SIGN_TOKEN, "")
    .replace(/(^|\s)sd\/-(?=\s|$)/gi, "$1")
    .split("\n").filter(l => !/^\s*(?:\*\*)?\s*(?:signature|signed|sd\/?-?|stamp|seal)\s*[:.]?\s*(?:\*\*)?\s*$/i.test(l)).join("\n")
    .replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
}
/* The answer is: the document, then "===NOTES===" and the notes, and for orders "===TITLE===" and the title (in either order). */
function parseOut(t) {
  const s = String(t || ""), at = k => { const i = s.indexOf(k); return i < 0 ? Infinity : i; };
  const iN = at("===NOTES==="), iT = at("===TITLE==="), ends = [iN, iT, s.length];
  const part = (i, k) => i === Infinity ? "" : s.slice(i + k.length, Math.min(...ends.filter(x => x > i)));
  const doc = s.slice(0, Math.min(...ends));
  return { doc: fixJudgeName(stripSignMarks(doc.replace(/\n=+[A-Z]*\s*$/, ""))).replace(/^[ \t\u00a0]+/gm, "").trim(),
    notes: part(iN, "===NOTES===").replace(/\n=+[A-Z]*\s*$/, "").trim(), title: part(iT, "===TITLE===").trim().split("\n")[0].replace(/^["']|["']$/g, "").trim() };
}

$("#draftBtn").addEventListener("click", async () => {
  if (!sample || drafting) return;
  const isOrder = current.section === "order";
  if (isOrder && !orderReady()) return;
  if (isOrder) current.o.date = today();
  if (!isOrder) {
    renderCourt();
    if (current.dateAuto && current.f.date !== today()) { current.f.date = today(); const el = $("#f_date"); if (el) el.value = current.f.date; }
    if (!recordReady()) return;
    // Conditional decree: ask once who deposits and what happens on failure; pressing again uses the defaults.
    const cd = current.cond;
    if (condAllowed() && cd.on && (!cd.who.trim() || !cd.consequence.trim()) && !cd.asked) {
      cd.asked = true;
      const t = TYPE_INFO[current.subtype];
      status("#draftStatus", `Conditional decree: who must deposit the amount, and what happens if it is not deposited? Fill the two boxes, or press Generate draft again to use "${t?.condWho || "the plaintiff"}" and "the suit shall stand dismissed".`, true);
      $("#condBox").scrollIntoView({ block: "center", behavior: "smooth" });
      $(!cd.who.trim() ? "#c_who" : "#c_consequence").focus({ preventScroll: true });
      return;
    }
  }
  drafting = true;
  // Keep the prompt within the size limit: shorten the record notes first, then fit past work into what is left.
  let notesCap = 150000;
  let base = isOrder ? orderPrompt("") : draftPrompt("", notesCap);
  while (!isOrder && bytes(base) > PROMPT_LIMIT - 4000 && notesCap > 2000) { notesCap = Math.floor(notesCap * 0.7); base = draftPrompt("", notesCap); }
  const shortened = !isOrder && (current.notes || current.summary || "").length > notesCap;
  const ex = samplesBlock(pickSamples(), Math.min(100000, PROMPT_LIMIT - bytes(base) - 2000));
  const prompt = isOrder ? orderPrompt(ex) : draftPrompt(ex, notesCap);
  const c = current;
  c.cont = null; c.layers = lastParts; c.prevDraft = "";
  const slots = isOrder ? [] : getSlots();
  const openItems = !isOrder && ((c.questions || []).some(q => !String(q.a || "").trim()) || (c.missing || []).some(m => slots.some(s => s.key === m.key) && !String(m.reason || "").trim()) || (!c.readDone && !c.notes));
  runDraft(c, { prompt, isOrder, shortened, openItems, effort: draftEffort(c.section), images: isOrder ? images.slice(-imgMax).map(x => x.file) : null });
});
$("#contBtn").addEventListener("click", () => {
  const c = current;
  if (!sample || drafting || !c?.cont) return;
  runDraft(c, c.cont, c.raw || "");
});

/* How much the AI may think before it writes: a daily order is short and quick, a judgment needs the most
   reasoning, and everything else sits in between. (Gemini uses this as its thinking level.) */
function draftEffort(section) { return section === "order" ? "low" : section === "judgment" ? "high" : "medium"; }

/* An unfinished answer (time limit, dropped connection, Stop, or too long for one answer) is kept, and
   "Continue" asks Claude to write the rest. Only complete lines are kept: the unfinished last line is
   written again, so a word is never joined in the middle. */
function keptLines(sofar) {
  const t = String(sofar || ""), cut = t.lastIndexOf("\n");
  return cut > 0 ? t.slice(0, cut + 1) : "";
}
function continuePrompt(prompt, base) {
  return `${prompt}

=====
YOUR ANSWER SO FAR: the answer below was cut off before it was finished (a time limit, not a mistake). Every line of it is final and stays exactly as it is.
<<<ANSWER SO FAR>>>
${base}<<<END OF ANSWER SO FAR>>>

Continue the answer with the line that comes next, as if there had been no interruption. Do not repeat anything already written, do not start again, and add no commentary. Output only the continuation, keeping the OUTPUT format above (including the ===NOTES=== or ===TITLE=== part at the end if it has not been written yet).`;
}

/* Runs one drafting request and shows the text as it arrives. `sofar` is the raw text of an earlier,
   unfinished attempt; the new text is added after its complete lines. */
async function runDraft(c, job, sofar = "") {
  const isOrder = job.isOrder, base = sofar ? keptLines(sofar) : "";
  drafting = true;
  ctl = new AbortController();
  // Show that work is going on: a spinner on the button, shimmering lines on the page and a running count of seconds.
  const mine = () => current === c, t0 = Date.now();
  const fixing = job.kind === "fix";
  let phase = base ? "Continuing" : fixing ? "Applying the corrections" : isOrder ? "Reading the previous order" : "Reading the record", gotText = false;
  const tick = () => { if (mine()) status("#draftStatus", `${phase}... ${Math.round((Date.now() - t0) / 1000)}s`); };
  setDraftBusy(true);
  if (base) setSheet(parseOut(base).doc);
  tick();
  const timer = setInterval(tick, 1000);
  const onText = ({ text }) => {
    const doc = parseOut(base + text).doc;
    if (!doc) return;
    if (!gotText) { gotText = true; phase = base ? "Continuing the draft" : fixing ? "Applying the corrections" : isOrder ? "Writing the order" : "Writing the draft"; tick(); }
    if (mine()) setSheet(doc);
  };
  // Keep the text; an unfinished one can be continued.
  const finish = (raw, unfinished) => {
    const out = parseOut(raw);
    c.raw = raw; c.draft = out.doc; c.draftNotes = out.notes;
    if (isOrder && out.title && !c.f.title) c.f.title = out.title;
    c.cont = unfinished && raw.trim() ? job : null;
  };
  const KEPT = " The part written so far is kept: press Continue to write the rest.";
  try {
    const opts = { signal: ctl.signal, onText, modelTier: "complex", cache: false, effort: job.effort || draftEffort(c.section) };
    if (job.images) opts.images = job.images;
    const { text, truncated, stopReason } = await sample(base ? continuePrompt(job.prompt, base) : job.prompt, opts);
    clearInterval(timer);
    finish(base + text.replace(/^\n+/, ""), truncated);
    if (mine()) {
      setSheet(c.draft);
      $("#draftNotesWrap").hidden = !c.draftNotes; $("#draftNotes").textContent = c.draftNotes;
      const msg = stopReason === "time_limit" ? "The server's time limit was reached before the draft was finished." + KEPT
        : truncated ? "The draft is longer than one answer allows." + KEPT
        : fixing ? "Corrections applied. Check them (Undo brings the earlier text back) and save."
        : isOrder ? "Order ready. Check it and the Notes, and save."
        : job.shortened ? "Draft ready. The record notes were very long, so only their first part was used. Check it and save."
        : job.openItems ? "Draft ready on your decision. Unanswered questions and documents not received were left as ____: see the Notes. Check it and save."
        : "Draft ready. Check it and the Notes, and save.";
      status("#draftStatus", msg, truncated, !truncated);
      if (fixing && !truncated) $("#fixText").value = "";
    }
  } catch (e) {
    clearInterval(timer);
    const partial = base + String(e?.text || "").replace(/^\n+/, "");
    if (e?.code === "refused") c.cont = null;          // asking again would be declined again
    else if (partial.trim()) finish(partial, true);
    if (mine()) { setSheet(c.draft); status("#draftStatus", errText(e) + (c.cont ? KEPT : ""), e?.code !== "cancelled"); }
  } finally { clearInterval(timer); drafting = false; setDraftBusy(false); if (mine()) renderAfterDraft(); }
}

/* ---------- After a draft: citation warning, corrections box, prompt layers ---------- */
function renderCites() {
  const cites = (current.draft || "").trim() ? citationsIn(current.draft) : [];
  $("#citeWrap").hidden = !cites.length;
  $("#citeList").innerHTML = cites.map(x => `<li>${esc(x.cite)}${x.known ? "" : ` <span class="unk">not in the app's case-law list: remove it, or check it in the official report before keeping it</span>`}</li>`).join("");
}
function renderAfterDraft() {
  renderCites();
  $("#fixWrap").hidden = !(current.draft || "").trim() || drafting;
  $("#fixBtn").disabled = !sample || drafting;
  $("#undoFixBtn").hidden = !current.prevDraft || drafting;
  const L = settings.debug && current.layers?.length;
  $("#layersWrap").hidden = !L;
  $("#layers").innerHTML = L ? current.layers.map(p => `<details class="layer"><summary><b>Layer ${p.layer}</b> · ${esc(p.src)} · ${Math.max(1, Math.round(bytes(p.text) / 1024))} KB</summary><pre>${esc(p.text)}</pre></details>`).join("") : "";
}
/* Corrections: the AI edits the draft as it stands (with the stenographer's own edits) instead of writing a new one. */
function fixPrompt(draft, fix) {
  const isOrder = current.section === "order";
  const parts = [
    { layer: 1, src: "Built in: global rules", text: globalRules(isOrder) },
    courtPart(isOrder ? null : current.court),
    isOrder ? null : { layer: 1, src: "Built in + Settings: case-law list", text: caseLawBlock() },
    ...rulesParts(current.section),
    { layer: 4, src: "This case: record notes (only for facts a correction needs)", text: "RECORD NOTES (use them only for facts a correction needs)\n" + (current.notes || current.summary || "(none)").slice(0, 60000) }
  ].filter(Boolean);
  return `You correct an existing court ${isOrder ? "order" : "draft"} for ${settings.judge}, ${settings.district}, Punjab, Pakistan.
TASK: apply ONLY the stenographer's corrections below to the CURRENT DRAFT. Keep every other word, line, heading, number and the layout exactly as they are. Do not write a fresh draft; do not shorten, re-order or improve anything that was not asked. The corrections may be in Roman Urdu or English; write the changed text in court English (Urdu quotations stay in Urdu script). If a correction cannot be made from the information given, leave that place as it is and say so in NOTES.

${joinLayers(parts)}

CORRECTIONS FROM THE STENOGRAPHER
${fix}

CURRENT NOTES (update them: drop what the corrections resolved, keep the rest, and add one line for each change made)
${current.draftNotes || "(none)"}

CURRENT DRAFT (exactly as it stands now)
<<<DRAFT>>>
${draft}
<<<END OF DRAFT>>>

OUTPUT: the complete corrected document from its first line to its last, ready to print, no commentary. Then ${notesSpec(isOrder)}`;
}
$("#fixBtn").addEventListener("click", () => {
  const c = current;
  if (!sample || drafting || !c) return;
  const fix = $("#fixText").value.trim(), draft = sheetText();
  if (!draft) return;
  if (fix.length < 3) { status("#draftStatus", "Write the corrections first.", true); $("#fixText").focus(); return; }
  const prompt = fixPrompt(draft, fix);
  c.prevDraft = draft; c.prevNotes = c.draftNotes; c.cont = null; c.layers = lastParts;
  runDraft(c, { prompt, isOrder: c.section === "order", kind: "fix", effort: c.section === "judgment" ? "medium" : "low" });
});
$("#undoFixBtn").addEventListener("click", () => {
  const c = current;
  if (!c.prevDraft || drafting) return;
  c.draft = c.prevDraft; c.draftNotes = c.prevNotes || c.draftNotes; c.prevDraft = ""; c.cont = null; c.raw = c.draft;
  setSheet(c.draft); $("#draftNotesWrap").hidden = !c.draftNotes; $("#draftNotes").textContent = c.draftNotes;
  renderAfterDraft(); renderReady(); status("#draftStatus", "The last correction was undone.", false, true);
});
function setDraftBusy(on) {
  const btn = $("#draftBtn"), sheet = $("#sheet"), isOrder = current.section === "order";
  $("#stopBtn").hidden = !on;
  if (on) { $("#contBtn").hidden = true; $("#fixWrap").hidden = true; $("#undoFixBtn").hidden = true; }
  sheet.contentEditable = on ? "false" : "true";
  if (on) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${isOrder ? "Writing order" : "Writing draft"}`;
    sheet.innerHTML = `<div class="skel" aria-hidden="true">${[92, 78, 96, 64, 88, 72, 84].map(w => `<span style="width:${w}%"></span>`).join("")}</div>`;
  } else {
    btn.textContent = isOrder ? "Generate order" : "Generate draft";
    renderReady();
  }
}
$("#stopBtn").addEventListener("click", () => ctl?.abort());

/* ---------- Draft page ---------- */
function mdToHtml(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/_{4,}/g, m => `<span class="blank">${m}</span>`); }
/* Layout of the printed page: the Present block hangs in a column, and the Judge's name and designation sit on the right, as on the court's own order sheets. */
const plain = l => l.replace(/\*\*/g, "").trim();
function layoutParts(t) {
  const lines = String(t || "").split("\n"), parts = [], judge = norm(settings.judge).toLowerCase();
  const push = (kind, l) => { const last = parts[parts.length - 1]; if (last && last.kind === kind && kind === "text") last.lines.push(l); else parts.push({ kind, lines: [l] }); };
  for (let i = 0; i < lines.length; i++) {
    const p = plain(lines[i]);
    if (/^Present\s*[:.]/i.test(p)) {
      const blk = { kind: "present", lines: [lines[i].trim()] };
      while (i + 1 < lines.length && lines[i + 1].trim() && blk.lines.length < 14 && !/^(ORDER|JUDGMENT)\b/i.test(plain(lines[i + 1]))) blk.lines.push(lines[++i].trim());
      parts.push(blk);
    } else if (judge && p.replace(/[,.]$/, "").toLowerCase() === judge) {
      const blk = { kind: "sign", lines: [lines[i].trim()] };
      while (i + 1 < lines.length && lines[i + 1].trim() && blk.lines.length < 4 && plain(lines[i + 1]).length < 70) blk.lines.push(lines[++i].trim());
      parts.push(blk);
    } else push("text", lines[i]);
  }
  return parts;
}
function presentSplit(first) { const m = first.match(/^(\**Present\**\s*[:.]\**)\s*([\s\S]*)$/i); return m ? [m[1], m[2]] : ["", first]; }
function layoutHtml(t) {
  return layoutParts(t).map(p => {
    if (p.kind === "text") return mdToHtml(p.lines.join("\n"));
    if (p.kind === "sign") return `<div class="sign">${mdToHtml(p.lines.join("\n"))}</div>`;
    const [label, rest] = presentSplit(p.lines[0]);
    return `<div class="present"><span class="plabel">${mdToHtml(label)} </span>${mdToHtml([rest, ...p.lines.slice(1)].join("\n"))}</div>`;
  }).join("");
}
/* The same layout for Word (file or paste). */
function wordBody(t) {
  const para = (l, st = "") => `<p style="margin:0 0 6pt;${st}">${l.trim() ? mdToHtml(l) : "&nbsp;"}</p>`;
  return layoutParts(t).map(p => {
    if (p.kind === "text") return p.lines.map(l => para(l.trim())).join("");
    if (p.kind === "sign") return p.lines.map(l => para(l, "margin-left:3.4in;text-align:center")).join("");
    const [label, rest] = presentSplit(p.lines[0]), hang = "margin-left:1in;text-indent:-1in;tab-stops:1in";
    return `<p style="margin:0 0 0;${hang}">${mdToHtml(label)}<span style="mso-tab-count:1">&#9;</span>${mdToHtml(rest)}</p>` + p.lines.slice(1).map((l, i, a) => `<p style="margin:0 0 ${i === a.length - 1 ? 6 : 0}pt;margin-left:1in">${mdToHtml(l)}</p>`).join("");
  }).join("");
}
function wordHtml(t) { return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:'Times New Roman';font-size:13pt;line-height:1.5}.blank{background:#ffe680}</style></head><body>${wordBody(t)}</body></html>`; }
function setSheet(t) { $("#sheet").innerHTML = t ? layoutHtml(t) : ""; }
function sheetText() {
  // The copy must be in the page (off-screen) while it is read, otherwise the line breaks between blocks are lost.
  const c = $("#sheet").cloneNode(true);
  c.removeAttribute("id"); c.removeAttribute("contenteditable"); c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:absolute;left:-99999px;top:0;width:700px;min-height:0";
  c.querySelectorAll("strong,b").forEach(b => b.replaceWith("**" + b.textContent + "**"));
  $("#sheet").parentNode.appendChild(c);
  try { return c.innerText.replace(/\u00a0/g, " ").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim(); }
  finally { c.remove(); }
}
$("#sheet").addEventListener("input", () => {
  current.draft = sheetText(); if (current.cont) current.raw = current.draft + "\n";
  clearTimeout(renderCites.t); renderCites.t = setTimeout(renderCites, 400);
});

$("#copyBtn").addEventListener("click", async () => {
  const txt = $("#sheet").innerText;
  try {
    // Copy with the layout (Present column, name on the right, bold) so that pasting into Word keeps it; plain text otherwise.
    try { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([wordHtml(sheetText())], { type: "text/html" }), "text/plain": new Blob([txt], { type: "text/plain" }) })]); }
    catch (e) { await navigator.clipboard.writeText(txt); }
    status("#saveStatus", "Copied.", false, true);
  }
  catch (e) { const r = document.createRange(); r.selectNodeContents($("#sheet")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); status("#saveStatus", "Text selected. Press Ctrl+C to copy."); }
});
$("#wordBtn").addEventListener("click", async () => {
  if (!downloads) { status("#saveStatus", "This view cannot save files. Copy the text and paste it into Word.", true); return; }
  const html = wordHtml(sheetText());
  const base = current.f.title || (current.section === "order" ? "Order " + (current.o.date || today()) : current.subtype) || "Draft";
  const name = base.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80).trim() + ".doc";
  try { await downloads.save({ filename: name, data: new Blob(["﻿" + html], { type: "application/msword" }) }); status("#saveStatus", "Word file saved.", false, true); }
  catch (e) { status("#saveStatus", e?.code === "cancelled" || e?.code === "declined" ? "" : "The file could not be saved.", true); }
});

/* ---------- Saving to History (History is only a record; the app learns from Samples, not from drafts) ---------- */
function fitDoc(doc, keys) {
  const LIM = 240 * 1024;
  for (const k of keys) {
    while (bytes(JSON.stringify(doc)) > LIM && typeof doc[k] === "string" && doc[k].length > 2000) doc[k] = doc[k].slice(0, Math.floor(doc[k].length * 0.7));
  }
  return doc;
}
async function saveCase() {
  if (!col) { status("#saveStatus", "Not connected to the database, so this could not be saved.", true); return; }
  const c = current;
  c.draft = sheetText();
  if (!c.draft) { status("#saveStatus", "There is nothing to save yet.", true); return; }
  if (!c.id) c.id = rid("c_");
  c.courtKind = autoKind(c.section, c.subtype); c.court = courtName(c.courtKind);
  const doc = fitDoc({ kind: "case", section: c.section, subtype: c.subtype, stage: c.stage, court: c.court, courtKind: c.courtKind, found: c.found || [], missing: c.missing || [], questions: c.questions || [], needCheck: !!c.needCheck, readDone: !!c.readDone, f: c.f, o: c.o, cond: c.cond, idp: c.idp, notes: c.notes, summary: c.summary, flags: c.flags, points: c.points, draft: c.draft, draftNotes: c.draftNotes, updatedAt: Date.now() }, ["notes", "summary", "draftNotes", "draft"]);
  try { await col.doc(c.id).set(doc); if (current === c) status("#saveStatus", "Saved to History.", false, true); }
  catch (e) { status("#saveStatus", "Could not save. Please try again.", true); }
}
$("#saveBtn").addEventListener("click", () => saveCase());

function status(sel, msg, err, ok) { const el = $(sel); el.textContent = msg; el.className = "status" + (err ? " err" : ok ? " okk" : ""); }

/* ---------- History ---------- */
let histFilter = "all";
function renderHistory() {
  const tabs = [["all", "All"], ...Object.entries(SECTIONS).map(([k, s]) => [k, s.label])];
  $("#histTabs").innerHTML = tabs.map(([k, l]) => `<button class="tab${k === histFilter ? " on" : ""}" data-hf="${k}">${esc(l)}</button>`).join("");
  $$("#histTabs [data-hf]").forEach(b => b.addEventListener("click", () => { histFilter = b.dataset.hf; renderHistory(); }));
  const q = $("#histSearch").value.trim().toLowerCase();
  const list = cases.filter(c => SECTIONS[c.section] && (histFilter === "all" || c.section === histFilter) && (!q || JSON.stringify([c.f, c.subtype, c.o?.date]).toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
  $("#histList").innerHTML = list.length ? list.map(c => {
    const type = c.section === "order" ? "Daily order" + (c.o?.date ? " · " + c.o.date : "") : c.subtype;
    return `<div class="item"><div><h4>${esc(c.f?.title || "Untitled case")}</h4>
      <div class="meta"><span class="chip">${esc(SECTIONS[c.section].label)}</span>${esc(type)}${c.f?.cms ? " · CMS " + esc(c.f.cms) : ""} · saved ${new Date(c.updatedAt).toLocaleDateString("en-GB")}${c._by && members[c._by] ? " by " + esc(members[c._by]) : ""}</div></div>
      <div class="row"><button class="btn plain" data-open="${c.id}">Open</button><button class="btn danger" data-del="${c.id}">Delete</button></div></div>`;
  }).join("")
    : `<p class="note">${cases.length ? "No saved cases match this filter." : "Nothing saved yet. Generate a draft in any section and press Save; it will appear here."}</p>`;
  $$("#histList [data-open]").forEach(b => b.addEventListener("click", () => {
    const c = cases.find(x => x.id === b.dataset.open); if (!c || !SECTIONS[c.section]) return;
    const base = blankCase(c.section);
    if (current) stash[current.section] = { current, images };
    current = { ...base, ...c, f: { ...base.f, ...c.f }, o: { ...base.o, ...(c.o || {}) }, cond: { ...base.cond, ...(c.cond || {}), asked: false },
      idp: c.idp && Array.isArray(c.idp.rows) ? structuredClone(c.idp) : base.idp, prevDraft: "", layers: null };
    current.found = Array.isArray(c.found) ? [...c.found] : []; current.missing = Array.isArray(c.missing) ? c.missing.map(m => ({ ...m })) : []; current.questions = Array.isArray(c.questions) ? c.questions.map(q => ({ ...q })) : [];
    images = []; current.dateAuto = false; if (!current.readDone && current.notes) current.readDone = true;
    view = c.section; $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    ["historyView", "setShell"].forEach(id => { $("#" + id).hidden = true; }); $("#workView").hidden = false; lastWork = view;
    renderWork(); scrollToTop();
  }));
  $$("#histList [data-del]").forEach(b => b.addEventListener("click", () => confirmInline(b, () => col?.doc(b.dataset.del).delete().catch(delFail))));}
$("#histSearch").addEventListener("input", renderHistory);
function confirmInline(btn, fn) {
  if (btn.dataset.armed) { fn(); return; }
  btn.dataset.armed = "1"; const old = btn.textContent; btn.textContent = "Sure?";
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
}

/* ---------- Samples page: the final versions from Word teach the app ---------- */
const FALLBACK_TYPE = { order: "Daily order", issues: "Framing of issues", misc: "Other application", judgment: "Civil suit", criminal: "Other criminal order" };
let sampFilter = "order", sBusy = false;
const baseName = n => String(n || "").replace(/\.[^.]+$/, "");
/* File names like "Screenshot_2026..." or "IMG_1234" say nothing; use Claude's short title, or the first real line of the text. */
const GENERIC_NAME = /^(screenshot|img|image|photo|pic|pxl|dsc|scan|camera|whatsapp|document|doc\b|new\b|untitled|pasted sample)/i;
const isGenericName = t => GENERIC_NAME.test(String(t || "").trim()) || !/[a-z]{3}/i.test(String(t || ""));
const firstLine = text => (String(text || "").split("\n").map(l => l.replace(/\*\*/g, "").replace(/\s+/g, " ").trim()).find(l => l.length > 8 && /[a-z]{3}/i.test(l)) || "").slice(0, 90);
const niceTitle = (d, c) => d.source !== "pictures" && !isGenericName(d.title) ? d.title : (c?.title || firstLine(d.text) || d.title);
const sampleTitle = s => !isGenericName(s.title) ? s.title : (firstLine(s.text) || s.title || "Sample");

function typeOptions(selSec, selType) {
  return Object.entries(SECTIONS).map(([k, s]) => `<optgroup label="${esc(s.label)}">${s.subtypes.map(t => `<option value="${k}|${esc(t)}"${k === selSec && t === selType ? " selected" : ""}>${esc(t)}</option>`).join("")}</optgroup>`).join("");
}
function fillSampleTypes() {
  const sec = $("#s_section").value;
  $("#s_type").innerHTML = `<option value="auto">Auto-detect</option>` + (SECTIONS[sec] ? SECTIONS[sec].subtypes.map(t => `<option>${esc(t)}</option>`).join("") : "");
  $("#s_type").disabled = !SECTIONS[sec];
}
function renderSamples() {
  if (!$("#s_section").options.length) {
    $("#s_section").innerHTML = `<option value="auto">Auto-detect</option>` + Object.entries(SECTIONS).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join("");
    fillSampleTypes();
  }
  $("#sampTabs").innerHTML = Object.entries(SECTIONS).map(([k, s]) => `<button class="tab${k === sampFilter ? " on" : ""}" data-sf="${k}">${esc(s.label)} · ${samples.filter(x => x.section === k).length}</button>`).join("");
  $$("#sampTabs [data-sf]").forEach(b => b.addEventListener("click", () => { sampFilter = b.dataset.sf; status("#digestStatus", ""); renderSamples(); }));
  const dg = digests[sampFilter];
  $("#digestSummary").textContent = `What the app has learned from the ${SECTIONS[sampFilter].label} samples${dg?.count ? ` (${dg.count} studied)` : ""}`;
  $("#digestText").textContent = dg?.text || "ابھی کچھ نہیں۔ اس سیکشن کے نمونے ڈالیں؛ ایپ ان کا مطالعہ کر کے جو سیکھے گی وہ یہاں لکھے گی۔";
  const list = samples.filter(x => x.section === sampFilter).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $("#sampList").innerHTML = list.length ? list.map(s => `<div class="item"><div><h4>${esc(sampleTitle(s))}</h4>
      <div class="meta">${s.stage ? `<span class="chip">${esc(s.stage)}</span>` : ""}${(String(s.text).length / 1000).toFixed(1)}k characters · added ${new Date(s.createdAt || Date.now()).toLocaleDateString("en-GB")}</div></div>
      <div class="row"><select class="mini-select" data-sre="${s.id}" aria-label="Section and type">${typeOptions(s.section, s.subtype)}</select><button class="btn danger" data-sdel="${s.id}">Delete</button></div></div>`).join("")
    : `<p class="ur" lang="ur" dir="rtl">ابھی ${esc(SECTIONS[sampFilter].label)} کا کوئی نمونہ نہیں۔</p>`;
  $$("#sampList [data-sre]").forEach(sel => sel.addEventListener("change", async () => {
    const [sec, type] = sel.value.split("|"), s = samples.find(x => x.id === sel.dataset.sre);
    try { await col?.doc(sel.dataset.sre).update({ section: sec, subtype: type, stage: sec === "judgment" ? (s?.stage || "") : "" }); } catch (e) {}
  }));
  $$("#sampList [data-sdel]").forEach(b => b.addEventListener("click", () => confirmInline(b, () => col?.doc(b.dataset.sdel).delete().catch(delFail))));
  renderRules(); renderSamplesBusy();
}
function renderSamplesBusy() {
  $("#sFile").disabled = sBusy; $("#sPasteAdd").disabled = sBusy;
  $("#digestRebuild").disabled = sBusy || !sample || !samples.some(x => x.section === sampFilter);
}
function renderRules() {
  const list = lessons.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $("#ruleList").innerHTML = list.length ? list.map(l => `<div class="item"><div><p class="lesson">${esc(l.text)}</p>
      <div class="meta"><span class="chip">${esc(l.section === "all" ? "All sections" : SECTIONS[l.section]?.label || l.section)}</span>${l.subtype ? esc(l.subtype) : ""}</div></div>
      <button class="btn danger" data-ldel="${l.id}">Delete</button></div>`).join("") : "";
  $$("#ruleList [data-ldel]").forEach(b => b.addEventListener("click", () => confirmInline(b, () => col?.doc(b.dataset.ldel).delete().catch(delFail))));
}

/* Reading the files */
async function whenMammoth() { for (let i = 0; i < 50 && !window.mammoth; i++) await new Promise(r => setTimeout(r, 200)); return window.mammoth; }
async function docxText(file) {
  const m = await whenMammoth();
  if (!m) throw new Error("Word reader not loaded");
  const { value } = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const d = new DOMParser().parseFromString(value, "text/html");
  d.querySelectorAll("strong,b").forEach(b => b.replaceWith(b.textContent.trim() ? "**" + b.textContent + "**" : b.textContent));
  d.querySelectorAll("br").forEach(b => b.replaceWith("\n"));
  d.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,tr").forEach(el => el.append("\n"));
  d.querySelectorAll("td,th").forEach(el => el.append("   "));
  return d.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}
async function picturesText(pics) {
  const out = [];
  for (let i = 0; i < pics.length; i += imgMax) {
    const { text } = await sample(`These images are pages, in order, of one or more final court orders or judgments. Transcribe the full text exactly: keep the headings, paragraph numbering and line breaks, mark bold or underlined headings and party names with **double asterisks**, and keep Urdu portions in Urdu script. Do not write "[Signature]", "[Stamp]" or anything about signatures, stamps or seals.
If the images hold more than one separate document (different cases, or several dated order-sheet entries each ending with its own "Announced" and Judge's name), put a line with exactly ===NEXT DOCUMENT=== between them. Pages of the same document stay together. Output only the transcription.`, { images: pics.slice(i, i + imgMax), modelTier: "complex", effort: "low" });
    out.push(String(text || "").trim());
  }
  return out.join("\n").split(/^\s*=+\s*NEXT DOCUMENT\s*=+\s*$/m).map(t => stripSignMarks(t).trim()).filter(Boolean);
}
function guessSection(t) {
  const s = String(t).slice(0, 4000).toUpperCase();
  if (/MAGISTRATE|CR\.?\s?P\.?\s?C|\bF\.?I\.?R\b/.test(s)) return "criminal";
  if (/JUDGMENT/.test(s)) return "judgment";
  if (/ISSUES/.test(s)) return "issues";
  if (/APPLICATION|DISPOSE OF/.test(s)) return "misc";
  return "order";
}
function validClass(sec, type, stage, text) {
  if (!SECTIONS[sec]) sec = guessSection(text);
  if (!SECTIONS[sec].subtypes.includes(type)) type = FALLBACK_TYPE[sec];
  return { section: sec, subtype: type, stage: sec === "judgment" && SECTIONS.judgment.stages.includes(stage) ? stage : "" };
}
async function classify(docs, fixedSec) {
  const lists = { ...Object.fromEntries(Object.entries(SECTIONS).map(([k, s]) => [k, s.subtypes])), judgmentStages: SECTIONS.judgment.stages };
  const out = [];
  for (let i = 0; i < docs.length; i += 20) {
    const part = docs.slice(i, i + 20);
    const prompt = `Classify each document below. They are orders and judgments of Pakistani district courts (civil, family, rent, guardian, succession) and of a Magistrate Section-30 (criminal work).
For each document choose:
- "section": "order" for a short daily order-sheet entry (attendance, adjournment, next date); "issues" for an order framing issues; "misc" for an order deciding an application; "judgment" for a final judgment or final order in a suit or petition; "criminal" for Magistrate Section-30 work (charge, statement u/s 342, challan judgment, bail, 512, 249 / 249-A, remand, cancellation report, private complaint, proclamation, superdari, identification parade).${fixedSec ? `\nAll of these documents belong to the section "${fixedSec}"; choose only the type (and stage).` : ""}
- "type": copy exactly one name from that section's list.
- "stage": for "judgment" only, copy exactly one name from judgmentStages; otherwise "".
- "title": a short name for the list: the kind of document, the parties and the date, e.g. "Order 18.05.2026 · Shakeela Bano vs Province of Punjab".
LISTS: ${JSON.stringify(lists)}
Reply with only JSON: {"items":[{"n":1,"section":"...","type":"...","stage":"...","title":"..."}]}

DOCUMENTS:
${part.map((d, j) => `#${j + 1} (file: ${d.title})\n${d.text.slice(0, 1500)}`).join("\n\n")}`;
    let items = [];
    try { const r = await sample.json(prompt, { modelTier: "default", effort: "low" }); items = Array.isArray(r?.items) ? r.items : []; }
    catch (e) { if (["not_granted", "rate_limited", "session_expired"].includes(e?.code)) throw e; }
    part.forEach((d, j) => { const it = items.find(x => +x.n === j + 1) || {}; out.push({ ...validClass(fixedSec || it.section, it.type, it.stage, d.text), title: typeof it.title === "string" ? it.title.trim().slice(0, 90) : "" }); });
  }
  return out;
}

/* Studying: the app keeps short "court knowledge" notes per section, updated from every batch of samples */
function studyPrompt(sec, notes, batch) {
  const S = SECTIONS[sec];
  return `You keep the "court knowledge" notes of a drafting app used by a court stenographer in ${settings.district}, Punjab, Pakistan, for ${settings.judge}. The notes teach the AI how this court writes ${S.label} documents (${S.desc}), so that new drafts come out right the first time.
Update the notes using the NEW SAMPLES below. They are final versions of the Judge's own documents, corrected and completed by the stenographer. Capture what they show:
- the structure of each kind of document and situation (e.g. ex-parte, contested, accepted, dismissed), with the headings in order;
- standard sentences and legal formulae, quoted word for word;
- provisions and case law cited, with the citations exactly as written;
- how the heading, Present block, dates, party descriptions, signature and certificate are written, and formatting such as bold, capitals and numbering;
- court practice and procedure visible in them (what is ordered when, costs, warnings, how the next date is written).
Keep everything in the current notes that is still true, merge instead of repeating, and correct anything the new samples contradict. Write only what the samples show; add no outside knowledge. Leave out the parties' names and other facts of particular cases. Organise the notes by kind of document. Plain text, at most about 1,800 words.

CURRENT NOTES:
${notes || "(empty)"}

NEW SAMPLES:
${batch.map((s, i) => `--- SAMPLE ${i + 1} (${s.subtype}${s.stage ? " / " + s.stage : ""}) ---\n${s.text}`).join("\n\n")}

Output only the updated notes.`;
}
async function studySamples(sec, list, fresh, onStep) {
  let notes = fresh ? "" : (digests[sec]?.text || ""), count = fresh ? 0 : (digests[sec]?.count || 0);
  const batches = []; let cur = [], size = 0;
  for (const s of list) {
    const t = String(s.text).slice(0, 30000), b = bytes(t);
    if (cur.length && size + b > 150 * 1024) { batches.push(cur); cur = []; size = 0; }
    cur.push({ subtype: s.subtype, stage: s.stage, text: t }); size += b;
  }
  if (cur.length) batches.push(cur);
  for (let i = 0; i < batches.length; i++) {
    onStep?.(`Studying the ${SECTIONS[sec].label} samples${batches.length > 1 ? ` (part ${i + 1} of ${batches.length})` : ""}`);
    const { text } = await sample(studyPrompt(sec, notes, batches[i]), { modelTier: "complex", effort: "medium" });
    if (text && text.trim().length > 50) notes = text.trim().slice(0, 20000);
    count += batches[i].length;
  }
  await col.doc("digest_" + sec).set({ kind: "digest", section: sec, text: notes, count, updatedAt: Date.now() });
}

/* Adding samples */
function skipNote(skipped, short) {
  let s = "";
  if (skipped.length) s += ` Skipped ${skipped.length} file${skipped.length > 1 ? "s" : ""} (${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ", ..." : ""}) that could not be read; only Word .docx, text files and pictures are supported, so save old .doc files as .docx first.`;
  if (short) s += ` ${short} file${short > 1 ? "s" : ""} had almost no text and ${short > 1 ? "were" : "was"} left out.`;
  return s;
}
/* A visible "working" box: spinner, moving bar, running seconds and steps that tick off as they finish. */
const fmtSecs = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };
function makeProgress(box) {
  let timer = null, t0 = 0;
  return {
    start(steps) {
      t0 = Date.now(); clearInterval(timer);
      box.innerHTML = `<div class="proghead"><span class="spin" aria-hidden="true"></span><strong class="ptitle"></strong><span class="progtime">0s</span></div><div class="bar" aria-hidden="true"><span></span></div><ol class="steps">${steps.map(([id, label]) => `<li data-step="${id}">${esc(label)}</li>`).join("")}</ol>`;
      box.hidden = false;
      this.step(steps[0][0]);
      timer = setInterval(() => { const el = box.querySelector(".progtime"); if (el) el.textContent = fmtSecs(Date.now() - t0); }, 1000);
      try { box.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {}
    },
    step(id, text) {
      let reached = false;
      box.querySelectorAll(".steps li").forEach(li => {
        if (li.dataset.step === id) { reached = true; li.className = "now"; if (text) li.textContent = text; }
        else if (!reached) li.className = "done";
      });
      const t = box.querySelector(".ptitle"), cur = box.querySelector(`li[data-step="${id}"]`);
      if (t && cur) t.textContent = cur.textContent + "...";
    },
    finish() { clearInterval(timer); box.hidden = true; box.innerHTML = ""; }
  };
}
const sProg = makeProgress($("#sProg")), dProg = makeProgress($("#dProg"));
const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;

async function addSampleFiles(fileList) {
  if (sBusy) return false;
  const files = [...fileList];
  if (!files.length) return false;
  if (!col) { status("#sStatus", "Not connected to the database, so samples cannot be saved.", true); return false; }
  const secSel = $("#s_section").value, typeSel = $("#s_type").value;
  const autoSort = !!sample && !(SECTIONS[secSel] && typeSel !== "auto");
  sBusy = true; renderSamplesBusy(); status("#sStatus", "");
  sProg.start([["read", `Reading ${plural(files.length, "file")}`], ...(autoSort ? [["sort", "Sorting by section and type"]] : []), ["save", "Saving the samples"], ...(sample ? [["study", "Studying the samples"]] : [])]);
  const docs = [], pics = [], skipped = [];
  try {
    let i = 0;
    for (const f of files) {
      i++;
      if (f.type.startsWith("image/")) { pics.push(f); continue; }
      sProg.step("read", files.length > 1 ? `Reading file ${i} of ${files.length}` : "Reading the file");
      if (/\.docx$/i.test(f.name)) { try { docs.push({ title: baseName(f.name), text: await docxText(f), source: "word" }); } catch (e) { skipped.push(f.name); } }
      else if (/\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/")) docs.push({ title: baseName(f.name), text: await f.text(), source: "text" });
      else skipped.push(f.name);
    }
    if (pics.length) {
      if (!sample) skipped.push(...pics.map(p => p.name));
      else {
        sProg.step("read", `Reading ${pics.length > 1 ? `the ${pics.length} pictures` : "the picture"} with the AI`);
        (await picturesText(pics)).forEach(text => docs.push({ title: baseName(pics[0].name), text, source: "pictures" }));
      }
    }
    const good = docs.filter(d => String(d.text || "").trim().length >= 150);
    const extra = skipNote(skipped, docs.length - good.length);
    if (!good.length) { status("#sStatus", ("No usable text was found." + extra).trim(), true); return false; }
    let classes;
    if (SECTIONS[secSel] && typeSel !== "auto") classes = good.map(() => ({ section: secSel, subtype: typeSel, stage: "" }));
    else if (sample) { sProg.step("sort", `Sorting ${plural(good.length, "sample")} by section and type`); classes = await classify(good, SECTIONS[secSel] ? secSel : ""); }
    else classes = good.map(d => validClass(SECTIONS[secSel] ? secSel : "", "", "", d.text));
    sProg.step("save", `Saving ${plural(good.length, "sample")}`);
    const bySec = {}, now = Date.now();
    for (let i = 0; i < good.length; i++) {
      const c = classes[i];
      const doc = fitDoc({ kind: "sample", section: c.section, subtype: c.subtype, stage: c.stage, title: niceTitle(good[i], c).slice(0, 120), text: good[i].text.trim(), source: good[i].source, createdAt: now + i }, ["text"]);
      await col.doc(rid("s_")).set(doc);
      (bySec[c.section] = bySec[c.section] || []).push(doc);
    }
    const added = `Added ${good.length} sample${good.length > 1 ? "s" : ""} (` + Object.entries(bySec).map(([k, v]) => `${SECTIONS[k].label}: ${v.length}`).join(", ") + ").";
    sampFilter = Object.keys(bySec)[0];
    if (!sample) { status("#sStatus", added + extra, false, true); return true; }
    try {
      for (const [sec, list] of Object.entries(bySec)) await studySamples(sec, list, false, m => sProg.step("study", m));
      status("#sStatus", "✓ " + added + (good.length > 1 ? " The app has studied them." : " The app has studied it.") + extra, false, true);
    } catch (e) { status("#sStatus", `${added} Studying them did not finish (${errText(e)}) Press "Study all samples again" later.${extra}`, true); }
    return true;
  } catch (e) { status("#sStatus", errText(e), true); return false; }
  finally { sProg.finish(); sBusy = false; renderSamples(); }
}
$("#s_section").addEventListener("change", fillSampleTypes);
$("#sFile").addEventListener("change", e => { addSampleFiles(e.target.files); e.target.value = ""; });
wireDrop($("#sDrop"), files => addSampleFiles(files));
$("#sPasteAdd").addEventListener("click", async () => {
  const text = $("#s_text").value.trim();
  if (text.length < 150) { status("#sStatus", "Paste the full text of the order or judgment first.", true); return; }
  const file = new File([text], ($("#s_title").value.trim() || "Pasted sample") + ".txt", { type: "text/plain" });
  if (await addSampleFiles([file])) { $("#s_text").value = ""; $("#s_title").value = ""; }
});
$("#digestRebuild").addEventListener("click", async () => {
  const sec = sampFilter, list = samples.filter(s => s.section === sec);
  if (sBusy || !sample || !list.length) return;
  sBusy = true; renderSamplesBusy(); status("#digestStatus", "");
  dProg.start([["study", `Studying ${list.length === 1 ? "the" : "all " + list.length} ${SECTIONS[sec].label} sample${list.length === 1 ? "" : "s"}`]]);
  try { await studySamples(sec, list, true, m => dProg.step("study", m)); status("#digestStatus", `✓ Done. The notes now cover ${list.length === 1 ? "the 1" : "all " + list.length} ${SECTIONS[sec].label} sample${list.length === 1 ? "" : "s"}.`, false, true); }
  catch (e) { status("#digestStatus", errText(e), true); }
  finally { dProg.finish(); sBusy = false; renderSamples(); }
});
/* Rules (Settings → Drafting): they apply to new drafts of the chosen section, or of every section; not to any sample. */
$("#l_section").innerHTML = `<option value="all">All sections</option>` + Object.entries(SECTIONS).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join("");
$("#l_add").addEventListener("click", async () => {
  const text = $("#l_text").value.trim();
  if (text.length < 5) { status("#l_status", "Write the rule first.", true); return; }
  if (!col) { status("#l_status", "Not connected to the database.", true); return; }
  try {
    await col.doc(rid("l_")).set({ kind: "lesson", section: $("#l_section").value, subtype: "", text: text.slice(0, 600), by: "you", createdAt: Date.now() });
    $("#l_text").value = ""; status("#l_status", "Rule added.", false, true);
  } catch (e) { status("#l_status", "Could not add the rule.", true); }
});

/* ---------- Settings ---------- */
function renderSettings() {
  $("#set_judge").value = settings.judge; $("#set_district").value = settings.district; $("#set_rules").value = settings.rules; $("#set_chips").value = settings.chips; $("#set_ada").value = settings.ada || ""; $("#set_adpp").value = settings.adpp || "";
  $("#set_caselaw").value = settings.caseLaw || ""; $("#set_asj").value = settings.asJail || ""; $("#set_debug").checked = !!settings.debug;
  COURT_KINDS.forEach(([k]) => { $("#set_c_" + k).value = courtName(k); });
}
let setDirty = false;   // settings typed but not saved yet: kept as they are when the team's data refreshes
["#settingsView", "#draftingView"].forEach(sel => $(sel).addEventListener("input", () => { setDirty = true; }));
async function saveSettings(btn, statusSel) {
  const courts = {}; COURT_KINDS.forEach(([k]) => { courts[k] = $("#set_c_" + k).value.trim() || DEFAULT_COURTS[k]; });
  settings = { judge: $("#set_judge").value.trim() || settings.judge, district: $("#set_district").value.trim() || settings.district, courts, rules: $("#set_rules").value, chips: $("#set_chips").value.trim(), ada: $("#set_ada").value.trim(), adpp: $("#set_adpp").value.trim(),
    caseLaw: $("#set_caselaw").value.trim(), asJail: $("#set_asj").value.trim(), debug: $("#set_debug").checked };
  renderChips();
  if (!col) { status(statusSel, "Not connected to the database, so the settings were not saved.", true); toast("Settings were not saved: not connected to the database.", 5000); return; }
  btn.disabled = true; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>Saving`;
  try {
    await col.doc("settings").set({ kind: "settings", ...settings, updatedAt: Date.now() });
    setDirty = false;
    ["#setStatus", "#setStatusD"].forEach(sel => status(sel, ""));
    status(statusSel, "Settings saved at " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + ".", false, true);
    toast("Settings saved.", 3000);
    btn.textContent = "Saved ✓"; setTimeout(() => { btn.textContent = "Save"; }, 2500);
  } catch (e) { status(statusSel, "Could not save. Please try again.", true); toast("Settings could not be saved. Please try again.", 5000); btn.textContent = "Save"; }
  finally { btn.disabled = false; }
}
$("#setSave").addEventListener("click", e => saveSettings(e.currentTarget, "#setStatus"));
$("#setSaveD").addEventListener("click", e => saveSettings(e.currentTarget, "#setStatusD"));


function renderCounts() { $("#histCount").textContent = cases.length; $("#sampCount").textContent = samples.length; }

/* ---------- Team: members, invitations, your name (shared data lives with the team) ---------- */
const ROLE_LABEL = { admin: "Admin", member: "Member" };
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
const delFail = () => toast("Could not delete it. Only the person who saved it, or the team admin, can delete it.", 6000);
function renderUserBox() {
  $("#ubName").textContent = ctx.profile.full_name || ctx.profile.email;
  $("#ubTeam").textContent = ctx.team.name;
}
$("#signOutBtn").addEventListener("click", () => teamApi.signOut());
$("#teamSignOut").addEventListener("click", () => teamApi.signOut());

async function renderTeam() {
  const isAdmin = ctx.profile.role === "admin";
  $("#teamName").textContent = ctx.team.name;
  $("#teamRole").textContent = isAdmin ? "You are the admin" : "You are a member";
  $("#inviteCard").hidden = !isAdmin; $("#renameCard").hidden = !isAdmin;
  $("#meName").value = ctx.profile.full_name || ""; $("#teamRename").value = ctx.team.name;
  $("#memberList").innerHTML = `<p class="ur" lang="ur" dir="rtl">ممبر لوڈ ہو رہے ہیں...</p>`;
  try {
    const list = await teamApi.members();
    members = Object.fromEntries(list.map(m => [m.id, m.full_name || m.email]));
    $("#memberList").innerHTML = list.map(m => `<div class="item"><div><h4>${esc(m.full_name || m.email)}${m.id === uid ? " (you)" : ""}</h4>
        <div class="meta"><span class="chip">${esc(ROLE_LABEL[m.role] || m.role)}</span>${esc(m.email)}</div></div>
      ${isAdmin && m.id !== uid ? `<div class="row"><button class="btn plain" data-role="${m.id}" data-to="${m.role === "admin" ? "member" : "admin"}">${m.role === "admin" ? "Make member" : "Make admin"}</button><button class="btn danger" data-remove="${m.id}">Remove</button></div>` : ""}</div>`).join("");
    $$("#memberList [data-role]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await teamApi.setRole(b.dataset.role, b.dataset.to); toast("Role changed.", 3000); } catch (e) { toast(e.message, 6000); }
      renderTeam();
    }));
    $$("#memberList [data-remove]").forEach(b => b.addEventListener("click", () => confirmInline(b, async () => {
      try { await teamApi.remove(b.dataset.remove); toast("Member removed.", 3000); } catch (e) { toast(e.message, 6000); }
      renderTeam();
    })));
  } catch (e) { $("#memberList").innerHTML = `<p class="status err">${esc(e.message)}</p>`; }
  if (isAdmin) renderInvites();
  renderUsage();
}
async function renderInvites() {
  const box = $("#inviteList");
  try {
    const list = await teamApi.invites();
    box.innerHTML = list.length ? `<strong style="margin-top:6px">Waiting for acceptance</strong>` + list.map(i => `<div class="item"><div><h4>${esc(i.email)}</h4>
        <div class="meta"><span class="chip">${esc(ROLE_LABEL[i.role] || i.role)}</span>sent ${new Date(i.created_at).toLocaleDateString("en-GB")}</div></div>
        <button class="btn danger" data-revoke="${i.id}">Cancel</button></div>`).join("") : "";
    $$("#inviteList [data-revoke]").forEach(b => b.addEventListener("click", () => confirmInline(b, async () => {
      try { await teamApi.revoke(b.dataset.revoke); } catch (e) { toast(e.message, 6000); }
      renderInvites();
    })));
  } catch (e) { box.innerHTML = `<p class="status err">${esc(e.message)}</p>`; }
}
async function renderUsage() {
  try {
    const u = await teamApi.usageThisMonth();
    $("#usageLine").textContent = u.count
      ? `${u.count} AI request${u.count === 1 ? "" : "s"} · ${fmtK(u.input)} input + ${fmtK(u.output)} output tokens${u.model ? " · model: " + u.model : ""}`
      : "No AI requests yet this month.";
  } catch (e) { $("#usageLine").textContent = "Usage is not available right now."; }
}
$("#invSend").addEventListener("click", async () => {
  const email = $("#invEmail").value.trim().toLowerCase(), role = $("#invRole").value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status("#invStatus", "Please enter a valid email address.", true); $("#invEmail").focus(); return; }
  const btn = $("#invSend"); btn.disabled = true;
  try {
    await teamApi.invite(email, role);
    $("#invEmail").value = "";
    status("#invStatus", `Invitation sent. ${email} can now register or log in with this email and accept it.`, false, true);
    renderInvites();
  } catch (e) { status("#invStatus", e.message, true); }
  finally { btn.disabled = false; }
});
$("#invEmail").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#invSend").click(); } });
$("#meSave").addEventListener("click", async () => {
  const name = $("#meName").value.trim();
  if (name.length < 2) { status("#meStatus", "Please enter your name.", true); return; }
  try { await teamApi.updateName(name); ctx.profile.full_name = name; renderUserBox(); status("#meStatus", "Name saved.", false, true); }
  catch (e) { status("#meStatus", e.message, true); }
});
$("#teamRenameBtn").addEventListener("click", async () => {
  const name = $("#teamRename").value.trim();
  if (name.length < 2) { status("#teamRenameStatus", "Please enter the team name.", true); return; }
  try { await teamApi.rename(name); ctx.team.name = name; renderUserBox(); $("#teamName").textContent = name; status("#teamRenameStatus", "Team renamed.", false, true); }
  catch (e) { status("#teamRenameStatus", e.message, true); }
});
$("#leaveTeamBtn").addEventListener("click", () => confirmInline($("#leaveTeamBtn"), async () => {
  try { await teamApi.leave(); location.reload(); } catch (e) { status("#teamStatus", e.message, true); }
}));

/* ---------- Boot ---------- */
let railOpen = true; try { railOpen = localStorage.getItem("fd_rail") !== "closed"; } catch (e) {}
setRail(railOpen);
renderUserBox();
// The app always opens on the daily work, never on Settings.
let startView = "order"; try { startView = localStorage.getItem("fd_view") || "order"; } catch (e) {}
if (SET_TABS.includes(startView)) startView = "order";
show(startView);
renderCounts();
renderReady();
imgMax = Math.min(ctx.imgMax || imgMax, 20);
teamApi.members().then(list => {
  members = Object.fromEntries(list.map(m => [m.id, m.full_name || m.email]));
  if (view === "history") renderHistory();
}).catch(() => {});

const connTimer = setTimeout(() => { $("#conn").hidden = false; $("#conn").textContent = "The database is not responding yet. Check your internet connection; your data will appear as soon as it arrives."; }, 10000);
$("#conn").textContent = "Loading your team's data...";
col.onSnapshot(snap => {
  clearTimeout(connTimer);
  const all = snap.docs.map(x => ({ id: x.id, ...x.data() }));
  cases = all.filter(x => x.kind === "case");
  lessons = all.filter(x => x.kind === "lesson" && x.text);
  samples = all.filter(x => x.kind === "sample" && x.text);
  digests = Object.fromEntries(all.filter(x => x.kind === "digest" && x.section).map(x => [x.section, x]));
  const st = all.find(x => x.id === "settings");
  if (st) {
    const str = (v, d) => typeof v === "string" ? v : d;
    settings = { judge: st.judge || settings.judge, district: st.district || settings.district, courts: (st.courts && typeof st.courts === "object") ? { ...DEFAULT_COURTS, ...st.courts } : settings.courts, rules: st.rules ?? settings.rules, chips: str(st.chips, settings.chips), ada: str(st.ada, settings.ada), adpp: str(st.adpp, settings.adpp),
      caseLaw: str(st.caseLaw, settings.caseLaw), asJail: str(st.asJail, settings.asJail), debug: !!st.debug };
    if (settings.courts.rent === OLD_RENT_COURT) settings.courts.rent = DEFAULT_COURTS.rent;   // the old default follows the new one; a court's own wording stays
  }
  $("#brandSub").textContent = settings.district ? settings.district + " courts" : "Court drafting desk";
  renderCounts();
  if (view === "history") renderHistory();
  if (view === "samples") renderSamples();
  if (view === "drafting") renderRules();
  renderChips();
  if ((view === "settings" || view === "drafting") && !setDirty && !$("#setShell").contains(document.activeElement)) renderSettings();
  if (current && SECTIONS[view] && view !== "order") { renderCourt(); if (isIdParade() && !$("#idpBox").contains(document.activeElement)) renderIdp(); }
  if (current) renderAfterDraft();
  $("#conn").hidden = true;
}, (e) => {
  clearTimeout(connTimer);
  $("#conn").hidden = false;
  $("#conn").textContent = "Could not load your team's data (" + (e?.message || "connection problem") + "). Please reload the page.";
});
}
