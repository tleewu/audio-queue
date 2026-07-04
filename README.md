# cue

**Save now, listen later.** Share podcast episodes, YouTube/X videos, and articles into cue from any app, and it builds one continuous audio queue you can listen to like a podcast — background audio, lock-screen controls, playback speed, progress memory.

## How it works

```
iOS app (SwiftUI)  ──►  backend (Express + Prisma + Postgres, Railway)
      │                       │
  share sheet             resolver pipeline
  AVPlayer  ◄──────  direct CDN audio, or /api/stream proxy
```

Every saved link is resolved server-side into the best playable form:

| Source | Resolution | Playback |
|---|---|---|
| Spotify / Apple Podcasts links | Podcast directories (Listen Notes → Podcast Index → iTunes lookup) map the link to the exact episode's own CDN audio. Never plays from the platform page. | `direct` |
| YouTube | 1) episode match on a podcast RSS feed → direct audio; 2) yt-dlp audio extraction → streamed through the backend proxy; 3) fallback: opens in the YouTube app | `direct` / `proxy` / `external` |
| X (Twitter) video | yt-dlp extraction → backend proxy; fallback opens in the X app | `proxy` / `external` |
| RSS feeds, direct audio files, Substack | parsed directly | `direct` |
| SoundCloud, Vimeo, and anything else yt-dlp supports | yt-dlp (HLS plays direct; progressive URLs proxied) | `direct` / `proxy` |

`proxy` playback exists because yt-dlp stream URLs expire and are often IP-locked to the resolving server. `GET /api/stream/:id` relays the audio with Range support (seeking) and transparently re-resolves expired upstream URLs.

## Backend

```bash
cd backend
npm install
npx prisma generate
npm run dev        # ts-node-dev on :8080
npm test           # vitest
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | signs session tokens (90-day expiry) |
| `IOS_BUNDLE_ID` | yes | audience check for Sign in with Apple token verification |
| `PODCAST_INDEX_API_KEY` / `PODCAST_INDEX_API_SECRET` | recommended | free podcast directory ([api.podcastindex.org](https://api.podcastindex.org)) used for show→feed lookup |
| `LISTEN_NOTES_API_KEY` | optional | enables Listen Notes episode-level search ([listennotes.com/api](https://www.listennotes.com/api/)) — the strongest episode matcher; pipeline falls back to Podcast Index without it |
| `SUPPORT_EMAIL` | optional | shown on /privacy, /support, /terms pages |
| `PORT` | no | defaults to 8080 |

### API

- `POST /api/auth/apple` — Sign in with Apple → JWT
- `GET /api/auth/me` — token validation
- `DELETE /api/auth/account` — permanent account + data deletion (App Store 5.1.1(v))
- `GET/POST/PATCH/DELETE /api/queue…` — queue CRUD (auth required)
- `GET /api/stream/:id?token=…` — authenticated audio relay for proxy items
- `POST /api/resolve` — resolve a URL without saving (auth required)
- `GET /privacy`, `/support`, `/terms` — static pages for the App Store listing

Security: helmet, per-route rate limits, 64 KB body limit, SSRF guard on user-supplied URLs (private/link-local address ranges are rejected before any fetch).

## iOS

Xcode project in `iOS/` (generated with XcodeGen from `project.yml`; the checked-in `.xcodeproj` is current). Requires iOS 17+.

- `AudioQueue/` — app target (SwiftUI). Display name: **cue**.
- `ShareExtension/` — "Add to cue" share sheet target; hands URLs to the app via the App Group.
- `AudioQueueTests/` — unit tests.

Point the app at a local backend with the `AUDIO_QUEUE_BACKEND_URL` scheme environment variable.

Before archiving for the App Store, set `DEVELOPMENT_TEAM` in `project.yml` to your Team ID and bump `CFBundleShortVersionString`.

## Launch

See [docs/APP_STORE_OPTIMIZATION.md](docs/APP_STORE_OPTIMIZATION.md) for the metadata package (title/subtitle/keywords), screenshot plan, and the zero-budget launch checklist.
