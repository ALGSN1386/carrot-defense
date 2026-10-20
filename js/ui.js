/**
 * 适配层：canvas 尺寸(DPR)、输入映射、HUD、商店、主循环。
 * 连接 逻辑层(game.js) 与 渲染层(render.js)，自身不含玩法规则。
 */

import {
  TOWERS, TOWER_ORDER, isBuildable, UPGRADE, BUILD_TIME, WIDTH, HEIGHT, TILE, COLS, ROWS,
} from './config.js';
import {
  createGame, update, placeTower, upgradeTower, sellTower, startWave,
  selectTower, towerAt, stats, restartable, totalWaves,
} from './game.js';
import { render } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const el = (id) => document.getElementById(id);
const hud = {
  life: el('hud-life'),
  coins: el('hud-coins'),
  wave: el('hud-wave'),
  timer: el('hud-timer'),
  shop: el('shop'),
  selected: el('selected-panel'),
  overlay: el('overlay'),
  overlayText: el('overlay-text'),
  overlayStats: el('overlay-stats'),
  speed: el('speed-btns'),
  startBtn: el('start-wave'),
  pauseBtn: el('pause-btn'),
  restartBtn: el('restart-btn'),
};

let state = createGame();
let selectedType = null;     // 当前选中的待建造塔类型
let paused = false;
let speed = 1;
let hover = null;            // {gx, gy, buildable, selectedType}
let lastTime = performance.now();

/* ---------------- 画布缩放（逻辑坐标 960×600，跟 DPR） ---------------- */

function resize() {
  const parent = canvas.parentElement;
  const cssW = Math.min(parent.clientWidth, 960);
  const cssH = cssW * (HEIGHT / WIDTH);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const scale = canvas.width / WIDTH; // 均匀缩放（宽高比固定）
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function toLogical(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * WIDTH;
  const y = ((clientY - rect.top) / rect.height) * HEIGHT;
  return { x, y };
}

/* ---------------- 商店 ---------------- */

function buildShop() {
  hud.shop.innerHTML = '';
  for (const typeId of TOWER_ORDER) {
    const def = TOWERS[typeId];
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.type = typeId;
    card.innerHTML = `
      <span class="dot" style="background:${def.color}"></span>
      <span class="c-name">${def.name}</span>
      <span class="c-cost">${def.cost}</span>`;
    card.addEventListener('click', () => selectBuildType(typeId));
    hud.shop.appendChild(card);
  }
}

function selectBuildType(typeId) {
  selectedType = selectedType === typeId ? null : typeId;
  selectTower(state, null);
  refreshShop();
  refreshSelected();
}

function refreshShop() {
  for (const card of hud.shop.children) {
    const def = TOWERS[card.dataset.type];
    const affordable = state.coins >= def.cost && state.phase !== 'won' && state.phase !== 'lost';
    card.classList.toggle('disabled', !affordable);
    card.classList.toggle('active', selectedType === card.dataset.type);
  }
}

/* ---------------- 选中塔面板 ---------------- */

function refreshSelected() {
  const t = state.towers.find((x) => x.id === state.selectedTowerId);
  if (!t) {
    hud.selected.classList.add('hidden');
    hud.selected.innerHTML = '';
    return;
  }
  hud.selected.classList.remove('hidden');
  const def = TOWERS[t.type];
  const s = stats(t);
  const maxed = t.level >= UPGRADE.maxLevel;
  const upCost = maxed ? null : Math.round(def.cost * (t.level === 1 ? 0.9 : 1.3));
  const refund = Math.round(t.invested * 0.6);

  let statLine;
  if (def.kind === 'income') {
    statLine = `产金 ${s.income}/7s`;
  } else {
    statLine = `伤害 ${s.damage} · 射程 ${Math.round(s.range)} · 间隔 ${s.rate.toFixed(2)}s`;
  }

  hud.selected.innerHTML = `
    <div class="sp-title"><span class="dot" style="background:${def.color}"></span>${def.name} · ${t.level}级</div>
    <div class="sp-stat">${statLine}</div>
    <div class="sp-actions">
      <button id="up-btn" ${maxed || state.coins < upCost ? 'disabled' : ''}>${maxed ? '已满级' : `升级 (${upCost})`}</button>
      <button id="sell-btn">拆除 (+${refund})</button>
    </div>`;
  el('up-btn').onclick = () => { upgradeTower(state, t.id); refreshSelected(); refreshShop(); };
  el('sell-btn').onclick = () => { sellTower(state, t.id); refreshSelected(); refreshShop(); };
}

/* ---------------- HUD ---------------- */

function refreshHud() {
  hud.life.textContent = state.carrotHp;
  hud.coins.textContent = state.coins;
  hud.wave.textContent = `${state.wave}/${totalWaves()}`;
  if (state.phase === 'build') {
    const t = Math.max(0, Math.ceil(state.buildTimer));
    hud.timer.textContent = `下一波 ${t}s`;
    hud.startBtn.disabled = false;
  } else if (state.phase === 'wave') {
    hud.timer.textContent = '交战中…';
    hud.startBtn.disabled = true;
  } else {
    hud.timer.textContent = state.phase === 'won' ? '通关' : '失败';
    hud.startBtn.disabled = true;
  }
}

function refreshSpeed() {
  for (const b of hud.speed.children) {
    b.classList.toggle('active', Number(b.dataset.speed) === speed);
  }
}

/* ---------------- 输入 ---------------- */

function onCanvasMove(e) {
  const { x, y } = toLogical(e.clientX, e.clientY);
  const gx = Math.floor(x / TILE);
  const gy = Math.floor(y / TILE);
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) { hover = null; return; }
  hover = { gx, gy, buildable: isBuildable(gx, gy), selectedType };
}

function onCanvasClick(e) {
  if (state.phase === 'won' || state.phase === 'lost') return;
  const { x, y } = toLogical(e.clientX, e.clientY);
  const gx = Math.floor(x / TILE);
  const gy = Math.floor(y / TILE);

  // 已选中“待建造类型” → 尝试建造
  if (selectedType) {
    const res = placeTower(state, gx, gy, selectedType);
    if (res.ok) {
      refreshShop();
      refreshSelected();
    } else {
      flash(res.message);
    }
    return;
  }
  // 否则尝试选中已有塔
  const existing = towerAt(state, gx, gy);
  selectTower(state, existing ? existing.id : null);
  refreshSelected();
}

let flashTimer = null;
function flash(msg) {
  const f = el('flash');
  f.textContent = msg;
  f.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.remove('show'), 1200);
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '5') {
      const idx = Number(e.key) - 1;
      if (TOWER_ORDER[idx]) selectBuildType(TOWER_ORDER[idx]);
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (state.phase === 'build') startWave(state);
    } else if (e.key === 'p' || e.key === 'P') {
      togglePause();
    } else if (e.key === 'Escape') {
      selectedType = null;
      selectTower(state, null);
      refreshShop(); refreshSelected();
    }
  });
}

/* ---------------- 控制 ---------------- */

function togglePause() { paused = !paused; hud.pauseBtn.textContent = paused ? '继续' : '暂停'; }

function restart() {
  state = createGame();
  selectedType = null;
  paused = false;
  hud.pauseBtn.textContent = '暂停';
  hud.overlay.classList.add('hidden');
  refreshShop(); refreshSelected(); refreshHud();
}

function showOverlay() {
  const won = state.phase === 'won';
  hud.overlayText.textContent = won ? '🥕 通关！萝卜守住了' : '💥 萝卜被吃掉了';
  hud.overlayStats.textContent = `坚持到第 ${state.wave} 波 · 击杀 ${state.kills} · 漏怪 ${state.leaks}`;
  hud.overlay.classList.remove('hidden');
}

/* ---------------- 主循环 ---------------- */

function frame(now) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.05); // 防止后台标签页回来时大跳

  if (!paused) {
    update(state, dt * speed);
  }
  render(ctx, state, { hover, selectedTower: state.towers.find((t) => t.id === state.selectedTowerId) });
  refreshHud();
  refreshShop();

  if ((state.phase === 'won' || state.phase === 'lost') && hud.overlay.classList.contains('hidden')) {
    showOverlay();
  }

  requestAnimationFrame(frame);
}

/* ---------------- 初始化 ---------------- */

function init() {
  resize();
  window.addEventListener('resize', resize);

  buildShop();
  refreshShop();

  canvas.addEventListener('mousemove', onCanvasMove);
  canvas.addEventListener('mouseleave', () => { hover = null; });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    selectedType = null;
    selectTower(state, null);
    refreshShop(); refreshSelected();
  });

  hud.startBtn.addEventListener('click', () => { if (state.phase === 'build') startWave(state); });
  hud.pauseBtn.addEventListener('click', togglePause);
  hud.restartBtn.addEventListener('click', restart);
  for (const b of hud.speed.children) {
    b.addEventListener('click', () => { speed = Number(b.dataset.speed); refreshSpeed(); });
  }

  bindKeys();
  refreshSpeed();
  requestAnimationFrame(frame);
}

init();
