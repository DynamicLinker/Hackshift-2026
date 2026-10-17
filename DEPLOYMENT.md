# ProofHired: Production Deployment Guide

Deploy ProofHired live in less than 3 minutes so judges and peers can interact with the live application on their phones or laptops.

---

### Option 1: Render (Recommended — 100% Free)

1. **Push your code to GitHub**:
   ```bash
   git push origin main
   ```
2. Go to **[render.com](https://render.com)** and sign in with GitHub.
3. Click **"New +"** → **"Web Service"**.
4. Select your `hackshift` repository.
5. Configure the service:
   - **Name**: `proofhired` (or any name)
   - **Region**: Singapore / Frankfurt / Oregon (any)
   - **Branch**: `main`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python run.py`
   - **Plan**: `Free`
6. Click **"Deploy Web Service"**.
   - Your application will be live at `https://proofhired.onrender.com` in ~2 minutes!

---

### Option 2: Railway

1. Go to **[railway.app](https://railway.app)**.
2. Click **"New Project"** → **"Deploy from GitHub repo"**.
3. Railway automatically detects the `Dockerfile` and deploys it immediately.
4. Go to **Settings** → **Generate Domain** to get your public URL.

---

### Option 3: Docker Local / VPS

```bash
# Build the container
docker build -t proofhired .

# Run on port 8000
docker run -p 8000:8000 -e PORT=8000 proofhired
```
Open in browser: `http://localhost:8000`
