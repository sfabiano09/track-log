/* Shared "Right now" panel and race-day log for the team page and Track Log Live.
   TLV.rightNow(rows, {now, today}) and TLV.log(rows, {lane, newestFirst}) return HTML strings.
   rows: one day's readings as saved by Track Log (time "HH:MM", type run|track|weather|work, ...). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const has = v => v !== undefined && v !== null && String(v).trim() !== "";
  const num = v => { if (!has(v)) return null; const n = Number(v); return isFinite(n) ? n : null; };
  const toMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; };
  const fmt = m => { let h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, "0"), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${mm} ${ap}`; };
  const short = m => fmt(m).replace(/ [AP]M$/, "");
  const ago = mins => mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} hr ${mins % 60 ? mins % 60 + " min " : ""}ago`;
  const agoShort = a => a < 1 ? "now" : a < 60 ? a + "m ago" : Math.floor(a / 60) + "h " + (a % 60) + "m ago";
  const TEAM_CARS = [["Austin", "austin"], ["Matt H", "matt"], ["PM", "pm"]];
  const STATIONS = [["slKeg", "SL"], ["k10", "10'"], ["k60", "60'"], ["k80", "80'"], ["k125", "125'"], ["k330", "330'"]];

  function prep(rows) { return rows.map((e, i) => ({ ...e, m: toMin(e.time), i })).sort((a, b) => a.m - b.m || a.i - b.i); }
  function lastBefore(rows, pred, m) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].m <= m && pred(rows[i])) return rows[i]; return null; }
  function carCls(c) { const s = String(c || "").toLowerCase(); return s.includes("austin") ? "austin" : /\bpm\b/.test(s) ? "pm" : s.includes("matt") ? "matt" : "other"; }
  // ET / MPH from the run's own fields, or from older notes like "3.91, 332mph"
  function result(e) {
    if (has(e.et) || has(e.mph)) return [e.et, e.mph].filter(has).join(" / ");
    const r = String(e.notes || "").match(/(\d\.\d{2,3})(?:\s*et)?[ ,]*(\d{3})?\s*(?:mph)?/i);
    return r ? r[1] + (r[2] ? " / " + r[2] : "") : "";
  }
  function plainNotes(e) {
    const parts = String(e.notes || "").split("/").map(s => s.trim()).filter(Boolean);
    return (has(e.et) || has(e.mph)) ? parts.join(" / ") : parts.filter(s => !/\d\.\d{2,3}/.test(s)).join(" / ");
  }
  function runNumbers(r) {
    const p = []; const a = (lab, k, u = "") => { if (has(r[k])) p.push(`<span style="white-space:nowrap">${lab} <b>${esc(r[k])}${u}</b></span>`); };
    a("Trk", "track", "°"); a("SL", "slKeg"); a("SL Stk", "slSticky"); a("10'", "k10"); a("P", "push"); a("60'", "k60"); a("80'", "k80"); a("125'", "k125");
    a("Stk", "sticky"); a("330'", "k330"); a("Nate", "nate");
    return p.length ? `<div class="runnums">${p.join(" · ")}</div>` : "";
  }


  /* ---------- similar runs ---------- */
  // a reading as a number: "2720 RT" → 2720, "3.5/4" or "25/ 135" → the average
  const nx = v => { if (!has(v)) return null; const m = String(v).match(/\d+(?:\.\d+)?/g); if (!m) return null; const a = m.map(Number); return a.reduce((x, y) => x + y, 0) / a.length; };
  const KEG_K = ["slKeg", "k10", "k60", "k80", "k125", "k330"], STK_K = ["slSticky", "sticky", "push", "nate"];
  // weights: track temp first, KEG second, sticky third, then weather and time of day
  const FEATS = [["track", 4], ["slKeg", 1.2], ["k10", 1.2], ["k60", 1.2], ["k80", 0.6], ["k125", 1], ["k330", 1],
    ["slSticky", 1], ["sticky", 1], ["nate", 0.75], ["push", 0.5], ["uv", 0.4], ["solar", 0.4], ["air", 0.4], ["min", 0.4], ["cc", 0.15]];
  const isAustin = r => carCls(r.car) === "austin";

  /** The track as it stood at minute m of a day: the latest of each reading, with the KEG numbers taken together from one reading.
      A run's own numbers (when given) win over earlier readings. */
  function conditions(rawRows, m, own) {
    const rows = prep(rawRows).filter(e => e.m <= m && e.type !== "work"), c = { min: m };
    const latest = k => { for (let i = rows.length - 1; i >= 0; i--) if (has(rows[i][k])) return rows[i][k]; return undefined; };
    for (const k of ["track", "air", "solar", "uv", "cc"]) c[k] = latest(k);
    let kr = null; for (let i = rows.length - 1; i >= 0 && !kr; i--) if (KEG_K.some(k => has(rows[i][k]))) kr = rows[i];
    for (const k of [...KEG_K, ...STK_K, "slLoc"]) c[k] = kr && has(kr[k]) ? kr[k] : (KEG_K.includes(k) ? undefined : latest(k));
    if (own) for (const k of ["track", "air", "solar", "uv", "cc", ...KEG_K, ...STK_K, "slLoc"]) if (has(own[k])) c[k] = own[k];
    for (const k in c) if (c[k] === undefined) delete c[k];
    return c;
  }

  /** The n Austin runs whose conditions are closest to q. Same track first (filled from other tracks), newer breaks near-ties. */
  function similar(history, q, { track, date, n = 3 } = {}) {
    if (nx(q.track) == null) return { list: [], reason: "Log a track temp to see similar runs." };
    // one copy of each run (the run sheet's copy wins over the one saved from the phone)
    const byKey = new Map();
    for (const r of history || []) {
      if (!isAustin(r) || r.date === date) continue;
      const key = [r.date, String(r.run || "").toLowerCase(), "austin"].join("|"), cur = byKey.get(key);
      if (!cur || (String(cur.id).startsWith("tl-") && !String(r.id).startsWith("tl-"))) byKey.set(key, r);
    }
    const pool = [...byKey.values()].map(r => ({ r, v: Object.fromEntries(FEATS.map(([k]) => [k, k === "min" ? (has(r.time) ? toMin(r.time) : null) : nx(r[k])])) }))
      .filter(p => p.v.track != null);
    if (!pool.length) return { list: [], reason: "No past Austin runs to compare with yet." };
    const sd = {}; for (const [k] of FEATS) { const a = pool.map(p => p.v[k]).filter(x => x != null);
      const mu = a.reduce((x, y) => x + y, 0) / (a.length || 1); sd[k] = Math.max(Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length || 1)), k === "min" ? 30 : 1e-6); }
    const qv = Object.fromEntries(FEATS.map(([k]) => [k, k === "min" ? q.min : nx(q[k])]));
    const qW = FEATS.reduce((s, [k, w]) => s + (qv[k] != null ? w : 0), 0);
    const day0 = Date.parse(date || new Date().toISOString().slice(0, 10));
    const scored = pool.map(p => {
      let d2 = 0, W = 0;
      for (const [k, w] of FEATS) if (qv[k] != null && p.v[k] != null) { d2 += w * ((qv[k] - p.v[k]) / sd[k]) ** 2; W += w; }
      d2 /= W; const cover = W / qW, age = Math.abs(day0 - Date.parse(p.r.date)) / 864e5;
      const score = Math.exp(-0.5 * d2) * (0.6 + 0.4 * cover);
      return { r: p.r, match: Math.round(100 * score), rank: -score + 0.0001 * age, sameTrack: p.r.event === track };   // about 1 point per 100 days older
    }).sort((a, b) => a.rank - b.rank);
    const same = scored.filter(s => s.sameTrack).slice(0, n);
    return { list: [...same, ...scored.filter(s => !s.sameTrack).slice(0, n - same.length)], q };
  }

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const prettyDay = iso => { const d = new Date(iso + "T12:00:00Z"); return `${DAYS[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  function similarHtml(history, q, opts) {
    const { list, reason } = similar(history, q, opts);
    const head = `<div class="tlv-simhead"><span class="label">Most similar Austin runs</span><span class="asof">closest track temp, then KEG, sticky and weather</span></div>`;
    if (!list.length) return `<div class="tlv-sim">${head}<div class="tlv-simnone">${esc(reason)}</div></div>`;
    const cmp = (lab, k, r, u = "", dec = 0) => { const a = nx(r[k]); if (a == null) return "";
      const b = nx(q[k]), d = b == null ? null : a - b;
      const dd = d == null || Math.abs(d) < (dec ? 0.05 : 0.5) ? "" : ` <i class="${d > 0 ? "hi" : "lo"}">${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(dec)}</i>`;
      return `<span>${lab} <b>${esc(r[k])}${u}</b>${dd}</span>`; };
    return `<div class="tlv-sim">${head}<div class="tlv-simlist">${list.map(({ r, match, sameTrack }) => {
      const res = has(r.et) ? [r.et, r.mph].filter(has).join(" / ") : [r.outcome, has(r.mph) ? r.mph : ""].filter(has).join(" · ");
      const splits = [["60'", "t60"], ["330'", "t330"], ["660'", "t660"]].filter(([, k]) => has(r[k])).map(([l, k]) => `${l} <b>${esc(r[k])}</b>`);
      if (has(r.fieldBestEt)) splits.push(`Field best <b>${esc(r.fieldBestEt)}</b>`);
      const nums = [cmp("Trk", "track", r, "°"), cmp("SL", "slKeg", r), cmp("10'", "k10", r), cmp("60'", "k60", r), cmp("80'", "k80", r), cmp("125'", "k125", r), cmp("330'", "k330", r),
        cmp("SL Stk", "slSticky", r), cmp("Stk", "sticky", r), cmp("P", "push", r, "", 1), cmp("Nate", "nate", r, "", 1), cmp("UV", "uv", r, "", 1), cmp("Air", "air", r, "°")].filter(Boolean);
      const note = plainNotes(r);
      return `<div class="tlv-simrun${sameTrack ? "" : " other"}">
        <div class="simtop"><span class="simpct">${match}%</span><span class="simwho">${esc(sameTrack ? "" : r.event + " · ")}${esc(prettyDay(r.date))}${has(r.time) ? " · " + short(toMin(r.time)) : ""}</span></div>
        <div class="what">${[r.run, r.lane && r.lane + " lane", res].filter(has).map(esc).join(" · ")}</div>
        ${splits.length ? `<div class="simsplits">${splits.join(" · ")}</div>` : ""}
        ${sameTrack ? "" : `<div class="simflag">Other track</div>`}
        <div class="runnums simnums">${nums.join(" · ")}</div>
        ${note ? `<div class="simnote">${esc(note)}</div>` : ""}</div>`;
    }).join("")}</div><div class="tlv-simkey">+/− = that run's number compared with now</div></div>`;
  }

  /** The black "Right now" panel. today=false shows the day's final readings without "ago". */
  function rightNow(rawRows, { now, today = true, history = null, track = "", date = "" } = {}) {
    const rows = prep(rawRows);
    if (!today) now = 24 * 60;
    const upto = rows.filter(e => e.m <= now);
    const stat = (k, label, unit, dec = 0) => {
      const cur = lastBefore(upto, e => num(e[k]) != null, now);
      if (!cur) return `<div class="tlv-stat"><div class="k">${label}</div><div class="v">—</div></div>`;
      const prev = lastBefore(upto, e => num(e[k]) != null, cur.m - 60), v = num(cur[k]);
      let d = "";
      if (prev) { const diff = v - num(prev[k]); d = Math.abs(diff) >= (dec ? 0.1 : 1) ? `<div class="d ${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(dec)} in 1 hr</div>` : `<div class="d">steady</div>`; }
      const age = now - cur.m;
      const when = today ? `${short(cur.m)} · ${agoShort(age)}` : fmt(cur.m);
      return `<div class="tlv-stat"><div class="k">${label}</div><div class="v">${v.toLocaleString(undefined, { maximumFractionDigits: dec })}${unit}</div>${d}<div class="when ${today && age > 60 ? "stale" : ""}">${when}</div></div>`;
    };
    const when = e => today ? `<div class="ago ${now - e.m > 60 ? "old" : ""}">${ago(now - e.m)} · ${fmt(e.m)}</div>` : `<div class="ago old">${fmt(e.m)}</div>`;
    const prepBox = (w, cls) => { const e = lastBefore(upto, x => x.type === "work" && x.work === w, now);
      return `<div class="tlv-nl ${cls}"><div class="label">Last ${w.toLowerCase()}</div>` + (e ? `<div class="what">${esc(e.notes || w)}</div>${when(e)}` : `<div class="what">None yet today</div>`) + `</div>`; };
    // the latest run for each of the team's cars
    const runBox = TEAM_CARS.map(([name, cls]) => {
      const run = lastBefore(upto, e => e.type === "run" && carCls(e.car) === cls, now);
      return `<div class="tlv-nl lastrun car-${cls}"><div class="label">Last ${esc(name)} run</div>` + (run ?
        `<div class="what">${[run.run, run.lane && run.lane + " lane", result(run)].filter(has).map(esc).join(" · ")}</div>${when(run)}${runNumbers(run)}`
        : `<div class="what">No run yet today</div>`) + `</div>`;
    }).join("");
    return `<section class="tlv-now" aria-label="${today ? "Right now" : "End of day"}"><div class="nowhead"><span class="label">${today ? "Right now" : "End of day"}</span><span class="asof">${today ? "as of " + fmt(now) : "final readings"}</span></div>
      <div class="tlv-grid">${stat("track", "Track", "°")}${stat("air", "Air", "°")}${stat("solar", "Solar", "")}${stat("uv", "UV", "", 1)}${stat("cc", "Cloud", "%")}</div>
      <div class="tlv-lines">${prepBox("Spray", "spray")}${prepBox("Scrape", "scrape")}${runBox}</div>${history ? similarHtml(history, conditions(rawRows, now), { track, date }) : ""}</section>`;
  }

  /** The race-day log: track work as dividers, runs in bold boxes, KEG strips with change vs the same lane. */
  function log(rawRows, { lane = "all", newestFirst = true, onlyKey = false } = {}) {
    const all = prep(rawRows);
    const RANGE = {}; for (const [k] of STATIONS) { const v = all.map(e => num(e[k])).filter(x => x != null); RANGE[k] = v.length ? [Math.min(...v), Math.max(...v)] : null; }
    const shade = (k, v) => { const r = RANGE[k]; if (!r || r[1] === r[0]) return 3; return Math.min(6, 1 + Math.floor((v - r[0]) / (r[1] - r[0]) * 5.999)); };
    const prevSame = (e, k) => { for (let i = all.indexOf(e) - 1; i >= 0; i--) { const x = all[i]; if ((x.lane || "") === (e.lane || "") && num(x[k]) != null) return x; } return null; };
    const wx = e => { const p = []; const a = (l, k, u = "") => { if (has(e[k])) p.push(`${l} <b>${esc(e[k])}${u}</b>`); };
      a("Track", "track", "°"); a("Air", "air", "°"); a("Solar", "solar"); a("UV", "uv"); a("CC", "cc", "%"); return p.join(" · "); };
    const strip = e => {
      if (!STATIONS.some(([k]) => has(e[k]))) return "";
      return `<div class="tlv-strip">${STATIONS.map(([k, lab]) => {
        const raw = e[k], v = num(raw);
        if (!has(raw)) return `<div class="tlv-st empty"><div class="n">—</div><div class="s">${lab}</div></div>`;
        if (v == null) return `<div class="tlv-st txt"><div class="n">${esc(raw)}</div><div class="s">${lab}</div></div>`;
        const lvl = shade(k, v), p = prevSame(e, k); let dl = "";
        if (p) { const d = v - num(p[k]); if (d) dl = `<div class="dl ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(+d.toFixed(2))}</div>`; }
        return `<div class="tlv-st ${lvl >= 4 ? "dark" : ""}" style="background:var(--k${lvl})"><div class="n">${v}</div><div class="s">${lab}</div>${dl}</div>`;
      }).join("")}</div>`;
    };
    const extras = e => { const x = []; const add = (lab, k) => { if (has(e[k])) x.push(`${lab} <b>${esc(e[k])}</b>`); };
      add("SL Sticky", "slSticky"); add("Sticky", "sticky"); add("Push", "push"); add("Nate", "nate"); add("SL loc", "slLoc");
      return x.length ? `<div class="tlv-extras">${x.join("")}</div>` : ""; };
    let rows = all.filter(e => lane === "all" || e.type === "work" || e.type === "weather" || e.lane === lane);
    if (newestFirst) rows = rows.slice().reverse();
    const key = `<div class="tlv-key"><span>KEG shading for each spot on the track:</span><span>lower</span><span class="ramp">${[1, 2, 3, 4, 5, 6].map(i => `<i style="background:var(--k${i})"></i>`).join("")}</span><span>higher than the day's other readings · ▲▼ change from the last reading in the same lane</span></div>`;
    if (!rows.length) return key + `<div class="tlv-empty">No readings logged for this day yet.</div>`;
    return key + `<div class="tlv-log">${rows.map(e => {
      const pend = e._pending ? " pending" : "";
      if (e.type === "work") return `<div class="tlv-work ${String(e.work || "").toLowerCase()}"><span class="wt">${short(e.m)}</span><span class="wl">${esc(e.work)}</span><span class="wn">${esc(e.notes || "")}</span></div>`;
      if (e.type === "weather") return `<div class="tlv-e weather${pend}"><div><span class="t">${short(e.m)}</span></div><div class="body"><div class="head">Weather · <span class="meta">${wx(e)}</span></div>${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ""}</div></div>`;
      if (e.type === "run") { const n = plainNotes(e);
        return `<div class="tlv-e run${pend}"><div><span class="t">${short(e.m)}</span><span class="ty">Run</span></div><div class="body">
          <div class="head">${has(e.run) ? `<span class="tlv-tag">${esc(e.run)}</span>` : ""}<span class="tlv-car ${carCls(e.car)}">${esc(e.car)}</span>${e.lane ? `<span class="tlv-lane ${esc(e.lane)}">${esc(e.lane)}</span>` : ""}<span class="tlv-result">${esc(result(e))}</span></div>
          <div class="meta">${wx(e)}</div>${strip(e)}${extras(e)}${n ? `<div class="note">${esc(n)}</div>` : ""}</div></div>`; }
      return `<div class="tlv-e${pend}"><div><span class="t">${short(e.m)}</span><span class="ty">Track</span></div><div class="body">
        <div class="head">Track reading${e.lane ? ` <span class="tlv-lane ${esc(e.lane)}">${esc(e.lane)}</span>` : ""}<span class="meta" style="margin-left:6px">${wx(e)}</span></div>
        ${strip(e)}${extras(e)}${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ""}</div></div>`;
    }).join("")}</div>`;
  }
  window.TLV = { rightNow, log, toMin, conditions, similar, carCls };
})();
