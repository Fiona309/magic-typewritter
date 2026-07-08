// 数据看板：带密码的网页，读取聚合数据渲染图表。密码存在环境变量 STATS_KEY。
import { getStore } from '@netlify/blobs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mergeInto(target, obj) {
  for (const k in obj) target[k] = (target[k] || 0) + obj[k];
}

// 渲染横向条形榜。默认按数值降序取前 top；order 给数值排序函数（升序、不截断）；chrono 按键名升序取最近 top 个
function bars(obj, { top = 8, label = (k) => k, order = null, chrono = false } = {}) {
  let e = Object.entries(obj);
  if (order) e.sort((a, b) => order(a[0]) - order(b[0]));
  else if (chrono) { e.sort((a, b) => (a[0] < b[0] ? -1 : 1)); e = e.slice(-top); }
  else { e.sort((a, b) => b[1] - a[1]); e = e.slice(0, top); }
  if (!e.length) return '<div class="empty">暂无数据</div>';
  const max = Math.max(1, ...e.map((x) => x[1]));
  return e.map(([k, v]) => `
    <div class="row">
      <div class="k">${esc(label(k))}</div>
      <div class="track"><div class="fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div>
      <div class="v">${v}</div>
    </div>`).join('');
}

// 'YYYY-MM-DD' → 该周周一的日期字符串
function weekStart(dayStr) {
  const d = new Date(dayStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const SECRET = process.env.STATS_KEY || '';
  if (!SECRET || key !== SECRET) {
    return new Response('未授权。请在网址后加上 ?key=你的密码', {
      status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const store = getStore('analytics');
  const { blobs } = await store.list({ prefix: 'agg/' });
  const days = [];
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (a) days.push(a);
  }
  days.sort((a, b) => (a.day < b.day ? -1 : 1));

  const total = days.reduce((s, d) => s + (d.total || 0), 0);
  const uniques = days.reduce((s, d) => s + (d.uniques || 0), 0);
  const byDay = {}, byHour = {}, byCountry = {}, byCity = {};
  for (const d of days) {
    byDay[d.day] = d.total || 0;
    mergeInto(byHour, d.byHour || {});
    mergeInto(byCountry, d.byCountry || {});
    mergeInto(byCity, d.byCity || {});
  }

  // 日/周/月/年 四个维度（都从每日数据聚合而来）
  const byWeek = {}, byMonth = {}, byYear = {};
  for (const [d, n] of Object.entries(byDay)) {
    byWeek[weekStart(d)] = (byWeek[weekStart(d)] || 0) + n;
    byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + n;
    byYear[d.slice(0, 4)] = (byYear[d.slice(0, 4)] || 0) + n;
  }
  const trendDay = bars(byDay, { top: 31, chrono: true, label: (k) => k.slice(5) });
  const trendWeek = bars(byWeek, { top: 16, chrono: true, label: (k) => k.slice(5) + ' 那周' });
  const trendMonth = bars(byMonth, { top: 12, chrono: true, label: (k) => k.slice(0, 4) + '年' + (+k.slice(5, 7)) + '月' });
  const trendYear = bars(byYear, { top: 6, chrono: true, label: (k) => k + ' 年' });

  const bjDay = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const today = byDay[bjDay] || 0;

  const html = `<!doctype html><html lang="zh"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>数据看板 · Alphabet AR</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 16px 60px; background: #100804; color: #ffe8d0;
    font: 15px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: .05em; color: #ff6f3c; margin: 0 0 4px;
    text-shadow: 0 0 20px rgba(255,90,40,.5); }
  .sub { color: rgba(255,220,190,.5); font-size: 12px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
  .card { background: rgba(255,150,60,.08); border: 1px solid rgba(255,150,60,.2); border-radius: 12px;
    padding: 14px 12px; text-align: center; }
  .card .n { font-size: 26px; font-weight: 700; color: #ffd24d; }
  .card .l { font-size: 12px; color: rgba(255,220,190,.65); margin-top: 4px; }
  .panel { background: rgba(255,255,255,.03); border: 1px solid rgba(255,150,60,.15); border-radius: 12px;
    padding: 16px 16px 18px; margin-bottom: 16px; }
  .panel h2 { font-size: 14px; font-weight: 600; color: #ffb066; margin: 0 0 12px; }
  .phead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
  .phead h2 { margin: 0; }
  .tabs { display: flex; gap: 4px; }
  .tab { padding: 5px 14px; font-size: 13px; border: 1px solid rgba(255,150,60,.3); border-radius: 999px;
    background: transparent; color: rgba(255,210,170,.7); cursor: pointer; }
  .tab.on { background: linear-gradient(90deg, #ff6f3c, #ffb02e); border-color: transparent; color: #1a0a00; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 10px; margin: 7px 0; }
  .row .k { width: 96px; flex: none; font-size: 12px; color: rgba(255,224,200,.85);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .track { flex: 1; height: 16px; background: rgba(255,255,255,.05); border-radius: 4px; overflow: hidden; }
  .row .fill { height: 100%; background: linear-gradient(90deg, #ff6f3c, #ffd24d); border-radius: 4px; }
  .row .v { width: 44px; flex: none; text-align: right; font-size: 12px; color: #ffd24d; font-variant-numeric: tabular-nums; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .empty { color: rgba(255,220,190,.4); font-size: 13px; }
  .foot { color: rgba(255,220,190,.4); font-size: 12px; margin-top: 20px; text-align: center; }
  @media (max-width: 560px) { .cards { grid-template-columns: repeat(2, 1fr); } .grid2 { grid-template-columns: 1fr; } }
</style></head><body>
<div class="wrap">
  <h1>Alphabet AR · 数据看板</h1>
  <div class="sub">时间以北京时间统计 · 本页每 5 分钟自动刷新 · 数据来自你自己的 Netlify（免费）</div>

  <div class="cards">
    <div class="card"><div class="n">${total}</div><div class="l">总访问量</div></div>
    <div class="card"><div class="n">${uniques}</div><div class="l">独立访客</div></div>
    <div class="card"><div class="n">${today}</div><div class="l">今日访问</div></div>
    <div class="card"><div class="n">${days.length}</div><div class="l">活跃天数</div></div>
  </div>

  <div class="panel">
    <div class="phead">
      <h2>📈 访问趋势</h2>
      <div class="tabs">
        <button class="tab on" id="tab-day" onclick="showTrend('day')">日</button>
        <button class="tab" id="tab-week" onclick="showTrend('week')">周</button>
        <button class="tab" id="tab-month" onclick="showTrend('month')">月</button>
        <button class="tab" id="tab-year" onclick="showTrend('year')">年</button>
      </div>
    </div>
    <div id="trend-day">${trendDay}</div>
    <div id="trend-week" style="display:none">${trendWeek}</div>
    <div id="trend-month" style="display:none">${trendMonth}</div>
    <div id="trend-year" style="display:none">${trendYear}</div>
  </div>

  <div class="grid2">
    <div class="panel"><h2>🌍 国家 / 地区</h2>${bars(byCountry)}</div>
    <div class="panel"><h2>🏙️ 城市 Top</h2>${bars(byCity, { top: 10 })}</div>
  </div>

  <div class="panel"><h2>🕐 访问时段（北京时间 0–23 点）</h2>${bars(byHour, { top: 24, order: (k) => +k, label: (k) => k + '点' })}</div>

  <div class="foot">共 ${total} 次访问 · 生成于 ${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')}</div>
</div>
<script>
  function showTrend(r){
    ['day','week','month','year'].forEach(function(x){
      document.getElementById('trend-'+x).style.display = (x===r)?'block':'none';
      document.getElementById('tab-'+x).classList.toggle('on', x===r);
    });
  }
  setTimeout(function(){ location.reload(); }, 300000);
</script>
</body></html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
