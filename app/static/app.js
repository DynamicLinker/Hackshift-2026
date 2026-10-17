// ProofHired Frontend Orchestrator
let currentCandidate = null;
let currentChallenge = null;
let currentJob = null;
let timerInterval = null;
let secondsRemaining = 300;

document.addEventListener("DOMContentLoaded", () => {
  loadEmployerJobs();
});

function showToast(message) {
  const toast = document.getElementById("toast");
  const msg = document.getElementById("toast-msg");
  if (!toast || !msg) return;
  msg.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function switchTab(tab) {
  const candTab = document.getElementById("tab-candidate");
  const empTab = document.getElementById("tab-employer");
  const btnCand = document.getElementById("btn-tab-candidate");
  const btnEmp = document.getElementById("btn-tab-employer");

  if (tab === "candidate") {
    candTab.classList.remove("hidden");
    empTab.classList.add("hidden");
    btnCand.className = "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all bg-cyan-500 text-slate-950 shadow-md";
    btnEmp.className = "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all text-slate-300 hover:text-white";
  } else {
    candTab.classList.add("hidden");
    empTab.classList.remove("hidden");
    btnEmp.className = "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all bg-cyan-500 text-slate-950 shadow-md";
    btnCand.className = "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all text-slate-300 hover:text-white";
    loadEmployerCockpit();
  }
  lucide.createIcons();
}

function setCandidateDemo(username) {
  switchTab("candidate");
  document.getElementById("input-github-user").value = username;
  runCandidateAudit();
}

async function runCandidateAudit() {
  const username = document.getElementById("input-github-user").value.trim();
  if (!username) {
    showToast("Please enter a GitHub username.");
    return;
  }

  const btn = document.getElementById("btn-audit");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Auditing...</span>`;
  lucide.createIcons();

  try {
    const res = await fetch("/api/candidate/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_username: username }),
    });

    if (!res.ok) throw new Error("Audit failed");
    const data = await res.json();
    currentCandidate = data;
    renderAuditResults(data);
  } catch (err) {
    showToast("Error auditing repository: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="cpu" class="w-4 h-4"></i><span>Audit Git Provenance</span>`;
    lucide.createIcons();
  }
}

function renderAuditResults(c) {
  document.getElementById("section-audit-results").classList.remove("hidden");
  document.getElementById("section-challenge-sandbox").classList.add("hidden");
  document.getElementById("section-vault-success").classList.add("hidden");

  // Populate Profile
  document.getElementById("audit-fullname").textContent = c.full_name;
  document.getElementById("audit-username").textContent = "@" + c.github_username;
  document.getElementById("audit-bio").textContent = c.bio || "Active Developer";
  if (c.avatar_url) {
    document.getElementById("audit-avatar").src = c.avatar_url;
  }

  // Provenance Score
  const scoreEl = document.getElementById("audit-provenance-score");
  scoreEl.textContent = `${c.git_provenance_score}%`;
  scoreEl.className = c.git_provenance_score >= 70 
    ? "text-3xl font-black text-emerald-400" 
    : "text-3xl font-black text-rose-400";

  // Topology Badge
  const badgeTopology = document.getElementById("audit-topology-badge");
  if (c.commit_topology_status === "verified_human") {
    badgeTopology.className = "mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold w-fit";
    badgeTopology.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5"></i><span>Verified Human Developer</span>`;
  } else {
    badgeTopology.className = "mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-bold w-fit";
    badgeTopology.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i><span>Flagged: 1-Commit Bulk Dump</span>`;
  }

  // Qualification & Challenge Button
  const qualBadge = document.getElementById("audit-qualification-badge");
  const startBtn = document.getElementById("btn-start-challenge");
  if (c.fast_track_qualified) {
    qualBadge.className = "mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 text-xs font-bold w-fit";
    qualBadge.innerHTML = `<i data-lucide="zap" class="w-3.5 h-3.5"></i><span>Fast-Track Eligible</span>`;
    startBtn.classList.remove("hidden");
  } else {
    qualBadge.className = "mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 text-xs font-bold w-fit";
    qualBadge.innerHTML = `<i data-lucide="shield-alert" class="w-3.5 h-3.5"></i><span>Cold Queue Only</span>`;
    startBtn.classList.add("hidden");
  }

  // Populate Audited Repos Table
  const tbody = document.getElementById("table-audited-repos");
  tbody.innerHTML = "";

  (c.audited_repos || []).forEach(r => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-800/40 transition";
    
    const distBadge = r.commit_distribution === "progressive_iterative"
      ? `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Progressive (${r.total_commits} commits)</span>`
      : `<span class="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">1-Commit Dump (${r.total_commits} commit)</span>`;

    const tagsHtml = (r.key_technologies || [])
      .map(t => `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] mr-1">${t}</span>`)
      .join("");

    tr.innerHTML = `
      <td class="py-3 px-4 font-mono font-semibold text-white flex items-center gap-2">
        <i data-lucide="git-branch" class="w-3.5 h-3.5 text-slate-500"></i>
        ${r.repo_name}
      </td>
      <td class="py-3 px-4 font-medium text-slate-300">${r.primary_language}</td>
      <td class="py-3 px-4">${distBadge}</td>
      <td class="py-3 px-4">${tagsHtml}</td>
      <td class="py-3 px-4 text-right font-mono font-bold ${r.provenance_rating >= 70 ? 'text-emerald-400' : 'text-rose-400'}">
        ${r.provenance_rating}%
      </td>
    `;
    tbody.appendChild(tr);
  });

  lucide.createIcons();
}

async function loadEmployerJobs() {
  try {
    const res = await fetch("/api/employer/jobs");
    if (!res.ok) return;
    const data = await res.json();
    if (data.length > 0) {
      currentJob = data[0].job;
    }
  } catch (err) {
    console.error("Failed to load jobs", err);
  }
}

async function startChallengeModal() {
  if (!currentCandidate) return;

  if (!currentJob) {
    await loadEmployerJobs();
  }

  try {
    const res = await fetch("/api/candidate/assessment/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: currentCandidate.id,
        job_id: currentJob ? currentJob.id : "job-backend-fastapi",
      }),
    });

    if (!res.ok) throw new Error("Could not start assessment");
    const ch = await res.json();
    currentChallenge = ch;

    // Render Sandbox
    const sandbox = document.getElementById("section-challenge-sandbox");
    sandbox.classList.remove("hidden");
    
    document.getElementById("challenge-job-title").textContent = `Challenge for ${currentJob ? currentJob.title : 'Backend SDE'}`;
    document.getElementById("challenge-self-prompt").textContent = ch.self_repo_prompt;
    document.getElementById("challenge-bug-title").textContent = ch.bug_fix_title;
    document.getElementById("challenge-bug-instructions").textContent = ch.bug_fix_instructions;
    document.getElementById("challenge-concept").textContent = ch.expected_concept;
    document.getElementById("input-code-editor").value = ch.buggy_code_snippet;
    document.getElementById("input-self-explanation").value = "";

    // Start 300s Countdown
    startTimer(ch.duration_seconds || 300);

    // Smooth scroll down to sandbox
    sandbox.scrollIntoView({ behavior: "smooth" });
    lucide.createIcons();
  } catch (err) {
    showToast("Error starting challenge: " + err.message);
  }
}

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  secondsRemaining = seconds;

  const timerEl = document.getElementById("timer-display");

  function update() {
    const m = Math.floor(secondsRemaining / 60);
    const s = secondsRemaining % 60;
    timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    if (secondsRemaining <= 60) {
      timerEl.className = "text-2xl font-mono font-black text-rose-500 pulse-urgent";
    } else if (secondsRemaining <= 120) {
      timerEl.className = "text-2xl font-mono font-black text-amber-400";
    } else {
      timerEl.className = "text-2xl font-mono font-black text-emerald-400";
    }

    if (secondsRemaining <= 0) {
      clearInterval(timerInterval);
      showToast("Time expired! Submitting available code...");
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
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Validating on Server...</span>`;
  lucide.createIcons();

  try {
    const res = await fetch("/api/candidate/assessment/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: currentChallenge.id,
        self_repo_explanation: explanation || "Handled backpressure with async queue buffer.",
        fixed_code: code,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || "Submission failed");
    }

    const data = await res.json();
    if (data.evaluation.passed) {
      document.getElementById("section-challenge-sandbox").classList.add("hidden");
      document.getElementById("section-vault-success").classList.remove("hidden");
      showToast("Verification passed! Vaulted to #1 on Fast-Track Queue.");
    } else {
      showToast(`Assessment failed (${data.evaluation.score}/100): ${data.evaluation.feedback}`);
    }
  } catch (err) {
    showToast("Submission error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check-check" class="w-4 h-4"></i><span>Submit & Vault to Fast-Track</span>`;
    lucide.createIcons();
  }
}

async function loadEmployerCockpit() {
  try {
    const resJobs = await fetch("/api/employer/jobs");
    if (!resJobs.ok) return;
    const jobsData = await resJobs.json();
    if (jobsData.length === 0) return;

    const firstJob = jobsData[0].job;
    const resApps = await fetch(`/api/employer/jobs/${firstJob.id}/applications`);
    if (!resApps.ok) return;
    const appsData = await resApps.json();

    const resCompany = await fetch("/api/employer/company/comp-acme");
    if (resCompany.ok) {
      const comp = await resCompany.json();
      document.getElementById("metric-popularity").textContent = `${comp.popularity_score}%`;
      document.getElementById("metric-compliance").textContent = `${comp.response_rate}%`;
    }

    renderEmployerQueues(appsData);
  } catch (err) {
    console.error("Cockpit load error", err);
  }
}

function renderEmployerQueues(data) {
  document.getElementById("label-fast-track-count").textContent = `${data.fast_track_total} Fast-Track Candidates`;

  // Render Fast-Track Queue
  const listFast = document.getElementById("list-fast-track");
  listFast.innerHTML = "";

  (data.fast_track_queue || []).forEach((item, index) => {
    const app = item.application;
    const cand = item.candidate || {};
    const sla = item.sla || {};

    const card = document.createElement("div");
    card.className = "rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4 hover:border-slate-700 transition";

    let slaBadgeClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (sla.status === "sla_urgent") {
      slaBadgeClass = "bg-amber-500/10 text-amber-400 border-amber-500/20 pulse-urgent";
    } else if (sla.status === "sla_breached") {
      slaBadgeClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
    }

    let statusDisplay = "";
    if (app.status === "interview_scheduled") {
      statusDisplay = `<span class="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-bold text-xs">Interview: ${app.interview_time || 'Scheduled'}</span>`;
    } else if (app.status === "rejected_with_feedback") {
      statusDisplay = `<span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 font-medium text-xs">Closed with Feedback</span>`;
    } else {
      statusDisplay = `
        <div class="flex items-center gap-2">
          <button onclick="openDispositionModal('${app.id}', 'schedule_interview')" class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition">
            <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
            <span>Schedule Interview</span>
          </button>
          <button onclick="openDispositionModal('${app.id}', 'reject_with_feedback')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition">
            <span>Pass w/ Feedback</span>
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="w-7 h-7 rounded-full bg-slate-800 text-cyan-400 font-mono font-black text-xs flex items-center justify-center border border-slate-700">
            #${index + 1}
          </span>
          <img src="${cand.avatar_url || 'https://avatars.githubusercontent.com/u/8942111?v=4'}" class="w-10 h-10 rounded-full border border-cyan-500/40">
          <div>
            <div class="flex items-center gap-2">
              <h5 class="font-bold text-white text-sm">${app.candidate_name}</h5>
              <span class="font-mono text-xs text-cyan-400">@${app.github_username}</span>
            </div>
            <p class="text-[11px] text-slate-400 line-clamp-1">${cand.bio || 'Verified Systems Engineer'}</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Proof Score</div>
            <div class="text-lg font-black text-emerald-400">${app.composite_score}%</div>
          </div>
          <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold ${slaBadgeClass}">
            <i data-lucide="clock" class="w-3.5 h-3.5"></i>
            <span>${sla.badge_label || 'Within SLA'}</span>
          </div>
        </div>
      </div>

      <div class="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <i data-lucide="shield-check" class="w-4 h-4 text-emerald-400"></i>
          <span>Verified Commit Provenance & Self-Repo Comprehension</span>
        </div>
        <div>${statusDisplay}</div>
      </div>
    `;

    listFast.appendChild(card);
  });

  // Render Cold Spam Queue
  const listCold = document.getElementById("list-cold-spam");
  listCold.innerHTML = "";

  (data.cold_queue_samples || []).forEach(spam => {
    const el = document.createElement("div");
    el.className = "p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1 text-xs opacity-75 hover:opacity-100 transition";
    el.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-300">${spam.name}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">Spam Filtered</span>
      </div>
      <p class="text-[11px] text-slate-500">${spam.headline}</p>
      <div class="flex items-center justify-between text-[10px] text-slate-500 pt-1">
        <span>Git Provenance: ${spam.git_provenance}</span>
        <span class="text-rose-400">${spam.warning}</span>
      </div>
    `;
    listCold.appendChild(el);
  });

  lucide.createIcons();
}

function openDispositionModal(appId, action) {
  const modal = document.getElementById("modal-disposition");
  const title = document.getElementById("modal-disp-title");
  const content = document.getElementById("modal-disp-content");
  document.getElementById("modal-disp-appid").value = appId;
  document.getElementById("modal-disp-action").value = action;

  if (action === "schedule_interview") {
    title.textContent = "Schedule 48-Hour Technical Round";
    content.innerHTML = `
      <p class="text-xs text-slate-300">
        Candidate will be invited to a 48-hour direct slot. This preserves your <strong>Verified Responsive Employer</strong> badge.
      </p>
      <label class="block text-xs font-semibold text-slate-400">Interview Slot (IST):</label>
      <input id="input-interview-slot" type="text" value="Thursday at 3:00 PM IST" class="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white">
      <label class="block text-xs font-semibold text-slate-400">Personalized Note:</label>
      <input id="input-interview-note" type="text" value="Impression: Outstanding code fix on the asyncio token bucket." class="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white">
    `;
  } else {
    title.textContent = "Pass with Constructive Feedback";
    content.innerHTML = `
      <p class="text-xs text-slate-300">
        Employers must reject 95% of candidates. <strong>You are not penalized for rejecting</strong>, only for ghosting!
      </p>
      <label class="block text-xs font-semibold text-slate-400">Constructive Feedback Note:</label>
      <textarea id="input-rejection-note" rows="3" class="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white">Strong GitHub foundations, but needs more experience in high-throughput PostgreSQL connection pooling.</textarea>
    `;
  }

  modal.classList.remove("hidden");
}

function closeDispositionModal() {
  document.getElementById("modal-disposition").classList.add("hidden");
}

async function executeDisposition() {
  const appId = document.getElementById("modal-disp-appid").value;
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
    closeDispositionModal();
    showToast(action === "schedule_interview" ? "Interview invite dispatched!" : "Candidate notified with feedback.");
    loadEmployerCockpit();
  } catch (err) {
    showToast("Error updating disposition: " + err.message);
  }
}
