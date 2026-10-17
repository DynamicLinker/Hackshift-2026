import threading
from typing import Dict, List, Optional
from datetime import datetime, timezone, timedelta
from app.models import Company, Job, CandidateProfile, AssessmentChallenge, Application


class DataStore:
    def __init__(self):
        self._lock = threading.Lock()
        self.companies: Dict[str, Company] = {}
        self.jobs: Dict[str, Job] = {}
        self.candidates: Dict[str, CandidateProfile] = {}
        self.assessments: Dict[str, AssessmentChallenge] = {}
        self.applications: Dict[str, Application] = {}
        self._seed_initial_data()

    def _seed_initial_data(self):
        now = datetime.now(timezone.utc)

        # ── Companies ──────────────────────────────────────────────────────────
        comp_acme = Company(
            id="comp-acme",
            name="Acme Systems",
            popularity_score=98.0,
            total_openings=2,
            response_rate=98.5,
            avg_response_hours=26.0,
            is_verified_responsive=True,
        )
        comp_nova = Company(
            id="comp-nova",
            name="Nova Labs",
            popularity_score=91.0,
            total_openings=1,
            response_rate=87.5,
            avg_response_hours=48.0,
            is_verified_responsive=True,
        )
        comp_ghost = Company(
            id="comp-phantom",
            name="Phantom Corp",
            popularity_score=54.5,
            total_openings=1,
            response_rate=48.0,
            avg_response_hours=120.0,
            is_verified_responsive=False,
        )
        for c in [comp_acme, comp_nova, comp_ghost]:
            self.companies[c.id] = c

        # ── Jobs ───────────────────────────────────────────────────────────────
        job1 = Job(
            id="job-backend-fastapi",
            company_id=comp_acme.id,
            company_name=comp_acme.name,
            title="Senior Backend Engineer (FastAPI / PostgreSQL)",
            stack_tags=["Python", "FastAPI", "PostgreSQL", "Redis", "Docker"],
            description="Build low-latency distributed APIs, manage database connection pools, and design scalable asynchronous task queues.",
            experience_level="Mid / Senior",
            salary_range="INR 14 - 22 LPA",
        )
        job2 = Job(
            id="job-fullstack-node",
            company_id=comp_acme.id,
            company_name=comp_acme.name,
            title="Full-Stack Engineer (React / Node / Go)",
            stack_tags=["TypeScript", "React", "Node.js", "Go", "WebSockets"],
            description="Architect real-time collaborative interfaces and high-throughput microservices.",
            experience_level="Junior / Mid",
            salary_range="INR 12 - 16 LPA",
        )
        job3 = Job(
            id="job-mlops-nova",
            company_id=comp_nova.id,
            company_name=comp_nova.name,
            title="MLOps Engineer (Kubernetes / Triton)",
            stack_tags=["Python", "Kubernetes", "Docker", "Triton", "PyTorch"],
            description="Deploy and serve large-scale ML models, maintain training pipelines, and optimize inference throughput.",
            experience_level="Senior",
            salary_range="INR 20 - 32 LPA",
        )
        job4 = Job(
            id="job-devops-phantom",
            company_id=comp_ghost.id,
            company_name=comp_ghost.name,
            title="DevOps Architect (AWS / Terraform)",
            stack_tags=["AWS", "Terraform", "Python", "Ansible", "CI/CD"],
            description="Design multi-region AWS infrastructure, CI/CD pipelines, and disaster recovery protocols.",
            experience_level="Senior",
            salary_range="INR 18 - 28 LPA",
        )
        for j in [job1, job2, job3, job4]:
            self.jobs[j.id] = j

        # ── Candidates ────────────────────────────────────────────────────────
        # Primary candidate for Candidate Portal (matches default input iiitd-dev)
        c_me = CandidateProfile(
            id="cand_iiitd-dev",
            github_username="iiitd-dev",
            full_name="Aarav Sharma",
            avatar_url="https://avatars.githubusercontent.com/u/8942111?v=4",
            bio="CS student at IIIT Delhi building distributed systems & backend APIs",
            is_bot=False,
            git_provenance_score=94.5,
            commit_topology_status="verified_human",
            credibility_score=95.0,
            fast_track_qualified=True,
        )
        c2 = CandidateProfile(
            id="cand-ananya",
            github_username="ananya-fastapi",
            full_name="Ananya Sharma",
            avatar_url="https://avatars.githubusercontent.com/u/583231?v=4",
            bio="Backend developer with focus on Redis caching and high concurrency",
            is_bot=False,
            git_provenance_score=94.0,
            commit_topology_status="verified_human",
            credibility_score=94.0,
            fast_track_qualified=True,
        )
        c3 = CandidateProfile(
            id="cand-rohan",
            github_username="rohan-verma-dev",
            full_name="Rohan Verma",
            avatar_url="https://avatars.githubusercontent.com/u/1024025?v=4",
            bio="Open source contributor & MLOps practitioner. Love Kubernetes and PyTorch.",
            is_bot=False,
            git_provenance_score=91.0,
            commit_topology_status="verified_human",
            credibility_score=91.0,
            fast_track_qualified=True,
        )
        for c in [c_me, c2, c3]:
            self.candidates[c.id] = c

        # ── Applications ─────────────────────────────────────────────────────
        # 1. Aarav Sharma (YOU) applied across 3 different companies:
        # App 1: Acme Systems → Pending review (within 72h SLA, 48h remaining)
        app1 = Application(
            id="app-1",
            job_id=job1.id,
            candidate_id=c_me.id,
            candidate_name=c_me.full_name,
            github_username=c_me.github_username,
            queue_type="fast_track",
            composite_score=96.0,
            submitted_at=(now - timedelta(hours=24)).isoformat(),
            sla_deadline=(now + timedelta(hours=48)).isoformat(),
            status="pending",
        )
        # App 2: Nova Labs → Interview Scheduled!
        app2 = Application(
            id="app-2",
            job_id=job3.id,
            candidate_id=c_me.id,
            candidate_name=c_me.full_name,
            github_username=c_me.github_username,
            queue_type="fast_track",
            composite_score=93.5,
            submitted_at=(now - timedelta(hours=36)).isoformat(),
            sla_deadline=(now + timedelta(hours=36)).isoformat(),
            status="interview_scheduled",
            disposition_at=(now - timedelta(hours=12)).isoformat(),
            disposition_note="Impression: Outstanding AST code architecture.",
            interview_time="Thursday at 3:00 PM IST",
        )
        # App 3: Phantom Corp → GHOSTED (SLA Breached: 80h elapsed without response)
        app3 = Application(
            id="app-3",
            job_id=job4.id,
            candidate_id=c_me.id,
            candidate_name=c_me.full_name,
            github_username=c_me.github_username,
            queue_type="fast_track",
            composite_score=89.0,
            submitted_at=(now - timedelta(hours=80)).isoformat(),
            sla_deadline=(now - timedelta(hours=8)).isoformat(),
            status="ghosted",
        )

        # 2. Competitors in Acme Systems' Fast-Track Queue (shows judges real queue ranking)
        app4 = Application(
            id="app-4",
            job_id=job1.id,
            candidate_id=c2.id,
            candidate_name=c2.full_name,
            github_username=c2.github_username,
            queue_type="fast_track",
            composite_score=94.0,
            submitted_at=(now - timedelta(hours=52)).isoformat(),
            sla_deadline=(now + timedelta(hours=20)).isoformat(),
            status="pending",
        )
        app5 = Application(
            id="app-5",
            job_id=job1.id,
            candidate_id=c3.id,
            candidate_name=c3.full_name,
            github_username=c3.github_username,
            queue_type="fast_track",
            composite_score=91.0,
            submitted_at=(now - timedelta(hours=12)).isoformat(),
            sla_deadline=(now + timedelta(hours=60)).isoformat(),
            status="pending",
        )
        for a in [app1, app2, app3, app4, app5]:
            self.applications[a.id] = a

    # ── Company CRUD ──────────────────────────────────────────────────────────
    def get_company(self, company_id: str) -> Optional[Company]:
        with self._lock:
            return self.companies.get(company_id)

    def list_companies(self) -> List[Company]:
        with self._lock:
            return list(self.companies.values())

    # ── Job CRUD ──────────────────────────────────────────────────────────────
    def list_jobs(self) -> List[Job]:
        with self._lock:
            return list(self.jobs.values())

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self.jobs.get(job_id)

    def add_job(self, job: Job):
        with self._lock:
            self.jobs[job.id] = job

    # ── Candidate CRUD ────────────────────────────────────────────────────────
    def get_candidate(self, candidate_id: str) -> Optional[CandidateProfile]:
        with self._lock:
            return self.candidates.get(candidate_id)

    def get_candidate_by_username(self, username: str) -> Optional[CandidateProfile]:
        with self._lock:
            for c in self.candidates.values():
                if c.github_username.lower() == username.lower():
                    return c
            return None

    def save_candidate(self, candidate: CandidateProfile):
        with self._lock:
            self.candidates[candidate.id] = candidate

    # ── Assessment CRUD ───────────────────────────────────────────────────────
    def save_assessment(self, challenge: AssessmentChallenge):
        with self._lock:
            self.assessments[challenge.id] = challenge

    def get_assessment(self, challenge_id: str) -> Optional[AssessmentChallenge]:
        with self._lock:
            return self.assessments.get(challenge_id)

    # ── Application CRUD ──────────────────────────────────────────────────────
    def list_applications_for_job(self, job_id: str) -> List[Application]:
        with self._lock:
            return [app for app in self.applications.values() if app.job_id == job_id]

    def save_application(self, app: Application):
        with self._lock:
            self.applications[app.id] = app

    def get_application(self, app_id: str) -> Optional[Application]:
        with self._lock:
            return self.applications.get(app_id)


db = DataStore()
