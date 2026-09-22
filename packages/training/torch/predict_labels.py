"""Spanish text -> model role labels -> jsonl the TS compiler can read."""
import json, re, sys, subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import torch, numpy as np
from model import TimeTagger
from train import Dataset, featurize

S = Path("/private/tmp/claude-501/-Users-arikko-Developer-vibecode-gpu-time/4b721a63-e0f8-4119-a8b4-ba2ddf7a0dd4/scratchpad")
LABELS = re.findall(r'"([A-Z_\']+)"', Path("../core/src/labels.ts").read_text())
texts = [l.rstrip("\n") for l in open(sys.argv[2]) if l.strip()]

# featurize needs spans; a single O span over the whole text is enough to tokenize.
stub = S / "demo-in.jsonl"
stub.write_text("".join(json.dumps({"id": f"d{i}", "text": t,
    "spans": [{"start": 0, "end": len(t), "label": "O", "clauseStart": False}]},
    ensure_ascii=False) + "\n" for i, t in enumerate(texts)))
featurize(stub, S / "demo")
ds = Dataset(S / "demo")

ck = torch.load(f"runs/{sys.argv[1]}/best.pt", map_location="cpu", weights_only=False)
model = TimeTagger(580, 2, True); model.load_state_dict(ck["model"]); model.eval()

# Offsets come from the same tokenizer featurize used, via a tiny tsx helper.
toks = json.loads(subprocess.run(["npx", "tsx", "src/tokenize-rows.ts", str(stub)],
                                 capture_output=True, text=True, check=True).stdout)
out = []
with torch.no_grad():
    for i, text in enumerate(texts):
        rows, labels, bounds, valid, neigh = ds.batch(np.array([i]), "cpu")
        logits, blogits = model(rows, valid, neigh)
        mask = labels >= 0
        # decode returns one slot per padded position; keep only real tokens,
        # which is exactly what the label mask marks.
        m = mask[0].tolist()
        pred = [x for x, keep_it in zip(model.decode(logits, mask)[0].tolist(), m) if keep_it]
        bnd = [x for x, keep_it in zip((blogits[0] >= 0).tolist(), m) if keep_it]
        keep = [t for t in toks[i] if t["kind"] != 3]
        assert len(keep) == len(pred), f"{len(keep)} tokens vs {len(pred)} labels"
        spans = [{"start": t["start"], "end": t["end"], "label": LABELS[p],
                  "clauseStart": bool(b)}
                 for t, p, b in zip(keep, pred, bnd)]
        out.append({"id": f"d{i}", "text": text, "spans": spans})
(S / "demo-pred.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out))
print(f"wrote {len(out)} predicted rows")
