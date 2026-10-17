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
        # Seed default company
        company = Company(
            id="comp-acme",
            name="Acme Systems",
            popularity_score=98.0,
            total_openings=2,
            response_rate=98.5,
            avg_response_hours=26.0,
            is_verified_responsive=True
        )
        self.companies[company.id] = company

        # Seed default jobs
        job1 = Job(
            id="job-backend-fastapi",
            company_id=company.id,
            company_name=company.name,
            title="Senior Backend Engineer (FastAPI / PostgreSQL)",
            stack_tags=["Python", "FastAPI", "PostgreSQL", "Redis", "Docker"],
            description="Build low-latency distributed APIs, manage database connection pools, and design scalable asynchronous task queues.",
            experience_level="Mid / Senior",
            salary_range="INR 14 - 22 LPA"
        )
        self.jobs[job1.id] = job1

        job2 = Job(
            id="job-fullstack-node",
            company_id=company.id,
            company_name=company.name,
            title="Full-Stack Engineer (React / Node / Go)",
            stack_tags=["TypeScript", "React", "Node.js", "Go", "WebSockets"],
            description="Architect real-time collaborative interfaces and high-throughput microservices.",
            experience_level="Junior / Mid",
            salary_range="INR 12 - 16 LPA"
        )
        self.jobs[job2.id] = job2

        # Seed initial fast-track and cold applications for demo realism
        now = datetime.now(timezone.utc)
        
        # 3 pre-vetted candidates in Fast-Track
        c1 = CandidateProfile(
            id="cand-ajitesh",
            github_username="ajitesh-iiitd",
            full_name="Ajitesh Chaurasia",
            avatar_url="https://github.com/identicons/ajitesh.png",
            bio="CS student at IIIT Delhi building distributed systems & backend APIs",
            is_bot=False,
            git_provenance_score=98.0,
            commit_topology_status="verified_human",
            credibility_score=98.0,
            fast_track_qualified=True
        )
        self.candidates[c1.id] = c1

        app1 = Application(
            id="app-1",
            job_id=job1.id,
            candidate_id=c1.id,
            candidate_name=c1.full_name,
            github_username=c1.github_username,
            queue_type="fast_track",
            composite_score=98.0,
            submitted_at=(now - timedelta(hours=24)).isoformat(),
            sla_deadline=(now + timedelta(hours=48)).isoformat(),
            status="pending"
        )
        self.applications[app1.id] = app1

        c2 = CandidateProfile(
            id="cand-ananya",
            github_username="ananya-fastapi",
            full_name="Ananya Sharma",
            avatar_url="https://github.com/identicons/ananya.png",
            bio="Backend developer with focus on Redis caching and high concurrency",
            is_bot=False,
            git_provenance_score=94.0,
            commit_topology_status="verified_human",
            credibility_score=94.0,
            fast_track_qualified=True
        )
        self.candidates[c2.id] = c2

        app2 = Application(
            id="app-2",
            job_id=job1.id,
            candidate_id=c2.id,
            candidate_name=c2.full_name,
            github_username=c2.github_username,
            queue_type="fast_track",
            composite_score=94.0,
            submitted_at=(now - timedelta(hours=16)).isoformat(),
            sla_deadline=(now + timedelta(hours=56)).isoformat(),
            status="pending"
        )
        self.applications[app2.id] = app2

    def get_company(self, company_id: str) -> Optional[Company]:
        with self._lock:
            return self.companies.get(company_id)

    def list_jobs(self) -> List[Job]:
        with self._lock:
            return list(self.jobs.values())

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self.jobs.get(job_id)

    def add_job(self, job: Job):
        with self._lock:
            self.jobs[job.id] = job

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

    def save_assessment(self, challenge: AssessmentChallenge):
        with self._lock:
            self.assessments[challenge.id] = challenge

    def get_assessment(self, challenge_id: str) -> Optional[AssessmentChallenge]:
        with self._lock:
            return self.assessments.get(challenge_id)

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
