# Setlist

Describe any event and a genre, get a playlist arranged in the order the event unfolds. You can reorder it, swap or remove songs, preview each one, and export it.

```
Browser (GitHub Pages)  ->  Cloudflare Worker  ->  Anthropic API   (song suggestions)
        |
        +-> iTunes Search API   (checks songs exist, album art, 30s previews)
        +-> Spotify Web API     (optional "Save to Spotify", PKCE login in the browser)
```

## Files

| File | Goes where |
|---|---|
| `index.html`, `style.css`, `app.js`, `config.js`, `sw.js`, `manifest.webmanifest`, `icons/` | GitHub Pages |
| `worker/worker.js`, `worker/wrangler.toml` | Cloudflare Workers |

## 1. Deploy the Worker (the part that holds your API key)

1. Create a free Cloudflare account and an Anthropic API key at console.anthropic.com. Set a monthly spend limit there.
2. In the `worker/` folder:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. Edit `wrangler.toml`: set `ALLOWED_ORIGIN` to `https://YOUR-USERNAME.github.io` (origin only, no repo path).
4. Add your key as a secret, then deploy:
   ```
   wrangler secret put ANTHROPIC_API_KEY
   wrangler deploy
   ```
5. Copy the `https://setlist-proxy.<you>.workers.dev` URL it prints.

## 2. Deploy the front end to GitHub Pages

1. Put `index.html`, `style.css`, `app.js`, and `config.js` at the root of a new GitHub repo (keep `worker/` out of it, or leave it, it is harmless).
2. In `config.js`, set `API_URL` to your Worker URL.
3. Repo Settings > Pages > Deploy from branch > `main` / root.
4. Your site appears at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

To test locally first: `python3 -m http.server 8000` in the front-end folder, then open http://localhost:8000 (that origin is already in `ALLOWED_ORIGIN`).

## 3. Optional: "Save to Spotify"

1. Create an app at developer.spotify.com/dashboard.
2. Add your exact page URL as a Redirect URI, for example `https://YOUR-USERNAME.github.io/REPO-NAME/` (trailing slash must match).
3. Put the Client ID (never the secret) in `config.js` as `SPOTIFY_CLIENT_ID`.

Things to know:
- New Spotify apps start in **development mode**, limited to a short allowlist of users you add by hand. Public use needs Spotify's approval, so read their current developer terms before promising this to everyone. Without it, people can still use "Copy list", "Download CSV", and the per-song YouTube and Spotify search links.
- Spotify has changed its playlist endpoints recently. The code uses `POST /me/playlists` and `POST /playlists/{id}/items`. If saving fails with a 404 or 403, check the current Web API reference and adjust the two paths in `saveToSpotify` in `app.js`.

## Phone and offline use

Setlist is an installable web app (PWA). On GitHub Pages it is served over HTTPS, which is what allows the service worker to run.

**Install it**
- Android (Chrome): an "Install Setlist on this device" button appears in the form panel, or use the browser menu.
- iPhone (Safari): Share button, then "Add to Home Screen". The app shows a hint for this.

**What works offline**
- The whole app opens (the shell is cached by `sw.js`).
- Every playlist you have made is saved on the device automatically and listed under "Your playlists". You can open, reorder, remove, copy, and export them as CSV with no connection.
- A banner tells the user when they are offline, and buttons that need a network say so.

**What needs a connection**
- Making a new playlist or swapping a song (the AI call), song previews, and Save to Spotify.
- Album art is not cached for offline use, so offline rows show a music-note placeholder.
- Songs that were still being checked when you went offline are checked automatically once you reconnect.

**Updating the app after you change files:** bump `VERSION` at the top of `sw.js` (for example to `setlist-shell-v2`) when you deploy, otherwise phones keep serving the old cached files. Updates appear on the next open.

**Phone layout:** once a playlist is showing, the form collapses into a "Change request" button so the playlist is the first thing on screen. Buttons are enlarged on touch screens. Drag-and-drop only turns on for mouse devices, so phones use the arrow buttons.

**Storage note:** saved playlists live in the browser's local storage, so they stay on that device and are lost if the user clears site data. Keep the last 30.

## Known limits

- **iTunes Search is rate-limited** (roughly 20 requests a minute per IP). The app checks songs two at a time with a short delay, so a 40-song playlist takes about a minute to finish checking. Songs show right away, and previews fill in as they are confirmed.
- **AI can suggest songs that do not exist.** Anything not found in the catalog is flagged so the user can swap or remove it.
- **Cost and abuse.** The Worker only accepts your site's origin and rate-limits per IP, but origin headers can be faked outside a browser. Keep the Anthropic spend limit on.
- **Audio.** The app links to and previews songs from Apple's catalog and never hosts audio.
- Genres, events, and results are sent to Anthropic via your Worker. Add a short privacy note to the page if you launch publicly.

## Ideas for later

Share link for a playlist, event-length input ("3 hours"), and a Worker-side cache for repeat event and genre pairs to cut cost.
