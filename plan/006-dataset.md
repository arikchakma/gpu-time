# 006 — Dataset

Goal: generate labeled training data at scale from a grammar that shares the lexicon and the label rules with the compiler, so labels are correct by construction; add prose carriers and noise for robustness; hold out whole *templates* (not just samples) so the metric measures generalization; assemble gold sets for honest evaluation.

Effort: 3 days.

## 1. Why synthetic

There is no labeled corpus of English schedule expressions at token level with recurrence (001 §6). gpu-lexer labels with Shiki; our equivalent "teacher" is the grammar itself: we sample a *structured spec* (a `Schedule` plus surface choices), render it to text, and the renderer knows which token came from which slot, so labels are free and exact.

## 2. Generator (`training/generate/`)

### Spec sampler
Samples a `Schedule` from 002 §3 with weights per family (roughly proportional to expected real-world frequency, with a floor so rare families still appear ≥ 2% each):

| Family | Weight |
|---|---|
| weekday (+ time / window) | 18% |
| relative quantity / anchored | 15% |
| recurrence weekly (incl. every other, weekday groups) | 14% |
| explicit date (+ time) | 10% |
| clock time only / time window only | 8% |
| multi-clause (2–3 clauses, mixed) | 8% |
| recurrence monthly / yearly / ordinal | 7% |
| relative day / relative unit | 6% |
| bounds / count / except on recurrence | 6% |
| duration / date range | 4% |
| timezone suffix | 2% |
| holiday | 1% |
| negatives (no time expression; prose only) | 1% + carriers |

### Renderer
Each `DateSpec`/`TimeSpec`/… node has a list of surface templates with slot fillers, each token tagged with its label. Examples of variation per node:

- ClockTime 14:00 → `2pm`, `2 pm`, `2PM`, `2 p.m.`, `2:00pm`, `14:00`, `1400` (rare), `two in the afternoon`, `2 o'clock`
- Weekday → `Monday`, `monday`, `Mon`, `Mon.`, `mon`, `Mondays` (with RECUR)
- Range → `10pm-12am`, `10pm - 12am`, `10pm to 12am`, `10 to 12pm`, `from 10pm till midnight`, `between 10pm and 12am`, `10pm–12am`
- Connectors → `and`, `,`, `, and`, `&`, `then`, `;`, nothing (`Saturday Sunday`)
- Filler → `at`, `on`, `on the`, `the`, `of`, `in` inserted per template rules

The renderer emits `{text, tokens:[{start,end,label}], clauseStart:[…], schedule}`; `clauseStart` is set on the first token of every rendered clause after the first.

### Prose carriers (`carriers.ts`)
30% of samples are wrapped: `remind me to {verb phrase} {EXPR}`, `{EXPR} works for me`, `let's meet {EXPR}`, `the {noun} is {EXPR}`, `deadline: {EXPR}`, `{EXPR}. {EXPR}` (two expressions), and ~200 sentences from Snips NLU `timeRange` templates with their slot replaced. Carrier tokens are `O`. Names, verbs, nouns come from small word lists; 5% of carriers contain decoy numbers and words (`call 3 people`, `room 10`, `may` as a verb, `march` as a verb, `second` as "second opinion") so the model learns that context, not the word, decides.

### Noise (`noise.ts`), applied to 20% of samples
Random casing; dropped/duplicated spaces; missing space (`10pm-12am`→`10pm -12am`); typos in non-critical words (one char swap in `tomorow`, `wensday`, `untill`); trailing punctuation; abbreviation with/without dot. Labels are unchanged (labels attach to tokens, and the tokenizer's hash2/first/last features are designed to absorb this).

### Held-out templates
Every surface template has an id. 10% of template ids (stratified per node type) are held out entirely from training; the `heldout-templates` eval set uses only those. This measures whether the model generalizes to phrasings it never saw, which sample-level splits do not.

## 3. Sizes and token counts

| Set | Sequences | Tokens (incl. spaces) | Non-space tokens | Notes |
|---|---|---|---|---|
| train, per epoch | 300,000 | ≈ 2.7M | ≈ 1.45M | fresh seed each epoch (infinite generator); 20 epochs ≈ 54M tokens |
| val-synth (same templates) | 10,000 | ≈ 90K | | early stopping only |
| heldout-templates | 10,000 | ≈ 90K | | **primary synthetic metric** |
| gold-families (hand-written) | ≈ 400 | | | 002 §1 coverage |
| gold-adversarial | 25 | | | 001 §4 |
| gold-labels (hand-labeled tokens) | ≈ 200 | | | 004 oracle set, also eval |
| external-recognizers | ≈ 600 | | | MS Specs Date/Time/DateTime/DateTimePeriod/Set; adapter maps to expected resolved values |
| external-duckling | ≈ 800 + 27 negatives | | | ref Tue 2013-02-12 04:30 |
| external-pate | ≈ 1,000 usable | | | TIMEX3 SET-heavy assistant commands |
| paraphrase-llm | 2,000 | | | see §4 |

Average sequence: 9 tokens (≈ 5 non-space) bare, ≈ 16 with a carrier. Max sequence length 128 tokens (longer inputs are split at sentence punctuation by the tokenizer front-end). Padded batch shape in training: 512 × 64 (sequences > 64 go to a second bucket of 128).

Storage: one shard = 300K sequences × ≤ 64 tokens × (8 B features + 1 B label + 1 B flags) ≈ 190 MB uncompressed, 4 shards on disk at a time, regenerated on the fly; `data/synth` is gitignored, the generator seed is in `training/report.json`.

## 4. LLM paraphrase augmentation (`training/generate/paraphrase.ts`, uses the Claude API)

Purpose: cover phrasings a hand-written grammar misses. Procedure:

1. Sample 2,000 specs; render one canonical sentence each.
2. Ask Claude (claude-sonnet-5, temperature 1) for 3 paraphrases that keep the exact same meaning, forbidding new times/dates.
3. **Auto-align labels**: for each paraphrase, tokenize and label via lexicon matching against the spec's known slot values (weekday names, numbers, month names, keywords). A paraphrase is accepted only if every slot value in the spec is found exactly once and no unknown number/weekday/month token appears; else discarded (expect ~60% acceptance).
4. Spot-check 200 by hand; the accepted set is used 50/50 as extra training data (`paraphrase-train`) and evaluation (`paraphrase-eval`).

Cost: ~2,000 calls × ~300 tokens ≈ trivial. Stored in `data/paraphrase/` with the prompt and model id.

## 5. External gold adapters (`data/external/`)

- **Recognizers Specs**: parse `Input`, `Context.ReferenceDateTime`, `Results[].Resolution.values[]` (timex + start/end/value). Map to expected occurrences under our resolver defaults; cases where our interpretation policy legitimately differs (e.g. past candidates) are tagged `policy-diff` and reported separately, not as failures.
- **Duckling Corpus.hs**: a 150-line parser for the `examples (datetime …)` / `datetimeInterval` forms; negatives become expected `expressions: []`.
- **PATE**: XML TIMEX3 → span + type (DATE/TIME/SET/DURATION); used for span F1 and SET detection accuracy (is it recurrence?), since TIMEX values do not carry our AST.

These test **resolved values / spans**, never token labels, so they cannot leak label conventions.

## 6. Acceptance criteria

- `bun training/generate/cli.ts --n 1000` renders 1,000 samples; every sample compiles through `compile.ts` back to a `Schedule` deep-equal to its source spec (generator ↔ compiler consistency test; **this is the most important test in the project**).
- Label distribution report: no label < 0.3% of non-space tokens; O ≤ 45%.
- Held-out template ids are disjoint from training ids (assert in code).
- External adapters produce ≥ 2,000 cases with expected values, and our resolver on *oracle* schedules for a hand-checked 100-case sample agrees ≥ 95% (validates the adapters, not the model).
