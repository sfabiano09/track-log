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

  /** The black "Right now" panel. today=false shows the day's final readings without "ago". */
  function rightNow(rawRows, { now, today = true } = {}) {
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
      <div class="tlv-lines">${prepBox("Spray", "spray")}${prepBox("Scrape", "scrape")}${runBox}</div></section>`;
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
  window.TLV = { rightNow, log, toMin };
})();
