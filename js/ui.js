/** UI 层：canvas 尺寸、输入映射、HUD、商店与主循环。 */

import { HEIGHT, SPEEDS, TILE, TOWERS, TOWER_ORDER, WIDTH, isBuildable } from './config.js';
import {
  createGame,
  placeTower,
  restartable,
  selectTower,
  sellTower,
  startWave,
  stats,
  totalWaves,
  towerAt,
  towerCost,
  update,
  upgradeTower,
} from './game.js';
import { draw } from './render.js';

const $ = (selector) => document.querySelector(selector);

const els = {
  canvas: $('#board'),
  coins: $('#coins'),
  wave: $('#wave'),
  waveTotal: $('#waveTotal'),
  hp: $('#hp'),
  hpBar: $('#hpBar'),
  buildInfo: $('#buildInfo'),
  startBtn: $('#startBtn'),
  pauseBtn: $('#pauseBtn'),
  speedBtn: $('#speedBtn'),
  restartBtn: $('#restartBtn'),
  shop: $('#shop'),
  inspect: $('#inspect'),
  inspectBody: $('#inspectBody'),
  banner: $('#banner'),
  overlay: $('#overlay'),
  overlayTitle: $('#overlayTitle'),
  overlayText: $('#overlayText'),
  againBtn: $('#againBtn'),
  toast: $('#toast'),
};

const ctx = els.canvas.getContext('2d');

let state = createGame();
let paused = false;
let gameSpeed = 1;
let placingType = null;
let hoverGx = null;
let hoverGy = null;
const view = { time: 0, background: null, placingType: null, hoverGx: null, hoverGy: null, canPlace: false };

let lastHud = { coins: -1, hp: -1, wave: -1, build: '' };

/* ---------------- 画布尺寸 ---------------- */

function resize() {
  // 逻辑坐标固定 960×600；实际分辨率跟随显示宽度与 DPR，保证高分屏不糊。
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssWidth = els.canvas.clientWidth || WIDTH;
  const scale = (cssWidth * dpr) / WIDTH;
  els.canvas.width = Math.round(WIDTH * scale);
  els.canvas.height = Math.round(HEIGHT * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function pointerToTile(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
  return { gx: Math.floor(x / TILE), gy: Math.floor(y / TILE), x, y };
}

/* ---------------- 提示 ---------------- */

let toastTimer;
function toast(message, tone = 'warn') {
  els.toast.textContent = message;
  els.toast.className = `toast toast--${tone} is-on`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), 1800);
}

/* ---------------- 商店 ---------------- */

function towerIcon(typeId) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const c = canvas.getContext('2d');
  c.translate(32, 40);
  // 复用渲染函数画出同一套塔，保证商店图标和场上长得一样
  drawPreview(c, typeId);
  return canvas;
}

function drawPreview(c, typeId) {
  const def = TOWERS[typeId];
  c.save();
  c.fillStyle = 'rgba(30, 50, 20, .18)';
  c.beginPath();
  c.ellipse(0, 14, 18, 7, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = def.color;
  c.beginPath();
  c.ellipse(0, 10, 20, 9, 0, 0, Math.PI * 2);
  c.fill();

  if (typeId === 'cannon') {
    c.rotate(-Math.PI / 2);
    c.fillStyle = '#2f6a3c';
    c.fillRect(0, -5, 20, 10);
    c.rotate(Math.PI / 2);
    c.fillStyle = '#3f8a4f';
    c.beginPath();
    c.ellipse(0, -6, 15, 14, 0, 0, Math.PI * 2);
    c.fill();
  } else if (typeId === 'ice') {
    c.fillStyle = '#bfeaff';
    for (let i = 0; i < 3; i += 1) {
      c.save();
      c.rotate((i / 3) * Math.PI * 2);
      c.beginPath();
      c.moveTo(0, -24);
      c.lineTo(6, -10);
      c.lineTo(0, -4);
      c.lineTo(-6, -10);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.fillStyle = '#7fc9f0';
    c.beginPath();
    c.arc(0, -10, 9, 0, Math.PI * 2);
    c.fill();
  } else if (typeId === 'magic') {
    const glow = c.createRadialGradient(0, -14, 1, 0, -14, 20);
    glow.addColorStop(0, '#e6d4ff');
    glow.addColorStop(1, '#7a5cd0');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(0, -14, 15, 0, Math.PI * 2);
    c.fill();
  } else if (typeId === 'sun') {
    for (let i = 0; i < 8; i += 1) {
      c.save();
      c.rotate((i / 8) * Math.PI * 2);
      c.fillStyle = i % 2 === 0 ? '#ffd34d' : '#ffb727';
      c.beginPath();
      c.ellipse(0, -18, 4.5, 9, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.fillStyle = '#8b5a2b';
    c.beginPath();
    c.arc(0, -6, 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffd75e';
    c.beginPath();
    c.arc(0, -6, 4, 0, Math.PI * 2);
    c.fill();
  } else if (typeId === 'flame') {
    c.fillStyle = '#6b4a34';
    c.fillRect(-12, -4, 24, 12);
    c.fillStyle = '#ff9a3c';
    c.beginPath();
    c.moveTo(0, -32);
    c.quadraticCurveTo(11, -16, 0, -5);
    c.quadraticCurveTo(-11, -16, 0, -32);
    c.fill();
    c.fillStyle = '#ffe066';
    c.beginPath();
    c.moveTo(0, -26);
    c.quadraticCurveTo(5, -15, 0, -9);
    c.quadraticCurveTo(-5, -15, 0, -26);
    c.fill();
  }
  c.restore();
}

function buildShop() {
  els.shop.replaceChildren();
  for (const typeId of TOWER_ORDER) {
    const def = TOWERS[typeId];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.type = typeId;
    card.innerHTML = `
      <span class="card__icon"></span>
      <span class="card__name">${def.name}</span>
      <span class="card__cost">${def.cost}</span>
    `;
    card.title = `${def.name}：${def.blurb}`;
    card.querySelector('.card__icon').append(towerIcon(typeId));
    card.addEventListener('click', () => {
      if (state.coins < def.cost) {
        toast(`金币不够，还差 ${def.cost - state.coins}`);
        return;
      }
      placingType = placingType === typeId ? null : typeId;
      state.selectedTowerId = null;
      renderShopState();
      renderInspect();
    });
    els.shop.append(card);
  }
}

function renderShopState() {
  for (const card of els.shop.children) {
    card.classList.toggle('is-active', card.dataset.type === placingType);
    card.classList.toggle('is-poor', state.coins < TOWERS[card.dataset.type].cost);
  }
}

/* ---------------- 选中塔面板 ---------------- */

function renderInspect() {
  const tower = state.towers.find((t) => t.id === state.selectedTowerId);
  if (!tower) {
    els.inspect.hidden = true;
    return;
  }
  const def = TOWERS[tower.type];
  const s = stats(tower);
  const canUpgrade = tower.level < 3;
  const cost = canUpgrade ? towerCost(tower.type, tower.level + 1) : 0;

  els.inspect.hidden = false;
  els.inspectBody.innerHTML = `
    <div class="inspect__head">
      <b>${def.name}</b>
      <span class="inspect__level">${'★'.repeat(tower.level)}${'☆'.repeat(3 - tower.level)}</span>
    </div>
    <div class="inspect__stats">
      ${def.kind === 'income'
        ? `<span>产出 <b>${s.income}</b> / ${def.incomeEvery}s</span>`
        : `<span>伤害 <b>${s.damage}</b></span><span>射程 <b>${Math.round(s.range)}</b></span><span>间隔 <b>${s.rate.toFixed(2)}s</b></span>`}
      <span>击杀 <b>${tower.kills}</b></span>
    </div>
    <div class="inspect__actions">
      <button class="btn btn--primary" id="upgradeBtn" ${canUpgrade ? '' : 'disabled'}>
        ${canUpgrade ? `升级 ${cost}` : '已满级'}
      </button>
      <button class="btn btn--ghost" id="sellBtn">拆除 +${Math.round(tower.invested * 0.6)}</button>
    </div>
  `;

  els.inspectBody.querySelector('#upgradeBtn')?.addEventListener('click', () => {
    const result = upgradeTower(state, tower.id);
    toast(result.message, result.ok ? 'good' : 'warn');
    renderInspect();
  });
  els.inspectBody.querySelector('#sellBtn')?.addEventListener('click', () => {
    const result = sellTower(state, tower.id);
    toast(result.message, 'good');
    renderInspect();
  });
}

/* ---------------- 输入 ---------------- */

function onMove(event) {
  const { gx, gy } = pointerToTile(event);
  hoverGx = gx;
  hoverGy = gy;
  view.hoverGx = gx;
  view.hoverGy = gy;
  view.canPlace = Boolean(placingType) && isBuildable(gx, gy) && !towerAt(state, gx, gy);
  els.canvas.style.cursor = placingType ? (view.canPlace ? 'copy' : 'not-allowed') : 'default';
}

function onClick(event) {
  if (state.phase === 'won' || state.phase === 'lost') return;
  const { gx, gy } = pointerToTile(event);

  if (placingType) {
    const result = placeTower(state, gx, gy, placingType);
    toast(result.message, result.ok ? 'good' : 'warn');
    if (result.ok) {
      placingType = null;
      renderShopState();
      renderInspect();
    }
    return;
  }

  const tower = towerAt(state, gx, gy);
  if (tower) {
    selectTower(state, tower.id);
  } else {
    state.selectedTowerId = null;
  }
  renderInspect();
}

function bindInput() {
  els.canvas.addEventListener('mousemove', onMove);
  els.canvas.addEventListener('mouseleave', () => {
    view.hoverGx = null;
    view.hoverGy = null;
  });
  els.canvas.addEventListener('click', onClick);
  els.canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    placingType = null;
    state.selectedTowerId = null;
    renderShopState();
    renderInspect();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      placingType = null;
      state.selectedTowerId = null;
      renderShopState();
      renderInspect();
    }
    const index = Number(event.key) - 1;
    if (index >= 0 && index < TOWER_ORDER.length) {
      const typeId = TOWER_ORDER[index];
      if (state.coins >= TOWERS[typeId].cost) {
        placingType = placingType === typeId ? null : typeId;
        renderShopState();
      } else {
        toast('金币不够');
      }
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (state.phase === 'build') startWave(state);
    }
    if (event.key === 'p' || event.key === 'P') togglePause();
  });

  els.startBtn.addEventListener('click', () => {
    const result = startWave(state);
    if (!result.ok) toast(result.message);
  });
  els.pauseBtn.addEventListener('click', togglePause);
  els.speedBtn.addEventListener('click', () => {
    const index = SPEEDS.indexOf(gameSpeed);
    gameSpeed = SPEEDS[(index + 1) % SPEEDS.length];
    els.speedBtn.textContent = `${gameSpeed}×`;
  });
  els.restartBtn.addEventListener('click', restart);
  els.againBtn.addEventListener('click', restart);
  window.addEventListener('resize', resize);
}

function togglePause() {
  paused = !paused;
  els.pauseBtn.textContent = paused ? '继续' : '暂停';
  els.pauseBtn.classList.toggle('is-on', paused);
}

function restart() {
  state = createGame();
  placingType = null;
  paused = false;
  gameSpeed = 1;
  els.pauseBtn.textContent = '暂停';
  els.pauseBtn.classList.remove('is-on');
  els.speedBtn.textContent = '1×';
  els.overlay.hidden = true;
  renderInspect();
  renderShopState();
  updateHud(true);
}

/* ---------------- HUD ---------------- */

function updateHud(force = false) {
  if (force || lastHud.coins !== state.coins) {
    els.coins.textContent = state.coins;
    lastHud.coins = state.coins;
  }
  if (force || lastHud.hp !== state.carrotHp) {
    els.hp.textContent = `${state.carrotHp} / ${state.carrotMaxHp}`;
    els.hpBar.style.width = `${(state.carrotHp / state.carrotMaxHp) * 100}%`;
    els.hpBar.classList.toggle('is-low', state.carrotHp <= state.carrotMaxHp * 0.35);
    lastHud.hp = state.carrotHp;
  }
  if (force || lastHud.wave !== state.wave) {
    els.wave.textContent = String(state.wave);
    lastHud.wave = state.wave;
  }

  const label =
    state.phase === 'build'
      ? `下一波 ${Math.max(0, Math.ceil(state.buildTimer))}s`
      : state.phase === 'wave'
        ? '战斗中'
        : state.phase === 'won'
          ? '已通关'
          : '已失守';
  if (force || lastHud.build !== label) {
    els.buildInfo.textContent = label;
    lastHud.build = label;
  }
  els.startBtn.hidden = state.phase !== 'build';
  renderShopState();
}

/* ---------------- 事件 -> 界面 ---------------- */

function drainEvents() {
  if (!state.events.length) return;
  for (const event of state.events) {
    if (event.type === 'wave-start') {
      showBanner(`第 ${event.wave} 波`);
    }
    if (event.type === 'wave-clear') {
      toast(`第 ${event.wave} 波清空，+${event.bonus} 金币`, 'good');
    }
    if (event.type === 'lost') {
      showOverlay(false);
    }
    if (event.type === 'won') {
      showOverlay(true);
    }
  }
  state.events.length = 0;
}

let bannerTimer;
function showBanner(text) {
  els.banner.textContent = text;
  els.banner.classList.remove('is-on');
  void els.banner.offsetWidth;
  els.banner.classList.add('is-on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => els.banner.classList.remove('is-on'), 1400);
}

function showOverlay(won) {
  els.overlay.hidden = false;
  els.overlay.classList.toggle('is-won', won);
  els.overlayTitle.textContent = won ? '守住了！' : '萝卜被吃掉了';
  els.overlayText.textContent = won
    ? `15 波全部击退，剩余 ${state.carrotHp} 点生命，击杀 ${state.kills} 只。`
    : `坚持到第 ${state.wave} 波，击杀 ${state.kills} 只。再试一次？`;
}

/* ---------------- 主循环 ---------------- */

let last = performance.now();

function frame(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, raw);

  if (!paused && !restartable(state)) {
    for (let i = 0; i < gameSpeed; i += 1) update(state, dt);
  } else {
    update(state, 0);
  }

  view.time = state.time;
  view.placingType = placingType;
  view.hoverGx = hoverGx;
  view.hoverGy = hoverGy;
  view.canPlace = Boolean(placingType) && isBuildable(hoverGx, hoverGy) && !towerAt(state, hoverGx, hoverGy);

  draw(ctx, state, view);
  updateHud();
  drainEvents();

  requestAnimationFrame(frame);
}

/* ---------------- 启动 ---------------- */

els.waveTotal.textContent = String(totalWaves());
buildShop();
bindInput();
renderShopState();
resize();
updateHud(true);
requestAnimationFrame(frame);

// 调试入口：控制台可读状态，自动化测试也能用它构造场景。
window.__game = {
  get state() {
    return state;
  },
  placeTower: (gx, gy, type) => placeTower(state, gx, gy, type),
  upgradeTower: (id) => upgradeTower(state, id),
  startWave: () => startWave(state),
  refresh: () => {
    renderInspect();
    renderShopState();
  },
};
