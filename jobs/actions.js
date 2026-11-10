/**
 * 下载提交作业
 *
 * 唯一有副作用的外部写操作，因此：
 *   - 请求前写检查点，请求后写结果检查点；
 *   - recover 只核对，不重发；无法确认是否已提交时返回 attention，等人工核对。
 */

/**
 * 解析下载器名称。
 * 宿主 /api/pt/download 只接受 downloader=<名称>（字符串），传 id 或 downloader_id 都会被忽略，
 * 然后回退到「默认下载器」，没设默认就直接 400「未配置可用的 PT 下载器」。
 */
async function resolveDownloaderName(ctx, src) {
  const direct = String((src && src.downloader) || '').trim();
  if (direct) return direct;
  const id = src && src.downloader_id;
  if (id === null || id === undefined || id === '') return '';
  try {
    const res = await ctx.api.get('/api/pt/downloaders');
    const arr = (res && (res.data || res.items || res)) || [];
    const hit = (Array.isArray(arr) ? arr : []).filter(function (d) {
      return d && String(d.id) === String(id);
    })[0];
    return hit ? String(hit.name || '').trim() : '';
  } catch (e) {
    await ctx.task.log('查询下载器名称失败：' + String((e && e.message) || e));
    return '';
  }
}

/**
 * 把宿主的原始报错翻译成用户看得懂的话。
 * 宿主会把这些错误整段抛出来（含整页 HTML），直接显示在页面上没法看。
 */
function friendlyError(msg, downloaderName) {
  const raw = String(msg || '');
  const name = downloaderName || '所选下载器';
  if (/not a torrent|<!DOCTYPE|<html|解析种子文件失败/i.test(raw)) {
    return '站点没有返回种子文件：' + name + ' 这边还没收到 torrent，通常是该 PT 站点的 Cookie 已失效或被风控。请到 DIAN115 → PT 设置里重新填写这个站点的 Cookie，再回来重试。';
  }
  if (/未配置可用的\s*PT\s*下载器/i.test(raw)) {
    return '宿主没认出下载器「' + name + '」。请到「广场设置」里重新选择一次下载器（下载器改过名需要重选）。';
  }
  if (/state_uncertain|未能确认本次请求/i.test(raw)) {
    return '宿主没能确认任务是否已建立（可能已加入，也可能没有）。请到 ' + name + ' 里核对；若列表里没有，多半是站点 Cookie 失效导致种子文件下载失败。';
  }
  if (/401|403|login|登录页|未登录|权限/i.test(raw)) {
    return 'PT 站点拒绝了这次请求（登录失效或权限不足）。请到 DIAN115 → PT 设置里更新该站点 Cookie。';
  }
  return raw.length > 220 ? raw.slice(0, 220) + '…' : raw;
}

export async function submit(ctx, input) {
  const src = input || {};
  const download_url = String(src.download_url || '').trim();
  const info_hash = String(src.info_hash || '').trim();

  if (!download_url && !info_hash) {
    throw new Error('缺少 download_url 或 info_hash，无法定位种子');
  }

  // 下载器一律由用户手动指定：不再依赖宿主的「默认下载器」标记
  const downloaderName = await resolveDownloaderName(ctx, src);
  if (!downloaderName) {
    throw new Error('未指定下载器：请先在短剧广场的「广场设置」里手动选择一个下载器，保存后会一直使用它');
  }

  const payload = { site_id: Number(src.site_id) || undefined, downloader: downloaderName };
  if (download_url) payload.download_url = download_url;
  if (info_hash) payload.info_hash = info_hash;

  await ctx.task.update({
    stage: 'submit',
    message: '提交到下载器 ' + downloaderName,
    progress: 12
  });

  // 请求前落检查点：一旦崩溃，recover 会因无法确认而要求人工核对，绝不重发。
  await ctx.task.checkpoint({ stage: 'before-submit', payload, title: src.title || '' });

  let result;
  try {
    result = await ctx.api.post('/api/pt/download', payload);
  } catch (e) {
    const msg = String((e && (e.data && e.data.error)) || (e && e.message) || e);
    throw new Error(friendlyError(msg, downloaderName));
  }

  // 宿主对「加种失败」也返回 200，需看 data.success，否则会把失败当成功
  const data = (result && result.data) || {};
  if (data && data.success === false) {
    throw new Error(friendlyError(data.error || '下载器拒绝了该种子', downloaderName));
  }

  // 结果未知：请求已发出但宿主无法确认。不报成功、不重发，交给用户核对。
  if (data && data.state_uncertain === true) {
    await ctx.task.update({ stage: 'attention', message: '提交结果未知，请到下载器核对' });
    await ctx.task.checkpoint({ stage: 'before-submit', payload, title: src.title || '', uncertain: true });
    await ctx.task.log('宿主返回 state_uncertain：已发出但结果未知，未标记为成功，请到下载器核对');
    return { submitted: false, uncertain: true, result };
  }

  await ctx.task.update({ stage: 'done', message: '已加入下载队列', progress: 100 });
  await ctx.task.checkpoint({ stage: 'submitted', result, title: src.title || '' });

  try {
    await ctx.notify({
      level: 'success',
      title: '短剧广场 · 下载已提交',
      body: `${src.title ? '《' + src.title + '》\n' : ''}已加入下载队列。`,
      dedupe_key: String(ctx.task.id) + ':submit'
    });
  } catch (e) {
    await ctx.task.log('通知发送失败（不影响下载）：' + String((e && e.message) || e));
  }

  return { submitted: true, result };
}

export async function recover(ctx, checkpoint) {
  if (checkpoint && checkpoint.stage === 'submitted') {
    return { action: 'complete', result: { submitted: true, result: checkpoint.result } };
  }
  if (checkpoint && checkpoint.stage === 'before-submit') {
    // 请求可能已发出但结果未记录，宿主下载器无稳定回查标识，交给人工核对。
    await ctx.task.log('中断发生在提交过程中，无法确认是否已加入下载队列，需人工核对');
    return { action: 'attention' };
  }
  return { action: 'resume' };
}
