// 保卫萝卜 V2 · UI 层
// 负责 DOM、输入、循环；不含任何玩法规则（规则在 game.js）。

import {
  TILE, COLS, ROWS, WIDTH, HEIGHT, TOWERS, TOWER_ORDER, MAX_LEVEL, SPEEDS, CARROT_HP, ECONOMY, isBuildableTile,
  WAVES, ENEMIES, WAVE_COUNT,
} from "./data.js";
import {
  createGame, update, placeTower, upgradeTower, sellTower, startWave, togglePause,
  cycleSpeed, upgradeCostOf, towerAt, snapshot, PHASE,
} from "./game.js";
import { statsAt, investedOf } from "./rules.js";
import { buildBackground, drawScene, drawBody } from "./render.js";

const $ = (id) => document.getElementById(id);

// ---------------- 音频（WebAudio 现场合成，零素材） ----------------
// 不用任何 .mp3/.wav：全部用振荡器与噪声算出来，所以体积是 0 字节。
const Sfx = (() => {
  let ac = null;
  // 存储可能被禁用（沙盒 iframe、部分隐私模式）。这里一旦抛异常，整个模块加载失败、整站白屏。
  const store = {
    get() { try { return localStorage.getItem("carrot-muted"); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem("carrot-muted", v); } catch (e) { /* 存不了就算了 */ } },
  };
  let muted = store.get() === "1";
  const acx = () => {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  };
  function tone(freq, dur = 0.12, type = "square", gain = 0.05, delay = 0, slide = 0) {
    if (muted) return;
    const a = acx();
    if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }
  function noise(dur = 0.12, gain = 0.03, delay = 0) {
    if (muted) return;
    const a = acx();
    if (!a) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    const g = a.createGain();
    const t0 = a.currentTime + delay;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.buffer = buf;
    src.connect(g).connect(a.destination);
    src.start(t0);
  }
  return {
    shoot() { tone(300, 0.05, "square", 0.022, 0, -140); noise(0.04, 0.012); },
    build() { tone(523, 0.08, "triangle", 0.05); tone(784, 0.09, "triangle", 0.04, 0.06); },
    upgrade() { [523, 659, 784].forEach((f, i) => tone(f, 0.1, "triangle", 0.045, i * 0.055)); },
    sell() { tone(400, 0.1, "triangle", 0.035, 0, -170); },
    wave() { tone(392, 0.13, "sine", 0.05); tone(523, 0.16, "sine", 0.05, 0.11); },
    clear() { [659, 880].forEach((f, i) => tone(f, 0.12, "sine", 0.04, i * 0.08)); },
    leak() { tone(170, 0.32, "sawtooth", 0.07, 0, -70); noise(0.2, 0.035); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.24, "triangle", 0.05, i * 0.11)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, "sine", 0.055, i * 0.15)); },
    toggle() {
      muted = !muted;
      store.set(muted ? "1" : "0");
      if (!muted) tone(660, 0.1, "triangle", 0.04);
      return muted;
    },
    get muted() { return muted; },
  };
})();

let state = createGame(Date.now() & 0xffff);
let background = null;
let ctx = null;
let canvas = null;
let selectedType = null;
let selectedTowerId = null;
let hover = null;
let hoverOk = false;
let lastTs = 0;
let toastTimer = 0;

// ---------------- 初始化 ----------------
function mount() {
  canvas = $("board");
  canvas.width = WIDTH * (window.devicePixelRatio || 1);
  canvas.height = HEIGHT * (window.devicePixelRatio || 1);
  ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  background = buildBackground();

  buildShop();
  bindEvents();
  window.__game = {
    get state() { return state; },
    snapshot: () => snapshot(state),
    place: (c, r, t) => placeTower(state, c, r, t),
    upgrade: (id) => upgradeTower(state, id),
    sell: (id) => sellTower(state, id),
    startWave: () => startWave(state),
    togglePause: () => togglePause(state),
    cycleSpeed: () => cycleSpeed(state),
    restart,
    selectType,
    get selectedType() { return selectedType; },
    get selectedTowerId() { return selectedTowerId; },
    setSelectedTower: (id) => { selectedTowerId = id; syncInspect(); },
    refresh: renderHud,
    get muted() { return Sfx.muted; },
    toggleMute: () => Sfx.toggle(),
  };
  renderHud();
  requestAnimationFrame(loop);
}

function buildShop() {
  const shop = $("shop");
  shop.innerHTML = "";
  for (const type of TOWER_ORDER) {
    const def = TOWERS[type];
    const card = document.createElement("button");
    card.className = "card";
    card.dataset.type = type;
    card.innerHTML = `
      <canvas class="icon" width="120" height="120"></canvas>
      <span class="name">${def.name}</span>
      <span class="price">${def.cost}</span>
    `;
    const icon = card.querySelector("canvas");
    const ictx = icon.getContext("2d");
    ictx.setTransform(2, 0, 0, 2, 0, 0);
    ictx.translate(30, 34);
    drawBody(ictx, 0, 0, type, 1, -Math.PI / 2, 0);
    card.addEventListener("click", () => selectType(type));
    shop.appendChild(card);
  }
}

function selectType(type) {
  selectedType = type;
  selectedTowerId = null;
  syncShop();
  syncInspect();
}

function syncShop() {
  document.querySelectorAll(".card").forEach((c) => {
    c.classList.toggle("active", c.dataset.type === selectedType);
  });
}

// ---------------- 输入 ----------------
function bindEvents() {
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", () => { hover = null; });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    selectedTowerId = null;
    syncInspect();
  });

  $("startBtn").addEventListener("click", () => {
    const r = startWave(state);
    if (!r.ok) toast(r.reason);
  });
  $("pauseBtn").addEventListener("click", () => {
    const r = togglePause(state);
    if (!r.ok) return;
    // 立即刷新：否则按钮状态要等下一次 HUD 节拍（最多 100ms），这段时间点开波会被静默吞掉
    renderHud();
  });
  $("speedBtn").addEventListener("click", () => {
    const r = cycleSpeed(state);
    if (!r.ok) toast(r.reason);
  });
  $("restartBtn").addEventListener("click", () => restart());
  const muteBtn = $("muteBtn");
  if (muteBtn) {
    const paint = () => {
      muteBtn.textContent = Sfx.muted ? "静音" : "声音";
      muteBtn.classList.toggle("off", Sfx.muted);
      muteBtn.setAttribute("aria-pressed", Sfx.muted ? "true" : "false");
    };
    paint();
    muteBtn.addEventListener("click", () => { Sfx.toggle(); paint(); });
  }
  $("againBtn").addEventListener("click", () => restart());

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", resizeCanvas);
}

function onKeyDown(ev) {
  const over = state.phase === PHASE.WON || state.phase === PHASE.LOST;
  if (ev.key === "r" || ev.key === "R") { restart(); return; }
  if (over) return; // 结束后所有游戏快捷键失效
  const idx = "12345".indexOf(ev.key);
  if (idx >= 0) { selectType(TOWER_ORDER[idx]); return; }
  if (ev.code === "Space") {
    ev.preventDefault();
    if (!state.paused) startWave(state);
    return;
  }
  if (ev.key === "p" || ev.key === "P") {
    if (togglePause(state).ok) renderHud();
    return;
  }
  if (ev.key === "Escape") {
    if (state.paused) { togglePause(state); $("pauseBtn").textContent = "暂停"; }
    selectedTowerId = null;
    syncInspect();
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function toLogical(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * WIDTH,
    y: ((ev.clientY - rect.top) / rect.height) * HEIGHT,
  };
}

function cellAt(ev) {
  const p = toLogical(ev);
  const col = Math.floor(p.x / TILE);
  const row = Math.floor(p.y / TILE);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return { col, row };
}

function onPointerMove(ev) {
  const cell = cellAt(ev);
  if (!cell || !selectedType) { hover = null; return; }
  const occupied = towerAt(state, cell.col, cell.row);
  hover = { ...cell, type: occupied ? occupied.type : selectedType };
  hoverOk = Boolean(occupied) || isPlaceable(cell.col, cell.row);
}

function isPlaceable(col, row) {
  // 只做悬停提示，真正的判定在 placeTower 里
  if (towerAt(state, col, row)) return false;
  return canBuild(col, row);
}

const canBuild = isBuildableTile;

function onPointerDown(ev) {
  ev.preventDefault();
  const cell = cellAt(ev);
  if (!cell) return;
  const existing = towerAt(state, cell.col, cell.row);
  if (existing) {
    selectedTowerId = existing.id;
    selectedType = null;
    syncShop();
    syncInspect();
    return;
  }
  if (!selectedType) {
    toast("先在下方选一种塔");
    return;
  }
  const r = placeTower(state, cell.col, cell.row, selectedType);
  if (!r.ok) {
    toast(r.reason);
    return;
  }
  selectedTowerId = r.tower.id;
  // 一次只放一座：放完自动松开，想再建就再点一次塔卡
  selectedType = null;
  hover = null;
  syncShop();
  syncInspect();
}

// ---------------- HUD ----------------
let hudAcc = 0;
function renderHud() {
  const s = snapshot(state);
  $("coins").textContent = s.coins;
  $("wave").textContent = `${s.wave}/${WAVE_COUNT}`;
  $("hpText").textContent = s.hp;
  $("hpFill").style.width = `${(s.hp / CARROT_HP) * 100}%`;
  $("hpFill").className = s.hp / CARROT_HP > 0.5 ? "ok" : s.hp / CARROT_HP > 0.25 ? "warn" : "bad";
  $("speedBtn").textContent = `${state.speed}×`;
  $("pauseBtn").textContent = state.paused ? "继续" : "暂停";
  $("speedBtn").setAttribute("aria-pressed", state.speed > 1 ? "true" : "false");
  $("pauseBtn").setAttribute("aria-pressed", state.paused ? "true" : "false");

  const over = state.phase === PHASE.WON || state.phase === PHASE.LOST;
  const startBtn = $("startBtn");
  if (over) {
    startBtn.disabled = true;
    startBtn.textContent = "已结束";
  } else if (state.phase === PHASE.BUILD && !state.paused) {
    startBtn.disabled = false;
    startBtn.textContent = `立即开战（${s.buildTimer}s）`;
  } else if (state.paused) {
    // 暂停是"全面冻结"：连开波也不许，否则恢复瞬间整波一起涌出
    startBtn.disabled = true;
    startBtn.textContent = "已暂停";
  } else {
    startBtn.disabled = true;
    startBtn.textContent = "战斗中";
  }
  $("pauseBtn").disabled = over;
  $("speedBtn").disabled = over;

  document.querySelectorAll(".card").forEach((card) => {
    const def = TOWERS[card.dataset.type];
    card.disabled = over || state.coins < def.cost;
    card.classList.toggle("poor", state.coins < def.cost);
  });

  const nw = $("nextWave");
  if (nw) {
    const preview = nextWaveText();
    nw.textContent = preview;
    nw.style.display = preview ? "" : "none";
  }
  $("banner").textContent = bannerText();
  $("banner").className = `banner ${state.phase === PHASE.WAVE ? "live" : ""}`;
  syncInspect();
  renderOverlay();
}

function nextWaveText() {
  if (state.phase !== PHASE.BUILD || state.wave >= WAVES.length) return "";
  // 布防阶段先把下一波告诉玩家：这波是"该攒钱升级"还是"该补一座冰塔"
  const groups = WAVES[state.wave] || [];
  const parts = groups.map((g) => `${ENEMIES[g.type].name} ×${g.count}`);
  const boss = groups.some((g) => g.type === "boss");
  return `下一波 第 ${state.wave + 1} 波　${parts.join(" ＋ ")}${boss ? "　⚠ 首领" : ""}`;
}

function bannerText() {
  if (state.paused) return "已暂停";
  if (state.phase === PHASE.BUILD) return state.wave === 0 ? "布防阶段 · 点塔卡，再点草地建造" : `第 ${state.wave} 波已清空 · 准备下一波`;
  if (state.phase === PHASE.WAVE) return `第 ${state.wave} 波进行中`;
  return "";
}

let inspectKey = null;

function syncInspect() {
  const box = $("inspect");
  const tower = state.towers.find((t) => t.id === selectedTowerId);

  if (!tower) {
    if (inspectKey !== "none") {
      inspectKey = "none";
      box.classList.remove("active");
      $("inspectBody").innerHTML = "<span class=\"hint\">先点下方塔卡选一种塔，再点草地建造；点场上已有的塔可升级 / 拆除</span>";
    }
    return;
  }

  // 只有"选中哪座塔"或"它升到几级"变了才重建 DOM。
  // 之前每次 HUD 刷新（10Hz）都整段重写 innerHTML，按钮在鼠标底下被换掉，手感发飘。
  const key = tower.id + ":" + tower.level;
  if (inspectKey !== key) {
    inspectKey = key;
    box.classList.add("active");
    const st = statsAt(tower);
    const upCost = tower.level >= MAX_LEVEL ? null : upgradeCostOf(tower);
    const refund = Math.floor(investedOf(tower) * ECONOMY.sellRefund);
    const parts = ["<b>" + tower.def.name + "</b>", "<span class=\"lv\">Lv." + tower.level + "</span>"];
    if (tower.def.damage) {
      parts.push("伤害 " + st.damage.toFixed(1), "射程 " + Math.round(st.range), "间隔 " + st.interval.toFixed(2) + "s");
    } else {
      parts.push("每 " + tower.def.interval + "s 产 " + st.income + " 金币");
    }
    if (tower.def.slow) parts.push("减速 " + Math.round(tower.def.slow.factor * 100) + "%");
    if (tower.def.splash) parts.push("溅射 " + tower.def.splash);
    if (tower.def.burn) parts.push("灼烧 " + tower.def.burn.dps + "/s");

    $("inspectBody").innerHTML =
      '<div class="stats">' + parts.map((x) => "<span>" + x + "</span>").join("") + "</div>" +
      '<div class="acts">' +
        '<button id="upBtn"' + (upCost === null ? " disabled" : "") + ">" + (upCost === null ? "已满级" : "升级 " + upCost) + "</button>" +
        '<button id="sellBtn" class="ghost">拆除 +' + refund + "</button>" +
      "</div>";

    const up = $("upBtn");
    if (up) {
      up.addEventListener("click", () => {
        const r = upgradeTower(state, tower.id);
        if (!r.ok) toast(r.reason);
        syncInspect();
      });
    }
    $("sellBtn").addEventListener("click", () => {
      const r = sellTower(state, tower.id);
      if (!r.ok) toast(r.reason);
      else selectedTowerId = null;
      syncInspect();
    });
  }

  // 每次刷新只改"能不能点"，不碰结构。
  // 暂停时按钮直接置灰——不该让用户点了才吃一句"暂停中不能升级"。
  const up = $("upBtn");
  if (up && tower.level < MAX_LEVEL) up.disabled = state.paused || state.coins < upgradeCostOf(tower);
  const sell = $("sellBtn");
  if (sell) sell.disabled = state.paused;
}

let overlayKey = null;

function renderOverlay() {
  const ov = $("overlay");
  const over = state.phase === PHASE.WON || state.phase === PHASE.LOST;
  if (!over) {
    ov.hidden = true;
    overlayKey = null;
    return;
  }
  ov.hidden = false;
  // 结算面板显示期间同样是 10Hz 刷新；内容没变就不重写 DOM
  const key = state.phase + ":" + state.hp + ":" + state.stats.kills + ":" + state.wave;
  if (overlayKey === key) return;
  overlayKey = key;
  const won = state.phase === PHASE.WON;
  $("overlayTitle").textContent = won ? "守住了！" : "萝卜被啃了";
  $("overlayText").innerHTML = won
    ? "你顶住了全部 " + WAVE_COUNT + " 波，剩 <b>" + state.hp + "</b> 点生命，击杀 <b>" + state.stats.kills + "</b> 只。"
    : "坚持到第 <b>" + state.wave + "</b> 波，击杀 <b>" + state.stats.kills + "</b> 只。再试一次？";
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

function restart() {
  const seed = Date.now() & 0xffff;
  state = createGame(seed);
  inspectKey = null;
  overlayKey = null;
  selectedTowerId = null;
  selectedType = null;
  syncShop();
  $("overlay").hidden = true;
  renderHud();
}

// ---------------- 主循环 ----------------
function loop(ts) {
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
  lastTs = ts;

  const events = update(state, dt);
  for (const ev of events) {
    switch (ev.type) {
      case "build": Sfx.build(); break;
      case "upgrade": Sfx.upgrade(); break;
      case "sell": Sfx.sell(); break;
      case "wave-start": Sfx.wave(); break;
      case "leak": Sfx.leak(); break;
      case "wave-clear":
        Sfx.clear();
        toast(`第 ${ev.wave} 波清空　+${ev.bonus} 金币`);
        break;
      case "won": Sfx.win(); break;
      case "lost":
        Sfx.lose();
        toast("生命归零");
        break;
      default: break;
    }
  }

  drawScene(ctx, state, {
    background,
    hover,
    hoverOk,
    selectedTower: state.towers.find((t) => t.id === selectedTowerId) || null,
  });

  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; renderHud(); }

  requestAnimationFrame(loop);
}

// 启动：模块脚本是 defer 执行的，DOMContentLoaded 可能已经过了，两种时机都要覆盖
function boot() {
  if (window.__booted) return;
  window.__booted = true;
  try {
    mount();
  } catch (err) {
    window.__bootError = String((err && err.stack) || err);
    throw err;
  }
}

window.addEventListener("error", (e) => {
  window.__bootError = String((e.error && e.error.stack) || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  window.__bootError = String((e.reason && e.reason.stack) || e.reason);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
