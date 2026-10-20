// 状态机与移动逻辑的测试
// 之前这三个函数零覆盖：allowedActions 漏了 paused 才让"暂停能开波"活了下来，
// moveEnemy 决定漏怪与胜负却从没被直接验过。
import test from "node:test";
import assert from "node:assert/strict";

import { PATH_SEGMENTS, TOWERS } from "../js/data.js";
import { moveEnemy, applySlow } from "../js/rules.js";
import {
  createGame, allowedActions, cycleSpeed, togglePause, startWave, PHASE,
} from "../js/game.js";

const mkEnemy = (over = {}) => ({
  id: 1, hp: 100, maxHp: 100, shield: 0, armor: 0, radius: 18, speed: 60,
  lane: 0, progress: 0, x: 0, y: 0, slowFactor: 1, slowTimer: 0,
  burnDps: 0, burnTimer: 0, burnAcc: 0, dead: false, ...over,
});

// ---------------- allowedActions：状态机准入表 ----------------
test("布防阶段允许开波", () => {
  const s = createGame(1);
  assert.equal(s.phase, PHASE.BUILD);
  assert.equal(allowedActions(s).startWave, true);
});

test("暂停时禁止开波（回归：曾漏掉这个条件）", () => {
  const s = createGame(1);
  togglePause(s);
  assert.equal(s.paused, true);
  assert.equal(allowedActions(s).startWave, false);
  assert.equal(startWave(s).ok, false);
  assert.equal(s.wave, 0, "暂停时点开波不应该推进波次");
});

test("战斗中禁止开波", () => {
  const s = createGame(1);
  startWave(s);
  assert.equal(s.phase, PHASE.WAVE);
  assert.equal(allowedActions(s).startWave, false);
});

test("结束后除重开外全部禁止", () => {
  const s = createGame(1);
  s.phase = PHASE.LOST;
  const a = allowedActions(s);
  assert.deepEqual(
    { place: a.place, upgrade: a.upgrade, sell: a.sell, startWave: a.startWave, pause: a.pause, speed: a.speed, restart: a.restart },
    { place: false, upgrade: false, sell: false, startWave: false, pause: false, speed: false, restart: true },
  );
});

test("暂停不改变放置/升级/拆除的准入（由各函数内部拦截）", () => {
  const s = createGame(1);
  togglePause(s);
  const a = allowedActions(s);
  assert.equal(a.place, true, "准入表只管对局是否结束，暂停由动作函数自己挡");
  assert.equal(a.upgrade, true);
  assert.equal(a.sell, true);
});

// ---------------- cycleSpeed ----------------
test("倍速按 1→2→3→1 循环", () => {
  const s = createGame(1);
  assert.equal(s.speed, 1);
  assert.equal(cycleSpeed(s).speed, 2);
  assert.equal(cycleSpeed(s).speed, 3);
  assert.equal(cycleSpeed(s).speed, 1);
});

test("结束后禁止切倍速", () => {
  const s = createGame(1);
  s.phase = PHASE.WON;
  const r = cycleSpeed(s);
  assert.equal(r.ok, false);
  assert.equal(s.speed, 1);
});

// ---------------- moveEnemy ----------------
test("moveEnemy 按速度推进路径进度", () => {
  const e = mkEnemy({ speed: 60, progress: 0 });
  const arrived = moveEnemy(e, 1);
  assert.equal(arrived, false);
  assert.ok(Math.abs(e.progress - 60) < 1e-9, `实际 ${e.progress}`);
});

test("moveEnemy 尊重减速系数", () => {
  const fast = mkEnemy({ speed: 60 });
  const slow = mkEnemy({ speed: 60 });
  applySlow(slow, 0.5, 5);          // 速度降到 50%
  moveEnemy(fast, 1);
  moveEnemy(slow, 1);
  assert.ok(Math.abs(slow.progress - fast.progress / 2) < 1e-9);
});

test("走完全程返回 true，并把进度夹在总长", () => {
  const e = mkEnemy({ speed: 600, progress: PATH_SEGMENTS.total - 10 });
  const arrived = moveEnemy(e, 1);
  assert.equal(arrived, true);
  assert.equal(e.progress, PATH_SEGMENTS.total);
});

test("moveEnemy 会把坐标更新到路径上", () => {
  const e = mkEnemy({ speed: 60, progress: 0, x: -999, y: -999 });
  moveEnemy(e, 1);
  assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
  assert.notEqual(e.x, -999);
});

test("车道偏移让同位置的怪物不重叠", () => {
  const a = mkEnemy({ lane: 0 });
  const b = mkEnemy({ lane: 12 });
  moveEnemy(a, 1);
  moveEnemy(b, 1);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > 10, `两车道的怪物距离只有 ${d}`);
});

test("塔的射程足以覆盖相邻路径格（平衡前提）", () => {
  // 射程最小的塔也必须够得着隔壁的路，否则贴路建造毫无意义
  const minRange = Math.min(...Object.values(TOWERS).filter((t) => t.range).map((t) => t.range));
  assert.ok(minRange >= 120, `最小射程 ${minRange}`);
});
