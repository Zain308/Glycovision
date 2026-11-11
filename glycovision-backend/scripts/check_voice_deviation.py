from services.voice_deviation import compare_to_personal_baseline
from scripts._common import seed_user_id

sample = {
    "model_status": "experimental-natural-speech-v3",
    "quality": "acceptable",
    "f0_mean": 103.6,
    "f0_std": 8.2,
    "hnr": 5.19,
    "voiced_ratio": 0.53,
    "acoustic_score": 0.36,
}

user_id = seed_user_id()

result = compare_to_personal_baseline(
    user_id=user_id,
    voice_result=sample,
)

print(result)