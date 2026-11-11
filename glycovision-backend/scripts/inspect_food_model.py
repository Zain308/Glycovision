import torch

from core.config import BACKEND_ROOT

path = BACKEND_ROOT / "models" / "pakistani_food_model.pth"

state = torch.load(
    path,
    map_location="cpu",
    weights_only=True
)

print("Total tensors:", len(state))

print("\nFirst 20 keys:")
for key in list(state.keys())[:20]:
    print(key, tuple(state[key].shape))

print("\nLast 10 keys:")
for key in list(state.keys())[-10:]:
    print(key, tuple(state[key].shape))