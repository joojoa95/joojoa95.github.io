(() => {
  const CFG = window.CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // ---------- tiny DOM helper (uses text nodes only, so no HTML injection) ----------
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- state ----------
  let state = null; // { event, genre, title, moments: [{ name, tracks: [track] }] }
  let uid = 0;
  const newId = () => 't' + ++uid;
  let playingId = null;
  let dragId = null;

  const makeTrack = (t) => ({
    id: newId(), title: t.title, artist: t.artist, note: t.note || '',
    lookup: 'pending', // pending | found | missing
    meta: null         // { art, preview }
  });
  const allTracks = () => state.moments.flatMap((m) => m.tracks);
  const findTrack = (id) => allTracks().find((t) => t.id === id);
  const locate = (id) => {
    for (let mi = 0; mi < state.moments.length; mi++) {
      const ti = state.moments[mi].tracks.findIndex((t) => t.id === id);
      if (ti > -1) return { mi, ti };
    }
    return null;
  };

  // ---------- status ----------
  function setStatus(msg, isError = false) {
    const s = $('status');
    s.className = isError ? 'err' : '';
    s.replaceChildren(msg || '');
  }

  // ---------- API (your Cloudflare Worker) ----------
  async function api(body) {
    if (!CFG.API_URL || CFG.API_URL.includes('YOUR-SUBDOMAIN')) {
      throw new Error('This site is not connected to its playlist server yet. Set API_URL in config.js.');
    }
    const r = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  // ---------- generate ----------
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const event = $('event').value.trim();
    const genre = $('genre').value.trim();
    const count = Number($('count').value);
    if (!event || !genre) return;

    const btn = $('go');
    btn.disabled = true;
    btn.textContent = 'Picking songs…';
    setStatus('Picking songs for your event…');
    stopAudio();
    try {
      const data = await api({ action: 'generate', event, genre, count });
      state = {
        event, genre, title: data.title,
        moments: data.moments.map((m) => ({ name: m.name, tracks: m.tracks.map(makeTrack) }))
      };
      render();
      setStatus('Checking each song against the catalog…');
      allTracks().forEach(enqueue);
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Make my playlist';
    }
  });

  // ---------- catalog lookup (iTunes Search: no key, gives art + 30s previews) ----------
  const queue = [];
  let running = 0;
  const MAX_PARALLEL = 2;

  function enqueue(track) {
    queue.push(track);
    pump();
  }
  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      const t = queue.shift();
      running++;
      lookup(t).finally(() => {
        running--;
        if (!queue.length && running === 0) finishedLookups();
        setTimeout(pump, 350); // stay under the public rate limit
      });
    }
  }
  function finishedLookups() {
    if (!state) return;
    const missing = allTracks().filter((t) => t.lookup === 'missing').length;
    setStatus(missing
      ? `Done. ${missing} song${missing > 1 ? 's' : ''} could not be confirmed. You can swap or remove them.`
      : 'Done. Every song was found in the catalog.');
  }

  const norm = (s) => String(s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const loose = (a, b) => a && b && (a.includes(b) || b.includes(a));

  async function lookup(t, attempt = 0) {
    try {
      const q = encodeURIComponent(`${t.title} ${t.artist}`);
      const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=10`);
      if (!r.ok) throw new Error('rate limited');
      const { results = [] } = await r.json();
      const a = norm(t.artist), ti = norm(t.title);
      const hit = results.find((x) => loose(norm(x.artistName), a) && loose(norm(x.trackName), ti));
      if (hit) {
        t.meta = { art: (hit.artworkUrl100 || '').replace('100x100', '200x200'), preview: hit.previewUrl || '' };
        t.lookup = 'found';
      } else {
        t.lookup = 'missing';
      }
    } catch {
      if (attempt < 2) {
        await sleep(4000 * (attempt + 1));
        return lookup(t, attempt + 1);
      }
      t.lookup = 'missing';
    }
    updateRow(t.id);
  }

  // ---------- rendering ----------
  function render() {
    $('empty').hidden = !!state;
    $('result').hidden = !state;
    if (!state) return;
    $('title').textContent = state.title;
    $('moments').replaceChildren(...state.moments.map(momentEl));
    $('tools').replaceChildren(...toolButtons());
  }

  function toolButtons() {
    const btns = [];
    if (CFG.SPOTIFY_CLIENT_ID) {
      btns.push(el('button', { type: 'button', class: 'tool primary', onclick: spotifyLogin }, 'Save to Spotify'));
    }
    btns.push(el('button', { type: 'button', class: 'tool', onclick: copyList }, 'Copy list'));
    btns.push(el('button', { type: 'button', class: 'tool', onclick: downloadCsv }, 'Download CSV'));
    btns.push(el('button', { type: 'button', class: 'tool', onclick: () => $('form').requestSubmit() }, 'Redo all'));
    return btns;
  }

  function momentEl(m) {
    const ul = el('ul', { class: 'tracks' }, m.tracks.map(rowEl));
    ul.addEventListener('dragover', (e) => e.preventDefault());
    ul.addEventListener('drop', (e) => {
      if (e.target === ul && dragId) { e.preventDefault(); moveToEnd(dragId, m); }
    });
    return el('section', { class: 'moment' },
      el('h3', {}, m.name, el('span', {}, `${m.tracks.length} song${m.tracks.length === 1 ? '' : 's'}`)),
      ul);
  }

  function rowEl(t) {
    const playable = !!(t.meta && t.meta.preview);
    const isPlaying = playingId === t.id;
    const q = encodeURIComponent(`${t.title} ${t.artist}`);

    const art = el('div', { class: 'art' },
      t.meta && t.meta.art ? el('img', { src: t.meta.art, alt: '', width: 52, height: 52, loading: 'lazy' }) : '♪',
      el('button', {
        type: 'button', class: 'play', disabled: !playable,
        'aria-label': `${isPlaying ? 'Pause' : 'Play preview of'} ${t.title}`,
        onclick: () => togglePlay(t)
      }, isPlaying ? '❚❚' : '▶'));

    const info = el('div', {},
      el('div', { class: 't-title' }, t.title),
      el('div', { class: 't-artist' }, t.artist),
      t.note ? el('div', { class: 't-note' }, t.note) : null,
      t.lookup === 'pending' ? el('div', { class: 't-flag' }, 'Checking catalog…') : null,
      t.lookup === 'missing' ? el('div', { class: 't-flag' }, 'Could not confirm this song exists. Swap it if it looks wrong.') : null,
      el('div', { class: 't-links' },
        el('a', { href: `https://www.youtube.com/results?search_query=${q}`, target: '_blank', rel: 'noopener' }, 'Find on YouTube'),
        el('a', { href: `https://open.spotify.com/search/${q}`, target: '_blank', rel: 'noopener' }, 'Find on Spotify')));

    const acts = el('div', { class: 'acts' },
      el('button', { type: 'button', class: 'up', 'aria-label': `Move ${t.title} up`, title: 'Move up', onclick: () => moveBy(t.id, -1) }, '↑'),
      el('button', { type: 'button', class: 'down', 'aria-label': `Move ${t.title} down`, title: 'Move down', onclick: () => moveBy(t.id, 1) }, '↓'),
      el('button', { type: 'button', class: 'swap', 'aria-label': `Swap ${t.title} for a different song`, title: 'Swap for a different song', onclick: (e) => swapTrack(t.id, e.currentTarget) }, '⟳'),
      el('button', { type: 'button', class: 'remove', 'aria-label': `Remove ${t.title}`, title: 'Remove', onclick: () => removeTrack(t.id) }, '✕'));

    const li = el('li', { class: 'track' + (isPlaying ? ' playing' : ''), 'data-id': t.id, draggable: 'true' }, art, info, acts);
    li.addEventListener('dragstart', (e) => {
      dragId = t.id; li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
    });
    li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); document.querySelectorAll('.over').forEach((n) => n.classList.remove('over')); });
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); li.classList.remove('over'); if (dragId && dragId !== t.id) moveBefore(dragId, t.id); });
    return li;
  }

  function updateRow(id) {
    const t = state && findTrack(id);
    const node = document.querySelector(`[data-id="${id}"]`);
    if (t && node) node.replaceWith(rowEl(t));
  }

  // ---------- editing the playlist ----------
  function moveBy(id, dir) {
    const loc = locate(id); if (!loc) return;
    const ms = state.moments, tracks = ms[loc.mi].tracks, i = loc.ti;
    if (dir < 0) {
      if (i > 0) [tracks[i - 1], tracks[i]] = [tracks[i], tracks[i - 1]];
      else if (loc.mi > 0) ms[loc.mi - 1].tracks.push(tracks.splice(i, 1)[0]);
    } else {
      if (i < tracks.length - 1) [tracks[i + 1], tracks[i]] = [tracks[i], tracks[i + 1]];
      else if (loc.mi < ms.length - 1) ms[loc.mi + 1].tracks.unshift(tracks.splice(i, 1)[0]);
    }
    cleanEmpty();
    render();
    const node = document.querySelector(`[data-id="${id}"] .${dir < 0 ? 'up' : 'down'}`);
    if (node) node.focus();
  }

  function moveBefore(id, beforeId) {
    const from = locate(id); if (!from) return;
    const [t] = state.moments[from.mi].tracks.splice(from.ti, 1);
    const to = locate(beforeId);
    state.moments[to.mi].tracks.splice(to.ti, 0, t);
    cleanEmpty(); render();
  }

  function moveToEnd(id, moment) {
    const from = locate(id); if (!from) return;
    const [t] = state.moments[from.mi].tracks.splice(from.ti, 1);
    moment.tracks.push(t);
    cleanEmpty(); render();
  }

  function cleanEmpty() {
    state.moments = state.moments.filter((m) => m.tracks.length);
  }

  function removeTrack(id) {
    const loc = locate(id); if (!loc) return;
    const [t] = state.moments[loc.mi].tracks.splice(loc.ti, 1);
    if (playingId === id) stopAudio();
    cleanEmpty();
    render();
    setStatus(`Removed “${t.title}”.`);
  }

  async function swapTrack(id, btn) {
    const loc = locate(id); if (!loc) return;
    const old = state.moments[loc.mi].tracks[loc.ti];
    btn.disabled = true;
    setStatus(`Finding a replacement for “${old.title}”…`);
    try {
      const data = await api({
        action: 'replace', event: state.event, genre: state.genre,
        moment: state.moments[loc.mi].name,
        replacing: { title: old.title, artist: old.artist },
        avoid: allTracks().map((t) => ({ title: t.title, artist: t.artist }))
      });
      const now = locate(id); // position may have changed while waiting
      if (!now) return;
      const fresh = makeTrack(data.track);
      state.moments[now.mi].tracks[now.ti] = fresh;
      if (playingId === id) stopAudio();
      render();
      enqueue(fresh);
      setStatus(`Swapped in “${fresh.title}” by ${fresh.artist}.`);
    } catch (err) {
      btn.disabled = false;
      setStatus(err.message, true);
    }
  }

  // ---------- audio previews ----------
  const audio = $('player');
  function setPlaying(id) {
    const prev = playingId;
    playingId = id;
    [prev, id].forEach((x) => x && updateRow(x));
  }
  function stopAudio() {
    audio.pause();
    if (playingId) setPlaying(null);
  }
  function togglePlay(t) {
    if (playingId === t.id) { stopAudio(); }
    else {
      audio.src = t.meta.preview;
      audio.play().then(() => setPlaying(t.id)).catch(() => setStatus('That preview could not play.', true));
    }
    const btn = document.querySelector(`[data-id="${t.id}"] .play`);
    if (btn) btn.focus();
  }
  audio.addEventListener('ended', () => setPlaying(null));

  // ---------- export: copy + CSV ----------
  function copyList() {
    const lines = [state.title, ''];
    state.moments.forEach((m) => {
      lines.push(m.name);
      m.tracks.forEach((t, i) => lines.push(`${i + 1}. ${t.title} - ${t.artist}`));
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n').trim())
      .then(() => setStatus('Copied the list to your clipboard.'))
      .catch(() => setStatus('Your browser blocked copying. Try the CSV instead.', true));
  }

  function downloadCsv() {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [['Section', 'Title', 'Artist']];
    state.moments.forEach((m) => m.tracks.forEach((t) => rows.push([m.name, t.title, t.artist])));
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'playlist.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- export: Spotify (Authorization Code with PKCE, no backend) ----------
  const SP = {
    auth: 'https://accounts.spotify.com/authorize',
    token: 'https://accounts.spotify.com/api/token',
    api: 'https://api.spotify.com/v1'
  };
  const redirectUri = location.origin + location.pathname;
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function spotifyLogin() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const st = b64url(crypto.getRandomValues(new Uint8Array(12)));
    try {
      sessionStorage.setItem('setlist-sp', JSON.stringify({ verifier, st, state }));
    } catch {
      setStatus('Your browser blocks storage, so Spotify sign-in cannot continue.', true);
      return;
    }
    const p = new URLSearchParams({
      response_type: 'code', client_id: CFG.SPOTIFY_CLIENT_ID,
      scope: 'playlist-modify-private', redirect_uri: redirectUri,
      code_challenge_method: 'S256', code_challenge: challenge, state: st
    });
    location.href = `${SP.auth}?${p}`;
  }

  async function handleSpotifyReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return;
    history.replaceState({}, '', location.pathname);

    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('setlist-sp')); sessionStorage.removeItem('setlist-sp'); } catch {}
    if (saved && saved.state) {
      state = saved.state;
      render();
      allTracks().filter((t) => t.lookup === 'pending').forEach(enqueue);
    }
    if (q.get('error') || !saved || saved.st !== q.get('state')) {
      setStatus('Spotify sign-in was cancelled. Your playlist is still here.', true);
      return;
    }
    setStatus('Connected. Matching songs on Spotify…');
    try {
      const r = await fetch(SP.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: q.get('code'),
          redirect_uri: redirectUri, client_id: CFG.SPOTIFY_CLIENT_ID, code_verifier: saved.verifier
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error('Spotify did not accept the sign-in.');
      await saveToSpotify(d.access_token);
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  async function saveToSpotify(token) {
    const sp = async (path, opts = {}) => {
      const r = await fetch(SP.api + path, {
        ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (!r.ok) throw new Error(`Spotify returned an error (${r.status}). If this app is in development mode, your account must be added to its user list.`);
      return r.status === 204 ? null : r.json();
    };
    const uris = []; let missed = 0;
    for (const t of allTracks()) {
      try {
        const d = await sp(`/search?q=${encodeURIComponent(`track:${t.title} artist:${t.artist}`)}&type=track&limit=1`);
        const item = d.tracks.items[0];
        item ? uris.push(item.uri) : missed++;
      } catch (err) {
        if (!uris.length && missed === 0) throw err; // first call failing means auth/config problem
        missed++;
      }
    }
    if (!uris.length) throw new Error('None of the songs were found on Spotify.');

    const pl = await sp('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: state.title, description: `Made with Setlist for: ${state.event}`.slice(0, 300), public: false })
    });
    for (let i = 0; i < uris.length; i += 100) {
      await sp(`/playlists/${pl.id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
    }
    const link = el('a', { href: pl.external_urls && pl.external_urls.spotify, target: '_blank', rel: 'noopener' }, 'Open it in Spotify');
    setStatus(el('span', {}, `Saved ${uris.length} songs${missed ? ` (${missed} not found on Spotify)` : ''}. `, link));
  }

  // ---------- examples ----------
  const EXAMPLES = [
    { event: "Rooftop birthday for my sister's 30th", genre: 'Afrobeats' },
    { event: 'Study group the night before finals', genre: 'Lo-fi' },
    { event: 'Road trip with friends on a Friday night', genre: 'Indie' },
    { event: 'Quiet dinner party for eight', genre: 'Jazz' },
    { event: 'Morning run before a 10K race', genre: 'Electronic' }
  ];
  $('chips').replaceChildren(...EXAMPLES.map((ex) =>
    el('button', { type: 'button', onclick: () => {
      $('event').value = ex.event; $('genre').value = ex.genre; $('go').focus();
    } }, `${ex.event} (${ex.genre})`)));

  // ---------- start ----------
  handleSpotifyReturn();
})();
