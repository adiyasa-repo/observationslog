/* =========================================================
   Observationslog
   Alt gemmes i IndexedDB i denne browser. Ingen netværkskald.
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Konstanter ---------- */
  const DEFAULT_TAGS = ['venter', 'manuel', 'kopiering', 'søgning', 'fejlretning', 'overlevering'];
  const TAG_INFO = {
    venter:       { hue: 70,  desc: 'Ventetid – på system, svar eller person' },
    manuel:       { hue: 255, desc: 'Manuelt arbejde, der kunne automatiseres' },
    kopiering:    { hue: 305, desc: 'Kopiering mellem systemer eller filer' },
    søgning:      { hue: 195, desc: 'Leder efter information' },
    fejlretning:  { hue: 25,  desc: 'Retter fejl eller gør noget om' },
    overlevering: { hue: 145, desc: 'Overlevering mellem personer eller teams' },
  };
  const NONE = '\u0000';
  const TAG_RE = /(?<![\p{L}\p{N}_#&])#([\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?)/gu;
  const PARTIAL_TAG_RE = /(?<![\p{L}\p{N}_#&])#([\p{L}\p{N}_-]*)$/u;
  const BACKUP_NAG_MS = 3 * 24 * 3600 * 1000;
  const LONG_GAP_MS = 5 * 60 * 1000;
  const THEME_KEY = 'obslog-theme';

  /* ---------- Små hjælpere ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISODate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const dateFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const dateLongFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtDate = (iso) => dateFmt.format(parseISODate(iso));
  const fmtDateLong = (iso) => dateLongFmt.format(parseISODate(iso));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const unique = (arr) => [...new Set(arr)];

  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return m < 10 && s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} t ${m % 60} min` : `${h} t`;
  }

  const normTag = (t) => t.toLowerCase();
  /** Fjerner #tags fra teksten – de vises som chips i stedet. */
  const stripTags = (text) => String(text).replace(TAG_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1').replace(/ *\n */g, '\n').trim();
  const parseTags = (text) => unique([...String(text).matchAll(TAG_RE)].map((m) => normTag(m[1])));
  function hashHue(s) { let h = 7; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h % 360; }
  const tagHue = (t) => (TAG_INFO[t] ? TAG_INFO[t].hue : hashHue(t));
  const applyHues = (root) => $$('[data-h]', root).forEach((el) => el.style.setProperty('--h', el.dataset.h));
  const applyWidths = (root) => $$('[data-w]', root).forEach((el) => el.style.setProperty('width', `${(+el.dataset.w * 100).toFixed(2)}%`));

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.5 8.5z"/><circle cx="8" cy="8" r="1.4"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    offline: '<path d="M2.5 8.8a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M3 20.5h18"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
  const fillIconSlots = (root = document) => $$('.ic-slot[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); });

  /* ---------- IndexedDB ---------- */
  const DB_NAME = 'observationslog';
  const DB_VERSION = 1;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Databasen er låst af en anden fane. Luk andre faner med Observationslog.'));
    });
  }

  function tx(stores, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      fn(t);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaktionen blev afbrudt'));
    });
  }

  function getAll(store) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- Tilstand ---------- */
  const state = {
    sessions: [],
    notes: [],
    meta: { tags: [...DEFAULT_TAGS], sources: [], lastExportAt: 0 },
    route: { name: 'sessions' },
    routeKey: '',
    filter: { tags: new Set(), sources: new Set() },
    editingId: null,
    showPanel: false,
    overviewTeam: '',
    newNoteId: null,
  };

  const getSession = (id) => state.sessions.find((s) => s.id === id);
  const notesFor = (sid) => state.notes.filter((n) => n.sessionId === sid).sort((a, b) => a.ts - b.ts);
  const currentSession = () => (state.route.name === 'session' ? getSession(state.route.id) : null);
  const knownTags = () => state.meta.tags;

  function lastActiveSession() {
    return state.sessions
      .filter((s) => !s.endedAt)
      .sort((a, b) => lastActivity(b) - lastActivity(a))[0];
  }
  function lastActivity(s) {
    let t = s.updatedAt || s.createdAt;
    for (const n of state.notes) if (n.sessionId === s.id && n.updatedAt > t) t = n.updatedAt;
    return t;
  }

  /** Datakilder sorteret efter seneste brug. */
  function knownSources() {
    const map = new Map();
    for (const n of state.notes) {
      if (!n.source) continue;
      const cur = map.get(n.source);
      if (!cur) map.set(n.source, { last: n.updatedAt || n.ts, count: 1 });
      else { cur.count++; cur.last = Math.max(cur.last, n.updatedAt || n.ts); }
    }
    for (const src of state.meta.sources) if (!map.has(src)) map.set(src, { last: 0, count: 0 });
    return [...map.entries()].sort((a, b) => b[1].last - a[1].last).map(([name, v]) => ({ name, count: v.count }));
  }
  const knownField = (key) => unique(state.sessions.slice().sort((a, b) => b.createdAt - a.createdAt).map((s) => s[key]).filter(Boolean));

  /* ---------- Synkronisering mellem faner ---------- */
  const channel = 'BroadcastChannel' in self ? new BroadcastChannel('obslog') : null;
  const broadcast = () => { try { channel && channel.postMessage('changed'); } catch (e) { /* ignorér */ } };
  if (channel) channel.onmessage = async () => { await loadAll(); refresh(); };

  async function loadAll() {
    const [sessions, notes, meta] = await Promise.all([getAll('sessions'), getAll('notes'), getAll('meta')]);
    state.sessions = sessions;
    state.notes = notes;
    const m = Object.fromEntries(meta.map((x) => [x.key, x.value]));
    state.meta = { tags: m.tags || unique([...DEFAULT_TAGS, ...(m.customTags || [])]), sources: m.sources || [], lastExportAt: m.lastExportAt || 0, persistAsked: !!m.persistAsked };
  }

  async function persist(work, failMsg = 'Kunne ikke gemme') {
    try {
      await work();
      broadcast();
      return true;
    } catch (err) {
      console.error(err);
      toast(`${failMsg}: ${err && err.message ? err.message : err}`, { kind: 'error', timeout: 8000 });
      return false;
    }
  }

  function upsert(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i === -1) list.push(item); else list[i] = item;
  }

  function saveSession(s) {
    s.updatedAt = Date.now();
    upsert(state.sessions, s);
    return persist(() => tx(['sessions'], (t) => t.objectStore('sessions').put(s)));
  }

  function saveNote(n) {
    n.updatedAt = Date.now();
    upsert(state.notes, n);
    registerTags(n.tags, n.source);
    requestPersistentStorage();
    return persist(() => tx(['notes'], (t) => t.objectStore('notes').put(n)));
  }

  function deleteNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id);
    return persist(() => tx(['notes'], (t) => t.objectStore('notes').delete(id)), 'Kunne ikke slette');
  }

  function deleteSession(id) {
    const ids = state.notes.filter((n) => n.sessionId === id).map((n) => n.id);
    state.sessions = state.sessions.filter((s) => s.id !== id);
    state.notes = state.notes.filter((n) => n.sessionId !== id);
    return persist(() => tx(['sessions', 'notes'], (t) => {
      t.objectStore('sessions').delete(id);
      ids.forEach((nid) => t.objectStore('notes').delete(nid));
    }), 'Kunne ikke slette');
  }

  function setMeta(key, value) {
    state.meta[key] = value;
    return persist(() => tx(['meta'], (t) => t.objectStore('meta').put({ key, value })));
  }

  function registerTags(tags, source) {
    const fresh = tags.filter((t) => !state.meta.tags.includes(t));
    if (fresh.length) setMeta('tags', [...state.meta.tags, ...fresh]);
    if (source && !state.meta.sources.includes(source)) setMeta('sources', [...state.meta.sources, source]);
  }

  function saveNotes(list) {
    const now = Date.now();
    list.forEach((n) => { n.updatedAt = now; upsert(state.notes, n); });
    return persist(() => tx(['notes'], (t) => list.forEach((n) => t.objectStore('notes').put(n))));
  }

  const tagRe = (t) => new RegExp(`(?<![\\p{L}\\p{N}_#&])#${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'giu');
  const tagUses = (t) => state.notes.filter((n) => n.tags.includes(t)).length;
  const sourceUses = (src) => state.notes.filter((n) => n.source === src).length;

  /** Omdøb (eller sammenlæg) et tag – også i noternes tekst. */
  async function renameTag(from, to) {
    if (from === to) return;
    const changed = state.notes.filter((n) => n.tags.includes(from))
      .map((n) => ({ ...n, tags: unique(n.tags.map((t) => (t === from ? to : t))), text: n.text.replace(tagRe(from), () => '#' + to) }));
    if (state.filter.tags.delete(from)) state.filter.tags.add(to);
    await setMeta('tags', unique(state.meta.tags.map((t) => (t === from ? to : t))));
    if (changed.length) await saveNotes(changed);
  }

  /** Fjern et tag fra listen og fra alle noter. Kræver godkendelse, hvis det er i brug. */
  async function removeTag(tag) {
    const n = tagUses(tag);
    if (n) {
      const ok = await confirmDialog({
        title: `Fjern #${tag}?`,
        body: `<p>Tagget bruges i <b>${plural(n, 'observation', 'observationer')}</b>. Det fjernes fra dem alle – selve noterne bevares.</p>`,
        buttons: [{ label: 'Annullér', value: '' }, { label: 'Fjern tag', value: 'ok', kind: 'danger', autofocus: true }],
      });
      if (ok !== 'ok') return false;
    }
    const changed = state.notes.filter((x) => x.tags.includes(tag))
      .map((x) => ({ ...x, tags: x.tags.filter((t) => t !== tag), text: x.text.replace(tagRe(tag), () => tag) }));
    state.filter.tags.delete(tag);
    await setMeta('tags', state.meta.tags.filter((t) => t !== tag));
    if (changed.length) await saveNotes(changed);
    return true;
  }

  async function removeSource(src) {
    const n = sourceUses(src);
    if (n) {
      const ok = await confirmDialog({
        title: `Fjern datakilden ${src}?`,
        body: `<p>Datakilden er angivet på <b>${plural(n, 'observation', 'observationer')}</b>. Den fjernes fra dem – selve noterne bevares.</p>`,
        buttons: [{ label: 'Annullér', value: '' }, { label: 'Fjern datakilde', value: 'ok', kind: 'danger', autofocus: true }],
      });
      if (ok !== 'ok') return false;
    }
    const changed = state.notes.filter((x) => x.source === src).map((x) => ({ ...x, source: '' }));
    state.filter.sources.delete(src);
    await setMeta('sources', state.meta.sources.filter((x) => x !== src));
    if (changed.length) await saveNotes(changed);
    return true;
  }

  const cleanTag = (raw) => parseTags('#' + String(raw).trim().replace(/^#+/, ''))[0];

  async function requestPersistentStorage() {
    if (state.meta.persistAsked || !navigator.storage || !navigator.storage.persist) return;
    state.meta.persistAsked = true;
    try { await navigator.storage.persist(); } catch (e) { /* ignorér */ }
    setMeta('persistAsked', true);
  }

  /* ---------- Elementer ---------- */
  const els = {
    main: $('#main'),
    boot: $('#boot'),
    vSessions: $('#view-sessions'),
    vSession: $('#view-session'),
    vOverview: $('#view-overview'),
    composer: $('#composer'),
    cBar: $('#composerBar'),
    cText: $('#cText'),
    cTags: $('#cTags'),
    cSource: $('#cSource'),
    cTime: $('#cTime'),
    cAgo: $('#cAgo'),
    cSave: $('#cSave'),
    cCancel: $('#cCancel'),
    toasts: $('#toasts'),
    themeBtn: $('#themeBtn'),
    menuBtn: $('#menuBtn'),
    menu: $('#menu'),
    privacyBtn: $('#privacyBtn'),
    importFile: $('#importFile'),
  };

  /* ---------- Toasts ---------- */
  function toast(msg, { action, onAction, timeout = 4000, kind } = {}) {
    const el = document.createElement('div');
    el.className = `toast${kind ? ' ' + kind : ''}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    const close = () => {
      if (!el.isConnected) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    };
    if (action) el.querySelector('button').addEventListener('click', () => { close(); onAction && onAction(); });
    els.toasts.appendChild(el);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
    setTimeout(close, timeout);
    return close;
  }

  /* ---------- Dialoger ---------- */
  function openDialog(html, { wide = false, onReady } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = `dlg${wide ? ' wide' : ''}`;
      dlg.innerHTML = html;
      fillIconSlots(dlg);
      applyHues(dlg);
      document.body.appendChild(dlg);
      const prevFocus = document.activeElement;
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close('');
        const b = e.target.closest('[data-value]');
        if (b && b.tagName === 'BUTTON' && b.type !== 'submit') dlg.close(b.dataset.value);
      });
      dlg.addEventListener('close', () => {
        resolve(dlg.returnValue);
        dlg.remove();
        if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
      });
      dlg.showModal();
      onReady && onReady(dlg);
    });
  }

  function confirmDialog({ title, body, buttons }) {
    const btns = buttons.map((b) => `<button type="button" class="btn ${b.kind || ''} ${b.left ? 'left' : ''}" data-value="${esc(b.value)}" ${b.autofocus ? 'autofocus' : ''}>${esc(b.label)}</button>`).join('');
    return openDialog(`<div class="dlg-body"><h2>${esc(title)}</h2>${body}</div><div class="dlg-foot">${btns}</div>`);
  }

  /* ---------- Autoudfyld ---------- */
  function autocomplete(input, getOptions, { onPick, placement = 'down' } = {}) {
    const host = input.closest('.source-field, .field') || input.parentElement;
    const list = document.createElement('ul');
    list.className = `ac ${placement}`;
    list.id = `ac-${uid()}`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    host.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    let items = [];
    let active = -1;

    const open = () => !list.hidden;
    function close() { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function render() {
      if (!items.length) return close();
      const q = input.value.trim().toLowerCase();
      list.innerHTML = items.map((it, i) => {
        const name = it.name;
        const idx = q ? name.toLowerCase().indexOf(q) : -1;
        const label = idx >= 0 ? `${esc(name.slice(0, idx))}<mark>${esc(name.slice(idx, idx + q.length))}</mark>${esc(name.slice(idx + q.length))}` : esc(name);
        return `<li role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="${i === active}">${label}${it.count ? `<small>${it.count}</small>` : ''}</li>`;
      }).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
      else input.removeAttribute('aria-activedescendant');
    }
    function update() {
      const q = input.value.trim().toLowerCase();
      items = getOptions()
        .map((o) => (typeof o === 'string' ? { name: o } : o))
        .filter((o) => o.name.toLowerCase() !== q && (!q || o.name.toLowerCase().includes(q)))
        .slice(0, 7);
      active = -1;
      render();
    }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      input.value = it.name;
      close();
      onPick && onPick(it.name);
    }

    input.addEventListener('input', update);
    input.addEventListener('focus', update);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!open()) { update(); if (!items.length) return; }
        e.preventDefault();
        const last = items.length - 1;
        if (e.key === 'ArrowDown') active = active >= last ? -1 : active + 1;
        else active = active <= -1 ? last : active - 1;
        render();
      } else if ((e.key === 'Enter' || e.key === 'Tab') && open() && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(active);
      } else if (e.key === 'Escape' && open()) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      pick(+li.dataset.i);
    });
    return { close, isOpen: open, destroy: () => list.remove() };
  }

  /* ---------- Tag-vælger (fælles for notefelt og redigering) ---------- */
  function renderChipsHTML(extra = [], withKeys = false) {
    return unique([...knownTags(), ...extra]).map((t, i) =>
      `<button type="button" class="chip" data-tag="${esc(t)}" data-h="${tagHue(t)}" aria-pressed="false" title="${esc(TAG_INFO[t] ? TAG_INFO[t].desc : 'Eget tag')}">#${esc(t)}${withKeys && i < 9 ? `<span class="chip-key">${i + 1}</span>` : ''}</button>`
    ).join('');
  }

  /** Opdaterer chips ud fra valgte tags + tags skrevet i teksten. */
  function syncChips(container, selected, text, partial = null) {
    const inText = new Set(parseTags(text));
    // Et tag der stadig skrives (markøren står lige efter det) vises først, når det er færdigt
    if (partial && !knownTags().includes(partial.prefix)) inText.delete(partial.prefix);
    const suggest = partial && partial.match;
    const known = new Set($$('.chip', container).map((c) => c.dataset.tag));
    const missing = [...inText, ...selected].filter((t) => !known.has(t));
    if (missing.length) {
      container.insertAdjacentHTML('beforeend', unique(missing).map((t) =>
        `<button type="button" class="chip" data-tag="${esc(t)}" data-h="${tagHue(t)}" aria-pressed="false" title="Nyt tag">#${esc(t)}</button>`).join(''));
      applyHues(container);
    }
    for (const c of $$('.chip', container)) {
      const t = c.dataset.tag;
      c.setAttribute('aria-pressed', String(selected.has(t) || inText.has(t)));
      c.classList.toggle('suggest', t === suggest);
    }
  }

  /** Klik på chip: tilføj/fjern. Tags der står i teksten fjernes fra teksten. */
  function toggleChip(tag, selected, textarea) {
    const inText = parseTags(textarea.value).includes(tag);
    if (selected.has(tag) || inText) {
      selected.delete(tag);
      if (inText) {
        const re = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'giu');
        textarea.value = textarea.value.replace(re, '$1').replace(/[ \t]{2,}/g, ' ').trim();
      }
    } else {
      selected.add(tag);
    }
  }

  /** Delvist skrevet #tag lige før markøren → første forslag. */
  function partialTag(textarea) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const m = before.match(PARTIAL_TAG_RE);
    if (!m) return null;
    const prefix = normTag(m[1]);
    const match = knownTags().find((t) => t.startsWith(prefix) && t !== prefix) || null;
    return { prefix, match, start: before.length - m[0].length };
  }

  function completeTag(textarea, p) {
    const v = textarea.value;
    const end = textarea.selectionStart;
    const insert = `#${p.match} `;
    textarea.value = v.slice(0, p.start) + insert + v.slice(end).replace(/^\s/, '');
    const pos = p.start + insert.length;
    textarea.setSelectionRange(pos, pos);
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  /* ---------- Notefelt ---------- */
  const composer = { open: false, ts: 0, sessionId: null, selected: new Set(), timer: 0 };

  function openComposer(ts) {
    let s = currentSession();
    if (!s) {
      s = lastActiveSession();
      if (!s) {
        if (state.route.name !== 'sessions') navigate('#/');
        const f = $('#newSessionForm input[name="task"]');
        f && f.focus();
        toast('Opret en session først – så kan du begynde at notere.');
        return;
      }
      navigate(`#/s/${s.id}`);
    }
    if (s.endedAt) {
      toast('Sessionen er afsluttet.', { action: 'Genoptag', onAction: async () => { s.endedAt = null; await saveSession(s); renderSessionHead(); openComposer(ts); } });
      return;
    }
    if (state.showPanel) setPanel(false);
    composer.open = true;
    composer.ts = ts;
    composer.sessionId = s.id;
    composer.selected = new Set();
    els.cText.value = '';
    els.cSource.value = '';
    els.cTags.innerHTML = renderChipsHTML([], true);
    $$('.chip', els.cTags).forEach((c) => { c.tabIndex = -1; });
    applyHues(els.cTags);
    els.composer.dataset.state = 'open';
    els.cText.focus({ preventScroll: true });
    autosize(els.cText);
    els.cTime.textContent = fmtTime(ts);
    els.cTime.dateTime = new Date(ts).toISOString();
    tickAgo();
    clearInterval(composer.timer);
    composer.timer = setInterval(tickAgo, 1000);
    requestAnimationFrame(() => els.composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function tickAgo() {
    const s = Math.round((Date.now() - composer.ts) / 1000);
    els.cAgo.textContent = s < 2 ? 'tidspunkt fanget' : `fanget for ${fmtDuration(s * 1000)} siden`;
  }

  function closeComposer() {
    if (!composer.open) return;
    composer.open = false;
    clearInterval(composer.timer);
    els.composer.dataset.state = 'closed';
    if (els.composer.contains(document.activeElement)) document.activeElement.blur();
  }

  async function saveComposer() {
    if (!composer.open) return;
    const raw = els.cText.value.trim();
    const tags = unique([...composer.selected, ...parseTags(raw)]);
    const text = stripTags(raw);
    const source = els.cSource.value.trim();
    if (!text && !tags.length) { closeComposer(); return; }
    const now = Date.now();
    const note = { id: uid(), sessionId: composer.sessionId, ts: composer.ts, text, tags, source, createdAt: now, updatedAt: now };
    closeComposer();
    state.newNoteId = note.id;
    const p = saveNote(note);
    renderTimeline();
    renderPanel();
    const li = $(`.note[data-id="${note.id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await p;
  }

  function onComposerInput() {
    autosize(els.cText);
    syncChips(els.cTags, composer.selected, els.cText.value, partialTag(els.cText));
  }

  autocomplete(els.cSource, knownSources, { placement: 'up' });

  els.cText.addEventListener('input', onComposerInput);
  els.cText.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Tab' && !e.shiftKey) {
      const p = partialTag(els.cText);
      if (p && p.match) { e.preventDefault(); completeTag(els.cText, p); onComposerInput(); }
    }
  });
  els.composer.addEventListener('keydown', (e) => {
    if (e.isComposing || e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); closeComposer(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!e.shiftKey && !e.altKey))) {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      saveComposer();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
      const chip = $$('.chip', els.cTags)[+e.code.slice(5) - 1];
      if (chip) { e.preventDefault(); toggleChip(chip.dataset.tag, composer.selected, els.cText); onComposerInput(); }
    }
  });
  els.cTags.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    toggleChip(c.dataset.tag, composer.selected, els.cText);
    onComposerInput();
    els.cText.focus();
  });
  els.cBar.addEventListener('click', () => openComposer(Date.now()));
  els.cSave.addEventListener('click', saveComposer);
  els.cCancel.addEventListener('click', closeComposer);

  window.addEventListener('beforeunload', (e) => {
    if (composer.open && els.cText.value.trim()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- Navigation ---------- */
  function navigate(hash) {
    if (location.hash !== hash) history.pushState(null, '', hash);
    route();
  }

  function parseRoute() {
    const h = location.hash || '#/';
    if (h.startsWith('#/s/')) return { name: 'session', id: decodeURIComponent(h.slice(4)) };
    if (h === '#/overblik') return { name: 'overview' };
    return { name: 'sessions' };
  }

  function route() {
    const r = parseRoute();
    const key = r.name + (r.id || '');
    if (key === state.routeKey) return;
    if (r.name === 'session' && !getSession(r.id)) {
      history.replaceState(null, '', '#/');
      toast('Sessionen findes ikke længere.');
      return route();
    }
    if (composer.open && (r.name !== 'session' || r.id !== composer.sessionId)) closeComposer();
    state.routeKey = key;
    els.toasts.replaceChildren();
    state.route = r;
    state.editingId = null;
    if (r.name === 'session') { state.filter = { tags: new Set(), sources: new Set() }; state.showPanel = false; }
    renderView();
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  function renderView() {
    const name = state.route.name;
    els.boot.hidden = true;
    els.vSessions.hidden = name !== 'sessions';
    els.vSession.hidden = name !== 'session';
    els.vOverview.hidden = name !== 'overview';
    document.body.classList.toggle('view-session-active', name === 'session');
    $$('.nav a').forEach((a) => {
      const on = (a.dataset.nav === 'sessions' && name !== 'overview') || (a.dataset.nav === 'overview' && name === 'overview');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // Genstart indgangsanimationen
    for (const v of [els.vSessions, els.vSession, els.vOverview]) { v.style.animation = 'none'; void v.offsetWidth; v.style.animation = ''; }

    if (name === 'sessions') { renderSessions(); document.title = 'Observationslog'; }
    if (name === 'overview') { renderOverview(); document.title = 'Overblik · Observationslog'; }
    if (name === 'session') {
      renderSessionView();
      const s = currentSession();
      document.title = `${s.task || 'Session'} · Observationslog`;
      requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  /** Genopfrisk den aktuelle visning efter dataændringer. */
  function refresh() {
    if (state.route.name === 'session') {
      if (!currentSession()) { state.routeKey = ''; navigate('#/'); return; }
      renderSessionHead();
      if (!state.editingId) renderTimeline();
      renderPanel();
    } else if (state.route.name === 'sessions') renderSessions();
    else renderOverview();
  }

  /* ---------- Visning: sessioner ---------- */
  function backupBannerHTML() {
    if (!state.notes.length) return '';
    const lastChange = Math.max(...state.notes.map((n) => n.updatedAt || 0), ...state.sessions.map((s) => s.updatedAt || 0));
    const last = state.meta.lastExportAt || 0;
    if (last >= lastChange) return '';
    if (last && Date.now() - last < BACKUP_NAG_MS) return '';
    const msg = last
      ? `Seneste backup er fra ${dateFmt.format(new Date(last))}, og der er ændringer siden.`
      : 'Du har endnu ikke taget en backup.';
    return `<div class="banner" role="note">${icon('warn')}<p>${msg} Data forsvinder, hvis browserdata ryddes.</p><button type="button" class="btn sm" data-menu="export-json">${icon('download')}Eksportér backup</button></div>`;
  }

  function sparkHTML(notes) {
    const counts = new Map();
    let total = 0;
    for (const n of notes) for (const t of n.tags) { counts.set(t, (counts.get(t) || 0) + 1); total++; }
    if (!total) return '<span class="s-spark"></span>';
    const segs = [...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `<span data-h="${tagHue(t)}" data-w="${c / total}" title="#${esc(t)}: ${c}"></span>`).join('');
    return `<span class="s-spark" aria-hidden="true">${segs}</span>`;
  }

  function sessionRowHTML(s, i) {
    const notes = notesFor(s.id);
    const meta = [s.team, s.role].filter(Boolean).map(esc).join(' · ') || '<span class="hint">Intet team angivet</span>';
    return `<li class="session-row" data-id="${esc(s.id)}">
      <a class="session-link" href="#/s/${encodeURIComponent(s.id)}">
        <span class="s-status ${s.endedAt ? '' : 'on'}" title="${s.endedAt ? 'Afsluttet' : 'Aktiv'}"></span>
        <span class="s-main"><span class="s-task">${esc(s.task || 'Uden titel')}</span><span class="s-meta">${meta}</span></span>
        <span class="s-date">${esc(fmtDate(s.date))}</span>
        ${sparkHTML(notes)}
        <span class="s-count"><b>${notes.length}</b> ${notes.length === 1 ? 'note' : 'noter'}</span>
      </a>
      <div class="s-actions">
        <button type="button" class="icon-btn sm" data-act="toggle-end" title="${s.endedAt ? 'Genoptag session' : 'Afslut session'}" aria-label="${s.endedAt ? 'Genoptag session' : 'Afslut session'}">${icon(s.endedAt ? 'play' : 'stop')}</button>
        <button type="button" class="icon-btn sm danger" data-act="delete-session" title="Slet session" aria-label="Slet session">${icon('trash')}</button>
      </div>
    </li>`;
  }

  function renderSessions() {
    const v = els.vSessions;
    const prev = v.querySelector('#newSessionForm');
    const draft = prev ? Object.fromEntries(new FormData(prev)) : null;
    const focusedName = prev && prev.contains(document.activeElement) ? document.activeElement.name : null;

    const sorted = state.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const active = sorted.filter((s) => !s.endedAt);
    const ended = sorted.filter((s) => s.endedAt);

    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Observationer</h1>
          <p class="lede">Notér hvad der sker, mens det sker. Tryk <kbd>N</kbd> for en note med tidsstempel – og find ventetid, manuelt arbejde og dobbeltarbejde bagefter.</p>
        </div>
      </div>
      ${backupBannerHTML()}
      <form class="card new-session" id="newSessionForm" autocomplete="off">
        <div class="card-head"><h2>Ny session</h2><span class="hint">Kan rettes senere</span></div>
        <div class="fields">
          <label class="field"><span>Team</span><input name="team" placeholder="fx Kundeservice"></label>
          <label class="field"><span>Rolle</span><input name="role" placeholder="fx Sagsbehandler"></label>
          <label class="field grow"><span>Opgave der observeres</span><input name="task" required placeholder="fx Oprettelse af ny kunde"></label>
          <label class="field"><span>Dato</span><input type="date" name="date" required value="${isoDate()}"></label>
          <button class="btn primary" type="submit">${icon('play')}Start session</button>
        </div>
      </form>
      ${!state.sessions.length ? `
        <div class="empty">
          ${icon('eye', 'ic-big')}
          <h3>Ingen sessioner endnu</h3>
          <p>Udfyld felterne ovenfor og start din første observation.</p>
        </div>` : ''}
      ${active.length ? `<h2 class="section-title">Aktive <span class="count">${active.length}</span></h2>
        <ul class="session-list">${active.map(sessionRowHTML).join('')}</ul>` : ''}
      ${ended.length ? `<h2 class="section-title">Afsluttede <span class="count">${ended.length}</span></h2>
        <ul class="session-list">${ended.map(sessionRowHTML).join('')}</ul>` : ''}
    `;
    $$('.session-row', v).forEach((row, i) => row.style.setProperty('animation-delay', `${Math.min(i, 12) * 22}ms`));
    applyHues(v);
    applyWidths(v);

    const form = $('#newSessionForm', v);
    if (draft) for (const [k, val] of Object.entries(draft)) if (form.elements[k]) form.elements[k].value = val;
    if (focusedName && form.elements[focusedName]) form.elements[focusedName].focus();
    autocomplete(form.elements.team, () => knownField('team'));
    autocomplete(form.elements.role, () => knownField('role'));
    autocomplete(form.elements.task, () => knownField('task'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (!d.task.trim()) return;
      const now = Date.now();
      const s = { id: uid(), team: d.team.trim(), role: d.role.trim(), task: d.task.trim(), date: d.date || isoDate(), createdAt: now, updatedAt: now, endedAt: null };
      await saveSession(s);
      navigate(`#/s/${s.id}`);
      toast('Session startet. Tryk N for at notere.');
    });
  }

  els.vSessions.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = getSession(b.closest('.session-row').dataset.id);
    if (!s) return;
    if (b.dataset.act === 'toggle-end') await toggleEnd(s);
    if (b.dataset.act === 'delete-session') await confirmDeleteSession(s);
  });

  async function toggleEnd(s) {
    const ending = !s.endedAt;
    s.endedAt = ending ? Date.now() : null;
    if (ending && composer.sessionId === s.id) closeComposer();
    await saveSession(s);
    refresh();
    toast(ending ? 'Session afsluttet.' : 'Session genoptaget.', ending ? { action: 'Fortryd', onAction: async () => { s.endedAt = null; await saveSession(s); refresh(); } } : {});
  }

  async function confirmDeleteSession(s) {
    const n = notesFor(s.id).length;
    const v = await confirmDialog({
      title: 'Slet session?',
      body: `<p><b>${esc(s.task || 'Uden titel')}</b> og ${plural(n, 'note', 'noter')} slettes permanent fra denne browser.</p><p>Overvej at eksportere en backup først.</p>`,
      buttons: [
        { label: 'Eksportér først', value: 'export', kind: 'ghost', left: true },
        { label: 'Annullér', value: '' },
        { label: 'Slet session', value: 'delete', kind: 'danger', autofocus: true },
      ],
    });
    if (v === 'export') { exportJSON(); return; }
    if (v !== 'delete') return;
    await deleteSession(s.id);
    if (state.route.name === 'session') navigate('#/'); else refresh();
    toast('Sessionen er slettet.');
  }

  /* ---------- Visning: én session ---------- */
  function renderSessionView() {
    const v = els.vSession;
    v.innerHTML = `
      <a href="#/" class="back">${icon('back')}Sessioner</a>
      <div class="session-head" id="sessionHead"></div>
      <div class="seg" role="group" aria-label="Visning">
        <button type="button" data-seg="timeline" aria-pressed="true">Tidslinje</button>
        <button type="button" data-seg="panel" aria-pressed="false">Overblik</button>
      </div>
      <div class="session-grid" id="sessionGrid">
        <div class="timeline-col" id="timelineCol">
          <div id="filterbar"></div>
          <ol class="timeline" id="timeline" aria-label="Noter"></ol>
        </div>
        <aside class="panel" id="panel" aria-label="Overblik for session"></aside>
      </div>`;
    $('#timelineCol', v).appendChild(els.composer);
    els.composer.hidden = false;
    renderSessionHead();
    renderTimeline();
    renderPanel();
  }

  function renderSessionHead() {
    const s = currentSession();
    const head = $('#sessionHead');
    if (!s || !head) return;
    const meta = [s.team, s.role].filter(Boolean).map((x) => `<span>${esc(x)}</span><span class="sep">·</span>`).join('');
    head.innerHTML = `
      <div>
        <h1 tabindex="-1">${esc(s.task || 'Uden titel')}</h1>
        <div class="session-meta">${meta}<span>${esc(fmtDateLong(s.date))}</span>
          <span class="status-pill ${s.endedAt ? '' : 'on'}">${s.endedAt ? 'Afsluttet' : 'Aktiv'}</span></div>
      </div>
      <div class="head-actions">
        <button type="button" class="btn sm" data-act="export-csv">${icon('download')}CSV</button>
        <button type="button" class="btn sm" data-act="edit-session">${icon('pencil')}Redigér</button>
        <button type="button" class="btn sm" data-act="toggle-end">${icon(s.endedAt ? 'play' : 'stop')}${s.endedAt ? 'Genoptag' : 'Afslut'}</button>
        <button type="button" class="icon-btn sm danger" data-act="delete-session" title="Slet session" aria-label="Slet session">${icon('trash')}</button>
      </div>`;
    els.cBar.querySelector('.composer-bar-text').textContent = s.endedAt ? 'Sessionen er afsluttet – genoptag for at notere' : 'Ny observation';
  }

  const matchesFilter = (n) => {
    const { tags, sources } = state.filter;
    const tagOk = !tags.size || (tags.has(NONE) && !n.tags.length) || n.tags.some((t) => tags.has(t));
    const srcOk = !sources.size || sources.has(n.source || NONE);
    return tagOk && srcOk;
  };
  const filterActive = () => state.filter.tags.size > 0 || state.filter.sources.size > 0;

  function noteHTML(n) {
    const t = fmtTime(n.ts);
    const firstTag = n.tags[0];
    const tags = n.tags.map((tg) => `<button type="button" class="tag" data-filter="tag" data-value="${esc(tg)}" data-h="${tagHue(tg)}" title="Filtrér på #${esc(tg)}">#${esc(tg)}</button>`).join('');
    const src = n.source ? `<button type="button" class="chip-src" data-filter="source" data-value="${esc(n.source)}" title="Filtrér på ${esc(n.source)}">${icon('db')}${esc(n.source)}</button>` : '';
    return `<li class="note${n.id === state.newNoteId ? ' is-new' : ''}" data-id="${esc(n.id)}" tabindex="-1">
      <time class="note-time" datetime="${new Date(n.ts).toISOString()}">${t.slice(0, 5)}<span class="sec">${t.slice(5)}</span></time>
      <div class="note-rail"><span class="dot" ${firstTag ? `data-h="${tagHue(firstTag)}"` : ''}></span></div>
      <div class="note-body">
        <p class="note-text${n.text ? '' : ' empty-text'}">${n.text ? renderText(n.text) : 'Ingen tekst'}</p>
        <div class="note-meta">${tags}${src}</div>
      </div>
      <div class="note-actions">
        <button type="button" class="icon-btn sm" data-act="edit" title="Redigér (E)" aria-label="Redigér note">${icon('pencil')}</button>
        <button type="button" class="icon-btn sm danger" data-act="delete" title="Slet (Delete)" aria-label="Slet note">${icon('trash')}</button>
      </div>
    </li>`;
  }

  function renderText(text) {
    let out = '';
    let last = 0;
    for (const m of text.matchAll(TAG_RE)) {
      out += esc(text.slice(last, m.index));
      out += `<span class="itag" data-h="${tagHue(normTag(m[1]))}">#${esc(m[1])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  function editHTML(n) {
    const t = fmtTime(n.ts);
    return `<li class="note editing" data-id="${esc(n.id)}">
      <time class="note-time">${t.slice(0, 5)}<span class="sec">${t.slice(5)}</span></time>
      <div class="note-rail"><span class="dot"></span></div>
      <form class="note-edit" id="editForm" autocomplete="off">
        <textarea name="text" rows="1" aria-label="Note">${esc(n.text)}</textarea>
        <div class="chips" role="group" aria-label="Tags">${renderChipsHTML(n.tags)}</div>
        <div class="edit-row">
          <label class="time-field" title="Ret tidspunkt">${icon('clock')}<input class="time-input" type="time" step="1" name="time" value="${t}" aria-label="Tidspunkt"></label>
          <label class="source-field">${icon('db')}<input name="source" value="${esc(n.source)}" placeholder="Datakilde (valgfri)" aria-label="Datakilde" spellcheck="false"></label>
          <button type="button" class="btn ghost sm" data-act="cancel-edit">Annullér</button>
          <button type="submit" class="btn primary sm">Gem</button>
        </div>
      </form>
    </li>`;
  }

  function renderTimeline() {
    const s = currentSession();
    const ol = $('#timeline');
    if (!s || !ol) return;
    const all = notesFor(s.id);
    const notes = all.filter(matchesFilter);
    const focusedId = document.activeElement && document.activeElement.classList.contains('note') ? document.activeElement.dataset.id : null;

    renderFilterbar(notes.length, all.length);

    if (!all.length) {
      ol.innerHTML = `<li class="timeline-empty">
        <div class="big-kbd"><kbd>N</kbd></div>
        <h3>Klar til at observere</h3>
        <p>Tryk <kbd>N</kbd> eller <kbd>Ctrl</kbd>+<kbd>↵</kbd> – tidspunktet fanges i samme øjeblik.</p>
      </li>`;
      return;
    }
    if (!notes.length) {
      ol.innerHTML = `<li class="timeline-empty"><h3>Ingen noter matcher filteret</h3><p>Tryk <kbd>Esc</kbd> for at rydde filtre.</p></li>`;
      return;
    }

    const showGaps = !filterActive();
    let html = '';
    notes.forEach((n, i) => {
      if (showGaps && i > 0) {
        const gap = n.ts - notes[i - 1].ts;
        if (gap >= 60000) {
          html += `<li class="gap${gap >= LONG_GAP_MS ? ' long' : ''}" aria-hidden="true"><span></span><span class="note-rail"></span><span>${fmtDuration(gap)}</span></li>`;
        }
      }
      html += n.id === state.editingId ? editHTML(n) : noteHTML(n);
    });
    ol.innerHTML = html;
    applyHues(ol);
    state.newNoteId = null;

    if (state.editingId) setupEditForm(all.find((n) => n.id === state.editingId));
    else if (focusedId) { const li = $(`.note[data-id="${focusedId}"]`, ol); li && li.focus({ preventScroll: true }); }
  }

  function renderFilterbar(shown, total) {
    const fb = $('#filterbar');
    if (!fb) return;
    if (!filterActive()) { fb.innerHTML = ''; return; }
    const chips = [
      ...[...state.filter.tags].map((t) => `<button type="button" class="fchip" data-filter="tag" data-value="${esc(t)}" ${t !== NONE ? `data-h="${tagHue(t)}"` : ''} aria-label="Fjern filter">${t === NONE ? 'Uden tag' : '#' + esc(t)}${icon('x')}</button>`),
      ...[...state.filter.sources].map((src) => `<button type="button" class="fchip" data-filter="source" data-value="${esc(src)}" aria-label="Fjern filter">${src === NONE ? 'Uden datakilde' : esc(src)}${icon('x')}</button>`),
    ].join('');
    fb.innerHTML = `<div class="filterbar">${icon('filter')}<span>Viser ${shown} af ${total}</span>${chips}<button type="button" class="btn ghost sm" data-act="clear-filter">Ryd <kbd>Esc</kbd></button></div>`;
    applyHues(fb);
  }

  function toggleFilter(kind, value) {
    const set = kind === 'tag' ? state.filter.tags : state.filter.sources;
    if (set.has(value)) set.delete(value); else set.add(value);
    renderTimeline();
    renderPanel();
  }
  function clearFilter() {
    state.filter = { tags: new Set(), sources: new Set() };
    renderTimeline();
    renderPanel();
  }

  /* --- Redigering --- */
  let editCtx = null;

  function startEdit(id) {
    if (composer.open) closeComposer();
    state.editingId = id;
    renderTimeline();
  }

  function setupEditForm(n) {
    const form = $('#editForm');
    if (!form || !n) return;
    const ta = form.elements.text;
    const chips = $('.chips', form);
    const inText = new Set(parseTags(n.text));
    editCtx = { id: n.id, selected: new Set(n.tags.filter((t) => !inText.has(t))) };
    const sync = () => { autosize(ta); syncChips(chips, editCtx.selected, ta.value, partialTag(ta)); };
    applyHues(form.closest('.note'));
    sync();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autocomplete(form.elements.source, knownSources);

    ta.addEventListener('input', sync);
    chips.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      toggleChip(c.dataset.tag, editCtx.selected, ta);
      sync();
    });
    const li = form.closest('.note');
    li.addEventListener('keydown', (e) => {
      if (e.isComposing || e.defaultPrevented) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
      if (e.key === 'Tab' && e.target === ta && !e.shiftKey) {
        const p = partialTag(ta);
        if (p && p.match) { e.preventDefault(); completeTag(ta, p); sync(); }
        return;
      }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        commitEdit();
      }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); commitEdit(); });
  }

  async function commitEdit() {
    const form = $('#editForm');
    const n = state.notes.find((x) => x.id === (editCtx && editCtx.id));
    if (!form || !n) return cancelEdit();
    const raw = form.elements.text.value.trim();
    const tags = unique([...editCtx.selected, ...parseTags(raw)]);
    const text = stripTags(raw);
    const timeVal = form.elements.time.value;
    let ts = n.ts;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeVal);
    if (m) {
      const d = new Date(n.ts);
      d.setHours(+m[1], +m[2], +(m[3] || 0), 0);
      ts = d.getTime();
    }
    const updated = { ...n, text, tags, source: form.elements.source.value.trim(), ts };
    const id = n.id;
    state.editingId = null;
    editCtx = null;
    const p = saveNote(updated);
    renderTimeline();
    renderPanel();
    const li = $(`.note[data-id="${id}"]`);
    if (li) { li.focus({ preventScroll: true }); li.scrollIntoView({ block: 'nearest' }); }
    await p;
  }

  function cancelEdit() {
    const id = state.editingId;
    state.editingId = null;
    editCtx = null;
    renderTimeline();
    const li = id && $(`.note[data-id="${id}"]`);
    li && li.focus({ preventScroll: true });
  }

  async function removeNoteWithUndo(id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    const li = $(`.note[data-id="${id}"]`);
    const items = $$('#timeline .note');
    const idx = items.indexOf(li);
    const nextId = (items[idx + 1] || items[idx - 1] || {}).dataset?.id;
    await deleteNote(id);
    renderTimeline();
    renderPanel();
    if (nextId) { const nx = $(`.note[data-id="${nextId}"]`); nx && nx.focus({ preventScroll: true }); }
    toast('Note slettet.', { action: 'Fortryd', timeout: 7000, onAction: async () => { await saveNote({ ...n }); renderTimeline(); renderPanel(); } });
  }

  async function editSessionDialog(s) {
    const html = `<form id="sessForm" autocomplete="off">
      <div class="dlg-body"><h2>Redigér session</h2>
        <div class="dlg-fields">
          <label class="field"><span>Team</span><input name="team" value="${esc(s.team)}"></label>
          <label class="field"><span>Rolle</span><input name="role" value="${esc(s.role)}"></label>
          <label class="field full"><span>Opgave der observeres</span><input name="task" required value="${esc(s.task)}"></label>
          <label class="field"><span>Dato</span><input type="date" name="date" required value="${esc(s.date)}"></label>
        </div>
      </div>
      <div class="dlg-foot"><button type="button" class="btn" data-value="">Annullér</button><button type="submit" class="btn primary" value="save">Gem</button></div>
    </form>`;
    let data = null;
    const v = await openDialog(html, {
      onReady: (dlg) => {
        const f = $('#sessForm', dlg);
        f.elements.task.focus();
        f.addEventListener('submit', (e) => { e.preventDefault(); data = Object.fromEntries(new FormData(f)); dlg.close('save'); });
      },
    });
    if (v !== 'save' || !data || !data.task.trim()) return;
    Object.assign(s, { team: data.team.trim(), role: data.role.trim(), task: data.task.trim(), date: data.date || s.date });
    await saveSession(s);
    refresh();
    document.title = `${s.task} · Observationslog`;
  }

  function setPanel(show) {
    state.showPanel = show;
    const grid = $('#sessionGrid');
    grid && grid.classList.toggle('show-panel', show);
    $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.seg === 'panel') === show)));
  }

  els.vSession.addEventListener('click', async (e) => {
    const rt = e.target.closest('[data-remove-tag]');
    if (rt) { if (await removeTag(rt.dataset.removeTag)) refresh(); return; }
    const rs = e.target.closest('[data-remove-source]');
    if (rs) { if (await removeSource(rs.dataset.removeSource)) refresh(); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { toggleFilter(f.dataset.filter, f.dataset.value); return; }
    const seg = e.target.closest('[data-seg]');
    if (seg) { setPanel(seg.dataset.seg === 'panel'); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = currentSession();
    const noteId = b.closest('.note') && b.closest('.note').dataset.id;
    switch (b.dataset.act) {
      case 'edit': startEdit(noteId); break;
      case 'delete': removeNoteWithUndo(noteId); break;
      case 'cancel-edit': cancelEdit(); break;
      case 'clear-filter': clearFilter(); break;
      case 'export-csv': exportCSV([s]); break;
      case 'edit-session': editSessionDialog(s); break;
      case 'toggle-end': await toggleEnd(s); break;
      case 'delete-session': confirmDeleteSession(s); break;
    }
  });
  els.vSession.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.note:not(.editing)');
    if (li && !e.target.closest('button')) startEdit(li.dataset.id);
  });

  /* --- Overbliks-panel --- */
  function counts(notes) {
    const tags = new Map();
    const sources = new Map();
    let untagged = 0;
    let nosource = 0;
    for (const n of notes) {
      if (!n.tags.length) untagged++;
      for (const t of n.tags) tags.set(t, (tags.get(t) || 0) + 1);
      if (n.source) sources.set(n.source, (sources.get(n.source) || 0) + 1); else nosource++;
    }
    const sort = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'da'));
    return { tags: sort(tags), sources: sort(sources), untagged, nosource };
  }

  function barsHTML(rows, total, { kind, clickable, activeSet, removable }) {
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((r) => r[1]));
    const tagName = clickable ? 'button' : 'div';
    const items = rows.map(([label, count]) => {
      const isNone = label === NONE;
      const active = activeSet && activeSet.has(label);
      const cls = ['bar', kind === 'source' ? 'src' : '', isNone ? 'neutral' : '', active ? 'active' : '', count ? '' : 'zero'].join(' ');
      const shown = isNone ? (kind === 'tag' ? 'Uden tag' : 'Uden datakilde') : (kind === 'tag' ? `#${esc(label)}` : esc(label));
      const attrs = clickable ? `type="button" data-filter="${kind}" data-value="${esc(label)}" aria-pressed="${!!active}"` : '';
      const remove = removable && !isNone
        ? `<button type="button" class="icon-btn sm danger bar-remove" data-remove-${kind}="${esc(label)}" title="Fjern" aria-label="Fjern ${shown}">${icon('x')}</button>`
        : removable ? '<span class="bar-remove-pad"></span>' : '';
      return `<li><${tagName} class="${cls}" ${attrs} ${kind === 'tag' && !isNone ? `data-h="${tagHue(label)}"` : ''}>
        <span class="bar-label">${shown}</span>
        <span class="bar-count">${count}<small>${pct(count, total)} %</small></span>
        <span class="bar-track"><span class="bar-fill" data-w="${count / max}"></span></span>
      </${tagName}>${remove}</li>`;
    }).join('');
    return `<ul class="bars${activeSet && activeSet.size ? ' has-active' : ''}">${items}</ul>`;
  }

  function renderPanel() {
    const s = currentSession();
    const panel = $('#panel');
    if (!s || !panel) return;
    const focusAdd = panel.contains(document.activeElement) && document.activeElement.closest('.bar-add') ? document.activeElement.closest('.bar-add').dataset.add : null;
    const notes = notesFor(s.id);
    const c = counts(notes);
    const span = notes.length > 1 ? notes[notes.length - 1].ts - notes[0].ts : 0;
    const rank = (names, entries) => {
      const m = new Map(entries);
      return unique([...names, ...entries.map((e) => e[0])]).map((n, i) => [n, m.get(n) || 0, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([n, k]) => [n, k]);
    };
    const tagRows = rank(knownTags(), c.tags);
    if (c.untagged && c.tags.length) tagRows.push([NONE, c.untagged]);
    const srcRows = rank(knownSources().map((x) => x.name), c.sources);
    if (c.nosource && c.sources.length) srcRows.push([NONE, c.nosource]);
    const addForm = (kind, ph) => `<form class="bar-add" data-add="${kind}" autocomplete="off"><input class="input" name="v" placeholder="${ph}" aria-label="${ph}" spellcheck="false"><button type="submit" class="icon-btn sm" title="Tilføj" aria-label="Tilføj">${icon('plus')}</button></form>`;

    panel.innerHTML = `
      <div class="card panel-card">
        <div class="stats">
          <div class="stat"><span class="stat-num">${notes.length}</span><span class="stat-label">${notes.length === 1 ? 'note' : 'noter'}</span></div>
          <div class="stat"><span class="stat-num">${span ? fmtDuration(span).replace(/ \d+ s$/, '') : '–'}</span><span class="stat-label">tidsrum</span></div>
        </div>
      </div>
      <div class="card panel-card">
        <h3>Tags <button type="button" class="btn ghost sm" data-menu="tags" title="Omdøb og ændr rækkefølge">${icon('pencil')}Redigér</button></h3>
        ${barsHTML(tagRows, notes.length, { kind: 'tag', clickable: true, activeSet: state.filter.tags, removable: true }) || '<p class="panel-empty">Ingen tags endnu.</p>'}
        ${addForm('tag', 'Nyt tag')}
      </div>
      <div class="card panel-card">
        <h3>Datakilder</h3>
        ${barsHTML(srcRows, notes.length, { kind: 'source', clickable: true, activeSet: state.filter.sources, removable: true }) || '<p class="panel-empty">Tilføj de systemer og filer, der bruges – eller angiv dem direkte på noterne.</p>'}
        ${addForm('source', 'Ny datakilde')}
      </div>`;
    applyHues(panel);
    requestAnimationFrame(() => applyWidths(panel));
    if (focusAdd) $(`.bar-add[data-add="${focusAdd}"] input`, panel).focus();
  }

  els.vSession.addEventListener('submit', async (e) => {
    const f = e.target.closest('.bar-add');
    if (!f) return;
    e.preventDefault();
    const raw = f.elements.v.value.trim();
    if (!raw) return;
    if (f.dataset.add === 'tag') {
      const t = cleanTag(raw);
      if (!t) { toast('Brug bogstaver, tal, - eller _ i tags.'); return; }
      if (knownTags().includes(t)) { toast(`#${t} findes allerede.`); return; }
      await setMeta('tags', [...state.meta.tags, t]);
    } else {
      if (knownSources().some((x) => x.name === raw)) { toast(`${raw} findes allerede.`); return; }
      await setMeta('sources', [...state.meta.sources, raw]);
    }
    renderPanel();
  });

  /* ---------- Visning: samlet overblik ---------- */
  function renderOverview() {
    const v = els.vOverview;
    const teams = knownField('team').sort((a, b) => a.localeCompare(b, 'da'));
    if (state.overviewTeam && !teams.includes(state.overviewTeam)) state.overviewTeam = '';
    const sessions = state.sessions
      .filter((s) => !state.overviewTeam || s.team === state.overviewTeam)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const ids = new Set(sessions.map((s) => s.id));
    const notes = state.notes.filter((n) => ids.has(n.sessionId));
    const c = counts(notes);
    const totalSpan = sessions.reduce((sum, s) => {
      const ns = notesFor(s.id);
      return sum + (ns.length > 1 ? ns[ns.length - 1].ts - ns[0].ts : 0);
    }, 0);
    const top = c.tags[0];
    const tops = top ? c.tags.filter((t) => t[1] === top[1]) : [];

    const tagCols = unique([...knownTags(), ...c.tags.map((t) => t[0])]).slice(0, 10);
    const maxCell = Math.max(1, ...sessions.flatMap((s) => tagCols.map((t) => state.notes.filter((n) => n.sessionId === s.id && n.tags.includes(t)).length)));

    const rows = sessions.map((s) => {
      const ns = state.notes.filter((n) => n.sessionId === s.id);
      const cells = tagCols.map((t) => {
        const k = ns.filter((n) => n.tags.includes(t)).length;
        return `<td class="num heat${k ? '' : ' zero'}" data-h="${tagHue(t)}" data-a="${k / maxCell}">${k || '·'}</td>`;
      }).join('');
      return `<tr tabindex="0" data-href="#/s/${encodeURIComponent(s.id)}">
        <td><div class="td-task">${esc(s.task || 'Uden titel')}</div><div class="td-sub">${[s.team, s.role].filter(Boolean).map(esc).join(' · ') || '–'}</div></td>
        <td>${esc(fmtDate(s.date))}</td>
        <td class="num"><b>${ns.length}</b></td>${cells}</tr>`;
    }).join('');

    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Overblik</h1>
          <p class="lede">Hvor opstår spildet? Fordeling af noter på tags og datakilder på tværs af sessioner.</p>
        </div>
        <div class="ov-toolbar">
          ${teams.length > 1 ? `<select id="teamFilter" aria-label="Filtrér på team"><option value="">Alle teams</option>${teams.map((t) => `<option ${t === state.overviewTeam ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
          <button type="button" class="btn" data-act="export-csv-ov">${icon('download')}CSV</button>
        </div>
      </div>
      ${!notes.length ? `<div class="empty">${icon('chart', 'ic-big')}<h3>Ingen noter endnu</h3><p>Når du har noteret i en session, vises fordelingen her.</p></div>` : `
      <div class="tiles">
        <div class="card tile"><div class="stat-num">${sessions.length}</div><div class="stat-label">${sessions.length === 1 ? 'session' : 'sessioner'}</div></div>
        <div class="card tile"><div class="stat-num">${notes.length}</div><div class="stat-label">${notes.length === 1 ? 'note' : 'noter'}</div></div>
        <div class="card tile"><div class="stat-num">${totalSpan ? fmtDuration(totalSpan).replace(/ \d+ s$/, '') : '–'}</div><div class="stat-label">samlet tidsrum</div></div>
        <div class="card tile"><div class="stat-label">${tops.length > 1 ? 'Hyppigste tags · uafgjort' : 'Hyppigste tag'}</div>${top ? `<div class="tile-tags">${tops.map((t) => `<span class="tag" data-h="${tagHue(t[0])}">#${esc(t[0])}</span>`).join('')}</div><div class="stat-label">${plural(top[1], 'note', 'noter')}${tops.length > 1 ? ' hver' : ''} · ${pct(top[1], notes.length)} %</div>` : '<div class="stat-num">–</div>'}</div>
      </div>
      <div class="ov-grid">
        <div class="card panel-card"><h3>Tags</h3>${barsHTML(c.untagged && c.tags.length ? [...c.tags, [NONE, c.untagged]] : c.tags, notes.length, { kind: 'tag' }) || '<p class="panel-empty">Ingen tags endnu.</p>'}</div>
        <div class="card panel-card"><h3>Datakilder</h3>${barsHTML(c.nosource && c.sources.length ? [...c.sources, [NONE, c.nosource]] : c.sources, notes.length, { kind: 'source' }) || '<p class="panel-empty">Ingen datakilder endnu.</p>'}</div>
      </div>
      <div class="card table-card">
        <h3>Pr. session</h3>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Session</th><th>Dato</th><th class="num">Noter</th>${tagCols.map((t) => `<th class="num">#${esc(t)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`}`;
    applyHues(v);
    $$('td.heat', v).forEach((td) => td.style.setProperty('--a', td.dataset.a));
    requestAnimationFrame(() => applyWidths(v));
    const tf = $('#teamFilter', v);
    tf && tf.addEventListener('change', () => { state.overviewTeam = tf.value; renderOverview(); });
  }

  els.vOverview.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) { navigate(tr.dataset.href); return; }
    if (e.target.closest('[data-act="export-csv-ov"]')) {
      exportCSV(state.sessions.filter((s) => !state.overviewTeam || s.team === state.overviewTeam));
    }
  });
  els.vOverview.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && e.key === 'Enter') navigate(tr.dataset.href);
  });

  /* ---------- Eksport / import ---------- */
  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function csvCell(v) {
    let s = String(v ?? '');
    // Undgå at Excel tolker tekst som formel
    if (/^[=+\-@\t\r]/.test(s)) s = ' ' + s;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function sessionLabels() {
    const byDate = new Map();
    state.sessions.slice().sort((a, b) => a.createdAt - b.createdAt).forEach((s) => {
      const list = byDate.get(s.date) || [];
      list.push(s.id);
      byDate.set(s.date, list);
    });
    const labels = new Map();
    for (const [date, ids] of byDate) ids.forEach((id, i) => labels.set(id, `${date} #${i + 1}`));
    return labels;
  }

  function exportCSV(sessions) {
    const list = sessions.filter(Boolean).slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const labels = sessionLabels();
    const lines = [['session', 'team', 'rolle', 'opgave', 'tidspunkt', 'note', 'tags', 'datakilde'].join(';')];
    let count = 0;
    for (const s of list) {
      for (const n of notesFor(s.id)) {
        const d = new Date(n.ts);
        const when = `${isoDate(d)} ${fmtTime(n.ts)}`;
        lines.push([labels.get(s.id), s.team, s.role, s.task, when, n.text, n.tags.map((t) => '#' + t).join(' '), n.source].map(csvCell).join(';'));
        count++;
      }
    }
    if (!count) { toast('Der er ingen noter at eksportere.'); return; }
    const name = list.length === 1
      ? `observationslog-${list[0].date}-${slug(list[0].task)}.csv`
      : `observationslog-${isoDate()}.csv`;
    download(name, '﻿' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    toast(`${plural(count, 'note', 'noter')} eksporteret til CSV.`);
  }

  const slug = (s) => String(s || 'session').toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session';

  function exportJSON() {
    const data = {
      app: 'observationslog',
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: state.sessions,
      notes: state.notes,
      meta: { tags: state.meta.tags, sources: state.meta.sources },
    };
    download(`observationslog-backup-${isoDate()}.json`, JSON.stringify(data, null, 2), 'application/json');
    setMeta('lastExportAt', Date.now()).then(() => { if (state.route.name === 'sessions') renderSessions(); });
    toast(`Backup gemt: ${plural(state.sessions.length, 'session', 'sessioner')}, ${plural(state.notes.length, 'note', 'noter')}.`);
  }

  function validSession(s) { return s && typeof s.id === 'string' && typeof s.task === 'string'; }
  function validNote(n) { return n && typeof n.id === 'string' && typeof n.sessionId === 'string' && Number.isFinite(n.ts); }

  async function importJSON(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast('Filen kunne ikke læses som JSON.', { kind: 'error' }); return; }
    if (!data || data.app !== 'observationslog' || !Array.isArray(data.sessions) || !Array.isArray(data.notes)) {
      toast('Filen ligner ikke en backup fra Observationslog.', { kind: 'error' });
      return;
    }
    const sessions = data.sessions.filter(validSession).map((s) => ({
      id: s.id, team: String(s.team || ''), role: String(s.role || ''), task: s.task, date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : isoDate(new Date(s.createdAt || Date.now())),
      createdAt: +s.createdAt || Date.now(), updatedAt: +s.updatedAt || Date.now(), endedAt: s.endedAt ? +s.endedAt : null,
    }));
    const sids = new Set([...sessions.map((s) => s.id), ...state.sessions.map((s) => s.id)]);
    const notes = data.notes.filter(validNote).filter((n) => sids.has(n.sessionId)).map((n) => ({
      id: n.id, sessionId: n.sessionId, ts: +n.ts, text: String(n.text || ''),
      tags: Array.isArray(n.tags) ? unique(n.tags.map((t) => normTag(String(t))).filter(Boolean)) : [],
      source: String(n.source || ''), createdAt: +n.createdAt || +n.ts, updatedAt: +n.updatedAt || +n.ts,
    }));
    const dm = data.meta || {};
    const importedTags = (Array.isArray(dm.tags) ? dm.tags : [...DEFAULT_TAGS, ...(Array.isArray(dm.customTags) ? dm.customTags : [])]).map(String).map(cleanTag).filter(Boolean);
    const importedSources = Array.isArray(dm.sources) ? dm.sources.map(String).filter(Boolean) : [];

    const hasData = state.sessions.length > 0;
    const choice = await confirmDialog({
      title: 'Importér backup',
      body: `<p>Filen indeholder <b>${plural(sessions.length, 'session', 'sessioner')}</b> og <b>${plural(notes.length, 'note', 'noter')}</b>${data.exportedAt ? ` fra ${esc(dateFmt.format(new Date(data.exportedAt)))}` : ''}.</p>
        ${hasData ? '<p><b>Flet ind</b> beholder dine nuværende data og overskriver kun poster med samme id. <b>Erstat alt</b> sletter først alt, der ligger i browseren nu.</p>' : ''}`,
      buttons: hasData
        ? [{ label: 'Annullér', value: '', left: true, kind: 'ghost' }, { label: 'Erstat alt', value: 'replace', kind: 'danger' }, { label: 'Flet ind', value: 'merge', kind: 'primary', autofocus: true }]
        : [{ label: 'Annullér', value: '' }, { label: 'Importér', value: 'merge', kind: 'primary', autofocus: true }],
    });
    if (!choice) return;
    const replace = choice === 'replace';
    const ok = await persist(() => tx(['sessions', 'notes', 'meta'], (t) => {
      const ss = t.objectStore('sessions');
      const ns = t.objectStore('notes');
      if (replace) { ss.clear(); ns.clear(); }
      sessions.forEach((s) => ss.put(s));
      notes.forEach((n) => ns.put(n));
      const tags = unique([...(replace ? [] : state.meta.tags), ...importedTags, ...notes.flatMap((n) => n.tags)]);
      const sources = unique([...(replace ? [] : state.meta.sources), ...importedSources]);
      t.objectStore('meta').put({ key: 'tags', value: tags });
      t.objectStore('meta').put({ key: 'sources', value: sources });
    }), 'Import mislykkedes');
    if (!ok) return;
    await loadAll();
    state.routeKey = '';
    route();
    toast(`Importeret: ${plural(sessions.length, 'session', 'sessioner')}, ${plural(notes.length, 'note', 'noter')}.`);
  }

  els.importFile.addEventListener('change', () => {
    const f = els.importFile.files[0];
    els.importFile.value = '';
    if (f) importJSON(f);
  });

  /* ---------- Menu, tema og dialoger ---------- */
  function setMenu(open) {
    els.menu.hidden = !open;
    els.menuBtn.setAttribute('aria-expanded', String(open));
    if (open) $('button', els.menu).focus();
  }
  els.menuBtn.addEventListener('click', () => setMenu(els.menu.hidden));
  document.addEventListener('click', (e) => {
    if (!els.menu.hidden && !e.target.closest('.menu-wrap')) setMenu(false);
    const m = e.target.closest('[data-menu]');
    if (m) { setMenu(false); runMenu(m.dataset.menu); }
  });
  els.menu.addEventListener('keydown', (e) => {
    const items = $$('button', els.menu);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false); els.menuBtn.focus(); }
    if (e.key === 'Tab') setMenu(false);
  });

  function runMenu(cmd) {
    if (cmd === 'export-json') exportJSON();
    if (cmd === 'import-json') els.importFile.click();
    if (cmd === 'export-csv-all') exportCSV(state.sessions);
    if (cmd === 'help') showHelp();
    if (cmd === 'privacy') showPrivacy();
    if (cmd === 'tags') showTagAdmin();
  }

  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: 'Tema: følg systemet', light: 'Tema: lyst', dark: 'Tema: mørkt' };
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
  function setTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignorér */ }
    renderThemeBtn();
  }
  function renderThemeBtn() {
    const t = currentTheme();
    els.themeBtn.innerHTML = icon(t === 'auto' ? 'auto' : t === 'light' ? 'sun' : 'moon');
    els.themeBtn.title = `${THEME_LABEL[t]} (T)`;
    els.themeBtn.setAttribute('aria-label', THEME_LABEL[t]);
  }
  const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]);
  els.themeBtn.addEventListener('click', cycleTheme);
  els.privacyBtn.addEventListener('click', showPrivacy);

  function showHelp() {
    const row = (label, ...keys) => `<div class="key-row"><span>${label}</span><span>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span></div>`;
    openDialog(`<div class="dlg-body"><h2>Tastaturgenveje</h2>
      <div class="keys">
        <h3>Notér</h3>
        ${row('Ny note (tiden fanges straks)', 'N')}
        ${row('Ny note, også mens du skriver', 'Ctrl', '↵')}
        ${row('Gem note', '↵')}
        ${row('Ny linje i noten', '⇧', '↵')}
        ${row('Annullér', 'Esc')}
        ${row('Vælg tag 1–9', 'Alt', '1–9')}
        ${row('Fuldfør #tag', 'Tab')}
        ${row('Vælg forslag til datakilde', '↓', '↵')}
        <h3>Tidslinje</h3>
        ${row('Næste / forrige note', 'J', 'K')}
        ${row('Redigér valgt note', 'E')}
        ${row('Slet valgt note', 'Del')}
        ${row('Ryd filtre', 'Esc')}
        ${row('Skift tidslinje / overblik (mobil)', 'V')}
        <h3>Generelt</h3>
        ${row('Sessioner', 'S')}
        ${row('Overblik', 'O')}
        ${row('Skift tema', 'T')}
        ${row('Vis genveje', '?')}
      </div></div>
      <div class="dlg-foot"><button type="button" class="btn primary" data-value="" autofocus>Luk</button></div>`, { wide: true });
  }

  async function showPrivacy() {
    let persisted = null;
    let estimate = null;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* ignorér */ }
    try { estimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { /* ignorér */ }
    const kb = estimate && estimate.usage != null ? Math.max(1, Math.round(estimate.usage / 1024)) : null;
    const last = state.meta.lastExportAt ? dateFmt.format(new Date(state.meta.lastExportAt)) : 'aldrig';
    openDialog(`<div class="dlg-body"><h2>Dine data bliver på din computer</h2>
      <p>Observationslog er en statisk side. Alt, hvad du skriver, gemmes kun i denne browser.</p>
      <ul class="privacy-list">
        <li>${icon('shield')}<span><b>Intet forlader computeren.</b> Ingen server, ingen login, ingen analytics og ingen eksterne kald. Sidens sikkerhedspolitik blokerer forbindelser til andre domæner.</span></li>
        <li>${icon('offline')}<span><b>Virker uden internet,</b> når siden først er indlæst.</span></li>
        <li class="warn">${icon('warn')}<span><b>Rydder du browserdata (cookies og webstedsdata), forsvinder noterne.</b> Det samme gælder privat/inkognito-vinduer. Eksportér en backup jævnligt – den kan importeres igen.</span></li>
        <li>${icon('eye')}<span><b>Noterne følger browseren,</b> ikke dig. En anden browser eller computer har sine egne, separate data.</span></li>
      </ul>
      <div class="storage-info">
        Seneste backup: <b>${esc(last)}</b> · ${plural(state.sessions.length, 'session', 'sessioner')}, ${plural(state.notes.length, 'note', 'noter')}${kb ? ` · ca. ${kb} kB brugt` : ''}<br>
        Varig lagring: <b>${persisted === true ? 'ja – browseren rydder ikke data automatisk' : persisted === false ? 'nej – browseren kan rydde data ved pladsmangel' : 'ukendt'}</b>
      </div></div>
      <div class="dlg-foot">
        <button type="button" class="btn ghost left" data-menu="import-json">${icon('upload')}Importér</button>
        <button type="button" class="btn" data-menu="export-json">${icon('download')}Eksportér backup</button>
        <button type="button" class="btn primary" data-value="" autofocus>OK</button>
      </div>`, {
      onReady: (dlg) => dlg.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) dlg.close(''); }),
    });
  }

  function showTagAdmin() {
    const render = (dlg) => {
      const tags = knownTags();
      $('#tagList', dlg).innerHTML = tags.map((t, i) => `<li data-tag="${esc(t)}">
        <span class="drag" title="Træk for at flytte">${icon('grip')}</span>
        <span class="dot-sm" data-h="${tagHue(t)}"></span>
        <span class="hash">#</span><input class="tag-name" value="${esc(t)}" aria-label="Navn på tag #${esc(t)}" spellcheck="false" autocomplete="off">
        <span class="uses" title="Antal observationer">${tagUses(t)}</span>
        <button type="button" class="icon-btn sm" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Flyt #${esc(t)} op" title="Flyt op (Alt+↑)">${icon('up')}</button>
        <button type="button" class="icon-btn sm" data-move="1" ${i === tags.length - 1 ? 'disabled' : ''} aria-label="Flyt #${esc(t)} ned" title="Flyt ned (Alt+↓)">${icon('down')}</button>
        <button type="button" class="icon-btn sm danger" data-remove="${esc(t)}" aria-label="Fjern #${esc(t)}" title="Fjern">${icon('trash')}</button>
      </li>`).join('') || '<li class="hint">Ingen tags.</li>';
      applyHues(dlg);
    };
    const afterChange = (dlg, focusSel) => { render(dlg); refresh(); if (focusSel) { const el = $(focusSel, dlg); el && el.focus(); } };
    const move = async (dlg, tag, dir) => {
      const arr = [...knownTags()];
      const i = arr.indexOf(tag);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      await setMeta('tags', arr);
      const sel = `li[data-tag="${CSS.escape(tag)}"]`;
      afterChange(dlg, `${sel} [data-move="${dir}"]:not([disabled])`);
      if (!dlg.contains(document.activeElement) || document.activeElement === dlg) { const n = $(`${sel} .tag-name`, dlg); n && n.focus(); }
    };

    openDialog(`<div class="dlg-body"><h2>Tags</h2>
      <p>Omdøb ved at klikke på navnet. Træk i håndtaget eller brug pilene for at ændre rækkefølgen – de første 9 får genvejene <kbd>Alt</kbd>+<kbd>1–9</kbd> i notefeltet.</p>
      <ul class="tag-admin" id="tagList"></ul>
      <form class="tag-add" id="tagAdd" autocomplete="off"><input class="input" name="tag" placeholder="Nyt tag, fx godkendelse" aria-label="Nyt tag"><button class="btn" type="submit">${icon('plus')}Tilføj</button></form>
      <p class="hint">Omdøbning og sletning slår igennem i alle eksisterende observationer.</p>
      </div>
      <div class="dlg-foot"><button type="button" class="btn primary" data-value="">Færdig</button></div>`, {
      wide: true,
      onReady: (dlg) => {
        render(dlg);
        const list = $('#tagList', dlg);
        const form = $('#tagAdd', dlg);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const t = cleanTag(form.elements.tag.value);
          if (!t) { toast('Brug bogstaver, tal, - eller _ i tags.'); return; }
          if (!knownTags().includes(t)) await setMeta('tags', [...state.meta.tags, t]);
          form.elements.tag.value = '';
          afterChange(dlg);
        });

        // Omdøb
        list.addEventListener('change', async (e) => {
          const inp = e.target.closest('.tag-name');
          if (!inp) return;
          const from = inp.closest('li').dataset.tag;
          const to = cleanTag(inp.value);
          if (!to) { toast('Brug bogstaver, tal, - eller _ i tags.'); inp.value = from; return; }
          if (to === from) { inp.value = from; return; }
          if (knownTags().includes(to)) {
            const ok = await confirmDialog({
              title: `Sammenlæg #${from} med #${to}?`,
              body: `<p>#${esc(to)} findes allerede. Observationer med #${esc(from)} får i stedet #${esc(to)}.</p>`,
              buttons: [{ label: 'Annullér', value: '' }, { label: 'Sammenlæg', value: 'ok', kind: 'primary', autofocus: true }],
            });
            if (ok !== 'ok') { inp.value = from; return; }
          }
          await renameTag(from, to);
          afterChange(dlg);
          toast(`#${from} er omdøbt til #${to}.`);
        });
        list.addEventListener('keydown', (e) => {
          const inp = e.target.closest('.tag-name');
          const li = e.target.closest('li[data-tag]');
          if (inp && e.key === 'Enter') { e.preventDefault(); inp.blur(); }
          if (inp && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inp.value = li.dataset.tag; inp.blur(); }
          if (li && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            if (inp) inp.value = li.dataset.tag;
            const tag = li.dataset.tag;
            move(dlg, tag, e.key === 'ArrowUp' ? -1 : 1).then(() => {
              const n = $(`li[data-tag="${CSS.escape(tag)}"] .tag-name`, dlg);
              n && n.focus();
            });
          }
        });
        list.addEventListener('click', async (e) => {
          const mv = e.target.closest('[data-move]');
          if (mv) { move(dlg, mv.closest('li').dataset.tag, +mv.dataset.move); return; }
          const rm = e.target.closest('[data-remove]');
          if (rm && await removeTag(rm.dataset.remove)) afterChange(dlg);
        });

        // Træk og slip – kun fra håndtaget
        let dragging = null;
        list.addEventListener('pointerdown', (e) => {
          $$('li', list).forEach((li) => { li.draggable = false; });
          const h = e.target.closest('.drag');
          if (h) h.closest('li').draggable = true;
        });
        list.addEventListener('dragstart', (e) => {
          dragging = e.target.closest('li');
          if (!dragging) return;
          dragging.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', dragging.dataset.tag);
        });
        list.addEventListener('dragover', (e) => {
          if (!dragging) return;
          e.preventDefault();
          const li = e.target.closest('li[data-tag]');
          if (!li || li === dragging) return;
          const r = li.getBoundingClientRect();
          li[e.clientY > r.top + r.height / 2 ? 'after' : 'before'](dragging);
        });
        list.addEventListener('drop', (e) => e.preventDefault());
        list.addEventListener('dragend', async () => {
          if (!dragging) return;
          dragging.classList.remove('dragging');
          dragging = null;
          const order = $$('li[data-tag]', list).map((li) => li.dataset.tag);
          if (order.join('\n') !== knownTags().join('\n')) await setMeta('tags', order);
          afterChange(dlg);
        });
      },
    });
  }

  /* ---------- Globale genveje ---------- */
  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  function moveFocus(selector, dir) {
    const items = $$(selector);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement.closest(selector.split(',')[0]) || document.activeElement);
    let next;
    if (i === -1) next = dir > 0 ? items[0] : items[items.length - 1];
    else next = items[Math.max(0, Math.min(items.length - 1, i + dir))];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  document.addEventListener('keydown', (e) => {
    const now = Date.now(); // fang tiden med det samme
    if (e.isComposing || e.defaultPrevented) return;
    const dialogOpen = !!document.querySelector('dialog[open]');
    const target = e.target;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (dialogOpen || composer.open || target.closest('form')) return;
      e.preventDefault();
      openComposer(now);
      return;
    }
    if (dialogOpen || isTyping(target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!els.menu.hidden) return;

    const inSession = state.route.name === 'session';
    const noteEl = target.closest && target.closest('.note:not(.editing)');
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    switch (key) {
      case 'n':
        e.preventDefault();
        openComposer(now);
        break;
      case '?':
        e.preventDefault();
        showHelp();
        break;
      case 't':
        cycleTheme();
        break;
      case 's':
        navigate('#/');
        break;
      case 'o':
        navigate('#/overblik');
        break;
      case 'v':
        if (inSession) setPanel(!state.showPanel);
        break;
      case 'j':
      case 'k':
        e.preventDefault();
        if (inSession) moveFocus('#timeline .note', key === 'j' ? 1 : -1);
        else if (state.route.name === 'sessions') moveFocus('.session-link', key === 'j' ? 1 : -1);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        if (noteEl || (target.classList && target.classList.contains('session-link'))) {
          e.preventDefault();
          moveFocus(noteEl ? '#timeline .note' : '.session-link', key === 'ArrowDown' ? 1 : -1);
        }
        break;
      case 'e':
        if (noteEl) { e.preventDefault(); startEdit(noteEl.dataset.id); }
        break;
      case 'Enter':
        if (noteEl && target === noteEl) { e.preventDefault(); startEdit(noteEl.dataset.id); }
        break;
      case 'Delete':
      case 'Backspace':
        if (noteEl) { e.preventDefault(); removeNoteWithUndo(noteEl.dataset.id); }
        else if (target.classList && target.classList.contains('session-link')) {
          e.preventDefault();
          const s = getSession(target.closest('.session-row').dataset.id);
          s && confirmDeleteSession(s);
        }
        break;
      case 'Escape':
        if (inSession && filterActive()) { e.preventDefault(); clearFilter(); }
        else if (noteEl) noteEl.blur();
        break;
    }
  });

  /* ---------- Offline (service worker) ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker:', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      toast('En ny version er klar.', { action: 'Genindlæs', timeout: 15000, onAction: () => location.reload() });
    });
  }

  /* ---------- Start ---------- */
  async function init() {
    fillIconSlots();
    renderThemeBtn();
    els.menuBtn.innerHTML = icon('more');
    try {
      if (!('indexedDB' in self)) throw new Error('Browseren understøtter ikke IndexedDB.');
      db = await openDB();
      db.onversionchange = () => { db.close(); toast('Siden er opdateret i en anden fane. Genindlæs.', { timeout: 20000, action: 'Genindlæs', onAction: () => location.reload() }); };
      await loadAll();
    } catch (err) {
      console.error(err);
      els.boot.innerHTML = `<div class="empty">${icon('warn', 'ic-big')}<h3>Kunne ikke åbne den lokale database</h3><p>${esc(err.message || err)}</p><p>Privat/inkognito-tilstand eller blokerede webstedsdata kan forhindre lagring.</p></div>`;
      return;
    }
    route();
    registerSW();
  }

  init();
})();
