# %% [markdown]
# # GlycoVision food model: training on Kaggle
#
# Trains the dish classifier the backend loads (`services/food_classifier.py`):
# timm **convnext_tiny**, ImageNet weights, input squashed to 224x224.
#
# **Before you run:** Settings (right panel) -> Accelerator **GPU T4 x2** or **P100**, Internet **On**
# (to download the ImageNet weights), and add the dataset **glycovision-food** (Add Input).
#
# **Outputs** in `/kaggle/working` (download them from the Output tab):
# * `pakistani_food_model.pth`: weights, drop into `glycovision-backend/models/`
# * `class_names.json`: dish order, drop into `glycovision-backend/models/`
# * `report.json`, `per_class.csv`, `confusion_matrix.png`, `confidence_threshold.csv`: results for the thesis
#
# Split rules (made by `prepare_kaggle_upload.py`): 80/10/10 per photo; augmented copies are train only,
# so val/test only hold original photos.

# %%
import json, math, os, random, time
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import timm
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import transforms

CFG = dict(
    arch="convnext_tiny",
    img_size=224,
    epochs=12,
    batch_size=64,
    lr=3e-4,           # head and body share a cosine schedule; body uses lr * 0.3
    weight_decay=0.05,
    label_smoothing=0.1,
    warmup_epochs=1,
    num_workers=4,
    seed=42,
)
OUT = Path(os.environ.get("GV_OUT", "/kaggle/working"))
OUT.mkdir(parents=True, exist_ok=True)
# Local smoke test: GV_DATA=<upload folder> GV_SMOKE=1 runs one tiny CPU epoch to catch bugs.
SMOKE = os.environ.get("GV_SMOKE") == "1"
if SMOKE:
    CFG.update(epochs=1, batch_size=8, num_workers=0)

def find_data_dir() -> Path:
    if os.environ.get("GV_DATA"):
        return Path(os.environ["GV_DATA"])
    for p in Path("/kaggle/input").rglob("manifest.csv"):
        return p.parent
    raise FileNotFoundError("manifest.csv not found: add the glycovision-food dataset as an input")

DATA = find_data_dir()
random.seed(CFG["seed"]); np.random.seed(CFG["seed"]); torch.manual_seed(CFG["seed"])
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("data:", DATA, "| device:", device, torch.cuda.device_count(), "GPU(s)")

# %%
manifest = pd.read_csv(DATA / "manifest.csv")
class_names = json.loads((DATA / "class_names.json").read_text())
class_to_idx = {c: i for i, c in enumerate(class_names)}
manifest["y"] = manifest["label"].map(class_to_idx)
# Skip photos listed in the manifest but missing on disk (e.g. a dataset version only half
# mounted), so one missing file cannot stop a long run. Print a few so the cause is visible.
exists = manifest.path.map(lambda p: (DATA / p).is_file())
if not exists.all():
    print(f"WARNING: {int((~exists).sum())} of {len(manifest)} photos are missing and will be skipped, e.g.:")
    print("\n".join(manifest.path[~exists].head(5)))
    assert exists.mean() > 0.95, "Most photos are missing: re-add the glycovision-food input"
manifest = manifest[exists].reset_index(drop=True)
splits = {s: manifest[manifest.split == s].reset_index(drop=True) for s in ["train", "val", "test"]}
if SMOKE:
    splits = {s: d.sample(min(len(d), 48), random_state=0).reset_index(drop=True) for s, d in splits.items()}
print({s: len(d) for s, d in splits.items()}, "|", len(class_names), "classes")
print(splits["train"].label.value_counts().describe()[["min", "50%", "max"]])

# %%
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
train_tf = transforms.Compose([
    transforms.RandomResizedCrop(CFG["img_size"], scale=(0.5, 1.0), ratio=(0.75, 1.33)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(15),
    transforms.ColorJitter(0.25, 0.25, 0.2, 0.03),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
    transforms.RandomErasing(p=0.2),
])
# Must match services/food_classifier.py inference_transform exactly.
eval_tf = transforms.Compose([
    transforms.Resize((CFG["img_size"], CFG["img_size"])),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
])

class Photos(Dataset):
    def __init__(self, df, tf):
        self.paths, self.ys, self.tf = df.path.tolist(), df.y.tolist(), tf
    def __len__(self):
        return len(self.paths)
    def __getitem__(self, i):
        img = Image.open(DATA / self.paths[i]).convert("RGB")
        return self.tf(img), self.ys[i]

# Balance classes: sample each photo with weight 1/sqrt(class count), so small dishes are seen
# more often and big ones (not_food, Food-101 dishes) do not dominate.
counts = splits["train"].y.value_counts()
weights = splits["train"].y.map(lambda y: 1.0 / math.sqrt(counts[y])).values
sampler = WeightedRandomSampler(torch.tensor(weights, dtype=torch.double), num_samples=len(weights), replacement=True)

loaders = {
    "train": DataLoader(Photos(splits["train"], train_tf), batch_size=CFG["batch_size"], sampler=sampler,
                        num_workers=CFG["num_workers"], pin_memory=True, drop_last=True),
    "val": DataLoader(Photos(splits["val"], eval_tf), batch_size=128, num_workers=CFG["num_workers"]),
    "test": DataLoader(Photos(splits["test"], eval_tf), batch_size=128, num_workers=CFG["num_workers"]),
}

# %%
model = timm.create_model(CFG["arch"], pretrained=not SMOKE, num_classes=len(class_names))
head_params = list(model.get_classifier().parameters())
head_ids = {id(p) for p in head_params}
body_params = [p for p in model.parameters() if id(p) not in head_ids]
optimizer = torch.optim.AdamW([
    {"params": body_params, "lr": CFG["lr"] * 0.3},
    {"params": head_params, "lr": CFG["lr"]},
], weight_decay=CFG["weight_decay"])

steps_per_epoch = len(loaders["train"])
total_steps = CFG["epochs"] * steps_per_epoch
warmup_steps = CFG["warmup_epochs"] * steps_per_epoch
def lr_factor(step):
    if step < warmup_steps:
        return (step + 1) / warmup_steps
    progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
    return 0.5 * (1 + math.cos(math.pi * progress))
scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_factor)

criterion = nn.CrossEntropyLoss(label_smoothing=CFG["label_smoothing"])
scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
net = nn.DataParallel(model) if torch.cuda.device_count() > 1 else model
net.to(device)

@torch.no_grad()
def predict(loader):
    net.eval()
    probs, ys = [], []
    for x, y in loader:
        with torch.autocast(device.type, enabled=device.type == "cuda"):
            logits = net(x.to(device, non_blocking=True))
        probs.append(logits.float().softmax(1).cpu())
        ys.append(y)
    return torch.cat(probs).numpy(), torch.cat(ys).numpy()

def macro_f1(y_true, y_pred, n):
    f1s = []
    for c in range(n):
        tp = np.sum((y_pred == c) & (y_true == c))
        fp = np.sum((y_pred == c) & (y_true != c))
        fn = np.sum((y_pred != c) & (y_true == c))
        if tp + fn == 0:
            continue
        f1s.append(2 * tp / max(1, 2 * tp + fp + fn))
    return float(np.mean(f1s))

# %%
best_f1, history = -1.0, []
for epoch in range(CFG["epochs"]):
    net.train()
    start, running, seen = time.time(), 0.0, 0
    for x, y in loaders["train"]:
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device.type, enabled=device.type == "cuda"):
            loss = criterion(net(x), y)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        scheduler.step()
        running += loss.item() * len(y); seen += len(y)
    probs, ys = predict(loaders["val"])
    pred = probs.argmax(1)
    acc = float((pred == ys).mean())
    f1 = macro_f1(ys, pred, len(class_names))
    history.append({"epoch": epoch + 1, "train_loss": running / seen, "val_acc": acc, "val_macro_f1": f1})
    print(f"epoch {epoch + 1:2d}  loss {running / seen:.3f}  val acc {acc:.3f}  val macro-F1 {f1:.3f}  ({time.time() - start:.0f}s)")
    if f1 > best_f1:
        best_f1 = f1
        torch.save(model.state_dict(), OUT / "pakistani_food_model.pth")

# %% [markdown]
# ## Test-set results (photos never used for training or model selection)

# %%
model.load_state_dict(torch.load(OUT / "pakistani_food_model.pth", map_location="cpu"))
probs, ys = predict(loaders["test"])
pred = probs.argmax(1)
top3 = np.argsort(-probs, axis=1)[:, :3]
report = {
    "classes": len(class_names),
    "test_photos": int(len(ys)),
    "top1_accuracy": round(float((pred == ys).mean()), 4),
    "top3_accuracy": round(float(np.mean([y in t for y, t in zip(ys, top3)])), 4),
    "macro_f1": round(macro_f1(ys, pred, len(class_names)), 4),
    "best_val_macro_f1": round(best_f1, 4),
    "config": CFG,
    "history": history,
}
print(json.dumps({k: v for k, v in report.items() if k not in ("config", "history")}, indent=2))

# Per-dish precision / recall / F1.
rows = []
for c, name in enumerate(class_names):
    tp = int(np.sum((pred == c) & (ys == c))); fp = int(np.sum((pred == c) & (ys != c))); fn = int(np.sum((pred != c) & (ys == c)))
    precision = tp / max(1, tp + fp); recall = tp / max(1, tp + fn)
    rows.append({"dish": name, "test_photos": tp + fn, "precision": round(precision, 3), "recall": round(recall, 3),
                 "f1": round(2 * precision * recall / max(1e-9, precision + recall), 3)})
per_class = pd.DataFrame(rows).sort_values("f1")
per_class.to_csv(OUT / "per_class.csv", index=False)
print("\nWeakest dishes:\n", per_class.head(12).to_string(index=False))

# Most common confusions.
pairs = Counter((class_names[t], class_names[p]) for t, p in zip(ys, pred) if t != p)
report["top_confusions"] = [{"true": t, "predicted": p, "count": n} for (t, p), n in pairs.most_common(15)]
print("\nMost common mix-ups:")
for item in report["top_confusions"]:
    print(f"  {item['true']:16} -> {item['predicted']:16} {item['count']}")

# %%
# Confidence threshold: the backend rejects predictions below CONFIDENCE_THRESHOLD and asks the user.
# This shows, for each threshold, how many photos would be answered and how accurate those answers are.
conf = probs.max(1)
threshold_rows = []
for t in np.arange(0.30, 0.91, 0.05):
    answered = conf >= t
    threshold_rows.append({"threshold": round(float(t), 2), "answered_share": round(float(answered.mean()), 3),
                           "accuracy_when_answered": round(float((pred[answered] == ys[answered]).mean()) if answered.any() else 0, 3)})
thresholds = pd.DataFrame(threshold_rows)
thresholds.to_csv(OUT / "confidence_threshold.csv", index=False)
print(thresholds.to_string(index=False))

# %%
import matplotlib.pyplot as plt
n = len(class_names)
cm = np.zeros((n, n), dtype=int)
for t, p in zip(ys, pred):
    cm[t, p] += 1
cm_norm = cm / np.maximum(1, cm.sum(1, keepdims=True))
fig, ax = plt.subplots(figsize=(max(10, n * 0.22), max(9, n * 0.2)))
ax.imshow(cm_norm, cmap="Purples", vmin=0, vmax=1)
ax.set_xticks(range(n)); ax.set_xticklabels(class_names, rotation=90, fontsize=6)
ax.set_yticks(range(n)); ax.set_yticklabels(class_names, fontsize=6)
ax.set_xlabel("Predicted dish"); ax.set_ylabel("True dish")
ax.set_title(f"Confusion matrix (test set, row-normalised), top-1 {report['top1_accuracy']:.1%}")
fig.tight_layout(); fig.savefig(OUT / "confusion_matrix.png", dpi=160)

(OUT / "class_names.json").write_text(json.dumps(class_names, indent=2))
(OUT / "report.json").write_text(json.dumps(report, indent=2))
print("Saved:", sorted(p.name for p in OUT.iterdir()))
