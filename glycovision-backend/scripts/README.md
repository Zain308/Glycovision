# Dev scripts

Helpers for development and testing. None of these run in production.

They write test data for the Supabase user in `SEED_USER_ID` (set it in
`.env`). Run them from the `glycovision-backend` folder as modules:

```powershell
.\venv\Scripts\python.exe -m scripts.seed_bg_scenarios
```

> **Warning:** the scripts marked "Deletes" first remove that user's
> recent data. Never point `SEED_USER_ID` at a real patient's account.

| Script | What it does | Deletes data? |
|---|---|---|
| `seed_bg_history.py` | Inserts a run of blood glucose readings | No |
| `seed_bg_scenarios.py` | Inserts 13-reading glucose patterns for testing spike risk | **Deletes recent BG readings** |
| `seed_sparse_bg.py` | Inserts 4 readings (t-60, t-30, t-15, now) for the sparse model | **Deletes recent BG readings** |
| `seed_insufficient_bg.py` | Inserts too few readings, to test the "not ready" state | **Deletes recent BG readings** |
| `seed_spike_context.py` | Inserts a rising BG history with meals and boluses | **Deletes recent BG, meals and boluses** |
| `check_voice_deviation.py` | Compares a sample voice result with your saved voice baseline | No |
| `check_food_classifier.py` | Runs the food classifier on one image: `python -m scripts.check_food_classifier photo.jpg` | No |
| `inspect_food_model.py` | Prints the layers of the food model file | No |
