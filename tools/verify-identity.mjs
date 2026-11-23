/**
 * 保卫萝卜 V2 · A/B 正确性回归
 *
 * 运行：node tools/verify-identity.mjs
 * 用同一套确定性打法，把 A（baseline/js）与 B（js）各跑一遍完整对局，
 * 逐字段对比结果。优化只允许改变速度，不允许改变任何玩法结果。
 */
import { createHash } from "node:crypto";

const A = {
  game: await import("../baseline/js/game.js"),
  rules: await import("../baseline/js/rules.js"),
  data: await import("../baseline/js/data.js"),
};
const B = {
  game: await import("../js/game.js"),
  rules: await import("../js/rules.js"),
  data: await import("../js/data.js"),
};

const DT = 1 / 60;
const MAX_SECONDS = 60 * 40;

function rankSpots(D) {
  const spots = [];
  for (let row = 0; row < D.ROWS; row += 1) {
    for (let col = 0; col < D.COLS; col += 1) {
      if (!D.isBuildableTile(col, row)) continue;
      const cx = col * D.TILE + D.TILE / 2;
      const cy = row * D.TILE + D.TILE / 2;
      let covered = 0;
      for (let d = 0; d < D.PATH_SEGMENTS.total; d += 8) {
        const p = A.rules.pointAt(d);
        if (Math.hypot(p.x - cx, p.y - cy) <= D.TOWERS.cannon.range) covered += 8;
      }
      spots.push({ col, row, score: covered });
    }
  }
  return spots.sort((a, b) => b.score - a.score || a.row - b.row || a.col - b.col);
}

const ORDER = ["cannon", "cannon", "ice", "magic", "cannon", "magic", "cannon", "flame", "magic", "cannon"];

/** 与 scripts/sim.js 的 quality 策略一致 */
function qualityAct(S, D, spots, state) {
  if (state.phase !== "build" && state.phase !== "wave") return;
  const free = () => spots.find((s) => !S.game.towerAt(state, s.col, s.row));
  if (state.towers.length < 7) {
    const type = ORDER[state.towers.length];
    if (state.coins < D.TOWERS[type].cost) return;
    const s = free();
    if (s) S.game.placeTower(state, s.col, s.row, type);
    return;
  }
  const upgrades = state.towers
    .filter((t) => !t.def.income && t.level < D.MAX_LEVEL)
    .map((t) => ({ t, cost: S.game.upgradeCostOf(t) }))
    .sort((a, b) => a.cost - b.cost);
  const spot = free();
  const nextType = ORDER[Math.min(state.towers.length, ORDER.length - 1)];
  const newCost = spot ? D.TOWERS[nextType].cost : Infinity;
  const cheap = upgrades[0];
  if (cheap && cheap.cost <= newCost) {
    if (state.coins >= cheap.cost) S.game.upgradeTower(state, cheap.t.id);
    return;
  }
  if (spot && state.coins >= newCost) S.game.placeTower(state, spot.col, spot.row, nextType);
  if (cheap && state.coins >= cheap.cost) S.game.upgradeTower(state, cheap.t.id);
}

function play(S, D, strategy) {
  const state = S.game.createGame(1);
  const spots = rankSpots(D);
  let elapsed = 0;
  while (state.phase !== "won" && state.phase !== "lost" && elapsed < MAX_SECONDS) {
    if (strategy === "quality") qualityAct(S, D, spots, state);
    if (strategy === "greedy") {
      for (const s of spots) {
        if (state.coins < D.TOWERS.cannon.cost) break;
        if (S.game.towerAt(state, s.col, s.row)) continue;
        if (S.game.placeTower(state, s.col, s.row, "cannon").ok) break;
      }
    }
    S.game.update(state, DT);
    elapsed += DT;
  }
  // 逐字段快照
  return {
    phase: state.phase,
    wave: state.wave,
    hp: state.hp,
    coins: Math.floor(state.coins),
    towers: state.towers.length,
    levels: state.towers.map((t) => t.level).join(","),
    kills: state.stats.kills,
    leaks: state.stats.leaks,
    earned: state.stats.earned,
    spent: state.stats.spent,
    time: Math.round(state.time * 1000) / 1000,
  };
}

let pass = true;
for (const strategy of ["none", "greedy", "quality"]) {
  const a = play(A, A.data, strategy);
  const b = play(B, B.data, strategy);
  const same = JSON.stringify(a) === JSON.stringify(b);
  const hash = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 12);
  console.log(`${same ? "PASS" : "FAIL"}  ${strategy.padEnd(7)}  ${a.phase} 第${a.wave}波 hp=${a.hp} kills=${a.kills}  hash=${hash(a)} / ${hash(b)}`);
  if (!same) {
    pass = false;
    console.log("  A:", a);
    console.log("  B:", b);
  }
}
console.log(pass ? "\nA/B 玩法结果逐字段一致，优化未改变任何玩法。" : "\nFAIL：优化改变了玩法结果。");
process.exit(pass ? 0 : 1);
