/**
 * 每日短剧速递
 *
 * 定时把热播 / 短剧精选 / 新上线整理成一条 markdown 通知，走宿主已配置的通知渠道。
 * 不请求任何第三方地址，榜单来自宿主 TMDB 代理。
 */

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function todayLabel() {
  const d = new Date();
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

async function fetchList(ctx, path) {
  const d = await ctx.api.get(path);
  const list = Array.isArray(d) ? d : (d && d.results) || [];
  return list.filter(function (x) {
    return x && x.id && (!x.media_type || x.media_type === 'tv');
  });
}

function line(item, idx) {
  const name = item.name || item.original_name || '未命名';
  const score = Number(item.vote_average || 0);
  const year = item.first_air_date ? String(item.first_air_date).slice(0, 4) : '';
  const bits = [];
  if (score > 0) bits.push('★ ' + score.toFixed(1));
  if (year) bits.push(year);
  const tail = bits.length ? '（' + bits.join(' · ') + '）' : '';
  return (idx ? idx + '. ' : '- ') + name + tail;
}

export async function run(ctx, input) {
  const manual = !!(input && input.manual);
  const limit = Number((input && input.limit) || 5);
  await ctx.task.update({ stage: 'fetch', message: '拉取榜单', progress: 10 });

  let hot = [];
  let shorts = [];
  let fresh = [];

  await ctx.task.update({ stage: 'fetch', message: '读取热播榜', progress: 25 });
  try {
    hot = await fetchList(ctx, '/api/tmdb/trending?media_type=tv&time_window=week');
  } catch (e) {
    await ctx.task.log('热播榜读取失败：' + String((e && e.message) || e));
  }

  await ctx.task.update({ stage: 'fetch', message: '读取短剧精选', progress: 45 });
  try {
    const a = await fetchList(ctx, '/api/tmdb/search?q=' + encodeURIComponent('短剧') + '&page=1');
    const b = await fetchList(ctx, '/api/tmdb/search?q=' + encodeURIComponent('微短剧') + '&page=1');
    const seen = {};
    const merged = [];
    for (const x of a.concat(b)) {
      if (seen[x.id]) continue;
      seen[x.id] = 1;
      merged.push(x);
    }
    shorts = merged;
  } catch (e) {
    await ctx.task.log('短剧精选读取失败：' + String((e && e.message) || e));
  }

  await ctx.task.update({ stage: 'fetch', message: '读取新上线', progress: 65 });
  try {
    fresh = await fetchList(ctx, '/api/tmdb/discover/tv?sort_by=first_air_date.desc&page=1');
  } catch (e) {
    await ctx.task.log('新上线读取失败：' + String((e && e.message) || e));
  }

  let libLine = '';
  try {
    const lib = await ctx.storage.get('library');
    const snap = lib && lib.value !== undefined ? lib.value : lib;
    if (snap && snap.count) {
      libLine = '\n**片库现况**：' + snap.count + ' 部 / ' + (snap.episodes || 0) + ' 集已入库。\n';
    }
  } catch (e) { /* 片库快照缺失不影响速递 */ }

  const parts = [];
  parts.push('**短剧速递 · ' + todayLabel() + '**');

  if (hot.length) {
    parts.push('\n**🔥 热播**');
    parts.push(hot.slice(0, limit).map(function (x, i) { return line(x, i + 1); }).join('\n'));
  }
  if (shorts.length) {
    parts.push('\n**🎬 短剧精选**');
    parts.push(shorts.slice(0, Math.max(3, limit - 1)).map(function (x, i) { return line(x, i + 1); }).join('\n'));
  }
  if (fresh.length) {
    parts.push('\n**🆕 新上线**');
    parts.push(fresh.slice(0, Math.max(3, limit - 1)).map(function (x, i) { return line(x, i + 1); }).join('\n'));
  }

  if (!hot.length && !shorts.length && !fresh.length) {
    await ctx.task.log('三个榜单都没有数据，跳过发送');
    return { sent: false, reason: 'no-data' };
  }

  parts.push(libLine);
  parts.push('\n在「短剧广场」可查看详情并从 PT 站点检索资源。');

  let body = parts.join('\n');
  if (body.length > 3300) body = body.slice(0, 3300) + '\n…';

  await ctx.task.update({ stage: 'notify', message: '发送速递', progress: 88 });

  let deliveries = [];
  try {
    const res = await ctx.notify({
      level: 'info',
      title: manual ? '短剧速递 · 手动推送' : '短剧速递 · ' + todayLabel(),
      body: body,
      format: 'markdown',
      dedupe_key: String(ctx.task.id) + ':digest'
    });
    if (res && res.deliveries) deliveries = res.deliveries;
  } catch (e) {
    await ctx.task.log('通知发送失败：' + String((e && e.message) || e));
    throw new Error('通知发送失败：' + String((e && e.message) || e));
  }

  await ctx.task.update({ stage: 'done', message: '已发送', progress: 100 });
  return {
    sent: true,
    hot: hot.length,
    shorts: shorts.length,
    fresh: fresh.length,
    deliveries: deliveries
  };
}
