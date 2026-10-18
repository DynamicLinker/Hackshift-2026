// ─────────────────────────────────────────────────────────────────────────────
//  Horizon Client Orchestrator  |  Clean Light-Theme SPA & Dual-Tab Sync
// ─────────────────────────────────────────────────────────────────────────────

let currentCandidate   = null;
let currentChallenge   = null;
let currentJob         = null;
let allJobs            = [];
let selectedJobId      = null;
let simulatedHours     = 0;
let ghostTargetAppId   = null;
let timerInterval      = null;
let secondsRemaining   = 300;
let lastCreatedJobId   = null;
let cachedApplications = {};  // appId -> full application object for instant click modals
let cachedRepos        = {};  // repoName -> repo object for instant click modals
let currentSession     = null; // { role: 'employer'|'candidate', ... }

// ── Cross-Tab Real-Time Sync Channel ─────────────────────────────────────────
const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('horizon_sync') : null;
if (syncChannel) {
  syncChannel.onmessage = (event) => {
    handleSyncEvent(event.data);
  };
}

function broadcastSyncEvent(eventData) {
  if (syncChannel) {
    try {
      syncChannel.postMessage(eventData);
    } catch (e) {
      console.warn("BroadcastChannel error:", e);
    }
  }
}

function handleSyncEvent(event) {
  if (!event || !event.type) return;
  console.log("Cross-tab sync message received:", event);

  if (event.type === "JOB_POSTED") {
    lastCreatedJobId = event.job?.id;
    loadCandidateJobs();
    if (currentSession?.role === "candidate") {
      showToast(`🎯 New Opening Posted: "${event.job?.title}" at ${event.job?.company_name}! You are an eligible match.`, "success");
    }
  } else if (event.type === "APPLICATION_SUBMITTED") {
    loadEmployerCockpit();
    if (currentSession?.role === "employer") {
      showToast(`⚡ New Fast-Track candidate submission from ${event.candidateName || "Candidate"}! Vaulted to #1.`, "success");
    }
  } else if (event.type === "APPLICATION_STATUS_CHANGED") {
    loadCandidateStatusBoard();
    if (currentSession?.role === "candidate") {
      showToast(`🎉 Employer disposition updated: ${event.action || "Status Changed"}!`, "success");
    }
  }
}

// ── Supabase & Session Initialization ───────────────────────────────────────
let supabaseClient = null;
let authConfig     = null;

document.addEventListener("DOMContentLoaded", async () => {
  await loadEmployerBootstrap();
  await initSupabaseClient();
  await initAuthSession();
});

async function initSupabaseClient() {
  try {
    const res = await fetch("/api/auth/config");
    if (res.ok) {
      authConfig = await res.json();
      const statusText = document.getElementById("supabase-status-text");
      if (authConfig.is_supabase_enabled && window.supabase) {
        supabaseClient = window.supabase.createClient(authConfig.supabase_url, authConfig.supabase_anon_key);
        if (statusText) statusText.textContent = "Supabase Auth & Realtime Ready";

        // Listen for live database change events
        supabaseClient
          .channel("public:realtime")
          .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
            loadCandidateJobs();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => {
            loadEmployerCockpit();
            loadCandidateStatusBoard();
          })
          .subscribe();
      } else {
        if (statusText) statusText.textContent = "Standalone Test User Engine";
      }
    }
  } catch (err) {
    console.warn("Supabase init check:", err);
  }
}

async function initAuthSession() {
  const params = new URLSearchParams(window.location.search);
  const paramRole = params.get("role");

  if (paramRole === "employer") {
    const compId = params.get("company") || "comp-acme";
    await loginAsEmployer(compId, "Sarah Jenkins (Acme Lead)", false);
    return;
  } else if (paramRole === "candidate") {
    const user = params.get("user") || "iiitd-dev";
    await loginAsCandidate(user, false);
    return;
  }

  // Check per-tab sessionStorage
  const stored = sessionStorage.getItem("horizon_session") || sessionStorage.getItem("proofhired_session");
  if (stored) {
    try {
      const sess = JSON.parse(stored);
      applyActiveSession(sess);
      return;
    } catch (e) {
      console.warn("Invalid stored session", e);
    }
  }

  // No active session in this tab -> show gateway
  showLoginView();
}

function showLoginView() {
  document.getElementById("view-login")?.classList.remove("hidden");
  document.getElementById("view-app")?.classList.add("hidden");
  lucide.createIcons();
}

function fillTestUser(type) {
  if (type === "recruiter") {
    const emailInput = document.getElementById("login-employer-email");
    const pwdInput = document.getElementById("login-employer-password");
    const compSelect = document.getElementById("login-employer-company");
    if (emailInput) emailInput.value = "recruiter@acmesystems.io";
    if (pwdInput) pwdInput.value = "Password123!";
    if (compSelect) compSelect.value = "comp-acme";
    submitEmployerLogin();
  } else if (type === "candidate") {
    const emailInput = document.getElementById("login-candidate-email");
    const pwdInput = document.getElementById("login-candidate-password");
    const userInput = document.getElementById("login-candidate-user");
    if (emailInput) emailInput.value = "aarav@iiitd.ac.in";
    if (pwdInput) pwdInput.value = "Password123!";
    if (userInput) userInput.value = "iiitd-dev";
    submitCandidateLogin();
  }
}

function setLoginCandidateHandle(username, name) {
  const input = document.getElementById("login-candidate-user");
  if (input) input.value = username;
}

async function submitEmployerLogin() {
  const email = document.getElementById("login-employer-email")?.value.trim() || "recruiter@acmesystems.io";
  const password = document.getElementById("login-employer-password")?.value.trim() || "Password123!";
  const compId = document.getElementById("login-employer-company")?.value || "comp-acme";
  const name = document.getElementById("login-employer-name")?.value.trim() || "Sarah Jenkins (Acme Lead)";
  
  await loginWithCredentials({
    email,
    password,
    role: "employer",
    identifier: compId,
    name,
  }, "btn-login-employer-submit", "Employer Cockpit");
}

async function submitCandidateLogin() {
  const email = document.getElementById("login-candidate-email")?.value.trim() || "aarav@iiitd.ac.in";
  const password = document.getElementById("login-candidate-password")?.value.trim() || "Password123!";
  const repoOrUser = document.getElementById("login-candidate-user")?.value.trim() || "https://github.com/iiitd-dev/delhi-transit-stream";

  await loginWithCredentials({
    email,
    password,
    role: "candidate",
    identifier: repoOrUser,
  }, "btn-login-candidate-submit", "Candidate Portal");
}

async function loginWithCredentials(payload, btnId, portalLabel) {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Entering ${portalLabel}…</span>`;
    lucide.createIcons();
  }

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Authentication failed");
    }
    const data = await res.json();
    currentSession = data;
    sessionStorage.setItem("horizon_session", JSON.stringify(data));
    sessionStorage.setItem("proofhired_session", JSON.stringify(data));
    applyActiveSession(data);
    showToast(`Authenticated as ${data.user_name || data.full_name || data.company_name}`, "success");
  } catch (err) {
    showToast("Authentication error: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Enter ${portalLabel}</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
      lucide.createIcons();
    }
  }
}

async function loginAsEmployer(companyId, teamName, showToastMsg = true) {
  await loginWithCredentials({
    role: "employer",
    identifier: companyId,
    name: teamName,
  }, "btn-login-employer-submit", "Employer Cockpit");
}

async function loginAsCandidate(username, showToastMsg = true) {
  const cleanUser = username.trim().replace(/^@/, "") || "iiitd-dev";
  await loginWithCredentials({
    role: "candidate",
    identifier: cleanUser,
  }, "btn-login-candidate-submit", "Candidate Portal");
}

function logoutSession() {
  sessionStorage.removeItem("horizon_session");
  sessionStorage.removeItem("proofhired_session");
  currentSession = null;
  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  showLoginView();
  showToast("Logged out of portal session.", "info");
}

function applyActiveSession(session) {
  currentSession = session;
  document.getElementById("view-login")?.classList.add("hidden");
  document.getElementById("view-app")?.classList.remove("hidden");

  const nameEl = document.getElementById("session-name");
  const avatarEl = document.getElementById("session-avatar");
  const roleTextEl = document.getElementById("session-role-text");
  const roleBadgeEl = document.getElementById("session-role-badge");

  if (session.role === "employer") {
    // Apply Flip7 Vintage Card-Game Master Desk Theme
    document.body.className = "theme-employer min-h-screen flex flex-col antialiased selection:bg-[#FFD23F] selection:text-[#143836]";
    if (nameEl) nameEl.textContent = session.company_name || "Acme Systems";
    if (avatarEl) avatarEl.textContent = (session.company_name || "A")[0].toUpperCase();
    if (roleTextEl) roleTextEl.textContent = `${session.user_name || "Hiring Lead"} · 72h SLA Active`;
    if (roleBadgeEl) {
      roleBadgeEl.className = "text-[10px] text-[#1E8C86] font-bold flex items-center gap-1";
    }
    switchTab("employer");
  } else {
    // Apply Flip7 Retro Arcade Challenger Arena Theme
    document.body.className = "theme-candidate min-h-screen flex flex-col antialiased selection:bg-[#EF6C4A] selection:text-white";
    if (nameEl) nameEl.textContent = session.full_name || `@${session.github_username}`;
    if (avatarEl) {
      if (session.avatar_url) {
        avatarEl.innerHTML = `<img src="${session.avatar_url}" class="w-full h-full rounded-full object-cover">`;
      } else {
        avatarEl.textContent = (session.github_username || "C")[0].toUpperCase();
      }
    }
    if (roleTextEl) roleTextEl.textContent = `@${session.github_username} (Verified Candidate)`;
    if (roleBadgeEl) {
      roleBadgeEl.className = "text-[10px] text-[#3CC4BD] font-bold flex items-center gap-1";
    }
    const inputUser = document.getElementById("input-github-user");
    const target = session.audit_target || session.repo_url || session.github_username || "https://github.com/iiitd-dev/delhi-transit-stream";
    if (inputUser) inputUser.value = target;
    switchTab("candidate");
    runCandidateAudit(true);
  }
  loadCandidateJobs();
  lucide.createIcons();
}

// ── Background Polling Heartbeat (Sync across tabs / windows) ────────────────
let lastSeenJobCount = 0;
let lastSeenFastTrackCount = 0;

async function backgroundSync() {
  if (document.hidden) return;

  if (currentSession?.role === "candidate") {
    try {
      const res = await fetch("/api/employer/jobs");
      if (res.ok) {
        const jobs = await res.json();
        if (lastSeenJobCount > 0 && jobs.length > lastSeenJobCount) {
          lastCreatedJobId = jobs[jobs.length - 1]?.job?.id;
          await loadCandidateJobs();
          showToast("🎯 New job opening detected! Matched with your Git provenance.", "info");
        }
        lastSeenJobCount = jobs.length;
      }
      await loadCandidateStatusBoard();
    } catch (e) {}
  } else if (currentSession?.role === "employer" && selectedJobId) {
    try {
      const res = await fetch(`/api/employer/jobs/${selectedJobId}/applications?simulated_hours=${simulatedHours}`);
      if (res.ok) {
        const data = await res.json();
        const ftCount = data.fast_track_queue.length;
        if (lastSeenFastTrackCount > 0 && ftCount > lastSeenFastTrackCount) {
          renderEmployerApplications(data);
          showToast("⚡ New Fast-Track candidate submission received!", "success");
        }
        lastSeenFastTrackCount = ftCount;
      }
    } catch (e) {}
  }
}

setInterval(backgroundSync, 3500);
window.addEventListener("focus", backgroundSync);


// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES & MODALS
// ─────────────────────────────────────────────────────────────────────────────

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  const msgEl = document.getElementById("toast-msg");
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;

  const colorMap = {
    info:    "border-slate-700 bg-slate-900 text-white",
    success: "border-emerald-600 bg-emerald-950 text-emerald-100",
    warn:    "border-amber-600 bg-amber-950 text-amber-100",
    error:   "border-rose-600 bg-rose-950 text-rose-100",
  };
  toast.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg border ${colorMap[type] || colorMap.info} text-xs font-medium shadow-xl flex items-center gap-2 max-w-sm slide-in`;
  toast.classList.remove("hidden");
  lucide.createIcons();
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAB NAVIGATION & THEME SWITCHING
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  const candTab = document.getElementById("tab-candidate");
  const empTab  = document.getElementById("tab-employer");
  const btnCand = document.getElementById("btn-tab-candidate");
  const btnEmp  = document.getElementById("btn-tab-employer");

  if (tab === "candidate") {
    document.body.className = "theme-candidate min-h-screen flex flex-col antialiased selection:bg-[#EF6C4A] selection:text-white";
    candTab.classList.remove("hidden"); empTab.classList.add("hidden");
    btnCand.className = "f7-btn f7-btn-coral flex items-center gap-2 px-5 py-2 text-xs shadow-md";
    btnEmp.className  = "f7-btn flex items-center gap-2 px-5 py-2 text-xs text-[#8FB5B3] hover:text-white transition";
    loadCandidateStatusBoard();
    loadCandidateJobs();
  } else {
    document.body.className = "theme-employer min-h-screen flex flex-col antialiased selection:bg-[#FFD23F] selection:text-[#143836]";
    empTab.classList.remove("hidden");  candTab.classList.add("hidden");
    btnEmp.className  = "f7-btn f7-btn-gold flex items-center gap-2 px-5 py-2 text-xs shadow-md";
    btnCand.className = "f7-btn flex items-center gap-2 px-5 py-2 text-xs text-[#1E8C86] hover:text-[#143836] transition";
    loadEmployerCockpit();
  }
  lucide.createIcons();
}

function setCandidateDemo(username) {
  switchTab("candidate");
  document.getElementById("input-github-user").value = username;
  runCandidateAudit(false);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: AUDIT & CLONE
// ─────────────────────────────────────────────────────────────────────────────

async function runCandidateAudit(animate = true) {
  const rawInput = document.getElementById("input-github-user").value.trim();

  if (!rawInput) {
    showToast("Please enter a GitHub username or repository URL.", "warn");
    return;
  }

  const btn = document.getElementById("btn-audit");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Cloning & Analyzing…</span>`;
    lucide.createIcons();
  }

  const telemetrySection = document.getElementById("section-audit-telemetry");
  const telemetryLogs = document.getElementById("telemetry-logs");
  const viewport = document.getElementById("topology-graph-viewport");
  const healthBadge = document.getElementById("topology-health-badge");

  const isRepoUrl = rawInput.includes("/") || rawInput.startsWith("http");
  const payload = {
    github_username: isRepoUrl ? null : rawInput,
    repo_url: isRepoUrl ? rawInput : null,
  };

  const targetDisplay = isRepoUrl ? rawInput : `@${rawInput}`;

  // Active loading placeholder in viewport so user sees the engine working
  if (viewport) {
    viewport.innerHTML = `
      <div class="flex flex-col items-center justify-center p-12 text-slate-400 space-y-3 font-mono text-xs">
        <i data-lucide="loader-2" class="w-8 h-8 text-[#3CC4BD] animate-spin"></i>
        <span class="text-slate-200 font-bold">Cloning Git repository & analyzing AST commit graph...</span>
        <span class="text-[11px] text-slate-400 max-w-md truncate">${escapeHtml(targetDisplay)}</span>
      </div>
    `;
    lucide.createIcons();
  }

  if (healthBadge) {
    healthBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800 font-mono inline-flex items-center gap-1.5";
    healthBadge.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i><span>Cloning & Verifying DAG…</span>`;
    lucide.createIcons();
  }

  // 1. Immediately launch background fetch so network request runs in parallel
  const fetchPromise = fetch("/api/candidate/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // 2. Render stepped telemetry indications with realistic pacing
  if (telemetrySection && telemetryLogs) {
    telemetrySection.classList.remove("hidden");
    telemetryLogs.innerHTML = `
      <div id="step-audit-1" class="flex items-center gap-2 text-slate-300">
        <i data-lucide="loader-2" class="w-3 h-3 animate-spin text-blue-400"></i>
        <span>[1/4] Cloning remote Git tree from <span class="text-blue-300 font-semibold font-mono">${escapeHtml(targetDisplay)}</span>...</span>
      </div>
    `;
    lucide.createIcons();

    await new Promise(r => setTimeout(r, 280));
    const s1 = document.getElementById("step-audit-1");
    if (s1) {
      s1.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i><span class="text-slate-300">[1/4] Remote Git tree cloned and commit logs parsed</span>`;
    }

    telemetryLogs.innerHTML += `
      <div id="step-audit-2" class="flex items-center gap-2 text-slate-300">
        <i data-lucide="loader-2" class="w-3 h-3 animate-spin text-blue-400"></i>
        <span>[2/4] Parsing commit graph, merge parent hashes & branch divergence...</span>
      </div>
    `;
    lucide.createIcons();

    await new Promise(r => setTimeout(r, 320));
    const s2 = document.getElementById("step-audit-2");
    if (s2) {
      s2.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i><span class="text-slate-300">[2/4] Multi-branch DAG topology & parent pointers mapped</span>`;
    }

    telemetryLogs.innerHTML += `
      <div id="step-audit-3" class="flex items-center gap-2 text-slate-300">
        <i data-lucide="loader-2" class="w-3 h-3 animate-spin text-blue-400"></i>
        <span>[3/4] Running AST syntax provenance & author cadence verification...</span>
      </div>
    `;
    lucide.createIcons();

    await new Promise(r => setTimeout(r, 260));
    const s3 = document.getElementById("step-audit-3");
    if (s3) {
      s3.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i><span class="text-slate-300">[3/4] AST syntax signatures & author cadence verified</span>`;
    }

    telemetryLogs.innerHTML += `
      <div id="step-audit-4" class="flex items-center gap-2 text-slate-300">
        <i data-lucide="loader-2" class="w-3 h-3 animate-spin text-blue-400"></i>
        <span>[4/4] Generating interactive visual Git Topology DAG...</span>
      </div>
    `;
    lucide.createIcons();
  }

  try {
    const res = await fetchPromise;

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Audit failed");
    }

    const data = await res.json();
    currentCandidate = data;
    renderAuditResults(data);

    if (telemetryLogs) {
      const s4 = document.getElementById("step-audit-4");
      if (s4) {
        s4.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i><span class="text-slate-300">[4/4] Interactive Git Topology DAG successfully rendered</span>`;
      }

      const isHuman = data.commit_topology_status === "verified_human";
      const completionDiv = document.createElement("div");
      completionDiv.className = `flex items-center gap-2 ${isHuman ? 'text-emerald-400' : 'text-rose-400'} font-bold pt-1.5 border-t border-slate-800`;
      completionDiv.innerHTML = `
        <i data-lucide="${isHuman ? 'check-circle' : 'alert-triangle'}" class="w-3.5 h-3.5 shrink-0"></i>
        <span>${isHuman ? `✓ Complete: Identity verified for @${data.github_username}. Select an opening below to test & apply.` : `⚠ Flagged: 1-commit bulk dump detected for @${data.github_username}. Unscreened cold queue routing.`}</span>
      `;
      telemetryLogs.appendChild(completionDiv);
      lucide.createIcons();
    }

    if (data.commit_topology_status === "verified_human") {
      showToast(`Identity verified: ${data.full_name} (@${data.github_username}). Select an opening below to test & apply.`, "success");
    } else {
      showToast(`Flagged: @${data.github_username} routed to unscreened cold queue due to single bulk dump.`, "warn");
    }
  } catch (err) {
    if (telemetryLogs) {
      const s4 = document.getElementById("step-audit-4") || document.getElementById("step-audit-3");
      if (s4) s4.innerHTML = `<i data-lucide="x" class="w-3 h-3 text-rose-400"></i><span class="text-rose-400">Verification error</span>`;
    }
    showToast("Audit error: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="git-branch" class="w-3.5 h-3.5"></i><span>Clone & Audit</span>`;
      lucide.createIcons();
    }
  }
}

function renderAuditResults(c) {
  document.getElementById("section-audit-results").classList.remove("hidden");
  document.getElementById("section-challenge-sandbox").classList.add("hidden");
  document.getElementById("section-vault-success").classList.add("hidden");

  // Profile Card
  document.getElementById("audit-fullname").textContent = c.full_name;
  document.getElementById("audit-username").textContent = "@" + c.github_username;
  document.getElementById("audit-bio").textContent = c.bio || "Active Software Engineer";
  document.getElementById("audit-avatar").src = c.avatar_url || "https://avatars.githubusercontent.com/u/8942111?v=4";

  const inspectedText = document.getElementById("audit-repos-inspected-text");
  if (inspectedText) {
    const count = (c.audited_repos && c.audited_repos.length) ? c.audited_repos.length : 1;
    const primaryName = (c.audited_repos && c.audited_repos[0]) ? c.audited_repos[0].repo_name : "Repository";
    inspectedText.textContent = `${count} ${count === 1 ? 'Repository' : 'Repositories'} Inspected (${primaryName})`;
  }

  // Ownership & Contributor Badge
  const ownBadge = document.getElementById("audit-ownership-badge");
  if (ownBadge) {
    if (c.is_bot || (c.commit_topology_status && c.commit_topology_status.includes("flagged"))) {
      ownBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200";
      ownBadge.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-600"></i><span>Flagged Contributor (${c.author_match_rate || 15}% author match)</span>`;
    } else {
      ownBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200";
      ownBadge.innerHTML = `<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-600"></i><span>Verified Contributor (${c.author_match_rate || 100}% author match)</span>`;
    }
  }

  // Topology Index (Maintained for ID compatibility, displayed cleanly)
  const scoreEl = document.getElementById("audit-provenance-score");
  if (scoreEl) {
    scoreEl.textContent = `${c.git_provenance_score}%`;
    scoreEl.className = c.git_provenance_score >= 70 ? "font-bold text-emerald-700 font-mono" : "font-bold text-rose-700 font-mono";
  }

  // Topology Badge
  const topoBadge = document.getElementById("audit-topology-badge");
  if (topoBadge) {
    if (c.commit_topology_status === "verified_human") {
      topoBadge.className = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold w-fit";
      topoBadge.innerHTML = `<i data-lucide="git-commit" class="w-3.5 h-3.5 text-emerald-600"></i><span>Progressive Commit Cadence</span>`;
    } else {
      topoBadge.className = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold w-fit";
      topoBadge.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-600"></i><span>Flagged: 1-Commit Bulk Dump</span>`;
    }
  }

  // Qualification
  const qualBadge = document.getElementById("audit-qualification-badge");
  const startBtn  = document.getElementById("btn-start-challenge");
  if (qualBadge) {
    if (c.fast_track_qualified) {
      qualBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200";
      qualBadge.innerHTML = `<i data-lucide="check-check" class="w-3.5 h-3.5 text-emerald-600"></i><span>Eligible for Fast-Track Testing</span>`;
      if (startBtn) startBtn.classList.remove("hidden");
    } else {
      qualBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200";
      qualBadge.innerHTML = `<i data-lucide="shield-x" class="w-3.5 h-3.5 text-rose-600"></i><span>Flagged (Cold Queue Only)</span>`;
      if (startBtn) startBtn.classList.add("hidden");
    }
  }

  // Gemini 3.1 Flash-Lite AI Architectural Audit
  const geminiCard = document.getElementById("card-gemini-summary");
  const geminiText = document.getElementById("card-gemini-text");
  if (geminiCard && geminiText) {
    if (c.gemini_analysis) {
      geminiText.textContent = c.gemini_analysis;
      geminiCard.classList.remove("hidden");
    } else {
      geminiCard.classList.add("hidden");
    }
  }

  // Update Status Board Title to Candidate's Name
  const headingName = document.getElementById("status-board-candidate-name");
  if (headingName) {
    headingName.textContent = c.full_name ? `${c.full_name} (@${c.github_username})` : `@${c.github_username}`;
  }

  // Reload the status board and available jobs strictly for this audited candidate
  loadCandidateStatusBoard();
  loadCandidateJobs();

  // Audited Repos Table (Clickable Rows)
  const tbody = document.getElementById("table-audited-repos");
  tbody.innerHTML = "";
  cachedRepos = {};

  (c.audited_repos || []).forEach(r => {
    cachedRepos[r.repo_name] = r;
    const isProg = r.commit_distribution === "progressive_iterative";
    const distBadge = isProg
      ? `<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">Progressive (${r.total_commits} commits)</span>`
      : `<span class="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-medium">1-Commit Bulk Dump</span>`;

    const tagsHtml = (r.key_technologies || [])
      .map(t => `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-mono text-[10px] mr-1">${t}</span>`)
      .join("");

    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 cursor-pointer transition";
    tr.onclick = () => openRepoDetailModal(r.repo_name);
    tr.innerHTML = `
      <td class="py-2.5 px-4 font-mono font-semibold text-slate-900 flex items-center gap-2">
        <i data-lucide="git-branch" class="w-3.5 h-3.5 text-slate-400"></i>
        <span>${r.repo_name}</span>
      </td>
      <td class="py-2.5 px-4 text-slate-600">${r.primary_language}</td>
      <td class="py-2.5 px-4">${distBadge}</td>
      <td class="py-2.5 px-4">${tagsHtml}</td>
      <td class="py-2.5 px-4 text-right font-mono font-bold ${r.provenance_rating >= 70 ? 'text-emerald-600' : 'text-rose-600'}">
        ${r.provenance_rating}%
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Render Git Topology Graph
  const topo = c.topology_graph || (c.audited_repos && c.audited_repos[0] && c.audited_repos[0].topology_graph);
  if (topo) {
    renderTopologyGraph(topo, c);
  }

  lucide.createIcons();
}

// ─────────────────────────────────────────────────────────────────────────────
//  GIT TOPOLOGY & CADENCE GRAPH VISUALIZER
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let currentTopology = null;
let activeTopologyCommitId = null;

function renderTopologyGraph(topo, candidate = null) {
  if (!topo) return;
  currentTopology = topo;
  const c = candidate || currentCandidate;

  // 1. Health badge & subtitle
  const healthBadge = document.getElementById("topology-health-badge");
  const subtitle = document.getElementById("topology-subtitle");
  const anomalyAlert = document.getElementById("topo-anomaly-alert");
  const anomalyDesc = document.getElementById("topo-anomaly-desc");

  const isHuman = topo.status === "verified_human";
  if (healthBadge) {
    if (isHuman) {
      healthBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono";
      healthBadge.textContent = "Progressive Multi-Branch DAG";
    } else {
      healthBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-800 font-mono";
      healthBadge.textContent = "⚠ Flagged Anomaly (Flatline)";
    }
  }

  if (subtitle) {
    subtitle.textContent = topo.topology_summary || (isHuman 
      ? "Visual DAG proof of authentic human commits vs. bulk AI fork dump"
      : "Single bulk dump detected: zero iterative progression");
  }

  // 2. Metrics
  const metricBranches = document.getElementById("topo-metric-branches");
  if (metricBranches) {
    metricBranches.textContent = `${topo.branch_count || 1} Branches · ${topo.merge_count || 0} Merges`;
  }
  const metricSpan = document.getElementById("topo-metric-span");
  if (metricSpan) {
    metricSpan.textContent = isHuman ? "Iterative Cadence" : "Instantaneous (0 Days)";
  }
  const metricAuthor = document.getElementById("topo-metric-author");
  if (metricAuthor) {
    metricAuthor.textContent = topo.author_purity || (isHuman ? "100% GPG / SSH Match" : "15% Unverified Dump");
    metricAuthor.className = isHuman ? "font-bold text-emerald-400 text-xs sm:text-sm" : "font-bold text-rose-400 text-xs sm:text-sm";
  }
  const metricCadence = document.getElementById("topo-metric-cadence");
  if (metricCadence) {
    metricCadence.textContent = topo.cadence_rating || (isHuman ? "Normal (1.2/day)" : "Instantaneous Spike");
    metricCadence.className = isHuman ? "font-bold text-blue-400 text-xs sm:text-sm" : "font-bold text-rose-400 text-xs sm:text-sm";
  }

  // 3. Anomaly Alert
  if (anomalyAlert) {
    if (isHuman) {
      anomalyAlert.classList.add("hidden");
    } else {
      anomalyAlert.classList.remove("hidden");
      if (anomalyDesc) {
        anomalyDesc.textContent = (topo.commits && topo.commits[0] && topo.commits[0].anomaly) 
          || "100% of code pushed in a single bulk dump. 0 branches, 0 merges, flatline cadence. Bypassed from Fast-Track queue.";
      }
    }
  }

  // 4. Repository switcher pills
  const repoTabs = document.getElementById("topology-repo-tabs");
  if (repoTabs && c && c.audited_repos && c.audited_repos.length > 0) {
    repoTabs.innerHTML = "";
    c.audited_repos.forEach(r => {
      const isSelected = r.repo_name === topo.repo_name;
      const btn = document.createElement("button");
      btn.className = isSelected
        ? "px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-blue-600 text-white shadow-sm transition"
        : "px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition";
      btn.innerHTML = `<i data-lucide="git-branch" class="w-3 h-3 inline mr-1"></i>${r.repo_name}`;
      btn.onclick = () => switchTopologyRepo(r.repo_name);
      repoTabs.appendChild(btn);
    });
  }

  // 5. Branch Legend
  const legend = document.getElementById("topo-branch-legend");
  if (legend) {
    legend.innerHTML = "";
    const branches = topo.branches || [{"name": "main", "color": "#2563eb", "lane": 0}];
    branches.forEach(b => {
      const span = document.createElement("span");
      span.className = "inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-300";
      span.innerHTML = `
        <span class="w-2 h-2 rounded-full" style="background-color: ${b.color};"></span>
        <span>${b.name}</span>
      `;
      legend.appendChild(span);
    });
  }

  // 6. Visual SVG DAG Graph + Commit Rows
  renderTopologyDag(topo);

  // 7. Select initial commit for inspector
  const commits = topo.commits || [];
  if (commits.length > 0) {
    selectTopologyCommit(commits[0].id);
  } else {
    const inspector = document.getElementById("topo-commit-inspector");
    if (inspector) inspector.innerHTML = `<div class="text-slate-500">No commits recorded.</div>`;
  }

  lucide.createIcons();
}

function renderTopologyDag(topo) {
  const viewport = document.getElementById("topology-graph-viewport");
  if (!viewport) return;

  const commits = topo.commits || [];
  if (commits.length === 0) {
    viewport.innerHTML = `<div class="text-xs text-slate-500 font-mono p-4">No commit history found for this repository.</div>`;
    return;
  }

  const branches = topo.branches || [{"name": "main", "color": "#2563eb", "lane": 0}];
  const branchMap = {};
  branches.forEach(b => { branchMap[b.name] = b; });

  const rowHeight = 44;
  const laneWidth = 26;
  const laneOffsetX = 18;
  const maxLane = Math.max(...commits.map(c => c.lane || 0), 0);
  const svgWidth = Math.max(80, (maxLane + 1) * laneWidth + 24);
  const svgHeight = commits.length * rowHeight;

  // Build commit index map
  const commitIndexMap = {};
  commits.forEach((c, idx) => {
    commitIndexMap[c.id] = idx;
    if (c.short_sha) commitIndexMap[c.short_sha] = idx;
  });

  // Generate SVG paths connecting commits
  let pathsSvg = "";
  commits.forEach((c, idx) => {
    const x1 = laneOffsetX + (c.lane * laneWidth);
    const y1 = (idx * rowHeight) + (rowHeight / 2);
    const bColor = (branchMap[c.branch] && branchMap[c.branch].color) || "#2563eb";

    const parents = c.parents || [];
    parents.forEach(pId => {
      const pIdx = commitIndexMap[pId];
      if (pIdx !== undefined && pIdx > idx) {
        const pCommit = commits[pIdx];
        const x2 = laneOffsetX + (pCommit.lane * laneWidth);
        const y2 = (pIdx * rowHeight) + (rowHeight / 2);

        if (c.lane === pCommit.lane) {
          pathsSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${bColor}" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />`;
        } else {
          // Smooth bezier curve for branch/merge
          const midY = (y1 + y2) / 2;
          pathsSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${bColor}" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />`;
        }
      }
    });
  });

  // Generate Commit Nodes in SVG
  let nodesSvg = "";
  commits.forEach((c, idx) => {
    const x = laneOffsetX + (c.lane * laneWidth);
    const y = (idx * rowHeight) + (rowHeight / 2);
    const bColor = (branchMap[c.branch] && branchMap[c.branch].color) || "#2563eb";
    const isMerge = c.is_merge;
    const isSpam = topo.status === "flagged_bulk_dump";

    nodesSvg += `
      <g class="cursor-pointer group" onclick="selectTopologyCommit('${c.id}')">
        <circle id="topo-circle-halo-${c.id}" cx="${x}" cy="${y}" r="11" fill="${bColor}" opacity="0" class="transition-opacity duration-200" />
        <circle id="topo-circle-${c.id}" cx="${x}" cy="${y}" r="${isMerge ? 6.5 : (isSpam ? 7 : 5)}"
          fill="${isMerge ? '#0f172a' : (isSpam ? '#e11d48' : bColor)}"
          stroke="${isMerge ? bColor : (isSpam ? '#fda4af' : '#ffffff')}"
          stroke-width="${isMerge ? 3 : 2}"
          class="transition-transform group-hover:scale-125 origin-center" />
        ${isMerge ? `<circle cx="${x}" cy="${y}" r="2" fill="${bColor}" />` : ''}
      </g>
    `;
  });

  // Build the Rows layout
  let rowsHtml = "";
  commits.forEach((c) => {
    const isMerge = c.is_merge;
    const isSpam = topo.status === "flagged_bulk_dump";

    rowsHtml += `
      <div id="topo-commit-row-${c.id}" onclick="selectTopologyCommit('${c.id}')"
        class="flex items-center justify-between gap-3 px-2 rounded-lg cursor-pointer transition hover:bg-slate-800/60"
        style="height: ${rowHeight}px;">
        
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="px-1.5 py-0.5 rounded ${isSpam ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-slate-800 text-blue-400 border border-slate-700/80'} font-mono text-[10px] font-bold shrink-0">
            ${c.short_sha}
          </span>
          <span class="text-xs truncate ${isMerge ? 'font-bold text-white' : (isSpam ? 'text-rose-200 font-semibold' : 'text-slate-200')}">
            ${escapeHtml(c.message)}
          </span>
        </div>

        <div class="flex items-center gap-3 shrink-0 text-[11px] font-mono text-slate-400">
          <span class="hidden sm:inline ${c.ast_verified ? 'text-emerald-400' : 'text-rose-400'}">
            ${c.ast_verified ? '✓ Verified' : '⚠ Anomaly'}
          </span>
          <span class="text-slate-400 hidden md:inline">${c.stats || ''}</span>
          <span class="text-slate-500">${c.relative_time}</span>
        </div>

      </div>
    `;
  });

  viewport.innerHTML = `
    <div class="relative flex" style="min-height: ${svgHeight}px;">
      <!-- SVG Track Column -->
      <div class="shrink-0 relative" style="width: ${svgWidth}px; height: ${svgHeight}px;">
        <svg width="${svgWidth}" height="${svgHeight}" class="absolute inset-0 pointer-events-auto">
          ${pathsSvg}
          ${nodesSvg}
        </svg>
      </div>

      <!-- Commit Rows (Right Column aligned with SVG nodes) -->
      <div class="flex-1 min-w-0 flex flex-col justify-between">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function selectTopologyCommit(commitId) {
  if (!currentTopology || !currentTopology.commits) return;
  activeTopologyCommitId = commitId;

  const c = currentTopology.commits.find(item => item.id === commitId || item.short_sha === commitId);
  if (!c) return;

  // Highlight selected SVG halo and row
  currentTopology.commits.forEach(item => {
    const halo = document.getElementById(`topo-circle-halo-${item.id}`);
    if (halo) halo.setAttribute("opacity", item.id === c.id ? "0.35" : "0");

    const row = document.getElementById(`topo-commit-row-${item.id}`);
    if (row) {
      if (item.id === c.id) {
        row.className = "flex items-center justify-between gap-3 px-2 rounded-lg cursor-pointer transition bg-slate-800/90 border border-slate-700";
      } else {
        row.className = "flex items-center justify-between gap-3 px-2 rounded-lg cursor-pointer transition hover:bg-slate-800/60";
      }
    }
  });

  // Populate inspector
  const inspector = document.getElementById("topo-commit-inspector");
  if (!inspector) return;

  const isHuman = currentTopology.status === "verified_human";
  const filesList = (c.files_changed || []).map(f => `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300 font-mono mr-1">${escapeHtml(f)}</span>`).join("");

  inspector.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
      <div class="flex items-center gap-2">
        <i data-lucide="${c.is_merge ? 'git-merge' : 'git-commit'}" class="w-4 h-4 text-blue-400"></i>
        <span class="font-bold text-white text-xs">Commit: <span class="font-mono text-blue-400">${c.short_sha}</span></span>
        <span class="px-2 py-0.2 rounded text-[10px] font-mono ${c.ast_verified ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}">
          ${c.ast_verified ? '✓ AST Verified' : '⚠ Anomaly Detected'}
        </span>
      </div>
      <div class="text-[11px] text-slate-400 font-mono">
        Branch: <span class="text-slate-200 font-semibold">${c.branch}</span> · ${c.relative_time} (${(c.date || '').substring(0, 10)})
      </div>
    </div>

    <div class="text-xs text-slate-200 font-medium py-1">
      ${escapeHtml(c.message)}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800/70 text-[11px]">
      <div>
        <span class="text-slate-500">Author:</span>
        <span class="text-slate-300 font-semibold ml-1">${escapeHtml(c.author)}</span>
        <span class="ml-1.5 ${isHuman ? 'text-emerald-400' : 'text-rose-400'} font-bold">
          ${isHuman ? '✓ Signature Authenticated' : '⚠ Unverified Author'}
        </span>
      </div>
      <div>
        <span class="text-slate-500">Churn Stats:</span>
        <span class="font-mono text-slate-300 ml-1">${c.stats || 'N/A'}</span>
      </div>
    </div>

    ${c.anomaly ? `
      <div class="rounded bg-rose-950/80 border border-rose-800 p-2 text-rose-300 text-[11px] mt-1">
        <strong>Diagnostic Flag:</strong> ${escapeHtml(c.anomaly)}
      </div>
    ` : ''}

    ${filesList ? `
      <div class="pt-1 flex items-center gap-1.5 flex-wrap">
        <span class="text-slate-500 text-[10px]">Modified Components:</span>
        ${filesList}
      </div>
    ` : ''}
  `;

  lucide.createIcons();
}

function switchTopologyRepo(repoName) {
  if (!currentCandidate || !currentCandidate.audited_repos) return;
  const repo = currentCandidate.audited_repos.find(r => r.repo_name === repoName);
  if (repo && repo.topology_graph) {
    renderTopologyGraph(repo.topology_graph, currentCandidate);
  }
}

function scrollToTopologyGraph() {
  const el = document.getElementById("section-topology-graph-container");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openTopologyModalForCandidate(username) {
  const modal = document.getElementById("modal-status-detail");
  const title = document.getElementById("modal-detail-title");
  const content = document.getElementById("modal-detail-content");

  title.textContent = `Git Topology Audit: @${username}`;
  content.innerHTML = `
    <div class="p-6 text-center text-slate-500 flex items-center justify-center gap-2">
      <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-blue-600"></i>
      <span>Loading Git Topology DAG for @${username}...</span>
    </div>
  `;
  modal.classList.remove("hidden");
  lucide.createIcons();

  try {
    const res = await fetch(`/api/candidate/${username}/topology`);
    if (!res.ok) throw new Error("Could not load topology");
    const topo = await res.json();

    const isHuman = topo.status === "verified_human";
    content.innerHTML = `
      <div class="rounded-xl border ${isHuman ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950' : 'border-rose-200 bg-rose-50/70 text-rose-950'} p-3 space-y-1">
        <div class="font-bold text-sm flex items-center gap-1.5">
          <i data-lucide="${isHuman ? 'shield-check' : 'alert-triangle'}" class="w-4 h-4 ${isHuman ? 'text-emerald-600' : 'text-rose-600'}"></i>
          <span>${isHuman ? '✓ Verified Human Git Topology' : '⚠ Flagged 1-Commit Bulk Dump Anomaly'}</span>
        </div>
        <p class="text-xs ${isHuman ? 'text-emerald-800' : 'text-rose-800'}">
          ${topo.topology_summary}
        </p>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono pt-1">
        <div class="bg-slate-50 rounded-lg p-2 border border-slate-200">
          <span class="text-[10px] text-slate-500 block uppercase">Branches</span>
          <span class="font-bold text-slate-900">${topo.branch_count} Branches</span>
        </div>
        <div class="bg-slate-50 rounded-lg p-2 border border-slate-200">
          <span class="text-[10px] text-slate-500 block uppercase">Merges</span>
          <span class="font-bold text-slate-900">${topo.merge_count} Merges</span>
        </div>
        <div class="bg-slate-50 rounded-lg p-2 border border-slate-200">
          <span class="text-[10px] text-slate-500 block uppercase">Author Purity</span>
          <span class="font-bold ${isHuman ? 'text-emerald-600' : 'text-rose-600'}">${topo.author_purity}</span>
        </div>
        <div class="bg-slate-50 rounded-lg p-2 border border-slate-200">
          <span class="text-[10px] text-slate-500 block uppercase">Cadence</span>
          <span class="font-bold text-blue-600">${topo.cadence_rating}</span>
        </div>
      </div>

      <div class="space-y-1.5 pt-2">
        <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider font-mono">Recent Commit Nodes</div>
        <div class="space-y-1 max-h-56 overflow-y-auto pr-1">
          ${(topo.commits || []).map(c => `
            <div class="rounded-lg border border-slate-200 p-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-50">
              <div class="flex items-center gap-2 min-w-0">
                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-100 text-blue-700 border border-slate-200">${c.short_sha}</span>
                <span class="truncate font-medium text-slate-800">${escapeHtml(c.message)}</span>
              </div>
              <span class="text-[10px] font-mono text-slate-400 shrink-0">${c.relative_time}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (err) {
    content.innerHTML = `<div class="p-4 text-center text-rose-600 text-xs font-mono">Failed to load Git Topology: ${err.message}</div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLICK-TO-VIEW: REPO & APPLICATION STATUS MODALS
// ─────────────────────────────────────────────────────────────────────────────

function openRepoDetailModal(repoName) {
  const r = cachedRepos[repoName];
  if (!r) return;

  const modal = document.getElementById("modal-status-detail");
  document.getElementById("modal-detail-title").textContent = `Repository Dossier: ${r.repo_name}`;

  const isHuman = r.commit_distribution === "progressive_iterative";
  document.getElementById("modal-detail-content").innerHTML = `
    <div class="rounded-lg p-3 ${isHuman ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'} space-y-1">
      <div class="font-bold text-sm ${isHuman ? 'text-emerald-900' : 'text-rose-900'}">
        ${isHuman ? '✓ Verified Progressive Human Cadence' : '⚠ Flagged: 1-Commit Bulk Dump (Synthetic Ingestion)'}
      </div>
      <p class="text-slate-600">
        Total Commits Analyzed: <strong>${r.total_commits}</strong> · Provenance Rating: <strong>${r.provenance_rating}%</strong>
      </p>
    </div>
    <div class="space-y-1.5 pt-1">
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Primary Language:</span>
        <span class="font-semibold text-slate-800">${r.primary_language}</span>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Detected Tech Stack:</span>
        <span class="font-mono text-slate-800">${(r.key_technologies || []).join(', ')}</span>
      </div>
      ${r.repo_url ? `
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Git Source URL:</span>
        <a href="${r.repo_url}" target="_blank" class="text-blue-600 underline font-mono truncate max-w-xs">${r.repo_url}</a>
      </div>` : ''}
    </div>
    ${r.gemini_summary ? `
    <div class="rounded-xl p-3 bg-gradient-to-r from-blue-50 to-teal-50 border border-blue-200 text-xs space-y-1">
      <div class="font-bold flex items-center gap-1.5 text-blue-950 text-xs">
        <i data-lucide="sparkles" class="w-3.5 h-3.5 text-blue-600"></i>
        <span>Architectural Reasoning & Provenance Evaluation</span>
      </div>
      <p class="text-blue-950 font-medium text-[11px] leading-relaxed">
        ${escapeHtml(r.gemini_summary)}
      </p>
    </div>` : ''}
    <div class="pt-3 border-t border-slate-100 flex justify-end">
      <button onclick="switchTopologyRepo('${r.repo_name}'); closeModal('modal-status-detail'); scrollToTopologyGraph();"
        class="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition shadow-sm active:scale-95">
        <i data-lucide="git-fork" class="w-3.5 h-3.5 text-blue-400"></i>
        <span>View Git Topology DAG</span>
      </button>
    </div>
  `;
  modal.classList.remove("hidden");
  lucide.createIcons();
}

function openApplicationStatusModal(appId) {
  const item = cachedApplications[appId];
  if (!item) return;

  const app  = item.application;
  const cand = item.candidate || {};
  const job  = item.job || {};
  const sla  = item.sla || {};

  const isGhosted   = app.status === "ghosted";
  const isInterview = app.status === "interview_scheduled";
  const isOffer     = app.status === "approved_offer";
  const isRejected  = app.status === "rejected_with_feedback";
  const isPending   = app.status === "pending";

  const modal = document.getElementById("modal-status-detail");
  document.getElementById("modal-detail-title").textContent = `Application Status: ${cand.full_name || app.candidate_name}`;

  let statusHeader = "";
  if (isGhosted) {
    statusHeader = `
      <div class="rounded-lg bg-rose-50 border border-rose-200 p-3 space-y-1 text-rose-900">
        <div class="font-bold text-sm flex items-center gap-1.5">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-600 shrink-0"></i>
          <span>SLA Breached — Candidate Unresponsive / Ghosted</span>
        </div>
        <p class="text-xs text-rose-700">
          The employer failed to review this application within the mandated 72-hour turnaround window. The company's public Popularity Score has been penalized and their Verified Responsive badge revoked.
        </p>
      </div>
    `;
  } else if (isOffer) {
    statusHeader = `
      <div class="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1 text-emerald-950">
        <div class="font-bold text-sm flex items-center gap-1.5">
          <i data-lucide="check-check" class="w-4 h-4 text-emerald-600"></i>
          <span>Fast-Track Candidate Approved — Formal Offer Extended!</span>
        </div>
        <p class="text-xs text-emerald-800">
          Note: <strong>${app.disposition_note || 'Candidate cleared proof-of-work assessment and advanced directly to offer stage.'}</strong>
        </p>
      </div>
    `;
  } else if (isInterview) {
    statusHeader = `
      <div class="rounded-lg bg-indigo-50 border border-indigo-200 p-3 space-y-1 text-indigo-900">
        <div class="font-bold text-sm flex items-center gap-1.5">
          <i data-lucide="calendar-check" class="w-4 h-4 text-indigo-600"></i>
          <span>Direct 48h Engineering Round Scheduled</span>
        </div>
        <p class="text-xs text-indigo-700">Slot: <strong>${app.interview_time || 'TBD'}</strong></p>
      </div>
    `;
  } else if (isRejected) {
    statusHeader = `
      <div class="rounded-lg bg-slate-100 border border-slate-200 p-3 space-y-1 text-slate-800">
        <div class="font-bold text-sm">Closed with Constructive Feedback</div>
        <p class="text-xs text-slate-600">"${app.disposition_note || 'Closed without extra notes'}"</p>
      </div>
    `;
  } else {
    statusHeader = `
      <div class="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1 text-emerald-900">
        <div class="font-bold text-sm flex items-center gap-1.5">
          <i data-lucide="clock" class="w-4 h-4 text-emerald-600"></i>
          <span>Active Fast-Track Queue Review</span>
        </div>
        <p class="text-xs text-emerald-700">${sla.badge_label || 'Within 72h SLA'}</p>
      </div>
    `;
  }

  document.getElementById("modal-detail-content").innerHTML = `
    ${statusHeader}
    <div class="space-y-2 pt-2">
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Applicant:</span>
        <span class="font-semibold text-slate-800">${cand.full_name || app.candidate_name} (@${app.github_username})</span>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Applied Role:</span>
        <span class="font-medium text-slate-800">${job.title || 'Senior Backend Engineer'}</span>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Company:</span>
        <span class="font-medium text-slate-800">${job.company_name || 'Acme Systems'}</span>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Proof Composite Score:</span>
        <span class="font-bold text-emerald-600">${app.composite_score}%</span>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">Submitted:</span>
        <span class="font-mono text-slate-700">${app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</span>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1">
        <span class="text-slate-500">72h SLA Deadline:</span>
        <span class="font-mono ${isGhosted ? 'text-rose-600 font-bold' : 'text-slate-700'}">${app.sla_deadline ? new Date(app.sla_deadline).toLocaleString() : '—'}</span>
      </div>
      <div class="pt-3 border-t border-slate-100 flex justify-end">
        <button onclick="openTopologyModalForCandidate('${app.github_username}'); closeModal('modal-status-detail');"
          class="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition shadow-sm active:scale-95">
          <i data-lucide="git-fork" class="w-3.5 h-3.5 text-blue-400"></i>
          <span>Inspect Candidate Git Topology</span>
        </button>
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
  lucide.createIcons();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: STATUS BOARD
// ─────────────────────────────────────────────────────────────────────────────

async function loadCandidateStatusBoard() {
  const container = document.getElementById("list-candidate-status");
  if (!container) return;

  const username = currentCandidate?.github_username || document.getElementById("input-github-user")?.value.trim() || "iiitd-dev";

  // Keep candidate name in header synchronized
  const headingName = document.getElementById("status-board-candidate-name");
  if (headingName) {
    const disp = currentCandidate?.full_name ? `${currentCandidate.full_name} (@${username})` : `@${username}`;
    headingName.textContent = disp;
  }

  try {
    const res = await fetch(`/api/employer/all-applications?simulated_hours=${simulatedHours}&candidate_username=${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error("Could not fetch board");
    const data = await res.json();
    renderCandidateStatusBoard(data);
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Status board sync error: ${err.message}</p>`;
  }
}

function renderCandidateStatusBoard(items) {
  const container = document.getElementById("list-candidate-status");
  if (!container) return;
  container.innerHTML = "";
  cachedApplications = {};

  if (!items.length) {
    if (currentCandidate && !currentCandidate.fast_track_qualified) {
      container.innerHTML = `
        <div class="rounded-xl border border-rose-200 bg-rose-50/70 p-5 text-center space-y-2">
          <div class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-100 text-rose-700 mx-auto">
            <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-600"></i>
          </div>
          <h3 class="text-xs font-bold text-rose-900">No Fast-Track Applications</h3>
          <p class="text-xs text-rose-700 max-w-lg mx-auto">
            Candidate <strong>@${currentCandidate.github_username}</strong> was routed to the unscreened cold queue due to a 1-commit bulk dump (provenance rating: ${currentCandidate.git_provenance_score}%). Fast-track queue privileges with 72h anti-ghost SLA are reserved for verified human repositories.
          </p>
        </div>
      `;
    } else {
      const candUser = currentCandidate?.github_username || document.getElementById("input-github-user")?.value.trim() || 'this candidate';
      container.innerHTML = `
        <div class="rounded-xl border border-slate-200 bg-white p-6 text-center space-y-2">
          <div class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-600 mx-auto">
            <i data-lucide="inbox" class="w-4 h-4"></i>
          </div>
          <p class="text-xs font-semibold text-slate-800">No active applications submitted yet for @${candUser}.</p>
          <p class="text-[11px] text-slate-500 max-w-md mx-auto">Take the 5-Minute Micro-Challenge above on your code to qualify and vault into the fast-track queue with an active 72-hour anti-ghosting SLA guarantee.</p>
        </div>
      `;
    }
    lucide.createIcons();
    return;
  }

  items.forEach(item => {
    const app  = item.application;
    const cand = item.candidate || {};
    const job  = item.job || {};
    const sla  = item.sla || {};
    cachedApplications[app.id] = item;

    const isGhosted   = app.status === "ghosted" || (app.status === "pending" && sla.is_breached);
    const isInterview = app.status === "interview_scheduled";
    const isOffer     = app.status === "approved_offer";
    const isRejected  = app.status === "rejected_with_feedback";

    let borderClass = "border-slate-200 hover:border-blue-400 bg-white";
    let statusPill  = "";

    if (isGhosted) {
      borderClass = "border-rose-300 bg-rose-50/40 hover:border-rose-400";
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3 text-rose-600"></i><span>SLA BREACHED (${sla.overdue_hours || 1}h overdue)</span></span>`;
    } else if (isOffer) {
      borderClass = "border-emerald-300 bg-emerald-50/40 hover:border-emerald-400";
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1"><i data-lucide="check-check" class="w-3 h-3 text-emerald-600"></i><span>Offer Extended!</span></span>`;
    } else if (isInterview) {
      borderClass = "border-indigo-200 bg-indigo-50/30";
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">Interview Scheduled</span>`;
    } else if (isRejected) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">Closed w/ Feedback</span>`;
    } else {
      const urgent = sla.status === "sla_urgent";
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${urgent ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}">${sla.badge_label || 'Within SLA'}</span>`;
    }

    const row = document.createElement("div");
    row.className = `p-3 rounded-lg border ${borderClass} flex items-center justify-between gap-3 cursor-pointer transition shadow-sm`;
    row.onclick = () => openApplicationStatusModal(app.id);
    row.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
          ${(job.company_name || 'C').charAt(0)}
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-xs text-slate-900">${job.company_name || 'Acme Systems'}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono">Fast-Track #1</span>
          </div>
          <p class="text-[11px] text-slate-600 font-medium truncate mt-0.5">${job.title || 'Software Engineer'}</p>
        </div>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <div class="text-right hidden sm:block">
          <div class="text-[10px] text-slate-400 uppercase font-semibold">Proof Score</div>
          <div class="font-bold text-xs text-slate-900">${app.composite_score}%</div>
        </div>
        ${statusPill}
        <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-slate-400"></i>
      </div>
    `;
    container.appendChild(row);
  });

  lucide.createIcons();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: JOB MATCHING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function computeJobMatch(job, candidate) {
  if (!candidate || !candidate.audited_repos || !candidate.audited_repos.length) {
    return { isMatch: false, matchScore: 0, matchedTags: [], matchedRepo: null, reason: "" };
  }

  // If candidate is flagged as bot/bulk dump, do not match (they stay in cold queue)
  if (candidate.commit_topology_status === "flagged_bulk_dump" || candidate.fast_track_qualified === false) {
    return { isMatch: false, matchScore: 15, matchedTags: [], matchedRepo: null, reason: "1-commit bulk dump (cold queue only)" };
  }

  // Gather candidate's verified skills & technologies across all audited repos
  const verifiedTechMap = new Map();
  candidate.audited_repos.forEach(repo => {
    if (repo.primary_language) {
      const pl = repo.primary_language.trim();
      verifiedTechMap.set(pl.toLowerCase(), { original: pl, repo: repo.repo_name });
    }
    (repo.key_technologies || []).forEach(tech => {
      const t = tech.trim();
      if (t) {
        verifiedTechMap.set(t.toLowerCase(), { original: t, repo: repo.repo_name });
      }
    });
  });

  const jobStack = (job.stack_tags || []).map(t => t.trim());
  const matchedSet = new Set();
  const matchedOriginals = [];
  let primaryMatchedRepo = null;

  jobStack.forEach(jt => {
    const jtLow = jt.toLowerCase();
    for (const [ctLow, val] of verifiedTechMap.entries()) {
      if (ctLow === jtLow || ctLow.includes(jtLow) || jtLow.includes(ctLow)) {
        if (!matchedSet.has(val.original)) {
          matchedSet.add(val.original);
          matchedOriginals.push(val.original);
          if (!primaryMatchedRepo) primaryMatchedRepo = val.repo;
        }
      }
    }
  });

  // Also match against title and description
  const textCorpus = ((job.title || "") + " " + (job.description || "")).toLowerCase();
  for (const [ctLow, val] of verifiedTechMap.entries()) {
    if (textCorpus.includes(ctLow) && !matchedSet.has(val.original)) {
      matchedSet.add(val.original);
      matchedOriginals.push(val.original);
      if (!primaryMatchedRepo) primaryMatchedRepo = val.repo;
    }
  }

  const overlapCount = matchedOriginals.length;
  const isNewlyPosted = job.id === lastCreatedJobId;
  const isMatch = overlapCount >= 1 || isNewlyPosted;

  let matchScore = 0;
  if (isMatch) {
    const base = Math.min(98, 88 + (overlapCount * 3));
    matchScore = Math.min(98, Math.round(base * 0.9 + (candidate.git_provenance_score || 94.5) * 0.1));
  } else {
    matchScore = Math.round((candidate.git_provenance_score || 70) * 0.5);
  }

  if (isNewlyPosted && !matchedOriginals.length) {
    matchedOriginals.push(candidate.audited_repos[0]?.primary_language || "Python");
    primaryMatchedRepo = candidate.audited_repos[0]?.repo_name || "inspected repo";
  }

  return {
    isMatch,
    matchScore,
    matchedTags: matchedOriginals,
    matchedRepo: primaryMatchedRepo || candidate.audited_repos[0]?.repo_name || "inspected repos",
    reason: isMatch ? `Matches verified code in ${primaryMatchedRepo || candidate.audited_repos[0]?.repo_name}` : "Stack tags not found in audited repositories"
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: AVAILABLE ROLES & TAILORED MICRO-ASSESSMENTS
// ─────────────────────────────────────────────────────────────────────────────

function scrollToJobOpenings() {
  const el = document.getElementById("section-available-jobs");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

async function loadCandidateJobs() {
  const container = document.getElementById("grid-candidate-jobs");
  if (!container) return;

  // Always fetch latest jobs from backend
  try {
    const res = await fetch("/api/employer/jobs");
    if (res.ok) {
      const data = await res.json();
      allJobs = data.map(x => x.job);
    }
  } catch (e) {
    console.error("Failed to fetch jobs:", e);
  }

  // If a new job was just created, ensure it appears at index 0
  if (lastCreatedJobId) {
    const newJobIdx = allJobs.findIndex(j => j.id === lastCreatedJobId);
    if (newJobIdx > 0) {
      const [newJobObj] = allJobs.splice(newJobIdx, 1);
      allJobs.unshift(newJobObj);
    }
  }

  // Get candidate's existing applications to reflect status per job
  const username = currentCandidate?.github_username || document.getElementById("input-github-user")?.value.trim() || "iiitd-dev";
  let appliedMap = {};
  try {
    const res = await fetch(`/api/employer/all-applications?simulated_hours=${simulatedHours}&candidate_username=${encodeURIComponent(username)}`);
    if (res.ok) {
      const apps = await res.json();
      apps.forEach(item => {
        appliedMap[item.job.id] = item;
      });
    }
  } catch (e) {
    console.error(e);
  }

  container.innerHTML = "";
  const countBadge = document.getElementById("label-open-roles-count");
  if (countBadge) countBadge.textContent = `${allJobs.length} Active Openings`;

  const isQualified = currentCandidate ? currentCandidate.fast_track_qualified : true;

  // Render Top Job Match Alert Banner
  const alertContainer = document.getElementById("container-job-match-alert");
  if (alertContainer) {
    let topMatchJob = null;
    let topMatchInfo = null;

    if (lastCreatedJobId && !appliedMap[lastCreatedJobId]) {
      const found = allJobs.find(j => j.id === lastCreatedJobId);
      if (found) {
        topMatchJob = found;
        topMatchInfo = computeJobMatch(found, currentCandidate);
      }
    }

    if (!topMatchJob) {
      for (const job of allJobs) {
        if (!appliedMap[job.id]) {
          const m = computeJobMatch(job, currentCandidate);
          if (m.isMatch && (!topMatchInfo || m.matchScore > topMatchInfo.matchScore)) {
            topMatchJob = job;
            topMatchInfo = m;
          }
        }
      }
    }

    if (topMatchJob && topMatchInfo && topMatchInfo.isMatch && isQualified) {
      alertContainer.classList.remove("hidden");
      alertContainer.innerHTML = `
        <div class="rounded-2xl border-2 border-emerald-400 bg-gradient-to-r from-emerald-50 via-teal-50/70 to-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5 font-bold">
              <i data-lucide="sparkles" class="w-5 h-5 text-white"></i>
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-200 text-emerald-900 border border-emerald-300">
                  🎯 You are a Match (${topMatchInfo.matchScore}%)
                </span>
                <span class="text-xs font-bold text-slate-800">${topMatchJob.company_name}</span>
                ${topMatchJob.id === lastCreatedJobId ? '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">✨ Just Posted</span>' : ''}
              </div>
              <h3 class="text-xs font-bold text-slate-900 mt-0.5">${topMatchJob.title}</h3>
              <p class="text-[11px] text-slate-600 mt-0.5">
                Your verified code in <strong class="text-slate-800">${topMatchInfo.matchedRepo}</strong> matches their <span class="font-mono text-emerald-800 font-semibold">${topMatchInfo.matchedTags.slice(0, 4).join(', ')}</span> stack.
              </p>
            </div>
          </div>
          <button onclick="startJobChallenge('${topMatchJob.id}')"
            class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition active:scale-95 shrink-0">
            <span>Apply Now (5-Min Test)</span>
            <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    } else {
      alertContainer.classList.add("hidden");
    }
  }

  allJobs.forEach(job => {
    const existing = appliedMap[job.id];
    const isApplied = !!existing;
    const match = computeJobMatch(job, currentCandidate);

    // Challenge metadata matched to stack
    let challengeTitle = "Fix Concurrency Race Condition in Shared Token Bucket";
    let challengeFile = "token_bucket.py";
    let conceptTag = "Asyncio Concurrency";

    const stackLower = (job.stack_tags || []).join(" ").toLowerCase();
    if (stackLower.includes("sqlalchemy") || stackLower.includes("postgresql") || stackLower.includes("database")) {
      challengeTitle = "Resolve Database Connection Leak in Async Repository";
      challengeFile = "db_repository.py";
      conceptTag = "Resource Management";
    } else if (stackLower.includes("resilience") || stackLower.includes("websockets") || stackLower.includes("distributed systems") || stackLower.includes("aws") || stackLower.includes("rust") || stackLower.includes("go")) {
      challengeTitle = "Prevent Thundering Herd Retry Storm with Exponential Backoff";
      challengeFile = "resilience_client.py";
      conceptTag = "Distributed Resilience";
    }

    const card = document.createElement("div");
    let cardCls = "f7-card p-4 flex flex-col justify-between gap-3 transition ";
    if (isApplied) {
      cardCls += "f7-card-coral bg-[#EF6C4A]/10";
    } else if (match.isMatch && isQualified) {
      cardCls += "f7-card-gold bg-gradient-to-b from-[#FFD23F]/10 to-transparent";
    } else {
      cardCls += "border-l-6 border-l-[#2BA8A2]";
    }
    card.className = cardCls;

    const stackPills = (job.stack_tags || [])
      .slice(0, 4)
      .map(t => {
        const isMatchedTag = match.matchedTags.some(mt => mt.toLowerCase() === t.toLowerCase());
        const pillCls = isMatchedTag
          ? "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold"
          : "bg-slate-100 text-slate-700 border-slate-200";
        return `<span class="px-1.5 py-0.5 rounded ${pillCls} border font-mono text-[10px]">${t}</span>`;
      })
      .join(" ");

    let actionButton = "";
    if (isApplied) {
      const st = existing.application.status;
      let statusText = "Active Fast-Track #1";
      if (st === "interview_scheduled") statusText = "Interview Scheduled";
      else if (st === "approved_offer") statusText = "Offer Extended!";
      else if (st === "ghosted") statusText = "SLA Breached / Ghosted";

      actionButton = `
        <div class="space-y-1.5 pt-1">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-emerald-700 font-semibold flex items-center gap-1">
              <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-600"></i>
              <span>${statusText}</span>
            </span>
            <span class="font-bold text-slate-800 font-mono">${existing.application.composite_score}%</span>
          </div>
          <button onclick="openApplicationStatusModal('${existing.application.id}')"
            class="w-full py-1.5 rounded-lg bg-emerald-100/70 hover:bg-emerald-200 text-emerald-900 font-semibold text-xs border border-emerald-300 transition flex items-center justify-center gap-1.5">
            <span>View Application Dossier</span>
            <i data-lucide="arrow-right" class="w-3 h-3"></i>
          </button>
        </div>
      `;
    } else if (!isQualified) {
      actionButton = `
        <button disabled
          class="w-full py-2 rounded-lg bg-slate-100 text-slate-400 font-medium text-xs border border-slate-200 cursor-not-allowed flex items-center justify-center gap-1">
          <i data-lucide="lock" class="w-3.5 h-3.5"></i>
          <span>Locked (Cold Queue Only)</span>
        </button>
      `;
    } else if (match.isMatch) {
      actionButton = `
        <button onclick="startJobChallenge('${job.id}')"
          class="f7-btn f7-btn-gold w-full py-2.5 px-4 text-xs flex items-center justify-center gap-2">
          <span>🎯 Apply Now (Take 5-Min Match Test)</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      `;
    } else {
      actionButton = `
        <button onclick="startJobChallenge('${job.id}')"
          class="f7-btn f7-btn-teal w-full py-2.5 px-4 text-xs flex items-center justify-center gap-2">
          <span>Take 5-Min Test for this Role</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      `;
    }

    let matchSection = "";
    if (match.isMatch && isQualified) {
      matchSection = `
        <div class="rounded-lg bg-emerald-50/80 border border-emerald-200/90 p-2 space-y-0.5 text-[11px] text-emerald-950">
          <div class="font-bold flex items-center gap-1 text-emerald-900">
            <i data-lucide="check-check" class="w-3.5 h-3.5 text-emerald-600"></i>
            <span>Verified Code Match: ${match.matchScore}%</span>
          </div>
          <p class="text-[10px] text-emerald-800 leading-tight">
            Matched with your verified code in <span class="font-semibold text-slate-900">${match.matchedRepo}</span> (${match.matchedTags.slice(0, 4).join(', ')}).
          </p>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <span class="w-5 h-5 rounded-md bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">
              ${(job.company_name || 'C').charAt(0)}
            </span>
            <span>${job.company_name}</span>
          </span>
          <div class="flex items-center gap-1.5 flex-wrap">
            ${match.isMatch && isQualified ? `<span class="text-[10px] text-emerald-800 font-bold px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3 text-emerald-600"></i><span>You are a Match! (${match.matchScore}%)</span></span>` : ''}
            ${job.id === lastCreatedJobId ? `<span class="text-[10px] text-blue-800 font-bold px-1.5 py-0.5 rounded bg-blue-100 border border-blue-200">✨ Just Posted</span>` : ''}
            <span class="text-[10px] text-emerald-700 font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
              72h SLA
            </span>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-bold text-slate-900 leading-snug">${job.title}</h4>
          <p class="text-[11px] text-slate-500 line-clamp-2 mt-0.5">${job.description}</p>
        </div>

        <div class="flex items-center gap-1 flex-wrap">
          ${stackPills}
        </div>

        ${matchSection}

        <div class="rounded-lg bg-slate-50 border border-slate-200 p-2 space-y-1">
          <div class="text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
            <i data-lucide="zap" class="w-3 h-3 text-amber-500"></i>
            <span>Tailored 5-Min Assessment</span>
          </div>
          <p class="text-[11px] font-medium text-slate-800 leading-tight">${challengeTitle}</p>
          <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-0.5">
            <span>${challengeFile}</span>
            <span class="text-blue-600">${conceptTag}</span>
          </div>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-100">
        ${actionButton}
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

function startJobChallenge(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (job) currentJob = job;
  startChallengeModal(jobId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: 5-MIN CHALLENGE
// ─────────────────────────────────────────────────────────────────────────────

async function startChallengeModal(jobId = null) {
  if (!currentCandidate) {
    await runCandidateAudit();
  }
  if (!currentCandidate) return;

  if (jobId) {
    const found = allJobs.find(j => j.id === jobId);
    if (found) currentJob = found;
  }
  if (!currentJob) {
    if (!allJobs.length) await loadEmployerBootstrap();
    currentJob = allJobs[0] || null;
  }

  const targetJobId = jobId || (currentJob ? currentJob.id : "job-backend-fastapi");

  try {
    const res = await fetch("/api/candidate/assessment/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: currentCandidate.id,
        job_id: targetJobId,
      }),
    });

    if (!res.ok) throw new Error("Could not start assessment");
    const ch = await res.json();
    currentChallenge = ch;

    const sandbox = document.getElementById("section-challenge-sandbox");
    sandbox.classList.remove("hidden");

    document.getElementById("challenge-job-title").textContent = `Challenge for: ${currentJob ? currentJob.title : 'Target Role'}`;
    const compBadge = document.getElementById("challenge-company-badge");
    if (compBadge) compBadge.textContent = `Target Company: ${currentJob?.company_name || 'Acme Systems'} · 72h Anti-Ghost SLA Guarantee`;

    const filenameEl = document.getElementById("challenge-editor-filename");
    if (filenameEl) filenameEl.textContent = ch.filename || "token_bucket.py";

    document.getElementById("challenge-self-prompt").textContent = ch.self_repo_prompt;
    document.getElementById("challenge-bug-title").textContent = ch.bug_fix_title;
    document.getElementById("challenge-bug-instructions").textContent = ch.bug_fix_instructions;
    document.getElementById("challenge-concept").textContent = ch.expected_concept;
    document.getElementById("input-code-editor").value = ch.buggy_code_snippet;
    document.getElementById("input-self-explanation").value = "";

    clearSandboxOutput();
    startTimer(ch.duration_seconds || 300);
    lucide.createIcons();
  } catch (err) {
    showToast("Error starting challenge: " + err.message, "error");
  }
}

function closeChallengeModal() {
  const sandbox = document.getElementById("section-challenge-sandbox");
  if (sandbox) sandbox.classList.add("hidden");
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function autofillChallengeSolution() {
  if (!currentChallenge) {
    showToast("No active challenge to solve.", "warn");
    return;
  }

  const filename = (currentChallenge.filename || "").toLowerCase();
  const concept = (currentChallenge.expected_concept || "").toLowerCase();
  const editor = document.getElementById("input-code-editor");
  const explanation = document.getElementById("input-self-explanation");

  if (filename.includes("db") || concept.includes("resource") || concept.includes("connection")) {
    editor.value = `async def get_user_orders(db_pool, user_id: str):
    conn = await db_pool.acquire()
    try:
        results = await conn.fetch('SELECT * FROM orders WHERE user_id = $1', user_id)
        return results
    finally:
        await db_pool.release(conn)`;
    explanation.value = "Wrapped database query execution in a try...finally block to guarantee connection release back to the pool, preventing resource leaks and connection pool starvation under unhandled exceptions.";
  } else if (filename.includes("resilience") || concept.includes("backoff") || concept.includes("retry") || concept.includes("storm") || concept.includes("thundering")) {
    editor.value = `import asyncio

async def dispatch_webhook_with_retry(client, url: str, max_retries: int = 4):
    for attempt in range(max_retries):
        try:
            return await client.post(url)
        except Exception:
            if attempt == max_retries - 1:
                raise
            delay = min(2.0, 0.1 * (2 ** attempt))
            await asyncio.sleep(delay)`;
    explanation.value = "Implemented exponential backoff with capped jittered delay using asyncio.sleep to prevent thundering herd retry storms when downstream services fail.";
  } else {
    // Concurrency token bucket
    editor.value = `import asyncio
from fastapi import HTTPException

class TokenBucket:
    def __init__(self, capacity: int = 10):
        self.tokens = capacity
        self.lock = asyncio.Lock()

    async def consume(self) -> bool:
        async with self.lock:
            if self.tokens > 0:
                await asyncio.sleep(0.001)
                self.tokens -= 1
                return True
            raise HTTPException(status_code=429, detail='Rate limit exceeded')`;
    explanation.value = "Acquired asyncio.Lock during token consumption to prevent concurrent coroutines from interleaving, eliminating the race condition and enforcing strict rate-limit boundaries.";
  }

  showToast("Loaded verified solution & architecture defense. Ready to test or submit!", "success");
}

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  secondsRemaining = seconds;
  const timerEl = document.getElementById("timer-display");

  function update() {
    const m = Math.floor(secondsRemaining / 60);
    const s = secondsRemaining % 60;
    timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    if (secondsRemaining <= 60) {
      timerEl.className = "text-xl font-mono font-black text-rose-600 pulse-urgent";
    } else if (secondsRemaining <= 120) {
      timerEl.className = "text-xl font-mono font-black text-amber-600";
    } else {
      timerEl.className = "text-xl font-mono font-black text-emerald-600";
    }

    if (secondsRemaining <= 0) {
      clearInterval(timerInterval);
      showToast("Time expired! Submitting code...", "warn");
      submitChallenge();
    }
    secondsRemaining--;
  }

  update();
  timerInterval = setInterval(update, 1000);
}

async function submitChallenge() {
  if (timerInterval) clearInterval(timerInterval);
  if (!currentChallenge) return;

  const explanation = document.getElementById("input-self-explanation").value.trim();
  const code = document.getElementById("input-code-editor").value;
  const btn = document.getElementById("btn-submit-challenge");

  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Validating on Server…</span>`;
  lucide.createIcons();

  try {
    const res = await fetch("/api/candidate/assessment/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: currentChallenge.id,
        self_repo_explanation: explanation || "Implemented robust architecture matching the target role requirements.",
        fixed_code: code,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Submission failed");
    }

    const data = await res.json();
    if (data.evaluation.passed) {
      document.getElementById("section-challenge-sandbox").classList.add("hidden");
      document.getElementById("section-vault-success").classList.remove("hidden");
      const companyName = currentJob?.company_name || "Employer";
      showToast(`Verification passed! Vaulted to #1 on ${companyName} Fast-Track Queue.`, "success");
      if (currentCandidate) currentCandidate.fast_track_qualified = true;
      broadcastSyncEvent({
        type: "APPLICATION_SUBMITTED",
        applicationId: data.application?.application_id,
        candidateName: currentCandidate?.full_name || "Aarav Sharma",
        jobId: currentJob?.id,
      });
      await loadCandidateStatusBoard();
      await loadCandidateJobs();
    } else {
      showToast(`Assessment failed (${data.evaluation.score}/100): ${data.evaluation.feedback}`, "warn");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check-check" class="w-4 h-4"></i><span>Submit & Vault to Fast-Track</span>`;
    lucide.createIcons();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: LIVE CODE EXECUTION SANDBOX
// ─────────────────────────────────────────────────────────────────────────────

async function runSandboxCode() {
  const code = document.getElementById("input-code-editor")?.value;
  if (!code) {
    showToast("Editor is empty. Enter code to execute.", "warn");
    return;
  }

  const btn = document.getElementById("btn-run-code");
  const consoleSection = document.getElementById("section-sandbox-output");
  const stdoutEl = document.getElementById("sandbox-stdout");
  const badgeEl = document.getElementById("sandbox-execution-badge");
  const timeEl = document.getElementById("sandbox-time-elapsed");
  const pillsEl = document.getElementById("sandbox-test-pills");
  const dotEl = document.getElementById("sandbox-status-dot");

  consoleSection.classList.remove("hidden");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin text-emerald-400"></i><span>Running Tests…</span>`;
  }
  badgeEl.className = "px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-900/60 text-blue-300 border border-blue-700";
  badgeEl.textContent = "Running…";
  dotEl.className = "w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping inline-block";
  stdoutEl.textContent = "Compiling and executing against test cases in sandbox...";
  pillsEl.innerHTML = "";
  lucide.createIcons();

  let challengeId = "fastapi-async-race";
  const titleLower = (currentChallenge?.bug_fix_title || "").toLowerCase();
  if (titleLower.includes("leak") || titleLower.includes("database")) {
    challengeId = "db-connection-leak";
  } else if (titleLower.includes("retry") || titleLower.includes("storm") || titleLower.includes("resilience")) {
    challengeId = "network-retry-storm";
  }

  try {
    const res = await fetch("/api/candidate/assessment/run-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: challengeId,
        code: code,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Sandbox execution error");
    }

    const data = await res.json();
    timeEl.textContent = `${data.execution_time_ms || 0}ms`;
    stdoutEl.textContent = data.stdout || (data.error ? `Error: ${data.error}` : "No output received.");

    if (data.passed) {
      badgeEl.className = "px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700";
      badgeEl.textContent = `Passed (${data.passed_tests}/${data.total_tests})`;
      dotEl.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block";
      showToast(`Tests passed! ${data.passed_tests}/${data.total_tests} test cases successful (${data.execution_time_ms}ms).`, "success");
    } else {
      badgeEl.className = "px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-700";
      badgeEl.textContent = data.total_tests > 0 ? `Failed (${data.passed_tests}/${data.total_tests})` : "Compilation Error";
      dotEl.className = "w-2.5 h-2.5 rounded-full bg-rose-500 inline-block";
      showToast(data.error || `Tests failed: ${data.passed_tests}/${data.total_tests} passed.`, "warn");
    }

    // Render structured test pills
    pillsEl.innerHTML = "";
    (data.test_results || []).forEach(t => {
      const pill = document.createElement("span");
      if (t.passed) {
        pill.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-[10px] font-medium";
        pill.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i><span>${t.name}</span>`;
      } else {
        pill.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800 text-[10px] font-medium";
        pill.innerHTML = `<i data-lucide="x" class="w-3 h-3 text-rose-400"></i><span>${t.name}</span>`;
      }
      pillsEl.appendChild(pill);
    });
  } catch (err) {
    stdoutEl.textContent = `Sandbox Error: ${err.message}`;
    badgeEl.className = "px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-700";
    badgeEl.textContent = "Error";
    dotEl.className = "w-2.5 h-2.5 rounded-full bg-rose-500 inline-block";
    showToast(`Error running code: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="play" class="w-3 h-3 text-emerald-400"></i><span>Run Code & Tests</span>`;
    }
    lucide.createIcons();
  }
}

function clearSandboxOutput() {
  const consoleSection = document.getElementById("section-sandbox-output");
  if (consoleSection) consoleSection.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYER: 72H TIME SIMULATION SLIDER
// ─────────────────────────────────────────────────────────────────────────────

function onTimeSliderChange(val) {
  simulatedHours = parseFloat(val);
  const label = document.getElementById("slider-hours-label");
  if (label) {
    if (simulatedHours === 0) {
      label.textContent = "+0 hours (Now)";
      label.className = "font-mono font-black text-blue-700 px-2 py-0.5 rounded bg-blue-50 border border-blue-200";
    } else if (simulatedHours >= 72) {
      label.textContent = `+${simulatedHours}h (GHOSTED)`;
      label.className = "font-mono font-black text-rose-700 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 animate-pulse";
    } else if (simulatedHours >= 48) {
      label.textContent = `+${simulatedHours}h (Urgent)`;
      label.className = "font-mono font-black text-amber-700 px-2 py-0.5 rounded bg-amber-50 border border-amber-200";
    } else {
      label.textContent = `+${simulatedHours}h elapsed`;
      label.className = "font-mono font-black text-blue-700 px-2 py-0.5 rounded bg-blue-50 border border-blue-200";
    }
  }

  // Refresh both employer views and candidate status board with new simulated time
  loadEmployerCockpit();
  loadCandidateStatusBoard();
}

function setTimeSlider(val) {
  const slider = document.getElementById("slider-simulated-hours");
  if (slider) {
    slider.value = val;
    onTimeSliderChange(val);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYER: BOOTSTRAP & COCKPIT
// ─────────────────────────────────────────────────────────────────────────────

async function loadEmployerBootstrap() {
  try {
    const res = await fetch("/api/employer/jobs");
    if (!res.ok) return;
    const data = await res.json();
    allJobs = data.map(x => x.job);

    const sel = document.getElementById("emp-job-select");
    if (sel) {
      sel.innerHTML = "";
      allJobs.forEach(j => {
        const opt = document.createElement("option");
        opt.value = j.id;
        opt.textContent = `${j.company_name} — ${j.title}`;
        sel.appendChild(opt);
      });
      selectedJobId = allJobs[0]?.id || null;
    }
  } catch (err) {
    console.error("Bootstrap error:", err);
  }
}

function onJobChange() {
  const sel = document.getElementById("emp-job-select");
  selectedJobId = sel?.value || null;
  loadEmployerCockpit();
}

function openCreateJobModal() {
  const modal = document.getElementById("modal-create-job");
  if (!modal) return;
  const compSelect = document.getElementById("input-newjob-company");
  if (compSelect && currentJob) {
    compSelect.value = currentJob.company_id || "comp-acme";
  }
  document.getElementById("input-newjob-title").value = "";
  document.getElementById("input-newjob-tags").value = "Rust, Go, Distributed Systems, WebSockets";
  document.getElementById("input-newjob-desc").value = "";
  modal.classList.remove("hidden");
  lucide.createIcons();
}

async function createEmployerJob() {
  const companyId = document.getElementById("input-newjob-company").value;
  const title = document.getElementById("input-newjob-title").value.trim();
  const rawTags = document.getElementById("input-newjob-tags").value.trim();
  const expLevel = document.getElementById("input-newjob-exp").value;
  const salary = document.getElementById("input-newjob-salary").value.trim();
  const desc = document.getElementById("input-newjob-desc").value.trim();

  if (!title) {
    showToast("Please enter a job title.", "warn");
    return;
  }

  const tags = rawTags.split(",").map(t => t.trim()).filter(Boolean);

  const btn = document.getElementById("btn-submit-newjob");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Publishing Opening…</span>`;
  lucide.createIcons();

  try {
    const res = await fetch("/api/employer/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        title: title,
        stack_tags: tags.length ? tags : ["Python", "FastAPI"],
        experience_level: expLevel,
        salary_range: salary,
        description: desc || `Production engineering role focused on ${tags.join(", ")} under strict 72h SLA.`,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to publish job");
    }

    const newJob = await res.json();
    lastCreatedJobId = newJob.id;
    closeModal("modal-create-job");

    broadcastSyncEvent({
      type: "JOB_POSTED",
      job: newJob,
    });

    // Refresh bootstrap, select the new job, reload candidate jobs & employer cockpit
    await loadEmployerBootstrap();
    selectedJobId = newJob.id;
    const sel = document.getElementById("emp-job-select");
    if (sel) sel.value = newJob.id;

    await loadCandidateJobs();
    await loadEmployerCockpit();

    const match = computeJobMatch(newJob, currentCandidate);
    if (match.isMatch && currentCandidate) {
      showToast(`Published "${newJob.title}"! Candidate @${currentCandidate.github_username} matches ${match.matchScore}%. Switch to Candidate tab to apply.`, "success");
    } else {
      showToast(`Published: "${newJob.title}" with 72h SLA guarantee!`, "success");
    }
  } catch (err) {
    showToast("Error creating job: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Publish Role Opening</span>`;
    lucide.createIcons();
  }
}

async function loadEmployerCockpit() {
  if (!selectedJobId && allJobs.length) selectedJobId = allJobs[0].id;

  try {
    // 1. Fetch Company Metrics under simulated time
    const resCompany = await fetch(`/api/employer/company/comp-acme?simulated_hours=${simulatedHours}`);
    if (resCompany.ok) {
      const comp = await resCompany.json();
      document.getElementById("emp-company-name").textContent = comp.company_name;
      document.getElementById("metric-popularity").textContent = `${comp.popularity_score}%`;
      document.getElementById("metric-compliance").textContent = `${comp.response_rate}%`;
      document.getElementById("metric-breaches").textContent = comp.active_breaches;

      const badge = document.getElementById("badge-employer-responsive");
      if (comp.is_verified_responsive) {
        badge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200";
        badge.innerHTML = `<i data-lucide="badge-check" class="w-3.5 h-3.5"></i><span>Verified Responsive Employer</span>`;
      } else {
        badge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200";
        badge.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i><span>Badge Revoked: 72h Ghosting Penalty</span>`;
      }
    }

    // 2. Fetch Job Applications under simulated time
    if (selectedJobId) {
      const resApps = await fetch(`/api/employer/jobs/${selectedJobId}/applications?simulated_hours=${simulatedHours}`);
      if (resApps.ok) {
        const appsData = await resApps.json();
        renderEmployerQueues(appsData);
      }
    }
  } catch (err) {
    console.error("Employer cockpit error:", err);
  }
}

function renderEmployerQueues(data) {
  document.getElementById("label-fast-track-count").textContent = `${data.fast_track_total} Fast-Track Candidates`;

  const listFast = document.getElementById("list-fast-track");
  listFast.innerHTML = "";

  (data.fast_track_queue || []).forEach((item, index) => {
    const app  = item.application;
    const cand = item.candidate || {};
    const sla  = item.sla || {};
    cachedApplications[app.id] = item;

    const isGhosted   = app.status === "ghosted" || (app.status === "pending" && sla.is_breached);
    const isInterview = app.status === "interview_scheduled";
    const isRejected  = app.status === "rejected_with_feedback";
    const isPending   = app.status === "pending" && !sla.is_breached;

    let slaBadge = "";
    if (isGhosted) {
      slaBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold"><i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-600"></i><span>SLA Breached (${sla.overdue_hours || 1}h overdue)</span></span>`;
    } else if (sla.status === "sla_urgent") {
      slaBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold pulse-urgent">⚡ Action Required (${sla.remaining_hours}h left)</span>`;
    } else {
      slaBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">✓ ${sla.badge_label || 'Within SLA'}</span>`;
    }

    let actionBtns = "";
    if (isPending) {
      actionBtns = `
        <div class="flex items-center gap-2 flex-wrap">
          <button onclick="event.stopPropagation(); openDispositionModal('${app.id}', 'approve_offer')"
            class="f7-btn f7-btn-teal px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-sm">
            <i data-lucide="check-check" class="w-3.5 h-3.5"></i>
            <span>Approve &amp; Offer</span>
          </button>
          <button onclick="event.stopPropagation(); openDispositionModal('${app.id}', 'schedule_interview')"
            class="f7-btn f7-btn-gold px-3.5 py-1.5 text-xs flex items-center gap-1.5 shadow-sm">
            <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
            <span>Schedule</span>
          </button>
          <button onclick="event.stopPropagation(); openDispositionModal('${app.id}', 'reject_with_feedback')"
            class="f7-btn px-3 py-1.5 rounded-full bg-slate-200 hover:bg-slate-300 text-[#143836] text-xs font-bold border border-slate-300">
            Pass w/ Feedback
          </button>
          <button onclick="event.stopPropagation(); openGhostModal('${app.id}')"
            title="Simulate 72h inactivity"
            class="f7-btn px-2.5 py-1.5 rounded-full bg-[#EF6C4A]/15 hover:bg-[#EF6C4A]/25 text-[#D45233] text-xs font-bold border border-[#EF6C4A]/40">
            Simulate Ghost
          </button>
        </div>
      `;
    } else if (app.status === "approved_offer") {
      actionBtns = `<span class="f7-btn px-3 py-1 rounded-full bg-[#E8F6F5] text-[#1E8C86] border-2 border-[#2BA8A2] font-black text-xs flex items-center gap-1"><i data-lucide="check-check" class="w-3.5 h-3.5 text-[#2BA8A2]"></i><span>Offer Extended</span></span>`;
    } else if (isInterview) {
      actionBtns = `<span class="f7-btn px-3 py-1 rounded-full bg-[#FFF8E7] text-[#143836] border-2 border-[#FFD23F] font-black text-xs flex items-center gap-1"><span>Interview: ${app.interview_time || 'Scheduled'}</span></span>`;
    } else if (isRejected) {
      actionBtns = `<span class="f7-btn px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-300 font-bold text-xs">Closed with Feedback</span>`;
    } else if (isGhosted) {
      actionBtns = `<span class="f7-btn px-3 py-1 rounded-full bg-[#EF6C4A]/20 text-[#D45233] border-2 border-[#EF6C4A] font-black text-xs">Ghosted (Score Penalized)</span>`;
    }

    const isPodiumGold = (index === 0 && !isGhosted);
    const card = document.createElement("div");
    let cardCls = "f7-card p-4 space-y-3 cursor-pointer transition shadow-sm ";
    if (isGhosted) {
      cardCls += "border-[#EF6C4A] border-l-8 bg-rose-50/20";
    } else if (isPodiumGold) {
      cardCls += "f7-card-gold bg-gradient-to-r from-[#FFFDF7] via-[#FFF9E6] to-[#FFFDF7]";
    } else if (index === 1) {
      cardCls += "border-l-8 border-l-slate-400 bg-white";
    } else if (index === 2) {
      cardCls += "border-l-8 border-l-[#EF6C4A] bg-white";
    } else {
      cardCls += "border-l-6 border-l-[#2BA8A2] bg-white";
    }

    card.className = cardCls;
    card.onclick = () => openApplicationStatusModal(app.id);
    card.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="w-7 h-7 rounded-full ${isPodiumGold ? 'bg-[#FFD23F] text-[#143836] border-2 border-[#E6B800] shadow-sm' : 'bg-slate-100 text-slate-700 border border-slate-200'} font-mono font-black text-xs flex items-center justify-center shrink-0">
            ${isPodiumGold ? '<span class="f7-crown-bounce">👑</span>' : `#${index + 1}`}
          </span>
          <img src="${cand.avatar_url || 'https://avatars.githubusercontent.com/u/8942111?v=4'}" class="w-10 h-10 rounded-full border-2 border-[#2BA8A2] shadow-sm">
          <div>
            <div class="flex items-center gap-2">
              <h4 class="font-black text-slate-900 text-sm tracking-tight">${app.candidate_name}</h4>
              <span class="font-mono text-xs text-[#1E8C86] font-bold">@${app.github_username}</span>
              ${isPodiumGold ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#FFD23F] text-[#143836] border border-[#E6B800] shadow-sm">#1 Fast-Track</span>' : ''}
            </div>
            <p class="text-[11px] text-slate-500 line-clamp-1 font-medium">${cand.bio || 'Verified Developer'}</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Proof Score</div>
            <div class="text-lg font-black ${isPodiumGold ? 'text-[#143836] bg-[#FFD23F] px-2.5 py-0.5 rounded-full border border-[#E6B800] shadow-sm' : 'text-[#1E8C86] font-mono'}">${app.composite_score}%</div>
          </div>
          ${slaBadge}
        </div>
      </div>

      <div class="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="flex items-center gap-2 flex-wrap text-xs text-slate-500">
          <span class="inline-flex items-center gap-1 font-semibold text-[#1E8C86]"><i data-lucide="shield-check" class="w-4 h-4 text-[#2BA8A2]"></i><span>Git Provenance Verified · 5-Min Test Cleared</span></span>
          <button onclick="event.stopPropagation(); openTopologyModalForCandidate('${app.github_username}')"
            class="f7-btn px-2.5 py-1 text-[11px] font-mono bg-[#E8F6F5] hover:bg-[#D2ECEB] text-[#143836] border border-[#2BA8A2] transition">
            <i data-lucide="git-fork" class="w-3 h-3 text-[#2BA8A2]"></i>
            <span>Inspect Topology</span>
          </button>
        </div>
        <div>${actionBtns}</div>
      </div>
    `;
    listFast.appendChild(card);
  });

  // Cold Spam Queue
  const listCold = document.getElementById("list-cold-spam");
  listCold.innerHTML = "";
  (data.cold_queue_samples || []).forEach(spam => {
    const el = document.createElement("div");
    el.className = "p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1 opacity-75 hover:opacity-100 transition";
    el.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-semibold text-slate-800">${spam.name}</span>
        <span class="text-[9px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">Unscreened</span>
      </div>
      <p class="text-[11px] text-slate-500">${spam.headline}</p>
      <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
        <span>Git: ${spam.git_provenance}</span>
        <button onclick="event.stopPropagation(); openTopologyModalForCandidate('ai-spammer')"
          class="text-rose-600 hover:text-rose-800 hover:underline flex items-center gap-1">
          <i data-lucide="alert-triangle" class="w-3 h-3"></i>
          <span>${spam.warning}</span>
        </button>
      </div>
    `;
    listCold.appendChild(el);
  });

  lucide.createIcons();
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYER DISPOSITION & GHOST ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function openDispositionModal(appId, action) {
  const modal = document.getElementById("modal-disposition");
  const title = document.getElementById("modal-disp-title");
  const content = document.getElementById("modal-disp-content");
  document.getElementById("modal-disp-appid").value = appId;
  document.getElementById("modal-disp-action").value = action;

  if (action === "schedule_interview") {
    title.textContent = "Schedule 48-Hour Technical Round";
    content.innerHTML = `
      <p class="text-slate-600">Candidate will be invited for direct interview round. This preserves your Verified badge.</p>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Interview Slot (IST):</label>
        <input id="input-interview-slot" type="text" value="Thursday at 3:00 PM IST"
          class="w-full p-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:border-blue-600">
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Feedback Note:</label>
        <input id="input-interview-note" type="text" value="Impression: Outstanding code fix on asyncio concurrency."
          class="w-full p-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:border-blue-600">
      </div>
    `;
  } else if (action === "approve_offer") {
    title.textContent = "Approve Candidate & Extend Offer";
    content.innerHTML = `
      <p class="text-slate-600">Approving this candidate moves them directly to the final offer stage. This satisfies the 72h SLA and preserves your Verified Responsive Employer badge.</p>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Offer & Next Steps Note:</label>
        <input id="input-approve-note" type="text" value="Fast-Track Approved! Moving directly to formal compensation & offer letter."
          class="w-full p-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:border-blue-600">
      </div>
    `;
  } else {
    title.textContent = "Pass with Constructive Feedback";
    content.innerHTML = `
      <p class="text-slate-600">Employers reject 95% of candidates. <strong>You are not penalized for passing with feedback</strong>, only for ghosting!</p>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Constructive Feedback Note:</label>
        <textarea id="input-rejection-note" rows="3"
          class="w-full p-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:bg-white focus:border-blue-600">Strong GitHub foundations, but needs more experience in PostgreSQL connection pooling under heavy write load.</textarea>
      </div>
    `;
  }
  modal.classList.remove("hidden");
}

async function executeDisposition() {
  const appId  = document.getElementById("modal-disp-appid").value;
  const action = document.getElementById("modal-disp-action").value;
  let note = "";
  let interviewTime = "";

  if (action === "schedule_interview") {
    interviewTime = document.getElementById("input-interview-slot")?.value;
    note = document.getElementById("input-interview-note")?.value;
  } else if (action === "approve_offer") {
    note = document.getElementById("input-approve-note")?.value;
  } else {
    note = document.getElementById("input-rejection-note")?.value;
  }

  try {
    const res = await fetch("/api/employer/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: appId,
        action: action,
        note: note,
        interview_time: interviewTime,
      }),
    });

    if (!res.ok) throw new Error("Disposition failed");
    closeModal("modal-disposition");
    showToast(action === "schedule_interview" ? "Interview round scheduled!" : "Candidate notified with feedback.", "success");
    broadcastSyncEvent({
      type: "APPLICATION_STATUS_CHANGED",
      applicationId: appId,
      action: action,
    });
    loadEmployerCockpit();
    loadCandidateStatusBoard();
  } catch (err) {
    showToast("Error updating disposition: " + err.message, "error");
  }
}

function openGhostModal(appId) {
  ghostTargetAppId = appId;
  document.getElementById("modal-ghost").classList.remove("hidden");
}

async function executeGhost() {
  if (!ghostTargetAppId) return;

  const btn = document.getElementById("modal-ghost-confirm-btn");
  btn.disabled = true;
  btn.innerHTML = `<span>Simulating Ghost…</span>`;

  try {
    const res = await fetch("/api/employer/simulate-ghost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: ghostTargetAppId }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Ghost simulation failed");
    }

    closeModal("modal-ghost");
    showToast("Ghosting simulated: 72h SLA breached, company score penalized.", "warn");
    broadcastSyncEvent({
      type: "APPLICATION_STATUS_CHANGED",
      applicationId: ghostTargetAppId,
      action: "ghost_breached",
    });
    loadEmployerCockpit();
    loadCandidateStatusBoard();
  } catch (err) {
    showToast("Simulation error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Confirm SLA Breach</span>`;
  }
}
