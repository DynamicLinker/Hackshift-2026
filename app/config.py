import os
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

class Settings(BaseModel):
    app_name: str = "ProofHired"
    environment: str = os.getenv("ENV", "development")
    port: int = int(os.getenv("PORT", 8000))
    host: str = os.getenv("HOST", "0.0.0.0")
    sla_hours: int = 72
    assessment_duration_seconds: int = 300  # 5 minutes
    network_grace_seconds: int = 15

    # Supabase Configuration
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    @property
    def is_supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

settings = Settings()
