/**
 * 平衡仿真：在 Node 中无头跑完整对局，验证 PRD §7.3 / R5 的难度梯度。
 *
 *   none   —— 完全不建塔            → 应当第 2 波失守（失败路径可达）
 *   greedy —— 见塔就铺、从不升级    → 应当第 9–13 波失守（错误策略被淘汰）
 *   quality—— 少而精、先升满核心塔  → 应当通关且剩余 10–18 生命（正确策略能赢）
 *
 * 运行：node sim/balance.mjs   （或 npm run sim）
 */

import { createGame, update, placeTower, upgradeTower, startWave } from '../js/game.js';
import { TOWERS, isBuildable, COLS, ROWS, TILE, PATH } from '../js/config.js';

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 距离路径足够近、可覆盖路径的建造格；按“沿路径的里程”排序，使塔沿全路径铺开而非聚堆。 */
function goodCells() {
  const cells = [];
  for (let gy = 0; gy < ROWS; gy += 1) {
    for (let gx = 0; gx < COLS; gx += 1) {
      if (!isBuildable(gx, gy)) continue;
      const cx = gx * TILE + TILE / 2;
      const cy = gy * TILE + TILE / 2;
      let min = Infinity;
      let pos = 0;
      for (const seg of PATH.segments) {
        const d = distToSeg(cx, cy, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
        if (d < min) { min = d; pos = seg.start + seg.length * projParam(cx, cy, seg); }
      }
      if (min < 150) cells.push({ gx, gy, min, pos });
    }
  }
  cells.sort((a, b) => a.pos - b.pos);
  return cells;
}

// 返回点 (cx,cy) 在段上的投影参数 t∈[0,1]（用于计算沿路径里程）。
function projParam(cx, cy, seg) {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return 0;
  return Math.max(0, Math.min(1, ((cx - seg.a.x) * dx + (cy - seg.a.y) * dy) / l2));
}

function runGame(controller, maxSteps = 500000) {
  const state = createGame();
  const dt = 1 / 30;
  let steps = 0;
  while (state.phase !== 'won' && state.phase !== 'lost' && steps < maxSteps) {
    if (state.phase === 'build') {
      controller(state);
      startWave(state);
    }
    update(state, dt);
    steps += 1;
  }
  return state;
}

const rank = (type) => ({ magic: 4, flame: 3, cannon: 2, ice: 1, sun: 0 }[type] || 0);
const upCost = (t) => Math.round(TOWERS[t.type].cost * (t.level === 1 ? 0.9 : 1.3));

/* ---- 策略：完全不建塔 ---- */
const none = () => {};

/** 某格中心沿路径的里程（用于把塔沿整条路径均匀铺开，而非聚在入口）。 */
function pathPosOf(gx, gy) {
  const cx = gx * TILE + TILE / 2;
  const cy = gy * TILE + TILE / 2;
  let best = 0;
  let bestMin = Infinity;
  for (const seg of PATH.segments) {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((cx - seg.a.x) * dx + (cy - seg.a.y) * dy) / l2)) : 0;
    const d = Math.hypot(cx - (seg.a.x + t * dx), cy - (seg.a.y + t * dy));
    if (d < bestMin) { bestMin = d; best = seg.start + seg.length * t; }
  }
  return { pos: best, min: bestMin };
}

/** 在 goodCells 中选“离已有塔沿路径最远”的格子，最大化全路径覆盖。 */
function pickSpreadCell(state, cells) {
  let best = null;
  let bestScore = -1;
  for (const c of cells) {
    if (state.towers.some((t) => t.gx === c.gx && t.gy === c.gy)) continue;
    const cpos = pathPosOf(c.gx, c.gy).pos;
    if (state.towers.length === 0) {
      // 首座塔放在路径中段，居中覆盖
      const score = -Math.abs(cpos - PATH.length / 2);
      if (-score > bestScore) { bestScore = -score; best = c; }
      continue;
    }
    let mind = Infinity;
    for (const t of state.towers) {
      const tpos = pathPosOf(t.gx, t.gy).pos;
      mind = Math.min(mind, Math.abs(cpos - tpos));
    }
    if (mind > bestScore) { bestScore = mind; best = c; }
  }
  return best;
}

/* ---- 策略：见塔就铺，从不升级（纯瓶子炮，沿路径均匀铺开） ---- */
function greedy(state) {
  const cells = goodCells();
  let guard = 0;
  while (state.coins >= 100 && state.towers.length < 60 && guard < 200) {
    guard += 1;
    const c = pickSpreadCell(state, cells);
    if (!c) break;
    const r = placeTower(state, c.gx, c.gy, 'cannon');
    if (!r.ok) break;
  }
}

/* ---- 策略：少而精，先铺攻击塔、再补经济与魔法塔、最后升级核心塔 ---- */
function quality(state) {
  const cells = goodCells();

  // 1) 先建 6 座瓶子炮（攻击主力，覆盖整条路径）
  let guard = 0;
  while (state.coins >= 100 && state.towers.filter((t) => t.type !== 'sun').length < 6 && guard < 200) {
    guard += 1;
    const c = pickSpreadCell(state, cells);
    if (!c) break;
    const r = placeTower(state, c.gx, c.gy, 'cannon');
    if (!r.ok) break;
  }

  // 2) 经济：保证 2 朵太阳花（在已有 6 座攻击塔之后，不挤占攻击预算）
  const sun = state.towers.filter((t) => t.type === 'sun').length;
  if (sun < 2 && state.coins >= 120) {
    const c = pickSpreadCell(state, cells);
    if (c) placeTower(state, c.gx, c.gy, 'sun');
  }

  // 3) 继续补瓶子炮到 10 座，之后补魔法塔(≤5，溅射清群)；总塔上限 24
  guard = 0;
  while (state.coins >= 100 && state.towers.length < 24 && guard < 200) {
    guard += 1;
    const cannons = state.towers.filter((t) => t.type === 'cannon').length;
    const magicCount = state.towers.filter((t) => t.type === 'magic').length;
    const type = cannons >= 10 && state.coins >= 200 && magicCount < 5 ? 'magic' : 'cannon';
    const c = pickSpreadCell(state, cells);
    if (!c) break;
    const r = placeTower(state, c.gx, c.gy, type);
    if (!r.ok) break;
  }

  // 4) 把攻击塔（不含太阳花）升到满级，优先高价值塔
  let g2 = 0;
  while (g2 < 80) {
    g2 += 1;
    const upgradable = state.towers.filter((t) => t.level < 3 && t.type !== 'sun');
    if (!upgradable.length) break;
    upgradable.sort((a, b) => rank(b.type) - rank(a.type));
    const t = upgradable[0];
    const cost = upCost(t);
    if (state.coins < cost) break;
    upgradeTower(state, t.id);
  }
}

/* ---- 执行与判定 ---- */
function run(label, controller, expect) {
  const s = runGame(controller);
  const pass = expect(s);
  const tag = pass ? '✅ PASS' : '❌ FAIL';
  console.log(
    `${tag}  [${label}]  结果: ${s.phase === 'won' ? '通关' : '失败'}  ` +
    `波次=${s.wave}  剩余生命=${s.carrotHp}/${s.carrotMaxHp}  击杀=${s.kills}  终局金币=${s.coins}`,
  );
  return { pass, s };
}

console.log('=== 保卫萝卜 · 平衡仿真（PRD §7.3 / R5）===\n');

const r1 = run('不建塔 none', none, (s) => s.phase === 'lost' && s.wave <= 2);
const r2 = run('无脑铺塔 greedy', greedy, (s) => s.phase === 'lost' && s.wave >= 9 && s.wave <= 13);
const r3 = run('少而精 quality', quality, (s) => s.phase === 'won' && s.carrotHp >= 10 && s.carrotHp <= 18);

console.log('');
const allPass = r1.pass && r2.pass && r3.pass;
console.log(allPass ? '🎯 难度梯度成立：失败路径可达 / 错误策略被淘汰 / 正确策略能赢且不躺赢。'
                   : '⚠️  存在不满足 R5 的项，需回看数值。');
process.exit(allPass ? 0 : 1);
