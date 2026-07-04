import { Router, Request, Response } from 'express';

/**
 * Static legal/support pages required for App Store submission.
 * App Store Connect needs a Privacy Policy URL and a Support URL;
 * serving them from the backend avoids running a separate website.
 */

const router = Router();

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'theowu93@gmail.com';

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — cue</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  a { color: #0a66c2; }
  footer { margin-top: 3rem; font-size: 0.85rem; color: #777; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } a { color: #6bb3ff; } }
</style>
</head>
<body>
${body}
<footer>cue — save now, listen later.</footer>
</body>
</html>`;
}

router.get('/privacy', (_req: Request, res: Response) => {
  res.type('html').send(page('Privacy Policy', `
<h1>Privacy Policy</h1>
<p><em>Last updated: July 4, 2026</em></p>
<p>cue ("the app") is a save-now, listen-later audio queue. This policy describes what we collect and how it is used.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Account:</strong> when you sign in with Apple we store your Apple user identifier and, if you share it, your email address.</li>
  <li><strong>Your queue:</strong> the links you save, plus metadata we resolve for them (title, publisher, artwork, duration, audio location).</li>
  <li><strong>Nothing else.</strong> No analytics SDKs, no advertising identifiers, no location, no contacts.</li>
</ul>

<h2>How it is used</h2>
<p>Your data is used solely to provide the service: keeping your queue in sync across your devices and resolving the links you save into playable audio. We do not sell or share your data with third parties for marketing.</p>

<h2>Third-party lookups</h2>
<p>To resolve a saved link, the app's server may query public directories and services (for example Apple's iTunes lookup, Podcast Index, Listen Notes, or the source website itself). Only the link you saved is sent — never your identity.</p>

<h2>Data retention &amp; deletion</h2>
<p>Your data is retained while your account exists. You can delete your account (and all associated data, immediately and permanently) at any time from <strong>Settings → Delete Account</strong> in the app, or by emailing <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
`));
});

router.get('/support', (_req: Request, res: Response) => {
  res.type('html').send(page('Support', `
<h1>cue Support</h1>
<p>cue is a save-now, listen-later audio queue: share podcast episodes, videos, and articles into the app and listen to them as one continuous queue.</p>

<h2>Common questions</h2>
<h2>How do I add something to my queue?</h2>
<p>Use the iOS share sheet from any app (Spotify, Apple Podcasts, YouTube, X, Safari) and choose <strong>Add to Queue</strong>, or paste a link with the + button in the app.</p>
<h2>Why does an item say it opens in another app?</h2>
<p>Some sources don't allow direct audio extraction. For those, cue keeps the item in your queue and opens the source app to play it.</p>
<h2>How do I delete my account?</h2>
<p>Settings → Delete Account. This immediately and permanently removes your account and queue.</p>

<h2>Contact</h2>
<p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we'll get back to you.</p>
`));
});

router.get('/terms', (_req: Request, res: Response) => {
  res.type('html').send(page('Terms of Use', `
<h1>Terms of Use</h1>
<p><em>Last updated: July 4, 2026</em></p>
<p>By using cue you agree to these terms.</p>
<h2>The service</h2>
<p>cue lets you save links and listen to their audio later. Audio is fetched from the original source or from the publisher's own public feed; cue does not host content and does not claim any rights over it. Content remains subject to the source's own terms.</p>
<h2>Acceptable use</h2>
<p>Save content for your own personal listening. Don't use the service to redistribute content, circumvent paywalls, or overload the systems it talks to.</p>
<h2>Warranty</h2>
<p>The service is provided as-is, without warranty. Sources can change or disappear, and resolution of a given link is not guaranteed.</p>
<h2>Contact</h2>
<p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
`));
});

export default router;
