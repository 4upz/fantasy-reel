#!/usr/bin/env python3
"""Scoring system simulation for Fantasy Reel.

Compares the current 3-source hybrid scoring system against single-source
alternatives (Metacritic-only and Rotten-Tomatoes-only) using a Fantasy
Critic-style curve, over the 2024 release season.

Dataset: 50 "draftable" 2024 wide/notable releases with settled critic scores
(RT Tomatometer, Metacritic metascore, IMDb rating x10). Scores are settled
end-of-season values, accurate to roughly +/-3 points. `hype` is the
approximate pre-season anticipation rank (1 = most hyped) used to simulate a
neutral snake draft.

Run: python3 simulate_scoring.py
"""

# title, rt, mc, imdb(x10), hype rank
MOVIES = [
    ("Deadpool & Wolverine",              78, 56, 76,  1),
    ("Dune: Part Two",                    92, 79, 85,  2),
    ("Joker: Folie a Deux",               32, 45, 52,  3),
    ("Inside Out 2",                      91, 73, 75,  4),
    ("Wicked",                            88, 73, 74,  5),
    ("Gladiator II",                      70, 64, 65,  6),
    ("Despicable Me 4",                   56, 53, 62,  7),
    ("Godzilla x Kong: The New Empire",   54, 47, 62,  8),
    ("Kingdom of the Planet of the Apes", 80, 66, 71,  9),
    ("Furiosa: A Mad Max Saga",           90, 79, 75, 10),
    ("Moana 2",                           61, 58, 67, 11),
    ("Mufasa: The Lion King",             56, 51, 66, 12),
    ("Venom: The Last Dance",             41, 41, 60, 13),
    ("Kung Fu Panda 4",                   70, 55, 63, 14),
    ("Beetlejuice Beetlejuice",           77, 62, 67, 15),
    ("A Quiet Place: Day One",            85, 67, 66, 16),
    ("Twisters",                          75, 65, 65, 17),
    ("Bad Boys: Ride or Die",             64, 54, 65, 18),
    ("Alien: Romulus",                    80, 64, 71, 19),
    ("Ghostbusters: Frozen Empire",       43, 46, 61, 20),
    ("Sonic the Hedgehog 3",              86, 60, 69, 21),
    ("Madame Web",                        11, 26, 39, 22),
    ("Kraven the Hunter",                 15, 35, 54, 23),
    ("Borderlands",                       10, 27, 46, 24),
    ("The Fall Guy",                      81, 73, 68, 25),
    ("Civil War",                         81, 75, 70, 26),
    ("IF",                                47, 46, 65, 27),
    ("The Garfield Movie",                36, 42, 58, 28),
    ("Argylle",                           33, 35, 57, 29),
    ("Red One",                           31, 41, 65, 30),
    ("Megalopolis",                       46, 56, 48, 31),
    ("Horizon: An American Saga Ch. 1",   50, 52, 66, 32),
    ("The Crow",                          22, 30, 46, 33),
    ("Trap",                              57, 55, 59, 34),
    ("MaXXXine",                          74, 63, 62, 35),
    ("The Bikeriders",                    80, 68, 68, 36),
    ("Challengers",                       88, 82, 71, 37),
    ("Nosferatu",                         85, 78, 72, 38),
    ("The Wild Robot",                    96, 85, 82, 39),
    ("Transformers One",                  89, 65, 76, 40),
    ("Smile 2",                           84, 66, 69, 41),
    ("Terrifier 3",                       77, 61, 64, 42),
    ("Longlegs",                          86, 77, 67, 43),
    ("Speak No Evil",                     84, 65, 67, 44),
    ("The Substance",                     89, 78, 73, 45),
    ("Conclave",                          93, 79, 74, 46),
    ("Saturday Night",                    80, 64, 70, 47),
    ("The Brutalist",                     93, 90, 75, 48),
    ("Anora",                             93, 91, 75, 49),
    ("Paddington in Peru",                93, 66, 69, 50),
]


# ---------------------------------------------------------------------------
# Scoring systems
# ---------------------------------------------------------------------------

def current_system(rt, mc, imdb):
    """Current production formula: weighted avg + baseline-70 hybrid + bonuses."""
    combined = (imdb * 0.35 + rt * 0.40 + mc * 0.25) / 1.0
    if combined >= 90:
        base = 20 + (combined - 90) * 2
    elif combined >= 70:
        base = combined - 70
    else:
        base = max((combined - 70) * 0.5, -15)
    pts = base
    bonuses = []
    if rt >= 75:
        pts += 3
        bonuses.append("CF")
    if imdb >= 80 and rt >= 80 and mc >= 80:
        pts += 5
        bonuses.append("Darling")
    if imdb < 40 or rt < 40 or mc < 40:
        pts -= 5
        bonuses.append("Disaster")
    return round(pts, 2), round(combined, 2), bonuses


def fc_curve(score, baseline, accel):
    """Fantasy Critic StandardScoringSystem shape, generalized.

    Linear 1 pt/pt from (baseline-10) to accel threshold, 2 pts/pt above it,
    slope halves every 10 points below (baseline-10), asymptote ~-(20).
    """
    if score >= accel:
        return (accel - baseline) + 2 * (score - accel)
    if score >= baseline - 10:
        return score - baseline
    pts = -10.0
    slope = 0.5
    bound = baseline - 10
    while True:
        lower = bound - 10
        if score >= lower:
            return pts - (bound - score) * slope
        pts -= slope * 10
        slope /= 2
        bound = lower


SYSTEMS = {
    "current":  lambda m: current_system(m[1], m[2], m[3])[0],
    "mc_b60":   lambda m: round(fc_curve(m[2], 60, 85), 2),
    "mc_b65":   lambda m: round(fc_curve(m[2], 65, 85), 2),
    "rt_b75":   lambda m: round(fc_curve(m[1], 75, 93), 2),
    "rt_b80":   lambda m: round(fc_curve(m[1], 80, 95), 2),
    "rt75_t90": lambda m: round(fc_curve(m[1], 75, 90), 2),
}

LABELS = {
    "current": "Current (3-source blend + bonuses)",
    "mc_b60":  "Metacritic-only, baseline 60, 2x at 85",
    "mc_b65":  "Metacritic-only, baseline 65, 2x at 85",
    "rt_b75":  "RT-only, baseline 75, 2x at 93",
    "rt_b80":  "RT-only, baseline 80, 2x at 95",
    "rt75_t90": "RT-only, baseline 75, 2x at 90",
}


# ---------------------------------------------------------------------------
# Analysis helpers
# ---------------------------------------------------------------------------

def spearman(xs, ys):
    def ranks(vals):
        order = sorted(range(len(vals)), key=lambda i: -vals[i])
        r = [0.0] * len(vals)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den


def snake_draft(movies, n_teams=5):
    """Draft strictly by hype rank; returns team -> list of movies."""
    ordered = sorted(movies, key=lambda m: m[4])
    teams = {i: [] for i in range(n_teams)}
    direction, idx = 1, 0
    for pick, movie in enumerate(ordered):
        teams[idx].append(movie)
        nxt = idx + direction
        if nxt < 0 or nxt >= n_teams:
            direction *= -1
        else:
            idx = nxt
    return teams


def main():
    print("=" * 100)
    print("PER-MOVIE POINTS UNDER EACH SYSTEM (sorted by Metacritic)")
    print("=" * 100)
    header = f"{'Movie':<36}{'RT':>4}{'MC':>4}{'IMDb':>5} | " + "".join(
        f"{k:>9}" for k in SYSTEMS)
    print(header)
    print("-" * len(header))
    for m in sorted(MOVIES, key=lambda m: -m[2]):
        pts = [SYSTEMS[k](m) for k in SYSTEMS]
        print(f"{m[0]:<36}{m[1]:>4}{m[2]:>4}{m[3]:>5} | " +
              "".join(f"{p:>9.1f}" for p in pts))

    print()
    print("=" * 100)
    print("DISTRIBUTION STATS")
    print("=" * 100)
    all_pts = {k: [SYSTEMS[k](m) for m in MOVIES] for k in SYSTEMS}
    print(f"{'System':<10}{'mean':>8}{'median':>8}{'min':>8}{'max':>8}"
          f"{'%pos':>7}{'2x tier':>9}{'top1-10 gap':>13}{'std(top15)':>12}")
    for k, pts in all_pts.items():
        s = sorted(pts, reverse=True)
        n = len(pts)
        med = (s[n // 2] + s[(n - 1) // 2]) / 2
        pos = sum(1 for p in pts if p > 0) / n * 100
        # count movies reaching the accelerated tier
        if k == "current":
            accel = sum(1 for m in MOVIES
                        if current_system(m[1], m[2], m[3])[1] >= 90)
        elif k.startswith("mc"):
            accel = sum(1 for m in MOVIES if m[2] >= 85)
        else:
            t = {"rt_b75": 93, "rt_b80": 95, "rt75_t90": 90}[k]
            accel = sum(1 for m in MOVIES if m[1] >= t)
        top15 = s[:15]
        mean15 = sum(top15) / 15
        std15 = (sum((p - mean15) ** 2 for p in top15) / 15) ** 0.5
        print(f"{k:<10}{sum(pts)/n:>8.1f}{med:>8.1f}{min(pts):>8.1f}"
              f"{max(pts):>8.1f}{pos:>6.0f}%{accel:>9}{s[0]-s[9]:>13.1f}"
              f"{std15:>12.1f}")

    print()
    print("=" * 100)
    print("BONUS TRIGGER COUNTS UNDER CURRENT SYSTEM (n=50)")
    print("=" * 100)
    counts = {"CF": 0, "Darling": 0, "Disaster": 0}
    for m in MOVIES:
        _, _, bonuses = current_system(m[1], m[2], m[3])
        for b in bonuses:
            counts[b] += 1
    for b, c in counts.items():
        print(f"  {b:<10}: {c} movies ({c*2}% of slate)")

    print()
    print("=" * 100)
    print("RANK AGREEMENT (Spearman) AND BIGGEST MC-vs-RT DISAGREEMENTS")
    print("=" * 100)
    for a, b in [("mc_b60", "rt_b75"), ("current", "mc_b60"),
                 ("current", "rt_b75")]:
        rho = spearman(all_pts[a], all_pts[b])
        print(f"  {a} vs {b}: rho = {rho:.3f}")

    def rank_of(pts):
        order = sorted(range(len(pts)), key=lambda i: -pts[i])
        r = [0] * len(pts)
        for pos, i in enumerate(order):
            r[i] = pos + 1
        return r

    r_mc = rank_of(all_pts["mc_b60"])
    r_rt = rank_of(all_pts["rt_b75"])
    diffs = sorted(range(len(MOVIES)), key=lambda i: -abs(r_mc[i] - r_rt[i]))
    print("\n  Movie                                MC-rank  RT-rank   delta")
    for i in diffs[:8]:
        m = MOVIES[i]
        print(f"  {m[0]:<36}{r_mc[i]:>7}{r_rt[i]:>9}{r_rt[i]-r_mc[i]:>+8}")

    print()
    print("=" * 100)
    print("SIMULATED 5-TEAM SNAKE DRAFT (by pre-season hype), FINAL STANDINGS")
    print("=" * 100)
    teams = snake_draft(MOVIES)
    names = ["Team A", "Team B", "Team C", "Team D", "Team E"]
    for k in SYSTEMS:
        totals = []
        for t, roster in teams.items():
            totals.append((names[t], sum(SYSTEMS[k](m) for m in roster)))
        totals.sort(key=lambda x: -x[1])
        line = "  ".join(f"{n}: {p:>7.1f}" for n, p in totals)
        print(f"{k:<10} | {line}")

    print("\nRosters (snake order by hype):")
    for t, roster in teams.items():
        print(f"  {names[t]}: " + ", ".join(m[0] for m in roster))


if __name__ == "__main__":
    main()
