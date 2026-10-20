/**
 * 逻辑层断言测试（PRD §9 验收测试矩阵 T-01 ~ T-18）。
 * 全部在 Node 无头运行，不依赖浏览器。
 *
 * 运行：node test/logic.test.mjs   （或 npm test）
 */

import {
  createGame, update, placeTower, upgradeTower, sellTower, startWave,
  stats, towerAt, pickTarget, hurt,
} from '../js/game.js';
import { TOWERS, ENEMIES, PATH, isBuildable, COLS, ROWS, TILE } from '../js/config.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}  ${extra}`); }
}

function makeEnemy(type, over = {}) {
  const def = ENEMIES[type];
  const scale = over.hpScale || 1;
  return {
    id: over.id || `e_${Math.random()}`,
    type,
    hp: Math.round(def.hp * scale),
    maxHp: Math.round(def.hp * scale),
    shield: def.shield ? Math.round(def.shield * scale) : 0,
    maxShield: def.shield ? Math.round(def.shield * scale) : 0,
    dist: over.dist || 0,
    x: over.x || 0,
    y: over.y || 0,
    speed: def.speed,
    lane: 0,
    slowUntil: 0,
    slowFactor: 1,
    burnUntil: 0,
    burnDps: 0,
    radius: def.radius,
    dead: false,
    wobble: 0,
  };
}

function firstBuildable() {
  for (let gy = 0; gy < ROWS; gy += 1)
    for (let gx = 0; gx < COLS; gx += 1)
      if (isBuildable(gx, gy)) return { gx, gy };
  return null;
}

// 一个离路径很近、可覆盖路径的格子（用于需要“在射程内”的测试）
function nearPathCell() {
  let best = null;
  let bestMin = Infinity;
  for (let gy = 0; gy < ROWS; gy += 1) {
    for (let gx = 0; gx < COLS; gx += 1) {
      if (!isBuildable(gx, gy)) continue;
      const cx = gx * TILE + TILE / 2;
      const cy = gy * TILE + TILE / 2;
      let min = Infinity;
      for (const seg of PATH.segments) {
        const dx = seg.b.x - seg.a.x;
        const dy = seg.b.y - seg.a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((cx - seg.a.x) * dx + (cy - seg.a.y) * dy) / l2)) : 0;
        const d = Math.hypot(cx - (seg.a.x + t * dx), cy - (seg.a.y + t * dy));
        if (d < min) min = d;
      }
      if (min < 150 && min < bestMin) { bestMin = min; best = { gx, gy }; }
    }
  }
  return best;
}

console.log('=== 保卫萝卜 · 逻辑层断言测试 ===\n');

// T-01
{
  const s = createGame();
  check('T-01 新局初始状态', s.phase === 'build' && s.coins === 320 && s.carrotHp === 20 && s.wave === 0,
    `phase=${s.phase} coins=${s.coins} hp=${s.carrotHp} wave=${s.wave}`);
}

// T-02
{
  const s = createGame();
  const c = firstBuildable();
  const r = placeTower(s, c.gx, c.gy, 'cannon');
  check('T-02 建塔扣费', r.ok && s.coins === 220 && s.towers.length === 1 && s.towers[0].invested === 100,
    `coins=${s.coins} n=${s.towers.length} inv=${s.towers[0] && s.towers[0].invested}`);
}

// T-03
{
  const s = createGame();
  const c = firstBuildable();
  s.coins = 100;
  const r = placeTower(s, c.gx, c.gy, 'flame'); // 火焰塔 240 > 100
  check('T-03 金币不足被拒', r.ok === false && s.coins === 100, `ok=${r.ok} coins=${s.coins}`);
}

// T-04
{
  const s = createGame();
  const r = placeTower(s, 4, 2, 'cannon'); // (4,2) 在路径上
  check('T-04 路面不可建造', r.ok === false && isBuildable(4, 2) === false, `ok=${r.ok} buildable=${isBuildable(4, 2)}`);
}

// T-05
{
  const s = createGame();
  const c = firstBuildable();
  placeTower(s, c.gx, c.gy, 'cannon');
  const r = placeTower(s, c.gx, c.gy, 'cannon');
  check('T-05 同格不可重复建造', r.ok === false, `ok=${r.ok}`);
}

// T-06
{
  const s = createGame();
  const c = firstBuildable();
  s.coins = 9999;
  placeTower(s, c.gx, c.gy, 'cannon');
  upgradeTower(s, s.towers[0].id);
  upgradeTower(s, s.towers[0].id);
  const r = upgradeTower(s, s.towers[0].id);
  check('T-06 满级后不可再升', r.ok === false && s.towers[0].level === 3, `ok=${r.ok} lvl=${s.towers[0].level}`);
}

// T-07
{
  const s = createGame();
  const c = firstBuildable();
  placeTower(s, c.gx, c.gy, 'cannon'); // invested 100
  s.coins = 0;
  const r = sellTower(s, s.towers[0].id);
  check('T-07 拆除返还 60%', r.ok && s.coins === 60 && s.towers.length === 0, `coins=${s.coins} n=${s.towers.length}`);
}

// T-08
{
  const s = createGame();
  const r = startWave(s);
  check('T-08 开波进入 wave', r.ok && s.phase === 'wave' && s.wave === 1 && s.spawnQueue.length === 8,
    `phase=${s.phase} wave=${s.wave} q=${s.spawnQueue.length}`);
}

// T-09
{
  const s = createGame();
  startWave(s);
  const r = startWave(s);
  check('T-09 交战中不可再开波', r.ok === false, `ok=${r.ok}`);
}

// T-10
{
  const s = createGame();
  s.phase = 'wave'; s.wave = 1; s.spawnQueue = []; s.enemies = [];
  const before = s.coins;
  update(s, 0.016);
  check('T-10 清波奖励 20+波次×4', s.phase === 'build' && s.coins === before + (20 + 1 * 4),
    `phase=${s.phase} coins=${s.coins} (期望 ${before + 24})`);
}

// T-11
{
  const s = createGame();
  s.phase = 'wave'; s.spawnQueue = [];
  s.enemies = [makeEnemy('grunt', { dist: PATH.length + 5 })];
  const before = s.carrotHp;
  update(s, 0.016);
  check('T-11 漏怪扣血（小怪扣1）', s.carrotHp === before - 1 && s.leaks === 1, `hp=${s.carrotHp} leaks=${s.leaks}`);
}

// T-12
{
  const s = createGame();
  s.carrotHp = 1; s.phase = 'wave'; s.spawnQueue = [];
  s.enemies = [makeEnemy('grunt', { dist: PATH.length + 5 })];
  update(s, 0.016);
  check('T-12 生命≤0 判负', s.phase === 'lost' && s.carrotHp === 0, `phase=${s.phase} hp=${s.carrotHp}`);
}

// T-13
{
  const s = createGame();
  s.wave = 15; s.phase = 'wave'; s.spawnQueue = []; s.enemies = [];
  update(s, 0.016);
  check('T-13 清完第15波通关', s.phase === 'won', `phase=${s.phase}`);
}

// T-14
{
  const s = createGame();
  const c = firstBuildable();
  s.coins = 9999;
  placeTower(s, c.gx, c.gy, 'cannon');
  upgradeTower(s, s.towers[0].id);
  const st = stats(s.towers[0]);
  check('T-14 升级数值(瓶子炮L2)', st.damage === 15 && st.range === 168 && Math.abs(st.rate - 0.484) < 1e-9,
    `dmg=${st.damage} rng=${st.range} rate=${st.rate.toFixed(3)}`);
}

// T-15 用“少而精”策略跑完整对局应通关
{
  function goodCells() {
    const cells = [];
    for (let gy = 0; gy < ROWS; gy += 1)
      for (let gx = 0; gx < COLS; gx += 1) {
        if (!isBuildable(gx, gy)) continue;
        const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
        let min = Infinity, pos = 0;
        for (const seg of PATH.segments) {
          const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y, l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, ((cx - seg.a.x) * dx + (cy - seg.a.y) * dy) / l2)) : 0;
          const d = Math.hypot(cx - (seg.a.x + t * dx), cy - (seg.a.y + t * dy));
          if (d < min) { min = d; pos = seg.start + seg.length * t; }
        }
        if (min < 150) cells.push({ gx, gy, min, pos });
      }
    return cells;
  }
  function pathPosOf(gx, gy) {
    const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
    let best = 0, bestMin = Infinity;
    for (const seg of PATH.segments) {
      const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((cx - seg.a.x) * dx + (cy - seg.a.y) * dy) / l2)) : 0;
      const d = Math.hypot(cx - (seg.a.x + t * dx), cy - (seg.a.y + t * dy));
      if (d < bestMin) { bestMin = d; best = seg.start + seg.length * t; }
    }
    return { pos: best, min: bestMin };
  }
  function pickSpreadCell(state, cells) {
    let best = null, bestScore = -1;
    for (const c of cells) {
      if (state.towers.some((t) => t.gx === c.gx && t.gy === c.gy)) continue;
      const cpos = pathPosOf(c.gx, c.gy).pos;
      if (state.towers.length === 0) {
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
  const rank = (t) => ({ magic: 4, flame: 3, cannon: 2, ice: 1, sun: 0 }[t] || 0);
  const up = (t) => Math.round(TOWERS[t.type].cost * (t.level === 1 ? 0.9 : 1.3));
  function quality(state) {
    const cells = goodCells();
    let guard = 0;
    while (state.coins >= 100 && state.towers.filter((t) => t.type !== 'sun').length < 6 && guard < 200) {
      guard += 1;
      const c = pickSpreadCell(state, cells);
      if (!c) break;
      const r = placeTower(state, c.gx, c.gy, 'cannon');
      if (!r.ok) break;
    }
    const sun = state.towers.filter((t) => t.type === 'sun').length;
    if (sun < 2 && state.coins >= 120) {
      const c = pickSpreadCell(state, cells);
      if (c) placeTower(state, c.gx, c.gy, 'sun');
    }
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
    let g = 0;
    while (g < 80) {
      g += 1;
      const u = state.towers.filter((t) => t.level < 3 && t.type !== 'sun');
      if (!u.length) break;
      u.sort((a, b) => rank(b.type) - rank(a.type));
      if (state.coins < up(u[0])) break;
      upgradeTower(state, u[0].id);
    }
  }
  const s = createGame();
  let steps = 0;
  while (s.phase !== 'won' && s.phase !== 'lost' && steps < 500000) {
    if (s.phase === 'build') { quality(s); startWave(s); }
    update(s, 1 / 30); steps += 1;
  }
  check('T-15 精选策略通关', s.phase === 'won', `phase=${s.phase} wave=${s.wave} hp=${s.carrotHp} coins=${s.coins}`);
}

// T-16 索敌取 dist 最大
{
  const s = createGame();
  const c = nearPathCell();
  placeTower(s, c.gx, c.gy, 'cannon');
  const tower = s.towers[0];
  const eNear = makeEnemy('grunt', { id: 'near', x: tower.x, y: tower.y, dist: 10 });
  const eFar = makeEnemy('grunt', { id: 'far', x: tower.x, y: tower.y, dist: 100 });
  s.enemies = [eNear, eFar];
  const target = pickTarget(s, tower, 1000);
  check('T-16 索敌优先最远敌人', target && target.id === 'far', `target=${target && target.id}`);
}

// T-17 护盾优先结算
{
  const s = createGame();
  const e = makeEnemy('shielded', { id: 'sh' }); // 护盾 70
  hurt(s, e, 50, {});
  check('T-17 护盾先吃伤害', e.shield === 20 && e.hp === 70, `shield=${e.shield} hp=${e.hp}`);
}

// T-18 冰冻塔命中后施加减速
{
  const s = createGame();
  const c = nearPathCell();
  placeTower(s, c.gx, c.gy, 'ice');
  const tower = s.towers[0];
  const e = makeEnemy('grunt', { id: 'g', x: tower.x, y: tower.y });
  s.phase = 'wave'; s.spawnQueue = []; s.enemies = [e];
  let hit = false;
  for (let i = 0; i < 300 && !hit; i += 1) {
    update(s, 0.05);
    if (e.dead) break;
    if (e.slowUntil > s.time) hit = true;
  }
  check('T-18 冰冻减速生效', hit, `slowUntil=${e.slowUntil} time=${s.time.toFixed(2)}`);
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
process.exit(failed === 0 ? 0 : 1);
