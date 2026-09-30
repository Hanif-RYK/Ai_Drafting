// Supabase client (the anon key is public; data is protected by RLS, see supabase/rls_policies.sql)
const SUPABASE_URL = "https://atnjolykwqgzouqvorfe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0bmpvbHlrd3Fnem91cXZvcmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDM3MTUsImV4cCI6MjA5Nzk3OTcxNX0.7xA6LCJ--DfDgiatWijyMAs_TtfKcpc8TxVj6vZImSY";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Synchronous check to prevent login screen flicker on page reload
(function preventFlicker() {
  const tokenKey = "sb-atnjolykwqgzouqvorfe-auth-token";
  if (localStorage.getItem(tokenKey)) {
    const loginEl = document.getElementById("loginScreen");
    if (loginEl) loginEl.classList.add("hidden");
  }
})();

document.querySelectorAll("textarea, input:not([type=hidden]):not([type=file])").forEach(el => el.dir = "auto");

// Show current date in header
document.getElementById("currentDate").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const $ = (id) => document.getElementById(id);
let currentProfile = null; // { id, full_name, role }

// Password show/hide toggle
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pw-toggle");
  if (!btn) return;
  const input = $(btn.dataset.target);
  if (!input) return;
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  btn.textContent = isPassword ? "Hide" : "Show";
});

// ============================================
// AUTH
// ============================================
async function checkExistingSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    await onLoginSuccess(data.session.user);
  } else {
    // If we hid it on reload but session actually expired/invalid, show it again
    const loginEl = document.getElementById("loginScreen");
    if (loginEl) loginEl.classList.remove("hidden");
  }
}

$("loginBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) { showLoginError("Email aur password dono bharain."); return; }

  $("loginBtn").disabled = true;
  $("spin-login").classList.remove("hidden");
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await onLoginSuccess(data.user);
  } catch (err) {
    showLoginError("Login fail: " + err.message);
  } finally {
    $("loginBtn").disabled = false;
    $("spin-login").classList.add("hidden");
  }
});

function showLoginError(msg) {
  $("loginError").textContent = msg;
  $("loginError").classList.remove("hidden");
}

async function onLoginSuccess(user) {
  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error || !profile) {
    showLoginError("Profile nahi mila. Pehle profiles table mein apna UUID add karein.");
    await sb.auth.signOut();
    return;
  }
  if (profile.status === 'pending') {
    showLoginError("⏳ Account pending hai. Approval ka wait karein.");
    await sb.auth.signOut();
    return;
  }

  if (profile.status === 'rejected') {
    showLoginError("❌ Account reject kar diya gaya hai.");
    await sb.auth.signOut();
    return;
  }

  currentProfile = profile;
  $("adminPanelBtn").classList.toggle("hidden", !profile.is_admin);
  if (profile.is_admin) refreshPendingBadge();

  $("loginScreen").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  const roleLabels = { judge: "Judge", steno: "Steno", user: "User" };
  $("menuUserName").textContent = profile.full_name;
  $("menuUserRole").textContent = roleLabels[profile.role] || profile.role;
  await loadGlossary();
  await loadDashboardCounts();
  showDashboard();
}

// Modals: close on backdrop tap or Escape
document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal:not(.hidden)")].pop();
  if (open) open.classList.add("hidden");
  else if ($("sidebarMenu").classList.contains("active")) closeSidebar();
});

// Sidebar menu functions
function openSidebar() {
  $("sidebarMenu").classList.add("active");
  $("sidebarOverlay").classList.add("active");
}
function closeSidebar() {
  $("sidebarMenu").classList.remove("active");
  $("sidebarOverlay").classList.remove("active");
}
$("menuBtn").addEventListener("click", openSidebar);
$("sidebarOverlay").addEventListener("click", closeSidebar);
$("closeSidebarBtn").addEventListener("click", closeSidebar);

// Close sidebar when clicking menu options
$("sidebarMenu").addEventListener("click", (e) => {
  if (e.target.closest(".menu-item")) {
    closeSidebar();
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await flushAutosave();
  await stopLiveMode();
  closeLiveTypeEditor();
  await sb.auth.signOut();
  // Reset per-user state so the next login starts clean
  currentProfile = null;
  activeCase = null;
  glossaryCache = [];
  $("adminPanelBtn").classList.add("hidden");
  $("mainApp").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
});

window.addEventListener("DOMContentLoaded", checkExistingSession);

// ============================================
// ADMIN PANEL
// ============================================
// Court admin approves / rejects users of their own court (RLS limits the list to that court)
const ROLE_LABELS = { judge: "👨‍⚖️ Judge", steno: "📝 Steno", user: "👤 User" };

async function refreshPendingBadge() {
  const { count } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending");
  $("pendingBadge").textContent = count || "";
  $("pendingBadge").classList.toggle("hidden", !count);
}

function renderUserRow(u, actions) {
  return `
    <div class="user-row">
      <p class="item-title">${escapeHtml(u.full_name)}</p>
      <p class="item-meta">${escapeHtml(u.email || "")} · ${ROLE_LABELS[u.role] || escapeHtml(u.role)}</p>
      <div class="btn-row mt-2">${actions}</div>
    </div>`;
}

async function loadAdminPanel() {
  const list = $("pendingUsersList");
  list.innerHTML = `<p class="empty">Loading...</p>`;
  const { data, error } = await sb.from("profiles")
    .select("id, full_name, email, role, status")
    .in("status", ["pending", "rejected"])
    .order("created_at", { ascending: false });
  if (error) { list.innerHTML = `<p class="empty text-red-600">${escapeHtml(error.message)}</p>`; return; }

  const pending = data.filter(u => u.status === "pending");
  const rejected = data.filter(u => u.status === "rejected");
  const approveBtn = (u) => `<button class="user-status-btn btn btn-success btn-sm" data-id="${u.id}" data-status="active">✅ Approve</button>`;
  const rejectBtn = (u) => `<button class="user-status-btn btn btn-danger-soft btn-sm" data-id="${u.id}" data-status="rejected">❌ Reject</button>`;

  list.innerHTML =
    `<h4 class="section-title">⏳ Approval ka wait (${pending.length})</h4>` +
    (pending.length
      ? pending.map(u => renderUserRow(u, approveBtn(u) + rejectBtn(u))).join("")
      : `<p class="empty">Koi pending user nahi hai.</p>`) +
    (rejected.length
      ? `<h4 class="section-title mt-5">❌ Rejected (${rejected.length})</h4>` +
        rejected.map(u => renderUserRow(u, approveBtn(u))).join("")
      : "");
}

$("adminPanelBtn").addEventListener("click", async () => {
  $("adminPanelModal").classList.remove("hidden");
  await loadAdminPanel();
});

$("pendingUsersList").addEventListener("click", async (e) => {
  const btn = e.target.closest(".user-status-btn");
  if (!btn) return;
  const status = btn.dataset.status;
  if (status === "rejected" && !confirm("Is user ko reject karna hai?")) return;
  btn.disabled = true;
  const { error } = await sb.from("profiles").update({ status }).eq("id", btn.dataset.id);
  if (error) {
    btn.disabled = false;
    showToast("Update fail: " + error.message, "error");
    return;
  }
  showToast(status === "active" ? "User approve ho gaya!" : "User reject ho gaya.", "success");
  await loadAdminPanel();
  await refreshPendingBadge();
});

$("closeAdminPanelBtn").addEventListener("click", () => $("adminPanelModal").classList.add("hidden"));

// ============================================
// REGISTER (Sign Up)
// ============================================
let regSelectedRole = null;

$("toggleAuthBtn").addEventListener("click", () => {
  const loginForm = $("loginForm");
  const regForm = $("registerForm");
  const toggleBtn = $("toggleAuthBtn");
  const isLogin = !loginForm.classList.contains("hidden");

  loginForm.classList.toggle("hidden", isLogin);
  regForm.classList.toggle("hidden", !isLogin);
  toggleBtn.textContent = isLogin ? "← Login" : "📝 Register karein";
  $("loginError").classList.add("hidden");
  $("regSuccess").classList.add("hidden");
  regSelectedRole = null;
  document.querySelectorAll(".reg-role-btn").forEach(b => b.classList.remove("active"));
  $("regExtraFields").classList.add("hidden");
});

document.querySelectorAll(".reg-role-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    regSelectedRole = btn.dataset.role;
    document.querySelectorAll(".reg-role-btn").forEach(b => b.classList.toggle("active", b === btn));

    $("regExtraFields").classList.remove("hidden");
  });
});

$("registerBtn").addEventListener("click", async () => {
  const name = $("regName").value.trim();
  const email = $("regEmail").value.trim();
  const password = $("regPassword").value;
  const courtName = $("regCourtName").value.trim();
  if (!name || !email || !password) { showLoginError("Name, email aur password bharain."); return; }
  if (!regSelectedRole) { showLoginError("Role select karein."); return; }
  if (password.length < 8) { showLoginError("Password kam az kam 8 characters ka hona chahiye."); return; }
  if (!courtName) { showLoginError("Court name bharain."); return; }

  $("registerBtn").disabled = true;
  $("spin-register").classList.remove("hidden");
  try {
    // The profile row is created by a database trigger (see supabase/rls_policies.sql),
    // so status / admin rights can't be chosen from the browser.
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          role: regSelectedRole,
          court_name: courtName
        }
      }
    });
    if (error) throw error;
    if (!data.user) throw new Error("Signup fail - user nahi mila");
    // signUp may auto-login; the account still has to be approved first
    if (data.session) await sb.auth.signOut();

    $("regSuccess").textContent = (data.session ? "✅ Register ho gaya! " : "✅ Register ho gaya! Pehle apni email confirm karein. ")
      + "Agar aap apni court ke pehle user hain to aap court admin hain — seedha login karein. Warna court admin ki approval ka wait karein.";
    $("regSuccess").classList.remove("hidden");
    $("loginError").classList.add("hidden");

    $("loginForm").classList.remove("hidden");
    $("registerForm").classList.add("hidden");
    $("toggleAuthBtn").textContent = "📝 Register karein";
    $("loginEmail").value = email;
    $("loginPassword").value = "";
  } catch (err) {
    showLoginError("Register fail: " + err.message);
  } finally {
    $("registerBtn").disabled = false;
    $("spin-register").classList.add("hidden");
  }
});

// ============================================
// SCREEN NAVIGATION
// ============================================
function hideAllScreens() {
  ["dashboardScreen", "caseListScreen", "newCaseScreen", "wizardScreen", "reuseScreen", "reuseFormScreen", "orderWriterScreen"].forEach(id => {
    const el = $(id);
    if (el) el.classList.add("hidden");
  });
  closeLiveTypeEditor();
}

function showDashboard() {
  hideAllScreens();
  $("dashboardScreen").classList.remove("hidden");
  loadDashboardCounts();
}

$("newCaseBtn").addEventListener("click", () => {
  hideAllScreens();
  $("newCaseScreen").classList.remove("hidden");
  selectedCaseType = null;
  document.querySelectorAll(".case-type-btn").forEach(b => b.classList.remove("active"));
});

$("backFromNewCaseBtn").addEventListener("click", showDashboard);
$("backToDashBtn").addEventListener("click", showDashboard);

// ============================================
// DASHBOARD: case counts + lists
// ============================================
async function loadDashboardCounts() {
  try {
    const promises = ["pending", "review", "finalized"].map(async (status) => {
      // head:true + count avoids downloading every row just to count them
      const { count, error } = await sb.from("cases").select("id", { count: "exact", head: true }).eq("status", status);
      if (!error) {
        $(`count${status.charAt(0).toUpperCase() + status.slice(1)}`).textContent = count ?? 0;
      }
    });
    await Promise.all(promises);

    // Load recent feedback panel for non-judges
    if (currentProfile && currentProfile.role !== 'judge') {
      const { data: feedbackCases, error: feedbackErr } = await sb.from("cases")
        .select("id, case_title, category, case_type, review_comment")
        .eq("status", "pending")
        .not("review_comment", "is", null)
        .eq("created_by", currentProfile.id);
        
      if (!feedbackErr && feedbackCases && feedbackCases.length > 0) {
        $("feedbackCount").textContent = feedbackCases.length;
        $("feedbackList").innerHTML = feedbackCases.map(c => {
          const caseName = c.case_title || `${c.category} Case`;
          return `
            <div class="item feedback-item">
              <p class="item-title">${escapeHtml(caseName)}</p>
              <p class="text-sm mt-1">💬 "${escapeHtml(c.review_comment)}"</p>
              <div class="item-actions">
                <button class="fix-case-btn btn btn-warning btn-sm" data-id="${c.id}">🛠️ Draft theek karein</button>
                <button class="dismiss-feedback-btn btn btn-ghost btn-sm" data-id="${c.id}">✕ Dismiss</button>
              </div>
            </div>
          `;
        }).join("");
        
        // Bind click events
        $("feedbackList").querySelectorAll(".fix-case-btn").forEach(btn => {
          btn.onclick = () => openWizardForCase(btn.dataset.id);
        });
        
        $("feedbackList").querySelectorAll(".dismiss-feedback-btn").forEach(btn => {
          btn.onclick = async () => {
            if (!confirm("Kya aap feedback ko clear karna chahte hain?")) return;
            await sb.from("cases").update({ review_comment: null }).eq("id", btn.dataset.id);
            await loadDashboardCounts();
          };
        });
        
        $("recentFeedbackPanel").classList.remove("hidden");
      } else {
        $("recentFeedbackPanel").classList.add("hidden");
      }
    } else {
      $("recentFeedbackPanel").classList.add("hidden");
    }
  } catch (err) {
    console.error("Dashboard counts fetch fail:", err);
  }
}

document.querySelectorAll(".dash-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => openCaseList(btn.dataset.status));
});

async function openCaseList(status) {
  hideAllScreens();
  $("caseListScreen").classList.remove("hidden");
  const titles = { pending: "📋 Pending Cases", review: "🔍 Cases Under Review", finalized: "✅ Finalized (History)" };
  $("caseListTitle").textContent = titles[status];
  const container = $("caseListContainer");
  
  container.innerHTML = `<p class="empty">Loading...</p>`;

  const [{ data: cases, error }, { data: people }] = await Promise.all([
    sb.from("cases").select("*").eq("status", status).order("updated_at", { ascending: false }),
    sb.from("profiles").select("id, full_name")
  ]);
  const nameOf = Object.fromEntries((people || []).map(p => [p.id, p.full_name]));
  const templateBtnHtml = status === "finalized"
    ? `<button class="add-template-list-btn btn btn-soft btn-block">📄 Naya template add karein</button>` : "";

  if (error || !cases || cases.length === 0) {
    container.innerHTML = templateBtnHtml + `<p class="empty">${error ? escapeHtml(error.message) : "Koi case nahi mila."}</p>`;
    container.querySelector(".add-template-list-btn")?.addEventListener("click", openTemplateModal);
    return;
  }

  const isJudge = currentProfile?.role === 'judge';
  container.innerHTML = templateBtnHtml + cases.map(c => {
    const typeLabel = c.case_type === "ex_parte" ? "Ex-parte" : "Contested";
    const title = c.case_title || `${c.category} Case (${typeLabel})`;
    const by = nameOf[c.created_by] ? ` · ${escapeHtml(nameOf[c.created_by])}` : "";
    const grounds = c.legal_grounds ? `<p class="item-meta">${escapeHtml(c.legal_grounds)}</p>` : "";
    const comment = c.review_comment ? `<p class="item-note">💬 ${escapeHtml(c.review_comment)}</p>` : "";
    const canDelete = c.created_by === currentProfile?.id || currentProfile?.is_admin;
    const actions = [
      status === "finalized" ? `<button class="reuse-btn btn btn-soft btn-sm" data-id="${c.id}">📑 Reuse</button>` : "",
      status === "review" && isJudge ? `<button class="review-approve-btn btn btn-success btn-sm" data-id="${c.id}">✅ Approve</button>` : "",
      status === "review" && isJudge ? `<button class="review-sendback-btn btn btn-warning btn-sm" data-id="${c.id}">↩️ Send Back</button>` : ""
    ].join("");
    return `
      <div class="item">
        <div class="case-row">
          <div class="resume-case" data-id="${c.id}">
            <p class="item-title">${escapeHtml(title)}</p>
            <p class="item-meta">${escapeHtml(c.category)} · ${typeLabel} · Step ${c.current_step || 1}/5${by}</p>
            ${grounds}${comment}
          </div>
          ${canDelete ? `<button class="delete-case-btn btn btn-ghost btn-icon" data-id="${c.id}" title="Delete case" aria-label="Delete case">🗑️</button>` : ""}
        </div>
        ${actions ? `<div class="item-actions">${actions}</div>` : ""}
      </div>`;
  }).join("");

  container.querySelector(".add-template-list-btn")?.addEventListener("click", openTemplateModal);
  container.onclick = async (e) => {
    const target = e.target.closest("[data-id]");
    if (!target) return;

    if (target.classList.contains("resume-case")) {
      openWizardForCase(target.dataset.id);
    } else if (target.classList.contains("reuse-btn")) {
      e.stopPropagation();
      openReuseFlow(target.dataset.id);
    } else if (target.classList.contains("delete-case-btn")) {
      e.stopPropagation();
      if (!confirm("Is case ko delete karna hai?")) return;
      const { error } = await sb.from("cases").delete().eq("id", target.dataset.id);
      if (error) { showToast("Delete fail: " + error.message, "error"); return; }
      await loadDashboardCounts();
      openCaseList(status);
    } else if (target.classList.contains("review-approve-btn")) {
      e.stopPropagation();
      const c = cases.find(x => String(x.id) === target.dataset.id);
      if (!c?.judgement_output?.trim()) { showToast("Is case ka judgement draft khali hai.", "error"); return; }
      if (!confirm("Is case ko approve aur finalize karein?")) return;
      target.disabled = true;
      try {
        await finalizeCaseById(c.id, c.judgement_output);
        showToast("Case approved and finalized!", "success");
      } catch (err) {
        showToast("Approve error: " + err.message, "error");
      }
      await loadDashboardCounts();
      openCaseList(status);
    } else if (target.classList.contains("review-sendback-btn")) {
      e.stopPropagation();
      const comment = prompt("Send back ka karan likhein (comment):");
      if (!comment?.trim()) return;
      const { error } = await sb.from("cases").update({ status: 'pending', current_step: 5, review_comment: comment.trim() }).eq("id", target.dataset.id);
      if (error) showToast("Send back fail: " + error.message, "error");
      await loadDashboardCounts();
      openCaseList(status);
    }
  };
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ============================================
// NEW CASE: category + type selection
// ============================================
let selectedCaseType = null;
document.querySelectorAll(".case-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedCaseType = btn.dataset.type;
    document.querySelectorAll(".case-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

$("startCaseBtn").addEventListener("click", async () => {
  if (!selectedCaseType) { showToast("Contested ya Ex-parte select karein.", "error"); return; }
  const category = $("newCaseCategory").value;
  const { data, error } = await sb.from("cases").insert({
    category, case_type: selectedCaseType, status: "pending",
    created_by: currentProfile.id, last_updated_by: currentProfile.id, current_step: 1
  }).select().single();
  if (error) { showToast("Error: " + error.message, "error"); return; }
  openWizardForCase(data.id);
});

$("goToReuseBtn").addEventListener("click", () => {
  hideAllScreens();
  $("reuseScreen").classList.remove("hidden");
  loadFinalizedForReuseSelection();
});

// (Placeholder functions removed — real implementations are below)

// ============================================
// SETTINGS + GLOSSARY
// ============================================
const DEFAULT_MODELS = { claude: "claude-opus-5-5", gemini: "gemini-2.5-flash", openai: "gpt-5.5-instant" };

// Every entry is a real, distinct model. The DEFAULT_MODELS entry is marked "(Default)".
const MODEL_OPTIONS = {
  claude: [
    { value: "claude-opus-5-5", label: "Opus 5.5 — Behtareen quality, mehnga" },
    { value: "claude-sonnet-5-5", label: "Sonnet 5.5 — Achhi quality, Opus se aadha kharcha" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5 — Tez, sab se sasta" },
    { value: "claude-fable-5-1", label: "Fable 5.1 — Sab se taqatwar, bohat mehnga" }
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "Flash 2.5 — Tez, sasta" },
    { value: "gemini-2.5-pro", label: "Pro 2.5 — Behtareen quality, mehnga" }
  ],
  openai: [
    { value: "gpt-5.5-instant", label: "GPT-5.5 Instant — Achha, darmiyana kharcha" },
    { value: "gpt-5.5", label: "GPT-5.5 — Behtar, mehnga" },
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro — Behtareen, sab se mehnga" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini — Theek, sab se sasta" }
  ]
};

const PROVIDER_NAMES = { claude: "Claude", gemini: "Gemini", openai: "OpenAI" };

function modelLabel(prov, value) {
  const opt = MODEL_OPTIONS[prov]?.find(o => o.value === value);
  return opt ? opt.label.split(" — ")[0] : value;
}

// Catches the most common mistake: pasting another company's key
function keyLooksWrong(prov, key) {
  if (prov === "claude") return !key.startsWith("sk-ant-");
  if (prov === "openai") return !key.startsWith("sk-") || key.startsWith("sk-ant-");
  if (prov === "gemini") return !key.startsWith("AIza");
  return false;
}

function populateModelDropdown(prov) {
  const sel = $("modelInput");
  sel.innerHTML = (MODEL_OPTIONS[prov] || []).map(o =>
    `<option value="${o.value}">${escapeHtml(o.label)}${o.value === DEFAULT_MODELS[prov] ? " (Default)" : ""}</option>`
  ).join("");
}

function readStoredKeys(prov) {
  const stored = localStorage.getItem(`ai_api_key_${prov}`);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return [stored];
  }
}

function loadProviderFields() {
  const prov = $("providerSelect").value;
  populateModelDropdown(prov);
  const keys = readStoredKeys(prov);
  $("apiKeyInput1").value = keys[0] || "";
  $("apiKeyInput2").value = keys[1] || "";
  $("apiKeyInput3").value = keys[2] || "";
  $("modelInput").value = getSavedModel(prov);
  showSettingsStatus("");
}

// Saved model, or the default when nothing (or an old/removed model) was saved
function getSavedModel(prov) {
  const saved = localStorage.getItem(`ai_model_${prov}`) || "";
  return MODEL_OPTIONS[prov]?.some(o => o.value === saved) ? saved : DEFAULT_MODELS[prov];
}

function showSettingsStatus(html, type = "success") {
  const el = $("settingsStatus");
  el.innerHTML = html;
  el.className = html ? `settings-status ${type}` : "settings-status hidden";
}

function updateCurrentSettingsLine() {
  const s = getSettings();
  $("currentSettingsLine").textContent = s.apiKeys.length
    ? `Abhi use ho raha hai: ${PROVIDER_NAMES[s.provider]} · ${modelLabel(s.provider, s.model)} · ${s.apiKeys.length} key(s)`
    : "Abhi koi API key save nahi hai.";
}

function getSettings() {
  const prov = localStorage.getItem("ai_provider") || "claude";
  return {
    provider: prov,
    apiKeys: readStoredKeys(prov).filter(k => k),
    model: getSavedModel(prov)
  };
}

$("settingsBtn").addEventListener("click", () => {
  const s = getSettings();
  $("providerSelect").value = s.provider;
  loadProviderFields();
  updateCurrentSettingsLine();
  $("settingsModal").classList.remove("hidden");
});
$("closeSettingsBtn").addEventListener("click", () => $("settingsModal").classList.add("hidden"));

$("glossaryMenuBtn").addEventListener("click", () => {
  loadGlossary();
  renderPresetList();
  $("glossaryModal").classList.remove("hidden");
});
$("closeGlossaryBtn").addEventListener("click", () => $("glossaryModal").classList.add("hidden"));

$("providerSelect").addEventListener("change", loadProviderFields);

function showToast(msg, type = "") {
  let t = document.getElementById("toast-el");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast-el";
    t.className = "toast";
    const btn = document.createElement("button");
    btn.className = "toast-close";
    btn.textContent = "✕";
    btn.addEventListener("click", () => t.classList.remove("show"));
    t.appendChild(btn);
    document.body.appendChild(t);
  }
  const span = t.querySelector("span") || document.createElement("span");
  span.textContent = msg;
  if (!t.contains(span)) t.prepend(span);
  t.className = "toast " + type;
  requestAnimationFrame(() => {
    t.classList.add("show");
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove("show"), 5000);
  });
}

function getEnteredKeys() {
  return ["apiKeyInput1", "apiKeyInput2", "apiKeyInput3"].map(id => $(id).value.trim()).filter(Boolean);
}

$("saveSettingsBtn").addEventListener("click", () => {
  const prov = $("providerSelect").value;
  const keys = getEnteredKeys();
  if (!keys.length) { showSettingsStatus("❌ Kam az kam ek API key zaroori hai.", "error"); return; }
  const model = $("modelInput").value;
  localStorage.setItem("ai_provider", prov);
  localStorage.setItem(`ai_api_key_${prov}`, JSON.stringify(keys));
  localStorage.setItem(`ai_model_${prov}`, model);
  updateCurrentSettingsLine();

  const wrongKeys = keys.map((k, i) => keyLooksWrong(prov, k) ? i + 1 : null).filter(Boolean);
  const warning = wrongKeys.length
    ? `<br>⚠️ Key ${wrongKeys.join(", ")} ${PROVIDER_NAMES[prov]} ki key nahi lagti. "Keys Test Karein" se check kar lein.`
    : "";
  showSettingsStatus(
    `✅ <b>Settings save ho gayi!</b><br>Provider: <b>${PROVIDER_NAMES[prov]}</b> · Model: <b>${escapeHtml(modelLabel(prov, model))}</b> · Keys: <b>${keys.length}</b>${warning}`,
    wrongKeys.length ? "warning" : "success"
  );
  showToast("✅ AI settings save ho gayi", "success");
});

// Sends a tiny request with each entered key so the user knows the key + model actually work
$("testKeysBtn").addEventListener("click", async () => {
  const prov = $("providerSelect").value;
  const model = $("modelInput").value;
  const keys = getEnteredKeys();
  if (!keys.length) { showSettingsStatus("❌ Pehle API key likhein.", "error"); return; }
  const btn = $("testKeysBtn");
  btn.disabled = true;
  showSettingsStatus("⏳ Keys test ho rahi hain...", "info");
  const lines = [];
  let allOk = true;
  for (const [i, key] of keys.entries()) {
    try {
      await requestProvider(prov, key, model, [{ text: "Reply with just: OK" }], 20);
      lines.push(`✅ Key ${i + 1}: kaam kar rahi hai`);
    } catch (err) {
      allOk = false;
      const reason = err.status === 401 || err.status === 403 ? "key ghalat hai ya band hai"
        : err.status === 429 ? "limit / balance khatam"
        : err.status === 404 || err.status === 400 ? "ye model is key par available nahi"
        : "connection masla";
      lines.push(`❌ Key ${i + 1}: ${reason}`);
    }
  }
  showSettingsStatus(`<b>${PROVIDER_NAMES[prov]} · ${escapeHtml(modelLabel(prov, model))}</b><br>${lines.join("<br>")}`, allOk ? "success" : "error");
  btn.disabled = false;
});

let glossaryCache = [];
let editingGlossaryId = null;
let editingPresetIdx = null;

async function loadGlossary() {
  const { data } = await sb.from("glossary_rules").select("*").eq("user_id", currentProfile.id).order("created_at", { ascending: false });
  glossaryCache = data || [];
  renderGlossaryList();
}

// One-open-at-a-time accordion for glossary / preset lists
function bindAccordion(list) {
  list.querySelectorAll(".acc-head").forEach(head => {
    head.addEventListener("click", () => {
      const body = head.nextElementSibling;
      const willOpen = body.classList.contains("hidden");
      list.querySelectorAll(".acc-body").forEach(b => b.classList.add("hidden"));
      list.querySelectorAll(".chevron").forEach(c => c.textContent = "▼");
      if (willOpen) {
        body.classList.remove("hidden");
        head.querySelector(".chevron").textContent = "▲";
      }
    });
  });
}

function renderGlossaryList() {
  const list = $("glossaryList");
  if (glossaryCache.length === 0) { list.innerHTML = `<p class="empty">Abhi koi rule nahi hai.</p>`; return; }

  list.innerHTML = glossaryCache.map(r => `
    <div class="acc-item">
      <button type="button" class="acc-head"><span>📝 ${escapeHtml(r.term)}</span><span class="chevron">▼</span></button>
      <div class="acc-body hidden">
        <p>${escapeHtml(r.instruction)}</p>
        <div class="btn-row">
          <button class="edit-glossary-btn btn btn-secondary btn-sm" data-id="${r.id}" data-term="${escapeHtml(r.term)}" data-instruction="${escapeHtml(r.instruction)}">✏️ Edit</button>
          <button class="del-glossary-btn btn btn-danger-soft btn-sm" data-id="${r.id}">🗑️ Delete</button>
        </div>
      </div>
    </div>`).join("");
  bindAccordion(list);

  list.querySelectorAll(".del-glossary-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Kya aap is AI correction rule ko delete karna chahte hain?")) return;
      await sb.from("glossary_rules").delete().eq("id", btn.dataset.id);
      await loadGlossary();
    });
  });

  list.querySelectorAll(".edit-glossary-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      $("glossaryTermInput").value = btn.dataset.term;
      $("glossaryInstructionInput").value = btn.dataset.instruction;
      editingGlossaryId = btn.dataset.id;
      $("addGlossaryBtn").textContent = "💾 Update Rule";
      $("glossaryTermInput").focus();
    });
  });
}

$("addGlossaryBtn").addEventListener("click", async () => {
  const term = $("glossaryTermInput").value.trim();
  const instruction = $("glossaryInstructionInput").value.trim();
  if (!term || !instruction) { showToast("Lafz aur instruction dono bharain.", "error"); return; }
  
  if (editingGlossaryId) {
    await sb.from("glossary_rules").update({ term, instruction }).eq("id", editingGlossaryId);
    showToast("Rule update ho gaya!", "success");
    editingGlossaryId = null;
    $("addGlossaryBtn").textContent = "+ Rule Add Karein";
  } else {
    await sb.from("glossary_rules").insert({ user_id: currentProfile.id, term, instruction });
    showToast("Rule add ho gaya!", "success");
  }
  
  $("glossaryTermInput").value = ""; $("glossaryInstructionInput").value = "";
  await loadGlossary();
});

function renderPresetList() {
  const directives = getDirectives();
  const list = $("presetList");
  if (directives.length === 0) { list.innerHTML = `<p class="empty">Abhi koi preset nahi hai.</p>`; return; }

  list.innerHTML = directives.map((d, idx) => `
    <div class="acc-item">
      <button type="button" class="acc-head"><span>📢 ${escapeHtml(d.label)}</span><span class="chevron">▼</span></button>
      <div class="acc-body hidden">
        <p>${escapeHtml(d.text)}</p>
        <div class="btn-row">
          <button class="edit-preset-btn btn btn-secondary btn-sm" data-idx="${idx}" data-label="${escapeHtml(d.label)}" data-text="${escapeHtml(d.text)}">✏️ Edit</button>
          <button class="del-preset-btn btn btn-danger-soft btn-sm" data-idx="${idx}">🗑️ Delete</button>
        </div>
      </div>
    </div>`).join("");
  bindAccordion(list);

  list.querySelectorAll(".del-preset-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (!confirm("Kya aap is preset ko delete karna chahte hain?")) return;
      const current = getDirectives();
      current.splice(Number(btn.dataset.idx), 1);
      localStorage.setItem("ow_directives_v7", JSON.stringify(current));
      renderPresetList();
      loadDirectiveDropdown();
      showToast("Preset deleted.", "success");
    };
  });

  list.querySelectorAll(".edit-preset-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      $("presetTitleInput").value = btn.dataset.label;
      $("presetTextInput").value = btn.dataset.text;
      editingPresetIdx = Number(btn.dataset.idx);
      $("addPresetBtn").textContent = "💾 Update Preset";
      $("presetTitleInput").focus();
    };
  });
}

$("addPresetBtn").addEventListener("click", () => {
  const label = $("presetTitleInput").value.trim();
  const text = $("presetTextInput").value.trim();
  if (!label || !text) { showToast("Preset Title aur Warning Text dono zaroori hain.", "error"); return; }

  const current = getDirectives();
  
  if (editingPresetIdx !== null) {
    current[editingPresetIdx] = { label, text };
    localStorage.setItem("ow_directives_v7", JSON.stringify(current));
    editingPresetIdx = null;
    $("addPresetBtn").textContent = "+ Preset Add Karein";
    showToast("Preset update ho gaya!", "success");
  } else {
    if (current.some(d => d.label.toLowerCase() === label.toLowerCase())) {
      showToast("Ye preset title pehle se mojood hai.", "error");
      return;
    }
    current.push({ label, text });
    localStorage.setItem("ow_directives_v7", JSON.stringify(current));
    showToast("Preset add ho gaya!", "success");
  }

  $("presetTitleInput").value = "";
  $("presetTextInput").value = "";
  renderPresetList();
  loadDirectiveDropdown();
});

function buildGlossaryInstructions() {
  if (glossaryCache.length === 0) return "";
  return "\n\nSPECIAL TERMINOLOGY RULES (hamesha follow karein):\n" + glossaryCache.map(r => `- "${r.term}": ${r.instruction}`).join("\n");
}

// ============================================
// SHORTHAND DICTIONARY LOGIC
// ============================================
const DEFAULT_DICTIONARY = [
  { shortcut: "cp.", expanded: "learned counsel for the plaintiff" },
  { shortcut: "cd.", expanded: "learned counsel for the defendant" },
  { shortcut: "cpa.", expanded: "learned counsel for the plaintiff sought an adjournment" },
  { shortcut: "cda.", expanded: "learned counsel for the defendant sought an adjournment" }
];

let memoryDictionary = null;

function getDictionary() {
  if (memoryDictionary) return memoryDictionary;
  try {
    const stored = localStorage.getItem("ow_dictionary");
    if (!stored) {
      try { localStorage.setItem("ow_dictionary", JSON.stringify(DEFAULT_DICTIONARY)); } catch(e){}
      memoryDictionary = [...DEFAULT_DICTIONARY];
      return memoryDictionary;
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      memoryDictionary = parsed;
      return memoryDictionary;
    }
    throw new Error("Not an array");
  } catch(e) {
    try { localStorage.setItem("ow_dictionary", JSON.stringify(DEFAULT_DICTIONARY)); } catch(err){}
    memoryDictionary = [...DEFAULT_DICTIONARY];
    return memoryDictionary;
  }
}

function saveDictionary(dict) {
  memoryDictionary = dict;
  try {
    localStorage.setItem("ow_dictionary", JSON.stringify(dict));
  } catch(e) {
    console.error("LocalStorage write failed:", e);
  }
}

function renderDictionaryList() {
  const dict = getDictionary();
  const list = $("dictionaryList");
  if (dict.length === 0) { list.innerHTML = `<p class="empty">Abhi koi shortcut nahi hai.</p>`; return; }
  list.innerHTML = dict.map((item, idx) => `
    <div class="row-item">
      <span><b>${escapeHtml(item.shortcut)}</b>: ${escapeHtml(item.expanded)}</span>
      <button class="del-dict-btn btn btn-ghost btn-icon" data-idx="${idx}" aria-label="Delete">✕</button>
    </div>`).join("");
  
  list.querySelectorAll(".del-dict-btn").forEach(btn => {
    btn.onclick = () => {
      const current = getDictionary();
      current.splice(Number(btn.dataset.idx), 1);
      saveDictionary(current);
      renderDictionaryList();
    };
  });
}

$("dictionaryMenuBtn").addEventListener("click", () => {
  renderDictionaryList();
  $("dictionaryModal").classList.remove("hidden");
});

$("closeDictionaryBtn").addEventListener("click", () => $("dictionaryModal").classList.add("hidden"));

$("addDictBtn").addEventListener("click", () => {
  const shortcut = $("dictShortcutInput").value.trim();
  const expanded = $("dictExpansionInput").value.trim();
  if (!shortcut || !expanded) { showToast("Shortcut aur expansion dono zaroori hain.", "error"); return; }
  
  const current = getDictionary();
  const existingIdx = current.findIndex(item => item.shortcut.toLowerCase() === shortcut.toLowerCase());
  
  if (existingIdx !== -1) {
    if (confirm(`"${shortcut}" shortcut pehle se mojood hai. Kya aap iski explanation ko update karna chahte hain?`)) {
      current[existingIdx].expanded = expanded;
      saveDictionary(current);
      $("dictShortcutInput").value = "";
      $("dictExpansionInput").value = "";
      renderDictionaryList();
      showToast("Shortcut update ho gaya!", "success");
    }
    return;
  }
  
  current.push({ shortcut, expanded });
  saveDictionary(current);
  $("dictShortcutInput").value = "";
  $("dictExpansionInput").value = "";
  renderDictionaryList();
  showToast("Shortcut add ho gaya!", "success");
});

// Auto-expand keyboard handler for all textareas (reliable on mobile virtual keyboards)
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.tagName !== "TEXTAREA" && !(el.tagName === "INPUT" && el.type === "text")) return;
  if (el._replacing) return;

  const val = el.value;
  const pos = el.selectionStart;

  // Look at the character just before the cursor (space or enter)
  const lastChar = val.charAt(pos - 1);
  if (lastChar === " " || lastChar === "\n") {
    const textBeforeSpace = val.substring(0, pos - 1);
    const words = textBeforeSpace.split(/[\s\n]+/);
    const lastWord = words[words.length - 1];

    if (!lastWord) return;

    const dict = getDictionary();
    const match = dict.find(item => item.shortcut.toLowerCase() === lastWord.toLowerCase());
    if (match) {
      const startPart = textBeforeSpace.substring(0, textBeforeSpace.length - lastWord.length);
      const endPart = val.substring(pos);
      
      el._replacing = true;
      el.value = startPart + match.expanded + lastChar + endPart;
      
      const newCursorPos = startPart.length + match.expanded.length + 1;
      el.setSelectionRange(newCursorPos, newCursorPos);
      
      el.dispatchEvent(new Event("input"));
      el._replacing = false;
    }
  }
});

// ============================================
// AI CALL (multi-provider, glossary-aware)
// ============================================
// Claude models whose API supports server-side refusal fallbacks ("default" routing)
const CLAUDE_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

async function readApiError(res, label) {
  const body = (await res.text()).slice(0, 300);
  const err = new Error(`${label} ${res.status}: ${body}`);
  err.status = res.status;
  return err;
}

// One request to the selected provider. `parts` = [{ text }] or [{ image: { mimeType, data } }]
async function requestProvider(provider, key, model, parts, maxTokens) {
  if (provider === "claude") {
    const content = parts.map(p => p.image
      ? { type: "image", source: { type: "base64", media_type: p.image.mimeType, data: p.image.data } }
      : { type: "text", text: p.text });
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // Required for calling the API straight from the browser with the user's own key
      "anthropic-dangerous-direct-browser-access": "true"
    };
    // Adaptive thinking tokens count against max_tokens, so leave generous headroom
    const body = { model, max_tokens: Math.max(maxTokens * 4, 16000), messages: [{ role: "user", content }] };
    if (CLAUDE_FALLBACK_MODELS.has(model)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw await readApiError(res, "Claude");
    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("Claude ne ye request decline kar di (safety filter).");
    return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  }

  if (provider === "gemini") {
    const geminiParts = parts.map(p => p.image
      ? { inline_data: { mime_type: p.image.mimeType, data: p.image.data } }
      : { text: p.text });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      // Key in a header instead of the URL so it doesn't end up in logs/history
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: geminiParts }] })
    });
    if (!res.ok) throw await readApiError(res, "Gemini");
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  }

  if (provider === "openai") {
    const content = parts.map(p => p.image
      ? { type: "image_url", image_url: { url: `data:${p.image.mimeType};base64,${p.image.data}` } }
      : { type: "text", text: p.text });
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      // GPT-5.x models reject the legacy `max_tokens` field
      body: JSON.stringify({ model, max_completion_tokens: Math.max(maxTokens * 4, 8000), messages: [{ role: "user", content }] })
    });
    if (!res.ok) throw await readApiError(res, "OpenAI");
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error("Unknown provider: " + provider);
}

// Tries each saved key in order; moves to the next key only on auth / quota / server errors
async function runWithKeyFallback(parts, maxTokens) {
  const s = getSettings();
  if (!s.apiKeys.length) throw new Error("API key set nahi hai. Settings (⚙️) mein jaa ke add karein.");
  const model = s.model || DEFAULT_MODELS[s.provider];
  let lastError = null;
  for (let i = 0; i < s.apiKeys.length; i++) {
    try {
      return await requestProvider(s.provider, s.apiKeys[i], model, parts, maxTokens);
    } catch (err) {
      lastError = err;
      console.warn(`AI key ${i + 1} failed:`, err);
      const retryable = !err.status || [401, 402, 403, 429].includes(err.status) || err.status >= 500;
      if (!retryable) break;
      if (i < s.apiKeys.length - 1) showToast(`Key ${i + 1} fail hui. Fallback Key ${i + 2} try ho rahi hai...`, "warning");
    }
  }
  throw lastError;
}

async function callAI(prompt, maxTokens = 2048) {
  const finalPrompt = prompt
    + "\n\nIMPORTANT: Apna pura jawab sirf English language mein likhein, chahe source documents Urdu mein hon."
    + buildGlossaryInstructions();
  return runWithKeyFallback([{ text: finalPrompt }], maxTokens);
}

// ============================================
// GLOBAL WIZARD STATE
// ============================================
let activeCase = null;
let currentWizStep = 1;
let saveTimer = null;
let liveModeOn = false;
let liveChannel = null;

$("backFromWizardBtn").addEventListener("click", async () => {
  await flushAutosave();
  await stopLiveMode();
  showDashboard();
});

// ============================================
// LIVE TYPE EDITOR (Real-time Collaborative)
// ============================================
let liveTypeChannel = null;
let liveTypeTimer = null;
let liveTypeNoteId = null;

// The dashboard editor is one shared scratch pad per court
function getLiveTypeNoteId() {
  // Slug keeps the id safe inside realtime filters (no spaces or special characters)
  const slug = (currentProfile?.court_name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `live-note-${slug || "default"}`;
}

$("liveTypeBtn").addEventListener("click", async () => {
  liveTypeNoteId = getLiveTypeNoteId();
  $("liveTypeOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("liveTypeTextarea").value = "";
  const { data } = await sb.from("live_notes").select("content").eq("id", liveTypeNoteId).maybeSingle();
  $("liveTypeTextarea").value = data?.content || "";

  if (liveTypeChannel) sb.removeChannel(liveTypeChannel);
  liveTypeChannel = sb.channel(`live-notes-${liveTypeNoteId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_notes", filter: `id=eq.${liveTypeNoteId}` }, (payload) => {
      if (payload.new && payload.new.updated_by !== currentProfile?.id && document.activeElement?.id !== "liveTypeTextarea") {
        $("liveTypeTextarea").value = payload.new.content || "";
      }
    })
    .subscribe();
});

async function saveLiveTypeNote() {
  if (!liveTypeNoteId) return;
  const { error } = await sb.from("live_notes").upsert({
    id: liveTypeNoteId,
    content: $("liveTypeTextarea").value,
    updated_by: currentProfile?.id,
    updated_at: new Date().toISOString()
  });
  if (error) showToast("Live note save nahi hua: " + error.message, "error");
}

function closeLiveTypeEditor() {
  if (liveTypeTimer) {
    // Don't lose the last keystrokes typed right before closing
    clearTimeout(liveTypeTimer);
    liveTypeTimer = null;
    saveLiveTypeNote();
  }
  if (liveTypeChannel) { sb.removeChannel(liveTypeChannel); liveTypeChannel = null; }
  liveTypeNoteId = null;
  if (!$("liveTypeOverlay").classList.contains("hidden")) {
    $("liveTypeOverlay").classList.add("hidden");
    document.body.style.overflow = "";
  }
}

$("liveTypeCloseBtn").addEventListener("click", closeLiveTypeEditor);

$("liveTypeTextarea").addEventListener("input", () => {
  clearTimeout(liveTypeTimer);
  liveTypeTimer = setTimeout(() => { liveTypeTimer = null; saveLiveTypeNote(); }, 800);
});

$("liveTypeWordBtn").addEventListener("click", () => {
  const text = $("liveTypeTextarea").value;
  if (!text.trim()) { showToast("Pehle kuch type karein.", "error"); return; }
  downloadAsWord(text, "live-type.doc", "Live Type");
});

// ============================================
// OPEN / LOAD WIZARD FOR A CASE
// ============================================
async function openWizardForCase(caseId) {
  const { data: caseData, error } = await sb.from("cases").select("*").eq("id", caseId).single();
  if (error || !caseData) { showToast("Case load nahi ho saka.", "error"); return; }
  await flushAutosave();
  await stopLiveMode();
  activeCase = caseData;

  // Reset sections left open by a previously opened case
  ["factsOutput", "admitDenyOutput", "disputesOutput", "findingsOutput", "outputSection", "chatSection",
   "judgeReviewActions", "finalizeBtn"].forEach(id => $(id).classList.add("hidden"));
  $("chatLog").innerHTML = "";

  hideAllScreens();
  $("wizardScreen").classList.remove("hidden");

  // Populate fields
  $("plaintText").value = caseData.plaint_text || "";
  $("factsText").value = caseData.facts_text || "";
  if (caseData.facts_text) $("factsOutput").classList.remove("hidden");
  $("wsText").value = caseData.written_statement_text || "";
  $("admitDenyText").value = caseData.admit_deny_text || "";
  if (caseData.admit_deny_text) $("admitDenyOutput").classList.remove("hidden");
  $("issuesText").value = caseData.issues_text || "";
  $("disputesText").value = caseData.disputes_text || "";
  if (caseData.disputes_text) $("disputesOutput").classList.remove("hidden");
  $("evidenceText").value = caseData.evidence_text || "";
  $("findingsText").value = caseData.findings_text || "";
  if (caseData.findings_text) $("findingsOutput").classList.remove("hidden");
  $("shortOrder").value = caseData.short_order || "";
  $("judgementOutput").value = caseData.judgement_output || "";
  if (caseData.judgement_output) showJudgementActions();

  // Show review feedback banner if present
  const banner = $("reviewFeedbackBanner");
  if (caseData.review_comment && caseData.status === 'pending') {
    banner.textContent = "💬 Review Feedback: " + caseData.review_comment;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  // Step2 (Written Statement) hidden if ex-parte
  $("wstep2").classList.toggle("hidden-by-exparte", caseData.case_type === "ex_parte");

  buildUploadWidget("plaint", "plaintText");
  buildUploadWidget("ws", "wsText");
  buildUploadWidget("issues", "issuesText");
  buildUploadWidget("evidence", "evidenceText");

  showWizStep(caseData.current_step || 1);
  attachAutosaveListeners();
}

// ============================================
// AUTOSAVE (debounced, fires on any field change)
// ============================================
function showJudgementActions() {
  $("outputSection").classList.remove("hidden");
  $("chatSection").classList.remove("hidden");
  const isJudge = currentProfile?.role === 'judge';
  const status = activeCase?.status;
  $("judgeReviewActions").classList.toggle("hidden", !(isJudge && status === 'review'));
  // Steno usually finalizes directly; sending to the judge for review is optional
  $("finalizeBtn").classList.toggle("hidden", status !== 'pending');
}

function attachAutosaveListeners() {
  Object.values(CASE_FIELD_MAP).forEach(id => {
    $(id).oninput = () => scheduleAutosave();
  });
}

let pendingAutosave = null; // { caseId, payload } waiting for the debounce timer

function scheduleAutosave() {
  if (!activeCase) return;
  clearTimeout(saveTimer);
  pendingAutosave = { caseId: activeCase.id, payload: getWizardFields() };
  saveTimer = setTimeout(runAutosave, 2000);
}

async function runAutosave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const job = pendingAutosave;
  pendingAutosave = null;
  if (!job) return;
  $("autosaveIndicator").textContent = "Saving...";
  if (activeCase?.id === job.caseId) {
    await saveOrUpdateCase(job.payload);
  } else {
    // User already moved to another case — still save the old one
    await sb.from("cases").update({ ...job.payload, last_updated_by: currentProfile?.id }).eq("id", job.caseId);
  }
  $("autosaveIndicator").textContent = "✓ Saved";
  setTimeout(() => {
    if ($("autosaveIndicator").textContent === "✓ Saved") $("autosaveIndicator").textContent = "";
  }, 1500);
}

// Save immediately if a debounced save is still waiting (used before leaving a case)
async function flushAutosave() {
  if (pendingAutosave) await runAutosave();
}

async function saveOrUpdateCase(fields) {
  if (!activeCase) return false;
  try {
    const payload = { ...fields, last_updated_by: currentProfile?.id };
    const { error } = await sb.from("cases").update(payload).eq("id", activeCase.id);
    if (error) throw error;
    Object.assign(activeCase, payload);
    return true;
  } catch (err) {
    console.error("Save failed:", err);
    showToast("Data save karne mein masla aya: " + err.message, "error");
    return false;
  }
}

async function logAIStep(step, input, output) {
  if (!activeCase) return;
  try {
    const { error } = await sb.from("ai_logs").insert({ case_id: activeCase.id, step, input_text: input, output_text: output });
    if (error) console.error("Log AI step failed:", error);
  } catch (err) {
    console.error("Log AI step exception:", err);
  }
}

// ============================================
// STEP NAVIGATION (4 steps if ex-parte, else 5)
// ============================================
function getStepSequence() {
  return activeCase?.case_type === "ex_parte" ? [1, 3, 4, 5] : [1, 2, 3, 4, 5];
}

// DB column -> textarea id
const CASE_FIELD_MAP = {
  plaint_text: "plaintText",
  facts_text: "factsText",
  written_statement_text: "wsText",
  admit_deny_text: "admitDenyText",
  issues_text: "issuesText",
  disputes_text: "disputesText",
  evidence_text: "evidenceText",
  findings_text: "findingsText",
  short_order: "shortOrder",
  judgement_output: "judgementOutput"
};

function getWizardFields() {
  return Object.fromEntries(Object.entries(CASE_FIELD_MAP).map(([col, id]) => [col, $(id).value]));
}

function showWizStep(n) {
  currentWizStep = n;
  document.querySelectorAll(".wiz-step").forEach(el => el.classList.add("hidden"));
  $(`wstep${n}`).classList.remove("hidden");
  const seq = getStepSequence();
  const stepNames = { 1: "Plaint", 2: "Written Statement", 3: "Issues", 4: "Evidence", 5: "Short Order & Final Judgement" };
  const stepIdx = seq.indexOf(n) + 1;
  const totalSteps = seq.length;
  const h2 = $(`wstep${n}`).querySelector("h2");
  if (h2) h2.textContent = `Step ${stepIdx}/${totalSteps}: ${stepNames[n]}`;
  $("wizProgressBar").style.width = `${(stepIdx / totalSteps) * 100}%`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("wizBackBtn").classList.toggle("hidden", seq.indexOf(n) === 0);
  $("wizNextBtn").classList.toggle("hidden", seq.indexOf(n) === seq.length - 1);
  // Submit for Review button - har step pe dikhe (non-judge users, case pending ho)
  $("wizReviewBtn").classList.toggle("hidden", currentProfile?.role === 'judge' || activeCase?.status !== 'pending');
  if (activeCase && activeCase.current_step !== n) saveOrUpdateCase({ current_step: n });
}


$("wizBackBtn").addEventListener("click", async () => {
  const seq = getStepSequence();
  const idx = seq.indexOf(currentWizStep);
  if (idx > 0) {
    await saveOrUpdateCase(getWizardFields());
    showWizStep(seq[idx - 1]);
  }
});
$("wizNextBtn").addEventListener("click", async () => {
  const seq = getStepSequence();
  const idx = seq.indexOf(currentWizStep);
  if (idx < seq.length - 1) {
    await saveOrUpdateCase(getWizardFields());
    showWizStep(seq[idx + 1]);
  }
});


async function submitForReview() {
  if (!confirm("Case review ke liye submit karein? Judge approve ya send back kar sakta hai.")) return;
  clearTimeout(saveTimer);
  pendingAutosave = null;
  const ok = await saveOrUpdateCase({ ...getWizardFields(), status: "review" });
  if (!ok) return;
  showToast("Case review ke liye submit ho gaya!", "success");
  await stopLiveMode();
  showDashboard();
}
$("wizReviewBtn").addEventListener("click", submitForReview);

// ============================================
// FULL SCREEN MODE
// ============================================
let fsCurrentTarget = null;
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("fs-btn")) {
    fsCurrentTarget = e.target.dataset.target;
    // Get title label safely without the button character
    const parent = e.target.parentElement;
    let titleText = "Full Screen";
    if (parent) {
      const label = parent.querySelector("label") || parent.querySelector("span");
      if (label) titleText = label.textContent;
    }
    $("fsTitle").textContent = titleText;
    $("fsTextarea").value = $(fsCurrentTarget).value;
    $("fullscreenOverlay").classList.remove("hidden");
    document.body.style.overflow = "hidden"; // Disable background scrolling
  }
});
$("fsCloseBtn").addEventListener("click", () => {
  if (fsCurrentTarget) {
    $(fsCurrentTarget).value = $("fsTextarea").value;
    $(fsCurrentTarget).dispatchEvent(new Event("input"));
  }
  $("fullscreenOverlay").classList.add("hidden");
  document.body.style.overflow = ""; // Enable background scrolling
});

// ============================================
// VISION OCR + UPLOAD WIDGET
// ============================================
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const OCR_INSTRUCTIONS = `Extract all text from this image accurately (Urdu/English, handwritten or printed).

IMPORTANT RULES:
- Handle both Pakistani Civil and Family Court documents.
- Extract full text as-is.
- For proper nouns (person names, place names): if written in Urdu script, transliterate them into Roman English (e.g. "حنا اعظم" → "Hina Azam", "محمد عدنان" → "Muhammad Adnan")
- For legal/document terms in Urdu script, keep them in Urdu script (e.g. "نکاح نامہ", "قوم", "بیع نامہ", "اقرار نامہ", "دعویٰ استقرارِ حق", "حکم امتناعی")
- Do not translate — only transliterate names
- Return only extracted text, no commentary`;

async function visionOCR(file) {
  const data = await fileToBase64(file);
  return runWithKeyFallback([{ text: OCR_INSTRUCTIONS }, { image: { mimeType: file.type, data } }], 2000);
}

function buildUploadWidget(target, textareaId) {
  const container = $(`uploadArea-${target}`);
  container.innerHTML = `
    <div class="upload-actions">
      <button type="button" class="cam-btn btn btn-soft">📷 Camera</button>
      <button type="button" class="file-btn btn btn-secondary">🖼️ Gallery</button>
    </div>
    <input type="file" class="cam-input hidden" accept="image/jpeg,image/png" capture="environment" />
    <input type="file" class="file-input hidden" accept="image/jpeg,image/png" multiple />
    <div class="preview-area"></div>
    <div class="ocr-status"></div>`;
  const camBtn = container.querySelector(".cam-btn"), fileBtn = container.querySelector(".file-btn");
  const camInput = container.querySelector(".cam-input"), fileInput = container.querySelector(".file-input");
  const previewArea = container.querySelector(".preview-area"), statusEl = container.querySelector(".ocr-status");
  camBtn.onclick = () => camInput.click();
  fileBtn.onclick = () => fileInput.click();
  const onPick = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ""; // allow picking the same file again
    processImages(files, previewArea, statusEl, textareaId);
  };
  camInput.onchange = onPick;
  fileInput.onchange = onPick;
}

function removeImageText(wrap, textareaEl) {
  if (wrap._insertedText) {
    textareaEl.value = textareaEl.value.replace(wrap._insertedText, "");
    wrap._insertedText = "";
    textareaEl.dispatchEvent(new Event("input"));
  }
}

function getCurrentFile(wrap) {
  return wrap._currentFile || null;
}

function buildContextMenu(wrap, previewArea, statusEl, textareaId, num) {
  const existing = document.querySelector(".img-context-menu");
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.className = "img-context-menu";
  menu.innerHTML = `
    <button data-action="retry">🔄 Retry OCR</button>
    <button data-action="replace">📁 Replace Image</button>
    <button data-action="skip">⏭ Skip OCR</button>`;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/jpeg,image/png";
  fileInput.style.display = "none";
  menu.appendChild(fileInput);

  menu.querySelector('[data-action="retry"]').onclick = () => {
    menu.remove();
    const f = getCurrentFile(wrap);
    if (f) runOcrOnImage(wrap, previewArea, statusEl, textareaId, num);
  };
  menu.querySelector('[data-action="replace"]').onclick = () => {
    fileInput.click();
  };
  menu.querySelector('[data-action="skip"]').onclick = () => {
    menu.remove();
    wrap.dataset.skipped = "1";
    setOcrBadge(wrap.querySelector(".ocr-badge"), "skipped");
  };
  fileInput.onchange = (e) => {
    const newFile = e.target.files[0];
    if (!newFile) return;
    menu.remove();
    openBatchEditor([newFile], async (results) => {
      const editedFile = results[0];
      if (!editedFile) return;
      removeImageText(wrap, $(textareaId));
      wrap._currentFile = editedFile;
      wrap.querySelector("img").src = URL.createObjectURL(editedFile);
      await runOcrOnImage(wrap, previewArea, statusEl, textareaId, num);
    });
  };
  return menu;
}

function positionContextMenu(menu, x, y) {
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + "px";
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + "px";
}

let longPressTimer = null;

function attachContextMenu(wrap, previewArea, statusEl, textareaId, num) {
  wrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const menu = buildContextMenu(wrap, previewArea, statusEl, textareaId, num);
    positionContextMenu(menu, e.clientX, e.clientY);
  });
  wrap.addEventListener("touchstart", (e) => {
    longPressTimer = setTimeout(() => {
      e.preventDefault();
      const touch = e.touches[0];
      const menu = buildContextMenu(wrap, previewArea, statusEl, textareaId, num);
      positionContextMenu(menu, touch.clientX, touch.clientY);
    }, 600);
  });
  wrap.addEventListener("touchend", () => clearTimeout(longPressTimer));
  wrap.addEventListener("touchmove", () => clearTimeout(longPressTimer));
}

function setOcrBadge(badge, state) {
  const icons = { working: "...", done: "✓", failed: "✗", skipped: "⏭" };
  badge.textContent = icons[state];
  badge.className = `ocr-badge ${state}`;
}

async function runOcrOnImage(wrap, previewArea, statusEl, textareaId, num) {
  const file = getCurrentFile(wrap);
  if (!file) { statusEl.textContent = `❌ Image ${num}: no file`; return; }
  const textareaEl = $(textareaId);
  const badge = wrap.querySelector(".ocr-badge");
  removeImageText(wrap, textareaEl);
  setOcrBadge(badge, "working");
  statusEl.textContent = `⏳ Image ${num} ka text nikala ja raha hai...`;
  try {
    const textTrimmed = (await visionOCR(file)).trim();
    textareaEl.value = (textareaEl.value ? textareaEl.value + "\n\n" : "") + textTrimmed;
    wrap._insertedText = textTrimmed;
    delete wrap.dataset.skipped;
    textareaEl.dispatchEvent(new Event("input"));
    setOcrBadge(badge, "done");
    statusEl.textContent = `✅ Image ${num} ho gayi. (Image ko dabaye rakhein: retry / replace)`;
  } catch (err) {
    setOcrBadge(badge, "failed");
    statusEl.textContent = `❌ Image ${num}: ${err.message}`;
  }
}

async function processImages(fileList, previewArea, statusEl, textareaId) {
  const files = Array.from(fileList).filter(f => f.type === "image/jpeg" || f.type === "image/png");
  if (files.length === 0) { showToast("Sirf JPG/PNG support hain.", "error"); return; }
  // Step 1: user edits all images in the photo editor, then presses Upload
  const editedFiles = await new Promise(resolve => openBatchEditor(files, resolve));
  if (!editedFiles || !editedFiles.length) return;

  // Step 2: add a numbered thumbnail per image, then OCR them one by one
  const startIndex = previewArea.children.length;
  const wraps = editedFiles.map((file, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb-wrap";
    wrap._currentFile = file;
    wrap.innerHTML = `<span class="thumb-num">${startIndex + idx + 1}</span><img alt="" /><span class="ocr-badge working">...</span>`;
    wrap.querySelector("img").src = URL.createObjectURL(file);
    previewArea.appendChild(wrap);
    attachContextMenu(wrap, previewArea, statusEl, textareaId, startIndex + idx + 1);
    return wrap;
  });
  for (const [idx, wrap] of wraps.entries()) {
    await runOcrOnImage(wrap, previewArea, statusEl, textareaId, startIndex + idx + 1);
  }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".img-context-menu")) {
    document.querySelectorAll(".img-context-menu").forEach(m => m.remove());
  }
});

// Position of the rendered image inside its container (object-fit: contain, centered)
function getImageDisplayRect(img) {
  const cr = img.parentElement.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  return { x: ir.left - cr.left, y: ir.top - cr.top, w: ir.width, h: ir.height };
}

function dataURLToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)[1];
  const bytes = atob(parts[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ============================================
// BATCH IMAGE EDITOR (multi-image edit screen)
// ============================================
let batchState = null;
// Filters that help OCR on scanned / photographed documents
const FILTER_PRESETS = {
  original: { filter: 'none', label: 'Original' },
  auto: { filter: 'contrast(115%) brightness(105%)', label: 'Auto' },
  document: { filter: 'grayscale(100%) contrast(150%) brightness(110%)', label: 'Document' },
  bw: { filter: 'grayscale(100%) contrast(110%)', label: 'B&W' },
  bright: { filter: 'brightness(125%) contrast(105%)', label: 'Bright' }
};

function openBatchEditor(fileList, callback) {
  const files = Array.from(fileList).filter(f => f.type === "image/jpeg" || f.type === "image/png");
  if (!files.length) { showToast("Sirf JPG/PNG support hain.", "error"); return; }
  batchState = {
    files,
    edits: files.map(() => ({ rotation: 0, filter: 'original' })),
    currentIndex: 0,
    callback
  };
  renderFilmstrip();
  batchSelectImage(0);
  $("batchEditorModal").classList.remove("hidden");
}

function closeBatchEditor() {
  $("batchEditorModal").classList.add("hidden");
  if (batchState && batchState.callback) {
    batchState.callback([]);
  }
  batchState = null;
}

$("batchEditorBack").addEventListener("click", closeBatchEditor);

function batchSelectImage(index) {
  if (!batchState || index < 0 || index >= batchState.files.length) return;
  batchState.currentIndex = index;
  const state = batchState;
  const file = state.files[index];
  const edit = state.edits[index];
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = $("batchPreview");
    img.src = e.target.result;
    img.style.transform = `rotate(${edit.rotation}deg)`;
    img.style.filter = FILTER_PRESETS[edit.filter]?.filter || 'none';
    removeBatchCrop();
    $("batchFilterPanel").classList.add("hidden");
    document.querySelectorAll(".batch-tool-btn").forEach(b => b.classList.remove("active"));
    $("batchEditorCounter").textContent = `${index + 1}/${state.files.length}`;
    updateFilmstrip();
  };
  reader.readAsDataURL(file);
}

function updateFilmstrip() {
  document.querySelectorAll(".filmstrip-item").forEach((el, i) => {
    el.classList.toggle("active", i === batchState.currentIndex);
    const edited = batchState.edits[i].rotation !== 0 || batchState.edits[i].cropped || batchState.edits[i].filter !== 'original';
    el.classList.toggle("edited", edited);
  });
  // Scroll active into view
  const active = document.querySelector(".filmstrip-item.active");
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function renderFilmstrip() {
  const strip = $("batchFilmstrip");
  strip.innerHTML = "";
  batchState.files.forEach((file, i) => {
    const item = document.createElement("div");
    item.className = "filmstrip-item";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    const badge = document.createElement("div");
    badge.className = "edit-badge";
    item.appendChild(img);
    item.appendChild(badge);
    item.addEventListener("click", () => batchSelectImage(i));
    strip.appendChild(item);
  });
}

// ---- TOOLBAR ----
document.querySelectorAll(".batch-tool-btn[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    const filterPanel = $("batchFilterPanel");
    const isActive = btn.classList.contains("active");
    document.querySelectorAll(".batch-tool-btn").forEach(b => b.classList.remove("active"));
    filterPanel.classList.add("hidden");
    removeBatchCrop();
    if (!isActive) {
      btn.classList.add("active");
      if (tool === "crop") { initBatchCrop(); }
      if (tool === "filter") { renderFilters(); filterPanel.classList.remove("hidden"); }
    }
  });
});

$("batchRotateLeft").addEventListener("click", () => {
  const state = batchState; if (!state) return;
  const edit = state.edits[state.currentIndex];
  edit.rotation = (edit.rotation - 90 + 360) % 360;
  $("batchPreview").style.transform = `rotate(${edit.rotation}deg)`;
    removeBatchCrop();
    $("batchEditorCounter").textContent = `${state.currentIndex + 1}/${state.files.length}`;
    updateFilmstrip();
});

$("batchResetImg").addEventListener("click", () => {
  const state = batchState; if (!state) return;
  const idx = state.currentIndex;
  state.edits[idx] = { rotation: 0, filter: 'original' };
  batchSelectImage(idx);
});

// ---- ENHANCED CROP ----
let batchCropHandlers = null;

function initBatchCrop() {
  const state = batchState; if (!state) return;
  const img = $("batchPreview");
  const preview = img.parentElement;
  const edit = state.edits[state.currentIndex];
  const overlay = $("batchCropOverlay");
  const win = $("batchCropWindow");
  overlay.classList.remove("hidden");
  const cw = preview.clientWidth || 300, ch = preview.clientHeight || 300;
  const dr = getImageDisplayRect(img);
  win.style.left = dr.x + "px";
  win.style.top = dr.y + "px";
  win.style.width = dr.w + "px";
  win.style.height = dr.h + "px";
  const handleSz = Math.max(36, Math.min(80, Math.min(cw, ch) * 0.1));
  const half = handleSz / 2;
  win.querySelectorAll(".crop-handle").forEach(el => {
    el.style.width = handleSz + "px"; el.style.height = handleSz + "px";
    const p = el.dataset.dir;
    if (p) { if (p.includes("n")) el.style.top = -half + "px"; if (p.includes("s")) el.style.bottom = -half + "px"; if (p.includes("w")) el.style.left = -half + "px"; if (p.includes("e")) el.style.right = -half + "px"; }
  });

  // Clean old handlers
  if (batchCropHandlers) {
    document.removeEventListener("mousemove", batchCropHandlers.move);
    document.removeEventListener("mouseup", batchCropHandlers.up);
    document.removeEventListener("touchmove", batchCropHandlers.tmove, batchCropHandlers.tOpts);
    document.removeEventListener("touchend", batchCropHandlers.tend, batchCropHandlers.teOpts);
  }
  const imgL = dr.x, imgT = dr.y, imgR = dr.x + dr.w, imgB = dr.y + dr.h;
  const handlers = { dragHandle: null, startX: 0, startY: 0, startR: null, dragged: false };
  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));

  function onDown(cx, cy, dir) {
    const c = preview.getBoundingClientRect();
    const r = win.getBoundingClientRect();
    handlers.startX = cx; handlers.startY = cy;
    handlers.startR = { l: r.left - c.left, t: r.top - c.top, r: r.right - c.left, b: r.bottom - c.top, w: r.width, h: r.height };
    handlers.dragHandle = dir || "move";
    handlers.dragged = false;
  }

  win.onmousedown = (e) => {
    const dir = e.target.dataset.dir;
    onDown(e.clientX, e.clientY, dir);
    e.preventDefault();
  };
  win.ontouchstart = (e) => {
    const t = e.touches[0]; const dir = e.target.dataset.dir;
    onDown(t.clientX, t.clientY, dir);
    e.preventDefault();
  };

  function doMove(dx, dy) {
    if (!handlers.dragHandle || !handlers.startR) return;
    handlers.dragged = true;
    const r = handlers.startR;
    let l = r.l, t = r.t, ri = r.r, b = r.b;
    if (handlers.dragHandle === "move") {
      l = clamp(r.l + dx, imgL, imgR - r.w);
      t = clamp(r.t + dy, imgT, imgB - r.h);
      ri = l + r.w; b = t + r.h;
    } else {
      const d = handlers.dragHandle;
      if (d.includes("w")) l = clamp(r.l + dx, imgL, r.r - 40);
      if (d.includes("e")) ri = clamp(r.r + dx, r.l + 40, imgR);
      if (d.includes("n")) t = clamp(r.t + dy, imgT, r.b - 40);
      if (d.includes("s")) b = clamp(r.b + dy, r.t + 40, imgB);
    }
    win.style.left = l + "px"; win.style.top = t + "px";
    win.style.width = (ri - l) + "px"; win.style.height = (b - t) + "px";
  }

  const onMouseMove = (e) => { if (!handlers.dragHandle) return; doMove(e.clientX - handlers.startX, e.clientY - handlers.startY); };
  const onMouseUp = () => { if (handlers.dragged) doApplyCrop(); handlers.dragHandle = null; };
  const onTouchMove = (e) => { if (!handlers.dragHandle) return; e.preventDefault(); const t = e.touches[0]; doMove(t.clientX - handlers.startX, t.clientY - handlers.startY); };
  const onTouchEnd = () => { if (handlers.dragged) doApplyCrop(); handlers.dragHandle = null; };
  const tOpts = { passive: false };
  const teOpts = { passive: true };
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("touchmove", onTouchMove, tOpts);
  document.addEventListener("touchend", onTouchEnd, teOpts);
  batchCropHandlers = { move: onMouseMove, up: onMouseUp, tmove: onTouchMove, tend: onTouchEnd, tOpts, teOpts };
}

function removeBatchCrop() {
  $("batchCropOverlay").classList.add("hidden");
}

function doApplyCrop() {
  const state = batchState; if (!state) return;
  const img = $("batchPreview");
  const win = $("batchCropWindow");
  const preview = img.parentElement;
  const cw = preview.clientWidth, ch = preview.clientHeight;
  if (!cw || !ch) return;
  const dr = getImageDisplayRect(img);
  const l = (parseFloat(win.style.left) || 0) - dr.x;
  const t = (parseFloat(win.style.top) || 0) - dr.y;
  const w = Math.min(parseFloat(win.style.width) || cw, dr.w);
  const h = Math.min(parseFloat(win.style.height) || ch, dr.h);
  const selL = Math.max(0, l), selT = Math.max(0, t);
  const selW = Math.min(w, dr.w - selL), selH = Math.min(h, dr.h - selT);
  if (selW < 20 || selH < 20) { showToast("Selection bahut chhota", "error"); return; }
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) { showToast("Image load nahi hui", "error"); return; }
  const rot = state.edits[state.currentIndex].rotation || 0;
  const isRot = (rot / 90) % 2 !== 0;
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = isRot ? ih : iw;
  fullCanvas.height = isRot ? iw : ih;
  const fctx = fullCanvas.getContext("2d");
  fctx.translate(fullCanvas.width/2, fullCanvas.height/2);
  fctx.rotate(rot * Math.PI / 180);
  fctx.drawImage(img, -iw/2, -ih/2);
  
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((selW / dr.w) * fullCanvas.width);
  canvas.height = Math.round((selH / dr.h) * fullCanvas.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(fullCanvas, (selL / dr.w) * fullCanvas.width, (selT / dr.h) * fullCanvas.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL(state.files[state.currentIndex].type || "image/jpeg");
  const blob = dataURLToBlob(dataUrl);
  const croppedFile = new File([blob], state.files[state.currentIndex].name, { type: state.files[state.currentIndex].type });
  state.files[state.currentIndex] = croppedFile;
  state.edits[state.currentIndex].cropped = true;
  state.edits[state.currentIndex].rotation = 0;
  img.src = dataUrl;
  img.style.transform = "rotate(0deg)";
  img.style.filter = FILTER_PRESETS[state.edits[state.currentIndex].filter]?.filter || "none";
  showToast("Crop applied ✓", "success");
  removeBatchCrop();
  document.querySelectorAll(".batch-tool-btn").forEach(b => b.classList.remove("active"));
  updateFilmstrip();
  // Clean up event listeners to prevent re-crop on next click
  if (batchCropHandlers) {
    document.removeEventListener("mousemove", batchCropHandlers.move);
    document.removeEventListener("mouseup", batchCropHandlers.up);
    document.removeEventListener("touchmove", batchCropHandlers.tmove, batchCropHandlers.tOpts);
    document.removeEventListener("touchend", batchCropHandlers.tend, batchCropHandlers.teOpts);
    batchCropHandlers = null;
  }
}

// ---- FILTERS ----
function renderFilters() {
  const scroll = $("batchFilterScroll");
  const state = batchState; if (!state) return;
  const img = $("batchPreview");
  const currentFilter = state.edits[state.currentIndex].filter;
  scroll.innerHTML = "";
  const thumbSize = 60;
  const canvas = document.createElement("canvas");
  canvas.width = thumbSize; canvas.height = thumbSize;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, thumbSize, thumbSize);
  Object.entries(FILTER_PRESETS).forEach(([key, preset]) => {
    const div = document.createElement("div");
    div.className = "filter-preset" + (key === currentFilter ? " active" : "");
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const c = document.createElement("canvas");
    c.width = thumbSize; c.height = thumbSize;
    const cx = c.getContext("2d");
    cx.filter = preset.filter;
    cx.drawImage(canvas, 0, 0);
    thumb.appendChild(c);
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = preset.label;
    div.appendChild(thumb);
    div.appendChild(label);
    div.addEventListener("click", () => {
      const img = $("batchPreview");
      state.edits[state.currentIndex].filter = key;
      img.style.filter = preset.filter;
      document.querySelectorAll(".filter-preset").forEach(p => p.classList.remove("active"));
      div.classList.add("active");
      updateFilmstrip();
    });
    scroll.appendChild(div);
  });
}


// ---- UPLOAD ALL ----
$("batchUploadBtn").addEventListener("click", batchUploadAll);

async function batchUploadAll() {
  const state = batchState; if (!state) return;
  const btn = $("batchUploadBtn");
  btn.disabled = true;
  btn.textContent = "Processing...";
  $("batchEditorModal").classList.add("hidden");

  try {
    const results = [];
    for (let i = 0; i < state.files.length; i++) {
      btn.textContent = `Processing ${i + 1}/${state.files.length}...`;
      await new Promise(r => setTimeout(r, 10)); // Yield main thread to prevent freeze
      try {
        const result = await applyBatchEdits(state.files[i], state.edits[i]);
        results.push(result);
      } catch (e) {
        showToast(`Image ${i + 1} error: ${e.message}`, "error");
        results.push(state.files[i]);
      }
    }
    if (state.callback) state.callback(results);
  } finally {
    btn.disabled = false;
    btn.textContent = "Upload ↑";
    batchState = null;
  }
}

async function applyBatchEdits(file, edit) {
  // Crops are already baked into the file when applied; only rotation / filter remain
  if (!edit.rotation && edit.filter === 'original') return file;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Image corrupt ya invalid hai"));
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (edit.rotation === 90 || edit.rotation === 270) { w = img.naturalHeight; h = img.naturalWidth; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.translate(w / 2, h / 2);
        if (edit.rotation) ctx.rotate(edit.rotation * Math.PI / 180);
        if (edit.filter && edit.filter !== 'original') {
          ctx.filter = FILTER_PRESETS[edit.filter].filter;
        }
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        canvas.toBlob(blob => {
          resolve(new File([blob], file.name, { type: file.type }));
        }, file.type || "image/jpeg");
      } catch (e) { reject(e); }
    };
    img.src = URL.createObjectURL(file);
  });
}

// ============================================
// STEP AI ACTIONS
// ============================================
function setBtnLoading(btnId, spinId, isLoading, targetTextareaId = null) {
  $(btnId).disabled = isLoading;
  $(spinId).classList.toggle("hidden", !isLoading);
  if (targetTextareaId && $(targetTextareaId)) {
    if (isLoading) {
      $(targetTextareaId).classList.add("loading-skeleton");
    } else {
      $(targetTextareaId).classList.remove("loading-skeleton");
    }
  }
}

$("extractFactsBtn").addEventListener("click", async () => {
  const inputText = $("plaintText").value.trim();
  if (!inputText) { showToast("Plaint text khali hai.", "error"); return; }

  const prompt = `TASK:
You are a senior Pakistani court legal translator. Convert the given Urdu/Roman Urdu plaint into formal legal English, suitable for use in a court judgment. This is a translation task — preserve every substantive line of the plaint in legal English, maintaining the same sequence and paragraph flow as the original.

-------------------------------------

OUTPUT STRUCTURE (strict order):

PARTIES
(Names only — no walid/binti, no address, no caste, no CNIC)
- Plaintiff No.1: [name]
- Plaintiff No.2 / Minor Plaintiff: [name] (Minor) — if applicable
- Defendant No.1: [name]

NATURE OF SUIT
(One line only — what kind of suit this is)
Example: "Suit for dissolution of marriage, recovery of maintenance, and recovery of delivery and medical expenses."

FACTS
(Translate every substantive line/paragraph of the plaint into formal legal English, in the same sequence as the original. End with claims and relief as part of the natural paragraph flow — do NOT create separate headings for Claims and Relief. Instead, after the last fact, write the claims and prayer as continuing paragraphs, like this:)

....[last fact]....

The plaintiff claims: (i) dissolution of marriage; (ii) maintenance for plaintiff at PKR [X]/month; (iii) maintenance for minor at PKR [X]/month with [Y]% annual increment; (iv) [other claims with amounts].

It is therefore prayed that a decree be passed in favour of the plaintiff(s) for [all reliefs with amounts], along with costs of the suit.

-------------------------------------

STRICT TRANSLATION RULES:

1. TRANSLATE EVERY LINE
- Har substantive line/para ko legal English mein convert karein
- Original sequence same rakhein — koi line skip na karein (siwaye documents ke, neeche Rule 2)
- Ye translation hai, extraction nahi — har baat jo plaint mein hai wo output mein aani chahiye

2. SKIP ONLY THESE (document references & administrative):
- Nikah Nama, B-Form, dowry list, court fee, stamp, diary number, signature, advocate name, jurisdiction para, cause of action para
- "Copy attached", "annexed herewith", "as per list" — ye phrases skip karein
- "This honorable court has jurisdiction" — skip
- Reason: ye judicial drafting mein automatically assumed hotay hain

3. LEGAL LANGUAGE CONVERSION
- Emotional/religious phrases → neutral legal equivalents:
  ❌ "within the bounds of Allah" → ✅ remove entirely
  ❌ "extreme aversion" → ✅ "reconciliation is not possible"
  ❌ "cruel behavior" → ✅ "subjected to physical and verbal abuse"
  ❌ "man of means" → ✅ "financially capable" or state assets neutrally
  ❌ "plaintiff prefers death" → ✅ remove / "reconciliation is not possible"
  ❌ "for the sake of honor" → ✅ remove
- Use standard legal phrasing:
  ✅ "It is submitted that..."
  ✅ "The plaintiff states that..."
  ✅ "The defendant allegedly..."
  ✅ "The minor plaintiff is in the custody of..."

4. NAME ACCURACY & SCRIPT (CRITICAL)
- All names (plaintiff, defendant, minor) → Roman English only
- Urdu script names → transliterate: "حنا اعظم" → "Hina Azam"
- Once written in full, use consistently throughout
- PKR amounts, dates → copy exactly as in original
- Legal terms: Nikah, Iddat, Khula, Mehr, Rukhsati → keep in Roman English as-is

5. CLAIMS FORMAT (within paragraph, not a separate section)
- After last fact, write claims as a numbered inline list:
  "The plaintiff claims: (i) dissolution of marriage; (ii) maintenance for Plaintiff No.1 at PKR [X]/month [+ iddat expenses if claimed]; (iii) maintenance for [minor name] at PKR [X]/month with [Y]% annual increment from [date]; (iv) delivery expenses of PKR [X]; (v) medical expenses of PKR [X]."
- Include ALL amounts/percentages/dates mentioned in original

6. RELIEF (last paragraph, no heading)
- "It is therefore prayed that a decree be passed in favour of the plaintiff(s) for [list all reliefs with amounts], along with costs of the suit. Any other relief deemed just and equitable may also be granted."

7. CONSISTENCY
- No repetition
- Chronological order maintain karein
- No legal conclusions or arguments — facts only (until claims paragraph)

-------------------------------------

INPUT (Urdu/Roman Urdu Plaint):
${inputText}

-------------------------------------

OUTPUT:
Provide ONLY the structured output as described. No explanation. No preamble. No extra headings beyond PARTIES, NATURE OF SUIT, and FACTS.`;

  setBtnLoading("extractFactsBtn", "spin-extractFacts", true, "factsText");
  try {
    const result = await callAI(prompt, 2500);
    await logAIStep("facts_extraction", prompt, result);
    $("factsText").value = result;
    $("factsText").dispatchEvent(new Event("input"));
    $("factsOutput").classList.remove("hidden");
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { setBtnLoading("extractFactsBtn", "spin-extractFacts", false, "factsText"); }
});

$("extractAdmitDenyBtn").addEventListener("click", async () => {
  const ws = $("wsText").value.trim(), facts = $("factsText").value.trim();
  if (!ws || !facts) { showToast("WS aur Facts dono zaroori hain.", "error"); return; }

  const prompt = `You are a legal assistant for Pakistani Civil and Family Courts. Compare the Plaint Facts and Written Statement strictly on a para-to-response basis.

========================
CORE INSTRUCTION

- Handle both Civil and Family cases.
- Transliterate any Urdu script proper nouns to Roman English.
- Keep legal terms (e.g., Nikah, Khula, Mehr, Stay Order, Specific Performance) in Roman English as-is.
- Each Plaint para must be evaluated ONLY against explicit and specific statements in the Written Statement.

Do NOT rely on:

- Assumptions
- Implications
- Similar wording
- Legal interpretation

Match ONLY when the Written Statement clearly refers to the SAME factual assertion.

========================
STRICT MATCHING RULE

A match exists ONLY if:

- The Written Statement explicitly addresses the SAME fact
- AND clearly accepts or contradicts it

If the Written Statement:

- uses general denial (e.g. "all allegations denied")
- discusses something similar but not identical
- omits the fact entirely

→ Then classify as:
NOT SPECIFICALLY DENIED

========================
CLASSIFICATION RULES

ADMIT:

- Fact is clearly and explicitly accepted

DENY:

- Fact is clearly and explicitly contradicted

PARTIAL ADMIT:

- A SINGLE para contains BOTH:
  - clear admission of one part
  - AND clear denial of another part of the SAME fact

NOT SPECIFICALLY DENIED:

- No direct response to that exact fact
- OR only general/blanket denial is present

========================
REASON RULE (VERY STRICT)

- Copy ONLY the exact relevant line(s) from Written Statement
- DO NOT paraphrase
- DO NOT summarize
- If no exact line exists, write:
  No specific reference found in Written Statement

========================
INPUT

PLAINT FACTS (para-wise):
${facts}

WRITTEN STATEMENT:
${ws}

========================
OUTPUT FORMAT (STRICT)

Para X:
Status: ADMIT / DENY / PARTIAL ADMIT / NOT SPECIFICALLY DENIED
Reason: <exact quoted line OR "No specific reference found in Written Statement">

========================
CRITICAL RULES

- Evaluate EACH para independently
- DO NOT merge paras
- DO NOT skip any para
- DO NOT infer connections
- DO NOT generate explanations
- DO NOT add headings beyond given format

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences
Start directly with Para 1`;

  setBtnLoading("extractAdmitDenyBtn", "spin-extractAdmitDeny", true, "admitDenyText");
  try {
    const result = await callAI(prompt, 2200);
    await logAIStep("admit_deny", prompt, result);
    $("admitDenyText").value = result; $("admitDenyText").dispatchEvent(new Event("input"));
    $("admitDenyOutput").classList.remove("hidden");
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { setBtnLoading("extractAdmitDenyBtn", "spin-extractAdmitDeny", false, "admitDenyText"); }
});

$("mapDisputesBtn").addEventListener("click", async () => {
  const issues = $("issuesText").value.trim();
  if (!issues) { showToast("Issues paste/upload karein.", "error"); return; }
  const prompt = `You are a legal assistant for Pakistani Civil and Family Courts. Your task is to map disputes issue-wise using ONLY the given Issues, Facts, and Admit/Deny data.

========================
CORE INSTRUCTION

- Handle both Civil and Family cases appropriately.
- Transliterate any Urdu script proper nouns to Roman English.
- Keep legal terms in Roman English as-is.

For EACH issue:

- Identify ONLY those facts which are directly relevant to that issue
- Use Admit/Deny status to determine whether the fact is disputed

DO NOT:

- Create new issues
- Rephrase or modify issues
- Add legal interpretation
- Infer beyond given text

========================
DISPUTE IDENTIFICATION RULE

A fact is DISPUTED only if:

- Its status is DENY or PARTIAL ADMIT

A fact is NOT disputed if:

- Status is ADMIT

If status is:

- NOT SPECIFICALLY DENIED → treat as DISPUTED

========================
MAPPING RULE

- Link facts to issues ONLY when clearly connected
- Do NOT force-fit facts into issues
- If no fact relates to an issue, write:
  [No relevant disputed fact found]

========================
STANCE RULE (STRICT)

For each disputed fact:

Plaintiff Stance:

- Extract directly from Facts (relevant para only)
- DO NOT summarize beyond given wording

Defendant Stance:

- Based ONLY on Admit/Deny result:
  - DENY → "Denied"
  - PARTIAL ADMIT → "Partially admitted"
  - NOT SPECIFICALLY DENIED → "No specific denial"

DO NOT invent explanations

========================
INPUT

ISSUES:
${issues}

FACTS:
${$("factsText").value.trim()}

ADMIT/DENY:
${$("admitDenyText").value.trim()}

========================
OUTPUT FORMAT (STRICT)

Issue X:
Disputed Facts:

1. 

Fact: <relevant fact para or line>
Plaintiff Stance: <from facts>
Defendant Stance: Denied / Partially admitted / No specific denial

(repeat for each disputed fact)

========================
CRITICAL RULES

- Process EACH issue separately
- DO NOT merge issues
- DO NOT skip any issue
- DO NOT include non-disputed facts
- DO NOT explain reasoning
- DO NOT generate new content

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences`;
  setBtnLoading("mapDisputesBtn", "spin-mapDisputes", true, "disputesText");
  try {
    const result = await callAI(prompt, 2000);
    await logAIStep("dispute_mapping", prompt, result);
    $("disputesText").value = result; $("disputesText").dispatchEvent(new Event("input"));
    $("disputesOutput").classList.remove("hidden");
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { setBtnLoading("mapDisputesBtn", "spin-mapDisputes", false, "disputesText"); }
});

$("analyzeEvidenceBtn").addEventListener("click", async () => {
  const evidence = $("evidenceText").value.trim();
  if (!evidence) { showToast("Evidence khali hai.", "error"); return; }
  const prompt = `You are a legal assistant for Pakistani Civil and Family Courts. Your task is to analyze evidence issue-wise using ONLY the provided Issues, Disputes, and Evidence.

========================
CORE INSTRUCTION

- Handle both Civil and Family cases appropriately.
- Transliterate any Urdu script proper nouns to Roman English.
- Keep legal terms in Roman English as-is.

For EACH issue:

- Analyze ONLY the disputed facts linked to that issue
- Use ONLY the provided evidence
- Do NOT use legal principles, assumptions, or external knowledge

========================
EVIDENCE USAGE RULE

- Refer ONLY to evidence explicitly provided
- DO NOT assume existence of any document, witness, or fact
- DO NOT extend or interpret evidence beyond its literal meaning

If evidence is:

- Missing
- Irrelevant
- Insufficient

→ Clearly state:
Evidence is insufficient to prove or disprove the disputed fact

========================
ANALYSIS STRUCTURE (STRICT)

For EACH issue:

Issue X:

Analysis:

- Examine each disputed fact briefly
- Link it ONLY with relevant evidence (if available)
- No assumptions, no legal theory

Reasoning:

- Explain outcome strictly based on:
  - Whether evidence supports plaintiff
  - OR supports defendant
  - OR is insufficient

Finding:

- Clearly conclude ONE of:
  - In favour of Plaintiff
  - In favour of Defendant
  - Not proved due to insufficient evidence

========================
DISPUTE HANDLING RULE

- Consider ONLY disputed facts from input
- Ignore admitted facts
- Do NOT introduce new facts

========================
INPUT

ISSUES:
${$("issuesText").value.trim()}

DISPUTES:
${$("disputesText").value.trim()}

EVIDENCE:
${evidence}

========================
CRITICAL RULES

- DO NOT generate new facts
- DO NOT assume missing links
- DO NOT apply legal doctrines
- DO NOT exaggerate evidence
- DO NOT merge issues
- DO NOT skip any issue

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences`;
  setBtnLoading("analyzeEvidenceBtn", "spin-analyzeEvidence", true, "findingsText");
  try {
    const result = await callAI(prompt, 3000);
    await logAIStep("evidence_analysis", prompt, result);
    $("findingsText").value = result; $("findingsText").dispatchEvent(new Event("input"));
    $("findingsOutput").classList.remove("hidden");
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { setBtnLoading("analyzeEvidenceBtn", "spin-analyzeEvidence", false, "findingsText"); }
});

$("generateFinalBtn").addEventListener("click", async () => {
  const shortOrder = $("shortOrder").value.trim();
  if (!shortOrder) { showToast("Short Order zaroori hai.", "error"); return; }
  const prompt = `You are a senior judge drafting a formal court judgement for Pakistani Civil and Family Courts using ONLY the provided inputs.

========================
CORE INSTRUCTION

- Handle both Civil and Family cases accurately.
- Transliterate any Urdu script proper nouns to Roman English.
- Keep legal terms (e.g., Nikah, Iddat, Khula, Mehr, Rukhsati, Specific Performance, Stay Order, Declaration, Injunction) in Roman English as-is.
- Use ONLY the given FACTS, ISSUES, FINDINGS, and SHORT ORDER
- DO NOT generate new facts, issues, or findings
- DO NOT modify or reinterpret findings
- DO NOT apply external legal knowledge

========================
STRUCTURE (STRICT)

Write the judgement in EXACTLY this order:

1. Introduction
2. Facts
3. Issues
4. Findings
5. Final Order

Do NOT change headings or order

========================
SECTION RULES

INTRODUCTION:

- Briefly state nature of case using given data only
- No new facts

FACTS:

- Summarize from FACTS input only
- Do NOT add or infer anything

ISSUES:

- List EXACTLY as provided
- Do NOT rephrase

FINDINGS:

- Use FINDINGS input strictly
- Do NOT alter conclusions
- Do NOT add new reasoning

FINAL ORDER:

- Use SHORT ORDER as final decision
- Do NOT modify outcome
- Only convert into formal court language if needed

========================
LANGUAGE RULE

- Formal court style
- Clear and concise
- No decorative or creative writing

========================
INPUT

FACTS:
${$("factsText").value.trim()}

ADMIT/DENY:
${$("admitDenyText").value.trim()}

ISSUES:
${$("issuesText").value.trim()}

FINDINGS:
${$("findingsText").value.trim()}

SHORT ORDER:
${shortOrder}

========================
CRITICAL RULES

- DO NOT change meaning of any input
- DO NOT introduce new material
- DO NOT omit any section
- DO NOT merge sections
- DO NOT add explanations outside structure

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences
Judgement must start directly with Introduction`;
  setBtnLoading("generateFinalBtn", "spin-generateFinal", true, "judgementOutput");
  try {
    const result = await callAI(prompt, 3500);
    await logAIStep("final_judgement", prompt, result);
    $("judgementOutput").value = result; $("judgementOutput").dispatchEvent(new Event("input"));
    showJudgementActions();
    $("chatLog").innerHTML = "";
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { setBtnLoading("generateFinalBtn", "spin-generateFinal", false, "judgementOutput"); }
});

// ============================================
// APPROVE / FINALIZE / SEND BACK
// ============================================
const TITLE_GROUNDS_PROMPT = `You are a legal assistant for Pakistani Civil and Family Courts. Your task is to extract ONLY the case title and legal grounds from the given judgement.

========================
CORE INSTRUCTION

- Handle both Civil and Family cases.
- Transliterate any Urdu script proper nouns to Roman English.
- Extract information ONLY from the given judgement text
- DO NOT generate, assume, or infer anything
- DO NOT create new titles or legal grounds

========================
TITLE RULE (STRICT)

- Create a SHORT title using:
  - Nature of case (if clearly mentioned)
  - Plaintiff vs Defendant (names if available)
- If names are not clearly available, write:
  [Not specified in judgement]
- DO NOT add extra facts, dates, locations or creative wording

========================
GROUNDS RULE (STRICT)

- Extract ONLY explicitly mentioned laws, ordinances and sections
- If multiple are mentioned, list all in one line, separated by commas
- If NO law or section is clearly mentioned, write:
  [Not specified in judgement]
- DO NOT guess or add legal provisions

========================
OUTPUT FORMAT (STRICT)

TITLE: <text>
GROUNDS: <text>

Plain text only. No markdown, no asterisks, no explanations, no extra lines.

========================
Judgement:
`;

async function extractTitleAndGrounds(judgement) {
  const result = await callAI(TITLE_GROUNDS_PROMPT + judgement, 300);
  const titleMatch = result.match(/TITLE:\s*(.+)/i);
  const groundsMatch = result.match(/GROUNDS:\s*(.+)/i);
  return {
    case_title: titleMatch ? titleMatch[1].trim() : "Untitled Case",
    legal_grounds: groundsMatch ? groundsMatch[1].trim() : ""
  };
}

// Marks a case finalized with an AI-extracted title/grounds. Used by the wizard and the review list.
async function finalizeCaseById(caseId, judgement) {
  showToast("Title & legal grounds extract ho rahe hain...", "info");
  const meta = await extractTitleAndGrounds(judgement);
  const { error } = await sb.from("cases").update({
    judgement_output: judgement,
    status: "finalized",
    review_comment: null,
    last_updated_by: currentProfile?.id,
    ...meta
  }).eq("id", caseId);
  if (error) throw error;
}

async function finalizeActiveCase(btn, successMsg) {
  const judgement = $("judgementOutput").value.trim();
  if (!judgement) { showToast("Judgement draft empty hai.", "error"); return; }
  if (!confirm("Kya aap is draft ko finalize karna chahte hain?")) return;
  btn.disabled = true;
  try {
    clearTimeout(saveTimer);
    pendingAutosave = null;
    await saveOrUpdateCase(getWizardFields());
    await finalizeCaseById(activeCase.id, judgement);
    showToast(successMsg, "success");
    await stopLiveMode();
    showDashboard();
  } catch (err) {
    showToast("Finalize error: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

$("wizApproveBtn").addEventListener("click", () => finalizeActiveCase($("wizApproveBtn"), "Case approved and finalized!"));
$("finalizeBtn").addEventListener("click", () => finalizeActiveCase($("finalizeBtn"), "Case finalize ho gaya!"));

$("wizSendBackBtn").addEventListener("click", async () => {
  const comment = prompt("Send back karne ki wajah / correction instructions likhein:");
  if (!comment?.trim()) return;
  clearTimeout(saveTimer);
  pendingAutosave = null;
  const ok = await saveOrUpdateCase({
    ...getWizardFields(),
    status: "pending",
    current_step: 5,
    review_comment: comment.trim()
  });
  if (!ok) return;
  showToast("Case Steno ko send back ho gaya!", "success");
  await stopLiveMode();
  showDashboard();
});

// ============================================
// CHAT REFINE
// ============================================
function addChatBubble(text, isUser) {
  const log = $("chatLog");
  const div = document.createElement("div");
  div.className = `chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-ai"}`;
  div.textContent = text; log.appendChild(div); log.scrollTop = log.scrollHeight;
}
$("chatSendBtn").addEventListener("click", sendChatMessage);
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("chatSendBtn").disabled) sendChatMessage(); });
async function sendChatMessage() {
  const instruction = $("chatInput").value.trim();
  if (!instruction) return;
  addChatBubble(instruction, true); $("chatInput").value = "";
  addChatBubble("Soch raha hoon...", false);
  $("chatSendBtn").disabled = true;
  try {
    const prompt = `You are a legal assistant for Pakistani Civil and Family Courts. Your task is to update the given judgement STRICTLY according to the provided instruction.

========================
CORE INSTRUCTION

- Handle both Civil and Family cases.
- Transliterate any Urdu script proper nouns to Roman English.
- Retain exact legal terminology.
- Make ONLY the changes requested in the INSTRUCTION.
- DO NOT change the structure, facts, or findings unless explicitly asked.
- DO NOT hallucinate laws or references.

========================
MODIFICATION RULE

- Modify ONLY the specific part affected by the instruction
- Keep all other parts EXACTLY unchanged

========================
PRESERVATION RULE

- Maintain:
  - Original structure
  - Headings
  - Order of sections
  - Existing findings and facts (unless instruction explicitly changes them)

========================
CONFLICT RULE

If the instruction:

- contradicts existing judgement
- OR requires unsupported changes

→ Apply ONLY if clearly stated
Otherwise:
→ keep original text unchanged

========================
NO REGENERATION RULE

- DO NOT:
  - rewrite full judgement
  - rephrase unaffected sections
  - add new facts or reasoning

========================
INPUT

Instruction:
${instruction}

Existing Judgement:
${$("judgementOutput").value}

========================
OUTPUT RULES

- Output FULL updated judgement
- DO NOT explain changes
- DO NOT highlight edits
- DO NOT add comments

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences`;
    const refined = await callAI(prompt, 3500);
    await logAIStep("refine", instruction, refined);
    $("chatLog").lastChild.remove();
    addChatBubble("✅ Update kar diya.", false);
    $("judgementOutput").value = refined; $("judgementOutput").dispatchEvent(new Event("input"));
  } catch (err) { $("chatLog").lastChild.remove(); addChatBubble("❌ " + err.message, false); }
  finally { $("chatSendBtn").disabled = false; }
}

// ============================================
// COPY & WORD DOWNLOAD
// ============================================
async function copyText(text, btn, doneLabel = "✅ Copied!") {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = doneLabel;
    setTimeout(() => btn.textContent = original, 1500);
  } catch {
    showToast("Copy nahi ho saka. Text manually select karein.", "error");
  }
}
$("copyBtn").addEventListener("click", () => copyText($("judgementOutput").value, $("copyBtn"), "Copied!"));
$("downloadBtn").addEventListener("click", () => {
  const text = $("judgementOutput").value;
  if (!text.trim()) { showToast("Judgement khali hai.", "error"); return; }
  downloadAsWord(text, "judgement.doc", "Judgement");
});
function downloadAsWord(text, fileName, title) {
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset='utf-8'><title>${escapeHtml(title)}</title></head>
  <body style="font-family:'Times New Roman'; font-size:14pt; line-height:1.6;">
    ${text.split("\n").map(p => `<p>${escapeHtml(p)}</p>`).join("")}
  </body></html>`;
  const blob = new Blob(['\ufeff', html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================
// LIVE MODE (presence + periodic sync)
// ============================================
$("liveModeToggle").addEventListener("click", async () => {
  if (liveModeOn) { await stopLiveMode(); return; }
  liveModeOn = true;
  $("liveModeToggle").textContent = "🟢 Live: ON";
  $("liveModeToggle").classList.add("on");
  await startLiveMode();
});

async function startLiveMode() {
  if (!activeCase) return;
  await sb.from("live_sessions").upsert({ case_id: activeCase.id, active_user_id: currentProfile.id, active_user_name: currentProfile.full_name, last_ping: new Date().toISOString() });

  liveChannel = sb.channel(`case-${activeCase.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cases", filter: `id=eq.${activeCase.id}` }, (payload) => {
      if (payload.new.last_updated_by !== currentProfile.id) {
        Object.entries(CASE_FIELD_MAP).forEach(([col, id]) => {
          if (document.activeElement?.id !== id && payload.new[col] !== undefined) $(id).value = payload.new[col] ?? "";
        });
        $("liveIndicator").textContent = "🟢 Other user updated this case just now";
        $("liveIndicator").classList.remove("hidden");
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions", filter: `case_id=eq.${activeCase.id}` }, (payload) => {
      if (payload.new && payload.new.active_user_id !== currentProfile.id) {
        $("liveIndicator").textContent = `🟢 ${payload.new.active_user_name} is also viewing this case`;
        $("liveIndicator").classList.remove("hidden");
      }
    })
    .subscribe();
}

async function stopLiveMode() {
  const wasOn = liveModeOn || liveChannel;
  liveModeOn = false;
  $("liveModeToggle").textContent = "🔴 Live: OFF";
  $("liveModeToggle").classList.remove("on");
  $("liveIndicator").classList.add("hidden");
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (wasOn && activeCase && currentProfile) {
    await sb.from("live_sessions").delete().eq("case_id", activeCase.id).eq("active_user_id", currentProfile.id);
  }
}

// ============================================
// REUSE FLOW
// ============================================
$("backFromReuseListBtn").addEventListener("click", showDashboard);
$("backFromReuseFormBtn").addEventListener("click", () => { hideAllScreens(); $("reuseScreen").classList.remove("hidden"); });

async function loadFinalizedForReuseSelection() {
  const { data: cases } = await sb.from("cases").select("*").eq("status", "finalized").order("updated_at", { ascending: false });
  const container = $("reuseListContainer");
  if (!cases || cases.length === 0) { container.innerHTML = `<p class="empty">Koi finalized judgement nahi mili.</p>`; return; }
  container.innerHTML = cases.map(c => `
    <div class="item clickable reuse-select" data-id="${c.id}" role="button" tabindex="0">
      <p class="item-title">${escapeHtml(c.case_title || c.category + " Case")}</p>
      <p class="item-meta">${escapeHtml(c.category)}${c.legal_grounds ? " · " + escapeHtml(c.legal_grounds) : ""}</p>
    </div>`).join("");
  document.querySelectorAll(".reuse-select").forEach(el => {
    el.addEventListener("click", () => openReuseFlow(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openReuseFlow(el.dataset.id); });
  });
}

let reuseSourceCase = null;
let selectedCaseMode = "contested"; // "contested" or "ex_parte"
let wizardCreatedCaseId = null;
let currentWizStepIndex = 0;
let parsedSections = {}; // Stores original sections from template
let stepContents = {};   // Stores edited paragraph content for each step
let originalStepContents = {}; // Backup of stepContents for revert
let wizardSteps = [];    // Dynamic list of steps depending on mode

function setReuseModeButtons() {
  $("modeContestedBtn").classList.toggle("active", selectedCaseMode === "contested");
  $("modeExParteBtn").classList.toggle("active", selectedCaseMode === "ex_parte");
}

document.querySelectorAll(".reuse-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedCaseMode = btn.dataset.mode;
    setReuseModeButtons();
    updateStepsArray();
    updateWizardUI();
  });
});

// Update the list of steps based on chosen mode
function updateStepsArray() {
  if (selectedCaseMode === "contested") {
    wizardSteps = [
      { type: "variables", title: "Step 1: Variables" },
      { type: "hybrid", sectionKey: "plaint_facts", title: "Step 2: Plaint / Facts", instruction: "Facts aur Plaint paragraphs edit karein." },
      { type: "hybrid", sectionKey: "written_statement", title: "Step 3: Written Statement", instruction: "Defendant's Written Statement paragraphs edit karein." },
      { type: "hybrid", sectionKey: "plaintiff_evidence", title: "Step 4: Plaintiff's Evidence", instruction: "Plaintiff's evidence aur bayanaat edit karein." },
      { type: "hybrid", sectionKey: "defendant_evidence", title: "Step 5: Defendant's Evidence", instruction: "Defendant's evidence aur bayanaat edit karein." },
      { type: "hybrid", sectionKey: "findings_arguments", title: "Step 6: Findings & Arguments", instruction: "Legal arguments aur findings paragraphs edit karein." },
      { type: "final", title: "Step 7: Final Decision" }
    ];
  } else {
    wizardSteps = [
      { type: "variables", title: "Step 1: Variables" },
      { type: "hybrid", sectionKey: "plaint_facts", title: "Step 2: Plaint / Facts", instruction: "Facts aur Plaint paragraphs edit karein." },
      { type: "hybrid", sectionKey: "plaintiff_evidence", title: "Step 3: Plaintiff's Evidence", instruction: "Plaintiff's evidence aur bayanaat edit karein." },
      { type: "hybrid", sectionKey: "findings_arguments", title: "Step 4: Findings & Arguments", instruction: "Legal arguments aur findings paragraphs edit karein." },
      { type: "final", title: "Step 5: Final Decision" }
    ];
  }
}

async function openReuseFlow(judgementId) {
  const { data: source } = await sb.from("cases").select("*").eq("id", judgementId).maybeSingle();
  if (!source) { showToast("Judgement nahi mili.", "error"); return; }
  reuseSourceCase = source;

  hideAllScreens();
  $("reuseFormScreen").classList.remove("hidden");
  
  // Reset wizard states (otherwise the previous template's edits leak into this one)
  selectedCaseMode = source.case_type === "ex_parte" ? "ex_parte" : "contested";
  wizardCreatedCaseId = null;
  stepContents = {};
  originalStepContents = {};
  parsedSections = {};
  $("reuseWizDecisionBox").value = "";
  const modeContested = $("modeContestedBtn");
  const modeExParte = $("modeExParteBtn");
  setReuseModeButtons();

  updateStepsArray();
  currentWizStepIndex = 0;
  updateWizardUI();
  $("reuseWizNextBtn").disabled = true;
  
  $("reuseFieldsContainer").innerHTML = `<p class="empty"><span class="spinner"></span> AI template parh raha hai...</p>`;
  
  // Step 1: Split template into sections using AI
  const splitPrompt = `You are a legal assistant. Split the given judgement into the following sections:
1. "plaint_facts": The facts of the case, pleadings of the plaintiff.
2. "written_statement": The stance/objections of the defendant (written statement). If the case was ex-parte and has no written statement, return empty string.
3. "plaintiff_evidence": Evidence, witnesses, and documents produced by the plaintiff.
4. "defendant_evidence": Evidence and witnesses produced by the defendant. If ex-parte or none, return empty string.
5. "findings_arguments": Legal issues, arguments, findings of the court, and reasoning.

Judgement:
${source.judgement_output}

Return ONLY valid JSON:
{
  "plaint_facts": "...",
  "written_statement": "...",
  "plaintiff_evidence": "...",
  "defendant_evidence": "...",
  "findings_arguments": "..."
}`;

  try {
    const splitResult = await callAI(splitPrompt, 3500);
    const match = splitResult.match(/\{[\s\S]*\}/);
    parsedSections = match ? JSON.parse(match[0]) : {};
  } catch (err) {
    console.error("AI Split failed, using fallback:", err);
    parsedSections = {
      plaint_facts: source.judgement_output,
      written_statement: "",
      plaintiff_evidence: "",
      defendant_evidence: "",
      findings_arguments: ""
    };
  }

  // Step 2: Extract variables for Step 1 Form
  const fieldsPrompt = `Identify ONLY case-specific variable fields (names, dates, amounts, case numbers, places) from the given judgement.
For each field, "old_value" MUST be the exact text as it appears in the judgement, so it can be find-and-replaced.
Return ONLY a valid JSON array:
[{"label": "Plaintiff Name", "old_value": "Ali Ahmed"}]

Judgement:
${source.judgement_output}`;

  try {
    const fieldsResult = await callAI(fieldsPrompt, 1500);
    const fieldsMatch = fieldsResult.match(/\[[\s\S]*\]/);
    const fields = fieldsMatch ? JSON.parse(fieldsMatch[0]) : [];
    renderReuseFields(Array.isArray(fields) ? fields : []);
  } catch (err) {
    renderReuseFields([]);
  }

  $("reuseWizNextBtn").disabled = false;
  updateWizardUI();
}

function renderReuseFields(fields) {
  const container = $("reuseFieldsContainer");
  container.innerHTML = "";
  fields.forEach(f => addReuseFieldRow(f.label, f.old_value ?? f.placeholder));
  if (fields.length === 0) addReuseFieldRow("", "");
}

// `oldValue` is the text in the template that gets replaced by the new value
function addReuseFieldRow(label = "", oldValue = "") {
  const row = document.createElement("div");
  row.className = "reuse-field-row user-row grid gap-2";
  row.innerHTML = `
    <input type="text" class="reuse-label font-semibold" value="${escapeHtml(label)}" placeholder="Field ka naam (e.g. Plaintiff Name)" />
    <div class="grid gap-2 sm:grid-cols-2">
      <input type="text" class="reuse-old" value="${escapeHtml(oldValue)}" placeholder="Purana text (e.g. Ali Ahmed)" />
      <input type="text" class="reuse-value" placeholder="Naya text" />
    </div>`;
  row.querySelectorAll("input").forEach(el => el.dir = "auto");
  $("reuseFieldsContainer").appendChild(row);
}

$("addReuseFieldBtn").addEventListener("click", () => addReuseFieldRow());

// UI Updates for step transitions
function updateWizardUI() {
  const step = wizardSteps[currentWizStepIndex];
  if (!step) return;

  // Header progress
  $("reuseWizTitle").textContent = step.title;
  $("reuseWizStepIndicator").textContent = `Step ${currentWizStepIndex + 1} of ${wizardSteps.length}`;

  // Hide all step views
  $("reuseWizStep1").classList.add("hidden");
  $("reuseWizStepHybrid").classList.add("hidden");
  $("reuseWizStepFinal").classList.add("hidden");
  $("reuseWizRevertBtn").classList.add("hidden");

  // Show navigation buttons
  $("reuseWizBackBtn").textContent = currentWizStepIndex === 0 ? "Dashboard" : "← Back";
  $("reuseWizNextText").textContent = currentWizStepIndex === wizardSteps.length - 1 ? "Generate Judgement" : "Next →";

  if (step.type === "variables") {
    $("reuseWizStep1").classList.remove("hidden");
  } else if (step.type === "hybrid") {
    $("reuseWizStepHybrid").classList.remove("hidden");
    $("reuseWizRevertBtn").classList.remove("hidden");
    $("hybridStepInstructions").textContent = step.instruction;
    
    // Load pre-filled text if not already loaded/modified
    if (stepContents[step.sectionKey] === undefined) {
      // Replace variables in the section template text
      let sectionText = parsedSections[step.sectionKey] || "";
      getFilledVariables().forEach(v => {
        // Replace every occurrence of the template's old value with the new one
        sectionText = sectionText.replace(new RegExp(escapeRegExp(v.oldValue), "gi"), () => v.value);
      });
      stepContents[step.sectionKey] = sectionText;
      originalStepContents[step.sectionKey] = sectionText;
    }
    
    $("reuseWizBigBox").value = stepContents[step.sectionKey];
    $("reuseWizSmallBox").value = "";
  } else if (step.type === "final") {
    $("reuseWizStepFinal").classList.remove("hidden");
  }
}

function getFilledVariables() {
  const rows = document.querySelectorAll(".reuse-field-row");
  return Array.from(rows).map(r => ({
    oldValue: r.querySelector(".reuse-old").value.trim(),
    value: r.querySelector(".reuse-value").value.trim()
  })).filter(f => f.oldValue && f.value);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Navigation Listeners with automatic Database Sync
$("reuseWizBackBtn").addEventListener("click", async () => {
  if (currentWizStepIndex === 0) {
    showDashboard();
  } else {
    // Save current step data to DB first
    await saveCurrentStepDataToDb();
    currentWizStepIndex--;
    updateWizardUI();
  }
});

async function saveCurrentStepDataToDb() {
  if (!wizardCreatedCaseId) return;
  const step = wizardSteps[currentWizStepIndex];
  if (!step) return;

  const payload = {};
  if (step.type === "hybrid") {
    const text = $("reuseWizBigBox").value;
    stepContents[step.sectionKey] = text;
    if (step.sectionKey === "plaint_facts") payload.facts_text = text;
    if (step.sectionKey === "written_statement") payload.written_statement_text = text;
    if (step.sectionKey === "plaintiff_evidence" || step.sectionKey === "defendant_evidence") {
      // Both sides' evidence live in the single evidence_text column
      payload.evidence_text = [
        stepContents.plaintiff_evidence && `PLAINTIFF EVIDENCE:\n${stepContents.plaintiff_evidence}`,
        stepContents.defendant_evidence && `DEFENDANT EVIDENCE:\n${stepContents.defendant_evidence}`
      ].filter(Boolean).join("\n\n");
    }
    if (step.sectionKey === "findings_arguments") payload.findings_text = text;
  } else if (step.type === "final") {
    const text = $("reuseWizDecisionBox").value;
    payload.short_order = text;
  }
  
  payload.last_updated_by = currentProfile?.id;
  const { error } = await sb.from("cases").update(payload).eq("id", wizardCreatedCaseId);
  if (error) showToast("Draft save nahi hua: " + error.message, "error");
}

$("reuseWizRevertBtn").addEventListener("click", () => {
  const step = wizardSteps[currentWizStepIndex];
  if (step && step.type === "hybrid") {
    stepContents[step.sectionKey] = originalStepContents[step.sectionKey];
    $("reuseWizBigBox").value = stepContents[step.sectionKey];
    showToast("Text original state me revert ho gaya.", "success");
  }
});

$("reuseWizNextBtn").addEventListener("click", async () => {
  if (currentWizStepIndex === 0) {
    // Create the case row in the database on Step 1 Next
    if (!wizardCreatedCaseId) {
      setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", true);
      try {
        const { data, error } = await sb.from("cases").insert({
          category: reuseSourceCase.category,
          case_type: selectedCaseMode,
          status: "pending",
          reused_from_judgement_id: reuseSourceCase.id,
          created_by: currentProfile.id,
          last_updated_by: currentProfile.id,
          current_step: 1
        }).select().single();
        if (error) throw error;
        wizardCreatedCaseId = data.id;
      } catch (err) {
        showToast("Error creating case: " + err.message, "error");
        return;
      } finally {
        setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", false);
      }
    }
  } else {
    // Save intermediate step data
    await saveCurrentStepDataToDb();
  }

  if (currentWizStepIndex === wizardSteps.length - 1) {
    // Generate Final Judgement
    await generateFinalJudgement();
  } else {
    currentWizStepIndex++;
    updateWizardUI();
  }
});

// Interactive AI Rewrite functionality
$("reuseWizAskAIBtn").addEventListener("click", async () => {
  const step = wizardSteps[currentWizStepIndex];
  if (!step || step.type !== "hybrid") return;

  const currentText = $("reuseWizBigBox").value.trim();
  const instruction = $("reuseWizSmallBox").value.trim();
  if (!instruction) { showToast("AI instruction enter karein.", "error"); return; }

  setBtnLoading("reuseWizAskAIBtn", "spin-reuseWizAskAI", true, "reuseWizBigBox");
  
  const rewritePrompt = `You are a legal editor. Modify the given court judgement paragraph/section strictly according to the instruction.
Keep the same professional legal tone and structure. Merge changes naturally.
Output ONLY the modified text. Do not write explanation, notes, markdown or quotes.

Input Text:
${currentText}

Instruction:
${instruction}`;

  try {
    const result = await callAI(rewritePrompt, 2000);
    if (result.trim()) {
      $("reuseWizBigBox").value = result.trim();
      stepContents[step.sectionKey] = result.trim();
      showToast("Paragraph updated by AI!", "success");
      // Immediate save to DB on AI rewrite success
      await saveCurrentStepDataToDb();
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    setBtnLoading("reuseWizAskAIBtn", "spin-reuseWizAskAI", false, "reuseWizBigBox");
  }
});

async function generateFinalJudgement() {
  const decision = $("reuseWizDecisionBox").value.trim();
  if (!decision) { showToast("Judge sahab ka final decision likhein.", "error"); return; }

  setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", true, "reuseWizDecisionBox");

  const SECTION_HEADINGS = {
    plaint_facts: "PLAINT/FACTS",
    written_statement: "WRITTEN STATEMENT",
    plaintiff_evidence: "PLAINTIFF EVIDENCE",
    defendant_evidence: "DEFENDANT EVIDENCE",
    findings_arguments: "FINDINGS & ARGUMENTS"
  };
  // Only the sections that exist in the current mode's steps
  const buildText = () => wizardSteps
    .filter(st => st.type === "hybrid")
    .map(st => `${SECTION_HEADINGS[st.sectionKey]}:\n${stepContents[st.sectionKey] || ""}`)
    .join("\n\n");

  const finalPrompt = `You are a senior judge. Combine the provided section drafts and the final decision into a clean, complete, unified formal Court Judgement.
- Use a formal, authoritative legal tone.
- Merge the sections smoothly into a single comprehensive document.
- Follow the final decision/outcome of the judge strictly.
- Output ONLY the final judgement. No explanations, no markdown styling.

Section Drafts:
${buildText()}

Final Decision / Outcomes:
${decision}`;

  try {
    const result = await callAI(finalPrompt, 3500);
    
    // Update the existing Case row with finalized status and output
    const { data, error } = await sb.from("cases").update({
      judgement_output: result,
      short_order: decision,
      status: "pending",
      current_step: 5,
      last_updated_by: currentProfile?.id
    }).eq("id", wizardCreatedCaseId).select().single();
    
    if (error) throw error;

    showToast("Naya case Pending mein save ho gaya aur generated text tayyar hai!", "success");
    
    // Clean up wizard states and redirect
    stepContents = {};
    originalStepContents = {};
    parsedSections = {};
    wizardCreatedCaseId = null;
    openWizardForCase(data.id);
  } catch (err) {
    showToast("Generation failed: " + err.message, "error");
  } finally {
    setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", false, "reuseWizDecisionBox");
  }
}

// ============================================
// TEMPLATE FEATURE (Add / Upload / Paste)
// ============================================
function openTemplateModal() {
  $("templateTitle").value = "";
  $("templateJudgementText").value = "";
  $("templateModal").classList.remove("hidden");
}

$("closeTemplateBtn").addEventListener("click", () => $("templateModal").classList.add("hidden"));
$("addTemplateFromNewCase").addEventListener("click", openTemplateModal);

$("templateUploadArea").addEventListener("click", () => $("templateFileInput").click());

$("templateFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    if (text.trim().length > 10) {
      $("templateJudgementText").value = text.trim();
      showToast("File load ho gayi!", "success");
    } else {
      showToast("File mein kafi kam text hai.", "error");
    }
  } catch (err) {
    showToast("File read nahi ho saki: " + err.message, "error");
  }
  $("templateFileInput").value = "";
});

// Drag & drop support
$("templateUploadArea").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("templateFileInput").click(); } });
$("templateUploadArea").addEventListener("dragover", (e) => { e.preventDefault(); e.currentTarget.classList.add("dragover"); });
$("templateUploadArea").addEventListener("dragleave", (e) => { e.currentTarget.classList.remove("dragover"); });
$("templateUploadArea").addEventListener("drop", async (e) => {
  e.preventDefault();
  e.currentTarget.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    if (text.trim().length > 10) {
      $("templateJudgementText").value = text.trim();
      showToast("File load ho gayi!", "success");
    }
  } catch (err) { showToast("File read error.", "error"); }
});

$("saveTemplateBtn").addEventListener("click", async () => {
  const title = $("templateTitle").value.trim();
  const text = $("templateJudgementText").value.trim();
  if (!title) { showToast("Title zaroori hai.", "error"); return; }
  if (!text) { showToast("Judgement text zaroori hai. Paste ya upload karein.", "error"); return; }

  $("saveTemplateBtn").disabled = true;
  $("spin-saveTemplate").classList.remove("hidden");

  try {
    // Try to extract legal grounds via AI
    let legalGrounds = "General";
    try {
      const s = getSettings();
      if (s.apiKeys && s.apiKeys.length > 0) {
        const lgPrompt = `Extract legal grounds (laws, sections, ordinances) from this judgement. Return ONLY a short comma-separated list of relevant laws/sections. If none found, return "General".\n\nJudgement (first 2000 chars):\n${text.substring(0, 2000)}\n\nOutput only the grounds, nothing else.`;
        legalGrounds = await callAI(lgPrompt, 200);
      }
    } catch (e) { legalGrounds = "General"; }

    const { data, error } = await sb.from("cases").insert({
      category: $("templateCategory").value,
      case_type: $("templateCaseType").value,
      case_title: title,
      legal_grounds: legalGrounds.trim().substring(0, 500),
      status: "finalized",
      judgement_output: text,
      created_by: currentProfile.id,
      last_updated_by: currentProfile.id,
      current_step: 5
    }).select().single();

    if (error) throw error;

    showToast("✅ Template save ho gaya! Ab ise Reuse se use kar sakte hain.", "success");
    $("templateModal").classList.add("hidden");
    $("templateTitle").value = "";
    $("templateJudgementText").value = "";
    await loadDashboardCounts();
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    $("saveTemplateBtn").disabled = false;
    $("spin-saveTemplate").classList.add("hidden");
  }
});

// ============================================
// ORDER WRITER
// ============================================
const DEFAULT_DIRECTIVES = [
  { label: "Last & Final Chance", text: "It is made clear that this is the last and final opportunity granted to the party to {proceeding}." },
  { label: "Last & Final Chance (Multiple Opportunities)", text: "It is made clear that the party has already availed multiple opportunities but failed to {proceeding}, which shows that the party has no interest in pursuing their case. However, in the interest of justice, one last and final opportunity is granted." },
  { label: "Last & Final Chance (Multiple Opportunities + Right Closed)", text: "It is made clear that this is the last and final opportunity granted to the party. The party has already availed multiple opportunities but failed to {proceeding}. In case of failure on the next date, the right to {proceeding} shall stand closed under {legal_reference} and no excuse in this regard shall be entertained." }
];

function getDirectives() {
  const stored = localStorage.getItem("ow_directives_v7");
  if (!stored) {
    localStorage.setItem("ow_directives_v7", JSON.stringify(DEFAULT_DIRECTIVES));
    return DEFAULT_DIRECTIVES;
  }
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("Not an array");
  } catch {
    localStorage.setItem("ow_directives_v7", JSON.stringify(DEFAULT_DIRECTIVES));
    return DEFAULT_DIRECTIVES;
  }
}

function loadDirectiveDropdown() {
  const directives = getDirectives();
  const select = $("owDirective");
  select.innerHTML = `<option value="">(None)</option>` + 
    directives.map((d, idx) => `<option value="${idx}">${escapeHtml(d.label)}</option>`).join("");
}

$("orderWriterBtn").addEventListener("click", () => {
  const today = new Date().toISOString().split("T")[0];
  $("owNextDate").min = today;
  $("owNextDate").value = "";
  $("owCaseTitle").value = "";
  $("owFixedFor").value = "";
  $("owProceeding").value = "";
  $("owNextPurpose").value = "";
  $("owOutput").value = "";
  $("owOutputSection").classList.add("hidden");
  loadDirectiveDropdown();

  // Toggle steno load button next to back button vs send buttons in action grid
  const isSteno = currentProfile?.role === 'steno';
  $("owLoadOrderBtnTop").classList.toggle("hidden", !isSteno);
  $("owSendStenoBtn").classList.toggle("hidden", isSteno);
  $("owSendSteno2Btn").classList.toggle("hidden", isSteno);

  hideAllScreens();
  $("orderWriterScreen").classList.remove("hidden");
});

$("backFromOrderWriterBtn").addEventListener("click", () => {
  showDashboard();
});

$("generateOrderBtn").addEventListener("click", async () => {
  const caseTitle  = $("owCaseTitle").value.trim();
  const fixedFor    = $("owFixedFor").value.trim();
  const proceeding  = $("owProceeding").value.trim();
  let nextFor       = $("owNextPurpose").value.trim();
  const nextDateRaw = $("owNextDate").value;

  if (!fixedFor)    { showToast("'Today case fixed for' field bharen.", "error"); return; }
  if (!proceeding)  { showToast("'Today proceeding' field bharen.", "error"); return; }
  if (!nextDateRaw) { showToast("Next date select karen.", "error"); return; }

  const nextDateFormatted = nextDateRaw.split("-").reverse().join("-");
  const todayFormatted = new Date().toLocaleDateString("en-GB").replaceAll("/", "-");

  // If nextFor is empty, assume today's fixedFor (but tell AI not to write "same purpose")
  const isSamePurpose = !nextFor;
  if (isSamePurpose) {
    nextFor = fixedFor;
  }

  // Get selected directive if any
  const directives = getDirectives();
  const selectedIdx = $("owDirective").value;
  const selectedDirective = selectedIdx !== "" ? directives[Number(selectedIdx)] || null : null;

  const prompt = `You are a Pakistani court official drafting a formal court order. Convert the following case details into a proper, concise legal court order in English.

TODAY'S DATE: ${todayFormatted}

INPUT FIELDS RELATIONSHIP & WORKFLOW:
1. "Today case fixed for" (Core Reference): This is the main scheduled purpose of the case for today. Read and understand this core field carefully as it is the primary reference.
2. "Today's proceeding" (Actual Court Events): This describes what actually happened in court today. Read this carefully to identify:
   - What actions were taken by each party (plaintiff/defendant).
   - Who completed their turn (e.g. plaintiff argued or produced evidence).
   - Who requested more time / sought an adjournment (e.g. defendant asked for an adjournment).
3. "Next purpose" / "Warning Preset" (Future Action): This is the purpose for the next date, specified either directly in the next date purpose field or via a selected warning preset.
Synthesize these fields carefully, translate any Urdu or Roman Urdu terms, and convert them into proper formal legal English.

CASE DETAILS:
${caseTitle ? `- Case Title/Number: ${caseTitle}` : ""}
- Today this case was fixed for: ${fixedFor}
- Today's proceeding: ${proceeding}
- Next date: ${nextDateFormatted}
- Next purpose: ${nextFor}

STRICT RULES:
1. ALL input fields may be in Urdu, Roman Urdu, or English — you MUST translate and convert everything into formal legal English.
2. Do NOT copy-paste any Urdu or Roman Urdu text into the output — translate it fully.
3. Write in formal Pakistani court order style.
4. Adjournment request phrasing:
   - If NO warning directive is selected: use "sought an adjournment, which is granted/allowed." (If a reason is mentioned in Today's proceeding, include it simply, e.g., "sought an adjournment due to [reason], which is granted.").
   - If a warning directive IS selected: connect the selected warning directive text smoothly into the adjournment sentence (e.g. "...sought an adjournment, which is allowed/granted, but [warning directive text]..."). Do NOT write it as separate disjointed sentences.
5. If Case Title/Number is provided above, you MUST write it at the very top of the output in this format: "Case: [Case Title]" followed by a line break, then "Dated: [Date]" on the next line. If not provided, start directly with "Dated: [Date]".
6. End with the adjournment line: "Case is adjourned to [date] for [purpose]." (Make sure the [purpose] is specific, e.g. "Case is adjourned to 31-07-2026 for final arguments by the defendant" if the plaintiff has already argued today).
7. Keep it concise — 3 to 7 lines only.
8. Do NOT add case number, judge name, or party names unless provided in the Case Title field.
9. Plain text only — no markdown, no asterisks, no headings.
10. CRITICAL DATE FORMAT RULE: You MUST write all dates (including today's date and the next date) strictly in the numeric format "DD-MM-YYYY" (e.g., "26-07-2026"). Do NOT write months in words or use ordinal suffixes (e.g., do NOT use "26th July, 2026" or "26 July 2026").

${isSamePurpose ? "11. CRITICAL: The next purpose is the same as today's purpose. Do NOT use the words 'same purpose' in the final output. Instead, write the actual purpose (e.g., 'evidence of the plaintiff', 'arguments', etc.)." : ""}
12. CRITICAL TURN-TAKING RULE (Next Purpose specificity):
    - Carefully analyze today's proceeding text. If one party (e.g., plaintiff) has addressed arguments or produced evidence today, and the case is adjourned because the other party (e.g., defendant) sought an adjournment, the next purpose in the adjournment line (Rule 6) MUST reflect this turn-taking.
    - E.g., if plaintiff addressed arguments and defendant sought an adjournment, the next purpose in the adjournment line MUST be specific (e.g., "final arguments by/of the defendant" or "arguments of the defendant"), instead of just writing the generic case purpose "final arguments".
    - Apply this same specific logic if the defendant completed their turn and the plaintiff is to perform theirs on the next date.
${selectedDirective ? `13. MANDATORY CLAUSE: You MUST adapt and integrate this warning instruction: "${selectedDirective.text}"
    - Replace the placeholder "the party" with "the plaintiff" or "the defendant" (whoever is seeking the adjournment or whose turn it is).
    - Replace the placeholder "{proceeding}" or any generic phrase like "complete the proceeding" or "do so" with the specific purpose (e.g., "produce evidence", "submit written statement", "address arguments") based on what today's case was fixed for ("Today this case was fixed for: ${fixedFor}").
    - ONLY if the placeholder "{legal_reference}" is present in the warning instruction, replace it with the exact legal provision:
      - If closing the turn to produce evidence: specify "Order XVII Rule 3 CPC".
      - If closing the turn to submit a written statement (Civil case): specify "Order VIII Rule 10 CPC".
      - If closing the turn to submit a written statement (Family case): specify "Section 9 of the Family Courts Act, 1964".
      - If other/generic: refer to the relevant legal provisions.
    - CRITICAL: If a placeholder (like "{legal_reference}") is NOT present in the selected warning instruction, do NOT invent or add it. Stick strictly to the selected warning instruction's text and structure.
    - INTEGRATION FLOW: Blend the warning directly into the adjournment sentence (e.g. "...sought an adjournment, which is granted, but [warning text]...") to make the legal transition smooth and standard.` : ""}`;

  $("generateOrderBtn").disabled = true;
  $("spin-order").classList.remove("hidden");
  try {
    const result = await callAI(prompt, 600);
    $("owOutput").value = result.trim();
    $("owOutputSection").classList.remove("hidden");
    $("owOutput").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showToast("Order generate nahi ho saka: " + err.message, "error");
  } finally {
    $("generateOrderBtn").disabled = false;
    $("spin-order").classList.add("hidden");
  }
});

$("owCopyBtn").addEventListener("click", () => copyText($("owOutput").value, $("owCopyBtn")));

async function sendOrderToSteno(btn, keyPrefix, label) {
  const text = $("owOutput").value.trim();
  if (!text) { showToast("Pehle order generate karein.", "error"); return; }
  btn.disabled = true;
  try {
    const now = new Date().toISOString();
    const { error } = await sb.from("live_notes").insert({
      id: `${keyPrefix}-${Date.now()}`,
      content: JSON.stringify({
        case_title: $("owCaseTitle").value.trim() || "Untitled Case",
        order_text: text,
        sent_at: now
      }),
      updated_by: currentProfile?.id,
      updated_at: now
    });
    if (error) throw error;
    showToast(`Order ${label} ko send ho gaya!`, "success");
  } catch (e) {
    showToast("Send error: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

$("owSendStenoBtn").addEventListener("click", () => sendOrderToSteno($("owSendStenoBtn"), "order-steno", "Steno 1"));
$("owSendSteno2Btn").addEventListener("click", () => sendOrderToSteno($("owSendSteno2Btn"), "order-steno2", "Steno 2"));

let activeInboxKey = "";

async function openInbox(stenoKey) {
  activeInboxKey = stenoKey;
  $("owInboxTitle").textContent = stenoKey === "order-steno" ? "📥 Steno 1 Received Orders" : "📥 Steno 2 Received Orders";
  $("owInboxModal").classList.remove("hidden");
  await refreshInboxList();
}

async function refreshInboxList() {
  const listContainer = $("owInboxList");
  listContainer.innerHTML = `<p class="empty">Loading...</p>`;
  
  try {
    const { data, error } = await sb.from("live_notes")
      .select("*")
      .like("id", `${activeInboxKey}-%`);
      
    if (error) throw error;
    
    if (!data || data.length === 0) {
      listContainer.innerHTML = `<p class="empty">Koi order nahi aaya.</p>`;
      return;
    }
    
    const orders = data.map(item => {
      try {
        const parsed = JSON.parse(item.content);
        return { id: item.id, ...parsed };
      } catch {
        return { id: item.id, case_title: "Error Parsing", order_text: item.content, sent_at: item.updated_at };
      }
    });
    
    orders.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
    
    listContainer.innerHTML = orders.map(order => {
      const timeStr = new Date(order.sent_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const dateStr = new Date(order.sent_at).toLocaleDateString("en-GB");
      
      return `
        <div class="inbox-item">
          <div class="case-row">
            <div class="flex-1 min-w-0">
              <p class="item-title">${escapeHtml(order.case_title)}</p>
              <p class="item-meta">${dateStr} · ${timeStr}</p>
            </div>
            <button class="inbox-del-btn btn btn-ghost btn-icon" data-id="${escapeHtml(order.id)}" aria-label="Delete">✕</button>
          </div>
          <pre>${escapeHtml(order.order_text)}</pre>
          <div class="btn-row">
            <button class="inbox-copy-btn btn btn-soft btn-sm" data-id="${escapeHtml(order.id)}">📋 Copy</button>
            <button class="inbox-load-btn btn btn-dark btn-sm" data-id="${escapeHtml(order.id)}">📥 Editor mein load karein</button>
          </div>
        </div>`;
    }).join("");
    
    listContainer.querySelectorAll(".inbox-del-btn").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("Is shared order ko inbox se clear kar dein?")) return;
        await sb.from("live_notes").delete().eq("id", btn.dataset.id);
        await refreshInboxList();
        showToast("Shared order cleared.", "success");
      };
    });
    
    const orderText = (id) => orders.find(o => o.id === id)?.order_text || "";

    listContainer.querySelectorAll(".inbox-copy-btn").forEach(btn => {
      btn.onclick = () => copyText(orderText(btn.dataset.id), btn);
    });
    
    listContainer.querySelectorAll(".inbox-load-btn").forEach(btn => {
      btn.onclick = () => {
        $("owOutput").value = orderText(btn.dataset.id);
        $("owOutputSection").classList.remove("hidden");
        $("owInboxModal").classList.add("hidden");
        showToast("Order loaded into editor!", "success");
      };
    });
    
  } catch (e) {
    listContainer.innerHTML = `<p class="empty text-red-600">Inbox load nahi hua: ${escapeHtml(e.message)}</p>`;
  }
}

$("closeOwInboxBtn").onclick = () => $("owInboxModal").classList.add("hidden");
$("owInboxCloseBtn").onclick = () => $("owInboxModal").classList.add("hidden");
$("owInboxModal").addEventListener("click", (e) => {
  if (e.target === $("owInboxModal")) $("owInboxModal").classList.add("hidden");
});

$("owInboxClearAllBtn").onclick = async () => {
  if (!confirm("Kya aap sach me is inbox ke saare orders delete karna chahte hain?")) return;
  try {
    const { error } = await sb.from("live_notes").delete().like("id", `${activeInboxKey}-%`);
    if (error) throw error;
    await refreshInboxList();
    showToast("Inbox cleared completely!", "success");
  } catch (e) {
    showToast("Clear error: " + e.message, "error");
  }
};

$("owLoadOrderBtnTop").onclick = () => {
  const stenoKey = currentProfile?.is_admin ? "order-steno" : "order-steno2";
  openInbox(stenoKey);
};

$("owClearBtn").addEventListener("click", () => {
  $("owCaseTitle").value = "";
  $("owFixedFor").value = "";
  $("owProceeding").value = "";
  $("owNextPurpose").value = "";
  $("owNextDate").value = "";
  $("owOutput").value = "";
  $("owDirective").value = "";
  $("owOutputSection").classList.add("hidden");
  $("owCaseTitle").focus();
});
