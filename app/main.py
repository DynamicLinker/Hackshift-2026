from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.config import settings
from app.db.datastore import db
from app.routers import candidate, employer, auth

app = FastAPI(
    title=settings.app_name,
    description="Zero-Resume Proof-of-Competence Marketplace",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure static directories exist
os.makedirs("app/static", exist_ok=True)
os.makedirs("app/templates", exist_ok=True)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Include Routers
app.include_router(candidate.router)
app.include_router(employer.router)
app.include_router(auth.router)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": settings.app_name,
        "environment": settings.environment,
        "companies_loaded": len(db.companies),
        "jobs_loaded": len(db.jobs),
    }

@app.get("/")
def serve_index():
    index_path = os.path.join("app", "static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "app": "ProofHired API",
        "docs": "/docs",
        "health": "/api/health"
    }
