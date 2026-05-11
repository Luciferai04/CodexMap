# CodexMap 5-Component Scoring

## Formula

```
S_base = S1 × 0.30 + S2 × 0.20 + A × 0.20 + T × 0.10
S_final = S_base × (1 - D × 0.20)
```

Where weights sum to 1.0 (0.30 + 0.20 + 0.20 + 0.10 + 0.20 = 1.00).

## Grade Thresholds

| Grade | Condition | Color (Miro Pastel) |
|-------|-----------|-------------------|
| **green** | S_final ≥ 0.70 | `#c3faf5` bg / `#187574` text |
| **yellow** | 0.40 ≤ S_final < 0.70 | `#ffe6cd` bg / `#d4850a` text |
| **red** | S_final < 0.40 | `#ffc6c6` bg / `#600000` text |
| **pending** | Not yet graded | `#f0f0f0` bg / `#a5a8b5` text |

## Components

### S1 — Semantic Similarity (weight: 0.30)
**Purpose:** Measures how closely node content matches domain keywords from the prompt.

**Algorithm:**
1. Extract domain keywords from prompt: `login`, `auth`, `payment`, `stripe`, `jwt`, `secure`, `api`
2. For each keyword, check if it appears in node code (case-insensitive)
3. Score = matches / total_keywords + 0.2 base boost (capped at 1.0)
4. If no keywords found, returns 0.5 (neutral)

**Example:** Prompt = "Build a banking app with auth and payments"
- Keywords extracted: `auth`, `payment`
- Node `auth/login.js` contains both → S1 = 2/2 + 0.2 = 1.0 (capped)
- Node `styles.css` contains neither → S1 = 0.5

### S2 — BM25 Sparse Scoring (weight: 0.20)
**Purpose:** Term-frequency based relevance scoring against the prompt.

**Algorithm:**
1. Tokenize both prompt and node code (lowercase, strip punctuation, min 2 chars)
2. Compute BM25 score with k1=1.5, b=0.75
3. Normalize to 0-1 range
4. If PageIndex relevance data available: S2 = bm25*0.4 + pageindex*0.6

**Why BM25 over embeddings:** Faster, no API cost, works in demo mode, good for keyword-heavy relevance.

### A — Architectural Consistency (weight: 0.20)
**Purpose:** Checks if node belongs to expected architectural domains.

**Algorithm:**
1. Define expected domains: `payment`, `auth`, `login`, `api`, `db`, `ui`, `logic`
2. Find which domains appear in the prompt
3. For each active domain, check if it appears in node code
4. Score = 0.3 + (matching_domains / active_domains) × 0.7
5. Range: 0.3–1.0 (baseline 0.3 ensures even unmatched nodes get partial credit)

**Example:** Prompt mentions "auth" and "api"
- `auth/login.js` matches both → A = 0.3 + 2/2 × 0.7 = 1.0
- `utils/helpers.js` matches neither → A = 0.3

### T — Type Safety / Code Quality (weight: 0.10)
**Purpose:** Penalizes code quality issues.

**Algorithm:**
1. Start at 0.9 (generous baseline)
2. If code contains `console.log` → −0.1
3. If code contains `TODO` → −0.05
4. Clamped at 0 minimum

**Range:** 0.0–0.9

### D — Drift Penalty (weight: 0.20)
**Purpose:** Penalizes code that deviates from the project scope.

**Algorithm:**
1. Off-scope imports: if node imports `stripe`/`paypal` but project isn't about payments → +0.3
2. Unrelated paths: if node path contains `test_red` or `node_modules` → +0.2
3. Complexity spike: if `if/for/while/switch` count > 20% of line count → +0.2
4. Capped at 0.8 maximum

**How it's applied:** D acts as a multiplier penalty: `S_final = S_base × (1 - D × 0.20)`
- D = 0 → no penalty (S_final = S_base)
- D = 0.5 → 10% reduction
- D = 1.0 → 20% reduction (max penalty)

## Example Calculations

### Example 1: Well-written auth file
```
S1 = 0.90 (matches auth keywords)
S2 = 0.80 (BM25 relevance)
A  = 0.90 (matches auth domain)
T  = 0.90 (no console.log/TODO)
D  = 0.00 (no drift signals)

S_base = 0.90×0.30 + 0.80×0.20 + 0.90×0.20 + 0.90×0.10 = 0.70
S_final = 0.70 × (1 - 0.00 × 0.20) = 0.70
Grade: GREEN (≥ 0.70)
```

### Example 2: Generic boilerplate
```
S1 = 0.50 (some keyword overlap)
S2 = 0.30 (low BM25)
A  = 0.50 (partial domain match)
T  = 0.90 (clean code)
D  = 0.10 (minor drift)

S_base = 0.50×0.30 + 0.30×0.20 + 0.50×0.20 + 0.90×0.10 = 0.40
S_final = 0.40 × (1 - 0.10 × 0.20) = 0.40 × 0.98 = 0.39
Grade: RED (< 0.40) — borderline, needs more keyword match
```

### Example 3: Off-scope spaghetti code
```
S1 = 0.20 (minimal keyword match)
S2 = 0.10 (very low BM25)
A  = 0.30 (no domain match)
T  = 0.70 (has console.log)
D  = 0.50 (off-scope imports + complexity)

S_base = 0.20×0.30 + 0.10×0.20 + 0.30×0.20 + 0.70×0.10 = 0.21
S_final = 0.21 × (1 - 0.50 × 0.20) = 0.21 × 0.90 = 0.19
Grade: RED (< 0.40)
```

## Configuration (via `.env`)

```env
WEIGHT_S1=0.30
WEIGHT_S2=0.20
WEIGHT_A=0.20
WEIGHT_T=0.10
WEIGHT_D=0.20
THRESHOLD_GREEN=0.70
THRESHOLD_YELLOW=0.40
AUTO_HEAL_THRESHOLD=0.35
```

**Weight sum must equal 1.0.** The orchestrator validates this on startup and exits with an error if the sum differs.

## Drift Score (Session-Level)

Computed by Sentinel as the average S_final across all scored nodes, scaled to 0–100:

```
drift = round(average(S_final for all scored nodes) × 100)
```

Logged to `session-drift-log.json` as `{ score: drift, timestamp: ISO_string }`.

## Auto-Label Tool

Located at `scripts/eval/auto_label.py`. Uses GPT-4o to classify nodes as ON-SCOPE (1) or OFF-SCOPE (0).

**Features:**
- Rate limiting (1s between API calls)
- Retry with exponential backoff (3 attempts)
- 4000-char context window
- Skips already-labeled nodes
- Saves to `scripts/eval/ground_truth.json`

**Usage:**
```bash
cd "Code Generation Map/codexmap"
python3 scripts/eval/auto_label.py
```
