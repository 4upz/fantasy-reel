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

## Recommendation

**Metacritic-only, baseline 60, 2× at 85, Fantasy Critic diminishing curve
below 50, no threshold bonuses** (`mc_b60`). It matches the current system's
positive/negative feel, revives the gem-hunting accelerator at the right
rarity (3 movies/season), doubles skill separation at the top versus RT, and
reduces the game to one predictable public number. If Tomatometer familiarity
is judged worth the skill-separation cost, `rt75_t90` is the best RT variant.
