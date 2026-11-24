/* TaskMarket Pulse — frontend. Data: data/market.json (refreshed by scripts/refresh.mjs) */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MINOR = 1000000; // reward tokens are 6-decimal
  const DAY = 86400000;

  const CHAIN_NAMES = { base: "Base", tempo: "Tempo" };
  const CHAIN_DOT = { base: "var(--chain-base)", tempo: "var(--chain-tempo)" };
  const CHAIN_COLOR = { base: "#2563ff", tempo: "#efe9e2" };
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const STATUS_COLOR = {
    completed: "var(--success)",
    open: "var(--primary)",
    claimed: "var(--info)",
    pending_approval: "var(--warning)",
    worker_selected: "var(--info)",
    cancelled: "var(--muted)",
    expired: "var(--muted)",
  };
  const MODE_COLOR = {
    bounty: "var(--mode-bounty)",
    claim: "var(--mode-claim)",
    pitch: "var(--mode-pitch)",
    benchmark: "var(--mode-benchmark)",
    auction: "var(--mode-auction)",
  };
  const FEED_META = {
    task_created: ["＋", "Task posted"],
    task_submitted: ["✓", "Solution submitted"],
    task_completed: ["★", "Task completed"],
    task_cancelled: ["✕", "Task cancelled"],
    worker_selected: ["⚑", "Worker selected"],
    payment: ["◉", "Payment settled"],
    rating: ["✦", "Rating given"],
  };

  let DATA = null;
  let state = { chain: "all", range: 90 };

  /* ---------- helpers ---------- */

  const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
  const fmtMoney = (minor) => {
    const v = minor / MINOR;
    if (v >= 1e6) return (v / 1e6).toFixed(1) + " M";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + " K";
    return v.toFixed(v < 10 ? 1 : 0);
  };
  const shortDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const relTime = (ts) => {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " h ago";
    return Math.floor(h / 24) + " d ago";
  };
  const shortAddr = (a) => (a && a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a || "–");

  function viewStats() {
    if (state.chain === "all") return DATA.global.stats;
    return DATA.chains[state.chain].stats;
  }

  /* ---------- canvas ---------- */

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const w = rect.width || parent.clientWidth || canvas.clientWidth || 300;
    const h = rect.height || parent.clientHeight || canvas.clientHeight || 220;
    canvas.width = Math.max(50, Math.floor(w * dpr));
    canvas.height = Math.max(50, Math.floor(h * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ---------- KPI ---------- */

  function renderKPIs() {
    const s = viewStats();
    $("k-open").textContent = fmt(s.openTasks);
    $("k-workers").textContent = fmt(s.registeredWorkers);
    $("k-agents").textContent = fmt(s.activeAgents7d);
    $("k-paid").textContent = fmt(s.paidWorkers);
    $("k-wallets").textContent = fmt(s.activeWallets);

    const el = $("k-completed");
    if (state.chain === "all") {
      const done = (DATA.global.breakdowns.status || [])
        .filter((b) => b.status === "completed")
        .reduce((a, b) => a + b.count, 0);
      el.textContent = fmt(done);
      el.title = "";
    } else {
      el.textContent = "–";
      el.title = "Completed count is available globally only (API limitation)";
    }
  }

  /* ---------- flow chart (global time series) ---------- */

  let flowPoints = null;

  function flowSlice() {
    const ts = DATA.global.timeSeries || [];
    if (!state.range) return ts;
    const from = Date.now() - state.range * DAY;
    return ts.filter((p) => new Date(p.bucket).getTime() >= from);
  }

  function renderFlow() {
    const canvas = $("flow-chart");
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const pts = flowSlice();
    ctx.clearRect(0, 0, w, h);
    if (!pts.length) {
      ctx.fillStyle = "var(--muted)";
      ctx.fillText("No data in this range", 20, h / 2);
      return;
    }
    const padL = 8, padR = 8, padT = 12, padB = 26;
    const iw = w - padL - padR, ih = h - padT - padB;

    const series = [
      { key: "tasksCreated", color: "#d9a097", raw: (v) => v },
      { key: "completedTasks", color: "#a9c29a", raw: (v) => v },
      { key: "rewardVolume", color: "#e0bf82", raw: (v) => fmtMoney(v) },
    ];
    const maxes = series.map((s) => Math.max(1, ...pts.map((p) => p[s.key] || 0)));

    // grid
    ctx.strokeStyle = "rgba(69,62,55,.5)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const n = pts.length;
    const xAt = (i) => padL + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const yAt = (v, m) => padT + ih - (ih * v) / m;

    flowPoints = pts.map((p, i) => ({ x: xAt(i), p, i }));

    // x labels
    ctx.fillStyle = "#b0a79d";
    ctx.font = "11px ui-monospace, Menlo, monospace";
    const labelStep = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += labelStep) {
      ctx.fillText(shortDate(pts[i].bucket), Math.min(xAt(i) - 18, w - 55), h - 8);
    }

    // series lines (each normalized to its own max)
    series.forEach((s, si) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = xAt(i), y = yAt(p[s.key] || 0, maxes[si]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // fill under created
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#d9a097";
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.tasksCreated || 0, maxes[0]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(n - 1), padT + ih);
    ctx.lineTo(xAt(0), padT + ih);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function flowTooltip(ev) {
    const tip = $("tip");
    if (!flowPoints) return;
    const rect = ev.target.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    let best = flowPoints[0], bd = Infinity;
    for (const fp of flowPoints) {
      const d = Math.abs(fp.x - mx);
      if (d < bd) { bd = d; best = fp; }
    }
    if (!best || bd > 30) { tip.style.display = "none"; return; }
    const p = best.p;
    tip.innerHTML =
      "<b>" + shortDate(p.bucket) + "</b><br>" +
      "Created: <b>" + fmt(p.tasksCreated) + "</b><br>" +
      "Completed: <b>" + fmt(p.completedTasks) + "</b><br>" +
      "Volume: <b>" + fmtMoney(p.rewardVolume) + "</b> USDC";
    tip.style.display = "block";
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 160) + "px";
    tip.style.top = (ev.clientY + 14) + "px";
  }

  /* ---------- bars (status / mode) ---------- */

  function renderBars(el, entries, colorOf, labelOf, total) {
    el.innerHTML = "";
    const max = Math.max(1, ...entries.map((e) => e.count));
    const sorted = [...entries].sort((a, b) => b.count - a.count);
    for (const e of sorted) {
      const row = document.createElement("div");
      row.className = "bar-row";
      const name = document.createElement("div");
      name.className = "bar-name";
      name.textContent = labelOf(e);
      name.title = labelOf(e);
      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = (100 * e.count) / max + "%";
      fill.style.background = colorOf(e);
      track.appendChild(fill);
      const val = document.createElement("div");
      val.className = "bar-val";
      val.textContent = fmt(e.count);
      row.append(name, track, val);
      el.appendChild(row);
    }
    if (total != null) el.dataset.total = total;
  }

  function renderBreakdowns() {
    const b = DATA.global.breakdowns || {};
    renderBars(
      $("status-bars"), b.status || [],
      (e) => STATUS_COLOR[e.status] || "var(--muted)",
      (e) => e.status.replace(/_/g, " ")
    );
    renderBars(
      $("mode-bars"), b.mode || [],
      (e) => MODE_COLOR[e.mode] || "var(--muted)",
      (e) => e.mode
    );
    const total = (b.status || []).reduce((a, e) => a + e.count, 0);
    const note = $("mode-total");
    if (note) note.textContent = "global · " + fmt(total) + " tasks";
  }

  /* ---------- heatmap (hour of day, UTC) ---------- */

  function renderHeatmap() {
    const hm = $("heatmap");
    const data = DATA.global.heatHour;
    hm.innerHTML = "";
    if (!data || !data.cells) {
      hm.textContent = "No heatmap data";
      return;
    }
    const max = data.maxCount || 1;
    const byKey = {};
    for (const c of data.cells) byKey[c.row + ":" + c.col] = c.count;
    const rows = (data.rowKeys || []).length;
    for (let r = 0; r < rows; r++) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "3px";
      row.style.alignItems = "center";
      const label = document.createElement("div");
      label.className = "hm-rowlabel";
      label.textContent = DAY_NAMES[r % 7];
      row.appendChild(label);
      for (let c = 0; c < 24; c++) {
        const count = byKey[r + ":" + c] || 0;
        const lvl = count === 0 ? 0 : 1 + Math.min(3, Math.floor((count / max) * 4));
        const cell = document.createElement("div");
        cell.className = "hm-cell heat-" + lvl;
        cell.dataset.tip =
          DAY_NAMES[r % 7] + " " + String(c).padStart(2, "0") + ":00 UTC — " + fmt(count) + " events";
        row.appendChild(cell);
      }
      hm.appendChild(row);
    }
  }

  /* ---------- posters per week (bar chart) ---------- */

  function postersSeries() {
    if (state.chain !== "all") return DATA.chains[state.chain].postersPerWeek || [];
    const map = {};
    for (const key of ["base", "tempo"]) {
      for (const p of (DATA.chains[key].postersPerWeek || [])) {
        map[p.week] = (map[p.week] || 0) + p.posters;
      }
    }
    return Object.entries(map).map(([week, posters]) => ({ week, posters }));
  }

  function renderPosters() {
    const canvas = $("posters-chart");
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const pts = postersSeries().sort((a, b) => a.week.localeCompare(b.week));
    ctx.clearRect(0, 0, w, h);
    if (!pts.length) return;
    const padT = 10, padB = 26, padL = 4, padR = 4;
    const iw = w - padL - padR, ih = h - padT - padB;
    const max = Math.max(1, ...pts.map((p) => p.posters));
    const n = pts.length;
    const bw = Math.min(26, (iw / n) * 0.72);

    ctx.fillStyle = "#b0a79d";
    ctx.font = "11px ui-monospace, Menlo, monospace";
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i++) {
      const x = padL + (iw * (i + 0.5)) / n;
      const bh = (ih * pts[i].posters) / max;
      ctx.fillStyle = i === n - 1 ? "#d9a097" : "rgba(217,160,151,.45)";
      ctx.fillRect(x - bw / 2, padT + ih - bh, bw, bh);
      if (i % step === 0) {
        ctx.fillStyle = "#b0a79d";
        ctx.fillText(shortDate(pts[i].week), Math.max(0, Math.min(x - 18, w - 52)), h - 8);
      }
    }
  }

  /* ---------- feed ---------- */

  function renderFeed() {
    const ul = $("feed");
    const all = DATA.global.feed || [];
    const items =
      state.chain === "all"
        ? all
        : all.filter((it) => it.chainId === (state.chain === "tempo" ? 4217 : 8453));
    $("feed-count").textContent = "Last " + items.length + " events";
    ul.innerHTML = "";
    for (const it of items) {
      const [ico, label] = FEED_META[it.type] || ["•", it.type.replace(/_/g, " ")];
      const li = document.createElement("li");
      const icoEl = document.createElement("div");
      icoEl.className = "feed-ico";
      icoEl.textContent = ico;
      const txt = document.createElement("div");
      txt.className = "feed-text";
      const b = document.createElement("b");
      b.textContent = label;
      const sub = document.createElement("span");
      sub.className = "sub";
      const parts = [];
      if (state.chain === "all") {
        const cn = it.chainId === 4217 ? "Tempo" : "Base";
        parts.push(cn);
      }
      if (it.taskTitle) parts.push(it.taskTitle.length > 60 ? it.taskTitle.slice(0, 60) + "…" : it.taskTitle);
      if (it.amount) parts.push(fmtMoney(it.amount) + " USDC");
      sub.textContent = parts.join(" · ");
      txt.append(b, " ", sub);
      const time = document.createElement("div");
      time.className = "feed-time";
      time.textContent = relTime(it.ts);
      li.append(icoEl, txt, time);
      ul.appendChild(li);
    }
  }

  /* ---------- meta / chrome ---------- */

  function renderMeta() {
    const gen = new Date(DATA.generatedAt);
    const el = $("updated-at");
    if (el) {
      el.textContent = "Data updated " + gen.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " UTC";
    }
    const dot = $("live-dot");
    if (dot) {
      const stale = Date.now() - gen.getTime() > 6 * 3600000;
      dot.classList.toggle("stale", stale);
      const pill = $("live-pill");
      if (pill) {
        const span = pill.querySelector("span:last-child");
        if (span) span.textContent = stale ? "Stale — waiting for refresh" : "Live · refreshed hourly";
      }
    }
    const hint = $("chain-hint");
    if (hint) {
      hint.textContent =
        state.chain === "all"
          ? "All networks · Base + Tempo"
          : CHAIN_NAMES[state.chain] + " · flow, heatmap and breakdowns are global (API limitation)";
    }
  }

  /* ---------- share ---------- */

  function bindShare() {
    const btn = $("share-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
      } catch {
        const t = document.createElement("textarea");
        t.value = location.href;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        t.remove();
      }
      const old = btn.textContent;
      btn.textContent = "✓ Link copied";
      setTimeout(() => (btn.textContent = old), 1600);
    });
  }

  /* ---------- tabs ---------- */

  function bindTabs() {
    document.querySelectorAll("[data-chain]").forEach((b) =>
      b.addEventListener("click", () => {
        state.chain = b.dataset.chain;
        document.querySelectorAll("[data-chain]").forEach((x) =>
          x.classList.toggle("active", x === b)
        );
        renderAll();
      })
    );
    document.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        state.range = parseInt(b.dataset.range, 10) || 0;
        document.querySelectorAll("[data-range]").forEach((x) =>
          x.classList.toggle("active", x === b)
        );
        renderFlow();
      })
    );
    const tip = $("tip");
    const chart = $("flow-chart");
    if (chart && tip) {
      chart.addEventListener("mousemove", flowTooltip);
      chart.addEventListener("mouseleave", () => (tip.style.display = "none"));
    }
    const hm = $("heatmap");
    if (hm && tip) {
      hm.addEventListener("mouseover", (ev) => {
        const c = ev.target.closest(".hm-cell");
        if (!c || !c.dataset.tip) return;
        tip.innerHTML = "<b>" + c.dataset.tip + "</b>";
        tip.style.display = "block";
        tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 160) + "px";
        tip.style.top = (ev.clientY + 14) + "px";
      });
      hm.addEventListener("mouseleave", () => (tip.style.display = "none"));
    }
  }

  function renderAll() {
    renderKPIs();
    renderFlow();
    renderBreakdowns();
    renderHeatmap();
    renderPosters();
    renderFeed();
    renderMeta();
  }

  /* ---------- boot ---------- */

  async function boot() {
    bindTabs();
    bindShare();
    let d;
    try {
      const res = await fetch("data/market.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      d = await res.json();
    } catch (err) {
      const e = $("error");
      if (e) {
        e.textContent = "Could not load market data (" + err.message + "). The snapshot is refreshed hourly by the agent pipeline.";
        e.classList.remove("hidden");
      }
      const l = $("loading");
      if (l) l.classList.add("done");
      return;
    }
    DATA = d;
    renderAll();
    const l = $("loading");
    if (l) l.classList.add("done");
    // auto-refresh hourly
    setTimeout(boot, 3600000);
  }

  document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("resize", () => {
    if (!DATA) return;
    renderFlow();
    renderPosters();
  });
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!DATA) return;
      renderFlow();
      renderPosters();
    });
    document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll(".chart-wrap").forEach((el) => ro.observe(el));
    });
  }
})();
