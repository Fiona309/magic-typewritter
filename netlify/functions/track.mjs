// 访问收集器：每次访问记一笔，聚合存进 Netlify Blobs（免费）。按北京时间(UTC+8)分桶。
import { getStore } from '@netlify/blobs';

const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

export default async (req, context) => {
  try {
    const isNew = new URL(req.url).searchParams.get('new') === '1';

    // 北京时间的日期与小时
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const day = bj.toISOString().slice(0, 10);
    const hour = bj.getUTCHours();

    // 地域（Netlify 自动注入，无需第三方）
    const geo = context.geo || {};
    const country = (geo.country && (geo.country.name || geo.country.code)) || '未知';
    const city = geo.city || '未知';

    const store = getStore('analytics');
    const key = `agg/${day}`;
    const a = (await store.get(key, { type: 'json' })) || {
      day, total: 0, uniques: 0, byHour: {}, byCountry: {}, byCity: {},
    };
    a.total++;
    if (isNew) a.uniques++;
    bump(a.byHour, hour);
    bump(a.byCountry, country);
    bump(a.byCity, city);
    await store.setJSON(key, a);

    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // 埋点绝不能影响用户，任何错误都吞掉
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
};
