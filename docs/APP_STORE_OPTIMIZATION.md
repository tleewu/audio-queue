# cue — App Store Optimization Strategy

Zero-budget, organic-search-only launch plan. Researched July 2026. Apple only documents the basics officially ([developer.apple.com/app-store/search](https://developer.apple.com/app-store/search/)); field weights below are strong industry consensus, not gospel.

---

## 1. How App Store search ranking works

Apple ranks by **text relevance** (app name, subtitle, keyword field, primary category) plus **user behavior** (downloads, ratings, engagement, retention).

Indexed fields, in rough order of weight:

1. **App name (30 chars)** — heaviest.
2. **Subtitle (30 chars)** — second.
3. **Keyword field (100 chars)** — comma-separated, no spaces after commas.
4. **In-app purchase names** — indexed; name any future subscription something keyword-bearing (e.g. "Cue Premium: Unlimited Listen Later").
5. **In-app event titles/descriptions** — indexed, mostly surfaces to existing users.
6. **Developer name** — weakly indexed.
7. **Screenshot captions** — since ~mid-2025, Apple OCRs caption text in the first three screenshots and uses it as ranking metadata.
8. **Primary category** — part of text relevance.
9. **NOT indexed:** the description and promotional text. Write those purely for conversion.

Behavioral factors you can't metadata around:

- **Retention (D1/D7) now outranks raw downloads.** Churny install bursts actively hurt. Onboarding must reach the aha moment (share → item in queue → plays) in under a minute.
- **Rating trajectory beats rating average** — recent reviews weigh more.
- **Launch honeymoon:** new apps get a temporary keyword boost in their first ~week per country, once per country. Launch with final metadata — don't "fix it later."
- Apple now LLM-generates app tags from metadata, so coherent honest metadata beats keyword soup.

## 2. Keyword strategy

**A brand-new app with zero ratings cannot win head terms.** "podcast player" (competitiveness ~97) is owned by apps with millions of downloads. The strategy is: **own the long tail, borrow the head.** Within one locale, Apple composes phrases from individual words across title + subtitle + keyword field — you rank for combinations you never typed.

| Term | Verdict |
|---|---|
| `listen later` | **Our best term.** Exact-match intent, weak competition. Goes in the title. |
| `save for later` / `read later` | Mid competition; Pocket's shutdown orphaned this traffic. Compose from parts. |
| `audio queue` / `podcast queue` | Tiny volume, rankable #1 fast. |
| `listen to articles` / `read aloud` | Mid-tail, strong intent. |
| `podcast player` | Include the words, don't expect the phrase soon. |
| `text to speech` | Dominated by Speechify et al.; component words only. |
| `spotify`, `youtube` | **Never in keywords** — Guideline 2.3.7 trademark violation. Mention compatibility in the description only. |

## 3. The "cue" name problem

The store already has many "Cue" apps (AI note takers, astrology, robotics). Consequences:

1. We will not own the bare query "cue" for a long time. Train users on a compound brand search — "cue listen later" — on the website and everywhere else.
2. A bare "Cue" title wastes 27 of the 30 highest-weight characters and risks a Guideline 2.3.7 unique-name rejection. Use the standard `Brand: descriptor` pattern.

## 4. Recommended metadata (US storefront)

- **Title (17/30):** `Cue: Listen Later`
- **Subtitle (28/30):** `Your podcast & article queue`
- **Keywords (95/100):** `save,for,read,aloud,text,to,speech,audio,player,watch,video,playlist,reader,voice,episode,speed`

Rationale: zero duplicated words across fields (duplicates burn characters); composes *listen later*, *podcast queue*, *audio queue*, *podcast player*, *save for later*, *listen to articles*, *read aloud*, *text to speech*, *watch later*, *audio playlist*, *playback speed*. "for"/"to" are deliberate — they're required to compose "save **for** later" and "text **to** speech".

Alternates:
- Head-term aggressive: `Cue: Podcast & Audio Queue` + `Save now, listen later`.
- Article-first: `Cue: Listen Later` + `Turn articles & links to audio`.

**Cross-localization (free keyword multiplier):** the US storefront also indexes Spanish (MX), plus several other locales. Fill Spanish (MX) title/subtitle/keywords with a second set of *English* keywords (e.g. `bookmarks,inbox,offline,commute,transcript,catch,up,news,feed,rss,shows`). Words don't combine across locales, so keep whole phrases within one locale. Each locale ≈ 160 extra indexed characters.

## 5. Screenshots (conversion + ranking)

Most users decide from the first 1–3 screenshots shown directly in search results; captions are OCR-indexed. Order:

1. **"Save now. Listen later."** — queue view, readable at thumbnail size.
2. **"Share anything, hear everything"** — share sheet catching a Spotify episode, an Apple Podcasts link, an article. The magic moment; must be in the first three.
3. **"One continuous audio queue"** — playlist view (indexes "audio queue").
4. **"A real podcast player"** — lock screen controls, speed chips, background audio.
5. **"Your commute, sorted"** — lifestyle frame.
6. Trust frame — ratings/press once they exist; privacy statement until then.

Skip the preview video at launch; revisit once screenshots are converting.

## 6. Category

**Primary: News** (peer set: Overcast, Pocket Casts, Matter, Instapaper — reinforces semantic relevance for podcast queries). **Secondary: Productivity.** Revisit with launch data; category is changeable in updates.

## 7. Ratings prompts

- Use `SKStoreReviewController` / `requestReview` — system-capped at 3 prompts/user/365 days.
- Trigger after a success moment: **finishing playback of the 3rd–5th queued item**, user age > 7 days, once per version. Never mid-flow.
- Never incentivize reviews (program-expulsion risk).

## 8. No-budget launch checklist

**Pre-launch (2–4 weeks out)**
- [ ] Lock title/subtitle/keywords above (honeymoon boost amplifies launch metadata).
- [ ] Spanish (MX) + 2–3 secondary locales filled with overflow English keywords.
- [ ] Screenshots 1–3 with keyword-bearing captions.
- [ ] Landing page + email list; TestFlight beta with target-persona users (commuters, podcast nerds, read-later refugees).
- [ ] Privacy policy / support / terms URLs live (served by the backend at `/privacy`, `/support`, `/terms`).

**Launch week**
- [ ] Review prompt shipped (completion-of-Nth-listen trigger).
- [ ] Ask beta users to download the App Store build and use it — first ~20 honest ratings are the single biggest conversion unlock.
- [ ] Post where the audience already is: r/podcasts, r/apple, Show HN, Product Hunt. The "Pocket shut down — here's the audio version" angle is genuinely newsworthy.
- [ ] Pitch 5–10 micro-reviewers/newsletters with a promo code (free access fine; paying is not).

**Weeks 2–8**
- [ ] Watch App Store Connect Analytics (App Store Search source): impressions → page views → installs per keyword.
- [ ] Iterate the keyword field every ~4 weeks (algorithm needs 3–4 weeks to settle). Replace terms ranking >50 or with zero impressions.
- [ ] Protect retention: share-to-play must stay under a minute.

**Month 2+**
- [ ] Two custom product pages with keyword assignment (articles-angle, podcast-angle) — CPPs now appear in organic search.
- [ ] True localization for 2–3 markets where competitors are weak (DE, JP, BR) — each locale gets a fresh honeymoon boost.
- [ ] Consider a preview video.

**Key risks:** (a) bare "cue" searches won't surface us — push the compound brand phrase; (b) don't put Spotify/YouTube in keywords; (c) search-ads expansion (March 2026+) makes head terms even less winnable — the long tail is the whole game.
