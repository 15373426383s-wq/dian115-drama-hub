/**
 * 订阅巡检 / 自动追新
 *
 * 两件事：
 *   1. 自动追新：解析种子标题里的集数，只下「比已追集数更新」的种子；全集下完即标记完成，不再消耗检索次数。
 *   2. 调度：多站点并行、单站点串行、命中即停。
 *
 * 提速口径（关键）：
 *   - 每次检索只打「一个」站点，不再一次打全部站点。打全部站点等于一次消耗所有站点额度，
 *     还得等最慢的那个冷却完，订阅一多就排到明天。
 *   - 不同站点各有一个空闲时刻，谁先空谁领下一部，所以 M 个站点就是 M 路并行。
 *     总吞吐 ≈ M / 间隔，而不是 1 / 间隔。
 *   - 一部订阅先问命中率最高的站点；没搜到才流转到下一个站点，最多问「每部查站」个。
 *     有资源的情况只花 1 次请求，「全部问一遍」这种浪费不存在。
 *
 * 防风控口径（全部可配）：
 *   - 单站两次检索之间至少隔 ptInterval 秒，并叠加 ptJitter% 抖动（固定节奏本身就是机器特征）；
 *   - 单站每次最多发 1 个请求，绝不并发打同一个站；
 *   - 每站每天最多 ptDaily 次，到顶即剔除；
 *   - 连续检索失败的站点本次运行直接停用，并按指数退避，避免把失效 Cookie 反复往站点上撞；
 *   - 连续没搜到新集的订阅，下次间隔自动拉长（最多到基础间隔的 3 倍），把额度省给正在更新的剧。
 *
 * 只调用宿主自有的 PT / 通知接口：不读写宿主文件、不读 Cookie、不外发数据。
 */

const MAX_SUBS = 100;
const MAX_DONE = 120;
const HOUR = 3600 * 1000;
const MIN_GAP = 5;      // 单站两次检索的物理下限（秒）
const FAIL_BASE = 45;   // 站点连续失败的退避基数（秒）
const FAIL_MAX = 600;   // 单站失败退避上限（秒）
const SCORE_DECAY = 400; // 命中率样本超过这个数就整体减半，让统计跟着站点实际情况走

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

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** 只有 free / 2xfree 算免费，50% 不算 */
function isFree(t) {
  if (!t) return false;
  const ft = String(t.free_type || '').toLowerCase();
  if (ft === 'free' || ft === '2xfree' || ft === 'free2x') return true;
  const df = Number(t.download_factor);
  return Number.isFinite(df) && df === 0;
}

function freeText(t) {
  if (!isFree(t)) return '非免费';
  return Number(t.upload_factor) >= 2 ? '2x免费' : '免费';
}

function dayKey(ts) {
  const d = new Date(ts || Date.now());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + g;
}

function torKey(t) {
  return String(t && t.site_id) + ':' + String(t && t.torrent_id);
}

/** 站点得分：命中率的贝叶斯平滑，样本少时不会被 0/0 带偏 */
function siteScore(stat) {
  const ok = Number(stat && stat.ok) || 0;
  const hit = Number(stat && stat.hit) || 0;
  return (hit + 0.6) / (ok + 1.2);
}

/**
 * 从标题解析集数。
 * 支持：全 80 集 / 80集全 / 第12集 / 第12-14集 / 更新至12集 / EP12 / E12 / S01E12 / EP12-14
 * 返回 { has, maxEp, total }
 */
function parseEps(title) {
  const s = String(title || '');
  let total = 0;
  let maxEp = 0;
  let has = false;

  // 全集总数：全80集 / 80集全 / 共80集 / (80集)
  let m = /全\s*(\d{1,4})\s*集/.exec(s)
    || /共\s*(\d{1,4})\s*集/.exec(s)
    || /[（(]\s*(\d{1,4})\s*集\s*[)）]/.exec(s)
    || /(\d{1,3})\s*集\s*(?:全|完)/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n > 0 && n <= 999) { total = n; maxEp = Math.max(maxEp, n); has = true; }
  }

  // 第 12 集 / 第 12-14 集
  const re1 = /第\s*(\d{1,3})\s*(?:[-~—－至到]\s*(\d{1,3})\s*)?集/g;
  while ((m = re1.exec(s))) {
    const a = Number(m[1]);
    if (!(a > 0 && a <= 999)) continue;
    const b = m[2] ? Number(m[2]) : 0;
    maxEp = Math.max(maxEp, a, b > 0 && b <= 999 ? b : 0);
    has = true;
  }

  // 更新至 12 集
  m = /更新(?:至|到)\s*(\d{1,3})\s*集/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n > 0 && n <= 999) { maxEp = Math.max(maxEp, n); has = true; }
  }

  // EP12 / E12 / S01E12 / EP12-14
  const re2 = /(?:^|[^A-Za-z0-9])(?:S\d{1,2})?E(?:P)?\s*(\d{1,3})(?:\s*[-~—]\s*E?(\d{1,3}))?/gi;
  while ((m = re2.exec(s))) {
    const a = Number(m[1]);
    if (!(a > 0 && a <= 999)) continue;
    const b = m[2] ? Number(m[2]) : 0;
    maxEp = Math.max(maxEp, a, b > 0 && b <= 999 ? b : 0);
    has = true;
  }

  // 兜底：标题里裸的「80集」（<=999 已排除 2024 这类年份）
  if (!has) {
    m = /(\d{1,4})\s*集/.exec(s);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n <= 999) { maxEp = n; has = true; }
    }
  }

  return { has: has, maxEp: maxEp, total: total };
}

/** 给候选打分：集数优先，其次免费、做种数、体积小 */
function better(a, b) {
  if (!b) return true;
  if (a.ep.maxEp !== b.ep.maxEp) return a.ep.maxEp > b.ep.maxEp;
  if (a.free !== b.free) return a.free;
  if (a.seeders !== b.seeders) return a.seeders > b.seeders;
  return a.size < b.size;
}

function pickBest(torrents, sub, onlyFree, autoNew) {
  const done = Array.isArray(sub.done) ? sub.done : [];
  const curEp = Number(sub.ep) || 0;
  let best = null;
  for (let i = 0; i < torrents.length; i++) {
    const t = torrents[i];
    if (!t) continue;
    if (done.indexOf(torKey(t)) >= 0) continue;
    const free = isFree(t);
    if (onlyFree && !free) continue;
    const seeders = Number(t.seeders) || 0;
    if (seeders <= 0) continue;

    const info = parseEps(t.title);
    if (autoNew) {
      // 追新模式：只接受带新集的种子
      if (info.has) {
        if (info.maxEp <= curEp && !(info.total > curEp)) continue;
      } else if (curEp > 0 || sub.got) {
        // 标题里没有集数信息的老种：已经下过就别再重复下，否则会每轮都下一遍
        continue;
      }
    } else if (sub.got) {
      // 非追新模式：下过一次就停
      continue;
    }

    const cand = { t: t, ep: info, free: free, seeders: seeders, size: Number(t.size) || 0 };
    if (better(cand, best)) best = cand;
  }
  return best;
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/** 单站单关键词检索：只打一个站点，失败不抛，交给上层决定退避 */
async function searchOne(ctx, siteId, keyword) {
  try {
    const res = await ctx.api.post('/api/pt/search', { keyword: keyword, site_ids: [siteId], page: 1 });
    const data = (res && res.data) || res || {};
    // 宿主失败也可能返 200，这里当失败处理，交给上层换站或退避
    if (data && data.success === false) {
      return { ok: false, error: new Error(String(data.error || data.message || '站点检索失败')) };
    }
    return { ok: true, torrents: (data && data.torrents) || [] };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export async function run(ctx, input) {
  const manual = !!(input && input.manual);
  const prefs = (await readKV(ctx, 'prefs', {})) || {};
  const rawSubs = await readKV(ctx, 'subs', []);
  const list = Array.isArray(rawSubs) ? rawSubs.slice(0, MAX_SUBS) : [];

  if (!list.length) {
    await ctx.task.log('订阅列表为空，跳过巡检');
    return { subs: 0, searched: 0, downloaded: 0 };
  }

  // ---- 配置 ----
  // 老配置一次性升级到并行调度：原来「一次只打一轮、每轮等 60 秒」的口径，
  // 改成每站 20 秒一次（3 次/分钟，仍比人手点搜索稀疏）+ 多站各跑一路。
  if (!prefs.cfgVer) {
    const old = Number(prefs.ptInterval);
    if (old === 60 || old === 30) prefs.ptInterval = 20;
    prefs.cfgVer = 2;
  }

  const onlyFree = prefs.onlyFree !== false;
  const auto = prefs.subAuto !== false;
  const autoNew = prefs.autoNew !== false;
  const interval = clamp(prefs.ptInterval === undefined ? 20 : prefs.ptInterval, MIN_GAP, 3600);
  const jitter = clamp(prefs.ptJitter === undefined ? 30 : prefs.ptJitter, 0, 80);
  const dailyCap = Math.max(0, Number(prefs.ptDaily) || 0);
  const subHours = clamp(prefs.subInterval === undefined ? 6 : prefs.subInterval, 1, 168);
  // subBudget 单位是「分钟」（与设置面板一致），这里换算成秒
  const budget = clamp(prefs.subBudget === undefined ? 10 : prefs.subBudget, 1, 30) * 60;
  const perRun = Math.max(0, Number(prefs.subsPerRun) || 0);
  const fanPref = clamp(prefs.subFan === undefined ? 2 : prefs.subFan, 1, 5);

  const downloaderId = prefs.downloaderId ? Number(prefs.downloaderId) : null;
  // 宿主 /api/pt/download 只接受 downloader=<名称>，传 id 会被忽略并回退默认下载器
  let downloaderName = String(prefs.downloaderName || '').trim();

  const sitesRes = await ctx.api.get('/api/pt/sites');
  const sitesRaw = (sitesRes && (sitesRes.items || sitesRes.data)) || sitesRes || [];
  const allSites = (Array.isArray(sitesRaw) ? sitesRaw : []).filter(function (s) {
    return s && s.enabled && s.search_enabled !== false;
  });

  if (downloaderId && !downloaderName) {
    try {
      const dres = await ctx.api.get('/api/pt/downloaders');
      const darr = (dres && (dres.data || dres.items || dres)) || [];
      const hit = (Array.isArray(darr) ? darr : []).filter(function (d) {
        return d && String(d.id) === String(downloaderId);
      })[0];
      if (hit) downloaderName = String(hit.name || '').trim();
    } catch (e) {
      await ctx.task.log('查询下载器名称失败：' + String((e && e.message) || e));
    }
  }
  if (auto && !downloaderName) {
    await ctx.task.log('未指定下载器：本次只巡检不下载。请在短剧广场 →「广场设置」里手动选择一个下载器，保存后会一直使用它。');
  }

  // ---- 站点池：每站独立空闲时刻，各自节流 ----
  const today = dayKey();
  const usage = Object.assign({}, prefs.ptUsage || {});
  const score = Object.assign({}, prefs.ptScore || {});

  const dayCount = function (id) {
    const u = usage[id];
    return u && u.day === today ? Number(u.count) || 0 : 0;
  };

  const pool = [];
  for (let i = 0; i < allSites.length; i++) {
    const s = allSites[i];
    if (!s || s.id === undefined || s.id === null) continue;
    if (dailyCap > 0 && dayCount(s.id) >= dailyCap) continue;
    // 站点自带限速（若有）优先于用户设置，避免把站点惹毛
    const siteGap = clamp(s.limit_interval, 0, 3600);
    pool.push({
      id: s.id,
      name: String(s.name || ('#' + s.id)),
      gap: Math.max(interval, siteGap, MIN_GAP),
      nextFree: 0,
      fails: 0,
      dead: false,
      stat: score[s.id] || null
    });
  }

  // 命中率高的站先被问到，减少「问一圈才搜到」的浪费
  pool.sort(function (a, b) { return siteScore(b.stat) - siteScore(a.stat); });

  // ---- 到期队列：没查过的优先，其次最久未查 ----
  const now0 = Date.now();
  const due = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || !String(s.name || '').trim()) continue;
    if (s.complete) continue;
    if (s.autoNew === false && s.got) continue;
    if (!manual && Number(s.nextAt) > now0) continue;
    due.push({ idx: i, at: Number(s.last) || 0 });
  }
  due.sort(function (a, b) { return a.at - b.at; });

  const sliced = perRun > 0 ? due.slice(0, perRun) : due;

  await ctx.task.update({
    stage: 'subs',
    message: '到期 ' + sliced.length + ' 部 / 共 ' + list.length + ' 部 · 并行站点 ' + pool.length + ' 个',
    total: sliced.length,
    done: 0,
    failed: 0
  });

  if (!sliced.length) {
    const pending = list.filter(function (s) {
      return s && !s.complete && !(s.autoNew === false && s.got);
    });
    if (!pending.length) {
      await ctx.task.log('全部订阅已追完，不再消耗检索次数');
      return { subs: list.length, searched: 0, downloaded: 0, due: 0 };
    }
    let nextAt = 0;
    for (let i = 0; i < pending.length; i++) {
      const n = Number(pending[i].nextAt) || 0;
      if (!n) continue;
      if (!nextAt || n < nextAt) nextAt = n;
    }
    const waitMin = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 60000)) : 0;
    await ctx.task.log('当前没有到期订阅' + (waitMin ? '，约 ' + waitMin + ' 分钟后陆续到期' : ''));
    return { subs: list.length, searched: 0, downloaded: 0, due: 0 };
  }

  if (!pool.length) {
    await ctx.task.log('没有可用站点（未启用或今日已达访问上限）');
    return { subs: list.length, searched: 0, downloaded: 0, blocked: true };
  }

  // ---- 调度状态 ----
  const maxTries = Math.max(1, Math.min(fanPref, pool.length));
  const queue = [];
  for (let i = 0; i < sliced.length; i++) queue.push({ idx: sliced[i].idx, tried: [], claim: false });

  const budgetEnd = Date.now() + budget * 1000;
  let searched = 0;   // 实际发出的检索请求数
  let downloaded = 0;
  let hits = 0;
  let noDl = 0;
  let subsDone = 0;   // 处理完的订阅数
  let stopReason = '';
  let lastBeat = Date.now();

  const aliveSites = function () {
    const out = [];
    for (let i = 0; i < pool.length; i++) if (!pool[i].dead) out.push(pool[i]);
    return out;
  };

  const untried = function (job, alive) {
    for (let i = 0; i < alive.length; i++) {
      if (job.tried.indexOf(alive[i].id) < 0) return true;
    }
    return false;
  };

  // 收尾一部订阅：算下次到期时间并落状态
  const finish = function (job, sub, kind) {
    subsDone += 1;
    if (!sub) return;
    if (kind === 'fail' || kind === 'attention') {
      sub.last = Date.now();
      sub.nextAt = sub.last + 30 * 60 * 1000;
      return;
    }
    // 连续没搜到新集就拉长间隔（最多 3 倍），把额度省给正在更新的剧
    const miss = kind === 'miss' ? (Number(sub.miss) || 0) + 1 : 0;
    sub.miss = miss;
    sub.last = Date.now();
    const factor = miss > 0 ? Math.min(3, 1 + miss * 0.4) : 1;
    const jit = 1 + (Math.random() * 2 - 1) * (jitter / 100);
    sub.nextAt = sub.last + Math.round(subHours * HOUR * factor * jit);
  };

  // 领活：只领「本批还没被领走、且没试过本站」的任务，保证同一部不在一批里被两个站重复搜
  const takeJob = function (site) {
    for (let i = 0; i < queue.length; i++) {
      const j = queue[i];
      if (j.claim) continue;
      if (j.tried.indexOf(site.id) >= 0) continue;
      if (j.tried.length >= maxTries) continue;
      queue.splice(i, 1);
      j.claim = true;
      return j;
    }
    return null;
  };

  const requeue = function (job) {
    job.claim = false;
    const alive = aliveSites();
    if (job.tried.length >= maxTries || !untried(job, alive)) {
      finish(job, list[job.idx], 'miss');
      return;
    }
    // 放队头：没搜到的先流转给「还没问过的站点」，
    // 已经试过的站点会自动跳过它去领新任务，相当于天然的第二问优先、新任务并行
    queue.unshift(job);
  };

  // 清掉「已经没有站点能再试」的残留任务，否则循环会空转
  const prune = function () {
    const alive = aliveSites();
    // 一个站点都用不了（全停用/全到上限）时不要动队列：
    // 这些订阅根本没被检索过，标记成「无新集」会白白等一整个重查周期
    if (!alive.length) return;
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i];
      if (j.tried.length >= maxTries || !untried(j, alive)) {
        queue.splice(i, 1);
        finish(j, list[j.idx], 'miss');
      }
    }
  };

  // 首轮错峰起跑，避免所有站点在同一毫秒一起发请求
  for (let i = 0; i < pool.length; i++) {
    pool[i].nextFree = now0 + Math.round(Math.random() * pool[i].gap * 400);
  }

  // 宿主限制单次运行最多 32 个并发宿主调用；一批就是一个并发，这里硬性封顶。
  const MAX_BATCH = 32;
  while (queue.length) {
    if (Date.now() >= budgetEnd) { stopReason = 'budget'; break; }
    const alive = aliveSites();
    if (!alive.length) { stopReason = 'sites'; break; }

    const now = Date.now();
    const ready = alive.filter(function (p) { return p.nextFree <= now; })
      .sort(function (a, b) { return a.nextFree - b.nextFree; });

    const batch = [];
    for (let i = 0; i < ready.length; i++) {
      if (batch.length >= MAX_BATCH) break;
      const site = ready[i];
      if (dailyCap > 0 && dayCount(site.id) >= dailyCap) { site.dead = true; continue; }
      const job = takeJob(site);
      if (!job) continue;
      batch.push({ site: site, job: job });
    }

    if (!batch.length) {
      prune();
      if (!queue.length) break;
      // 没有可发车的：等到最早空闲的那个站点，而不是等最慢的
      const alive2 = aliveSites();
      if (!alive2.length) { stopReason = 'sites'; break; }
      let earliest = 0;
      for (let i = 0; i < alive2.length; i++) {
        const t = alive2[i].nextFree;
        if (!earliest || t < earliest) earliest = t;
      }
      const wait = Math.max(50, earliest - Date.now());
      if (Date.now() + wait >= budgetEnd) { stopReason = 'budget'; break; }
      await delay(Math.min(wait + 20, 3000));
      continue;
    }

    // 并发发车：每站每批最多 1 个请求，站内绝不并发
    const ps = [];
    for (let i = 0; i < batch.length; i++) {
      // query 是给 PT 站用的检索词（漫剧会去掉「动态漫 / AI漫剧版」后缀），name 只用于展示
      const nameI = String(list[batch[i].job.idx].query || list[batch[i].job.idx].name || '').trim();
      ps.push(searchOne(ctx, batch[i].site.id, nameI));
    }

    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      const site = b.site;
      const job = b.job;
      const sub = list[job.idx];
      const name = String(sub.name || '').trim();

      let r;
      try { r = await ps[i]; } catch (e) { r = { ok: false, error: e }; }

      job.tried.push(site.id);

      // 站点节流：本次之后按 gap ± jitter 排下一次
      const baseMs = site.gap * 1000;
      const jit = 1 + (Math.random() * 2 - 1) * (jitter / 100);
      site.nextFree = Date.now() + Math.round(baseMs * jit);

      if (!r.ok) {
        site.fails += 1;
        site.nextFree = Date.now() + Math.min(FAIL_MAX, FAIL_BASE * Math.pow(2, site.fails - 1)) * 1000;
        const msg = String((r.error && (r.error.data && r.error.data.error)) || (r.error && r.error.message) || r.error || '未知错误');
        if (site.fails >= 3) {
          site.dead = true;
          await ctx.task.log('「' + site.name + '」连续检索失败，本次运行暂停使用它：' + msg.slice(0, 80));
        }
        sub.lastResult = '检索失败：' + (msg.length > 28 ? msg.slice(0, 28) + '…' : msg);
        job.claim = false;
        // 失败也算「问过这个站」，避免同一个坏站点被反复撞
        const aliveNow = aliveSites();
        if (!aliveNow.length || job.tried.length >= maxTries || !untried(job, aliveNow)) {
          finish(job, sub, 'fail');
        } else {
          queue.unshift(job);
        }
        continue;
      }

      searched += 1;
      const ts = Date.now();
      const day = dayKey(ts);
      const cur = usage[site.id] && usage[site.id].day === day ? usage[site.id] : { day: day, count: 0, last: 0 };
      usage[site.id] = { day: day, count: (Number(cur.count) || 0) + 1, last: ts };

      const st = site.stat || { ok: 0, hit: 0 };
      st.ok = (Number(st.ok) || 0) + 1;
      site.stat = st;
      score[site.id] = st;

      const torrents = r.torrents || [];
      const best = pickBest(torrents, sub, onlyFree, autoNew && sub.autoNew !== false);

      if (!best) {
        sub.lastResult = torrents.length
          ? '无新集（' + site.name + ' ' + torrents.length + ' 条）'
          : '暂无资源（' + site.name + '）';
        job.claim = false;
        requeue(job);
        continue;
      }

      hits += 1;
      st.hit = (Number(st.hit) || 0) + 1;
      score[site.id] = st;

      if (!auto) {
        sub.lastResult = '发现' + freeText(best.t) + (best.ep.has ? '（第' + best.ep.maxEp + '集）' : '') + '，自动下载已关闭';
        job.claim = false;
        finish(job, sub, 'hit');
        continue;
      }
      if (!downloaderName) {
        sub.lastResult = '发现' + freeText(best.t) + '种，但未指定下载器';
        noDl += 1;
        job.claim = false;
        finish(job, sub, 'hit');
        continue;
      }

      const payload = { site_id: Number(best.t.site_id) || undefined, downloader: downloaderName };
      if (best.t.download_url) payload.download_url = String(best.t.download_url);
      if (best.t.info_hash) payload.info_hash = String(best.t.info_hash);

      await ctx.task.checkpoint({ stage: 'before-submit', sub: name, payload: payload });

      let submitOk = false;
      try {
        const res = await ctx.api.post('/api/pt/download', payload);
        const data = (res && res.data) || {};
        if (data && data.success === false) {
          throw new Error(String(data.error || '下载器拒绝了该种子'));
        }
        // 宿主可能返回 state_uncertain：请求已发出但结果未知。此时不推进集数、不标记 complete，
        // 也不把种子记进 done（下一轮仍会重试），只把订阅标成需要核对。
        if (data && data.state_uncertain === true) {
          sub.lastResult = '已提交，但宿主返回结果未知，请到下载器核对';
          await ctx.task.log('「' + name + '」提交结果未知（state_uncertain），未推进进度');
          job.claim = false;
          finish(job, sub, 'attention');
          continue;
        }
        submitOk = true;
        // 成功后记进度：集数只增不减，全集下完即停
        if (best.ep.has) {
          sub.ep = Math.max(Number(sub.ep) || 0, best.ep.maxEp);
          if (best.ep.total) sub.total = Math.max(Number(sub.total) || 0, best.ep.total);
          if (Number(sub.total) > 0 && Number(sub.ep) >= Number(sub.total)) sub.complete = true;
        }
        sub.got = true;
        const done = Array.isArray(sub.done) ? sub.done : [];
        done.push(torKey(best.t));
        sub.done = done.slice(-MAX_DONE);
        sub.lastResult = '已下载 ' + freeText(best.t) + (best.ep.has ? ' · 追至第' + best.ep.maxEp + '集' : '') + ' · ↑' + (best.seeders || 0);
        downloaded += 1;
        await ctx.task.log('「' + name + '」已提交：' + String(best.t.title || '').slice(0, 40));
      } catch (e) {
        const msg = String((e && (e.data && e.data.error)) || (e && e.message) || e);
        // 订阅行只放一句短的，完整原因写进作业日志
        const brief = /not a torrent|<!DOCTYPE|<html|解析种子文件失败/i.test(msg)
          ? '站点 Cookie 失效，拿不到种子文件'
          : /未配置可用的\s*PT\s*下载器/i.test(msg)
            ? '宿主没认出下载器 ' + downloaderName
            : (msg.length > 32 ? msg.slice(0, 32) + '…' : msg);
        sub.lastResult = '提交失败：' + brief;
        await ctx.task.log('「' + name + '」提交失败：' + msg);
      }

      job.claim = false;
      finish(job, sub, submitOk ? 'hit' : 'fail');
    }

    // 每批落一次盘：崩了最多丢一批
    prefs.ptUsage = usage;
    // 命中率样本过多就整体减半，让统计跟着站点实际情况走，不至于被半年前的数据主导
    for (const k in score) {
      const it = score[k];
      if (it && Number(it.ok) > SCORE_DECAY) {
        score[k] = { ok: Math.round(Number(it.ok) / 2), hit: Math.round((Number(it.hit) || 0) / 2) };
      }
    }
    prefs.ptScore = score;
    await writeKV(ctx, 'subs', list);
    await writeKV(ctx, 'prefs', prefs);

    await ctx.task.update({
      stage: 'subs',
      message: '已处理 ' + subsDone + '/' + sliced.length + ' 部 · 检索 ' + searched + ' 次 · 下载 ' + downloaded + ' 部',
      total: sliced.length,
      done: subsDone,
      failed: 0
    });

    if (Date.now() - lastBeat > 30000) {
      lastBeat = Date.now();
      await ctx.task.log('进度 ' + subsDone + '/' + sliced.length + ' · 剩余 ' + queue.length + ' 部 · 已发 ' + searched + ' 次检索（' + aliveSites().length + ' 站并行）');
    }
  }

  // 循环退出时可能还有没处理完的
  prune();
  const skipped = queue.length;

  prefs.ptUsage = usage;
  prefs.ptScore = score;
  prefs.subLastRun = Date.now();
  prefs.subLastSummary = { searched: searched, downloaded: downloaded, at: Date.now(), subsDone: subsDone, sites: pool.length };
  await writeKV(ctx, 'subs', list);
  await writeKV(ctx, 'prefs', prefs);

  if (stopReason === 'budget') {
    await ctx.task.log('单次预算用尽：本次处理 ' + subsDone + ' 部，剩余 ' + skipped + ' 部留到下次（已保存断点）');
  } else if (stopReason === 'sites') {
    await ctx.task.log('所有站点今日访问次数已达上限或全部停用，剩余 ' + skipped + ' 部留到下次');
  }

  await ctx.task.update({
    stage: 'done',
    message: '处理 ' + subsDone + ' 部 · 检索 ' + searched + ' 次 · 下载 ' + downloaded + ' 部',
    progress: 100
  });

  // 只在新下载、或用户手动触发时才打扰，避免每 10 分钟一条通知
  if (downloaded > 0 || manual) {
    try {
      await ctx.notify({
        level: downloaded ? 'success' : 'info',
        format: 'markdown',
        title: downloaded ? '短剧广场 · 已自动追新 ' + downloaded + ' 部' : '短剧广场 · 订阅巡检完成',
        body: [
          '**订阅巡检**',
          '- 处理：' + subsDone + ' 部（到期 ' + sliced.length + ' 部 / 共 ' + list.length + ' 部）',
          '- 检索：' + searched + ' 次 · 并行站点 ' + pool.length + ' 个',
          '- 新下载：' + downloaded + ' 部',
          '- 自动追新：' + (autoNew ? '开（只下新集）' : '关'),
          '- 仅免费种：' + (onlyFree ? '是（free / 2xfree）' : '否'),
          noDl ? '- ⚠ 有 ' + noDl + ' 部命中免费种但未指定下载器，请到「广场设置」里选一个' : '',
          skipped ? '- 剩余 ' + skipped + ' 部未处理，下次运行继续' : ''
        ].filter(Boolean).join('\n'),
        dedupe_key: String(ctx.task.id) + ':subs'
      });
    } catch (e) {
      await ctx.task.log('通知发送失败（不影响下载）：' + String((e && e.message) || e));
    }
  }

  return {
    subs: list.length,
    due: sliced.length,
    searched: searched,
    downloaded: downloaded,
    hits: hits,
    subsDone: subsDone,
    noDownloader: noDl,
    skipped: skipped,
    sites: pool.length,
    stop: stopReason || 'drained'
  };
}

// 恢复：提交途中的中断无法确认是否已加入下载队列，按宿主契约要求人工核对，绝不自动重发。
export async function recover(ctx, checkpoint) {
  if (checkpoint && (checkpoint.stage === 'before-submit' || checkpoint.uncertain)) {
    await ctx.task.log('上次运行中断在提交过程中，无法确认是否已提交，请到下载器核对');
    return { action: 'attention' };
  }
  return { action: 'resume' };
}
