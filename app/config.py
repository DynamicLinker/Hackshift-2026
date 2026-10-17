import os
from pydantic import BaseModel

class Settings(BaseModel):
    app_name: str = "ProofHired"
    environment: str = os.getenv("ENV", "development")
    port: int = int(os.getenv("PORT", 8000))
    host: str = os.getenv("HOST", "0.0.0.0")
    sla_hours: int = 72
    assessment_duration_seconds: int = 300  # 5 minutes
    network_grace_seconds: int = 15

settings = Settings()
