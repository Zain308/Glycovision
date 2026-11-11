# GlycoVision AI

Diabetes companion app: meal photo to carbs, research bolus estimate,
glucose logging, 60-minute spike-risk prediction and a voice check.

| Folder | What it is |
|---|---|
| `glycovision-app/` | Mobile app (Expo SDK 58, React Native, Expo Router) |
| `glycovision-backend/` | API server (FastAPI, Supabase, PyTorch, scikit-learn) |
| `HUPA-UCM Diabetes Dataset/` | Glucose dataset used to train the spike models (not in git) |

## Run it (Windows, development)

You need two terminals, and the phone on the **same Wi-Fi** as this PC.

1. **Backend:** double-click `start-backend.cmd`, or run `.\start-backend.cmd`.
   Wait for `Application startup complete`. Check: http://localhost:8000/health
2. **App:** double-click `start-app.cmd`, or run `.\start-app.cmd`.
   Scan the QR code with **Expo Go for SDK 58**.

`start-app` also:
- updates the backend address in `glycovision-app/.env` if this PC's IP changed,
- offers to stop an old Expo session (an old session keeps serving stale code),
- always starts Expo with a clean cache.

If Windows asks about the firewall the first time, allow **Private networks**.

## Configuration

Settings and keys live in `.env` files, which are **never committed**.
Each project has a `.env.example` listing every setting:

- `glycovision-app/.env.example`: backend URL, Supabase URL and anon key
- `glycovision-backend/.env.example`: Supabase service-role key, nutrition API key,
  ffmpeg path, Ollama fallback, CORS, default time zone, dev-script user

Expo reads `.env` only at startup: restart with `start-app.cmd` after changing it.

## First-time setup on a new PC

```powershell
# Backend
cd glycovision-backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env   # then fill in the values

# App
cd ..\glycovision-app
npm install
copy .env.example .env   # then fill in the values
```

Known gaps (being fixed in Phase 1):
- `requirements.txt` is incomplete; a fresh install also needs packages such as
  `supabase`, `PyJWT`, `joblib`, `pandas`, `scikit-learn`, `xgboost` and `torchvision`.
- The trained model files in `glycovision-backend/models/` are too large for
  git and must be copied over separately.

## Troubleshooting

| Problem | Fix |
|---|---|
| Red screen "EXPO_PUBLIC_... is not set" | Run `start-app.cmd` again (it restarts Expo with a clean cache) |
| App can't reach the backend | Same Wi-Fi? Backend running? Firewall allowed? |
| "Project is incompatible with this version of Expo Go" | Install Expo Go for SDK 58 |
| Login fails with "Unable to resolve host ...supabase.co" | The Supabase project is paused: restore it in the Supabase dashboard |
