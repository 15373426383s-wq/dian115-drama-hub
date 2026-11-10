/**
 * 短剧广场 · 页面
 *
 * 数据来源全部走本机 DIAN115 宿主接口（ctx.api）：
 *   - TMDB 代理：发现 / 搜索剧集
 *   - Emby：我的片库概览
 *   - PT：站点资源检索、下载器列表
 *   - 通知：每日速递（由后台作业发送）
 *
 * 关于海报：封面图直接引用 TMDB 官方图片 CDN（image.tmdb.org），
 * 与宿主自带的 TMDB 元数据接口同源，只用于展示封面，不携带任何凭据与 Cookie；
 * 图挂了会自动回退到本地程序化生成的渐变封面。
 *
 * 刻意不做的三件事（红线）：
 *   1. 不新开任何第三方接口做数据上报 / 埋点 / 遥测；
 *   2. 不读写宿主文件、不硬编码任何目录；
 *   3. 不读取 Cookie / CookieCloud，不携带任何凭据。
 */

const PALETTES = [
  ['#ff5f6d', '#ff8a3d'],
  ['#7b5cff', '#4facfe'],
  ['#00c2a8', '#3ad6a0'],
  ['#f857a6', '#ff5858'],
  ['#5b8def', '#7f6bff'],
  ['#ff9966', '#ffcc70'],
  ['#11998e', '#38ef7d'],
  ['#c471f5', '#fa71cd'],
  ['#2b5876', '#4e4376'],
  ['#ff6a88', '#ff99ac']
];

/**
 * 红果式频道。
 * TMDB 没有「短剧」这个品类，所以按短剧标题里的高频特征词检索，
 * 再用 isDrama() 做「中文 + 有海报 + 近三年 + 非综艺」四重过滤。
 */
const CHANNELS = [
  { id: 'pick', label: '精选', hint: '热点混排 · 闪婚团宠逆袭', kw: ['团宠', '闪婚', '赘婿', '真千金', '豪婿', '甜宠'], pages: 2 },
  // 漫剧：动态漫/AI漫剧在 TMDB 只靠关键词召回，且标题必带「动态漫 / AI漫剧版」之类的后缀，
  // 所以这里每个词单独给页数，并要求标题命中特征词才算数，避免「漫剧」这个词带回来的噪音。
  { id: 'manju', label: '漫剧', hint: 'AI漫剧 · 动态漫 · 漫改', plan: [['动态漫', 4], ['动态漫画', 3], ['漫剧', 5], ['AI漫剧', 2]], only: 'manju', minYear: 2021, allowNoYear: true },
  // 红果：TMDB 对短剧收录滞后且不全，这里直接读红果的公开目录（真人剧/漫剧/AI剧），
  // 片名与集数以站点为准，找完再回 PT 搜同名资源。只取元数据，不取播放流。
  { id: 'hg', label: '红果', hint: '真人剧 · 漫剧 · AI剧 · 实时集数', src: 'hg' },
  { id: 'marry', label: '闪婚', hint: '闪婚 · 先婚后爱 · 契约', kw: ['闪婚', '先婚后爱', '契约'] },
  { id: 'sweet', label: '甜宠', hint: '甜宠 · 宠妻 · 娇宠', kw: ['甜宠', '宠妻', '娇宠', '甜妻'] },
  { id: 'counter', label: '逆袭', hint: '赘婿 · 打脸 · 豪婿', kw: ['赘婿', '打脸', '逆袭', '豪婿'], pages: 2 },
  { id: 'rebirth', label: '重生', hint: '重生 · 逆天 · 炮灰', kw: ['重生', '逆天', '炮灰'] },
  { id: 'cross', label: '穿越', hint: '穿越 · 王妃 · 医妃', kw: ['穿越', '王妃', '医妃'] },
  { id: 'ancient', label: '古装', hint: '古装 · 王爷 · 嫡女', kw: ['古装', '王爷', '嫡女'], pages: 2 },
  { id: 'period', label: '年代', hint: '七零 · 八零 · 后妈', kw: ['七零', '八零', '年代', '后妈'] },
  { id: 'tycoon', label: '豪门', hint: '首富 · 财阀 · 神豪', kw: ['首富', '财阀', '神豪', '真千金'] },
  { id: 'family', label: '团宠', hint: '团宠 · 萌宝 · 双宝', kw: ['团宠', '萌宝', '双宝'] },
  { id: 'doctor', label: '医仙', hint: '医仙 · 医妃 · 逆天神医', kw: ['医仙', '医妃', '逆天神医'] },
  { id: 'suspense', label: '悬疑', hint: '谜案 · 诡事 · 探案', kw: ['谜案', '诡事', '探案', '悬疑'], pages: 2 },
  { id: 'cultivate', label: '修仙', hint: '修仙 · 玄幻 · 系统', kw: ['修仙', '玄幻', '系统'] },
  { id: 'chase', label: '追妻', hint: '追妻 · 虐恋 · 白月光', kw: ['追妻', '虐恋', '白月光'] },
  { id: 'revenge', label: '复仇', hint: '打脸 · 反派 · 嫡女', kw: ['打脸', '反派', '嫡女'] },
  { id: 'subs', label: '订阅', hint: '自动巡检 · 只下免费种', kw: [] },
  { id: 'mine', label: '我的片库', hint: '来自 Emby 剧集库' }
];

// 命中这些词的一定不是短剧
const NOT_DRAMA = ['综艺', '盛典', '颁奖', '晚会', '大会', '真人秀', '纪录片', '开播吧', '脱口秀', '访谈', '发布会', '演唱会', '花絮', '解说'];
const MIN_YEAR = 2023;

// 漫剧判定：TMDB 上这类条目全叫「XX 动态漫」「XX AI漫剧版」，标题里没这几个词的一律不收，
// 否则「漫剧」这个关键词会把真人短剧、日语动画、外国电影一起带进来。
const MANJU_FEAT = ['漫剧', '动态漫', '动态漫画'];

// 少儿早教类，哪怕命中特征词也不是要看的东西
const KID_NOISE = ['早教', '儿歌', '启蒙', '绘本', '车车', '益智', '识字', '拼音', '英语', '动画课堂'];

/**
 * 把片名还原成「PT 站上真正会这么写」的检索词。
 * 漫剧在 TMDB 里的名字一定带后缀（如「万古第一神 动态漫」），直接拿去搜 PT 几乎搜不到，
 * 所以去掉这类尾部标记再检索。普通短剧不含这些词，原样返回。
 */
const cleanPTName = (s) => {
  const raw = String(s || '').trim();
  let t = raw
    .replace(/[\s·・\-—_~～]+(动态漫画|动态漫|AI漫剧版|ai漫剧版|漫剧版|漫剧)\s*$/i, '')
    .replace(/[\s·・\-—_~～]+$/, '')
    .trim();
  // 剪完太短就可能剪坏了（比如名字本身就叫「漫剧」），这时宁可按原名搜
  return t.length >= 2 ? t : raw;
};

const CSS = `
.dh-root{--dh-radius:18px;--dh-brand:linear-gradient(135deg,#ff5f6d 0%,#ff8a3d 100%);
  --dh-bg:#f5f6fa;--dh-panel:#ffffff;--dh-panel2:#f0f2f8;--dh-text:#171922;--dh-muted:#727a8c;
  --dh-line:#e6e9f2;--dh-shadow:0 10px 30px rgba(23,25,34,.08);--dh-shadow-lg:0 22px 60px rgba(23,25,34,.16);
  --dh-green:#12a150;--dh-gold:#f6b73c;--dh-blue:#3b82f6;--dh-purple:#8b5cf6;
  position:relative;width:100%;min-height:100%;box-sizing:border-box;color:var(--dh-text);
  background:var(--dh-bg);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;overflow-x:hidden}
.dh-root.dh-dark{--dh-bg:#0f1116;--dh-panel:#171a21;--dh-panel2:#1f232c;--dh-text:#eceff7;--dh-muted:#98a0b3;
  --dh-line:#272b36;--dh-shadow:0 10px 30px rgba(0,0,0,.4);--dh-shadow-lg:0 22px 60px rgba(0,0,0,.6)}
.dh-root *{box-sizing:border-box}
.dh-root button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.dh-root input,.dh-root select{font-family:inherit}
.dh-wrap{max-width:1560px;margin:0 auto;padding:26px 30px 70px}

/* ---------- 顶栏 ---------- */
.dh-hero{position:relative;border-radius:26px;padding:26px 30px;overflow:hidden;
  background:linear-gradient(120deg,#1b1d27 0%,#2a2233 45%,#3a2130 100%);color:#fff;box-shadow:var(--dh-shadow-lg)}
.dh-dark .dh-hero{background:linear-gradient(120deg,#191c25 0%,#241d2e 45%,#2f1c29 100%)}
.dh-hero:before{content:"";position:absolute;width:520px;height:520px;right:-140px;top:-260px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,95,109,.55),transparent 62%);filter:blur(8px)}
.dh-hero:after{content:"";position:absolute;width:420px;height:420px;right:120px;bottom:-300px;border-radius:50%;
  background:radial-gradient(circle,rgba(123,92,255,.45),transparent 62%)}
.dh-hero-in{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:22px;flex-wrap:wrap}
.dh-brand{display:flex;align-items:center;gap:16px}
.dh-logo{width:58px;height:58px;border-radius:18px;background:var(--dh-brand);display:flex;align-items:center;justify-content:center;
  box-shadow:0 10px 26px rgba(255,95,109,.42);flex:0 0 auto}
.dh-logo svg{width:32px;height:32px}
.dh-title{margin:0;font-size:26px;font-weight:800;letter-spacing:.5px;line-height:1.2}
.dh-sub{margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.72);letter-spacing:.3px}
.dh-pills{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dh-pill{display:flex;align-items:center;gap:8px;padding:9px 15px;border-radius:14px;font-size:12.5px;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(10px);color:rgba(255,255,255,.9)}
.dh-pill b{font-size:15px;font-weight:700;color:#fff}
.dh-dot{width:7px;height:7px;border-radius:50%;background:#3ad6a0;box-shadow:0 0 0 3px rgba(58,214,160,.22)}
.dh-dot.warn{background:#ffb020;box-shadow:0 0 0 3px rgba(255,176,32,.22)}
.dh-dot.off{background:#8a8f9c;box-shadow:0 0 0 3px rgba(138,143,156,.18)}
.dh-icon-btn{width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);transition:.18s}
.dh-icon-btn:hover{background:rgba(255,255,255,.22);transform:translateY(-1px)}

/* ---------- 工具条 ---------- */
.dh-toolbar{display:flex;align-items:center;gap:12px 14px;margin:24px 0 18px;flex-wrap:wrap}
.dh-search{position:relative;flex:1 1 320px;max-width:520px}
.dh-search input{width:100%;height:48px;border-radius:15px;border:1px solid var(--dh-line);background:var(--dh-panel);
  padding:0 46px 0 46px;font-size:14px;color:var(--dh-text);outline:none;transition:.18s;box-shadow:var(--dh-shadow)}
.dh-search input:focus{border-color:#ff8a3d;box-shadow:0 0 0 4px rgba(255,138,61,.14)}
.dh-search .dh-s-ico{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:var(--dh-muted)}
.dh-search .dh-s-clear{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:28px;height:28px;
  border-radius:9px;display:none;align-items:center;justify-content:center;color:var(--dh-muted)}
.dh-search.has .dh-s-clear{display:flex}
.dh-search .dh-s-clear:hover{background:var(--dh-panel2)}
.dh-chips{display:flex;gap:9px;flex-wrap:wrap;flex:1 1 100%;order:9}
.dh-chip{height:42px;padding:0 17px;border-radius:13px;font-size:13px;font-weight:600;color:var(--dh-muted);
  background:var(--dh-panel);border:1px solid var(--dh-line);transition:.18s;display:flex;align-items:center;gap:7px}
.dh-chip:hover{color:var(--dh-text);transform:translateY(-1px);box-shadow:var(--dh-shadow)}
.dh-chip.on{background:var(--dh-brand);color:#fff;border-color:transparent;box-shadow:0 8px 22px rgba(255,95,109,.3)}
.dh-root.dh-dark .dh-chip{background:#1b1f28;border-color:#2d3340;color:#b9c1d1}
.dh-root.dh-dark .dh-chip:hover{background:#232935;color:#fff;border-color:#3a4152}
.dh-root.dh-dark .dh-chip.on{background:var(--dh-brand);color:#fff;border-color:transparent}
.dh-chip .dh-c-badge{font-size:11px;padding:1px 6px;border-radius:7px;background:rgba(0,0,0,.08)}
.dh-chip.on .dh-c-badge{background:rgba(255,255,255,.24)}
.dh-btn-ghost{height:42px;padding:0 16px;border-radius:13px;border:1px solid var(--dh-line);background:var(--dh-panel);
  font-size:13px;font-weight:600;color:var(--dh-text);display:flex;align-items:center;gap:7px;transition:.18s}
.dh-btn-ghost:hover{transform:translateY(-1px);box-shadow:var(--dh-shadow)}

/* ---------- 概览 ---------- */
.dh-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:14px;margin-bottom:22px}
.dh-stat{background:var(--dh-panel);border:1px solid var(--dh-line);border-radius:var(--dh-radius);padding:16px 18px;
  box-shadow:var(--dh-shadow);position:relative;overflow:hidden}
.dh-stat:after{content:"";position:absolute;right:-24px;top:-24px;width:78px;height:78px;border-radius:50%;
  background:var(--dh-brand);opacity:.1}
.dh-stat .k{font-size:12px;color:var(--dh-muted);letter-spacing:.4px}
.dh-stat .v{font-size:25px;font-weight:800;margin-top:6px;letter-spacing:.5px}
.dh-stat .v small{font-size:12px;font-weight:600;color:var(--dh-muted);margin-left:4px}

/* ---------- 区块标题 ---------- */
.dh-sec{display:flex;align-items:baseline;gap:12px;margin:26px 0 14px}
.dh-sec h3{margin:0;font-size:17px;font-weight:800;letter-spacing:.3px}
.dh-sec span{font-size:12.5px;color:var(--dh-muted)}

/* ---------- 卡片网格 ---------- */
.dh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(166px,1fr));gap:16px}

/* 焦点大图（红果式首屏） */
.dh-feature{position:relative;border-radius:22px;overflow:hidden;margin-bottom:20px;min-height:236px;
  display:flex;align-items:flex-end;box-shadow:var(--dh-shadow-lg);background:#12141b;color:#fff;cursor:pointer}
.dh-feature .fg-bg{position:absolute;inset:0;background-size:cover;background-position:center 24%;z-index:0;
  filter:blur(20px) saturate(1.2);transform:scale(1.18)}
.dh-feature .fg-tint{position:absolute;inset:0;z-index:1;
  background:linear-gradient(90deg,rgba(9,11,17,.95) 0%,rgba(9,11,17,.78) 44%,rgba(9,11,17,.16) 100%)}
.dh-feature .fg-in{position:relative;z-index:2;padding:26px 28px;max-width:60%}
.dh-feature .fg-k{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:20px;
  font-size:11.5px;font-weight:700;letter-spacing:.6px;background:var(--dh-brand);margin-bottom:12px}
.dh-feature .fg-t{font-size:25px;font-weight:800;line-height:1.3;letter-spacing:.2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 3px 18px rgba(0,0,0,.55)}
.dh-feature .fg-m{margin-top:10px;font-size:12.5px;color:rgba(255,255,255,.82);display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.dh-feature .fg-m b{color:var(--dh-gold);font-weight:800}
.dh-feature .fg-ov{margin-top:11px;font-size:12.8px;line-height:1.62;color:rgba(255,255,255,.7);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:520px}
.dh-feature .fg-btns{margin-top:16px;display:flex;gap:10px}
.dh-feature .fg-btns .dh-btn{flex:0 0 auto;padding:0 22px;min-width:116px;height:42px;border-radius:12px}
.dh-feature .fg-btns .dh-btn.sec{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.24)}
.dh-feature .fg-btns .dh-btn.sec:hover{background:rgba(255,255,255,.2);box-shadow:none}
.dh-feature .fg-poster{position:absolute;right:30px;bottom:28px;width:132px;aspect-ratio:2/3;border-radius:14px;z-index:2;
  background-size:cover;background-position:center;box-shadow:0 20px 44px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.16)}

/* 热播榜 */
.dh-rank{margin-bottom:22px}
.dh-rank-h{display:flex;align-items:baseline;gap:10px;margin:0 0 12px}
.dh-rank-h h4{margin:0;font-size:15px;font-weight:800;letter-spacing:.2px}
.dh-rank-h span{font-size:12px;color:var(--dh-muted)}
.dh-rankrow{display:grid;grid-template-columns:repeat(auto-fill,minmax(186px,1fr));gap:12px}
.dh-rk{display:flex;gap:10px;align-items:center;background:var(--dh-panel);border:1px solid var(--dh-line);
  border-radius:14px;padding:9px;cursor:pointer;transition:.18s;box-shadow:var(--dh-shadow);overflow:hidden}
.dh-rk:hover{transform:translateY(-3px);box-shadow:var(--dh-shadow-lg)}
.dh-rk .n{font-size:20px;font-weight:900;font-style:italic;width:22px;text-align:center;flex:0 0 auto;
  color:var(--dh-muted);font-family:"DIN Alternate",Impact,-apple-system,sans-serif}
.dh-rk:nth-child(1) .n{color:#ff3b5c}
.dh-rk:nth-child(2) .n{color:#ff8a3d}
.dh-rk:nth-child(3) .n{color:#f6b73c}
.dh-rk .th{width:44px;height:62px;border-radius:9px;flex:0 0 auto;background-size:cover;background-position:center;
  background-color:var(--dh-panel2)}
.dh-rk .tx{min-width:0}
.dh-rk .nm{font-size:12.5px;font-weight:700;line-height:1.42;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.dh-rk .sc{font-size:11px;color:var(--dh-muted);margin-top:5px}
@media (max-width:880px){
  .dh-feature .fg-poster{display:none}
  .dh-feature .fg-in{max-width:100%;padding:20px}
  .dh-feature .fg-t{font-size:20px}
}
.dh-card{background:var(--dh-panel);border:1px solid var(--dh-line);border-radius:var(--dh-radius);overflow:hidden;
  box-shadow:var(--dh-shadow);transition:transform .22s cubic-bezier(.2,.7,.3,1),box-shadow .22s;cursor:pointer;position:relative}
.dh-card:hover{transform:translateY(-6px);box-shadow:var(--dh-shadow-lg)}
/* 红果式竖版海报卡：2:3 真实海报，无图时回退渐变+首字 */
.dh-cover{position:relative;aspect-ratio:2/3;overflow:hidden;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(155deg,#3a3f4d,#22252e)}
.dh-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:2;
  transition:transform .38s cubic-bezier(.2,.7,.3,1),opacity .2s}
.dh-card:hover .dh-poster{transform:scale(1.045)}
.dh-poster.dh-off{opacity:0}
.dh-cover .dh-cg{position:absolute;inset:0}
.dh-cover .dh-noise{position:absolute;inset:0;opacity:.5;
  background-image:radial-gradient(rgba(255,255,255,.28) .5px,transparent .5px);background-size:4px 4px}
.dh-cover .dh-streak{position:absolute;width:150%;height:60%;left:-25%;top:-20%;transform:rotate(-18deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.24),transparent);filter:blur(10px)}
.dh-cover .dh-glyph{position:relative;font-size:62px;font-weight:900;color:rgba(255,255,255,.94);
  text-shadow:0 8px 26px rgba(0,0,0,.32);letter-spacing:2px}
.dh-cover .dh-vlabel{position:absolute;left:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:5px;padding:0 9px;writing-mode:vertical-rl;font-size:10.5px;letter-spacing:3px;
  color:rgba(255,255,255,.5);font-weight:700;text-transform:uppercase}
.dh-cover .dh-score{position:absolute;left:10px;bottom:10px;display:flex;align-items:center;gap:4px;z-index:3;
  padding:4px 9px;border-radius:9px;background:rgba(0,0,0,.58);backdrop-filter:blur(8px);
  font-size:12px;font-weight:700;color:#ffd166}
.dh-cover .dh-ep{position:absolute;right:10px;top:10px;padding:4px 9px;border-radius:9px;font-size:11.5px;font-weight:700;
  background:rgba(255,255,255,.92);color:#1b1d27;z-index:3}
.dh-card .dh-body{padding:12px 13px 14px}
.dh-card .dh-name{font-size:13.5px;font-weight:700;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden;min-height:38px}
.dh-card .dh-meta{margin-top:7px;font-size:11.5px;color:var(--dh-muted);display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.dh-card .dh-tag{padding:1px 7px;border-radius:7px;background:var(--dh-panel2);font-size:10.5px;font-weight:600}
.dh-card .dh-hover{position:absolute;left:0;right:0;bottom:0;padding:12px;display:flex;gap:8px;transform:translateY(110%);
  transition:.24s cubic-bezier(.2,.7,.3,1);background:linear-gradient(transparent,rgba(0,0,0,.62))}
.dh-card:hover .dh-hover{transform:none}
.dh-mini{flex:1;height:34px;border-radius:10px;background:rgba(255,255,255,.94);color:#1b1d27;
  font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:5px;transition:.16s}
.dh-mini:hover{background:#fff;transform:translateY(-1px)}
.dh-mini.ghost{background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.4)}

/* ---------- 骨架 & 空态 ---------- */
.dh-skel{border-radius:var(--dh-radius);background:var(--dh-panel);border:1px solid var(--dh-line);overflow:hidden}
.dh-skel .s1{aspect-ratio:3/4;background:linear-gradient(100deg,var(--dh-panel2) 30%,var(--dh-line) 50%,var(--dh-panel2) 70%);
  background-size:220% 100%;animation:dh-sh 1.3s infinite}
.dh-skel .s2{height:13px;margin:13px;border-radius:6px;background:var(--dh-panel2)}
.dh-skel .s3{height:11px;margin:0 13px 15px;width:56%;border-radius:6px;background:var(--dh-panel2)}
@keyframes dh-sh{0%{background-position:120% 0}100%{background-position:-20% 0}}
.dh-empty{grid-column:1/-1;padding:64px 20px;text-align:center;color:var(--dh-muted);border:1px dashed var(--dh-line);
  border-radius:22px;background:var(--dh-panel)}
.dh-empty .e1{font-size:40px;margin-bottom:12px;opacity:.55}
.dh-empty .e2{font-size:14px;font-weight:600;color:var(--dh-text);margin-bottom:6px}
.dh-empty .e3{font-size:12.5px;line-height:1.7}

/* ---------- 抽屉 ---------- */
.dh-mask{position:fixed;inset:0;background:rgba(10,12,18,.5);backdrop-filter:blur(3px);z-index:60;
  opacity:0;pointer-events:none;transition:.24s}
.dh-mask.on{opacity:1;pointer-events:auto}
.dh-drawer{position:fixed;top:0;right:0;bottom:0;width:min(468px,94vw);background:var(--dh-panel);z-index:61;
  box-shadow:-24px 0 70px rgba(0,0,0,.28);transform:translateX(102%);transition:transform .3s cubic-bezier(.2,.8,.3,1);
  display:flex;flex-direction:column}
.dh-drawer.on{transform:none}
.dh-d-head{position:relative;padding:22px 22px 18px;color:#fff;overflow:hidden;flex:0 0 auto}
.dh-d-head .dh-cg{position:absolute;inset:0}
.dh-d-head .dh-noise{position:absolute;inset:0;opacity:.45;
  background-image:radial-gradient(rgba(255,255,255,.3) .5px,transparent .5px);background-size:4px 4px}
.dh-d-head .inner{position:relative}
.dh-d-title{font-size:20px;font-weight:800;line-height:1.35;margin:0 0 5px}
.dh-d-orig{font-size:12px;color:rgba(255,255,255,.66);margin-bottom:11px}
.dh-d-facts{display:flex;gap:8px;flex-wrap:wrap}
.dh-fact{padding:4px 10px;border-radius:9px;font-size:11.5px;font-weight:600;
  background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.2)}
.dh-close{position:absolute;right:14px;top:14px;width:32px;height:32px;border-radius:10px;display:flex;
  align-items:center;justify-content:center;background:rgba(255,255,255,.18);color:#fff;z-index:2}
.dh-close:hover{background:rgba(255,255,255,.3)}
.dh-d-body{flex:1;overflow-y:auto;padding:18px 22px 26px}
.dh-d-body::-webkit-scrollbar{width:7px}
.dh-d-body::-webkit-scrollbar-thumb{background:var(--dh-line);border-radius:5px}
.dh-ov{font-size:13px;line-height:1.82;color:var(--dh-muted);margin:0 0 18px}
.dh-actions{display:flex;gap:10px;margin-bottom:22px}
.dh-btn{flex:1;height:44px;border-radius:13px;background:var(--dh-brand);color:#fff;font-size:13.5px;font-weight:700;
  display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 8px 22px rgba(255,95,109,.28);transition:.18s}
.dh-btn:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(255,95,109,.36)}
.dh-btn:disabled{opacity:.6;cursor:default;transform:none}
.dh-btn.sec{background:var(--dh-panel2);color:var(--dh-text);box-shadow:none;border:1px solid var(--dh-line)}
.dh-btn.sec:hover{box-shadow:var(--dh-shadow)}
.dh-res-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}
.dh-res-head h4{margin:0;font-size:13.5px;font-weight:800}
.dh-res-head span{font-size:11.5px;color:var(--dh-muted)}
.dh-res{display:flex;flex-direction:column;gap:9px}
.dh-tor{border:1px solid var(--dh-line);border-radius:13px;padding:12px 13px;background:var(--dh-panel2);transition:.16s}
.dh-tor:hover{border-color:#ffb08a;background:var(--dh-panel)}
.dh-tor .t1{font-size:12.5px;font-weight:700;line-height:1.5;margin-bottom:8px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dh-tor .t2{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11px;color:var(--dh-muted)}
.dh-badge{padding:2px 7px;border-radius:7px;font-weight:700;font-size:10.5px}
.dh-badge.free{background:rgba(18,161,80,.14);color:#12a150}
.dh-badge.ratio{background:rgba(139,92,246,.14);color:#8b5cf6}
.dh-badge.hr{background:rgba(255,176,32,.16);color:#c98a00}
.dh-badge.site{background:rgba(59,130,246,.13);color:#3b82f6}
.dh-badge.half{background:rgba(114,122,140,.16);color:var(--dh-muted)}
.dh-badge.free2x{background:rgba(18,161,80,.18);color:#0e8a44}

/* 防风控参数 */
.dh-2col{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dh-3col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.dh-num{display:flex;align-items:center;gap:8px;border:1px solid var(--dh-line);border-radius:12px;
  background:var(--dh-panel2);padding:0 12px;height:44px;font-size:12px;color:var(--dh-muted)}
.dh-num span{flex:0 0 auto;font-weight:600;color:var(--dh-text)}
.dh-num input{flex:1;min-width:0;border:0;background:transparent;font-size:13px;font-weight:700;
  color:var(--dh-text);outline:none;text-align:right}
.dh-num em{font-style:normal;flex:0 0 auto}
.dh-usage{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-top:8px;
  font-size:11.5px;color:var(--dh-muted);line-height:1.6}

/* 订阅列表 */
.dh-subrow{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--dh-line);
  border-radius:13px;background:var(--dh-panel);margin-bottom:10px;box-shadow:var(--dh-shadow)}
.dh-subrow .si{width:40px;height:56px;border-radius:9px;flex:0 0 auto;background-size:cover;background-position:center;background-color:var(--dh-panel2)}
.dh-subrow .st{flex:1;min-width:0}
.dh-subrow .sn{font-size:13px;font-weight:700;line-height:1.4;display:flex;align-items:center;gap:8px;min-width:0}
.dh-subrow .sn .snt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dh-subrow .sm{font-size:11px;color:var(--dh-muted);margin-top:5px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dh-subrow .sa{display:flex;gap:7px;flex:0 0 auto}
.dh-mini2{height:30px;padding:0 11px;border-radius:9px;font-size:11.5px;font-weight:700;border:1px solid var(--dh-line);
  background:var(--dh-panel2);color:var(--dh-text);cursor:pointer;transition:.16s}
.dh-mini2:hover{border-color:#ffb08a}
.dh-mini2.danger{color:#e8503f}
.dh-subhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;
  font-size:12.5px;color:var(--dh-muted);flex-wrap:wrap;line-height:1.6}
.dh-subhead b{color:var(--dh-text);font-weight:800}
.dh-cap{margin-top:10px;padding:9px 12px;border-radius:11px;font-size:11.5px;line-height:1.7;
  background:rgba(59,130,246,.08);color:#3b82f6;border:1px solid rgba(59,130,246,.16)}
.dh-fbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.dh-fchip{height:30px;padding:0 12px;border-radius:9px;font-size:11.5px;font-weight:700;cursor:pointer;
  border:1px solid var(--dh-line);background:var(--dh-panel2);color:var(--dh-muted);transition:.16s;
  display:inline-flex;align-items:center;gap:6px}
.dh-fchip:hover{color:var(--dh-text);border-color:#ffb08a}
.dh-fchip.on{background:var(--dh-brand);color:#fff;border-color:transparent}
.dh-fchip i{font-style:normal;font-size:10.5px;opacity:.85}
.dh-hgtabs{display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 16px}
.dh-pager{display:flex;gap:10px;align-items:center;justify-content:center;margin:22px 0 6px}
.dh-pager button{height:34px;padding:0 15px;border-radius:10px;border:1px solid var(--dh-line);background:var(--dh-panel2);color:var(--dh-text);font-size:12.5px;font-weight:700;cursor:pointer;transition:.16s}
.dh-pager button:hover:not(:disabled){border-color:#ffb08a}
.dh-pager button:disabled{opacity:.38;cursor:default}
.dh-pager span{font-size:12px;color:var(--dh-muted);min-width:96px;text-align:center}
.dh-ep2{position:absolute;left:9px;top:9px;z-index:2;padding:2px 8px;border-radius:7px;background:rgba(0,0,0,.62);color:#fff;font-size:10.5px;font-weight:700;backdrop-filter:blur(4px)}
.dh-ep{flex:0 0 auto;padding:1px 7px;border-radius:6px;font-size:10.5px;font-weight:700;vertical-align:1px;
  background:rgba(255,95,109,.12);color:var(--dh-brand);white-space:nowrap}
.dh-ep.done{background:rgba(34,197,94,.13);color:#16a34a}
.dh-mini2.off{color:var(--dh-muted);opacity:.62}
.dh-mini2.on{color:#16a34a;border-color:rgba(34,197,94,.4)}
.dh-tor .t3{display:flex;align-items:center;justify-content:space-between;margin-top:10px;gap:10px}
.dh-tor .t3 .sz{font-size:11.5px;font-weight:700;color:var(--dh-text)}
.dh-tor .t3 .sz em{font-style:normal;color:var(--dh-muted);font-weight:600;margin-left:6px}
.dh-dl{height:30px;padding:0 13px;border-radius:9px;background:var(--dh-text);color:var(--dh-panel);
  font-size:11.5px;font-weight:700;transition:.16s}
.dh-dl:hover{opacity:.86;transform:translateY(-1px)}
.dh-dl:disabled{opacity:.5;cursor:default;transform:none}

/* ---------- 设置 ---------- */
.dh-modal{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;padding:24px}
.dh-modal.on{display:flex}
.dh-modal .box{width:min(560px,100%);max-height:86vh;overflow-y:auto;background:var(--dh-panel);border-radius:22px;
  box-shadow:var(--dh-shadow-lg);padding:0 24px 20px;position:relative}
.dh-m-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:14px;
  background:var(--dh-panel);padding:22px 0 10px;margin:0 0 4px}
.dh-modal h3{margin:0;font-size:18px;font-weight:800;flex:1 1 auto;min-width:0}
.dh-m-x:hover{background:rgba(128,128,128,.26);color:var(--dh-text)}
.dh-m-x:active{transform:scale(.94)}
.dh-m-x:focus-visible{outline:2px solid #ff7a45;outline-offset:2px}
.dh-modal .m-sub{margin:0 0 20px;font-size:12.5px;color:var(--dh-muted)}
.dh-field{margin-bottom:16px}
.dh-field label{display:block;font-size:12.5px;font-weight:700;margin-bottom:7px}
.dh-field .f-help{font-size:11.5px;color:var(--dh-muted);margin-top:6px;line-height:1.6}
.dh-req{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:6px;font-size:10.5px;font-weight:700;
  background:rgba(255,95,109,.14);color:#ff7b88;border:1px solid rgba(255,95,109,.26);vertical-align:1px}
.dh-dlnow{margin-top:8px;padding:9px 12px;border-radius:11px;font-size:12px;line-height:1.55;
  background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.24);color:#8ab4f8;display:flex;
  align-items:center;gap:8px;flex-wrap:wrap}
.dh-dlnow b{color:var(--dh-text);font-weight:800}
.dh-dlnow.warn{background:rgba(255,95,109,.1);border-color:rgba(255,95,109,.24);color:#ff8f99}
.dh-field input[type=text],.dh-field select{width:100%;height:42px;border-radius:12px;border:1px solid var(--dh-line);
  background:var(--dh-panel2);padding:0 12px;font-size:13px;color:var(--dh-text);outline:none}
.dh-field input[type=text]:focus,.dh-field select:focus{border-color:#ff8a3d}
.dh-switch{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border-radius:13px;
  border:1px solid var(--dh-line);background:var(--dh-panel2);margin-bottom:9px}
.dh-switch .sw-k{font-size:12.5px;font-weight:700}
.dh-switch .sw-h{font-size:11px;color:var(--dh-muted);margin-top:3px;line-height:1.5}
.dh-toggle{width:44px;height:25px;border-radius:14px;background:var(--dh-line);position:relative;transition:.18s;flex:0 0 auto}
.dh-toggle:after{content:"";position:absolute;width:19px;height:19px;border-radius:50%;background:#fff;top:3px;left:3px;
  transition:.18s;box-shadow:0 2px 6px rgba(0,0,0,.24)}
.dh-toggle.on{background:linear-gradient(135deg,#ff5f6d,#ff8a3d)}
.dh-toggle.on:after{left:22px}
.dh-sel-list{display:flex;flex-wrap:wrap;gap:8px}
.dh-sel{padding:7px 13px;border-radius:11px;border:1px solid var(--dh-line);background:var(--dh-panel2);
  font-size:12px;font-weight:600;color:var(--dh-muted);transition:.15s}
.dh-sel.on{background:rgba(255,95,109,.12);border-color:#ff8a3d;color:#e8503f}
.dh-sel:disabled{opacity:.42;cursor:not-allowed}
.dh-modal .m-foot{display:flex;gap:10px;margin-top:22px}
.dh-modal .m-foot .dh-btn{flex:1}

/* ---------- Toast ---------- */
.dh-tips{position:fixed;right:22px;bottom:22px;z-index:90;display:flex;flex-direction:column;gap:10px;align-items:flex-end}
.dh-tip{padding:12px 16px;border-radius:13px;background:#1b1d27;color:#fff;font-size:12.5px;font-weight:600;
  box-shadow:0 16px 40px rgba(0,0,0,.3);animation:dh-in .26s cubic-bezier(.2,.8,.3,1);max-width:340px;line-height:1.55}
.dh-tip.ok{background:linear-gradient(135deg,#12a150,#27b56a)}
.dh-tip.err{background:linear-gradient(135deg,#e13b3b,#f0574f)}
.dh-tip.warn{background:linear-gradient(135deg,#c98a00,#e8a421)}
@keyframes dh-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}

@media(max-width:760px){
  .dh-wrap{padding:16px 14px 60px}
  .dh-hero{padding:20px}
  .dh-title{font-size:21px}
  .dh-grid{grid-template-columns:repeat(auto-fill,minmax(144px,1fr));gap:12px}
  .dh-cover .dh-glyph{font-size:46px}
  .dh-drawer{width:100vw}
  .dh-3col{grid-template-columns:1fr 1fr}
  .dh-num span{font-size:11.5px}
}
`;

const ICONS = {
  search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  gear: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9v.1a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/></svg>',
  x: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  bolt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.2c-.4.5 0 1.3.7 1.3H10l-1 7.5 8.5-11.2c.4-.5 0-1.3-.7-1.3H12l1-7.5Z"/></svg>',
  down: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16"/></svg>',
  star: '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 6.6 7.2.9-5.3 4.9 1.4 7.1L12 18l-6.3 3.5L7.1 14.4 1.8 9.5 9 8.6Z"/></svg>',
  bell: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg>',
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5Z"/></svg>'
};

export async function mount(el, ctx) {
  const root = el;
  root.innerHTML = '';
  root.classList.add('dh-root');

  /** ---------- 主题 ---------- */
  const applyTheme = (mode) => root.classList.toggle('dh-dark', mode === 'dark');
  applyTheme(ctx.theme?.mode || 'light');
  let offTheme = null;
  try { offTheme = ctx.theme?.subscribe?.(applyTheme) || null; } catch { offTheme = null; }
  if (ctx.signal && typeof offTheme === 'function') {
    ctx.signal.addEventListener('abort', () => { try { offTheme() } catch {} });
  }

  /** ---------- 样式 ---------- */
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  /** ---------- 状态 ---------- */
  const S = {
    channel: 'pick',
    query: '',
    items: [],
    hgRoute: 'real-drama',
    hgKw: '',
    hgPage: 1,
    hgPages: 1,
    hgTotal: 0,
    hgBusy: false,
    hgCache: {},
    loading: false,
    detail: null,
    torrents: [],
    torrentLoading: false,
    libraries: [],
    downloaders: [],
    sites: [],
    genreMap: {},
    embyOk: false,
    stats: {},
    prefs: {
      downloaderId: null,
      downloaderName: null,
      siteIds: [],
      libraryIds: [],
      digest: true,
      digestHour: 20,
      showEmby: true,
      // 只下载免费种：仅 free / 2xfree，50% 不算
      onlyFree: true,
      // PT 站点风控：每站两次检索最短间隔（秒，叠加随机抖动）、每站每日访问上限
      ptInterval: 20,
      ptJitter: 30,
      ptDaily: 40,
      ptUsage: {},
      ptScore: {},
      // 订阅巡检：每部多久重查一次（小时）、单次运行时间预算（分钟）、每部最多问几个站、单次最多几部（0=不限）
      subInterval: 6,
      subBudget: 10,
      subFan: 2,
      subsPerRun: 0,
      // 自动追新：只下比已追集数更新的种子
      autoNew: true
    },
    subFilter: 'all',
    subs: []
  };

  /** ---------- 存储助手（兼容两种返回形态） ---------- */
  const readKV = async (key, fallback) => {
    try {
      const r = await ctx.storage.get(key);
      if (r === null || r === undefined) return fallback;
      if (typeof r === 'object' && 'value' in r) return r.value ?? fallback;
      return r;
    } catch { return fallback; }
  };
  const writeKV = async (key, value) => {
    try { await ctx.storage.set(key, value); return true; } catch { return false; }
  };

  /** ---------- 骨架 ---------- */
  root.insertAdjacentHTML('beforeend', `
  <div class="dh-wrap">
    <div class="dh-hero">
      <div class="dh-hero-in">
        <div class="dh-brand">
          <div class="dh-logo">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="14" y="14" width="5" height="20" rx="2.5" fill="#fff"/>
              <rect x="29" y="14" width="5" height="20" rx="2.5" fill="#fff" opacity=".55"/>
              <path d="M20 10h10v2.4H20z" fill="#fff" opacity=".85"/>
              <path d="M20 35.6h10V38H20z" fill="#fff" opacity=".4"/>
            </svg>
          </div>
          <div>
            <h1 class="dh-title">短剧广场</h1>
            <p class="dh-sub">发现 · 检索 · 入库 · 速递　一站式短剧中心</p>
          </div>
        </div>
        <div class="dh-pills">
          <div class="dh-pill"><span class="dh-dot" data-k="emby"></span>Emby <b data-k="embyv">—</b></div>
          <div class="dh-pill"><span class="dh-dot" data-k="pt"></span>PT <b data-k="ptv">—</b></div>
          <div class="dh-pill"><span class="dh-dot" data-k="tg"></span>速递 <b data-k="tgv">—</b></div>
          <button class="dh-icon-btn" data-act="settings" title="设置">${ICONS.gear}</button>
        </div>
      </div>
    </div>

    <div class="dh-toolbar">
      <form class="dh-search" data-k="searchbox" autocomplete="off">
        <span class="dh-s-ico">${ICONS.search}</span>
        <input type="text" placeholder="搜索剧名 / 演员 / 关键词，回车检索 TMDB…" data-k="q"/>
        <button type="button" class="dh-s-clear" data-act="clearq">${ICONS.x}</button>
      </form>
      <div class="dh-chips" data-k="chips"></div>
      <button class="dh-btn-ghost" data-act="refresh">${ICONS.refresh}刷新</button>
    </div>

    <div class="dh-stats" data-k="stats"></div>

    <div class="dh-feature" data-k="feature"></div>

    <div class="dh-rank" data-k="rankwrap">
      <div class="dh-rank-h"><h4>热播榜 TOP 6</h4><span>按评分与热度实时排序</span></div>
      <div class="dh-rankrow" data-k="rank"></div>
    </div>

    <div class="dh-sec"><h3 data-k="sech">精选</h3><span data-k="sechint">红果式短剧聚合</span></div>
    <div class="dh-hgtabs" data-k="hgtabs" style="display:none"></div>
    <div class="dh-grid" data-k="grid"></div>
    <div class="dh-pager" data-k="hgpager" style="display:none"></div>
  </div>

  <div class="dh-mask" data-k="mask"></div>
  <aside class="dh-drawer" data-k="drawer">
    <div class="dh-d-head">
      <div class="dh-cg" data-k="dhcg"></div>
      <div class="dh-noise"></div>
      <button class="dh-close" data-act="closedrawer">${ICONS.x}</button>
      <div class="inner">
        <h2 class="dh-d-title" data-k="dtitle">—</h2>
        <div class="dh-d-orig" data-k="dorig"></div>
        <div class="dh-d-facts" data-k="dfacts"></div>
      </div>
    </div>
    <div class="dh-d-body">
      <p class="dh-ov" data-k="dov"></p>
      <div class="dh-actions">
        <button class="dh-btn" data-act="findpt">${ICONS.bolt}检索 PT 资源</button>
        <button class="dh-btn sec" data-act="sub">${ICONS.bell}订阅追新</button>
      </div>
      <div class="dh-res-head"><h4>PT 资源</h4><span data-k="rescount">未检索</span></div>
      <div class="dh-res" data-k="reslist"></div>
    </div>
  </aside>

  <div class="dh-modal" data-k="modal">
    <div class="box">
      <div class="dh-m-head">
        <h3>广场设置</h3>
        <button class="dh-m-x" data-act="closemodal" type="button" title="关闭" aria-label="关闭设置" style="flex:0 0 auto;width:34px;height:34px;padding:0;border-radius:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(128,128,128,.14);box-shadow:inset 0 0 0 1px rgba(128,128,128,.22);margin:-6px -6px -6px 0">${ICONS.x}</button>
      </div>
      <p class="m-sub">全部设置保存在插件自有存储，不写入宿主配置，不外发任何信息。</p>

      <div class="dh-field">
        <label>下载器<span class="dh-req">手动指定</span></label>
        <select data-k="seldownloader"><option value="">加载中…</option></select>
        <div class="dh-dlnow" data-k="dlnow">尚未选择下载器</div>
        <div class="f-help">由你在本页手动选定，保存后<b>一直使用这一个</b>：所有手动下载与订阅巡检都提交到它，不再依赖宿主里「默认下载器」那个标记。宿主当前有 <b data-k="dlnum">0</b> 个下载器。</div>
      </div>

      <div class="dh-field">
        <label>PT 检索站点</label>
        <div class="dh-sel-list" data-k="sitelist"></div>
        <div class="f-help">只列出已启用且允许搜索的站点。留空则自动使用全部可用站点。</div>
      </div>

      <div class="dh-field">
        <label>Emby 剧集库</label>
        <div class="dh-sel-list" data-k="liblist"></div>
        <div class="f-help">用于「我的片库」概览。不选择则读取全部剧集库。</div>
      </div>

      <div class="dh-field">
        <label>防风控节奏</label>
        <div class="dh-2col">
          <div class="dh-num">
            <span>检索间隔</span>
            <input type="number" min="5" max="3600" step="5" data-k="ptinterval"/>
            <em>秒</em>
          </div>
          <div class="dh-num">
            <span>随机抖动</span>
            <input type="number" min="0" max="80" step="5" data-k="ptjitter"/>
            <em>%</em>
          </div>
        </div>
        <div class="dh-2col" style="margin-top:10px">
          <div class="dh-num">
            <span>每站每日</span>
            <input type="number" min="0" max="999" step="5" data-k="ptdaily"/>
            <em>次</em>
          </div>
          <div class="dh-num">
            <span>单次预算</span>
            <input type="number" min="1" max="30" step="1" data-k="subbudget"/>
            <em>分钟</em>
          </div>
        </div>
        <div class="dh-3col" style="margin-top:10px">
          <div class="dh-num">
            <span>每部重查</span>
            <input type="number" min="1" max="168" step="1" data-k="subinterval"/>
            <em>时</em>
          </div>
          <div class="dh-num">
            <span>每部问站</span>
            <input type="number" min="1" max="5" step="1" data-k="subfan"/>
            <em>个</em>
          </div>
          <div class="dh-num">
            <span>单次最多</span>
            <input type="number" min="0" max="100" step="1" data-k="subsperrun"/>
            <em>部</em>
          </div>
        </div>
        <div class="f-help">间隔按站点独立并行算：<b>每站各一路，谁先空谁搜下一部，几个站就是几倍速度</b>。每次只打一个站、同站绝不并发，比「一次打全部站点再一起等」既快又不惹风控。一部先问命中率最高的站，没搜到才流转下一个（最多「每部问站」个）。预算用完自动存档，下次从断点继续。</div>
        <div class="dh-cap" data-k="subcap">—</div>
        <div class="dh-usage"><span data-k="ptusage">—</span><button class="dh-btn sec" style="height:30px;flex:0 0 auto;padding:0 12px;font-size:12px" data-act="resetusage">重置计数</button></div>
      </div>

      <div class="dh-field">
        <label>下载策略</label>
        <div class="dh-switch">
          <div><div class="sw-k">只下载免费种</div><div class="sw-h">仅 free / 2xfree 会下载；50%、30% 等折扣种一律跳过</div></div>
          <button class="dh-toggle" data-act="onlyfree"></button>
        </div>
        <div class="dh-switch">
          <div><div class="sw-k">自动追新</div><div class="sw-h">解析种子标题里的集数，只下比已追集数更新的种子；全集下完自动停止，不再消耗检索次数</div></div>
          <button class="dh-toggle" data-act="autonew"></button>
        </div>
        <div class="dh-switch">
          <div><div class="sw-k">订阅自动下载</div><div class="sw-h">巡检命中免费种时自动提交到上面指定的下载器；未指定则只巡检不下载</div></div>
          <button class="dh-toggle" data-act="subauto"></button>
        </div>
        <div class="f-help">免费判定取站点返回的 free_type 与下载系数：免费 / 2x 免费 才算免费，50% 折扣需要算一半流量，不计入免费。</div>
      </div>

      <div class="dh-field">
        <label>每日速递</label>
        <div class="dh-switch">
          <div><div class="sw-k">启用 Telegram 速递</div><div class="sw-h">每天定时把热播与新上线推送到已配置的通知渠道</div></div>
          <button class="dh-toggle" data-act="tgdigest"></button>
        </div>
        <div class="dh-switch">
          <div><div class="sw-k">立即推送一次</div><div class="dh-sw-h sw-h">手动触发，马上检验通知效果</div></div>
          <button class="dh-btn sec" style="height:34px;flex:0 0 auto;padding:0 14px" data-act="pushnow">推送</button>
        </div>
      </div>

      <div class="m-foot">
        <button class="dh-btn sec" data-act="closemodal">取消</button>
        <button class="dh-btn" data-act="savesettings">保存设置</button>
      </div>
    </div>
  </div>

  <div class="dh-tips"></div>
  `);

  const $ = (k) => root.querySelector(`[data-k="${k}"]`);
  const $$ = (k) => Array.from(root.querySelectorAll(`[data-k="${k}"]`));

  /** ---------- Toast ---------- */
  const toast = (msg, kind = '') => {
    const box = root.querySelector('.dh-tips');
    const t = document.createElement('div');
    t.className = `dh-tip ${kind}`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = '.24s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 3200);
    setTimeout(() => t.remove(), 3600);
  };

  /** ---------- 封面生成 ---------- */
  const hashOf = (s) => {
    let h = 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  };
  const paletteOf = (s) => PALETTES[hashOf(s) % PALETTES.length];
  const coverStyle = (name) => {
    const [a, b] = paletteOf(name);
    return `background:linear-gradient(155deg,${a} 0%,${b} 100%)`;
  };
  const glyphOf = (name) => {
    const s = String(name || '?').trim();
    const m = s.match(/[\u4e00-\u9fa5]/);
    return m ? m[0] : s.charAt(0).toUpperCase();
  };
  const fmtSize = (bytes) => {
    const n = Number(bytes) || 0;
    if (n <= 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    return `${(n / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 0)} ${u[i]}`;
  };
  const fmtDate = (d) => {
    if (!d) return '';
    return String(d).slice(0, 4);
  };

  /** ---------- 频道渲染 ---------- */
  const renderChips = () => {
    const box = $('chips');
    box.innerHTML = CHANNELS.map((c) => `
      <button class="dh-chip ${S.channel === c.id ? 'on' : ''}" data-ch="${c.id}">
        ${c.label}
        ${c.id === 'mine' && S.stats.dramaCount ? `<span class="dh-c-badge">${S.stats.dramaCount}</span>` : ''}
        ${c.id === 'subs' && S.subs.length ? `<span class="dh-c-badge">${S.subs.length}</span>` : ''}
      </button>`).join('');
    box.querySelectorAll('[data-ch]').forEach((b) => {
      b.addEventListener('click', () => switchChannel(b.dataset.ch));
    });
  };

  /** ---------- 下载器（手动指定，保存后固定使用） ---------- */
  const dlOf = (id) => {
    if (id === null || id === undefined || id === '') return null;
    return S.downloaders.find((d) => String(d.id) === String(id)) || null;
  };
  const dlName = (id) => {
    const d = dlOf(id);
    return d ? String(d.name || ('#' + d.id)) : '';
  };
  const renderDlNow = () => {
    const box = $('dlnow');
    const sel = $('seldownloader');
    if (!box || !sel) return;
    const v = sel.value;
    if (!S.downloaders.length) {
      box.className = 'dh-dlnow warn';
      box.textContent = '宿主里还没有下载器。请先到 DIAN115 的 PT 设置里添加一个 qBittorrent。';
      return;
    }
    if (!v) {
      box.className = 'dh-dlnow warn';
      box.textContent = '尚未选择下载器：不选就无法下载，选定并保存后会一直使用它。';
      return;
    }
    const d = dlOf(v);
    box.className = 'dh-dlnow';
    box.innerHTML = '保存后固定使用 <b>' + escapeHtml(d ? String(d.name || '') : v) + '</b>' +
      (d && d.save_path ? '　保存到 <b>' + escapeHtml(String(d.save_path)) + '</b>' : '');
  };

  const renderStats = () => {
    const s = S.stats;
    const has = (v) => v !== undefined && v !== null;
    const dz = dlOf(S.prefs.downloaderId);
    const dzName = dz ? String(dz.name || '') : '';
    const cells = [
      { k: '片库短剧', v: has(s.dramaCount) ? s.dramaCount : '—', u: has(s.dramaCount) ? '部' : '' },
      { k: '已入库集数', v: has(s.episodeCount) ? s.episodeCount : '—', u: has(s.episodeCount) ? '集' : '' },
      { k: 'PT 站点', v: S.sites.length || '—', u: S.sites.length ? '个可用' : '' },
      { k: '下载器', v: dzName ? (dzName.length > 11 ? dzName.slice(0, 11) + '…' : dzName) : (S.downloaders.length ? '待选择' : '—'), u: dzName ? '已固定' : '' }
    ];
    $('stats').innerHTML = cells.map((c) => `
      <div class="dh-stat"><div class="k">${c.k}</div>
      <div class="v">${c.v}<small>${c.u}</small></div></div>`).join('');
  };

  const skeleton = () => {
    $('grid').innerHTML = Array.from({ length: 10 }).map(() => `
      <div class="dh-skel"><div class="s1"></div><div class="s2"></div><div class="s3"></div></div>`).join('');
  };

  const empty = (t, d) => {
    $('grid').style.display = '';
    $('grid').innerHTML = `
      <div class="dh-empty">
        <div class="e1">◍</div>
        <div class="e2">${t}</div>
        <div class="e3">${d}</div>
      </div>`;
  };

  /** ---------- 焦点大图 + 热播榜 ---------- */
  const showFront = (on) => {
    const fw = $('feature');
    const rw = $('rankwrap');
    if (!fw || !rw) return;
    fw.style.display = on ? 'block' : 'none';
    rw.style.display = on ? 'block' : 'none';
    if (!on) { fw.innerHTML = ''; $('rank').innerHTML = ''; }
  };

  const renderFront = (items) => {
    const head = items[0];
    if (!head) return showFront(false);
    showFront(true);
    const fw = $('feature');
    const nm = head.name || head.title || '';
    const w500 = head.poster_path ? `https://image.tmdb.org/t/p/w500${head.poster_path}` : '';
    const w780 = head.poster_path ? `https://image.tmdb.org/t/p/w780${head.poster_path}` : '';
    const score = Number(head.vote_average || 0);
    const year = fmtDate(head.first_air_date);
    fw.innerHTML = `
      <div class="fg-bg"${w780 ? ` style="background-image:url(${w780})"` : ''}></div>
      <div class="fg-tint"></div>
      ${w500 ? `<div class="fg-poster" style="background-image:url(${w500})"></div>` : ''}
      <div class="fg-in">
        <div class="fg-k">本周焦点</div>
        <div class="fg-t">${escapeHtml(nm)}</div>
        <div class="fg-m">
          ${year ? `<span>${year}</span>` : ''}
          ${score > 0 ? `<span><b>★ ${score.toFixed(1)}</b></span>` : ''}
          ${head.vote_count ? `<span>${head.vote_count} 人评</span>` : ''}
          <span>中文 · 竖屏短剧</span>
        </div>
        ${head.overview ? `<div class="fg-ov">${escapeHtml(head.overview)}</div>` : ''}
        <div class="fg-btns">
          <button class="dh-btn" data-fg="find">${ICONS.bolt}找资源</button>
          <button class="dh-btn sec" data-fg="detail">详情</button>
        </div>
      </div>`;
    fw.querySelector('[data-fg="find"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openDetail(head, true);
    });
    fw.querySelector('[data-fg="detail"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openDetail(head, false);
    });
    fw.addEventListener('click', () => openDetail(head, false));

    $('rank').innerHTML = items.slice(1, 7).map((it, i) => {
      const n = it.name || it.title || '';
      const th = it.poster_path ? `https://image.tmdb.org/t/p/w185${it.poster_path}` : '';
      const sc = Number(it.vote_average || 0);
      return `<div class="dh-rk" data-rk="${i + 1}">
        <div class="n">${i + 1}</div>
        <div class="th"${th ? ` style="background-image:url(${th})"` : ''}></div>
        <div class="tx">
          <div class="nm">${escapeHtml(n)}</div>
          <div class="sc">${sc > 0 ? `★ ${sc.toFixed(1)}` : '—'}${it.first_air_date ? ` · ${fmtDate(it.first_air_date)}` : ''}</div>
        </div>
      </div>`;
    }).join('');
    $('rank').querySelectorAll('[data-rk]').forEach((b) => {
      b.addEventListener('click', () => openDetail(items[Number(b.dataset.rk)], false));
    });
  };

  /** ---------- 短剧卡片：真实海报 + 渐变回退 ---------- */
  const renderItems = (items) => {
    $('grid').style.display = '';
    if (!items.length) { showFront(false); return empty('这个频道暂时没有内容', '换个分类，或用搜索框直接找剧名'); }
    renderFront(items);
    $('grid').innerHTML = items.map((it, i) => {
      const name = it.name || it.title || '未命名';
      const year = fmtDate(it.first_air_date || it.release_date);
      const score = Number(it.vote_average || 0);
      const poster = it.poster_path ? `https://image.tmdb.org/t/p/w342${it.poster_path}` : '';
      const g = genreNames(it.genre_ids);
      return `
      <article class="dh-card" data-i="${i}">
        <div class="dh-cover" style="${coverStyle(name)}">
          <div class="dh-cg"></div>
          <div class="dh-streak"></div>
          <div class="dh-noise"></div>
          <div class="dh-glyph">${glyphOf(name)}</div>
          ${poster ? `<img class="dh-poster" src="${poster}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : ''}
          ${score > 0 ? `<div class="dh-score">${ICONS.star}${score.toFixed(1)}</div>` : ''}
          ${year ? `<div class="dh-ep">${year}</div>` : ''}
        </div>
        <div class="dh-body">
          <div class="dh-name">${escapeHtml(name)}</div>
          <div class="dh-meta">
            ${g ? `<span class="dh-tag">${escapeHtml(g)}</span>` : ''}
            ${it.vote_count ? `<span>${it.vote_count} 人评</span>` : ''}
          </div>
        </div>
        <div class="dh-hover">
          <button class="dh-mini" data-find="${i}">${ICONS.bolt}找资源</button>
          <button class="dh-mini ghost" data-detail="${i}">详情</button>
        </div>
      </article>`;
    }).join('');

    // 海报加载失败时隐藏，露出下层渐变封面
    $('grid').querySelectorAll('img.dh-poster').forEach((img) => {
      img.addEventListener('error', () => img.classList.add('dh-off'));
    });

    $('grid').querySelectorAll('[data-find]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(S.items[Number(b.dataset.find)], true);
      });
    });
    $('grid').querySelectorAll('[data-detail]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(S.items[Number(b.dataset.detail)], false);
      });
    });
    $('grid').querySelectorAll('.dh-card').forEach((c) => {
      c.addEventListener('click', () => openDetail(S.items[Number(c.dataset.i)], false));
    });
  };

  /** ---------- Emby 片库卡片（数据来自 type=Series） ---------- */
  const renderLibrary = (series) => {
    showFront(false);
    $('grid').style.display = '';
    if (!series.length) {
      return empty('片库还是空的', '在 Emby 里入库短剧后点「刷新」；也可以直接在发现页找资源下载');
    }
    $('grid').innerHTML = series.map((s, i) => {
      const score = Number(s.community_rating || 0);
      const g1 = Array.isArray(s.genres) && s.genres.length ? s.genres[0] : '';
      return `
      <article class="dh-card" data-i="${i}">
        <div class="dh-cover" style="${coverStyle(s.name)}">
          <div class="dh-cg"></div>
          <div class="dh-streak"></div>
          <div class="dh-noise"></div>
          <div class="dh-vlabel">IN LIBRARY</div>
          <div class="dh-glyph">${glyphOf(s.name)}</div>
          ${score > 0 ? `<div class="dh-score">${ICONS.star}${score.toFixed(1)}</div>` : ''}
          ${s.production_year ? `<div class="dh-ep">${s.production_year}</div>` : ''}
        </div>
        <div class="dh-body">
          <div class="dh-name">${escapeHtml(s.name)}</div>
          <div class="dh-meta">
            <span class="dh-tag">已入库</span>
            ${g1 ? `<span>${escapeHtml(g1)}</span>` : ''}
          </div>
        </div>
        <div class="dh-hover">
          <button class="dh-mini" data-libfind="${i}">${ICONS.bolt}补资源</button>
          <button class="dh-mini ghost" data-libdetail="${i}">简介</button>
        </div>
      </article>`;
    }).join('');

    $('grid').querySelectorAll('[data-libfind]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = S.items[Number(b.dataset.libfind)];
        openDetail(s, false);
        searchPT(s.name);
      });
    });
    $('grid').querySelectorAll('[data-libdetail]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(S.items[Number(b.dataset.libdetail)], false);
      });
    });
    $('grid').querySelectorAll('.dh-card').forEach((c) => {
      c.addEventListener('click', () => openDetail(S.items[Number(c.dataset.i)], false));
    });
  };

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));

  /** ---------- 数据加载 ---------- */
  const tmdbSearch = async (kw, page) => {
    const d = await ctx.api.get(`/api/tmdb/search?q=${encodeURIComponent(kw)}&page=${page || 1}`);
    const list = Array.isArray(d) ? d : (d.results || []);
    return list.filter((x) => (x.media_type ? x.media_type === 'tv' : true));
  };

  const genreNames = (ids) => {
    if (!Array.isArray(ids) || !ids.length || !S.genreMap) return '';
    return ids.map((id) => S.genreMap[id]).filter(Boolean).slice(0, 2).join(' / ');
  };

  /** 短剧判定：中文 + 有海报 + 近三年 + 非综艺（漫剧频道用更宽的口径） */
  const isDrama = (it, opt) => {
    const o = opt || {};
    if (!it || !it.id) return false;
    const name = String(it.name || it.title || '').trim();
    if (!name) return false;
    if (it.original_language !== 'zh') return false;
    if (!it.poster_path) return false;
    const year = Number(String(it.first_air_date || '').slice(0, 4)) || 0;
    // 漫剧有一批条目没登记首播日期，卡年份会把一半片子挡掉，这类放行
    if (!year) { if (!o.allowNoYear) return false; }
    else if (year < (o.minYear || MIN_YEAR)) return false;
    if (NOT_DRAMA.some((w) => name.indexOf(w) >= 0)) return false;
    if (KID_NOISE.some((w) => name.indexOf(w) >= 0)) return false;
    if (o.only === 'manju') {
      if (!MANJU_FEAT.some((w) => name.indexOf(w) >= 0)) return false;
    }
    return true;
  };

  /** 按频道关键词并发检索，过滤 + 去重 + 排序；plan 支持「每个词各查几页」 */
  const fetchChannel = async (kws, pages, opt) => {
    const o = opt || {};
    const tasks = [];
    if (Array.isArray(o.plan)) {
      for (const pair of o.plan) {
        const kw = pair[0];
        const np = Math.max(1, Number(pair[1]) || 1);
        for (let pg = 1; pg <= np; pg++) tasks.push(tmdbSearch(kw, pg).catch(() => []));
      }
    } else {
      const npF = pages || 1;
      for (const kw of kws) {
        for (let pg = 1; pg <= npF; pg++) tasks.push(tmdbSearch(kw, pg).catch(() => []));
      }
    }
    const results = await Promise.all(tasks);
    const seen = new Set();
    const out = [];
    for (const list of results) {
      for (const it of list) {
        if (!isDrama(it, o) || seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    }
    out.sort((a, b) => {
      const sa = Number(a.vote_average || 0);
      const sb = Number(b.vote_average || 0);
      if (sb !== sa) return sb - sa;
      return String(b.first_air_date || '').localeCompare(String(a.first_air_date || ''));
    });
    return out;
  };

  /** ---------- 红果：目录取数（后台作业）+ 渲染 ---------- */
  const HG_ROUTES = [['real-drama', '真人剧'], ['comic-drama', '漫剧'], ['ai-drama', 'AI剧']];

  /** 等作业跑完。红果一页 250KB 左右，通常 1~3 秒；作业超时是 120 秒，这里按同一量级等，避免提前报超时 */
  const waitRun = async (id) => {
    if (!id) return null;
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 400));
      let r = null;
      try { r = await ctx.tasks.get(id); } catch (e) { return null; }
      if (!r) continue;
      if (r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled') return r;
    }
    return null;
  };

  /** 同一次一致的取数结果缓存 10 分钟，翻回来不会再打一次站点 */
  const hgFetch = async (action, opts) => {
    const key = action + ':' + (opts.route || '') + ':' + (opts.page || 1) + ':' + (opts.kw || opts.sid || '');
    const hit = S.hgCache[key];
    if (hit && (Date.now() - hit.at) < 10 * 60 * 1000) return hit;
    const run = await ctx.tasks.run('hg', 'hg:' + key + ':' + Date.now(), Object.assign({ action: action }, opts));
    const done = await waitRun(run && run.id);
    if (!done || done.status !== 'succeeded') {
      const msg = (done && (done.error || done.message)) || '取数超时';
      throw new Error(String(msg).slice(0, 120));
    }
    const box = await readKV('hgq', null);
    if (!box || box.key !== key) throw new Error('取数结果对不上，请重试一次');
    S.hgCache[key] = box;
    return box;
  };

  const renderHgTabs = () => {
    const box = $('hgtabs');
    if (!box) return;
    if (S.channel !== 'hg') { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    box.innerHTML = HG_ROUTES.map((r) =>
      `<button class="dh-fchip ${S.hgRoute === r[0] ? 'on' : ''}" data-hgr="${r[0]}">${r[1]}</button>`).join('');
    box.querySelectorAll('[data-hgr]').forEach((b) => b.addEventListener('click', () => {
      const r = b.dataset.hgr;
      if (r === S.hgRoute && S.hgPage === 1) return;
      S.hgKw = '';
      S.hgRoute = r;
      S.hgPage = 1;
      loadHg();
    }));
  };

  const renderHgPager = () => {
    const box = $('hgpager');
    if (!box) return;
    if (S.channel !== 'hg' || !S.items.length) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    const pages = Math.max(1, S.hgPages);
    box.innerHTML = `<button data-hgp="-1"${S.hgPage <= 1 ? ' disabled' : ''}>上一页</button>
      <span>第 ${S.hgPage} / ${pages} 页 · 共 ${S.hgTotal || S.items.length} 部</span>
      <button data-hgp="1"${S.hgPage >= pages ? ' disabled' : ''}>下一页</button>`;
    box.querySelectorAll('[data-hgp]').forEach((b) => b.addEventListener('click', () => {
      const next = S.hgPage + Number(b.dataset.hgp);
      if (next < 1 || next > pages) return;
      S.hgPage = next;
      loadHg();
    }));
  };

  const renderHgItems = (items) => {
    $('grid').style.display = '';
    showFront(false);
    if (!items.length) { return empty('红果这一页没有数据', '换一页，或换个分类'); }
    $('grid').innerHTML = items.map((it, i) => `
      <article class="dh-card" data-i="${i}">
        <div class="dh-cover" style="${coverStyle(it.title)}">
          <div class="dh-cg"></div>
          <div class="dh-streak"></div>
          <div class="dh-noise"></div>
          <div class="dh-glyph">${glyphOf(it.title)}</div>
          ${it.cover ? `<img class="dh-poster" src="${escapeHtml(it.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : ''}
          ${it.ep ? `<div class="dh-ep2">${it.ep}集</div>` : ''}
        </div>
        <div class="dh-body">
          <div class="dh-name">${escapeHtml(it.title)}</div>
          <div class="dh-meta">${it.playable ? `<span class="dh-tag">可看 ${it.playable} 集</span>` : '<span class="dh-tag">目录</span>'}</div>
        </div>
        <div class="dh-hover">
          <button class="dh-mini" data-hgfind="${i}">${ICONS.bolt}找资源</button>
          <button class="dh-mini ghost" data-hgsub="${i}">订阅</button>
        </div>
      </article>`).join('');

    $('grid').querySelectorAll('img.dh-poster').forEach((img) => {
      img.addEventListener('error', () => img.classList.add('dh-off'));
    });
    $('grid').querySelectorAll('[data-hgfind]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); searchPT(items[Number(b.dataset.hgfind)].title); });
    });
    $('grid').querySelectorAll('[data-hgsub]').forEach((b) => {
      b.addEventListener('click', async (e) => { e.stopPropagation(); await addSub(items[Number(b.dataset.hgsub)]); });
    });
    $('grid').querySelectorAll('.dh-card').forEach((c) => {
      c.addEventListener('click', () => searchPT(items[Number(c.dataset.i)].title));
    });
  };

  const loadHg = async () => {
    renderHgTabs();
    S.loading = true;
    skeleton();
    try {
      const searching = S.hgRoute === 'search' && S.hgKw;
      const d = searching
        ? await hgFetch('search', { kw: S.hgKw, page: S.hgPage })
        : await hgFetch('list', { route: S.hgRoute, page: S.hgPage });
      S.items = d.items || [];
      S.hgPages = d.totalPages || 1;
      S.hgTotal = d.total || S.items.length;
      if (searching) {
        $('sech').textContent = '红果 · 搜索「' + S.hgKw + '」';
        $('sechint').textContent = d.total ? ('共 ' + d.total + ' 部 · 第 ' + S.hgPage + ' 页') : '站点没有匹配的剧';
      } else {
        const label = HG_ROUTES.filter((r) => r[0] === d.route)[0];
        $('sech').textContent = '红果 · ' + (label ? label[1] : '目录');
        $('sechint').textContent = '站点实时目录 · 片名与集数以此为准';
      }
      renderHgItems(S.items);
    } catch (e) {
      S.items = [];
      S.hgPages = 1;
      $('grid').style.display = '';
      empty('红果没读出来', `${escapeHtml(String(e && e.message ? e.message : e))}<br>可能是站点改版或网络不通，稍后再试。`);
      toast('红果取数失败：' + (e && e.message ? e.message : e), 'err');
    } finally {
      S.loading = false;
      renderHgPager();
    }
  };

  const loadChannel = async (ch) => {
    const def = CHANNELS.find((c) => c.id === ch);
    if (def && def.src === 'hg') return loadHg();
    // 非红果频道：把红果的切换条和分页收起来
    const tabBox = $('hgtabs');
    const pgBox = $('hgpager');
    if (tabBox) tabBox.style.display = 'none';
    if (pgBox) pgBox.style.display = 'none';
    S.loading = true;
    $('sech').textContent = def ? def.label : '';
    $('sechint').textContent = def ? def.hint : '';
    skeleton();
    try {
      if (ch === 'mine') {
        const series = await loadLibrarySeries();
        S.items = series;
        renderLibrary(series);
      } else if (ch === 'subs') {
        await renderSubs();
      } else {
        const list = await fetchChannel((def && def.kw) || ['甜宠'], def && def.pages, def || {});
        S.items = list;
        renderItems(list);
      }
    } catch (e) {
      S.items = [];
      empty('数据没能读出来', `${escapeHtml(String(e && e.message ? e.message : e))}<br>请确认宿主已配置 TMDB 与 Emby。`);
      toast('加载失败：' + (e && e.message ? e.message : e), 'err');
    } finally {
      S.loading = false;
    }
  };

  // 宿主 emby/items 的 limit 上限为 50，超出直接 400，必须按页取。
  const EMBY_PAGE = 50;

  const pickLibs = () => {
    const libs = S.libraries.filter((l) => l.type === 'tvshows');
    return S.prefs.libraryIds.length
      ? libs.filter((l) => S.prefs.libraryIds.includes(l.id))
      : libs;
  };

  /** 概览统计：每库只取 total，代价极小 */
  const loadLibraryStats = async () => {
    const useLibs = pickLibs();
    let dramas = 0;
    let eps = 0;
    for (const lib of useLibs) {
      const q = (type) => `/api/plugin-host/emby/items?library_id=${encodeURIComponent(lib.id)}&type=${type}&limit=1`;
      try { dramas += Number((await ctx.api.get(q('Series'))).total || 0); } catch { /* 忽略单库失败 */ }
      try { eps += Number((await ctx.api.get(q('Episode'))).total || 0); } catch { /* 同上 */ }
    }
    S.stats = { ...S.stats, dramaCount: dramas, episodeCount: eps };
    renderStats();
    renderChips();
    updatePills();
    await writeKV('library', { at: Date.now(), count: dramas, episodes: eps, libraries: useLibs.length });
    return S.stats;
  };

  /** 片库列表：type=Series 分页拉取，每库最多 4 页（200 部） */
  const loadLibrarySeries = async () => {
    const useLibs = pickLibs();
    if (!useLibs.length) return [];
    const out = [];
    const seen = new Set();
    for (const lib of useLibs) {
      let offset = 0;
      for (let page = 0; page < 4; page++) {
        let d;
        try {
          d = await ctx.api.get(
            `/api/plugin-host/emby/items?library_id=${encodeURIComponent(lib.id)}&type=Series&limit=${EMBY_PAGE}&offset=${offset}`
          );
        } catch { break; }
        const items = d.items || [];
        for (const it of items) {
          if (!it.id || seen.has(it.id)) continue;
          seen.add(it.id);
          out.push(it);
        }
        offset += items.length;
        if (!items.length || offset >= Number(d.total || 0)) break;
      }
    }
    out.sort((a, b) => String(b.date_created || '').localeCompare(String(a.date_created || '')));
    S.stats = { ...S.stats, dramaCount: out.length };
    renderStats();
    renderChips();
    updatePills();
    return out;
  };

  const switchChannel = (ch) => {
    S.channel = ch;
    S.query = '';
    $('q').value = '';
    $('searchbox').classList.remove('has');
    renderChips();
    loadChannel(ch);
  };

  /** ---------- 抽屉 ---------- */
  const openDrawer = () => {
    $('drawer').classList.add('on');
    $('mask').classList.add('on');
  };
  const closeDrawer = () => {
    $('drawer').classList.remove('on');
    $('mask').classList.remove('on');
  };

  const openDetail = (item, autoSearch) => {
    if (!item) return;
    S.detail = item;
    S.torrents = [];
    $('dtitle').textContent = item.name || item.title || '未命名';
    $('dorig').textContent = item.original_name || item.original_title || '';
    const dname = item.name || item.title;
    const headBg = item.poster_path
      ? `background-image:linear-gradient(180deg,rgba(8,10,16,.84) 0%,rgba(8,10,16,.34) 46%,rgba(8,10,16,.94) 100%),url(https://image.tmdb.org/t/p/w780${item.poster_path});background-size:cover;background-position:center 18%`
      : coverStyle(dname);
    $('dhcg').setAttribute('style', headBg);

    const facts = [];
    const score = Number(item.vote_average || item.community_rating || 0);
    if (item.first_air_date) facts.push(String(item.first_air_date).slice(0, 4));
    if (!item.first_air_date && item.production_year) facts.push(String(item.production_year));
    if (score > 0) facts.push(`★ ${score.toFixed(1)}`);
    if (item.original_language) facts.push(String(item.original_language).toUpperCase());
    if (item.number_of_seasons) facts.push(`${item.number_of_seasons} 季`);
    if (item.number_of_episodes) facts.push(`${item.number_of_episodes} 集`);
    $('dfacts').innerHTML = facts.map((f) => `<span class="dh-fact">${escapeHtml(f)}</span>`).join('');

    $('dov').textContent = item.overview || '暂无简介。可以先检索 PT 资源，入库后由 Emby 刮削补齐元数据。';
    $('rescount').textContent = '未检索';
    $('reslist').innerHTML = '<div style="font-size:12.5px;color:var(--dh-muted);line-height:1.7">点击上方「检索 PT 资源」，从已启用的站点查找可用种子。</div>';
    openDrawer();
    if (autoSearch) searchPT(item.name || item.title);
  };

  /** ---------- 免费种判定：只有 free / 2xfree 算免费，50% 不算 ---------- */
  const isFree = (t) => {
    if (!t) return false;
    const ft = String(t.free_type || '').toLowerCase();
    if (ft === 'free' || ft === '2xfree' || ft === 'free2x') return true;
    const df = Number(t.download_factor);
    return Number.isFinite(df) && df === 0;
  };
  const freeText = (t) => {
    const uf = Number(t.upload_factor);
    if (isFree(t)) return uf >= 2 ? '2x免费' : '免费';
    const df = Number(t.download_factor);
    if (df === 0.5 || String(t.discount || '').indexOf('50') >= 0) return '50%';
    return '计流量';
  };

  /** ---------- 站点风控：轮询间隔 + 每站每日访问次数 ---------- */
  const dayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const usageOf = (siteId) => {
    const u = (S.prefs.ptUsage || {})[siteId];
    return u && u.day === dayKey() ? { day: u.day, count: u.count || 0, last: u.last || 0 } : { day: dayKey(), count: 0, last: 0 };
  };
  const ptGate = () => {
    const cand = resolveSiteIds();
    const cap = Math.max(0, Number(S.prefs.ptDaily) || 0);
    const keep = [];
    const dropped = [];
    for (const id of cand) {
      const site = S.sites.find((s) => s.id === id);
      const name = site ? site.name : String(id);
      if (cap > 0 && usageOf(id).count >= cap) { dropped.push(name); continue; }
      keep.push(id);
    }
    const gapMs = Math.max(0, Number(S.prefs.ptInterval) || 0) * 1000;
    const waitMs = Math.max(0, gapMs - (Date.now() - (Number(S.prefs.ptLast) || 0)));
    return { keep, dropped, waitMs };
  };
  const ptMark = (ids) => {
    const day = dayKey();
    const now = Date.now();
    const u = Object.assign({}, S.prefs.ptUsage || {});
    for (const id of ids) {
      const cur = u[id] && u[id].day === day ? u[id] : { day, count: 0, last: 0 };
      u[id] = { day, count: (cur.count || 0) + 1, last: now };
    }
    S.prefs.ptUsage = u;
    S.prefs.ptLast = now;
    writeKV('prefs', S.prefs);
  };
  const usageText = () => {
    if (!S.sites.length) return '暂无可用站点';
    const cap = Number(S.prefs.ptDaily) || 0;
    return S.sites.map((s) => {
      const u = usageOf(s.id);
      return `${s.name} ${u.count}${cap > 0 ? '/' + cap : ' 次'}`;
    }).join(' · ');
  };

  /** 订阅吞吐测算：回答「订阅多了要查到什么时候」 */
  const subStats = () => {
    const now = Date.now();
    let due = 0;
    let done = 0;
    let paused = 0;
    let active = 0;
    let nextAt = 0;
    for (const s of S.subs) {
      if (!s) continue;
      if (s.complete) { done += 1; continue; }
      if (s.autoNew === false && s.got) { paused += 1; continue; }
      active += 1;
      if (!s.nextAt || s.nextAt <= now) due += 1;
      else if (!nextAt || s.nextAt < nextAt) nextAt = s.nextAt;
    }
    return { total: S.subs.length, due, done, paused, active, nextAt };
  };

  const capText = () => {
    const n = subStats().active;
    if (!n) return '还没有在追的订阅：订阅后这里会算出「全部搜完要多久」。';
    const gap = Math.max(5, Number(S.prefs.ptInterval) || 20);
    const hours = Math.max(1, Number(S.prefs.subInterval) || 6);
    const budgetMin = Math.max(1, Number(S.prefs.subBudget) || 10);
    const perRun = Math.max(0, Number(S.prefs.subsPerRun) || 0);
    const sites = Math.max(1, S.sites.length);
    const fan = Math.min(Math.max(1, Number(S.prefs.subFan) || 2), sites);

    // 并行口径：每站各一路，单站节奏 = gap 秒一次 → 全局吞吐 = 站点数 / gap
    const perMin = (sites * 60) / gap;
    let todo = n * fan;                       // 最坏情况每部要问 fan 个站
    if (perRun > 0) todo = Math.min(todo, perRun * fan);
    const roundSec = Math.max(1, Math.ceil(todo / perMin * 60));  // 全量一轮耗时
    const inOneRun = perMin * budgetMin;      // 单次预算内能发多少次请求
    const runsNeeded = Math.max(1, Math.ceil(todo / Math.max(1, inOneRun)));
    const perSiteDay = Math.round((n * Math.ceil(24 / hours) * fan) / sites);
    const capDay = Math.max(0, Number(S.prefs.ptDaily) || 0);
    const overCap = capDay > 0 && perSiteDay > capDay;
    const fmt = (sec) => (sec < 90 ? `${sec} 秒` : sec < 3600 ? `${Math.round(sec / 60)} 分钟` : `${(sec / 3600).toFixed(1)} 小时`);

    return `在追 ${n} 部 · ${sites} 站并行（每站 ${gap} 秒一次 ≈ 全局 ${perMin.toFixed(1)} 次/分钟）· 最坏 ${todo} 次请求 · 全量一轮约 ${fmt(roundSec)}${runsNeeded > 1 ? `（分 ${runsNeeded} 次运行，预算 ${budgetMin} 分钟/次）` : '，一次跑完'} · 每站每天约 ${perSiteDay} 次${overCap ? ` · ⚠ 已超每站每日上限 ${capDay} 次` : ''}`;
  };

  /** 下一部何时到期（只在与「待查数」互补时展示，避免重复） */
  const dueText = () => {
    const st = subStats();
    if (!st.nextAt) return '';
    const min = Math.max(0, Math.round((st.nextAt - Date.now()) / 60000));
    if (min < 1) return '即将开始';
    if (min < 60) return `下一部 ${min} 分钟后`;
    return `下一部 ${Math.round(min / 60)} 小时后`;
  };

  /** ---------- 订阅 ---------- */
  const loadSubs = async () => {
    const arr = await readKV('subs', []);
    S.subs = Array.isArray(arr) ? arr : [];
  };
  const saveSubs = async () => writeKV('subs', S.subs.slice(0, 100));
  const addSub = async (item) => {
    const name = String((item && (item.name || item.title)) || '').trim();
    if (!name) return;
    if (S.subs.some((s) => s.name === name)) { toast('已在订阅列表里', 'ok'); return; }
    const query = cleanPTName(name);
    S.subs.unshift({
      name,
      // PT 检索用的名字：漫剧去掉「动态漫 / AI漫剧版」后缀，否则站上搜不到
      query: query !== name ? query : undefined,
      tmdbId: item.id || null,
      poster: item.poster_path || '',
      at: Date.now(),
      onlyFree: true,
      autoNew: S.prefs.autoNew !== false,
      ep: 0,
      total: Number(item.ep || item.total || 0),
      nextAt: 0,
      last: 0,
      lastResult: '等待首次巡检'
    });
    const ok = await saveSubs();
    toast(ok ? '已订阅：' + name.slice(0, 16) + '（追新中）' : '订阅保存失败', ok ? 'ok' : 'err');
    renderChips();
  };

  /** ---------- PT 检索 ---------- */
  const resolveSiteIds = () => {
    if (S.prefs.siteIds && S.prefs.siteIds.length) return S.prefs.siteIds;
    return S.sites.map((s) => s.id);
  };

  const searchPT = async (keyword) => {
    const kw = String(keyword || '').trim();
    if (!kw) return;
    const gate = ptGate();
    const siteIds = gate.keep;
    S.torrentLoading = true;
    $('rescount').textContent = '检索中…';
    $('reslist').innerHTML = Array.from({ length: 3 }).map(() => `
      <div class="dh-skel" style="padding:0"><div class="s2" style="margin:13px"></div><div class="s3"></div></div>`).join('');

    if (!siteIds.length) {
      $('rescount').textContent = '已被风控拦截';
      $('reslist').innerHTML = `<div style="font-size:12.5px;color:var(--dh-muted);line-height:1.75">
        ${S.sites.length ? '所有站点今日访问次数已达上限，按防风控设置暂停检索。可在设置里调高上限或重置计数。'
          : '没有可用的 PT 站点。请到 DIAN115 的 PT 设置里启用站点（勾选允许搜索），再回到这里重试。'}</div>`;
      S.torrentLoading = false;
      return;
    }
    if (gate.waitMs > 0) {
      S.torrentLoading = false;
      $('rescount').textContent = '冷却中';
      const left = Math.ceil(gate.waitMs / 1000);
      $('reslist').innerHTML = `<div style="font-size:12.5px;color:var(--dh-muted);line-height:1.75">
        防风控冷却中，还需 <b>${left}</b> 秒才能再次检索。可在设置里调整轮询间隔。</div>`;
      toast(`PT 冷却中：还需 ${left} 秒`, 'err');
      return;
    }

    try {
      const d = await ctx.api.post('/api/pt/search', { keyword: kw, site_ids: siteIds, page: 1 });
      const data = d.data || d;
      const list = data.torrents || [];
      S.torrents = list;
      ptMark(siteIds);
      const skip = gate.dropped.length ? ` · 跳过 ${gate.dropped.length} 站（达上限）` : '';
      $('rescount').textContent = `${list.length} 条 · 命中 ${data.total_found ?? list.length}${skip}`;
      renderTorrents(list, kw);
    } catch (e) {
      S.torrents = [];
      $('rescount').textContent = '检索失败';
      $('reslist').innerHTML = `<div style="font-size:12.5px;color:#e8503f;line-height:1.75">
        ${escapeHtml(e && e.message ? e.message : String(e))}</div>`;
      toast('PT 检索失败：' + (e && e.message ? e.message : e), 'err');
    } finally {
      S.torrentLoading = false;
    }
  };

  const renderTorrents = (list, kw) => {
    if (!list.length) {
      $('reslist').innerHTML = `<div style="font-size:12.5px;color:var(--dh-muted);line-height:1.75">
        「${escapeHtml(kw)}」在可用站点没有结果。换个关键词，或在 DIAN115 里启用更多 PT 站点。</div>`;
      return;
    }
    const freeN = list.filter(isFree).length;
    $('rescount').textContent += ` · 免费 ${freeN}`;
    $('reslist').innerHTML = list.map((t, i) => {
      const free = isFree(t);
      const tags = [`<span class="dh-badge ${free ? (Number(t.upload_factor) >= 2 ? 'free2x' : 'free') : 'half'}">${freeText(t)}</span>`];
      if (t.hit_and_run) tags.push('<span class="dh-badge hr">H&amp;R</span>');
      const blocked = !!S.prefs.onlyFree && !free;
      return `
      <div class="dh-tor">
        <div class="t1" title="${escapeHtml(t.title)}">${escapeHtml(t.title || '—')}</div>
        <div class="t2">
          <span class="dh-badge site">${escapeHtml(t.site_name || '站点')}</span>
          ${tags.join('')}
          <span>↑${t.seeders ?? 0}</span>
          <span>↓${t.leechers ?? 0}</span>
          <span>${escapeHtml(String(t.publish_time || '').slice(0, 10))}</span>
        </div>
        <div class="t3">
          <div class="sz">${fmtSize(t.size)}<em>完成 ${t.completed ?? 0}</em></div>
          <button class="dh-dl" data-dl="${i}" ${blocked ? 'disabled title="非免费种，按设置已禁用"' : ''}>${blocked ? '非免费' : ICONS.down + '下载'}</button>
        </div>
      </div>`;
    }).join('');

    $('reslist').querySelectorAll('[data-dl]').forEach((b) => {
      b.addEventListener('click', () => submitDownload(S.torrents[Number(b.dataset.dl)], b));
    });
  };

  /** ---------- 提交下载（走后台作业，带检查点） ---------- */
  const submitDownload = async (torrent, btn) => {
    if (!torrent) return;
    if (S.prefs.onlyFree && !isFree(torrent)) {
      toast(`该资源是「${freeText(torrent)}」，非免费，已按「只下载免费种」跳过`, 'err');
      return;
    }
    // 下载器必须由用户手动确认过一次，之后一直用这一个
    const downloaderId = S.prefs.downloaderId ? Number(S.prefs.downloaderId) : null;
    if (!downloaderId || !dlOf(downloaderId)) {
      toast(S.downloaders.length
        ? '还没指定下载器：请先在设置里选一个，选定后一直用它'
        : '宿主里没有可用下载器，请先到 DIAN115 的 PT 设置里添加', 'err');
      if (S.downloaders.length) openModal();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
    const key = `dl:${torrent.site_id}:${torrent.torrent_id}:${downloaderId || 0}`;
    try {
      const run = await ctx.tasks.run('submit', key, {
        download_url: torrent.download_url || '',
        info_hash: torrent.info_hash || '',
        site_id: torrent.site_id,
        torrent_id: torrent.torrent_id,
        title: torrent.title,
        downloader: dlName(downloaderId),
        downloader_id: downloaderId
      });
      toast('已提交到 ' + dlName(downloaderId) + '：' + String(torrent.title || '').slice(0, 22) + '…', 'ok');
      if (run && run.id) pollRun(run.id);
      if (btn) { btn.textContent = '已提交'; }
    } catch (e) {
      toast('提交失败：' + (e && e.message ? e.message : e), 'err');
      if (btn) { btn.disabled = false; btn.innerHTML = ICONS.down + '下载'; }
    }
  };

  const pollRun = async (id) => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const r = await ctx.tasks.get(id);
        if (!r) continue;
        if (r.status === 'succeeded') { toast('已加入 ' + (dlName(S.prefs.downloaderId) || '下载器') + ' 的队列', 'ok'); return; }
        if (r.status === 'failed') { toast('下载失败：' + (r.error || '未知原因'), 'err'); return; }
      } catch { return; }
    }
  };

  /** ---------- 设置 ---------- */
  const openModal = () => {
    const sel = $('seldownloader');
    const cur = S.prefs.downloaderId;
    sel.innerHTML = `<option value="">— 请选择下载器 —</option>` + S.downloaders.map((d) => {
      const meta = [d.type, d.save_path].filter(Boolean).join(' · ');
      return `<option value="${d.id}" ${String(cur) === String(d.id) ? 'selected' : ''}>${escapeHtml(String(d.name || ('#' + d.id)))}${meta ? ' · ' + escapeHtml(String(meta)) : ''}${d.is_default ? '（宿主默认）' : ''}</option>`;
    }).join('');
    $('dlnum').textContent = String(S.downloaders.length);
    sel.onchange = renderDlNow;
    renderDlNow();

    $('sitelist').innerHTML = S.sites.length
      ? S.sites.map((s) => {
        const on = S.prefs.siteIds.includes(s.id);
        return `<button class="dh-sel ${on ? 'on' : ''}" data-site="${s.id}">${escapeHtml(s.name)}</button>`;
      }).join('')
      : '<span style="font-size:12px;color:var(--dh-muted)">没有已启用的站点</span>';
    $('sitelist').querySelectorAll('[data-site]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.site);
        const i = S.prefs.siteIds.indexOf(id);
        if (i >= 0) S.prefs.siteIds.splice(i, 1); else S.prefs.siteIds.push(id);
        b.classList.toggle('on');
      });
    });

    const tvLibs = S.libraries.filter((l) => l.type === 'tvshows');
    $('liblist').innerHTML = tvLibs.length
      ? tvLibs.map((l) => {
        const on = S.prefs.libraryIds.includes(l.id);
        return `<button class="dh-sel ${on ? 'on' : ''}" data-lib="${l.id}">${escapeHtml(l.name)}</button>`;
      }).join('')
      : '<span style="font-size:12px;color:var(--dh-muted)">没有剧集库</span>';
    $('liblist').querySelectorAll('[data-lib]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.lib;
        const i = S.prefs.libraryIds.indexOf(id);
        if (i >= 0) S.prefs.libraryIds.splice(i, 1); else S.prefs.libraryIds.push(id);
        b.classList.toggle('on');
      });
    });

    root.querySelector('[data-act="tgdigest"]').classList.toggle('on', !!S.prefs.digest);
    root.querySelector('[data-act="onlyfree"]').classList.toggle('on', S.prefs.onlyFree !== false);
    root.querySelector('[data-act="subauto"]').classList.toggle('on', S.prefs.subAuto !== false);
    root.querySelector('[data-act="autonew"]').classList.toggle('on', S.prefs.autoNew !== false);
    $('ptinterval').value = String(Math.max(5, Number(S.prefs.ptInterval) || 20));
    $('ptjitter').value = String(S.prefs.ptJitter === undefined ? 30 : Number(S.prefs.ptJitter));
    $('ptdaily').value = String(Number(S.prefs.ptDaily) || 0);
    $('subbudget').value = String(Number(S.prefs.subBudget) || 10);
    $('subinterval').value = String(Number(S.prefs.subInterval) || 6);
    $('subfan').value = String(Math.max(1, Number(S.prefs.subFan) || 2));
    $('subsperrun').value = String(Number(S.prefs.subsPerRun) || 0);
    $('subcap').textContent = capText();
    $('ptusage').textContent = usageText();
    $('modal').classList.add('on');
  };

  const saveSettings = async () => {
    const rawDl = $('seldownloader').value;
    // 下载器必须手动确认一次，不允许留空蒙混过去
    if (S.downloaders.length && !rawDl) {
      const box = $('dlnow');
      box.className = 'dh-dlnow warn';
      box.textContent = '请先在上面选择一个下载器，再点保存。';
      $('seldownloader').focus();
      return;
    }
    S.prefs.downloaderId = rawDl ? Number(rawDl) : null;
    S.prefs.downloaderName = rawDl ? (dlName(Number(rawDl)) || null) : null;
    S.prefs.ptInterval = Math.max(5, Math.min(3600, Number($('ptinterval').value) || 20));
    S.prefs.ptJitter = Math.max(0, Math.min(80, Number($('ptjitter').value) || 0));
    S.prefs.ptDaily = Math.max(0, Math.min(999, Number($('ptdaily').value) || 0));
    S.prefs.subBudget = Math.max(1, Math.min(30, Number($('subbudget').value) || 10));
    S.prefs.subInterval = Math.max(1, Math.min(168, Number($('subinterval').value) || 6));
    S.prefs.subFan = Math.max(1, Math.min(5, Number($('subfan').value) || 2));
    S.prefs.subsPerRun = Math.max(0, Math.min(100, Number($('subsperrun').value) || 0));
    const ok = await writeKV('prefs', S.prefs);
    $('modal').classList.remove('on');
    const who = dlName(S.prefs.downloaderId);
    toast(ok
      ? (who ? '已固定使用 ' + who + '，之后的下载都用它' : '设置已保存（未指定下载器）')
      : '设置保存失败（存储不可写）', ok ? 'ok' : 'err');
    renderStats();
    if (S.channel === 'mine') loadChannel('mine');
    if (S.channel === 'subs') renderSubs();
    updatePills();
  };

  const pushDigestNow = async () => {
    try {
      const key = 'digest:manual:' + Date.now();
      await ctx.tasks.run('digest', key, { manual: true, limit: 8 });
      toast('速递已提交，稍后可在通知渠道查看', 'ok');
    } catch (e) {
      toast('推送失败：' + (e && e.message ? e.message : e), 'err');
    }
  };

  /** ---------- 顶部状态 ---------- */
  const updatePills = () => {
    const embyDot = root.querySelector('[data-k="emby"]');
    const embyV = root.querySelector('[data-k="embyv"]');
    if (S.embyOk) {
      embyDot.className = 'dh-dot';
      embyV.textContent = S.stats.dramaCount > 0 ? `${S.stats.dramaCount} 部` : '已连接';
    } else { embyDot.className = 'dh-dot off'; embyV.textContent = '未连接'; }

    const ptDot = root.querySelector('[data-k="pt"]');
    const ptV = root.querySelector('[data-k="ptv"]');
    ptDot.className = S.sites.length ? 'dh-dot' : 'dh-dot warn';
    ptV.textContent = S.sites.length ? `${S.sites.length} 站点` : '无可用';

    const tgDot = root.querySelector('[data-k="tg"]');
    const tgV = root.querySelector('[data-k="tgv"]');
    const tgOn = S.prefs.digest;
    tgDot.className = tgOn ? 'dh-dot' : 'dh-dot off';
    tgV.textContent = tgOn ? '已开启' : '已关闭';
  };

  /** ---------- 事件 ---------- */
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'settings') openModal();
    else if (act === 'closemodal') $('modal').classList.remove('on');
    else if (act === 'savesettings') saveSettings();
    else if (act === 'closedrawer') closeDrawer();
    else if (act === 'refresh') { loadChannel(S.channel); toast('已刷新'); }
    else if (act === 'clearq') {
      $('q').value = '';
      $('searchbox').classList.remove('has');
      switchChannel(S.channel);
    } else if (act === 'findpt') {
      // 漫剧标题带「动态漫」后缀，站上资源不会这么写，检索前先还原成核心片名
      searchPT(cleanPTName(S.detail?.name || S.detail?.title));
    } else if (act === 'sub') {
      addSub(S.detail || {});
    } else if (act === 'onlyfree') {
      S.prefs.onlyFree = !(S.prefs.onlyFree !== false);
      t.classList.toggle('on', S.prefs.onlyFree);
      if (S.torrents.length) renderTorrents(S.torrents, '');
    } else if (act === 'subauto') {
      S.prefs.subAuto = !(S.prefs.subAuto !== false);
      t.classList.toggle('on', S.prefs.subAuto);
    } else if (act === 'autonew') {
      S.prefs.autoNew = !(S.prefs.autoNew !== false);
      t.classList.toggle('on', S.prefs.autoNew);
      $('subcap').textContent = capText();
    } else if (act === 'subfilter') {
      S.subFilter = t.dataset.f || 'all';
      if (S.channel === 'subs') renderSubs();
    } else if (act === 'subnew') {
      const i = Number(t.dataset.i);
      const s = S.subs[i];
      if (s) {
        s.autoNew = s.autoNew === false;
        if (s.autoNew) s.nextAt = 0;
        const on = s.autoNew;
        // 必须先落盘再重绘，否则重绘会读到旧存储把开关弹回去
        saveSubs().then(() => {
          toast(on ? '已开启追新：只下新集' : '已暂停追新：不再自动下载', 'ok');
          if (S.channel === 'subs') renderSubs();
        });
      }
    } else if (act === 'resetusage') {
      S.prefs.ptUsage = {};
      S.prefs.ptLast = 0;
      writeKV('prefs', S.prefs);
      $('ptusage').textContent = usageText();
      toast('访问计数已重置', 'ok');
    } else if (act === 'subcheck') {
      runSubsNow();
    } else if (act === 'tgdigest') {
      S.prefs.digest = !S.prefs.digest;
      t.classList.toggle('on', S.prefs.digest);
      updatePills();
    } else if (act === 'pushnow') {
      pushDigestNow();
    }
  });

  $('mask').addEventListener('click', closeDrawer);

  const q = $('q');
  const searchForm = $('searchbox');
  q.addEventListener('input', () => searchForm.classList.toggle('has', !!q.value));
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kw = q.value.trim();
    if (!kw) return;
    if (S.channel === 'hg') { hgSearch(kw); return; }
    S.loading = true;
    $('sech').textContent = `搜索：${kw}`;
    $('sechint').textContent = 'TMDB 结果';
    skeleton();
    try {
      const list = await tmdbSearch(kw, 1);
      S.items = list;
      renderItems(list);
      if (!list.length) toast('没有搜到相关剧集');
    } catch (err) {
      empty('搜索失败', escapeHtml(err && err.message ? err.message : String(err)));
    } finally { S.loading = false; }
  });

  /** 红果频道内的独立搜索：片名以站点为准，比 TMDB 全，也更适合拿去 PT 搜 */
  const hgSearch = async (kw) => {
    if (!kw) return;
    S.channel = 'hg';
    S.hgKw = kw;
    S.hgPage = 1;
    renderChips();
    renderHgTabs();
    S.loading = true;
    skeleton();
    try {
      const d = await hgFetch('search', { kw: kw, page: 1 });
      S.items = d.items || [];
      S.hgPages = d.totalPages || 1;
      S.hgTotal = d.total || S.items.length;
      $('sech').textContent = '红果 · 搜索「' + kw + '」';
      $('sechint').textContent = d.total ? ('共 ' + d.total + ' 部，片名与集数以站点为准') : '站点没有匹配的剧';
      S.hgRoute = 'search';
      renderHgItems(S.items);
      renderHgTabs();
      if (!S.items.length) toast('红果里没有搜到，换个词试试');
    } catch (err) {
      S.items = [];
      empty('红果搜索失败', escapeHtml(String(err && err.message ? err.message : err)));
    } finally {
      S.loading = false;
      renderHgPager();
    }
  };

  /** ---------- 订阅：巡检与列表 ---------- */
  const whenText = (ts) => {
    if (!ts) return '未巡检';
    const d = Math.floor((Date.now() - ts) / 60000);
    if (d < 1) return '刚刚';
    if (d < 60) return d + ' 分钟前';
    if (d < 1440) return Math.floor(d / 60) + ' 小时前';
    return Math.floor(d / 1440) + ' 天前';
  };

  const runSubsNow = async () => {
    try {
      const run = await ctx.tasks.run('subs', 'subs:manual:' + Date.now(), { manual: true });
      toast('订阅巡检已提交，完成后会自动刷新', 'ok');
      watchSubs(run && run.id);
    } catch (e) {
      toast('巡检失败：' + (e && e.message ? e.message : e), 'err');
    }
  };

  // 巡检是后台作业，等它真正跑完再刷新列表，否则会看到「未巡检」的旧状态
  const watchSubs = async (id) => {
    const refresh = () => { if (S.channel === 'subs') loadChannel('subs'); };
    if (!id) { setTimeout(refresh, 8000); return; }
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const t = await ctx.tasks.get(id);
        if (!t) continue;
        if (t.status === 'succeeded') { refresh(); toast('巡检完成，结果已更新', 'ok'); return; }
        if (t.status === 'failed') { refresh(); toast('巡检失败：' + (t.error || '未知原因'), 'err'); return; }
      } catch { break; }
    }
    refresh();
  };

  const nextText = (ts) => {
    if (!ts) return '待查';
    const left = ts - Date.now();
    if (left <= 0) return '待查';
    const m = Math.ceil(left / 60000);
    if (m < 60) return m + ' 分钟后';
    return Math.round(m / 60) + ' 小时后';
  };

  const renderSubs = async () => {
    await loadSubs();
    showFront(false);
    const g = $('grid');
    g.style.display = 'block';
    const onFree = S.prefs.onlyFree !== false;
    const onAuto = S.prefs.subAuto !== false;
    const onNew = S.prefs.autoNew !== false;
    const dzName = dlName(S.prefs.downloaderId);
    const st = subStats();
    const dueSeg = st.due || !dueText() ? '' : ' · ' + dueText();
    const head = `<div class="dh-subhead">
      <div><b>${st.active}</b> 部在追 · <b>${st.due}</b> 部待查 · <b>${st.done}</b> 部已追完${dueSeg} · 只下免费种 <b>${onFree ? '开' : '关'}</b> · 下载到 <b>${dzName ? escapeHtml(dzName) : '未指定'}</b></div>
      <div style="display:flex;gap:8px;flex:0 0 auto;flex-wrap:wrap">
        ${dzName ? '' : '<button class="dh-btn sec" style="height:34px;padding:0 14px" data-act="settings">选择下载器</button>'}
        <button class="dh-btn sec" style="height:34px;padding:0 14px" data-act="subcheck">立即巡检</button>
      </div>
    </div>
    <div class="dh-fbar">
      ${[['all', '全部', st.total], ['due', '待追新', st.due], ['wait', '追新中', st.active - st.due], ['done', '已追完', st.done], ['off', '已暂停', st.paused]]
        .map(([k, label, n]) => `<button class="dh-fchip ${S.subFilter === k ? 'on' : ''}" data-act="subfilter" data-f="${k}">${label}<i>${n}</i></button>`).join('')}
    </div>
    <div class="dh-cap" style="margin-bottom:14px">${escapeHtml(capText())}</div>`;

    if (!S.subs.length) {
      g.innerHTML = head + `<div class="dh-empty">
        <div class="e1">${ICONS.bell}</div>
        <div class="e2">还没有订阅</div>
        <div class="e3">在任意短剧详情里点「订阅追新」，之后每次出现新集都会自动下载</div>
      </div>`;
      return;
    }

    const now = Date.now();
    const rows = [];
    S.subs.forEach((s, i) => {
      const isDone = !!s.complete;
      const paused = s.autoNew === false && s.got;
      const due = !isDone && !paused && (!s.nextAt || s.nextAt <= now);
      const f = S.subFilter || 'all';
      if (f === 'due' && !due) return;
      if (f === 'wait' && (due || isDone || paused)) return;
      if (f === 'done' && !isDone) return;
      if (f === 'off' && !paused) return;
      rows.push({ s, i, isDone, paused, due });
    });

    const body = rows.length ? rows.map(({ s, i, isDone, paused, due }) => {
      const epTxt = isDone
        ? `全集完成${s.total ? ' · ' + s.total + '集' : ''}`
        : Number(s.ep) > 0
          ? (Number(s.total) > 0 ? `第 ${s.ep}/${s.total} 集` : `追至第 ${s.ep} 集`)
          : '未开始';
      const auto = s.autoNew !== false;
      return `
      <div class="dh-subrow">
        <div class="si"${s.poster ? ` style="background-image:url(https://image.tmdb.org/t/p/w185${s.poster})"` : ''}></div>
        <div class="st">
          <div class="sn"><span class="snt">${escapeHtml(s.name)}</span><span class="dh-ep ${isDone ? 'done' : ''}">${escapeHtml(epTxt)}</span></div>
          <div class="sm">
            <span>${whenText(s.last)}</span>
            <span>${escapeHtml(s.lastResult || '等待首次巡检')}</span>
            ${!isDone && !paused ? `<span>${due ? '本轮待查' : nextText(s.nextAt)}</span>` : ''}
            ${paused ? '<span>追新已暂停</span>' : ''}
          </div>
        </div>
        <div class="sa">
          <button class="dh-mini2 ${isDone ? 'off' : (auto ? 'on' : 'off')}" data-act="subnew" data-i="${i}" title="${auto ? '追新中：命中新集会自动下载' : '已暂停追新'}">${auto ? '追新' : '暂停'}</button>
          <button class="dh-mini2" data-subfind="${i}">找资源</button>
          <button class="dh-mini2 danger" data-subdel="${i}">移除</button>
        </div>
      </div>`;
    }).join('') : `<div class="dh-empty" style="padding:34px 20px">
        <div class="e2">这个筛选下没有订阅</div>
        <div class="e3">切换到「全部」看看</div>
      </div>`;

    g.innerHTML = head + body;

    g.querySelectorAll('[data-subfind]').forEach((b) => {
      b.addEventListener('click', () => {
        const s = S.subs[Number(b.dataset.subfind)];
        openDetail({ name: s.name, id: s.tmdbId, poster_path: s.poster }, true);
      });
    });
    g.querySelectorAll('[data-subdel]').forEach((b) => {
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.subdel);
        const nm = S.subs[i] && S.subs[i].name;
        S.subs.splice(i, 1);
        await saveSubs();
        toast('已移除订阅：' + String(nm || '').slice(0, 14));
        renderSubs();
      });
    });
  };

  /** ---------- 启动 ---------- */
  const boot = async () => {
    renderChips();
    renderStats();
    updatePills();

    // 设置
    const prefs = await readKV('prefs', null);
    if (prefs && typeof prefs === 'object') S.prefs = { ...S.prefs, ...prefs };
    // 老配置一次性升级到并行调度：旧的 60 秒 / 30 秒单轮间隔降到 20 秒，
    // 再叠加「每个站点各跑一路」，全量一轮的速度是原来的 6 倍。只升级一次，之后完全听用户的。
    if (!S.prefs.cfgVer) {
      const old = Number(S.prefs.ptInterval);
      if (old === 60 || old === 30) S.prefs.ptInterval = 20;
      S.prefs.cfgVer = 2;
      await writeKV('prefs', S.prefs);
    }
    await loadSubs();
    renderChips();

    // 片库快照（页面统计或后台同步作业写入）
    const snap = await readKV('library', null);
    if (snap && snap.count) {
      S.stats = { ...S.stats, dramaCount: snap.count, episodeCount: snap.episodes || 0 };
    }

    // 下载器与站点（失败不阻塞）
    try {
      const d = await ctx.api.get('/api/pt/downloaders');
      S.downloaders = (d.data || d.items || d || []).filter(Boolean);
    } catch { S.downloaders = []; }

    // 兼容旧数据：只有 id 没有名称时补齐（宿主下载接口只认名称）
    if (S.prefs.downloaderId && !S.prefs.downloaderName) {
      const nm = dlName(S.prefs.downloaderId);
      if (nm) { S.prefs.downloaderName = nm; await writeKV('prefs', S.prefs); }
    }

    // 手动指定的下载器若已被删除或改名，清掉并提示重选，避免一直对着失效 id 提交
    if (S.prefs.downloaderId && S.downloaders.length && !dlOf(S.prefs.downloaderId)) {
      S.prefs.downloaderId = null;
      S.prefs.downloaderName = null;
      await writeKV('prefs', S.prefs);
      toast('原先固定的下载器已不存在，请到设置里重新选择', 'err');
    }
    try {
      const d = await ctx.api.get('/api/pt/sites');
      const arr = Array.isArray(d) ? d : (d.sites || d.items || d.data || []);
      S.sites = arr.filter((s) => s.enabled && s.search_enabled !== false);
    } catch { S.sites = []; }

    // 类型 id → 中文名
    try {
      const g = await ctx.api.get('/api/tmdb/genres?media_type=tv');
      const map = {};
      for (const x of (g.genres || [])) map[x.id] = x.name;
      S.genreMap = map;
    } catch { S.genreMap = {}; }

    // Emby
    try {
      const libs = await ctx.api.get('/api/plugin-host/emby/libraries');
      S.libraries = libs.items || [];
      S.embyOk = S.libraries.length > 0;
    } catch { S.libraries = []; S.embyOk = false; }

    renderStats();
    updatePills();
    await loadChannel('pick');

    // 首次进入且没有可用片库快照时，后台静默统计一次（旧格式快照也要重算）
    if (S.embyOk && !(snap && snap.count) && S.channel !== 'mine') {
      setTimeout(() => { loadLibraryStats().catch(() => {}); }, 600);
    }
  };

  try { await boot(); }
  catch (e) {
    empty('初始化失败', escapeHtml(String(e && e.message ? e.message : e)) + '<br>请检查宿主 TMDB / Emby / PT 配置。');
  }
}
