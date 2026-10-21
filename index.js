// Usage Pulse - host side.
//
// Listens to the harness session event feed, aggregates DeepSeek token usage
// into Beijing-time hourly buckets, prices every request with the official
// peak / off-peak rates, persists the aggregate to the user's home directory
// and serves a same-origin JSON snapshot for the composer widget.
//
// The aggregate is intentionally small (hourly buckets + per-session totals),
// never the conversation itself: no prompt or completion content is stored.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HOLIDAYS } from './holidays.js';

export const name = 'usage-pulse';
export const inject = ['webServer'];

const ROUTE = '/usage-pulse/api/snapshot';
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Beijing is UTC+8 all year: no DST, so plain offset arithmetic is safe. */
const BJ = 8 * HOUR;
const RETAIN_DAYS = 35;
const SESSION_RETAIN_DAYS = 120;
const MAX_SESSIONS = 300;
const SAVE_DEBOUNCE_MS = 1_200;

/**
 * Official DeepSeek prices, CNY per 1M tokens (peak / off-peak).
 * Source: https://api-docs.deepseek.com/quick_start/pricing/ (verified 2026-10-22).
 * Off-peak is exactly half of peak.
 */
const RATES_CNY = {
  flash: { off: { hit: 0.02, miss: 1, out: 4 }, peak: { hit: 0.04, miss: 2, out: 8 } },
  pro: { off: { hit: 0.15, miss: 4.5, out: 13.5 }, peak: { hit: 0.3, miss: 9, out: 27 } },
};
const RATES_USD = {
  flash: { off: { hit: 0.003, miss: 0.15, out: 0.6 }, peak: { hit: 0.006, miss: 0.3, out: 1.2 } },
  pro: { off: { hit: 0.022, miss: 0.66, out: 1.98 }, peak: { hit: 0.044, miss: 1.32, out: 3.96 } },
};

const state = {
  installedAt: Date.now(),
  hours: new Map(),
  sessions: new Map(),
  ready: false,
};

/**
 * The module instance survives a plugin disable/enable cycle in the same host
 * process, so the persisted aggregate must be merged into the in-memory one
 * at most once per process; otherwise the restore would count it twice.
 */
let restoredOnce = false;

/* ---------------------------------------------------------------- helpers */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function bjParts(ms) {
  const d = new Date(ms + BJ);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

function dayKeyOf(parts) {
  return `${parts.y}-${pad2(parts.mo)}-${pad2(parts.day)}`;
}

function dayStart(ms) {
  return Math.floor((ms + BJ) / DAY) * DAY - BJ;
}

function hourStart(ms) {
  return Math.floor((ms + BJ) / HOUR) * HOUR - BJ;
}

function hourKey(ms) {
  const p = bjParts(ms);
  return `${dayKeyOf(p)}T${pad2(p.h)}`;
}

function clockOf(ms) {
  const p = bjParts(ms);
  return `${pad2(p.h)}:${pad2(p.m)}`;
}

function normalizeTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? Math.round(value * 1000) : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** True when the instant falls inside a DeepSeek peak window (Beijing time). */
function isPeakAt(ms) {
  const p = bjParts(ms);
  if (p.dow === 0 || p.dow === 6) return false;
  if (HOLIDAYS.has(dayKeyOf(p))) return false;
  return (p.h >= 9 && p.h < 12) || (p.h >= 14 && p.h < 18);
}

/** Next instant at which the peak/off-peak regime flips. */
function nextTransition(now) {
  const current = isPeakAt(now);
  const base = dayStart(now);
  for (let offset = 0; offset <= 10; offset += 1) {
    const day = base + offset * DAY;
    for (const hour of [0, 9, 12, 14, 18]) {
      const at = day + hour * HOUR;
      if (at <= now) continue;
      if (isPeakAt(at) !== current) return { at, peak: isPeakAt(at) };
    }
  }
  return { at: now + HOUR, peak: !current };
}

function tierOf(model) {
  return typeof model === 'string' && /pro/i.test(model) ? 'pro' : 'flash';
}

function priceFor(tier, peak) {
  const band = peak ? 'peak' : 'off';
  return {
    cny: RATES_CNY[tier][band],
    usd: RATES_USD[tier][band],
  };
}

/* -------------------------------------------------------------- aggregate */

function emptyBucket(at, peak) {
  return {
    t: hourStart(at),
    peak: peak ? 1 : 0,
    req: 0,
    in: 0,
    hit: 0,
    out: 0,
    cny: 0,
    usd: 0,
  };
}

function emptyTotals(at) {
  return { req: 0, in: 0, hit: 0, out: 0, cny: 0, usd: 0, firstAt: at, lastAt: at, model: '' };
}

function recordUsage(session, event) {
  if (!event || event.type !== 'assistant/message') return;
  const data = event.data;
  if (!data || !data.usage) return;

  const usage = data.usage;
  let hit = num(usage.cacheReadTokens);
  let miss = num(usage.inputTokens) + num(usage.cacheWriteTokens);
  let out = num(usage.outputTokens);
  if (hit === 0 && miss === 0 && out === 0) miss = num(usage.totalTokens);
  if (hit + miss + out === 0) return;

  const at = normalizeTime(event.time);
  const peak = isPeakAt(at);
  const model = data.message && data.message.source ? String(data.message.source.model || '') : '';
  const tier = tierOf(model);
  const { cny: c, usd: u } = priceFor(tier, peak);
  const cny = (miss * c.miss + hit * c.hit + out * c.out) / 1e6;
  const usd = (miss * u.miss + hit * u.hit + out * u.out) / 1e6;

  const key = hourKey(at);
  const bucket = state.hours.get(key) || emptyBucket(at, peak);
  bucket.req += 1;
  bucket.in += miss;
  bucket.hit += hit;
  bucket.out += out;
  bucket.cny += cny;
  bucket.usd += usd;
  state.hours.set(key, bucket);

  const sid = session && session.id !== undefined && session.id !== null ? String(session.id) : '';
  if (sid) {
    const totals = state.sessions.get(sid) || emptyTotals(at);
    totals.req += 1;
    totals.in += miss;
    totals.hit += hit;
    totals.out += out;
    totals.cny += cny;
    totals.usd += usd;
    totals.lastAt = Math.max(totals.lastAt, at);
    totals.firstAt = Math.min(totals.firstAt, at);
    if (model) totals.model = model;
    state.sessions.set(sid, totals);
  }

  scheduleSave();
}

function prune(now) {
  const hourCutoff = now - RETAIN_DAYS * DAY;
  for (const [key, bucket] of state.hours) {
    if (bucket.t < hourCutoff) state.hours.delete(key);
  }
  const sessionCutoff = now - SESSION_RETAIN_DAYS * DAY;
  const kept = [];
  for (const [key, totals] of state.sessions) {
    if (totals.lastAt < sessionCutoff) state.sessions.delete(key);
    else kept.push([key, totals]);
  }
  if (kept.length > MAX_SESSIONS) {
    kept.sort((a, b) => b[1].lastAt - a[1].lastAt);
    for (const [key] of kept.slice(MAX_SESSIONS)) state.sessions.delete(key);
  }
}

/* ------------------------------------------------------------ persistence */

function dataDir() {
  return process.env.DSH_USAGE_PULSE_DIR || join(homedir(), '.dsh-usage-pulse');
}

function dataFile() {
  return join(dataDir(), 'usage.json');
}

function serialize() {
  const hours = {};
  for (const [key, bucket] of state.hours) hours[key] = bucket;
  const sessions = {};
  for (const [key, totals] of state.sessions) sessions[key] = totals;
  return {
    v: 1,
    installedAt: state.installedAt,
    savedAt: Date.now(),
    hours,
    sessions,
  };
}

let saveTimer = null;
let writing = null;

function scheduleSave() {
  if (!state.ready) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flush();
  }, SAVE_DEBOUNCE_MS);
}

async function flush() {
  if (!state.ready) return;
  if (writing) return writing;
  prune(Date.now());
  const payload = JSON.stringify(serialize());
  writing = (async () => {
    try {
      const dir = dataDir();
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, `usage-${process.pid}.tmp`);
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, dataFile());
    } catch (error) {
      console.warn('[usage-pulse] failed to save usage snapshot:', error && error.message ? error.message : error);
    } finally {
      writing = null;
    }
  })();
  return writing;
}

async function restore() {
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1) return;
    if (typeof saved.installedAt === 'number') {
      state.installedAt = Math.min(state.installedAt, saved.installedAt);
    }
    for (const [key, bucket] of Object.entries(saved.hours || {})) {
      if (!bucket || typeof bucket !== 'object') continue;
      const current = state.hours.get(key);
      if (!current) {
        const restored = emptyBucket(num(bucket.t), bucket.peak === 1);
        mergeBucket(restored, bucket);
        state.hours.set(key, restored);
      } else {
        mergeBucket(current, bucket);
      }
    }
    for (const [key, totals] of Object.entries(saved.sessions || {})) {
      if (!totals || typeof totals !== 'object') continue;
      const current = state.sessions.get(key) || emptyTotals(num(totals.firstAt) || Date.now());
      current.req += num(totals.req);
      current.in += num(totals.in);
      current.hit += num(totals.hit);
      current.out += num(totals.out);
      current.cny += num(totals.cny);
      current.usd += num(totals.usd);
      current.firstAt = Math.min(current.firstAt, num(totals.firstAt) || current.firstAt);
      current.lastAt = Math.max(current.lastAt, num(totals.lastAt) || current.lastAt);
      if (typeof totals.model === 'string' && totals.model) current.model = totals.model;
      state.sessions.set(key, current);
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.warn('[usage-pulse] ignoring unreadable usage snapshot:', error && error.message ? error.message : error);
    }
  }
}

function mergeBucket(target, source) {
  target.t = Math.min(num(source.t) || target.t, target.t);
  target.req += num(source.req);
  target.in += num(source.in);
  target.hit += num(source.hit);
  target.out += num(source.out);
  target.cny += num(source.cny);
  target.usd += num(source.usd);
  if (source.peak === 1) target.peak = 1;
}

/* --------------------------------------------------------------- snapshot */

function bucketView(bucket) {
  if (!bucket) return { req: 0, tokens: 0, in: 0, hit: 0, out: 0, cny: 0, usd: 0 };
  return {
    req: bucket.req,
    tokens: bucket.in + bucket.hit + bucket.out,
    in: bucket.in,
    hit: bucket.hit,
    out: bucket.out,
    cny: bucket.cny,
    usd: bucket.usd,
  };
}

function todayAggregate(now) {
  const start = dayStart(now);
  const total = { req: 0, tokens: 0, in: 0, hit: 0, out: 0, cny: 0, usd: 0, peakCny: 0, offCny: 0 };
  for (const bucket of state.hours.values()) {
    if (bucket.t < start) continue;
    const view = bucketView(bucket);
    total.req += view.req;
    total.tokens += view.tokens;
    total.in += view.in;
    total.hit += view.hit;
    total.out += view.out;
    total.cny += view.cny;
    total.usd += view.usd;
    if (bucket.peak === 1) total.peakCny += view.cny;
    else total.offCny += view.cny;
  }
  return total;
}

function hoursSeries(now) {
  const current = hourStart(now);
  const out = [];
  for (let i = 23; i >= 0; i -= 1) {
    const at = current - i * HOUR;
    const view = bucketView(state.hours.get(hourKey(at)));
    out.push({
      t: at,
      hour: bjParts(at).h,
      day: dayKeyOf(bjParts(at)),
      peak: isPeakAt(at),
      req: view.req,
      tokens: view.tokens,
      in: view.in,
      hit: view.hit,
      out: view.out,
      cny: view.cny,
    });
  }
  return out;
}

function daysSeries(now) {
  const base = dayStart(now);
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const start = base - i * DAY;
    const agg = { req: 0, tokens: 0, cny: 0 };
    for (const bucket of state.hours.values()) {
      if (bucket.t < start || bucket.t >= start + DAY) continue;
      const view = bucketView(bucket);
      agg.req += view.req;
      agg.tokens += view.tokens;
      agg.cny += view.cny;
    }
    out.push({ t: start, day: dayKeyOf(bjParts(start + 1)), ...agg });
  }
  return out;
}

function totalsAggregate() {
  const total = { req: 0, tokens: 0, in: 0, hit: 0, out: 0, cny: 0, usd: 0 };
  for (const bucket of state.hours.values()) {
    const view = bucketView(bucket);
    total.req += view.req;
    total.tokens += view.tokens;
    total.in += view.in;
    total.hit += view.hit;
    total.out += view.out;
    total.cny += view.cny;
    total.usd += view.usd;
  }
  return total;
}

function sessionView(sessionId) {
  const totals = sessionId ? state.sessions.get(sessionId) : undefined;
  if (!totals) {
    return { known: false, model: '', tier: 'flash', req: 0, tokens: 0, in: 0, hit: 0, out: 0, cny: 0, usd: 0 };
  }
  return {
    known: true,
    model: totals.model || '',
    tier: tierOf(totals.model),
    req: totals.req,
    tokens: totals.in + totals.hit + totals.out,
    in: totals.in,
    hit: totals.hit,
    out: totals.out,
    cny: totals.cny,
    usd: totals.usd,
    firstAt: totals.firstAt,
    lastAt: totals.lastAt,
  };
}

function priceTable(peak) {
  const band = peak ? 'peak' : 'off';
  return {
    unit: 'CNY per 1M tokens',
    tier: band,
    models: [
      { id: 'deepseek-flash', label: 'deepseek-flash', ...RATES_CNY.flash[band] },
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', ...RATES_CNY.pro[band] },
    ],
  };
}

function buildSnapshot(sessionId, now) {
  prune(now);
  const peak = isPeakAt(now);
  const next = nextTransition(now);
  const session = sessionView(sessionId);
  return {
    ok: true,
    version: 1,
    now,
    tz: 'Asia/Shanghai',
    currency: 'CNY',
    installedAt: state.installedAt,
    installedDay: dayKeyOf(bjParts(state.installedAt)),
    regime: {
      peak,
      discount: peak ? 1 : 0.5,
      until: next.at,
      untilClock: clockOf(next.at),
      nextClock: clockOf(next.at),
      nextPeak: next.peak,
      nextDayOffset: Math.round((dayStart(next.at) - dayStart(now)) / DAY),
      nextDate: dayKeyOf(bjParts(next.at)),
    },
    today: todayAggregate(now),
    session,
    totals: { ...totalsAggregate(), since: state.installedAt },
    hours: hoursSeries(now),
    days: daysSeries(now),
    prices: priceTable(peak),
  };
}

/* ---------------------------------------------------------------- serving */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const url = new URL(req.url || ROUTE, 'http://localhost');
    const raw = url.searchParams.get('sessionId') || '';
    const sessionId = raw.length > 200 ? raw.slice(0, 200) : raw;
    const snapshot = buildSnapshot(sessionId, Date.now());
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0' });
      res.end();
      return;
    }
    sendJson(res, 200, snapshot);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) });
  }
}

/* ------------------------------------------------------------------ apply */

export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    try {
      recordUsage(session, event);
    } catch (error) {
      console.warn('[usage-pulse] failed to record usage:', error && error.message ? error.message : error);
    }
  });

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'exact', path: ROUTE, handler });
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  });

  ctx.effect(() => () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void flush();
  });

  void (async () => {
    if (!restoredOnce) {
      restoredOnce = true;
      await restore();
    }
    state.ready = true;
    prune(Date.now());
    scheduleSave();
  })();
}
