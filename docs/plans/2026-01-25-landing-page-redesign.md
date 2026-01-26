# Landing Page Redesign: "The Premiere"

## Overview

Redesign the Fantasy Reel landing page to be more captivating, unique, and fun. Move away from generic SaaS template aesthetics toward something with personality and real movie data.

## Emotional Hooks

- **Thrill of prediction** - "I called it!" energy, picking sleeper hits
- **Playful competition** - Fun rivalry, fantasy sports but cooler

## Tone

**Film critic snarky** - Dry wit, Letterboxd review energy. Self-aware, a little pretentious, but fun.

---

## Page Structure

### Section 1: Hero

**Layout:**
- Full viewport height with existing cinematic gradient
- Logo top-left, auth links top-right
- Centered headline with attitude

**Copy:**
```
# Your Hot Takes, Finally Worth Something

Draft upcoming movies. Outscore your friends when the reviews drop.
Finally, a use for your strong opinions about Denis Villeneuve.

[Start a League]  [See How It Works]
```

**Draft Ticker:**
- Horizontal strip running across bottom third of hero
- Glass background with gold accent border
- Scrolls right-to-left continuously, pauses on hover
- Uses REAL upcoming movies from TMDb with poster thumbnails
- Fictional users with personality:
  - `@AlwaysPicksA24`
  - `@HorrorSleeper`
  - `@NobodyAskedMe`
  - `@OscarBaitOnly`
  - `@BlockbusterBro`

**Example entries:**
```
[poster] @HorrorSleeper drafted "Nosferatu" → "stealing"
[poster] @NobodyAskedMe picked "Kraven the Hunter" → "oh no"
[poster] @AlwaysPicksA24 drafted "The Brutalist" → "bold, respect it"
```

---

### Section 2: The Pitch (UI Preview)

**Purpose:** Show what they're signing up for. Kill the mystery.

**Layout:**
- Title: "What You're Getting Into"
- Two-column: copy left, screenshot right

**Copy:**
```
## Draft Night

Pick your roster from upcoming releases. Bid on sleepers.
Steal from your friends' watchlists. The draft is where
reputations are made (and destroyed).

## Then You Wait

Movies release. Critics review. Scores update automatically
from Rotten Tomatoes, IMDb, and Metacritic. Your "risky
Blumhouse pick" either pays off or becomes a running joke.
```

**UI Preview:**
- Actual screenshot of the draft board
- Subtle rotation (2-3°) with soft shadow
- Gold glow behind it
- Caption: *"The draft board. Where friendships go to be tested."*

---

### Section 3: The Critics Have Spoken (Scoring)

**Purpose:** Explain scoring through a dramatic reveal moment.

**Layout:**
- Dark background with spotlight effect
- Real movie poster center stage
- Scores animating in

**Winner Example (real movie with good reviews):**
```
        [Real Movie Poster]

    🍅 94%     ⭐ 8.2     Ⓜ 87

    Drafted at $4. Final score: +32 pts.

    "Called it." — @SleepersOnly
```

**Loser Example (real movie that flopped):**
```
        [Real Movie Poster]

    🍅 38%     ⭐ 4.1     Ⓜ 29

    Drafted at $12. Final score: -20 pts.

    "We don't talk about this one." — @NobodyAskedMe
```

**Copy below:**
```
Your score comes from Rotten Tomatoes, IMDb, and Metacritic.
Pick acclaimed hits, you win. Pick confident flops, you get
roasted in the group chat.

No complex math. No spreadsheets. Just taste.
```

---

### Section 4: Now Drafting (Movie Showcase)

**Purpose:** Visual candy + proof of real data.

**Layout:**
- Section title: "Now Drafting" or "Coming Soon to a League Near You"
- Horizontal scroll of 6-8 upcoming movie posters
- Pulled from TMDb upcoming movies API

**Interaction:**
- Smooth horizontal scroll (drag or scroll wheel)
- Hover on poster shows release date tooltip
- Subtle scale-up on hover

**Visual:**
- Posters slightly overlapping or staggered for depth
- Soft vignette on edges
- Mobile: swipeable carousel

---

### Section 5: CTA Footer

**Layout:**
- Glass panel (`cta-panel`)
- Punchy headline, specific CTA

**Copy:**
```
## Stop Arguing. Start Scoring.

Create a league in 30 seconds. Drag your friends into it.
Gloat when you're right.

[Start a League]

Already have an account? Log in · Got opinions? Good.
```

---

## Technical Implementation

### Data Requirements

**TMDb API calls needed:**
1. Upcoming movies for draft ticker (6-10 movies)
2. Upcoming movies for "Now Drafting" section (6-8 movies)
3. One well-reviewed released movie for scoring example
4. One poorly-reviewed released movie for scoring example

**Approach:**
- Fetch at build time (static) or with ISR for freshness
- Cache aggressively - landing page doesn't need real-time data
- Fallback to hardcoded movies if API fails

### Components to Create/Modify

| Component | Purpose |
|-----------|---------|
| `DraftTicker.tsx` | Scrolling ticker with real movies + fictional users |
| `HeroSection.tsx` | Update copy, integrate ticker |
| `UiPreview.tsx` | Screenshot with styling |
| `ScoringReveal.tsx` | Movie poster + scores + quotes |
| `MovieShowcase.tsx` | Horizontal scroll of upcoming posters |
| `CTAFooter.tsx` | Update copy |

### Fictional Users Data

```typescript
const FICTIONAL_USERS = [
  { handle: '@AlwaysPicksA24', style: 'arthouse' },
  { handle: '@HorrorSleeper', style: 'horror' },
  { handle: '@NobodyAskedMe', style: 'questionable' },
  { handle: '@OscarBaitOnly', style: 'prestige' },
  { handle: '@BlockbusterBro', style: 'mainstream' },
  { handle: '@SleepersOnly', style: 'underdog' },
]

const SNARKY_COMMENTS = {
  good: ['stealing', 'bold, respect it', 'the right call', 'sleeper alert'],
  questionable: ['oh no', 'brave', 'interesting choice', 'we'll see'],
  arthouse: ['peak cinema', 'obviously', 'finally'],
}
```

---

## Files to Create

```
apps/frontend/app/components/landing/
├── HeroSection.tsx      (modify)
├── DraftTicker.tsx      (new)
├── UiPreview.tsx        (new - replaces HowItWorks)
├── ScoringReveal.tsx    (new)
├── MovieShowcase.tsx    (new)
├── CTAFooter.tsx        (modify)
└── types.ts             (new - shared types)
```

---

## Success Criteria

1. Page feels unique, not like a template
2. Real movie posters create immediate recognition
3. Copy makes you smirk at least once
4. Clear what the product does within 5 seconds
5. UI preview removes signup anxiety
6. Mobile experience is smooth (especially movie carousel)
