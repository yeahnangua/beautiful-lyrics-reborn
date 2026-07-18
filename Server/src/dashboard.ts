// Self-contained stats dashboard. Fetches /stats JSON and renders an SVG donut.
// ponytail: inline HTML string, no bundler/asset pipeline. Move to a real asset if it grows.
export const dashboardHtml = /* html */ `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lyrics Stats</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #0b0a0f;
    --panel: #14121b;
    --ink: #f4f1ea;
    --muted: #8a8496;
    --line: #262233;
    --syllable: #f5b642;
    --lineType: #6ea8fe;
    --static: #b07cf0;
    --none: #4a4556;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: radial-gradient(120% 90% at 80% -10%, #1c1830 0%, var(--bg) 55%) fixed;
    color: var(--ink);
    font-family: "Space Grotesk", system-ui, sans-serif;
    min-height: 100vh;
    padding: clamp(1.5rem, 4vw, 4rem);
    -webkit-font-smoothing: antialiased;
  }
  .grain {
    position: fixed; inset: 0; pointer-events: none; opacity: 0.035; z-index: 99;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  header {
    display: flex; justify-content: space-between; align-items: flex-end;
    flex-wrap: wrap; gap: 1rem; max-width: 1000px; margin: 0 auto 2.5rem;
    animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  h1 {
    font-family: "Fraunces", serif; font-weight: 600; font-size: clamp(2.2rem, 6vw, 3.6rem);
    line-height: 0.95; letter-spacing: -0.02em;
  }
  h1 em { font-style: italic; color: var(--syllable); }
  .sub { color: var(--muted); font-size: 0.95rem; margin-top: 0.5rem; letter-spacing: 0.01em; }
  .ranges { display: flex; gap: 0.4rem; }
  .ranges button {
    font-family: inherit; font-size: 0.85rem; color: var(--muted);
    background: var(--panel); border: 1px solid var(--line); border-radius: 999px;
    padding: 0.45rem 1rem; cursor: pointer; transition: all 0.2s ease;
  }
  .ranges button:hover { color: var(--ink); border-color: #3a3450; }
  .ranges button[aria-pressed="true"] { color: var(--bg); background: var(--syllable); border-color: var(--syllable); font-weight: 600; }
  main {
    max-width: 1000px; margin: 0 auto;
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(1.5rem, 4vw, 3.5rem);
    align-items: center;
  }
  @media (max-width: 720px) { main { grid-template-columns: 1fr; } }
  .chart-wrap { position: relative; display: grid; place-items: center; animation: rise 0.8s 0.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  svg.donut { width: min(360px, 80vw); height: auto; transform: rotate(-90deg); }
  svg.donut circle { fill: none; stroke-width: 26; stroke-linecap: round; transition: stroke-dashoffset 1s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .center { position: absolute; text-align: center; }
  .center .big { font-family: "Fraunces", serif; font-size: 3rem; font-weight: 600; letter-spacing: -0.02em; }
  .center .lbl { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.15em; }
  .legend { display: flex; flex-direction: column; gap: 0.9rem; animation: rise 0.8s 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .row {
    display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 0.9rem;
    padding: 0.85rem 0; border-bottom: 1px solid var(--line);
  }
  .row:last-child { border-bottom: none; }
  .dot { width: 12px; height: 12px; border-radius: 4px; }
  .row .name { font-weight: 500; }
  .row .desc { display: block; color: var(--muted); font-size: 0.75rem; font-weight: 400; }
  .row .pct { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 1.15rem; }
  .row .cnt { font-family: "JetBrains Mono", monospace; color: var(--muted); font-size: 0.85rem; min-width: 3.5ch; text-align: right; }
  footer { max-width: 1000px; margin: 3rem auto 0; color: var(--muted); font-size: 0.8rem; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
  footer a { color: var(--syllable); text-decoration: none; }
  .state { max-width: 1000px; margin: 4rem auto; text-align: center; color: var(--muted); font-family: "Fraunces", serif; font-style: italic; font-size: 1.3rem; }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
<div class="grain"></div>
<header>
  <div>
    <h1>逐字歌词 <em>命中率</em></h1>
    <div class="sub" id="totalLine">加载中…</div>
  </div>
  <div class="ranges" id="ranges">
    <button data-days="7">7 天</button>
    <button data-days="30" aria-pressed="true">30 天</button>
    <button data-days="90">90 天</button>
  </div>
</header>
<main id="main" hidden>
  <div class="chart-wrap">
    <svg class="donut" viewBox="0 0 200 200" id="donut"></svg>
    <div class="center">
      <div class="big" id="topPct">–</div>
      <div class="lbl" id="topLbl">逐字</div>
    </div>
  </div>
  <div class="legend" id="legend"></div>
</main>
<div class="state" id="state">正在获取统计…</div>
<footer>
  <span>数据来源：Analytics Engine · 高流量下为采样估算</span>
  <a href="/stats" target="_blank">原始 JSON →</a>
</footer>
<script>
  const META = {
    syllable: { name: "逐字", desc: "Syllable · 卡拉OK 级", color: "var(--syllable)" },
    line:     { name: "逐行", desc: "Line · 逐行同步", color: "var(--lineType)" },
    static:   { name: "纯文本", desc: "Static · 无时间轴", color: "var(--static)" },
    none:     { name: "未命中", desc: "None · 无歌词", color: "var(--none)" }
  };
  const ORDER = ["syllable", "line", "static", "none"];
  const R = 74, C = 2 * Math.PI * R;
  const $ = (id) => document.getElementById(id);

  function render(data) {
    const total = data.total || 0;
    $("main").hidden = total === 0;
    $("state").hidden = total !== 0;
    if (total === 0) { $("state").textContent = "这个时间段还没有请求数据。"; $("totalLine").textContent = "暂无数据"; return; }

    $("totalLine").textContent = total.toLocaleString() + " 次请求 · 近 " + data.days + " 天";

    const donut = $("donut");
    const legend = $("legend");
    donut.innerHTML = "";
    legend.innerHTML = "";
    let offset = 0;

    // background track
    donut.insertAdjacentHTML("beforeend",
      '<circle cx="100" cy="100" r="' + R + '" style="stroke:var(--line);stroke-width:26"/>');

    const top = ORDER.reduce((a, b) => (data[a]?.count || 0) >= (data[b]?.count || 0) ? a : b);
    $("topPct").textContent = (data[top]?.percent ?? 0) + "%";
    $("topLbl").textContent = META[top].name;

    ORDER.forEach((key, i) => {
      const d = data[key] || { count: 0, percent: 0 };
      const frac = total === 0 ? 0 : d.count / total;
      const len = frac * C;
      const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      arc.setAttribute("cx", "100"); arc.setAttribute("cy", "100"); arc.setAttribute("r", R);
      arc.style.stroke = META[key].color;
      arc.style.strokeDasharray = C;
      arc.style.strokeDashoffset = C; // start hidden, animate in
      donut.appendChild(arc);
      const thisOffset = offset;
      requestAnimationFrame(() => {
        arc.style.strokeDasharray = len + " " + (C - len);
        arc.style.strokeDashoffset = -thisOffset;
      });
      offset += len;

      legend.insertAdjacentHTML("beforeend",
        '<div class="row" style="animation-delay:' + (i * 60) + 'ms">' +
          '<span class="dot" style="background:' + META[key].color + '"></span>' +
          '<span class="name">' + META[key].name + '<span class="desc">' + META[key].desc + '</span></span>' +
          '<span class="pct">' + d.percent + '%</span>' +
          '<span class="cnt">' + d.count.toLocaleString() + '</span>' +
        '</div>');
    });
  }

  async function load(days) {
    $("state").hidden = false; $("main").hidden = true;
    $("state").textContent = "正在获取统计…";
    try {
      const res = await fetch("/stats?days=" + days);
      if (!res.ok) throw new Error(await res.text());
      render(await res.json());
    } catch (e) {
      $("state").hidden = false; $("main").hidden = true;
      $("state").textContent = "加载失败：" + e.message;
    }
  }

  $("ranges").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    [...$("ranges").children].forEach((b) => b.setAttribute("aria-pressed", b === btn));
    load(btn.dataset.days);
  });
  load(30);
</script>
</body>
</html>`;
