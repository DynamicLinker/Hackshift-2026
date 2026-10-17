// ─────────────────────────────────────────────────────────────────────────────
//  ProofHired Client Orchestrator  |  Clean Light-Theme SPA
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
let cachedApplications = {};  // appId -> full application object for instant click modals
let cachedRepos        = {};  // repoName -> repo object for instant click modals

document.addEventListener("DOMContentLoaded", async () => {
  await runCandidateAudit();
  loadEmployerBootstrap();
  loadCandidateJobs();
});

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

function toggleGeminiKeyInput() {
  const container = document.getElementById("gemini-key-container");
  const isHidden = container.classList.contains("hidden");
  container.classList.toggle("hidden");
  document.getElementById("gemini-toggle-text").textContent = isHidden
    ? "− Hide Gemini API Key"
    : "+ Add Gemini API Key for deep architectural reasoning";
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  const candTab = document.getElementById("tab-candidate");
  const empTab  = document.getElementById("tab-employer");
  const btnCand = document.getElementById("btn-tab-candidate");
  const btnEmp  = document.getElementById("btn-tab-employer");

  const activeClass   = "flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-all bg-white text-slate-900 shadow-sm border border-slate-200";
  const inactiveClass = "flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all text-slate-600 hover:text-slate-900 hover:bg-slate-50";

  if (tab === "candidate") {
    candTab.classList.remove("hidden"); empTab.classList.add("hidden");
    btnCand.className = activeClass;    btnEmp.className  = inactiveClass;
    loadCandidateStatusBoard();
  } else {
    empTab.classList.remove("hidden");  candTab.classList.add("hidden");
    btnEmp.className  = activeClass;    btnCand.className = inactiveClass;
    loadEmployerCockpit();
  }
  lucide.createIcons();
}

function setCandidateDemo(username) {
  switchTab("candidate");
  document.getElementById("input-github-user").value = username;
  runCandidateAudit();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CANDIDATE: AUDIT & CLONE
// ─────────────────────────────────────────────────────────────────────────────

async function runCandidateAudit() {
  const rawInput = document.getElementById("input-github-user").value.trim();
  const geminiKey = document.getElementById("input-gemini-key")?.value.trim() || null;

  if (!rawInput) {
    showToast("Please enter a GitHub username or repository URL.", "warn");
    return;
  }

  const btn = document.getElementById("btn-audit");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Analyzing Repository…</span>`;
  lucide.createIcons();

  const isRepoUrl = rawInput.includes("/") || rawInput.startsWith("http");
  const payload = {
    github_username: isRepoUrl ? null : rawInput,
    repo_url: isRepoUrl ? rawInput : null,
    gemini_api_key: geminiKey,
  };

  try {
    const res = await fetch("/api/candidate/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Audit failed");
    }

    const data = await res.json();
    currentCandidate = data;
    renderAuditResults(data);
    showToast(`Audit complete: ${data.git_provenance_score}% provenance`, "success");
  } catch (err) {
    showToast("Audit error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="git-branch" class="w-3.5 h-3.5"></i><span>Clone & Analyze Repo</span>`;
    lucide.createIcons();
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

  // Score
  const scoreEl = document.getElementById("audit-provenance-score");
  scoreEl.textContent = `${c.git_provenance_score}%`;
  scoreEl.className = c.git_provenance_score >= 70 ? "text-2xl font-black text-emerald-600" : "text-2xl font-black text-rose-600";

  // Topology Badge
  const topoBadge = document.getElementById("audit-topology-badge");
  if (c.commit_topology_status === "verified_human") {
    topoBadge.className = "mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold w-fit";
    topoBadge.innerHTML = `<i data-lucide="check-circle" class="w-3 h-3 text-emerald-600"></i><span>Verified Human Developer</span>`;
  } else {
    topoBadge.className = "mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold w-fit";
    topoBadge.innerHTML = `<i data-lucide="alert-triangle" class="w-3 h-3 text-rose-600"></i><span>Flagged: 1-Commit Bulk Dump</span>`;
  }

  // Qualification
  const qualBadge = document.getElementById("audit-qualification-badge");
  const startBtn  = document.getElementById("btn-start-challenge");
  if (c.fast_track_qualified) {
    qualBadge.className = "mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold w-fit";
    qualBadge.innerHTML = `<i data-lucide="zap" class="w-3 h-3 text-blue-600"></i><span>Fast-Track Qualified</span>`;
    startBtn.classList.remove("hidden");
  } else {
    qualBadge.className = "mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 text-xs font-semibold w-fit";
    qualBadge.innerHTML = `<i data-lucide="shield-x" class="w-3 h-3"></i><span>Cold Queue Only</span>`;
    startBtn.classList.add("hidden");
  }

  // Update Status Board Title to Candidate's Name
  const headingName = document.getElementById("status-board-candidate-name");
  if (headingName) {
    headingName.textContent = c.full_name ? `${c.full_name} (@${c.github_username})` : `@${c.github_username}`;
  }

  // Reload the status board and available jobs strictly for this audited candidate
  loadCandidateStatusBoard();
  loadCandidateJobs();

  // Gemini Analysis Banner
  const geminiBanner = document.getElementById("gemini-audit-banner");
  if (c.gemini_analysis) {
    geminiBanner.classList.remove("hidden");
    document.getElementById("gemini-audit-text").textContent = c.gemini_analysis;
  } else {
    geminiBanner.classList.add("hidden");
  }

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

  lucide.createIcons();
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
        ${isHuman ? '✓ Verified Progressive Human Cadence' : '⚠ Flagged 1-Commit AI/Bulk Dump'}
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
    <div class="rounded-lg bg-purple-50 border border-purple-200 p-3 space-y-1">
      <div class="font-bold text-purple-900 flex items-center gap-1">
        <i data-lucide="sparkles" class="w-3 h-3 text-purple-600"></i>
        <span>Gemini Architectural Evaluation</span>
      </div>
      <p class="text-purple-800 leading-relaxed">${r.gemini_summary}</p>
    </div>` : ''}
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
    const isRejected  = app.status === "rejected_with_feedback";

    let borderClass = "border-slate-200 hover:border-blue-400 bg-white";
    let statusPill  = "";

    if (isGhosted) {
      borderClass = "border-rose-300 bg-rose-50/40 hover:border-rose-400";
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3 text-rose-600"></i><span>SLA BREACHED (${sla.overdue_hours || 1}h overdue)</span></span>`;
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
//  CANDIDATE: AVAILABLE ROLES & TAILORED MICRO-ASSESSMENTS
// ─────────────────────────────────────────────────────────────────────────────

function scrollToJobOpenings() {
  const el = document.getElementById("section-available-jobs");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

async function loadCandidateJobs() {
  const container = document.getElementById("grid-candidate-jobs");
  if (!container) return;

  // Ensure jobs are bootstrapped
  if (!allJobs.length) {
    try {
      const res = await fetch("/api/employer/jobs");
      if (res.ok) {
        const data = await res.json();
        allJobs = data.map(x => x.job);
      }
    } catch (e) {
      console.error(e);
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

  allJobs.forEach(job => {
    const existing = appliedMap[job.id];
    const isApplied = !!existing;

    // Challenge metadata matched to stack
    let challengeTitle = "Fix Concurrency Race Condition in Shared Token Bucket";
    let challengeFile = "token_bucket.py";
    let conceptTag = "Asyncio Concurrency";

    const stackLower = (job.stack_tags || []).join(" ").toLowerCase();
    if (stackLower.includes("sqlalchemy") || stackLower.includes("postgresql") || stackLower.includes("database")) {
      challengeTitle = "Resolve Database Connection Leak in Async Repository";
      challengeFile = "db_repository.py";
      conceptTag = "Resource Management";
    } else if (stackLower.includes("resilience") || stackLower.includes("websockets") || stackLower.includes("distributed systems") || stackLower.includes("aws")) {
      challengeTitle = "Prevent Thundering Herd Retry Storm with Exponential Backoff";
      challengeFile = "resilience_client.py";
      conceptTag = "Distributed Resilience";
    }

    const card = document.createElement("div");
    card.className = `p-4 rounded-xl border ${isApplied ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200 bg-white hover:border-blue-400'} shadow-sm flex flex-col justify-between gap-3 transition`;

    const stackPills = (job.stack_tags || [])
      .slice(0, 3)
      .map(t => `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-mono text-[10px]">${t}</span>`)
      .join(" ");

    let actionButton = "";
    if (isApplied) {
      const st = existing.application.status;
      let statusText = "Active Fast-Track #1";
      if (st === "interview_scheduled") statusText = "Interview Scheduled";
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
    } else {
      actionButton = `
        <button onclick="startJobChallenge('${job.id}')"
          class="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-1.5 transition">
          <span>Take 5-Min Test for this Role</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      `;
    }

    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <span class="w-5 h-5 rounded-md bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">
              ${(job.company_name || 'C').charAt(0)}
            </span>
            <span>${job.company_name}</span>
          </span>
          <span class="text-[10px] text-emerald-700 font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
            72h Anti-Ghost SLA
          </span>
        </div>

        <div>
          <h4 class="text-xs font-bold text-slate-900 leading-snug">${job.title}</h4>
          <p class="text-[11px] text-slate-500 line-clamp-2 mt-0.5">${job.description}</p>
        </div>

        <div class="flex items-center gap-1 flex-wrap">
          ${stackPills}
        </div>

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
    sandbox.scrollIntoView({ behavior: "smooth" });
    lucide.createIcons();
  } catch (err) {
    showToast("Error starting challenge: " + err.message, "error");
  }
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
      loadCandidateStatusBoard();
      loadCandidateJobs();
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
        <div class="flex items-center gap-2">
          <button onclick="event.stopPropagation(); openDispositionModal('${app.id}', 'schedule_interview')"
            class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition shadow-sm">
            <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
            <span>Schedule</span>
          </button>
          <button onclick="event.stopPropagation(); openDispositionModal('${app.id}', 'reject_with_feedback')"
            class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs border border-slate-200 transition">
            Pass w/ Feedback
          </button>
          <button onclick="event.stopPropagation(); openGhostModal('${app.id}')"
            title="Simulate 72h inactivity"
            class="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition">
            Simulate Ghost
          </button>
        </div>
      `;
    } else if (isInterview) {
      actionBtns = `<span class="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold text-xs">Interview: ${app.interview_time || 'Scheduled'}</span>`;
    } else if (isRejected) {
      actionBtns = `<span class="px-2.5 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium text-xs">Closed with Feedback</span>`;
    } else if (isGhosted) {
      actionBtns = `<span class="px-2.5 py-1 rounded bg-rose-100 text-rose-800 border border-rose-300 font-bold text-xs">Ghosted (Score Penalized)</span>`;
    }

    const card = document.createElement("div");
    card.className = `bg-white rounded-xl border ${isGhosted ? 'border-rose-300 bg-rose-50/20' : 'border-slate-200'} p-4 space-y-3 hover:border-slate-300 cursor-pointer transition shadow-sm`;
    card.onclick = () => openApplicationStatusModal(app.id);
    card.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center border border-slate-200">
            #${index + 1}
          </span>
          <img src="${cand.avatar_url || 'https://avatars.githubusercontent.com/u/8942111?v=4'}" class="w-10 h-10 rounded-full border border-slate-200">
          <div>
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-slate-900 text-sm">${app.candidate_name}</h4>
              <span class="font-mono text-xs text-blue-600">@${app.github_username}</span>
            </div>
            <p class="text-[11px] text-slate-500 line-clamp-1">${cand.bio || 'Verified Developer'}</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Proof Score</div>
            <div class="text-base font-black text-emerald-600">${app.composite_score}%</div>
          </div>
          ${slaBadge}
        </div>
      </div>

      <div class="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 text-xs text-slate-500">
          <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-600"></i>
          <span>Git Provenance Verified · 5-Min Bug Fix Cleared</span>
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
        <span class="text-rose-600">${spam.warning}</span>
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
    loadEmployerCockpit();
    loadCandidateStatusBoard();
  } catch (err) {
    showToast("Simulation error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Confirm SLA Breach</span>`;
  }
}
