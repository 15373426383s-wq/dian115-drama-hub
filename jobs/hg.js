/**
 * 红果目录（只取元数据，不取播放流）
 *
 * 为什么要有这个作业：
 *   TMDB 对短剧的收录是「滞后 + 不全」的，很多在播短剧要等一阵才有条目；
 *   红果（hongguoduanju.com）的网页版把分类、搜索、详情都做成了 SSR，
 *   页面里直接带 JSON，且不需要签名 / Cookie / 登录。
 *
 * 边界（重要）：
 *   只取「片名 / 集数 / 海报 / 简介 / 标签 / 可播集数」这些目录信息，
 *   用来把剧找出来、把集数校准准，下载仍旧走 PT。
 *   播放页现在返回 protectedPlayback=true，SSR 里没有明文直链，
 *   所以这里刻意不做取流——既不碰播放，也不碰任何解密。
 *
 * 取数口径：
 *   分类  GET /category/{route}?page=N   → loaderData["category_$"].recommendList
 *   搜索  GET /api/search/result/?query=…&page=N → {searchList,totalCount,totalPages}
 *   详情  GET /detail?series_id=…        → loaderData 里任一层含 seriesDetail
 *
 * 坑：
 *   1. page=1 会被 301 到无参规范地址，所以第一页不带 ?page。
 *   2. 详情层的名字带动态片段（detail_page / detail_(id)/page），不能按固定名取，
 *      改为扫描所有层找含 seriesDetail 的那一层。
 *   3. SSR 的 JSON 不能用正则取，必须跳过字符串字面量做括号配对。
 */

const BASE = 'https://hongguoduanju.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export const ROUTES = {
  'real-drama': '真人剧',
  'comic-drama': '漫剧',
  'ai-drama': 'AI剧'
};

async function readKV(ctx, key, fallback) {
  try {
    const raw = await ctx.storage.get(key);
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === 'object' && raw.value !== undefined) return raw.value === null ? fallback : raw.value;
    return raw;
  } catch (e) {
    return fallback;
  }
}

async function writeKV(ctx, key, value) {
  try {
    await ctx.storage.set(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url);
  return await res.text();
}

/** 取 window._ROUTER_DATA 的 JSON：跳过字符串字面量做括号配对，正则会切坏嵌套结构 */
function routerData(html) {
  const i = html.indexOf('_ROUTER_DATA');
  if (i < 0) return null;
  const j = html.indexOf('{', i);
  if (j < 0) return null;
  let depth = 0;
  let k = j;
  let instr = false;
  let esc = false;
  while (k < html.length) {
    const c = html.charAt(k);
    if (instr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') instr = false;
    } else if (c === '"') {
      instr = true;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(j, k + 1));
        } catch (e) {
          return null;
        }
      }
    }
    k += 1;
  }
  return null;
}

/** 在任意深度找某个键（层名会被站点改，按键找比按层名找稳） */
function dig(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const hit = dig(obj[i], key);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const hit = dig(obj[k], key);
    if (hit !== null) return hit;
  }
  return null;
}

function num(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : (d || 0);
}

function txt(v, max) {
  const s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  return max && s.length > max ? s.slice(0, max) + '…' : s;
}

/** 统一成 UI 认的形状：红果只给元数据，所以字段名跟 TMDB 那套分开写 */
function shape(o) {
  const ep = num(o.episode_cnt || o.ep);
  const playable = num(o.accessible_episode_cnt || o.playable);
  return {
    id: String(o.series_id || o.id || o.vid || ''),
    title: txt(o.series_name || o.title || o.name, 80),
    cover: String(o.series_cover || o.cover || ''),
    ep: ep,
    playable: playable,
    intro: txt(o.series_intro || o.intro, 160),
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 4).map(function (t) { return txt(t, 8); }) : []
  };
}

async function doList(ctx, input) {
  const route = ROUTES[input.route] ? input.route : 'real-drama';
  const page = Math.max(1, num(input.page, 1));
  const url = BASE + '/category/' + route + (page > 1 ? '?page=' + page : '');
  const html = await fetchText(url);
  const data = routerData(html);
  if (!data) throw new Error('红果页面结构变了，没找到 _ROUTER_DATA');
  const list = dig(data.loaderData, 'recommendList');
  const pg = dig(data.loaderData, 'pagination');
  const items = (Array.isArray(list) ? list : []).map(shape).filter(function (x) { return x.id && x.title; });
  return {
    kind: 'list',
    route: route,
    routeLabel: ROUTES[route],
    page: page,
    total: pg && pg.total ? num(pg.total) : items.length,
    totalPages: pg && pg.totalPages ? num(pg.totalPages) : 1,
    items: items
  };
}

async function doSearch(ctx, input) {
  const kw = txt(input.kw, 30);
  if (!kw) throw new Error('搜索词是空的');
  const page = Math.max(1, num(input.page, 1));
  const url = BASE + '/api/search/result/?query=' + encodeURIComponent(kw) + '&page=' + page;
  const raw = await fetchText(url);
  let d = null;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    throw new Error('红果搜索返回的不是 JSON（可能需要验证）');
  }
  const list = d.searchList || [];
  const items = list.map(function (it) {
    const vd = it.video_data || {};
    vd.name = vd.series_title || it.name;
    return shape(vd);
  }).filter(function (x) { return x.id && x.title; });
  return {
    kind: 'list',
    route: 'search',
    routeLabel: '搜索：' + kw,
    kw: kw,
    page: page,
    total: num(d.totalCount),
    totalPages: num(d.totalPages, 1),
    pageSize: num(d.pageNum) ? items.length : items.length,
    items: items
  };
}

async function doDetail(ctx, input) {
  const sid = txt(input.sid, 40);
  if (!sid) throw new Error('缺少 series_id');
  const url = BASE + '/detail?series_id=' + encodeURIComponent(sid);
  const html = await fetchText(url);
  const data = routerData(html);
  if (!data) throw new Error('红果详情页结构变了，没找到 _ROUTER_DATA');
  const sd = dig(data.loaderData, 'seriesDetail');
  if (!sd) throw new Error('详情页里没有 seriesDetail');
  const base = shape(sd);
  const vids = Array.isArray(sd.vid_list) ? sd.vid_list : [];
  return {
    kind: 'detail',
    item: base,
    ep: base.ep || vids.length,
    playable: base.playable,
    tags: base.tags,
    intro: txt(sd.series_intro, 400),
    episodeText: txt(sd.episode_right_text, 30)
  };
}

export async function run(ctx, input) {
  const inp = input || {};
  const action = String(inp.action || 'list');
  const key = action + ':' + String(inp.route || '') + ':' + String(inp.page || 1) + ':' + String(inp.kw || inp.sid || '');
  let out = null;
  if (action === 'search') out = await doSearch(ctx, inp);
  else if (action === 'detail') out = await doDetail(ctx, inp);
  else out = await doList(ctx, inp);

  out.at = Date.now();
  out.key = key;
  await writeKV(ctx, 'hgq', out);
  try {
    await ctx.task.log('红果 ' + action + ' · ' + (out.items ? out.items.length + ' 条' : '详情 1 条') + ' · ' + key);
  } catch (e) { /* 日志失败不影响结果 */ }
  return { key: key, action: action, count: out.items ? out.items.length : 1 };
}

export async function recover() {
  return { done: true };
}
