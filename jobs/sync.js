/**
 * 片库同步作业
 *
 * 只读 Emby 剧集库的条目总数（Series / Episode），写进插件自有存储供页面与速递使用。
 * 注意：宿主 emby/items 的 limit 上限是 50，超过会返回 400，所以这里只用 limit=1 取 total。
 * 不写宿主文件、不改 Emby 数据。
 */

async function readPrefs(ctx) {
  try {
    const raw = await ctx.storage.get('prefs');
    if (!raw) return {};
    if (typeof raw === 'object' && raw.value !== undefined) return raw.value || {};
    return raw;
  } catch (e) {
    return {};
  }
}

export async function run(ctx, input) {
  const prefs = await readPrefs(ctx);
  const wanted = Array.isArray(prefs.libraryIds) ? prefs.libraryIds : [];

  await ctx.task.update({ stage: 'libraries', message: '读取 Emby 剧集库', progress: 8 });

  const libRes = await ctx.api.get('/api/plugin-host/emby/libraries');
  const all = (libRes && libRes.items) || [];
  const tvLibs = all.filter(function (l) { return l.type === 'tvshows'; });
  const useLibs = wanted.length
    ? tvLibs.filter(function (l) { return wanted.indexOf(l.id) >= 0; })
    : tvLibs;

  if (!useLibs.length) {
    await ctx.task.log('没有可用的剧集库');
    await ctx.storage.set('library', { at: Date.now(), count: 0, episodes: 0, libraries: 0 });
    return { count: 0, episodes: 0, libraries: 0 };
  }

  let count = 0;
  let episodes = 0;
  let done = 0;

  await ctx.task.update({
    stage: 'scan',
    message: '共 ' + useLibs.length + ' 个剧集库',
    total: useLibs.length,
    done: 0,
    failed: 0
  });

  for (const lib of useLibs) {
    const base = '/api/plugin-host/emby/items?library_id=' + encodeURIComponent(lib.id) + '&limit=1&type=';
    try {
      const s = await ctx.api.get(base + 'Series');
      count += Number((s && s.total) || 0);
    } catch (e) {
      await ctx.task.log('库「' + lib.name + '」剧集数读取失败：' + String((e && e.message) || e));
    }
    try {
      const e2 = await ctx.api.get(base + 'Episode');
      episodes += Number((e2 && e2.total) || 0);
    } catch (e) {
      await ctx.task.log('库「' + lib.name + '」集数读取失败：' + String((e && e.message) || e));
    }
    done += 1;
    await ctx.task.update({
      stage: 'scan',
      message: '已处理 ' + done + ' / ' + useLibs.length + ' 个库',
      total: useLibs.length,
      done: done,
      failed: 0
    });
  }

  await ctx.storage.set('library', {
    at: Date.now(),
    count: count,
    episodes: episodes,
    libraries: useLibs.length
  });

  await ctx.task.update({ stage: 'done', message: count + ' 部 / ' + episodes + ' 集', progress: 100 });
  return { count: count, episodes: episodes, libraries: useLibs.length };
}
