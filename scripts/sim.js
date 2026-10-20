// 保卫萝卜 V2 · 无头平衡仿真
//
// 作用：把"难度合适"从形容词变成断言。改任何数值后重跑本脚本，
// 三种策略的结果必须仍落在 PRD §4.2 R5 的区间内，否则视为回归。
//
// 用法：
//   node scripts/sim.js                 # 跑三种策略
//   node scripts/sim.js quality 7       # 指定策略与随机种子
//   node scripts/sim.js all 1 --trace   # 打印每次波次结算

import {
  createGame, update, placeTower, upgradeTower, sellTower, startWave,
  towerAt, PHASE, upgradeCostOf,
} from "../js/game.js";
import {
  TOWERS, TOWER_ORDER, COLS, ROWS, TILE, isBuildableTile, PATH_SEGMENTS,
  ECONOMY, CARROT_HP, UPGRADE, MAX_LEVEL,
} from "../js/data.js";
import { statsAt, pointAt } from "../js/rules.js";

const DT = 1 / 60;
const MAX_SECONDS = 60 * 40;

/** 每个可建格能覆盖多少路径长度——用来说"哪块地值钱" */
export function coveredPathLength(col, row, range) {
  const cx = col * TILE + TILE / 2;
  const cy = row * TILE + TILE / 2;
  let covered = 0;
  const step = 8;
  for (let d = 0; d < PATH_SEGMENTS.total; d += step) {
    const p = pointAt(d);
    if (Math.hypot(p.x - cx, p.y - cy) <= range) covered += step;
  }
  return covered;
}

/** 候选建造位，按"覆盖路径长度"从高到低 */
export function rankSpots(range = TOWERS.cannon.range) {
  const spots = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (!isBuildableTile(col, row)) continue;
      spots.push({ col, row, score: coveredPathLength(col, row, range) });
    }
  }
  spots.sort((a, b) => b.score - a.score || a.row - b.row || a.col - b.col);
  return spots;
}

// ---------------- 策略 ----------------

function strategyNone() {
  return { make: () => null };
}

function strategyGreedy(state, spots) {
  // 铺满：有钱就买最便宜的塔，永远不升级
  if (state.phase !== PHASE.BUILD && state.phase !== PHASE.WAVE) return;
  const cost = TOWERS.cannon.cost;
  for (const s of spots) {
    if (state.coins < cost) return;
    if (towerAt(state, s.col, s.row)) continue;
    if (placeTower(state, s.col, s.row, "cannon").ok) return;
  }
}

function strategyQuality(state, spots) {
  if (state.phase !== PHASE.BUILD && state.phase !== PHASE.WAVE) return;
  const order = ["cannon", "cannon", "ice", "magic", "cannon", "magic", "cannon", "flame", "magic", "cannon"];
  const freeSpot = () => spots.find((s) => !towerAt(state, s.col, s.row));

  // 前期：按顺序把地基铺到 9 座（覆盖比单点强度更重要）
  if (state.towers.length < 7) {
    const type = order[state.towers.length];
    if (state.coins < TOWERS[type].cost) return;
    const s = freeSpot();
    if (s) placeTower(state, s.col, s.row, type);
    return;
  }

  // 中后期：在"补一座新塔"和"升级已有塔"之间选更便宜的那个
  const upgrades = state.towers
    .filter((t) => !t.def.income && t.level < MAX_LEVEL)
    .map((t) => ({ t, cost: upgradeCostOf(t) }))
    .sort((a, b) => a.cost - b.cost);
  const spot = freeSpot();
  const nextType = order[Math.min(state.towers.length, order.length - 1)];
  const newCost = spot ? TOWERS[nextType].cost : Infinity;

  const cheapestUpgrade = upgrades[0];
  if (cheapestUpgrade && cheapestUpgrade.cost <= newCost) {
    if (state.coins >= cheapestUpgrade.cost) upgradeTower(state, cheapestUpgrade.t.id);
    return;
  }
  if (spot && state.coins >= newCost) {
    placeTower(state, spot.col, spot.row, nextType);
    return;
  }
  // 钱不够任何动作时，优先攒升级
  if (cheapestUpgrade && state.coins >= cheapestUpgrade.cost) upgradeTower(state, cheapestUpgrade.t.id);
}
const STRATEGIES = {
  none: { label: "不建塔", act: strategyNone },
  greedy: { label: "无脑铺塔", act: strategyGreedy },
  quality: { label: "少而精", act: strategyQuality },
};

/** 跑一整局，返回结果 */
export function runSim(strategyName, seed = 1, { trace = false, verbose = false } = {}) {
  const state = createGame(seed);
  const spots = rankSpots();
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error(`unknown strategy: ${strategyName}`);
  let elapsed = 0;
  let lastWave = 0;
  const log = [];

  const act = () => {
    if (strategy.act.length === 1) strategy.act(state);
    else strategy.act(state, spots);
  };

  while (state.phase !== PHASE.WON && state.phase !== PHASE.LOST && elapsed < MAX_SECONDS) {
    act();
    update(state, DT);
    elapsed += DT;
    if (state.wave !== lastWave) {
      lastWave = state.wave;
      if (trace || verbose) {
        log.push(`  wave ${String(lastWave).padStart(2)}  hp=${state.hp}  coins=${Math.floor(state.coins)}  towers=${state.towers.length}`);
      }
    }
  }

  return {
    strategy: strategyName,
    label: strategy.label,
    seed,
    phase: state.phase,
    wave: state.wave,
    hp: state.hp,
    coins: Math.floor(state.coins),
    towers: state.towers.length,
    levels: state.towers.map((t) => t.level),
    kills: state.stats.kills,
    leaks: state.stats.leaks,
    seconds: Math.round(elapsed),
    log,
  };
}

// ---------------- CLI ----------------
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/sim.js");
if (isMain) {
  const arg = process.argv[2] || "all";
  const seed = Number(process.argv[3] || 1);
  const trace = process.argv.includes("--trace");
  const names = arg === "all" ? Object.keys(STRATEGIES) : [arg];

  console.log(`保卫萝卜 V2 · 无头仿真   seed=${seed}  dt=${DT.toFixed(4)}s\n`);
  const results = [];
  for (const name of names) {
    const r = runSim(name, seed, { trace });
    results.push(r);
    const verdict = r.phase === PHASE.WON ? "通关" : "失守";
    console.log(`${r.label.padEnd(6, "　")} ${verdict}  第 ${r.wave} 波  剩余生命 ${r.hp}/${CARROT_HP}  塔 ${r.towers} 座  终局金币 ${r.coins}  用时 ${Math.floor(r.seconds / 60)}分${r.seconds % 60}秒`);
    if (trace) r.log.forEach((l) => console.log(l));
    console.log("");
  }

  // 断言（PRD §4.2 R5）
  const by = Object.fromEntries(results.map((r) => [r.strategy, r]));
  const checks = [];
  if (by.none) checks.push(["不建塔应在第 2 波失守", by.none.phase === PHASE.LOST && by.none.wave === 2, `实际 第${by.none.wave}波 ${by.none.phase}`]);
  if (by.greedy) checks.push(["无脑铺塔应在第 9–13 波失守", by.greedy.phase === PHASE.LOST && by.greedy.wave >= 9 && by.greedy.wave <= 13, `实际 第${by.greedy.wave}波 ${by.greedy.phase}`]);
  if (by.quality) checks.push(["精选升级应通关且剩余 10–18 生命", by.quality.phase === PHASE.WON && by.quality.hp >= 10 && by.quality.hp <= 18, `实际 ${by.quality.phase} hp=${by.quality.hp}`]);

  let pass = true;
  for (const [name, ok, actual] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ← ${actual}`}`);
    if (!ok) pass = false;
  }
  console.log(pass ? "\n所有难度断言通过。" : "\n难度断言失败——数值需要调整。");
  process.exit(pass ? 0 : 1);
}
