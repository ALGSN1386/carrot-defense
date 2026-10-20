/**
 * 渲染层冒烟测试：用“假”的 canvas 2D 上下文在 Node 里真实调用 render()，
 * 喂入一局进行中的真实状态，并显式制造：5 种塔、护盾条、减速圈、灼烧圈、粒子、飘字，
 * 确保渲染代码对任意状态都不抛异常（PRD “顶级”可验证要求的延伸）。
 */

import { createGame, update, placeTower, startWave } from '../js/game.js';
import { render } from '../js/render.js';
import { TOWER_ORDER, isBuildable, COLS, ROWS } from '../js/config.js';

// 记录调用的 2D 上下文：所有方法 no-op，属性随意赋值。
function mockCtx() {
  const noop = () => {};
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    font: '', textAlign: '', globalAlpha: 1,
  };
  for (const m of [
    'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'arcTo',
    'ellipse', 'closePath', 'fill', 'stroke', 'save', 'restore', 'translate',
    'rotate', 'fillText', 'setLineDash', 'setTransform', 'scale', 'rect',
  ]) ctx[m] = noop;
  return ctx;
}

// 先收集足够多的可建造格，确保每种塔都能放到不同位置
const cells = [];
for (let gy = 0; gy < ROWS; gy += 1)
  for (let gx = 0; gx < COLS; gx += 1)
    if (isBuildable(gx, gy)) cells.push({ gx, gy });

const state = createGame();
state.coins = 9999; // 冒烟测试仅验证绘制，给足金币以建满 5 种塔
TOWER_ORDER.forEach((type, idx) => {
  const c = cells[idx * 7 % cells.length]; // 间隔取格，避免挨太近
  placeTower(state, c.gx, c.gy, type);
});

// 开一局并跑若干帧，制造怪物/投射物/粒子/飘字
startWave(state);
const dt = 1 / 30;
let frames = 0;
while (state.phase === 'wave' && frames < 400) {
  update(state, dt);
  frames += 1;
}
// 强制给场上怪物加上护盾/减速/灼烧，覆盖对应绘制分支
for (const e of state.enemies) {
  e.maxShield = 50; e.shield = 30;
  e.slowUntil = state.time + 5; e.burnUntil = state.time + 5; e.burnDps = 9;
}
// build 阶段几帧，让太阳花产金/粒子继续
for (let k = 0; k < 60; k += 1) update(state, dt);

const ctx = mockCtx();
let ok = true;
try {
  render(ctx, state, {
    hover: { gx: cells[0].gx, gy: cells[0].gy, buildable: true, selectedType: 'cannon' },
    selectedTower: state.towers.find((t) => t.type === 'magic') || null,
  });
} catch (e) {
  ok = false;
  console.error('  ❌ render 抛异常:', e.message);
}

const byType = {};
for (const t of state.towers) byType[t.type] = (byType[t.type] || 0) + 1;
console.log('=== 渲染冒烟测试 ===');
console.log(`  塔构成=${JSON.stringify(byType)} 怪物=${state.enemies.length} 投射物=${state.projectiles.length} 粒子=${state.particles.length} 飘字=${state.floats.length}`);
const allKinds = Object.keys(byType).length === TOWER_ORDER.length;
console.log(allKinds ? '  ✅ 5 种塔全部绘制' : `  ⚠️  仅绘制了 ${Object.keys(byType).length}/5 种塔`);
console.log(ok ? '  ✅ render() 在真实状态下零异常' : '  ❌ render 失败');
process.exit(ok && allKinds ? 0 : 1);
