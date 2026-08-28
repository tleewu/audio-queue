# cue

**Save now, listen later.** Share a link to cue. If it's a podcast episode, it goes into your audio queue — background audio, lock-screen controls, playback speed, progress memory. If it isn't, it's saved as a web item and opens in a web view.

## How it works

```
iOS app (SwiftUI)  ──►  backend (Express + Prisma + Postgres, Railway)
      │                       │
  share sheet          page title → Listen Notes episode search
      │                       │
  AVPlayer  ◄─── episode audio (CDN)   ·   no match ─► web view
```

Resolution is one path, run server-side while the link is being saved:

1. Fetch the shared page and read its title (and show/channel name, when the page exposes one).
2. Search [Listen Notes](https://www.listennotes.com/api/) for an episode with that title. A close enough title match — with the show name breaking ties — wins.
3. A match returns the episode's own CDN audio, so playback never depends on the platform page. No match means the link is saved as a web item and opened in `SFSafariViewController`.

Nothing is ever dropped: an unreachable page, a missing API key or a failed search all end in the same place — a web item.

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
| `LISTEN_NOTES_API_KEY` | yes, in practice | [Listen Notes](https://www.listennotes.com/api/) episode search — without it every link becomes a web item |
| `SUPPORT_EMAIL` | optional | shown on /privacy, /support, /terms pages |
| `PORT` | no | defaults to 8080 |

### API

- `POST /api/auth/apple` — Sign in with Apple → JWT
- `GET /api/auth/me` — token validation
- `DELETE /api/auth/account` — permanent account + data deletion (App Store 5.1.1(v))
- `GET/POST/PATCH/DELETE /api/queue…` — queue CRUD (auth required). `POST` resolves the link before replying, so the item comes back final.
- `GET /privacy`, `/support`, `/terms` — static pages for the App Store listing

A queue item is a podcast episode when `audioURL` is set and a web item when it isn't; the client needs no other classification.

Security: helmet, per-route rate limits, 64 KB body limit, SSRF guard on user-supplied URLs (private/link-local address ranges are rejected before any fetch).

## iOS

Xcode project in `iOS/` (generated with XcodeGen from `project.yml`; the checked-in `.xcodeproj` is current). Requires iOS 17+.

- `AudioQueue/` — app target (SwiftUI). Display name: **cue**.
- `ShareExtension/` — "Add to cue" share sheet target; hands URLs to the app via the App Group.
- `AudioQueueTests/` — unit tests.

The interface is text only — no artwork, thumbnails or episode images anywhere. One screen holds the header, the queue, and a player bar that opens the full-screen player; `AudioEngine` owns the AVPlayer, the play order, and position memory.

Point the app at a local backend with the `AUDIO_QUEUE_BACKEND_URL` scheme environment variable.

Before archiving for the App Store, set `DEVELOPMENT_TEAM` in `project.yml` to your Team ID and bump `CFBundleShortVersionString`.

## Launch

See [docs/APP_STORE_OPTIMIZATION.md](docs/APP_STORE_OPTIMIZATION.md) for the metadata package (title/subtitle/keywords), screenshot plan, and the zero-budget launch checklist.
