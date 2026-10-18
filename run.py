import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"⚡ ProofHired Production Server launching on http://{host}:{port}")
    uvicorn.run("app.main:app", host=host, port=port, log_level="info")
