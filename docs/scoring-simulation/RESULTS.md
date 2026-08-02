# Scoring System Simulation — 2024 Season

Simulation comparing the current 3-source hybrid scoring system against
single-source alternatives (Metacritic-only and Rotten-Tomatoes-only) using a
Fantasy Critic-style curve. Run `python3 simulate_scoring.py` to reproduce;
full per-movie output is in `results.txt`.

## Method

- **Slate:** 50 draftable 2024 wide/notable releases with settled end-of-season
  scores (RT Tomatometer, Metacritic metascore, IMDb ×10). Values accurate to
  roughly ±3 pts (spot-checked against published aggregator values).
- **Curve shape (candidates):** Fantasy Critic's `StandardScoringSystem`,
  generalized — 1 pt/pt above a baseline, 2 pts/pt above an acceleration
  threshold, slope halving every 10 pts below (baseline − 10), asymptote ≈ −20.
  No hard floor, no threshold bonuses.
- **Draft sim:** 5 teams × 10 rounds, snake draft strictly in pre-season hype
  order (identical rosters across systems, so standings differences isolate
  the scoring system).

## Candidate systems

| Key | System |
|-----|--------|
| `current` | 3-source weighted blend (RT 40 / IMDb 35 / MC 25), baseline 70, hard floor −15, CF/Darling/Disaster bonuses |
| `mc_b60` | Metacritic only, baseline 60, 2× at 85 |
| `mc_b65` | Metacritic only, baseline 65, 2× at 85 |
| `rt_b75` | RT only, baseline 75, 2× at 93 |
| `rt_b80` | RT only, baseline 80, 2× at 95 |
| `rt75_t90` | RT only, baseline 75, 2× at 90 |

## Headline numbers

| System | mean | median | % positive | movies in 2× tier | #1 vs #10 gap | std of top 15 |
|--------|-----:|-------:|-----------:|------------------:|--------------:|--------------:|
| current | 1.0 | 3.8 | 56% | **0** | 14.0 | 4.5 |
| mc_b60 | 2.4 | 3.5 | 56% | 3 | **20.0** | **7.6** |
| mc_b65 | −1.6 | −1.5 | 38% | 3 | 20.0 | 7.6 |
| rt_b75 | −0.7 | 2.5 | 54% | 5 | 10.0 | 3.5 |
| rt_b80 | −4.2 | −2.5 | 40% | 1 | 8.0 | 3.2 |
| rt75_t90 | −0.3 | 2.5 | 54% | 8 | 13.0 | 4.8 |

## Findings

1. **The current system's 2× "gem" tier went unused for an entire season.**
   Zero of 50 movies reached a combined 90 — the highest was The Wild Robot at
   88.35 (RT 96 / MC 85 / IMDb 8.2). IMDb's compressed scale mathematically
   caps the blend.

2. **The current bonuses are noise or dead weight.** Certified Fresh triggered
   on 56% of the slate (it's a near-automatic +3 for any decent movie, and
   correlated with the base score it sits on). Critical Darling triggered
   once all season (The Wild Robot). Critical Disaster triggered 8 times,
   almost always on movies already at/near the −15 floor.

3. **The current blend is already an RT-flavored game in disguise.** Spearman
   rank correlation between `current` and `rt_b75` is **0.987** — the
   three-source machinery produces almost exactly RT-only rankings, just in a
   form nobody can predict.

4. **Metacritic separates skill; RT compresses it.** Among the top 15 movies,
   MC-only spreads points twice as wide as RT-only (std 7.6 vs 3.5; #1-to-#10
   gap 20 vs 10). Under RT-b75, **Paddington in Peru (RT 93 / MC 66) scores
   identical points to Anora (RT 93 / MC 91)** — the Best Picture winner ties
   a kids' sequel. Under MC-b60 they're 31 points apart. Lowering RT's 2×
   threshold to 90 (`rt75_t90`) only partially rescues this (std 4.8) and puts
   8 of 50 movies in the "special" tier.

5. **Where MC and RT disagree is systematic, not random.** RT boosts
   well-executed crowd-pleasers (Sonic 3: +16 ranks; Paddington in Peru: +14;
   Transformers One: +12); MC boosts divisive prestige films (Challengers,
   Civil War, The Bikeriders: +8-9 ranks). The source choice decides which of
   these two games you're playing.

6. **Calibration:** MC baseline **60** reproduces the current system's overall
   feel (56% of the slate positive, median ≈ +3.5) — baseline 65 makes 62% of
   draftable movies score negative, which would feel punishing. For RT,
   baseline 75 is right (54% positive); baseline 80 is too harsh (40%).

7. **Draft simulation:** identical hype-order rosters produce different
   podiums. The winner is stable across systems (a roster carried by
   late-round prestige picks), but 2nd-4th reshuffle: RT systems promote the
   crowd-pleaser roster (Sonic 3 + Transformers One + Paddington), MC systems
   promote rosters holding Anora / The Brutalist / The Wild Robot / Challengers.

## Caveats

- One season, one (synthetic) draft order; scores are settled values with
  ±3 pt tolerance, not MDBList API pulls.
- Anticipation ranking is approximate; a real league's draft would differ.
- MC coverage of small/indie releases is thinner than RT's — a production
  implementation needs a documented fallback (e.g., a fixed RT→MC-equivalent
  mapping) for movies without a metascore.

## Part 1 recommendation (superseded — see Part 2)

**Metacritic-only, baseline 60, 2× at 85** (`mc_b60`) maximizes top-end skill
separation. Part 2 revises this: separation turns out not to be a property of
the Fantasy Critic experience, which is the stated design target.

---

# Part 2 — Matching Fantasy Critic's actual distribution

Benchmark: the 2024 "draftable" games season (50 anticipated/notable titles
with settled OpenCritic scores) run through Fantasy Critic's exact
`StandardScoringSystem` (baseline 70, 2× at 90, halving slopes below 60).

## What Fantasy Critic's season actually looks like

| Metric | FC benchmark (OpenCritic 2024) |
|---|---:|
| Mean / median points | +10.2 / +10.5 |
| % of slate positive | **86%** |
| % of slate in the 2× tier | **18%** (9 of 50 games hit 90+) |
| #1 vs #10 gap | 11.0 |
| Std of top 15 | 3.8 |
| Max single score | +30 |

Two properties define the FC feel:

1. **The 90+ jackpot is genuinely frequent** — 18% of the slate, roughly 1–2
   per 10-slot roster per season. (2024 was a strong games year; 10–15% is
   more typical.)
2. **The top is compressed, not spread.** FC's #1-to-#10 gap is 11 points and
   its top-15 std is 3.8 — nearly identical to RT-only movie variants and
   completely unlike MC-only (gap 25–28, std 9–11). FC is won by accumulating
   many good picks, not by landing one monster score.

Point 2 invalidates the Part 1 tiebreaker: the "skill separation" that favored
Metacritic is a property FC does not have and FC players do not miss.

## Calibration sweep vs FC targets (movies, 2024 slate)

Best matches (full table in `results.txt`):

| Config | %pos | 2× tier | #1–#10 gap | std top15 | max | verdict |
|---|---:|---:|---:|---:|---:|---|
| FC benchmark | 86% | 18% | 11.0 | 3.8 | 30 | target |
| **RT b60 / 2× at 90** | 66% | 16% | 13.0 | 4.8 | 42 | **closest overall shape** |
| RT b65 / 2× at 90 | 62% | 16% | 13.0 | 4.8 | 37 | slightly stingier |
| MC b50 / 2× at 78 | 76% | 18% | 27.0 | 10.2 | 54 | right frequencies, wrong shape — one movie (Anora, +54) dominates a season |

The Tomatometer's distribution over a draftable slate is nearly isomorphic to
OpenCritic's (similar median, similar 85–95 mass); Metacritic movie scores sit
~15 points lower with a thin top tail, so forcing FC frequencies onto MC
requires constants (baseline 50, 2× at 78) that blow the top open instead.

**The one unmatchable gap:** movies genuinely fail more often than draftable
games. FC's 86% positive rate can't be reached honestly — matching it would
require a baseline near RT 50, i.e. rewarding rotten movies. RT baseline 60
(Rotten Tomatoes' own Fresh line — "fresh = positive points, rotten =
negative") gets to 66% positive and is the most explainable rule available.
The extra downside depth is arguably a feature: this app has counterpicks,
and at baseline 60 a 2024 season offers ~19 viable counterpick targets vs ~6
in FC's game season.

## Revised recommendation

**Rotten Tomatoes only · baseline 60 (the Fresh line) · 2× accelerator at 90 ·
Fantasy Critic diminishing curve below 50 · no threshold bonuses.**

- Mean +11.0 vs FC's +10.2; 2× tier 16% vs FC's 18% (~1–2 jackpot movies per
  10-slot roster); top gap 13.0 vs FC's 11.0; top-15 std 4.8 vs FC's 3.8.
- Maximally predictable: one number everyone already knows, pivots on RT's own
  Fresh branding, "the 90% club" as the jackpot tier.
- If the ~66% positive rate feels too harsh in play, soften the downside by
  starting the slope-halving immediately below the baseline (busts land
  −5..−12 instead of −15..−19) rather than by moving the baseline.
