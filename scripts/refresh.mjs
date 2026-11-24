#!/usr/bin/env node
/**
 * TaskMarket Pulse — data refresh pipeline.
 *
 * Fetches every public TaskMarket API endpoint and writes a single
 * site/data/market.json payload that the static dashboard renders.
 *
 * - No dependencies, Node >= 18 (global fetch).
 * - Per-chain: /market/stats?chainId= and full /tasks pagination
 *   (used for unique requesters per ISO week).
 * - Global: market stats, status/mode/actor breakdowns, daily
 *   platform time series, activity heatmaps and the live feed.
 *
 * Usage: node scripts/refresh.mjs [outdir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.taskmarket.dev/api';
const CHAINS = [
  { chainId: 8453, key: 'base', name: 'Base', token: 'USDC', color: '#2563ff' },
  { chainId: 4217, key: 'tempo', name: 'Tempo', token: 'OUSD', color: '#efe9e2' },
];
const OUT = process.argv[2]
  ? process.argv[2]
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'data');

async function getJSON(path, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(API + path, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Paginate /api/tasks (limit 100 + cursor) until hasMore=false. */
async function fetchAllTasks(chainId, maxPages = 80) {
  const tasks = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ limit: '100', sort: 'newest' });
    if (chainId) q.set('chainId', String(chainId));
    if (cursor) q.set('cursor', cursor);
    const d = await getJSON(`/tasks?${q}`);
    tasks.push(...(d.tasks || []));
    if (!d.hasMore || !d.nextCursor) break;
    cursor = d.nextCursor;
  }
  return tasks;
}

/** ISO week (Monday) key for a date string. */
function weekKey(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Unique requesters per ISO week. */
function uniquePostersPerWeek(tasks) {
  const byWeek = new Map();
  for (const t of tasks) {
    if (!t.createdAt || !t.requester) continue;
    const wk = weekKey(t.createdAt);
    if (!byWeek.has(wk)) byWeek.set(wk, new Set());
    byWeek.get(wk).add(t.requester);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, set]) => ({ week, posters: set.size }));
}

async function fetchChain(chain) {
  const cid = String(chain.chainId);
  const [stats, tasks] = await Promise.all([
    getJSON(`/market/stats?chainId=${cid}`),
    fetchAllTasks(chain.chainId),
  ]);
  return {
    chainId: chain.chainId,
    key: chain.key,
    name: chain.name,
    token: chain.token,
    color: chain.color,
    stats,
    taskCount: tasks.length,
    postersPerWeek: uniquePostersPerWeek(tasks),
  };
}

async function main() {
  console.log('[pulse] refreshing TaskMarket data…');
  const started = Date.now();

  const [globalStats, breakdowns, timeSeries, heatHour, heatMode, feed, chains] =
    await Promise.all([
      getJSON('/market/stats'),
      getJSON('/stats/breakdowns'),
      getJSON('/stats/platform-time-series?range=all&bucket=day'),
      getJSON('/stats/activity-heatmap?range=all&dimension=hourOfWeek'),
      getJSON('/stats/activity-heatmap?range=all&dimension=mode'),
      getJSON('/stats/activity-feed?limit=40'),
      Promise.all(CHAINS.map(fetchChain)),
    ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://api.taskmarket.dev',
    site: 'https://7777add7777-ai.github.io/taskmarket-pulse/',
    global: {
      stats: globalStats,
      breakdowns,
      timeSeries: (timeSeries || []).map((p) => ({
        ...p,
        rewardVolume: Number(p.rewardVolume || 0),
        paidVolume: Number(p.paidVolume || 0),
      })),
      heatHour,
      heatMode,
      feed: (feed.items || []).map((e) => ({
        type: e.type,
        ts: e.timestamp,
        taskTitle: e.taskTitle,
        taskId: e.taskId,
        chainId: e.chainId,
        actor: e.actor,
        actorType: e.actorType,
        amount: e.amount,
        rating: e.rating,
      })),
    },
    chains: Object.fromEntries(chains.map((c) => [c.key, c])),
  };

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'market.json');
  writeFileSync(file, JSON.stringify(payload));

  const kb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`[pulse] wrote ${file} (${kb} KB in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(`[pulse] tasks fetched: base=${chains[0].taskCount} tempo=${chains[1].taskCount}; days in series=${payload.global.timeSeries.length}`);
}

main().catch((e) => {
  console.error('[pulse] refresh failed:', e?.message || e);
  process.exit(1);
});
