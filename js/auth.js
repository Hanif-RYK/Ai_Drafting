// Login, registration, password reset and team membership screens.
// When the signed-in user belongs to a team, onReady({ profile, team, teamApi }) is called once.
import { KEY_HELP, fillModels, keyRequest, keyErrText } from "./aikeys.js";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DESIGNATIONS = ["Judge", "Stenographer", "Computer Operator", "Ahlmad"];

/* Designation: one of the list, or "Other" with the person's own words. */
export function readDesignation(select, other) {
  if (select.value === "Other") return other.value.trim().replace(/\s+/g, " ").slice(0, 40);
  return select.value;
}
export function showDesignation(select, otherWrap, other, value) {
  const known = DESIGNATIONS.includes(value);
  select.value = !value ? "" : known ? value : "Other";
  otherWrap.hidden = select.value !== "Other";
  other.value = known ? "" : (value || "");
}

/* Invitation link: #invite=<email>&team=<team name>. It only fills in the sign-up form; the invitation
   itself is accepted after signing in with that same email (the database checks it). */
function readInviteLink() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const email = (h.get("invite") || "").trim().toLowerCase();
  if (email && EMAIL_RE.test(email)) {
    const inv = { email, team: (h.get("team") || "").slice(0, 80) };
    try { sessionStorage.setItem("ad_invite", JSON.stringify(inv)); } catch (e) { /* private mode */ }
    history.replaceState(null, "", location.pathname + location.search);
    return inv;
  }
  try { return JSON.parse(sessionStorage.getItem("ad_invite") || "null"); } catch (e) { return null; }
}

export function initAuth(sb, onReady) {
  let user = null, profile = null, team = null, readyCalled = false;

  /* ---------- screens ---------- */
  function showScreen(name) {
    $("authScreen").hidden = name !== "auth";
    $("teamScreen").hidden = name !== "team";
    $("app").hidden = name !== "app";
  }
  function showForm(which) {
    ["login", "register", "reset", "newPass"].forEach((f) => { $(f + "Form").hidden = f !== which; });
    document.querySelectorAll(".pwwrap input").forEach((i) => { i.type = "password"; });
    document.querySelectorAll("[data-pw]").forEach((b) => { b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", "Show password"); b.title = "Show password"; b.classList.remove("on"); });
    msg("");
    const first = $(which + "Form").querySelector("input");
    if (first && !matchMedia("(pointer:coarse)").matches) first.focus();
  }
  function msg(text, type) {
    const el = $("authMsg");
    el.textContent = text;
    el.className = "status" + (type === "err" ? " err" : type === "ok" ? " okk" : "");
  }
  function tsMsg(text, type) {
    const el = $("tsMsg");
    el.textContent = text;
    el.className = "status" + (type === "err" ? " err" : type === "ok" ? " okk" : "");
  }
  async function busy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = old; }
  }
  document.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => showForm(b.dataset.auth)));
  // Show / hide password: the eye button inside each password box
  document.querySelectorAll("[data-pw]").forEach((b) => b.addEventListener("click", () => {
    const input = b.parentElement.querySelector("input"), show = input.type === "password";
    input.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute("aria-label", show ? "Hide password" : "Show password"); b.title = b.getAttribute("aria-label");
    b.classList.toggle("on", show);
  }));

  /* ---------- login / register / reset ---------- */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("loginEmail").value.trim(), password = $("loginPassword").value;
    if (!email || !password) { msg("Please enter your email and password.", "err"); return; }
    await busy($("loginBtn"), "Logging in...", async () => {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { msg(friendlyAuthError(error), "err"); return; }
      msg("");
      await afterLogin(data.user);
    });
  });

  $("regDesig").addEventListener("change", () => { $("regDesigOtherWrap").hidden = $("regDesig").value !== "Other"; if ($("regDesig").value === "Other") $("regDesigOther").focus(); });
  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = $("regName").value.trim(), email = $("regEmail").value.trim(), password = $("regPassword").value;
    const designation = readDesignation($("regDesig"), $("regDesigOther"));
    if (!full_name) { msg("Please enter your full name.", "err"); return; }
    if (!$("regDesig").value) { msg("Please choose your designation.", "err"); $("regDesig").focus(); return; }
    if (designation.length < 2) { msg("Please write your designation.", "err"); $("regDesigOther").focus(); return; }
    if (!EMAIL_RE.test(email)) { msg("Please enter a valid email address.", "err"); return; }
    if (password.length < 8) { msg("The password must be at least 8 characters.", "err"); return; }
    await busy($("registerBtn"), "Creating account...", async () => {
      // The profile row is created by a database trigger (supabase/schema.sql)
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, designation } } });
      if (error) { msg(friendlyAuthError(error), "err"); return; }
      if (data.session && data.user) { await afterLogin(data.user); return; }
      // Email confirmation is on: the user must click the link first
      showForm("login");
      $("loginEmail").value = email;
      msg("Account created. Please open the confirmation email we sent to " + email + ", then log in here.", "ok");
    });
  });

  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("resetEmail").value.trim();
    if (!EMAIL_RE.test(email)) { msg("Please enter a valid email address.", "err"); return; }
    await busy(e.submitter || $("resetForm").querySelector("button[type=submit]"), "Sending...", async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) { msg(friendlyAuthError(error), "err"); return; }
      msg("If an account exists for " + email + ", a password reset link has been sent. Open it on this device.", "ok");
    });
  });

  $("newPassForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("newPassword").value;
    if (password.length < 8) { msg("The password must be at least 8 characters.", "err"); return; }
    await busy(e.submitter || $("newPassForm").querySelector("button[type=submit]"), "Saving...", async () => {
      const { data, error } = await sb.auth.updateUser({ password });
      if (error) { msg(friendlyAuthError(error), "err"); return; }
      history.replaceState(null, "", location.pathname + location.search);
      msg("Password saved.", "ok");
      await afterLogin(data.user);
    });
  });

  function friendlyAuthError(error) {
    const m = String(error?.message || "");
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/email not confirmed/i.test(m)) return "Please confirm your email first (check your inbox), then log in.";
    if (/already registered|already been registered/i.test(m)) return "An account with this email already exists. Log in instead.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
    if (/fetch|network/i.test(m)) return "Could not reach the server. Check your internet connection.";
    return m || "Something went wrong. Please try again.";
  }

  /* ---------- profile and team ---------- */
  async function loadProfile() {
    let { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const r = await sb.rpc("ensure_profile");
      if (r.error) throw r.error;
      data = r.data;
    }
    return data;
  }

  async function afterLogin(u) {
    user = u;
    try {
      profile = await loadProfile();
    } catch (e) {
      showScreen("auth"); showForm("login");
      msg("Could not load your profile (" + (e.message || "connection problem") + "). Check your internet connection and try again. If this keeps happening, make sure supabase/schema.sql has been run in Supabase.", "err");
      return;
    }
    if (!profile.team_id) { await showTeamScreen(); return; }
    const { data: t, error } = await sb.from("teams").select("*").eq("id", profile.team_id).maybeSingle();
    if (error || !t) {
      showScreen("team");
      $("tsName").textContent = profile.full_name || profile.email;
      tsMsg("Could not load your team (" + (error?.message || "not found") + "). Please reload the page.", "err");
      return;
    }
    team = t;
    try { sessionStorage.removeItem("ad_invite"); } catch (e) { /* private mode */ }
    showScreen("app");
    if (!readyCalled) { readyCalled = true; onReady({ profile, team, teamApi: makeTeamApi() }); }
  }

  async function showTeamScreen() {
    showScreen("team");
    $("tsName").textContent = profile.full_name || profile.email;
    tsMsg("");
    await renderInvites();
  }

  async function renderInvites() {
    const box = $("tsInvites");
    box.innerHTML = `<p class="note">Looking for invitations...</p>`;
    const { data, error } = await sb.from("team_invites")
      .select("id, team_name, role, invited_by_name, created_at")
      .eq("status", "pending").eq("email", String(profile.email || "").toLowerCase())
      .order("created_at", { ascending: false });
    if (error) { box.innerHTML = `<p class="status err">${esc(error.message)}</p>`; return; }
    if (!data.length) {
      box.innerHTML = `<p class="note">No invitations for <b>${esc(profile.email)}</b> yet. Ask your team's admin to invite this email, then press "Check again".</p>`;
      $("newCourt").open = !invite;
      return;
    }
    $("newCourt").open = false;
    box.innerHTML = `<strong>Invitations</strong>` + data.map((i) => `
      <div class="item">
        <div><h4>${esc(i.team_name)}</h4><div class="meta">Invited by ${esc(i.invited_by_name || "the team admin")} · as ${esc(i.role)}</div></div>
        <div class="row"><button class="btn" data-acc="${i.id}">Accept</button><button class="btn danger" data-dec="${i.id}">Decline</button></div>
      </div>`).join("");
    box.querySelectorAll("[data-acc]").forEach((b) => b.addEventListener("click", () => busy(b, "Joining...", async () => {
      const { error } = await sb.rpc("accept_invite", { p_invite: b.dataset.acc });
      if (error) { tsMsg(error.message, "err"); return; }
      await afterLogin(user);
    })));
    box.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => busy(b, "...", async () => {
      const { error } = await sb.rpc("decline_invite", { p_invite: b.dataset.dec });
      if (error) { tsMsg(error.message, "err"); return; }
      await renderInvites();
    })));
  }

  function renderKeyChoices() {
    const p = $("tsProvider").value;
    fillModels($("tsModel"), p, $("tsModel").value);
    $("tsKeyHelp").textContent = KEY_HELP[p];
  }
  $("tsProvider").addEventListener("change", renderKeyChoices);
  renderKeyChoices();
  $("createTeamForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("teamNameInput").value.trim(), key = $("tsKey").value.trim();
    if (name.length < 2) { tsMsg("Please enter the court (team) name.", "err"); $("teamNameInput").focus(); return; }
    if (key.length < 20) { tsMsg("Please paste your AI key.", "err"); $("tsKey").focus(); return; }
    await busy($("createTeamBtn"), "Checking the key...", async () => {
      try {
        await keyRequest(sb, { action: "setup_team", team_name: name, provider: $("tsProvider").value, model: $("tsModel").value, key });
      } catch (err) { tsMsg(keyErrText(err), "err"); return; }
      $("tsKey").value = "";
      try { localStorage.setItem("ad_setup", "1"); } catch (x) { /* the app still opens */ }
      await afterLogin(user);
    });
  });
  $("tsRefresh").addEventListener("click", () => renderInvites());
  $("tsSignOut").addEventListener("click", () => signOut());

  async function signOut() {
    try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
    location.reload();
  }

  function makeTeamApi() {
    const teamId = team.id;
    const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };
    return {
      profile, team,
      async members() {
        const { data, error } = await sb.from("profiles").select("id, full_name, email, role, designation, created_at").eq("team_id", teamId).order("created_at");
        if (error) throw error;
        return data || [];
      },
      async invites() {
        const { data, error } = await sb.from("team_invites").select("id, email, role, created_at").eq("team_id", teamId).eq("status", "pending").order("created_at", { ascending: false });
        if (error) throw error;
        return data || [];
      },
      invite: (email, role) => rpc("invite_member", { p_email: email, p_role: role }),
      revoke: (id) => rpc("revoke_invite", { p_invite: id }),
      remove: (userId) => rpc("remove_member", { p_user: userId }),
      setRole: (userId, role) => rpc("set_member_role", { p_user: userId, p_role: role }),
      leave: () => rpc("leave_team"),
      rename: (name) => rpc("rename_team", { p_name: name }),
      async updateProfile({ full_name, designation }) {
        const { error } = await sb.from("profiles").update({ full_name, designation }).eq("id", profile.id);
        if (error) throw error;
        profile.full_name = full_name; profile.designation = designation;
      },
      // The team's AI key: what is saved (never the key itself), and changing / testing it (admin only)
      async aiInfo() {
        const { data, error } = await sb.rpc("team_ai_info");
        if (error) throw error;
        return (Array.isArray(data) ? data[0] : data) || null;
      },
      setKey: ({ provider, key, model }) => keyRequest(sb, { action: "set_key", provider, key, model }),
      testKey: () => keyRequest(sb, { action: "test_key" }),
      inviteLink(email) {
        const base = location.origin + location.pathname;
        return `${base}#invite=${encodeURIComponent(email)}&team=${encodeURIComponent(team.name)}`;
      },
      // The user's own quick words (Settings → Quick words); the built-in ones live in the app's code.
      async saveQuickWords(text) {
        const { error } = await sb.from("profiles").update({ quick_words: text }).eq("id", profile.id);
        if (error) throw error;
        profile.quick_words = text;
      },
      // Inbox: drafts sent to this user. The database lets each user see only messages sent to or by them.
      inbox: {
        // The list leaves out the drafts themselves (they can be large); get() fetches one when it is opened.
        async list() {
          const { data, error } = await sb.from("inbox").select("id, team_id, from_user, to_user, case_id, title, section, subtype, note, cause_no, cause_date, created_at, read_at")
            .eq("to_user", profile.id).order("created_at", { ascending: false }).limit(200);
          if (error) throw error;
          return data || [];
        },
        async get(id) {
          const { data, error } = await sb.from("inbox").select("data").eq("id", id).maybeSingle();
          if (error) throw error;
          return data?.data || null;
        },
        async send(msg) {
          // team_id, from_user and the time are set again by the database; they are sent for the NOT NULL columns
          const { error } = await sb.from("inbox").insert({ ...msg, team_id: teamId, from_user: profile.id });
          if (error) throw error;
        },
        async markRead(ids) {
          if (!ids.length) return;
          const { error } = await sb.rpc("inbox_mark_read", { p_ids: ids });
          if (error) throw error;
        },
        async remove(id) {
          const { error, count } = await sb.from("inbox").delete({ count: "exact" }).eq("id", id);
          if (error) throw error;
          if (count === 0) throw new Error("Not allowed to remove this message");
        },
        watch(cb) {
          const ch = sb.channel(`inbox-${profile.id}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "inbox", filter: `to_user=eq.${profile.id}` }, cb)
            .subscribe();
          return () => sb.removeChannel(ch);
        },
      },
      async usageThisMonth() {
        const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
        const { data, error } = await sb.from("ai_usage").select("input_tokens, output_tokens, model, created_at").gte("created_at", from.toISOString()).order("created_at", { ascending: false });
        if (error) throw error;
        const total = (data || []).reduce((a, r) => ({ count: a.count + 1, input: a.input + (r.input_tokens || 0), output: a.output + (r.output_tokens || 0) }), { count: 0, input: 0, output: 0 });
        return { ...total, model: data?.[0]?.model || "" };   // the model used most recently
      },
      signOut,
    };
  }

  /* ---------- session events ---------- */
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") { showScreen("auth"); showForm("newPass"); }
    if (event === "SIGNED_OUT" && readyCalled) location.reload();
  });
  // If this user was removed from the team (or moved) while the page was open, start over
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !readyCalled) return;
    const { data } = await sb.from("profiles").select("team_id, role").eq("id", profile.id).maybeSingle();
    if (data && (data.team_id !== profile.team_id || data.role !== profile.role)) location.reload();
  });

  /* ---------- boot ---------- */
  const invite = readInviteLink();
  function showInvite() {
    if (!invite) return;
    $("regEmail").value = invite.email; $("loginEmail").value = invite.email;
    const note = $("inviteNote");
    note.innerHTML = `You have been invited${invite.team ? ` to join <b>${esc(invite.team)}</b>` : ""}. Create your account with this email: <b>${esc(invite.email)}</b>. Already have an account? <button type="button" class="linkbtn" data-auth="login">Log in</button>`;
    note.hidden = false;
    note.querySelector("[data-auth]").addEventListener("click", () => showForm("login"));
  }
  (async () => {
    const recovery = /type=recovery/.test(location.hash);
    const { data } = await sb.auth.getSession();
    if (recovery) { showScreen("auth"); showForm("newPass"); return; }
    if (data?.session?.user) await afterLogin(data.session.user);
    else { showScreen("auth"); showForm(invite ? "register" : "login"); showInvite(); }
  })();
}
