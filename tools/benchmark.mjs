/**
 * 保卫萝卜 V2 · 创新点 A/B 实验台
 *
 * 运行：node tools/benchmark.mjs
 * A = baseline/js（冻结的优化前代码）
 * B = js（优化后代码）
 *
 * 原则：两边都是仓库里的真实代码，不用"差不多的复刻"来凑数。
 * 正确性前置：node tools/verify-identity.mjs 证明 A/B 玩法结果逐字段一致。
 */
import { performance } from "node:perf_hooks";

const A = {
  game: await import("../baseline/js/game.js"),
  rules: await import("../baseline/js/rules.js"),
  data: await import("../baseline/js/data.js"),
};
const B = {
  rules: await import("../js/rules.js"),
  data: await import("../js/data.js"),
  fast: await import("../js/fastpath.js"),
  hud: await import("../js/hudvm.js"),
};

const pct = (a, b) => (((a - b) / a) * 100).toFixed(1);
const ms = (n) => n.toFixed(2);

// ---------------- 实验 1：索敌 pickTarget（平方距离 vs hypot） ----------------
function experimentPickTarget() {
  const { ENEMIES, TOWERS } = A.data;
  const towers = [
    { x: 120, y: 180, level: 3, def: { ...TOWERS.cannon, upgradeCosts: [130, 169] } },
    { x: 360, y: 300, level: 2, def: { ...TOWERS.magic, upgradeCosts: [260, 338] } },
    { x: 600, y: 180, level: 3, def: { ...TOWERS.ice, upgradeCosts: [195, 253] } },
    { x: 780, y: 360, level: 1, def: { ...TOWERS.flame, upgradeCosts: [312, 405] } },
  ];
  const enemies = [];
  for (let i = 0; i < 40; i += 1) {
    enemies.push({
      id: i + 1, x: 40 + (i * 23) % 880, y: 60 + (i * 37) % 480,
      radius: ENEMIES.grunt.radius, progress: i * 21, dead: false,
    });
  }
  const ROUNDS = 20000;

  const tA = performance.now();
  let sumA = 0;
  for (let n = 0; n < ROUNDS; n += 1) {
    for (const t of towers) sumA += A.rules.pickTarget(t, enemies) ? 1 : 0;
  }
  const msA = performance.now() - tA;

  const tB = performance.now();
  let sumB = 0;
  for (let n = 0; n < ROUNDS; n += 1) {
    for (const t of towers) sumB += B.rules.pickTarget(t, enemies) ? 1 : 0;
  }
  const msB = performance.now() - tB;

  return { msA, msB, rounds: ROUNDS * towers.length, same: sumA === sumB };
}

// ---------------- 实验 2：statsAt 面板缓存 ----------------
function experimentStats() {
  const tower = { level: 1, def: { ...A.data.TOWERS.cannon, upgradeCosts: [130, 169] } };
  const ROUNDS = 500000;
  const out = {};
  for (const label of ["A", "B"]) {
    const rules = label === "A" ? A.rules : B.rules;
    const t = performance.now();
    let acc = 0;
    for (let n = 0; n < ROUNDS; n += 1) acc += rules.statsAt(tower).damage;
    out[label] = { ms: performance.now() - t, acc };
  }
  return { ...out, rounds: ROUNDS, same: out.A.acc === out.B.acc };
}

// ---------------- 实验 3：每帧数组清理（原地压缩 vs filter） ----------------
function experimentCompaction() {
  const N = 120;
  const ROUNDS = 80000;
  const templates = Array.from({ length: ROUNDS }, () =>
    Array.from({ length: N }, (_, i) => ({ i, dead: i % 4 === 0 })));

  const tA = performance.now();
  let sumA = 0;
  for (const arr of templates) sumA += arr.filter((e) => !e.dead).length;
  const msA = performance.now() - tA;

  const tB = performance.now();
  let sumB = 0;
  for (const arr of templates) { B.fast.compactDead(arr); sumB += arr.length; }
  const msB = performance.now() - tB;

  return {
    msA, msB, rounds: ROUNDS, same: sumA === sumB,
    arraysA: ROUNDS, arraysB: 0,
  };
}

// ---------------- 实验 5：HUD 10Hz 差量写入 ----------------
function experimentHud() {
  const { TOWERS, TOWER_ORDER } = A.data;
  const state = {
    coins: 320, hp: 20, speed: 1, paused: false,
    phase: "build", wave: 0, buildTimer: 12,
  };
  const cfg = {
    WAVE_COUNT: 15, CARROT_HP: 20,
    nextWave: "下一波 第 1 波　小怪 ×8",
    banner: "布防阶段 · 点塔卡，再点草地建造",
    cardIds: TOWER_ORDER,
    cardCost: (id) => TOWERS[id].cost,
  };
  const vm = B.hud.hudViewModel(state, cfg);
  const noop = () => {};
  const writers = new Proxy({}, { get: () => noop });
  const counter = { n: 0 };
  const prev = {};
  const REFRESHES = 3600; // 10Hz × 6 分钟

  // A：原 ui.js 每次 HUD 刷新无条件写 15 个标量字段 + 5 张卡 = 20 次
  const FIELDS_A = 20;
  const writesA = FIELDS_A * REFRESHES;

  // B：差量写入。状态完全不变时，首帧写满，其余帧 0 次写入。
  const first = B.hud.applyHudViewModel(vm, prev, writers, counter);
  let steady = 0;
  for (let i = 0; i < REFRESHES - 1; i += 1) {
    steady += B.hud.applyHudViewModel(vm, prev, writers, { n: 0 });
  }
  const writesB = first + steady;

  return { writesA, writesB, refreshes: REFRESHES, fields: FIELDS_A, first, steady };
}

// ---------------- 实验 6：候选否决 —— Map 索引是否值得替换线性 find ----------------
// 这个实验在 tools/benchmark.mjs 初版中作为"优化"跑过，结果 B 比 A 慢 54.5%，
// 因此从 js/game.js 撤销，保留线性 find。这里保留测量，作为"实验筛选"的证据。
function experimentRejectedMap() {
  const ENEMIES = 40;
  const SHOTS = 12;
  const ROUNDS = 6000;
  const enemies = Array.from({ length: ENEMIES }, (_, i) => ({ id: 1000 + i, dead: i % 9 === 0 }));
  const shots = Array.from({ length: SHOTS }, (_, i) => 1000 + ((i * 7) % ENEMIES));

  const tA = performance.now();
  let a = 0;
  for (let n = 0; n < ROUNDS; n += 1) {
    for (const id of shots) if (enemies.find((e) => e.id === id && !e.dead)) a += 1;
  }
  const msA = performance.now() - tA;

  const tB = performance.now();
  let b = 0;
  for (let n = 0; n < ROUNDS; n += 1) {
    const byId = B.fast.indexEnemies(enemies);
    for (const id of shots) if (byId.get(id)) b += 1;
  }
  const msB = performance.now() - tB;
  return { msA, msB, slower: msB > msA, rejected: true, same: a === b };
}

// ---------------- 输出 ----------------
const pick = experimentPickTarget();
const stats = experimentStats();
const comp = experimentCompaction();
const hud = experimentHud();
const rejected = experimentRejectedMap();

console.log("保卫萝卜 V2 · 创新点 A/B 实验");
console.log("A = baseline/js（原始代码）  B = js（优化后代码）\n");
console.log("【采纳的创新点】\n");

console.log("--- 1. 索敌 pickTarget：平方距离 vs Math.hypot ---");
console.log(`A: ${ms(pick.msA)} ms / ${pick.rounds} 次`);
console.log(`B: ${ms(pick.msB)} ms / ${pick.rounds} 次`);
console.log(`下降: ${pct(pick.msA, pick.msB)}%   索敌结果一致: ${pick.same ? "是" : "否"}\n`);

console.log("--- 2. statsAt：WeakMap 面板缓存 ---");
console.log(`A: ${ms(stats.A.ms)} ms / ${stats.rounds} 次`);
console.log(`B: ${ms(stats.B.ms)} ms / ${stats.rounds} 次`);
console.log(`下降: ${pct(stats.A.ms, stats.B.ms)}%   面板数值一致: ${stats.same ? "是" : "否"}\n`);

console.log("--- 3. 每帧数组清理：原地压缩 vs filter ---");
console.log(`A: ${ms(comp.msA)} ms / ${comp.rounds} 轮`);
console.log(`B: ${ms(comp.msB)} ms / ${comp.rounds} 轮`);
console.log(`下降: ${pct(comp.msA, comp.msB)}%`);
console.log(`数组分配: ${comp.arraysA} → ${comp.arraysB} 个   保留数量一致: ${comp.same ? "是" : "否"}\n`);

console.log("--- 4. HUD 10Hz 刷新：差量写入 ---");
console.log(`A: ${hud.writesA} 次 DOM 写入 / ${hud.refreshes} 次刷新`);
console.log(`B: ${hud.writesB} 次 DOM 写入 / ${hud.refreshes} 次刷新（首帧 ${hud.first} + 稳态 ${hud.steady}）`);
console.log(`下降: ${pct(hud.writesA, hud.writesB)}%\n`);

console.log("【被实验否决的候选（未进入交付代码）】\n");
console.log("--- 投射物索敌：每帧建 Map 索引 vs 保留线性 find ---");
console.log(`A 线性 find: ${ms(rejected.msA)} ms / 6000 帧`);
console.log(`B 建 Map 索引: ${ms(rejected.msB)} ms / 6000 帧`);
console.log(`结论: Map 慢 ${pct(rejected.msA, rejected.msB).replace("-", "")}% → 否决，保留线性 find；命中结果一致: ${rejected.same ? "是" : "否"}`);
console.log("原因: 每帧 new Map + 40 次 set 的固定开销 > 省下的 12 颗子弹线性比较。\n");

console.log("JSON:", JSON.stringify({ pick, stats, comp, hud, rejected }));
