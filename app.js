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
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', dateOptions);
const $ = (id) => {
  if (id === "hamburgerMenu") {
    return {
      classList: {
        add: (cls) => { if (cls === "hidden") closeSidebar(); },
        remove: (cls) => { if (cls === "hidden") openSidebar(); },
        toggle: (cls) => {
          if (cls === "hidden") {
            if ($("sidebarMenu").classList.contains("active")) closeSidebar();
            else openSidebar();
          }
        }
      }
    };
  }
  return document.getElementById(id);
};
let currentUser = null;   // { id, email }
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
  currentUser = user;
  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error || !profile) {
    showLoginError("Profile nahi mila. Pehle profiles table mein apna UUID add karein.");
    await sb.auth.signOut();
    return;
  }
  currentProfile = profile;

  showAdminBtnIfAdmin();
  showJudgeBtnIfJudge();

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

  $("loginScreen").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  const roleLabels = { judge: "Judge", steno: "Steno", user: "User" };
  $("menuUserName").textContent = profile.full_name;
  $("menuUserRole").textContent = roleLabels[profile.role] || profile.role;
  await loadGlossary();
  await loadDashboardCounts();
  showDashboard();
}

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
  await sb.auth.signOut();
  currentUser = null;
  currentProfile = null;
  $("mainApp").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
});

window.addEventListener("DOMContentLoaded", checkExistingSession);

// ============================================
// ADMIN PANEL
// ============================================
function showAdminBtnIfAdmin() {
  if (currentProfile && currentProfile.is_admin) {
    $("adminPanelBtn").classList.remove("hidden");
  }
}

function showJudgeBtnIfJudge() {
  // Judge approval is removed. Judge does not need the Judge Panel.
}

$("adminPanelBtn").addEventListener("click", async () => {
  $("hamburgerMenu").classList.add("hidden");
  const { data: pending } = await sb.from("profiles").select("*").eq("status", "pending").order("created_at", { ascending: false });
  const list = $("pendingUsersList");
  if (!pending || pending.length === 0) {
    list.innerHTML = `<p class="text-slate-400 text-sm text-center py-4">Koi pending user nahi hai.</p>`;
  } else {
    list.innerHTML = pending.map(u => `
      <div class="bg-slate-50 rounded-xl p-3">
        <p class="font-semibold text-sm">${escapeHtml(u.full_name)}</p>
        <p class="text-xs text-slate-500">${escapeHtml(u.email || '')} · ${u.role === 'judge' ? '👨‍⚖️ Judge' : u.role === 'steno' ? '📝 Steno' : '👤 User'} · ${escapeHtml(u.court_name || '')}</p>
        <div class="flex gap-2 mt-2">
          <button class="approve-user-btn bg-green-600 text-white text-xs px-4 py-1.5 rounded-lg font-semibold" data-id="${u.id}" data-role="${u.role}">✅ Approve</button>
          <button class="reject-user-btn bg-red-500 text-white text-xs px-4 py-1.5 rounded-lg font-semibold" data-id="${u.id}">❌ Reject</button>
        </div>
      </div>
    `).join("");
  }
  $("adminPanelModal").classList.remove("hidden");
});

document.addEventListener("click", async (e) => {
  const approveBtn = e.target.closest(".approve-user-btn");
  if (approveBtn) {
    const id = approveBtn.dataset.id;
    const role = approveBtn.dataset.role;
    const newStatus = 'active';
    await sb.from("profiles").update({ status: newStatus, approved_by_admin: true, approved_by_judge: true }).eq("id", id);
    approveBtn.closest(".bg-slate-50")?.remove();
  }
  const rejectBtn = e.target.closest(".reject-user-btn");
  if (rejectBtn) {
    const id = rejectBtn.dataset.id;
    await sb.from("profiles").update({ status: 'rejected' }).eq("id", id);
    rejectBtn.closest(".bg-slate-50")?.remove();
  }
});

$("closeAdminPanelBtn").addEventListener("click", () => $("adminPanelModal").classList.add("hidden"));

// ============================================
// JUDGE PANEL
// ============================================
$("judgePanelBtn").addEventListener("click", async () => {
  $("hamburgerMenu").classList.add("hidden");
  const { data: pending } = await sb.from("profiles").select("*").eq("status", "admin_approved").order("created_at", { ascending: false });
  const list = $("pendingJudgeApprovalList");
  if (!pending || pending.length === 0) {
    list.innerHTML = `<p class="text-slate-400 text-sm text-center py-4">Koi user judge approval ka wait nahi kar raha.</p>`;
  } else {
    list.innerHTML = pending.map(u => `
      <div class="bg-slate-50 rounded-xl p-3">
        <p class="font-semibold text-sm">${escapeHtml(u.full_name)}</p>
        <p class="text-xs text-slate-500">${escapeHtml(u.email || '')} · ${u.role === 'steno' ? '📝 Steno' : '👤 User'} · ${escapeHtml(u.court_name || '')}</p>
        <div class="flex gap-2 mt-2">
          <button class="judge-approve-btn bg-green-600 text-white text-xs px-4 py-1.5 rounded-lg font-semibold" data-id="${u.id}">✅ Approve</button>
          <button class="judge-reject-btn bg-red-500 text-white text-xs px-4 py-1.5 rounded-lg font-semibold" data-id="${u.id}">❌ Reject</button>
        </div>
      </div>
    `).join("");
  }
  $("judgePanelModal").classList.remove("hidden");
});

document.addEventListener("click", async (e) => {
  const approveBtn = e.target.closest(".judge-approve-btn");
  if (approveBtn) {
    await sb.from("profiles").update({ status: 'active', approved_by_judge: true, judge_id: currentProfile?.id }).eq("id", approveBtn.dataset.id);
    approveBtn.closest(".bg-slate-50")?.remove();
  }
  const rejectBtn = e.target.closest(".judge-reject-btn");
  if (rejectBtn) {
    await sb.from("profiles").update({ status: 'rejected' }).eq("id", rejectBtn.dataset.id);
    rejectBtn.closest(".bg-slate-50")?.remove();
  }
});

$("closeJudgePanelBtn").addEventListener("click", () => $("judgePanelModal").classList.add("hidden"));

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
  document.querySelectorAll(".reg-role-btn").forEach(b => b.classList.remove("bg-green-700", "text-white"));
  $("regExtraFields").classList.add("hidden");
});

document.querySelectorAll(".reg-role-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    regSelectedRole = btn.dataset.role;
    document.querySelectorAll(".reg-role-btn").forEach(b => b.classList.remove("bg-green-700", "text-white"));
    btn.classList.add("bg-green-700", "text-white");

    $("regExtraFields").classList.remove("hidden");
    $("regStenoEmailRow").classList.toggle("hidden", btn.dataset.role === "steno");
    const label = $("regExtraFields").querySelector("label");
    if (btn.dataset.role === "steno") {
      label.textContent = "Court Name";
      $("regCourtName").placeholder = "e.g. District Court Lahore";
    } else {
      label.textContent = "Court Name (apne steno se poochein)";
      $("regCourtName").placeholder = "e.g. District Court Lahore";
    }
  });
});

$("registerBtn").addEventListener("click", async () => {
  const name = $("regName").value.trim();
  const email = $("regEmail").value.trim();
  const password = $("regPassword").value;
  const courtName = $("regCourtName").value.trim();
  const stenoEmail = $("regStenoEmail").value.trim();
  if (!name || !email || !password) { showLoginError("Name, email aur password bharain."); return; }
  if (!regSelectedRole) { showLoginError("Role select karein."); return; }
  if (regSelectedRole !== 'steno' && !courtName) { showLoginError("Court name bharain (apne steno se poochein)."); return; }
  if (regSelectedRole !== 'steno' && !stenoEmail) { showLoginError("Steno ka email address bharain."); return; }
  if (regSelectedRole === 'steno' && !courtName) { showLoginError("Court name bharain."); return; }

  $("registerBtn").disabled = true;
  $("spin-register").classList.remove("hidden");
  try {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.user) throw new Error("Signup fail - user nahi mila");

    const { data: existingAdmins } = await sb.from("profiles").select("id").eq("is_admin", true).limit(1);
    const isFirstAdmin = regSelectedRole === 'steno' && (!existingAdmins || existingAdmins.length === 0);

    const status = isFirstAdmin ? 'active' : 'pending';

    const profileData = {
      id: data.user.id, full_name: name, role: regSelectedRole,
      email: email, court_name: courtName,
      status: status, is_admin: isFirstAdmin || false,
      steno_email: stenoEmail || null,
      judge_id: null,
      approved_by_admin: isFirstAdmin || false, approved_by_judge: true
    };

    const { error: profileError } = await sb.from("profiles").insert(profileData);
    if (profileError) throw profileError;

    let msg = "✅ Register ho gaya! Admin approval ka wait karein.";
    if (isFirstAdmin) msg = "✅ Admin register ho gaya! Ab login karein.";
    else msg = "✅ Register ho gaya! Steno admin approval ka wait karein.";
    $("regSuccess").textContent = msg;
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
  if ($("liveTypeOverlay")) $("liveTypeOverlay").classList.add("hidden");
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
  document.querySelectorAll(".case-type-btn").forEach(b => b.classList.remove("bg-blue-700", "text-white"));
});

$("backFromNewCaseBtn").addEventListener("click", showDashboard);
$("backToDashBtn").addEventListener("click", showDashboard);

// ============================================
// DASHBOARD: case counts + lists
// ============================================
async function loadDashboardCounts() {
  try {
    const promises = ["pending", "review", "finalized"].map(async (status) => {
      const { data, error } = await sb.from("cases").select("id").eq("status", status);
      if (!error && data) {
        $(`count${status.charAt(0).toUpperCase() + status.slice(1)}`).textContent = `${data.length} cases`;
      }
    });
    await Promise.all(promises);

    // Load recent feedback panel for non-judges
    if (currentProfile?.role !== 'judge') {
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
            <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-2 relative">
              <div style="padding-right:1.5rem;">
                <p class="font-bold text-xs text-amber-800 uppercase tracking-wide">Case: ${escapeHtml(caseName)}</p>
                <p class="text-sm text-slate-700 mt-1">💬 "${escapeHtml(c.review_comment)}"</p>
              </div>
              <div class="flex gap-2 mt-1">
                <button class="fix-case-btn bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition" data-id="${c.id}">🛠️ Fix Draft</button>
                <button class="dismiss-feedback-btn bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs px-3 py-1.5 rounded-lg font-semibold transition" data-id="${c.id}">✕ Dismiss</button>
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
  
  // Show loading skeleton while fetching
  container.innerHTML = `<div class="animate-pulse flex flex-col gap-3">
    <div class="h-24 bg-slate-100 rounded-xl"></div>
    <div class="h-24 bg-slate-100 rounded-xl"></div>
  </div>`;

  // Review stats for non-judge users
  if (status === 'review' && currentProfile?.role !== 'judge') {
    const { data: reviewCases } = await sb.from("cases").select("created_by").eq("status", "review");
    const { data: allProfiles } = await sb.from("profiles").select("id, full_name, role");
    if (!reviewCases || reviewCases.length === 0) {
      container.innerHTML = `<p class="text-slate-400 text-sm">Koi case review mein nahi hai.</p>`;
      return;
    }
    const profileMap = {};
    (allProfiles || []).forEach(p => profileMap[p.id] = p);
    const counts = {};
    reviewCases.forEach(c => {
      const name = profileMap[c.created_by]?.full_name || "Unknown";
      counts[name] = (counts[name] || 0) + 1;
    });
    container.innerHTML = `<div class="bg-white rounded-xl shadow p-4 mb-3"><p class="text-sm font-semibold text-slate-600 mb-3">Review Cases Breakdown</p>
      ${Object.entries(counts).map(([name, count]) =>
        `<div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
          <span class="text-sm">${escapeHtml(name)}</span>
          <span class="text-sm font-bold text-orange-600">${count} cases</span>
        </div>`
      ).join("")}
    </div>`;
    return;
  }

  const { data: cases, error } = await sb.from("cases").select("*").eq("status", status).order("updated_at", { ascending: false });
  if (error || !cases || cases.length === 0) {
    if (status === "finalized") {
      container.innerHTML = `<button class="add-template-list-btn w-full bg-gradient-to-r from-violet-600 to-blue-600 text-white py-3 rounded-xl font-bold shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2 mb-4">📄 Add New Template</button>
        <p class="text-slate-400 text-sm text-center">Koi finalized case nahi mila. Template add karke reuse karein.</p>`;
      container.querySelector(".add-template-list-btn")?.addEventListener("click", openTemplateModal);
    } else {
      container.innerHTML = `<p class="text-slate-400 text-sm">Koi case nahi mila.</p>`;
    }
    return;
  }
  const templateBtnHtml = status === "finalized" ? `<button class="add-template-list-btn w-full bg-gradient-to-r from-violet-600 to-blue-600 text-white py-3 rounded-xl font-bold shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2 mb-4">📄 Add New Template</button>` : "";
  container.innerHTML = templateBtnHtml + cases.map(c => {
    const title = c.case_title || `${c.category} Case (${c.case_type === "ex_parte" ? "Ex-parte" : "Contested"})`;
    const grounds = c.legal_grounds ? `<p class="text-xs text-slate-500 mt-1">${escapeHtml(c.legal_grounds)}</p>` : "";
    const comment = c.review_comment ? `<p class="text-xs text-amber-600 mt-1 bg-amber-50 p-1.5 rounded">💬 Review feedback: ${escapeHtml(c.review_comment)}</p>` : "";
    const reuseBtn = status === "finalized" ? `<button class="reuse-btn bg-purple-600 text-white text-xs px-3 py-1 rounded-lg mt-2" data-id="${c.id}">📑 Reuse as Template</button>` : "";
    const reviewActions = status === "review" && currentProfile?.role === 'judge' ? `
      <div class="flex gap-2 mt-2">
        <button class="review-approve-btn bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg" data-id="${c.id}">✅ Approve</button>
        <button class="review-sendback-btn bg-amber-500 text-white text-xs px-3 py-1.5 rounded-lg" data-id="${c.id}">↩️ Send Back</button>
      </div>` : "";
    return `
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex justify-between items-start">
          <div class="resume-case cursor-pointer flex-1" data-id="${c.id}">
            <p class="font-semibold">${escapeHtml(title)}</p>
            <p class="text-xs text-slate-400">${escapeHtml(c.category)} · ${c.case_type === "ex_parte" ? "Ex-parte" : "Contested"} · Step ${c.current_step}/5</p>
            ${grounds}${comment}
          </div>
          <button class="delete-case-btn text-red-400 hover:text-red-600 text-lg px-2 py-1" data-id="${c.id}" title="Delete case">🗑️</button>
        </div>
        ${reuseBtn}${reviewActions}
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
      await sb.from("cases").update({ status: 'finalized', review_comment: null }).eq("id", target.dataset.id);
      await loadDashboardCounts();
      openCaseList(status);
    } else if (target.classList.contains("review-sendback-btn")) {
      e.stopPropagation();
      const comment = prompt("Send back ka karan likhein (comment):");
      if (!comment) return;
      await sb.from("cases").update({ status: 'pending', current_step: 5, review_comment: comment }).eq("id", target.dataset.id);
      await loadDashboardCounts();
      openCaseList(status);
    }
  };
}

function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
const DEFAULT_MODELS = { claude: "claude-sonnet-4-6", gemini: "gemini-2.5-flash", openai: "gpt-4o-mini" };

const MODEL_OPTIONS = {
  claude: [
    { value: "", label: "Default (Sonnet 4.6)" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6 — Better — Expensive" },
    { value: "claude-opus-4-7", label: "Opus 4.7 — Best — Most Expensive" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5 — Good — Cheap" }
  ],
  gemini: [
    { value: "", label: "Default (Flash 2.5)" },
    { value: "gemini-2.5-flash", label: "Flash 2.5 — Good — Cheap" },
    { value: "gemini-2.5-pro", label: "Pro 2.5 — Best — Expensive" }
  ],
  openai: [
    { value: "", label: "Default (GPT-5.5 Instant)" },
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro — Best — Most Expensive" },
    { value: "gpt-5.5", label: "GPT-5.5 — Better — Expensive" },
    { value: "gpt-5.5-instant", label: "GPT-5.5 Instant — Good — Moderate" },
    { value: "gpt-5.4-pro", label: "GPT-5.4 Pro — Better — Expensive" },
    { value: "gpt-5.4", label: "GPT-5.4 — Good — Moderate" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini — Decent — Cheap" }
  ]
};

function populateModelDropdown(prov) {
  const sel = $("modelInput");
  sel.innerHTML = MODEL_OPTIONS[prov]?.map(o => `<option value="${o.value}">${o.label}</option>`).join("") || "";
}

function loadProviderFields() {
  const prov = $("providerSelect").value;
  populateModelDropdown(prov);
  let keys = [];
  const stored = localStorage.getItem(`ai_api_key_${prov}`);
  if (stored) {
    try { keys = JSON.parse(stored); }
    catch { keys = [stored]; }
  }
  $("apiKeyInput1").value = keys[0] || "";
  $("apiKeyInput2").value = keys[1] || "";
  $("apiKeyInput3").value = keys[2] || "";
  const savedModel = localStorage.getItem(`ai_model_${prov}`) || "";
  $("modelInput").value = savedModel;
}

function getSettings() {
  const prov = localStorage.getItem("ai_provider") || "claude";
  let keys = [];
  const stored = localStorage.getItem(`ai_api_key_${prov}`);
  if (stored) {
    try { keys = JSON.parse(stored); }
    catch { keys = [stored]; }
  }
  return {
    provider: prov,
    apiKeys: keys.filter(k => k),
    model: localStorage.getItem(`ai_model_${prov}`) || ""
  };
}

$("settingsBtn").addEventListener("click", () => {
  const s = getSettings();
  $("providerSelect").value = s.provider;
  loadProviderFields();
  $("settingsModal").classList.remove("hidden");
});
$("closeSettingsBtn").addEventListener("click", () => $("settingsModal").classList.add("hidden"));

$("glossaryMenuBtn").addEventListener("click", () => {
  $("hamburgerMenu").classList.add("hidden");
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

$("saveSettingsBtn").addEventListener("click", () => {
  const k1 = $("apiKeyInput1").value.trim();
  const k2 = $("apiKeyInput2").value.trim();
  const k3 = $("apiKeyInput3").value.trim();
  if (!k1 && !k2 && !k3) { showToast("Kam az kam ek API key zaroori hai.", "error"); return; }
  const prov = $("providerSelect").value;
  localStorage.setItem("ai_provider", prov);
  localStorage.setItem(`ai_api_key_${prov}`, JSON.stringify([k1, k2, k3]));
  localStorage.setItem(`ai_model_${prov}`, $("modelInput").value.trim());
  showToast("Settings save ho gayi.", "success");
});

let glossaryCache = [];
let editingGlossaryId = null;
let editingPresetIdx = null;

async function loadGlossary() {
  const { data } = await sb.from("glossary_rules").select("*").eq("user_id", currentProfile.id).order("created_at", { ascending: false });
  glossaryCache = data || [];
  renderGlossaryList();
}

function renderGlossaryList() {
  const list = $("glossaryList");
  if (glossaryCache.length === 0) { list.innerHTML = `<p class="text-xs text-slate-400">Abhi koi rule nahi hai.</p>`; return; }
  
  list.innerHTML = glossaryCache.map((r, idx) => `
    <div class="border border-slate-100 rounded-xl mb-1.5 overflow-hidden">
      <div class="glossary-header flex justify-between items-center bg-slate-50 p-2.5 text-xs font-semibold text-slate-800 cursor-pointer hover:bg-slate-100 transition">
        <span>📝 ${escapeHtml(r.term)}</span>
        <span class="chevron text-[10px] text-slate-400">▼</span>
      </div>
      <div class="glossary-body hidden bg-white p-3 border-t border-slate-100 text-xs text-slate-600">
        <p class="mb-2.5 leading-relaxed" style="text-align:left;">${escapeHtml(r.instruction)}</p>
        <div class="flex gap-2 justify-start">
          <button class="edit-glossary-btn bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg transition" data-id="${r.id}" data-term="${escapeHtml(r.term)}" data-instruction="${escapeHtml(r.instruction)}">✏️ Edit</button>
          <button class="del-glossary-btn bg-red-50 hover:bg-red-100 text-red-600 font-bold px-3 py-1.5 rounded-lg transition" data-id="${r.id}">🗑️ Delete</button>
        </div>
      </div>
    </div>`).join("");

  list.querySelectorAll(".glossary-header").forEach(header => {
    header.addEventListener("click", () => {
      const body = header.nextElementSibling;
      const chevron = header.querySelector(".chevron");
      const isHidden = body.classList.contains("hidden");
      
      list.querySelectorAll(".glossary-body").forEach(b => b.classList.add("hidden"));
      list.querySelectorAll(".chevron").forEach(c => c.textContent = "▼");
      
      if (isHidden) {
        body.classList.remove("hidden");
        chevron.textContent = "▲";
      }
    });
  });

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
  if (directives.length === 0) { list.innerHTML = `<p class="text-xs text-slate-400">Abhi koi preset nahi hai.</p>`; return; }
  
  list.innerHTML = directives.map((d, idx) => `
    <div class="border border-slate-100 rounded-xl mb-1.5 overflow-hidden">
      <div class="preset-header flex justify-between items-center bg-slate-50 p-2.5 text-xs font-semibold text-slate-800 cursor-pointer hover:bg-slate-100 transition">
        <span>📢 ${escapeHtml(d.label)}</span>
        <span class="chevron text-[10px] text-slate-400">▼</span>
      </div>
      <div class="preset-body hidden bg-white p-3 border-t border-slate-100 text-xs text-slate-600">
        <p class="mb-2.5 leading-relaxed" style="text-align:left;">${escapeHtml(d.text)}</p>
        <div class="flex gap-2 justify-start">
          <button class="edit-preset-btn bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg transition" data-idx="${idx}" data-label="${escapeHtml(d.label)}" data-text="${escapeHtml(d.text)}">✏️ Edit</button>
          <button class="del-preset-btn bg-red-50 hover:bg-red-100 text-red-600 font-bold px-3 py-1.5 rounded-lg transition" data-idx="${idx}">🗑️ Delete</button>
        </div>
      </div>
    </div>`).join("");

  list.querySelectorAll(".preset-header").forEach(header => {
    header.addEventListener("click", () => {
      const body = header.nextElementSibling;
      const chevron = header.querySelector(".chevron");
      const isHidden = body.classList.contains("hidden");
      
      list.querySelectorAll(".preset-body").forEach(b => b.classList.add("hidden"));
      list.querySelectorAll(".chevron").forEach(c => c.textContent = "▼");
      
      if (isHidden) {
        body.classList.remove("hidden");
        chevron.textContent = "▲";
      }
    });
  });

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
  if (dict.length === 0) { list.innerHTML = `<p class="text-xs text-slate-400">Abhi koi shortcut nahi hai.</p>`; return; }
  list.innerHTML = dict.map((item, idx) => `
    <div class="flex justify-between items-center bg-slate-100 rounded-lg p-2 text-xs text-slate-800">
      <span><b>${escapeHtml(item.shortcut)}</b>: ${escapeHtml(item.expanded)}</span>
      <button class="del-dict-btn text-red-500 hover:text-red-700 px-2" data-idx="${idx}">✕</button>
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
  $("hamburgerMenu").classList.add("hidden");
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
async function callAI(prompt, maxTokens = 2048) {
  const s = getSettings();
  if (!s.apiKeys || s.apiKeys.length === 0) throw new Error("API key set nahi hai. Settings (⚙️) mein jaa ke add karein.");
  const model = s.model || DEFAULT_MODELS[s.provider];
  const finalPrompt = prompt
    + "\n\nIMPORTANT: Apna pura jawab sirf English language mein likhein, chahe source documents Urdu mein hon."
    + buildGlossaryInstructions();

  let lastError = null;
  for (let i = 0; i < s.apiKeys.length; i++) {
    const key = s.apiKeys[i];
    try {
      if (s.provider === "claude") {
        const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
          ? 'http://localhost:3000' : 'https://api.yourproductiondomain.com';
        const res = await fetch(`${API_BASE}/api/ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "anthropic",
            apiKey: key,
            model,
            messages: [{ role: "user", content: finalPrompt }]
          })
        });
        if (!res.ok) throw new Error("Claude API error: " + (await res.text()));
        const data = await res.json();
        return data.text || "";
      }
      if (s.provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
        });
        if (!res.ok) throw new Error("Gemini API error: " + (await res.text()));
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      if (s.provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: finalPrompt }] })
        });
        if (!res.ok) throw new Error("OpenAI API error: " + (await res.text()));
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }
    } catch (err) {
      lastError = err;
      console.warn(`callAI Key ${i + 1} failed:`, err);
      if (i < s.apiKeys.length - 1) {
        showToast(`API limit reached. Trying Fallback Key ${i + 2}...`, "warning");
      }
    }
  }
  throw lastError || new Error("Unknown provider");
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
  await stopLiveMode();
  showDashboard();
});

// ============================================
// LIVE TYPE EDITOR (Real-time Collaborative)
// ============================================
let liveTypeChannel = null;
let liveTypeTimer = null;
let liveTypeIsRemoteUpdate = false;

$("liveTypeBtn").addEventListener("click", async () => {
  $("liveTypeOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden"; // Disable background scrolling
  // Fetch existing content
  const noteId = `live-note-${typeof activeCase !== 'undefined' && activeCase ? activeCase.id : '1'}`;
  const { data } = await sb.from("live_notes").select("content").eq("id", noteId).maybeSingle();
  $("liveTypeTextarea").value = data?.content || "";

  // Subscribe to real-time changes
  liveTypeChannel = sb.channel("live-notes")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_notes", filter: `id=eq.${typeof activeCase !== 'undefined' && activeCase ? 'live-note-' + activeCase.id : 'live-note-1'}` }, (payload) => {
      if (payload.new && payload.new.updated_by !== currentProfile?.id && document.activeElement?.id !== "liveTypeTextarea") {
        liveTypeIsRemoteUpdate = true;
        $("liveTypeTextarea").value = payload.new.content || "";
        liveTypeIsRemoteUpdate = false;
      }
    })
    .subscribe();
});

$("liveTypeCloseBtn").addEventListener("click", async () => {
  if (liveTypeChannel) { sb.removeChannel(liveTypeChannel); liveTypeChannel = null; }
  $("liveTypeOverlay").classList.add("hidden");
  document.body.style.overflow = ""; // Enable background scrolling
});

$("liveTypeTextarea").addEventListener("input", () => {
  if (liveTypeIsRemoteUpdate) return;
  clearTimeout(liveTypeTimer);
  liveTypeTimer = setTimeout(async () => {
    await sb.from("live_notes").upsert({
      id: `live-note-${typeof activeCase !== 'undefined' && activeCase ? activeCase.id : '1'}`,
      content: $("liveTypeTextarea").value,
      updated_by: currentProfile?.id,
      updated_at: new Date().toISOString()
    });
  }, 800);
});

$("liveTypeWordBtn").addEventListener("click", () => {
  const text = $("liveTypeTextarea").value;
  if (!text.trim()) { showToast("Pehle kuch type karein.", "error"); return; }
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset='utf-8'><title>Live Type</title></head>
  <body style="font-family:'Times New Roman';font-size:14pt;line-height:1.6;">${text.split("\n").map(p => `<p>${escapeHtml(p)}</p>`).join("")}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: "application/msword" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "live-type.doc"; link.click();
});

// ============================================
// OPEN / LOAD WIZARD FOR A CASE
// ============================================
async function openWizardForCase(caseId) {
  const { data: caseData, error } = await sb.from("cases").select("*").eq("id", caseId).single();
  if (error || !caseData) {   showToast("Case load nahi ho saka.", "error"); return; }
  activeCase = caseData;

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
  if (caseData.judgement_output) {
    $("outputSection").classList.remove("hidden");
    $("chatSection").classList.remove("hidden");
    const isJudge = currentProfile?.role === 'judge';
    const isReview = caseData.status === 'review';
    $("judgeReviewActions").classList.toggle("hidden", !(isJudge && isReview));
    $("finalizeBtn").classList.toggle("hidden", !isJudge || isReview);
    $("submitReviewBtn").classList.toggle("hidden", isJudge || caseData.status !== 'pending');
  }
  $("wizStatus").value = caseData.status;

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
function attachAutosaveListeners() {
  const fields = ["plaintText","factsText","wsText","admitDenyText","issuesText","disputesText","evidenceText","findingsText","shortOrder","judgementOutput"];
  fields.forEach(id => {
    $(id).oninput = () => scheduleAutosave();
  });
  $("wizStatus").onchange = async () => {
    await saveOrUpdateCase({ status: $("wizStatus").value });
    await loadDashboardCounts();
  };
}

function scheduleAutosave() {
  clearTimeout(saveTimer);
  const currentCase = activeCase;
  const payload = {
    plaint_text: $("plaintText").value,
    facts_text: $("factsText").value,
    written_statement_text: $("wsText").value,
    admit_deny_text: $("admitDenyText").value,
    issues_text: $("issuesText").value,
    disputes_text: $("disputesText").value,
    evidence_text: $("evidenceText").value,
    findings_text: $("findingsText").value,
    short_order: $("shortOrder").value,
    judgement_output: $("judgementOutput").value
  };
  saveTimer = setTimeout(async () => {
    $("autosaveIndicator").textContent = "Saving...";
    if (activeCase !== currentCase) {
      if (currentCase?.id) await sb.from("cases").update(payload).eq("id", currentCase.id);
      return;
    }
    await saveOrUpdateCase(payload);
    $("autosaveIndicator").textContent = "✓ Saved";
    setTimeout(() => {
      if ($("autosaveIndicator").textContent === "✓ Saved") $("autosaveIndicator").textContent = "";
    }, 1500);
  }, 2000);
}

async function saveOrUpdateCase(fields) {
  if (!activeCase) return;
  try {
    fields.last_updated_by = currentProfile?.id;
    const { error } = await sb.from("cases").update(fields).eq("id", activeCase.id);
    if (error) throw error;
    Object.assign(activeCase, fields);
  } catch (err) {
    console.error("Save failed:", err);
    showToast("Data save karne mein masla aya: " + err.message, "error");
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

function getWizardFields() {
  return {
    plaint_text: $("plaintText").value,
    facts_text: $("factsText").value,
    written_statement_text: $("wsText").value,
    admit_deny_text: $("admitDenyText").value,
    issues_text: $("issuesText").value,
    disputes_text: $("disputesText").value,
    evidence_text: $("evidenceText").value,
    findings_text: $("findingsText").value,
    short_order: $("shortOrder").value,
    judgement_output: $("judgementOutput").value
  };
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
  $("wizBackBtn").classList.toggle("hidden", seq.indexOf(n) === 0);
  $("wizNextBtn").classList.toggle("hidden", seq.indexOf(n) === seq.length - 1);
  // Submit for Review button - har step pe dikhe (non-judge users, case pending ho)
  $("wizReviewBtn").classList.toggle("hidden", currentProfile?.role === 'judge' || activeCase?.status !== 'pending');
  saveOrUpdateCase({ current_step: n });


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


$("wizReviewBtn").addEventListener("click", async () => {
  if (!confirm("Case review ke liye submit karein? Judge approve ya send back kar sakta hai.")) return;
  await saveOrUpdateCase({ status: "review" });
  $("wizStatus").value = "review";
  showToast("Case review ke liye submit ho gaya!", "success");
  showDashboard();
});

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

async function visionOCR(file) {
  const s = getSettings();
  console.log("visionOCR using provider:", s.provider, "model:", s.model || "default");
  if (!s.apiKeys || s.apiKeys.length === 0) throw new Error("API key set nahi hai. Settings (⚙️) mein jaa ke add karein.");
  const base64 = await fileToBase64(file);
  const mimeType = file.type;
  const instr = `Extract all text from this image accurately (Urdu/English, handwritten or printed).

IMPORTANT RULES:
- Handle both Pakistani Civil and Family Court documents.
- Extract full text as-is.
- For proper nouns (person names, place names): if written in Urdu script, transliterate them into Roman English (e.g. "حنا اعظم" → "Hina Azam", "محمد عدنان" → "Muhammad Adnan")
- For legal/document terms in Urdu script, keep them in Urdu script (e.g. "نکاح نامہ", "قوم", "بیع نامہ", "اقرار نامہ", "دعویٰ استقرارِ حق", "حکم امتناعی")
- Do not translate — only transliterate names
- Return only extracted text, no commentary`;

  let lastError = null;
  for (let i = 0; i < s.apiKeys.length; i++) {
    const key = s.apiKeys[i];
    try {
      if (s.provider === "gemini") {
        const model = s.model || DEFAULT_MODELS.gemini;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: instr }, { inline_data: { mime_type: mimeType, data: base64 } }] }] })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      if (s.provider === "claude") {
        const model = s.model || DEFAULT_MODELS.claude;
        const res = await fetch("http://localhost:3000/api/ai", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "anthropic",
            apiKey: key,
            model,
            messages: [{ role: "user", content: [{ type: "text", text: instr }, { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } }] }]
          })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data.text || "";
      }
      if (s.provider === "openai") {
        const model = s.model || DEFAULT_MODELS.openai;
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: [{ type: "text", text: instr }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }] }] })
        });
        if (!res.ok) throw new Error("OpenAI " + res.status + ": " + (await res.text()).slice(0, 200));
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }
    } catch (err) {
      lastError = err;
      console.warn(`visionOCR Key ${i + 1} failed:`, err);
      if (i < s.apiKeys.length - 1) {
        showToast(`API limit reached. Trying Fallback Key ${i + 2}...`, "warning");
      }
    }
  }
  throw lastError || new Error("Unknown provider");
}

function buildUploadWidget(target, textareaId) {
  const container = $(`uploadArea-${target}`);
  container.innerHTML = `
    <div class="flex gap-2 mb-2">
      <button type="button" class="cam-btn flex-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg py-2 text-sm font-medium">📷 Camera</button>
      <button type="button" class="file-btn flex-1 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg py-2 text-sm font-medium">🖼️ Files</button>
    </div>
    <input type="file" class="cam-input hidden" accept="image/jpeg,image/png" capture="environment" />
    <input type="file" class="file-input hidden" accept="image/jpeg,image/png" multiple />
    <div class="preview-area flex flex-wrap gap-2 mb-2"></div>
    <div class="ocr-status text-xs text-slate-400"></div>`;
  const camBtn = container.querySelector(".cam-btn"), fileBtn = container.querySelector(".file-btn");
  const camInput = container.querySelector(".cam-input"), fileInput = container.querySelector(".file-input");
  const previewArea = container.querySelector(".preview-area"), statusEl = container.querySelector(".ocr-status");
  camBtn.onclick = () => camInput.click();
  fileBtn.onclick = () => fileInput.click();
  camInput.onchange = (e) => processImages(e.target.files, previewArea, statusEl, textareaId);
  fileInput.onchange = (e) => processImages(e.target.files, previewArea, statusEl, textareaId);
}

let processingQueue = false;

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
    wrap.querySelector(".ocr-badge").textContent = "⏭";
    wrap.querySelector(".ocr-badge").className = "ocr-badge absolute bottom-0 right-0 bg-slate-400 text-white text-[10px] px-1 rounded";
  };
  fileInput.onchange = (e) => {
    const newFile = e.target.files[0];
    if (!newFile) return;
    menu.remove();
    openImgEditor(newFile, async (editedFile) => {
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

async function runOcrOnImage(wrap, previewArea, statusEl, textareaId, num) {
  const file = getCurrentFile(wrap);
  if (!file) { statusEl.textContent = `❌ Image ${num}: no file`; return; }
  const textareaEl = $(textareaId);
  const badge = wrap.querySelector(".ocr-badge");
  removeImageText(wrap, textareaEl);
  badge.textContent = "...";
  badge.className = "ocr-badge absolute bottom-0 right-0 bg-yellow-400 text-white text-[10px] px-1 rounded";
  statusEl.textContent = `OCR image ${num}...`;
  try {
    const text = await visionOCR(file);
    const textTrimmed = text.trim();
    textareaEl.value = (textareaEl.value ? textareaEl.value + "\n\n" : "") + textTrimmed;
    wrap._insertedText = textTrimmed;
    delete wrap.dataset.skipped;
    textareaEl.dispatchEvent(new Event("input"));
    badge.textContent = "✓";
    badge.className = "ocr-badge absolute bottom-0 right-0 bg-green-500 text-white text-[10px] px-1 rounded";
    statusEl.textContent = `✅ Image ${num} OCR done.`;
  } catch (err) {
    badge.textContent = "✗";
    badge.className = "ocr-badge absolute bottom-0 right-0 bg-red-500 text-white text-[10px] px-1 rounded";
    statusEl.textContent = `❌ Image ${num}: ${err.message}`;
  }
}

async function processImages(fileList, previewArea, statusEl, textareaId) {
  const files = Array.from(fileList).filter(f => f.type === "image/jpeg" || f.type === "image/png");
  if (files.length === 0) { showToast("Sirf JPG/PNG support hain.", "error"); return; }
  const textareaEl = $(textareaId);
  // Step 1: Open batch editor — user edits all images, then presses Upload All
  const editedFiles = await new Promise(resolve => {
    openBatchEditor(fileList, (results) => resolve(results));
  });
  if (!editedFiles || !editedFiles.length) return;
  const startIndex = previewArea.children.length;
  // Show thumbnails for all edited images
  for (const [idx, file] of editedFiles.entries()) {
    const thumb = document.createElement("div"); thumb.className = "relative w-16 h-16";
    const thumbImg = document.createElement("img");
    thumbImg.src = URL.createObjectURL(file);
    thumbImg.className = "w-16 h-16 object-cover rounded-lg border border-green-400";
    const label = document.createElement("div");
    label.className = "absolute -top-1.5 -left-1.5 bg-blue-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold";
    label.textContent = startIndex + idx + 1;
    thumb.appendChild(label); thumb.appendChild(thumbImg);
    previewArea.appendChild(thumb);
  }
  // Step 2: Upload/OCR all edited images
  for (const [idx, file] of editedFiles.entries()) {
    const num = startIndex + idx + 1;
    const wrap = previewArea.children[startIndex + idx];
    if (!wrap) continue;
    wrap._currentFile = file;
    // Add OCR badge
    const badge = document.createElement("div"); badge.className = "ocr-badge absolute bottom-0 right-0 bg-yellow-400 text-white text-[10px] px-1 rounded"; badge.textContent = "...";
    wrap.appendChild(badge);
    attachContextMenu(wrap, previewArea, statusEl, textareaId, num);
    statusEl.textContent = `OCR image ${num} processing...`;
    try {
      const text = await visionOCR(file);
      const textTrimmed = text.trim();
      textareaEl.value = (textareaEl.value ? textareaEl.value + "\n\n" : "") + textTrimmed;
      wrap._insertedText = textTrimmed;
      textareaEl.dispatchEvent(new Event("input"));
      badge.textContent = "✓";
      badge.className = "ocr-badge absolute bottom-0 right-0 bg-green-500 text-white text-[10px] px-1 rounded";
      statusEl.textContent = `✅ Image ${num} OCR done.`;
    } catch (err) {
      badge.textContent = "✗";
      badge.className = "ocr-badge absolute bottom-0 right-0 bg-red-500 text-white text-[10px] px-1 rounded";
      statusEl.textContent = `❌ Image ${num}: ${err.message}`;
    }
  }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".img-context-menu")) {
    document.querySelectorAll(".img-context-menu").forEach(m => m.remove());
  }
});

// ============================================
// IMAGE EDITOR (rotate, crop)
// ============================================
let imgEditorCallback = null;
let imgEditorCurrentFile = null;
let imgEditorRotation = 0;
let imgEditorCropBox = null;
let imgEditorCropActive = false;

$("imgEditorClose").addEventListener("click", closeImgEditor);
if ($("imgEditorCancel")) $("imgEditorCancel").addEventListener("click", closeImgEditor);

function closeImgEditor() {
  $("imageEditorModal").classList.add("hidden");
  removeCropOverlay();
  imgEditorCallback = null;
  imgEditorCurrentFile = null;
  imgEditorRotation = 0;
  imgEditorCropActive = false;
}

$("imgEditorRotateLeft").addEventListener("click", () => {
  imgEditorRotation = (imgEditorRotation - 90 + 360) % 360;
  applyRotation();
  removeCropOverlay();
});
$("imgEditorRotateRight").addEventListener("click", () => {
  imgEditorRotation = (imgEditorRotation + 90) % 360;
  applyRotation();
  removeCropOverlay();
});

function applyRotation() {
  $("imgEditorPreview").style.transform = `rotate(${imgEditorRotation}deg)`;
}

// ---- CROP (simple resize box) ----
let imgEditorCropSelection = null;

// Calculate actual image display area within a container (object-fit:contain, centered)
function getImageDisplayRect(img, containerW, containerH) {
  const cr = img.parentElement.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  return { x: ir.left - cr.left, y: ir.top - cr.top, w: ir.width, h: ir.height };
}

function applyCropToPreview() {
  const sel = imgEditorCropSelection;
  if (!sel) { showToast("Crop selection ready nahi hai", "error"); return; }
  const container = $("imgEditorPreview").parentElement;
  const cw = container.clientWidth, ch = container.clientHeight;
  if (!cw || !ch) { showToast("Container dimensions zero", "error"); return; }
  const img = $("imgEditorPreview");
  const dr = getImageDisplayRect(img, cw, ch);
  const sr = sel.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  let cropX = (sr.left - cr.left - dr.x) / dr.w;
  let cropY = (sr.top - cr.top - dr.y) / dr.h;
  let cropW = sr.width / dr.w;
  let cropH = sr.height / dr.h;
  cropX = Math.max(0, Math.min(cropX, 1));
  cropY = Math.max(0, Math.min(cropY, 1));
  cropW = Math.max(0.01, Math.min(cropW, 1 - cropX));
  cropH = Math.max(0.01, Math.min(cropH, 1 - cropY));
  const crop = { x: cropX, y: cropY, w: cropW, h: cropH };
  if (crop.w < 0.05 || crop.h < 0.05) { showToast("Selection bahut chhota hai", "error"); return; }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const rad = imgEditorRotation * Math.PI / 180;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { showToast("Image load nahi hui", "error"); return; }
    if (imgEditorRotation === 90 || imgEditorRotation === 270) { w = img.naturalHeight; h = img.naturalWidth; }
    canvas.width = w; canvas.height = h;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const cx = Math.round(crop.x * w), cy = Math.round(crop.y * h);
    const cw2 = Math.round(crop.w * w), ch2 = Math.round(crop.h * h);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cw2; cropCanvas.height = ch2;
    cropCanvas.getContext("2d").drawImage(canvas, cx, cy, cw2, ch2, 0, 0, cw2, ch2);
    const dataUrl = cropCanvas.toDataURL(imgEditorCurrentFile?.type || "image/jpeg");
    const blob = dataURLToBlob(dataUrl);
    const newFile = new File([blob], imgEditorCurrentFile.name, { type: imgEditorCurrentFile.type });
    imgEditorCurrentFile = newFile;
    imgEditorRotation = 0;
    img.src = dataUrl;
    img.style.transform = "rotate(0deg)";
    removeCropOverlay();
    showToast("Crop applied ✓", "success");
  } catch (e) {
    showToast("Crop processing error: " + e.message, "error");
    removeCropOverlay();
  }
}
function dataURLToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)[1];
  const bytes = atob(parts[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

$("imgEditorCrop").addEventListener("click", () => {
  if (imgEditorCropActive) { applyCropToPreview(); return; }
  imgEditorCropActive = true;
  const preview = $("imgEditorPreview");
  const container = preview.parentElement;
  container.style.position = "relative";

  const cw = container.clientWidth || 300;
  const ch = container.clientHeight || 300;
  const dr = getImageDisplayRect(preview, cw, ch);

  const overlay = document.createElement("div");
  overlay.id = "cropOverlay";
  overlay.style.cssText = "position:absolute;inset:0;z-index:10";

  const sel = document.createElement("div");
  sel.id = "cropSelection";
  imgEditorCropSelection = sel;
  // Start with a slightly inset crop area (90% of image)
  const inset = 0.05;
  const selX = dr.x + dr.w * inset, selY = dr.y + dr.h * inset;
  const selW = dr.w * (1 - inset * 2), selH = dr.h * (1 - inset * 2);
  sel.style.cssText = `position:absolute;left:${selX}px;top:${selY}px;width:${selW}px;height:${selH}px;border:2px solid rgba(255,255,255,0.85);box-shadow:0 0 0 9999px rgba(0,0,0,0.65),inset 0 0 0 1px rgba(255,255,255,0.08);cursor:move;z-index:11;box-sizing:border-box;transition:none`;

  // Rule-of-thirds grid lines
  ['33.33%','66.66%'].forEach(pos => {
    const gh = document.createElement('div');
    gh.style.cssText = `position:absolute;left:0;right:0;top:${pos};height:1px;background:rgba(255,255,255,0.2);pointer-events:none`;
    sel.appendChild(gh);
    const gv = document.createElement('div');
    gv.style.cssText = `position:absolute;top:0;bottom:0;left:${pos};width:1px;background:rgba(255,255,255,0.2);pointer-events:none`;
    sel.appendChild(gv);
  });

  // L-shaped corner handles (Android style)
  ['nw','ne','sw','se'].forEach(dir => {
    const corner = document.createElement('div');
    corner.className = `crop-corner ${dir}`;
    corner.dataset.dir = dir;
    corner.dataset.pos = dir;
    sel.appendChild(corner);
  });

  // Edge midpoint handles
  ['n','s','w','e'].forEach(dir => {
    const edge = document.createElement('div');
    edge.className = `crop-edge ${dir}`;
    edge.dataset.dir = dir;
    edge.dataset.pos = dir;
    sel.appendChild(edge);
  });

  container.appendChild(overlay);
  overlay.appendChild(sel);

  // Update crop button to "Done" state
  const cropBtn = $("imgEditorCrop");
  cropBtn.classList.add("active");
  cropBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Done</span>`;

  // Remove any prior global listeners first
  if (window._cropListeners) {
    window._cropListeners.forEach(([ev, fn]) => document.removeEventListener(ev, fn, fn._opts));
    window._cropListeners = [];
  }

  // Drag logic constrained to image display area
  const imgLeft = dr.x, imgTop = dr.y, imgRight = dr.x + dr.w, imgBottom = dr.y + dr.h;
  let dragHandle = null, startX, startY, startR;
  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  function onDown(px, py, handle) {
    const c = container.getBoundingClientRect();
    const s = sel.getBoundingClientRect();
    startX = px; startY = py;
    startR = { l: s.left - c.left, t: s.top - c.top, r: s.right - c.left, b: s.bottom - c.top, w: s.width, h: s.height };
    dragHandle = handle || "move";
  }

  sel.onmousedown = (e) => {
    const h = e.target.dataset.pos;
    onDown(e.clientX, e.clientY, h);
    e.preventDefault();
  };
  sel.ontouchstart = (e) => {
    const t = e.touches[0]; const h = e.target.dataset.pos;
    onDown(t.clientX, t.clientY, h);
    e.preventDefault();
  };

  if (!window._cropListeners) window._cropListeners = [];
  const doDrag = (dx, dy) => {
    if (!dragHandle) return;
    const r = startR;
    let l = r.l, t = r.t, ri = r.r, b = r.b;
    if (dragHandle === "move") {
      l = clamp(r.l + dx, imgLeft, imgRight - r.w);
      t = clamp(r.t + dy, imgTop, imgBottom - r.h);
      ri = l + r.w; b = t + r.h;
    } else {
      if (dragHandle.includes("w")) l = clamp(r.l + dx, imgLeft, r.r - 60);
      if (dragHandle.includes("e")) ri = clamp(r.r + dx, r.l + 60, imgRight);
      if (dragHandle.includes("n")) t = clamp(r.t + dy, imgTop, r.b - 60);
      if (dragHandle.includes("s")) b = clamp(r.b + dy, r.t + 60, imgBottom);
    }
    sel.style.left = l + "px"; sel.style.top = t + "px";
    sel.style.width = (ri - l) + "px"; sel.style.height = (b - t) + "px";
  };
  const onMouseMove = (e) => { doDrag(e.clientX - startX, e.clientY - startY); };
  const onMouseUp = () => { dragHandle = null; };
  const onTouchMove = (e) => { e.preventDefault(); const t = e.touches[0]; doDrag(t.clientX - startX, t.clientY - startY); };
  const onTouchEnd = () => { dragHandle = null; };
  onTouchMove._opts = { passive: false };
  onTouchEnd._opts = { passive: true };
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("touchmove", onTouchMove, onTouchMove._opts);
  document.addEventListener("touchend", onTouchEnd, onTouchEnd._opts);
  window._cropListeners = [
    ["mousemove", onMouseMove],
    ["mouseup", onMouseUp],
    ["touchmove", onTouchMove],
    ["touchend", onTouchEnd]
  ];
});

function removeCropOverlay() {
  const ov = document.getElementById("cropOverlay");
  if (ov) ov.remove();
  imgEditorCropSelection = null;
  imgEditorCropActive = false;
  const btn = $("imgEditorCrop");
  btn.classList.remove("active");
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg><span>Crop</span>`;
  if (window._cropListeners) {
    window._cropListeners.forEach(([ev, fn]) => document.removeEventListener(ev, fn, fn._opts));
    window._cropListeners = null;
  }
}

$("imgEditorConfirm").addEventListener("click", () => {
  const img = $("imgEditorPreview");
  // If no rotation and no active crop overlay, pass through current file directly
  const crop = imgEditorCropSelection ? (() => {
    const container = $("imgEditorPreview").parentElement;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch) return null;
    const img = $("imgEditorPreview");
    const dr = getImageDisplayRect(img, cw, ch);
    const sr = imgEditorCropSelection.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    let cx = (sr.left - cr.left - dr.x) / dr.w, cy = (sr.top - cr.top - dr.y) / dr.h;
    let cw2 = sr.width / dr.w, ch2 = sr.height / dr.h;
    cx = Math.max(0, Math.min(cx, 1)); cy = Math.max(0, Math.min(cy, 1));
    cw2 = Math.max(0.01, Math.min(cw2, 1 - cx)); ch2 = Math.max(0.01, Math.min(ch2, 1 - cy));
    return { x: cx, y: cy, w: cw2, h: ch2 };
  })() : null;
  if (imgEditorRotation === 0 && !crop) {
    const cb = imgEditorCallback;
    const file = imgEditorCurrentFile;
    closeImgEditor();
    if (cb) cb(file);
    return;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const rad = imgEditorRotation * Math.PI / 180;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (imgEditorRotation === 90 || imgEditorRotation === 270) { w = img.naturalHeight; h = img.naturalWidth; }
  canvas.width = w; canvas.height = h;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  if (crop && crop.w > 0.05 && crop.h > 0.05) {
    const cx = Math.round(crop.x * w), cy = Math.round(crop.y * h);
    const cw = Math.round(crop.w * w), ch = Math.round(crop.h * h);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cw; cropCanvas.height = ch;
    cropCanvas.getContext("2d").drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    cropCanvas.toBlob((blob) => {
      const croppedFile = new File([blob], (imgEditorCurrentFile || {}).name || "image.jpg", { type: imgEditorCurrentFile?.type || "image/jpeg" });
      const cb = imgEditorCallback;
      closeImgEditor();
      if (cb) cb(croppedFile);
    }, imgEditorCurrentFile?.type || "image/jpeg");
  } else {
    canvas.toBlob((blob) => {
      const rotatedFile = new File([blob], (imgEditorCurrentFile || {}).name || "image.jpg", { type: imgEditorCurrentFile?.type || "image/jpeg" });
      const cb = imgEditorCallback;
      closeImgEditor();
      if (cb) cb(rotatedFile);
    }, imgEditorCurrentFile?.type || "image/jpeg");
  }
});

function openImgEditor(file, callback) {
  imgEditorCurrentFile = file;
  imgEditorRotation = 0;
  imgEditorCallback = callback;
  const reader = new FileReader();
  reader.onload = (e) => {
    $("imgEditorPreview").src = e.target.result;
    $("imgEditorPreview").style.transform = "rotate(0deg)";
    $("imageEditorModal").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

// ============================================
// BATCH IMAGE EDITOR (multi-image edit screen)
// ============================================
let batchState = null;
const FILTER_PRESETS = {
  original: { filter: 'none', label: 'Original' },
  auto: { filter: 'contrast(110%) brightness(105%) saturate(110%)', label: 'Auto' },
  vivid: { filter: 'contrast(130%) saturate(140%) brightness(105%)', label: 'Vivid' },
  warm: { filter: 'sepia(25%) saturate(120%) brightness(105%)', label: 'Warm' },
  cool: { filter: 'hue-rotate(200deg) saturate(90%) brightness(105%)', label: 'Cool' },
  portrait: { filter: 'brightness(105%) contrast(90%) saturate(85%) sepia(10%)', label: 'Portrait' },
  dramatic: { filter: 'contrast(160%) saturate(110%) brightness(85%)', label: 'Dramatic' },
  bw: { filter: 'grayscale(100%) contrast(110%) brightness(105%)', label: 'B&W' },
  vintage: { filter: 'sepia(70%) contrast(85%) brightness(105%)', label: 'Vintage' },
  negative: { filter: 'invert(100%)', label: 'Negative' },
  soft: { filter: 'brightness(110%) contrast(85%) saturate(75%)', label: 'Soft' }
};

function openBatchEditor(fileList, callback) {
  const files = Array.from(fileList).filter(f => f.type === "image/jpeg" || f.type === "image/png");
  if (!files.length) { showToast("Sirf JPG/PNG support hain.", "error"); return; }
  batchState = {
    files,
    edits: files.map(() => ({ rotation: 0, crop: null, filter: 'original', cropAspect: 'free' })),
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
    const edited = batchState.edits[i].rotation !== 0 || batchState.edits[i].crop || batchState.edits[i].filter !== 'original';
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
  state.edits[idx] = { rotation: 0, crop: null, filter: 'original', cropAspect: 'free' };
  batchSelectImage(idx);
});

// ---- ENHANCED CROP ----
let batchCropActive = false;
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
  const dr = getImageDisplayRect(img, cw, ch);
  win.style.left = dr.x + "px";
  win.style.top = dr.y + "px";
  win.style.width = dr.w + "px";
  win.style.height = dr.h + "px";
  batchCropActive = true;
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
  batchCropActive = false;
}

function doApplyCrop() {
  const state = batchState; if (!state) return;
  const img = $("batchPreview");
  const win = $("batchCropWindow");
  const preview = img.parentElement;
  const cw = preview.clientWidth, ch = preview.clientHeight;
  if (!cw || !ch) return;
  const dr = getImageDisplayRect(img, cw, ch);
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
  state.edits[state.currentIndex].crop = null;
  state.edits[state.currentIndex].rotation = 0;
  img.src = dataUrl;
  img.style.transform = "rotate(0deg)";
  img.style.filter = FILTER_PRESETS[state.edits[state.currentIndex].filter].filter;
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
let batchPendingFilter = 'original';

function renderFilters() {
  const scroll = $("batchFilterScroll");
  const state = batchState; if (!state) return;
  const img = $("batchPreview");
  batchPendingFilter = state.edits[state.currentIndex].filter;
  scroll.innerHTML = "";
  const thumbSize = 60;
  const canvas = document.createElement("canvas");
  canvas.width = thumbSize; canvas.height = thumbSize;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, thumbSize, thumbSize);
  Object.entries(FILTER_PRESETS).forEach(([key, preset]) => {
    const div = document.createElement("div");
    div.className = "filter-preset" + (key === batchPendingFilter ? " active" : "");
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
      batchPendingFilter = key;
      state.edits[state.currentIndex].filter = key;
      img.style.filter = preset.filter;
      document.querySelectorAll(".filter-preset").forEach(p => p.classList.remove("active"));
      div.classList.add("active");
      updateFilmstrip();
    });
    scroll.appendChild(div);
  });
}

$("batchApplyFilter").addEventListener("click", () => {
  const state = batchState; if (!state) return;
  const img = $("batchPreview");
  state.edits[state.currentIndex].filter = batchPendingFilter;
  img.style.filter = FILTER_PRESETS[batchPendingFilter].filter;
  $("batchFilterPanel").classList.add("hidden");
  document.querySelectorAll(".batch-tool-btn").forEach(b => b.classList.remove("active"));
  updateFilmstrip();
});

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
    btn.textContent = "Upload All";
    batchState = null;
  }
}

async function applyBatchEdits(file, edit) {
  if (!edit.rotation && !edit.crop && edit.filter === 'original') return file;
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
        if (edit.crop) {
          const cx = Math.round(edit.crop.x * w), cy = Math.round(edit.crop.y * h);
          const cw = Math.round(edit.crop.w * w), ch = Math.round(edit.crop.h * h);
          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = cw; cropCanvas.height = ch;
          cropCanvas.getContext("2d").drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
          const dataUrl = cropCanvas.toDataURL(file.type || "image/jpeg");
          const blob = dataURLToBlob(dataUrl);
          resolve(new File([blob], file.name, { type: file.type }));
        } else {
          canvas.toBlob(blob => {
            resolve(new File([blob], file.name, { type: file.type }));
          }, file.type || "image/jpeg");
        }
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
    $("outputSection").classList.remove("hidden");
    $("chatSection").classList.remove("hidden");
    const isJudge = currentProfile?.role === 'judge';
    const isReview = activeCase?.status === 'review';
    $("judgeReviewActions").classList.toggle("hidden", !(isJudge && isReview));
    $("finalizeBtn").classList.toggle("hidden", !isJudge || isReview);
    $("submitReviewBtn").classList.toggle("hidden", isJudge || activeCase?.status !== 'pending');
    $("chatLog").innerHTML = "";
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { setBtnLoading("generateFinalBtn", "spin-generateFinal", false, "judgementOutput"); }
});

// SUBMIT FOR REVIEW
$("submitReviewBtn").addEventListener("click", async () => {
  if (!confirm("Case review ke liye submit karein? Judge approve ya send back kar sakta hai.")) return;
  await saveOrUpdateCase({ status: "review" });
  $("wizStatus").value = "review";
  showToast("Case review ke liye submit ho gaya!", "success");
  await loadDashboardCounts();
});

// JUDGE APPROVE FROM WIZARD
$("wizApproveBtn").addEventListener("click", async () => {
  const judgement = $("judgementOutput").value.trim();
  if (!judgement) { showToast("Judgement draft empty hai.", "error"); return; }
  if (!confirm("Kya aap is draft ko approve aur finalize karna chahte hain?")) return;

  const prompt = `You are a legal assistant for Pakistani Civil and Family Courts. Your task is to extract ONLY the case title and legal grounds from the given judgement.

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

- DO NOT:
  
  - Add extra facts
  - Add dates or locations
  - Use creative wording

========================
GROUNDS RULE (STRICT)

- Extract ONLY explicitly mentioned:
  
  - Laws
  - Ordinances
  - Sections

- If multiple are mentioned:
  
  - List all in one line, separated by commas

- If NO law or section is clearly mentioned:
  
  - Write:
    [Not specified in judgement]

- DO NOT guess or add legal provisions

========================
INPUT

Judgement:
${judgement}

========================
OUTPUT FORMAT (STRICT)

TITLE: <text>
GROUNDS: <text>

========================
CRITICAL RULES

- DO NOT explain anything
- DO NOT add extra lines
- DO NOT rephrase laws
- DO NOT include anything outside judgement

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences`;

  try {
    showToast("Extracting title & legal grounds...", "info");
    const result = await callAI(prompt, 300);
    const titleMatch = result.match(/TITLE:\s*(.+)/i);
    const groundsMatch = result.match(/GROUNDS:\s*(.+)/i);
    
    await saveOrUpdateCase({
      judgement_output: judgement,
      status: "finalized",
      review_comment: null,
      case_title: titleMatch ? titleMatch[1].trim() : "Untitled Case",
      legal_grounds: groundsMatch ? groundsMatch[1].trim() : ""
    });
    
    $("wizStatus").value = "finalized";
    showToast("Case approved and finalized!", "success");
    await loadDashboardCounts();
    showDashboard();
  } catch (err) {
    showToast("Approve error: " + err.message, "error");
  }
});

// JUDGE SEND BACK FROM WIZARD
$("wizSendBackBtn").addEventListener("click", async () => {
  const judgement = $("judgementOutput").value.trim();
  const comment = prompt("Send back karne ki wajah / correction instructions likhein:");
  if (!comment) return;
  
  try {
    await saveOrUpdateCase({
      judgement_output: judgement,
      status: "pending",
      current_step: 5,
      review_comment: comment
    });
    
    $("wizStatus").value = "pending";
    showToast("Case Steno ko send back ho gaya!", "success");
    await loadDashboardCounts();
    showDashboard();
  } catch (err) {
    showToast("Send back error: " + err.message, "error");
  }
});

// FINALIZE: extract title + legal grounds, set status
$("finalizeBtn").addEventListener("click", async () => {
  const judgement = $("judgementOutput").value.trim();
  if (!judgement) return;
  const prompt = `You are a legal assistant for Pakistani Civil and Family Courts. Your task is to extract ONLY the case title and legal grounds from the given judgement.

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

- DO NOT:
  
  - Add extra facts
  - Add dates or locations
  - Use creative wording

========================
GROUNDS RULE (STRICT)

- Extract ONLY explicitly mentioned:
  
  - Laws
  - Ordinances
  - Sections

- If multiple are mentioned:
  
  - List all in one line, separated by commas

- If NO law or section is clearly mentioned:
  
  - Write:
    [Not specified in judgement]

- DO NOT guess or add legal provisions

========================
INPUT

Judgement:
${judgement}

========================
OUTPUT FORMAT (STRICT)

TITLE: <text>
GROUNDS: <text>

========================
CRITICAL RULES

- DO NOT explain anything
- DO NOT add extra lines
- DO NOT rephrase laws
- DO NOT include anything outside judgement

========================
STYLE

Plain text only
No markdown
No asterisks
No introductory or concluding sentences`;
  try {
    const result = await callAI(prompt, 300);
    const titleMatch = result.match(/TITLE:\s*(.+)/i);
    const groundsMatch = result.match(/GROUNDS:\s*(.+)/i);
    await saveOrUpdateCase({
      status: "finalized",
      case_title: titleMatch ? titleMatch[1].trim() : "Untitled Case",
      legal_grounds: groundsMatch ? groundsMatch[1].trim() : ""
    });
    $("wizStatus").value = "finalized";
    showToast("Case finalize ho gaya!", "success");
    await loadDashboardCounts();
  } catch (err) { showToast("Error: " + err.message, "error"); }
});

// ============================================
// CHAT REFINE
// ============================================
function addChatBubble(text, isUser) {
  const log = $("chatLog");
  const div = document.createElement("div");
  div.className = `p-2 rounded-lg text-sm max-w-[85%] ${isUser ? "chat-bubble-user ml-auto" : "chat-bubble-ai"}`;
  div.textContent = text; log.appendChild(div); log.scrollTop = log.scrollHeight;
}
$("chatSendBtn").addEventListener("click", sendChatMessage);
$("chatInput").addEventListener("keypress", (e) => { if (e.key === "Enter") sendChatMessage(); });
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
$("copyBtn").addEventListener("click", () => {
  navigator.clipboard.writeText($("judgementOutput").value);
  $("copyBtn").textContent = "Copied!"; setTimeout(() => $("copyBtn").textContent = "Copy", 1500);
});
$("downloadBtn").addEventListener("click", () => downloadAsWord($("judgementOutput").value));
function downloadAsWord(text) {
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset='utf-8'><title>Judgement</title></head>
  <body style="font-family:'Times New Roman'; font-size:14pt; line-height:1.6;">
    ${text.split("\n").map(p => `<p>${escapeHtml(p)}</p>`).join("")}
  </body></html>`;
  const blob = new Blob(['\ufeff', html], { type: "application/msword" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "judgement.doc"; link.click();
}

// ============================================
// LIVE MODE (presence + periodic sync)
// ============================================
$("liveModeToggle").addEventListener("click", async () => {
  liveModeOn = !liveModeOn;
  $("liveModeToggle").textContent = liveModeOn ? "🟢 Live: ON" : "🔴 Live: OFF";
  if (liveModeOn) await startLiveMode(); else await stopLiveMode();
});

async function startLiveMode() {
  if (!activeCase) return;
  await sb.from("live_sessions").upsert({ case_id: activeCase.id, active_user_id: currentProfile.id, active_user_name: currentProfile.full_name, last_ping: new Date().toISOString() });

  liveChannel = sb.channel(`case-${activeCase.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cases", filter: `id=eq.${activeCase.id}` }, (payload) => {
      if (payload.new.last_updated_by !== currentProfile.id) {
        ["plaint_text","facts_text","written_statement_text","admit_deny_text","issues_text","disputes_text","evidence_text","findings_text","short_order","judgement_output"].forEach((col, i) => {
          const ids = ["plaintText","factsText","wsText","admitDenyText","issuesText","disputesText","evidenceText","findingsText","shortOrder","judgementOutput"];
          if (document.activeElement.id !== ids[i] && payload.new[col] !== undefined) $(ids[i]).value = payload.new[col];
        });
        $("liveIndicator").textContent = `🟢 ${payload.new.last_updated_by === currentProfile.id ? "You" : "Other user"} updated this case just now`;
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
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (activeCase) await sb.from("live_sessions").delete().eq("case_id", activeCase.id).eq("active_user_id", currentProfile.id);
  $("liveIndicator").classList.add("hidden");
}

// ============================================
// REUSE FLOW
// ============================================
$("backFromReuseListBtn").addEventListener("click", showDashboard);
$("backFromReuseFormBtn").addEventListener("click", () => { hideAllScreens(); $("reuseScreen").classList.remove("hidden"); });

async function loadFinalizedForReuseSelection() {
  const { data: cases } = await sb.from("cases").select("*").eq("status", "finalized").order("updated_at", { ascending: false });
  const container = $("reuseListContainer");
  if (!cases || cases.length === 0) { container.innerHTML = `<p class="text-slate-400 text-sm">Koi finalized judgement nahi mili.</p>`; return; }
  container.innerHTML = cases.map(c => `
    <div class="bg-white rounded-xl shadow p-4 cursor-pointer reuse-select" data-id="${c.id}">
      <p class="font-semibold">${escapeHtml(c.case_title || c.category + " Case")}</p>
      <p class="text-xs text-slate-500">${escapeHtml(c.legal_grounds || "")}</p>
      <p class="text-xs text-slate-400 mt-1">${escapeHtml(c.category)}</p>
    </div>`).join("");
  document.querySelectorAll(".reuse-select").forEach(el => el.addEventListener("click", () => openReuseFlow(el.dataset.id)));
}

let reuseSourceCase = null;
let selectedCaseMode = "contested"; // "contested" or "ex_parte"
let wizardCreatedCaseId = null;
let currentWizStepIndex = 0;
let parsedSections = {}; // Stores original sections from template
let stepContents = {};   // Stores edited paragraph content for each step
let originalStepContents = {}; // Backup of stepContents for revert
let wizardSteps = [];    // Dynamic list of steps depending on mode

// Setup Mode buttons in HTML
function initReuseWizardModes() {
  const modeContested = $("modeContestedBtn");
  const modeExParte = $("modeExParteBtn");
  if (modeContested && modeExParte) {
    modeContested.addEventListener("click", () => {
      selectedCaseMode = "contested";
      modeContested.className = "flex-1 border-2 border-blue-600 bg-blue-50 text-blue-700 rounded-xl py-3 text-sm font-semibold";
      modeExParte.className = "flex-1 border-2 border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-semibold";
      updateStepsArray();
      updateWizardUI();
    });
    modeExParte.addEventListener("click", () => {
      selectedCaseMode = "ex_parte";
      modeExParte.className = "flex-1 border-2 border-blue-600 bg-blue-50 text-blue-700 rounded-xl py-3 text-sm font-semibold";
      modeContested.className = "flex-1 border-2 border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-semibold";
      updateStepsArray();
      updateWizardUI();
    });
  }
}

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
  
  // Reset wizard states
  selectedCaseMode = "contested";
  wizardCreatedCaseId = null;
  const modeContested = $("modeContestedBtn");
  const modeExParte = $("modeExParteBtn");
  if (modeContested && modeExParte) {
    modeContested.className = "flex-1 border-2 border-blue-600 bg-blue-50 text-blue-700 rounded-xl py-3 text-sm font-semibold";
    modeExParte.className = "flex-1 border-2 border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-semibold";
  }

  updateStepsArray();
  currentWizStepIndex = 0;
  
  $("reuseFieldsContainer").innerHTML = `<p class="text-sm text-slate-400">AI is analyzing template structure...</p>`;
  
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
  const fieldsPrompt = `Identify ONLY case-specific variable fields from the given judgement.
Return ONLY valid JSON array:
[{"label": "Plaintiff Name", "placeholder": "Ali Ahmed"}]

Judgement:
${source.judgement_output}`;

  try {
    const fieldsResult = await callAI(fieldsPrompt, 1500);
    const fieldsMatch = fieldsResult.match(/\[[\s\S]*\]/);
    const fields = fieldsMatch ? JSON.parse(fieldsMatch[0]) : [];
    renderReuseFields(fields);
  } catch (err) {
    renderReuseFields([]);
  }

  updateWizardUI();
}

function renderReuseFields(fields) {
  const container = $("reuseFieldsContainer");
  container.innerHTML = "";
  fields.forEach(f => addReuseFieldRow(f.label, f.placeholder));
  if (fields.length === 0) addReuseFieldRow("", "");
}

function addReuseFieldRow(label = "", placeholder = "") {
  const row = document.createElement("div");
  row.className = "reuse-field-row mb-3";
  row.innerHTML = `
    <input type="text" class="reuse-label w-full border rounded-lg p-2 text-sm font-medium mb-1 bg-white" value="${escapeHtml(label)}" placeholder="Field name (e.g., Plaintiff Name)" />
    <input type="text" class="reuse-value w-full border rounded-lg p-2 text-sm" placeholder="${escapeHtml(placeholder)}" />`;
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
      const variables = getFilledVariables();
      variables.forEach(v => {
        if (v.value) {
          // Replace matching placeholders or old variable occurrences (case-insensitive)
          const regex = new RegExp(escapeRegExp(v.label), "gi");
          sectionText = sectionText.replace(regex, v.value);
        }
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
    label: r.querySelector(".reuse-label").value.trim(),
    value: r.querySelector(".reuse-value").value.trim()
  })).filter(f => f.label);
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
    if (step.sectionKey === "plaintiff_evidence") payload.evidence_text = text;
    if (step.sectionKey === "defendant_evidence") payload.admit_deny_text = text;
    if (step.sectionKey === "findings_arguments") payload.findings_text = text;
  } else if (step.type === "final") {
    const text = $("reuseWizDecisionBox").value;
    payload.short_order = text;
  }
  
  payload.last_updated_by = currentProfile?.id;
  try {
    await sb.from("cases").update(payload).eq("id", wizardCreatedCaseId);
  } catch (err) {
    console.error("Auto-save to database failed:", err);
  }
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
      setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", true, "addReuseFieldBtn");
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
        setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", false, "addReuseFieldBtn");
        return;
      } finally {
        setBtnLoading("reuseWizNextBtn", "spin-reuseWizNext", false, "addReuseFieldBtn");
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

  const buildText = () => {
    let output = "";
    if (selectedCaseMode === "contested") {
      output = `PLANT/FACTS:\n${stepContents.plaint_facts || ""}\n\nWRITTEN STATEMENT:\n${stepContents.written_statement || ""}\n\nPLAINTIFF EVIDENCE:\n${stepContents.plaintiff_evidence || ""}\n\nDEFENDANT EVIDENCE:\n${stepContents.defendant_evidence || ""}\n\nFINDINGS & ARGUMENTS:\n${stepContents.findings_arguments || ""}`;
    } else {
      output = `PLANT/FACTS:\n${stepContents.plaint_facts || ""}\n\nPLAINTIFF EVIDENCE:\n${stepContents.plaintiff_evidence || ""}\n\nFINDINGS & ARGUMENTS:\n${stepContents.findings_arguments || ""}`;
    }
    return output;
  };

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
      status: "pending",
      current_step: 5
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

// Call on startup
document.addEventListener("DOMContentLoaded", () => {
  initReuseWizardModes();
});

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
$("templateUploadArea").addEventListener("dragover", (e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.background = "#eff6ff"; });
$("templateUploadArea").addEventListener("dragleave", (e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = ""; });
$("templateUploadArea").addEventListener("drop", async (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = "";
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
  const selectedDirective = selectedIdx !== "" ? directives[selectedIdx] : null;

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
13. CRITICAL TURN-TAKING RULE (Next Purpose specificity):
    - Carefully analyze today's proceeding text. If one party (e.g., plaintiff) has addressed arguments or produced evidence today, and the case is adjourned because the other party (e.g., defendant) sought an adjournment, the next purpose in the adjournment line (Rule 6) MUST reflect this turn-taking.
    - E.g., if plaintiff addressed arguments and defendant sought an adjournment, the next purpose in the adjournment line MUST be specific (e.g., "final arguments by/of the defendant" or "arguments of the defendant"), instead of just writing the generic case purpose "final arguments".
    - Apply this same specific logic if the defendant completed their turn and the plaintiff is to perform theirs on the next date.
${selectedDirective ? `12. MANDATORY CLAUSE: You MUST adapt and integrate this warning instruction: "${selectedDirective.text}"
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

$("owCopyBtn").addEventListener("click", () => {
  navigator.clipboard.writeText($("owOutput").value);
  $("owCopyBtn").textContent = "✅ Copied!";
  setTimeout(() => $("owCopyBtn").textContent = "📋 Copy", 1500);
});

// Send order to Steno 1
$("owSendStenoBtn").addEventListener("click", async () => {
  const text = $("owOutput").value.trim();
  const caseTitle = $("owCaseTitle").value.trim() || "Untitled Case";
  if (!text) return;
  $("owSendStenoBtn").disabled = true;
  try {
    const orderId = `order-steno-${Date.now()}`;
    const payload = JSON.stringify({
      case_title: caseTitle,
      order_text: text,
      sent_at: new Date().toISOString()
    });
    const { error } = await sb.from("live_notes").upsert({
      id: orderId,
      content: payload,
      updated_by: currentProfile?.id,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    showToast("Order Steno 1 ko send ho gaya!", "success");
  } catch (e) {
    showToast("Send error: " + e.message, "error");
  } finally {
    $("owSendStenoBtn").disabled = false;
  }
});

// Send order to Steno 2
$("owSendSteno2Btn").addEventListener("click", async () => {
  const text = $("owOutput").value.trim();
  const caseTitle = $("owCaseTitle").value.trim() || "Untitled Case";
  if (!text) return;
  $("owSendSteno2Btn").disabled = true;
  try {
    const orderId = `order-steno2-${Date.now()}`;
    const payload = JSON.stringify({
      case_title: caseTitle,
      order_text: text,
      sent_at: new Date().toISOString()
    });
    const { error } = await sb.from("live_notes").upsert({
      id: orderId,
      content: payload,
      updated_by: currentProfile?.id,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    showToast("Order Steno 2 ko send ho gaya!", "success");
  } catch (e) {
    showToast("Send error: " + e.message, "error");
  } finally {
    $("owSendSteno2Btn").disabled = false;
  }
});

let activeInboxKey = "";

async function openInbox(stenoKey) {
  activeInboxKey = stenoKey;
  $("owInboxTitle").textContent = stenoKey === "order-steno" ? "📥 Steno 1 Received Orders" : "📥 Steno 2 Received Orders";
  $("owInboxModal").classList.remove("hidden");
  await refreshInboxList();
}

async function refreshInboxList() {
  const listContainer = $("owInboxList");
  listContainer.innerHTML = `<p class="text-xs text-slate-400">Loading shared orders...</p>`;
  
  try {
    const { data, error } = await sb.from("live_notes")
      .select("*")
      .like("id", `${activeInboxKey}-%`);
      
    if (error) throw error;
    
    if (!data || data.length === 0) {
      listContainer.innerHTML = `<p class="text-xs text-slate-400">Koi shared order nahi mila.</p>`;
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
        <div class="bg-slate-50 border rounded-xl p-3" style="display:flex;flex-direction:column;gap:0.5rem;position:relative;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;">
            <div style="flex:1;">
              <p class="font-bold text-sm text-slate-800" style="margin:0;">${escapeHtml(order.case_title)}</p>
              <p class="text-[10px] text-slate-400" style="margin:2px 0 0 0;">Sent on ${dateStr} at ${timeStr}</p>
            </div>
            <button class="inbox-del-btn text-red-500 hover:text-red-700 font-bold text-sm" style="background:none;border:none;cursor:pointer;padding:0 5px;" data-id="${order.id}">✕</button>
          </div>
          <pre style="font-family:\'Times New Roman\', serif;font-size:0.85rem;white-space:pre-wrap;background:#fff;border:1px solid #e2e8f0;padding:0.5rem;border-radius:0.5rem;max-height:120px;overflow-y:auto;margin:0;line-height:1.4;">${escapeHtml(order.order_text)}</pre>
          <div style="display:flex;gap:0.5rem;">
            <button class="inbox-copy-btn bg-teal-600 text-white text-xs px-3 py-1.5 rounded font-semibold" style="border:none;cursor:pointer;" data-text="${escapeHtml(order.order_text)}">📋 Copy</button>
            <button class="inbox-load-btn bg-slate-700 text-white text-xs px-3 py-1.5 rounded font-semibold" style="border:none;cursor:pointer;" data-id="${order.id}" data-text="${escapeHtml(order.order_text)}">📥 Load to Editor</button>
          </div>
        </div>
      `;
    }).join("");
    
    listContainer.querySelectorAll(".inbox-del-btn").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("Is shared order ko inbox se clear kar dein?")) return;
        await sb.from("live_notes").delete().eq("id", btn.dataset.id);
        await refreshInboxList();
        showToast("Shared order cleared.", "success");
      };
    });
    
    listContainer.querySelectorAll(".inbox-copy-btn").forEach(btn => {
      btn.onclick = () => {
        navigator.clipboard.writeText(btn.dataset.text);
        btn.textContent = "✅ Copied!";
        setTimeout(() => btn.textContent = "📋 Copy", 1500);
        showToast("Order copied to clipboard!", "success");
      };
    });
    
    listContainer.querySelectorAll(".inbox-load-btn").forEach(btn => {
      btn.onclick = () => {
        $("owOutput").value = btn.dataset.text;
        $("owOutputSection").classList.remove("hidden");
        $("owInboxModal").classList.add("hidden");
        showToast("Order loaded into editor!", "success");
      };
    });
    
  } catch (e) {
    listContainer.innerHTML = `<p class="text-xs text-red-500">Error loading inbox: ${escapeHtml(e.message)}</p>`;
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
  $("owOutputSection").classList.add("hidden");
  $("owCaseTitle").focus();
});
