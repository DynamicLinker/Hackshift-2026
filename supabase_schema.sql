-- =============================================================================
-- Horizon - Zero-Resume Proof-of-Competence Marketplace
-- Supabase PostgreSQL Schema & Seed Migration
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. COMPANIES
CREATE TABLE IF NOT EXISTS public.companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    popularity_score NUMERIC(5,2) DEFAULT 98.0,
    total_openings INT DEFAULT 1,
    response_rate NUMERIC(5,2) DEFAULT 98.5,
    avg_response_hours NUMERIC(5,2) DEFAULT 26.0,
    is_verified_responsive BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. JOBS
CREATE TABLE IF NOT EXISTS public.jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    title TEXT NOT NULL,
    stack_tags JSONB DEFAULT '[]'::jsonb,
    description TEXT NOT NULL,
    experience_level TEXT DEFAULT 'Mid / Senior',
    salary_range TEXT DEFAULT 'INR 18 - 28 LPA',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CANDIDATES
CREATE TABLE IF NOT EXISTS public.candidates (
    id TEXT PRIMARY KEY,
    github_username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    bio TEXT,
    is_bot BOOLEAN DEFAULT FALSE,
    git_provenance_score NUMERIC(5,2) DEFAULT 0.0,
    commit_topology_status TEXT DEFAULT 'verified_human',
    fast_track_qualified BOOLEAN DEFAULT FALSE,
    ownership_status TEXT DEFAULT 'verified_contributor',
    author_match_rate NUMERIC(5,2) DEFAULT 100.0,
    audited_repos JSONB DEFAULT '[]'::jsonb,
    topology_graph JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ASSESSMENTS
CREATE TABLE IF NOT EXISTS public.assessments (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    self_repo_prompt TEXT NOT NULL,
    target_repo TEXT NOT NULL,
    target_file TEXT NOT NULL,
    target_line INT DEFAULT 1,
    bug_fix_title TEXT NOT NULL,
    bug_fix_instructions TEXT NOT NULL,
    buggy_code_snippet TEXT NOT NULL,
    expected_concept TEXT NOT NULL,
    duration_seconds INT DEFAULT 300,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed BOOLEAN DEFAULT FALSE,
    score NUMERIC(5,2) DEFAULT 0.0,
    status TEXT DEFAULT 'pending'
);

-- 5. APPLICATIONS
CREATE TABLE IF NOT EXISTS public.applications (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    candidate_name TEXT NOT NULL,
    candidate_username TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    job_title TEXT NOT NULL,
    company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    git_provenance_score NUMERIC(5,2) DEFAULT 0.0,
    assessment_score NUMERIC(5,2) DEFAULT 0.0,
    composite_score NUMERIC(5,2) DEFAULT 0.0,
    queue_type TEXT DEFAULT 'fast_track',
    status TEXT DEFAULT 'fast_track_under_review',
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    sla_deadline TIMESTAMPTZ,
    sla_breached BOOLEAN DEFAULT FALSE,
    disposition_notes TEXT,
    interview_time TEXT,
    fixed_code TEXT,
    self_repo_explanation TEXT
);

-- 6. TEST USERS (Quick-lookup & local auth seed)
CREATE TABLE IF NOT EXISTS public.test_users (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL, -- 'employer' or 'candidate'
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    company_id TEXT REFERENCES public.companies(id) ON DELETE SET NULL,
    candidate_id TEXT REFERENCES public.candidates(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Realtime Publication for cross-tab and multi-device live sync
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'jobs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'applications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'candidates'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.candidates;
    END IF;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- RLS (Row Level Security) Policies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_users ENABLE ROW LEVEL SECURITY;

-- Table & Schema Grants for Supabase API Roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

CREATE POLICY "Public read for companies" ON public.companies FOR SELECT USING (true);
CREATE POLICY "Public read for active jobs" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Public insert for jobs" ON public.jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read for candidates" ON public.candidates FOR SELECT USING (true);
CREATE POLICY "Public insert/update for candidates" ON public.candidates FOR ALL USING (true);
CREATE POLICY "Public read/write for applications" ON public.applications FOR ALL USING (true);
CREATE POLICY "Public read/write for assessments" ON public.assessments FOR ALL USING (true);
CREATE POLICY "Public read for test_users" ON public.test_users FOR SELECT USING (true);

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Seed Companies
INSERT INTO public.companies (id, name, popularity_score, total_openings, response_rate, avg_response_hours, is_verified_responsive)
VALUES
    ('comp-acme', 'Acme Systems', 98.0, 2, 98.5, 26.0, true),
    ('comp-nova', 'Nova Labs', 91.0, 1, 87.5, 48.0, true),
    ('comp-phantom', 'Phantom Corp', 54.5, 1, 48.0, 120.0, false)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    popularity_score = EXCLUDED.popularity_score,
    response_rate = EXCLUDED.response_rate;

-- Seed Jobs
INSERT INTO public.jobs (id, company_id, company_name, title, stack_tags, description, experience_level, salary_range, active)
VALUES
    ('job-backend-fastapi', 'comp-acme', 'Acme Systems', 'Senior Backend Engineer (FastAPI / Concurrency)', '["Python", "FastAPI", "Redis", "Docker"]'::jsonb, 'Build high-throughput distributed APIs, manage token-bucket rate limiters, and prevent async race conditions under load.', 'Mid / Senior', 'INR 18 - 26 LPA', true),
    ('job-distributed-storage', 'comp-nova', 'Nova Labs', 'Distributed Storage Engineer (Go / Raft)', '["Go", "Raft", "Distributed Systems", "gRPC"]'::jsonb, 'Implement distributed consensus, optimize log compaction, and minimize leader election failover latencies.', 'Staff / Principal', 'INR 28 - 42 LPA', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Candidate (Aarav Sharma / @iiitd-dev)
INSERT INTO public.candidates (id, github_username, full_name, email, avatar_url, bio, git_provenance_score, commit_topology_status, fast_track_qualified, ownership_status, author_match_rate, audited_repos)
VALUES
    (
        'cand_iiitd-dev',
        'iiitd-dev',
        'Aarav Sharma',
        'aarav@iiitd.ac.in',
        'https://avatars.githubusercontent.com/u/10293847?v=4',
        'CS at IIIT Delhi. Distributed systems, asynchronous networking, and streaming pipelines.',
        94.5,
        'verified_human',
        true,
        'verified_contributor',
        100.0,
        '[{"repo_name":"delhi-transit-stream","primary_language":"Python","total_commits":38,"commit_distribution":"progressive_iterative","key_technologies":["Python","FastAPI","Redis","WebSockets"],"provenance_rating":96.0},{"repo_name":"go-raft-consensus","primary_language":"Go","total_commits":29,"commit_distribution":"progressive_iterative","key_technologies":["Go","Raft","gRPC"],"provenance_rating":94.0}]'::jsonb
    )
ON CONFLICT (id) DO NOTHING;

-- Seed Test Users (1 Company + 1 Candidate)
INSERT INTO public.test_users (email, role, password_hash, display_name, company_id, candidate_id)
VALUES
    ('recruiter@acmesystems.io', 'employer', 'Password123!', 'Sarah Jenkins (Lead Technical Recruiter)', 'comp-acme', NULL),
    ('aarav@iiitd.ac.in', 'candidate', 'Password123!', 'Aarav Sharma (@iiitd-dev)', NULL, 'cand_iiitd-dev')
ON CONFLICT (email) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    password_hash = EXCLUDED.password_hash;
