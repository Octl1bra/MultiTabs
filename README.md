# MultiTabs

English · [中文](README.zh-CN.md)

Keep separate logins in different tabs of the same website, all online at once, in one Chrome window. Think Firefox's Multi-Account Containers, for Chrome.

- Chrome Manifest V3, Chrome 132 or newer
- WXT + TypeScript; popup and options built with React 19, HeroUI v3 and Tailwind v4; the background service worker and content scripts have zero dependencies
- Design doc: [docs/multi-tabs-prd.md](docs/multi-tabs-prd.md) (Chinese); verified technical decisions: [docs/decisions.md](docs/decisions.md) (Chinese); review notes: [docs/prd-review.md](docs/prd-review.md) (Chinese)

## Install

Not on the Chrome Web Store yet. Grab the latest `multitabs-<version>-chrome.zip` from [Releases](https://github.com/Octl1bra/MultiTabs/releases), unzip it, then:

1. Open `chrome://extensions/` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the unzipped folder.

Requires Chrome 132+. To update, unzip the new version over the old folder and hit the refresh button on the extension card.

## How to use

1. Open a site, click the toolbar icon, type a session name, press **New tab**. The new tab opens signed out. Sign in there and that login belongs to the session.
2. Click the icon again: saved sessions can be **Open**ed in a new tab or switched to with **Here** in the current tab.
3. **Leave** returns the current tab to the browser's default session. The session and its cookies are kept for next time.
4. `⌘⇧Y` / `Ctrl+Shift+Y` creates a session for the current site and opens it in a new tab.
5. Tabs opened from a session tab (`window.open`, `target=_blank`, Cmd/Ctrl+click) inherit the session automatically.

The UI follows the browser's language: Chinese when Chrome runs in Chinese, English otherwise.

## How it works, in one paragraph

Every attached tab gets a set of `declarativeNetRequest` session rules filtered by `tabIds`: strip the browser's `Cookie` header, inject the session's own cookies, drop `Set-Cookie` from responses; `webRequest` observes `Set-Cookie` and writes it into the session's jar. On the page side, a MAIN-world `document_start` script patches `document.cookie`, `localStorage` / `sessionStorage`, IndexedDB, CacheStorage, BroadcastChannel and Workers into a per-session namespace. The patch learns which session a document belongs to, before the page's first inline script runs, from a `Server-Timing` response header that the DNR rules inject. Section 6 of the design doc has the details.

## Known limitations

The full list is in section 7 of the design doc. The ones you are most likely to hit:

- Third-party sign-in (Google, GitHub, …) uses the browser's default session; telling accounts apart relies on the provider's account chooser. If the provider just says "Continue as A", both sessions end up as A.
- Service workers are blocked in session tabs (`register` is rejected, existing registrations are removed). Sites that depend on a SW fall back to their no-SW mode.
- The cookie `Path` attribute is ignored.
- A request fired right after `document.cookie = …` may not carry the new cookie yet; rule updates take a round trip through the service worker.
- Session cookies (no expiry) survive browser restarts; they are dropped after 30 days without updates.
- After a browser restart, sessions and cookies are kept but tab attachments are lost; use **Here** again.
- `Clear-Site-Data: "storage"` wipes the site's localStorage / IndexedDB for every session; that can't be intercepted.

## Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | Rewrite `Cookie` / `Set-Cookie` / `Cache-Control` / `Server-Timing` headers per tab |
| `webRequest` | Observe `Set-Cookie` and `Clear-Site-Data` on responses (observe only; MV3 cannot block) |
| `cookies` | `getPartitionKey` to compute the site key; restore default-session cookies removed by `Clear-Site-Data` |
| `scripting` | Fallback injection of the page patch when the signal header is missing |
| `storage` | Sessions and cookie jars (`local`), tab attachments (`session`) |
| `tabs` / `webNavigation` | Attachment lifecycle, new-tab inheritance, the toolbar badge |
| `host_permissions: <all_urls>` | All of the above must work on whatever site you create a session for |

Cookie jars are stored in plain text in `chrome.storage.local`, about as readable as the browser's own cookie store. The extension makes no network requests and has no telemetry. See [PRIVACY.md](PRIVACY.md).

## Development

```bash
pnpm install
pnpm dev          # WXT dev mode, loads .output/chrome-mv3-dev
pnpm build        # output in .output/chrome-mv3
pnpm test         # vitest unit tests
pnpm test:e2e     # puppeteer e2e; needs a local Chrome and openssl, starts its own test site
pnpm typecheck && pnpm lint
```

How the e2e harness launches Chrome (branded Chrome ignores `--load-extension`; we use `installExtension()`) and every trap we fell into are recorded in `docs/decisions.md`.

## Release

Push a `v*` tag. The release workflow runs lint, typecheck and unit tests, checks that the tag matches `package.json`, zips the build and publishes a GitHub Release with the zip attached.
