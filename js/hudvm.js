// 保卫萝卜 V2 · HUD 视图模型（纯函数）
// 把「状态 → HUD 各字段该显示什么」抽成不碰 DOM 的纯数据。
// 好处：ui.js 只把真的变了的字段写进 DOM；benchmark.mjs 可以直接 import
// 本模块对 10Hz 刷新的写入次数做 A/B 实验。

/** 由状态算出 HUD 视图模型；展示文案与卡片表由调用方传入。 */
export function hudViewModel(state, cfg) {
  const { WAVE_COUNT, CARROT_HP, nextWave, banner } = cfg;
  const over = state.phase === "won" || state.phase === "lost";
  const ratio = state.hp / CARROT_HP;

  let startText;
  let startDisabled;
  if (over) {
    startText = "已结束";
    startDisabled = true;
  } else if (state.phase === "build" && !state.paused) {
    startText = `立即开战（${Math.max(0, Math.ceil(state.buildTimer))}s）`;
    startDisabled = false;
  } else if (state.paused) {
    startText = "已暂停";
    startDisabled = true;
  } else {
    startText = "战斗中";
    startDisabled = true;
  }

  return {
    coins: Math.floor(state.coins),
    wave: `${state.wave}/${WAVE_COUNT}`,
    hpText: state.hp,
    hpWidth: `${ratio * 100}%`,
    hpClass: ratio > 0.5 ? "ok" : ratio > 0.25 ? "warn" : "bad",
    speedText: `${state.speed}×`,
    pauseText: state.paused ? "继续" : "暂停",
    speedPressed: state.speed > 1 ? "true" : "false",
    pausePressed: state.paused ? "true" : "false",
    startText,
    startDisabled,
    pauseDisabled: over,
    speedDisabled: over,
    banner,
    bannerClass: state.phase === "wave" ? "banner live" : "banner",
    nextWave,
    nextWaveShow: nextWave ? "" : "none",
    cards: cfg.cardIds.map((id) => ({
      id,
      disabled: over || state.coins < cfg.cardCost(id),
      poor: state.coins < cfg.cardCost(id),
    })),
  };
}

/**
 * 差量应用：只有值真的变了才调用对应的写入器。
 * @param {object} vm 本次视图模型
 * @param {object} prev 上次的扁平值缓存（会被原地更新）
 * @param {object} w 写入器集合：字段同名函数，cards 用 w.card(id, item, changed)
 * @param {{n:number}} counter 可选计数器（实验台统计真实写入次数）
 */
export function applyHudViewModel(vm, prev, w, counter) {
  let writes = 0;
  const put = (key, value, apply) => {
    if (prev[key] === value) return;
    apply(value);
    prev[key] = value;
    writes += 1;
    if (counter) counter.n += 1;
  };

  put("coins", vm.coins, (v) => w.coins(v));
  put("wave", vm.wave, (v) => w.wave(v));
  put("hpText", vm.hpText, (v) => w.hpText(v));
  put("hpWidth", vm.hpWidth, (v) => w.hpWidth(v));
  put("hpClass", vm.hpClass, (v) => w.hpClass(v));
  put("speedText", vm.speedText, (v) => w.speedText(v));
  put("pauseText", vm.pauseText, (v) => w.pauseText(v));
  put("speedPressed", vm.speedPressed, (v) => w.speedPressed(v));
  put("pausePressed", vm.pausePressed, (v) => w.pausePressed(v));
  put("startText", vm.startText, (v) => w.startText(v));
  put("startDisabled", vm.startDisabled, (v) => w.startDisabled(v));
  put("pauseDisabled", vm.pauseDisabled, (v) => w.pauseDisabled(v));
  put("speedDisabled", vm.speedDisabled, (v) => w.speedDisabled(v));
  put("banner", vm.banner, (v) => w.banner(v));
  put("bannerClass", vm.bannerClass, (v) => w.bannerClass(v));
  put("nextWave", vm.nextWave, (v) => w.nextWave(v));
  put("nextWaveShow", vm.nextWaveShow, (v) => w.nextWaveShow(v));

  // 卡片：按 id 记 key，避免每次 querySelectorAll 后整批重写。
  prev.cards ||= {};
  for (const card of vm.cards) {
    const last = prev.cards[card.id] || "";
    const now = `${card.disabled}:${card.poor}`;
    if (last === now) continue;
    prev.cards[card.id] = now;
    w.card(card.id, card);
    writes += 1;
    if (counter) counter.n += 1;
  }

  return writes;
}
