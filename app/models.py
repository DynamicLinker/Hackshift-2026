from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class Company(BaseModel):
    id: str
    name: str
    popularity_score: float = 98.0
    total_openings: int = 1
    response_rate: float = 98.5
    avg_response_hours: float = 26.0
    is_verified_responsive: bool = True

class Job(BaseModel):
    id: str
    company_id: str
    company_name: str
    title: str
    stack_tags: List[str]
    description: str
    experience_level: str = "Junior / Mid"
    salary_range: str = "INR 12 - 18 LPA"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    active: bool = True

class RepositoryAudit(BaseModel):
    repo_name: str
    primary_language: str
    total_commits: int
    commit_distribution: str  # "progressive_iterative" or "single_bulk_dump"
    key_technologies: List[str]
    provenance_rating: float  # 0 to 100
    repo_url: Optional[str] = None
    gemini_summary: Optional[str] = None

class CandidateProfile(BaseModel):
    id: str
    github_username: str
    full_name: str
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    is_bot: bool = False
    git_provenance_score: float = 0.0
    commit_topology_status: str = "pending"  # "verified_human" or "flagged_bulk_dump"
    audited_repos: List[RepositoryAudit] = []
    credibility_score: float = 0.0
    fast_track_qualified: bool = False
    cloned_locally: bool = False
    gemini_analysis: Optional[str] = None

class AssessmentChallenge(BaseModel):
    id: str
    candidate_id: str
    job_id: str
    self_repo_prompt: str
    target_repo: str
    target_file: str
    target_line: int
    bug_fix_title: str
    bug_fix_instructions: str
    buggy_code_snippet: str
    expected_concept: str
    duration_seconds: int = 300
    started_at: str
    completed: bool = False
    score: float = 0.0
    status: str = "pending"  # "pending", "passed", "failed", "timed_out"

class AssessmentSubmission(BaseModel):
    challenge_id: str
    self_repo_explanation: str
    fixed_code: str

class Application(BaseModel):
    id: str
    job_id: str
    candidate_id: str
    candidate_name: str
    github_username: str
    queue_type: str  # "fast_track" or "cold_unscreened"
    composite_score: float
    submitted_at: str
    sla_deadline: str
    status: str = "pending"  # "pending", "interview_scheduled", "rejected_with_feedback", "ghosted"
    disposition_at: Optional[str] = None
    disposition_note: Optional[str] = None
    interview_time: Optional[str] = None
