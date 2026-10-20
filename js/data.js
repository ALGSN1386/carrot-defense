// 保卫萝卜 V2 · 数据层
// 本文件不依赖任何其他模块，Node 与浏览器共用。
// 所有平衡性数值只允许在本文件里改；改完必须重跑 scripts/sim.js（PRD §4.2 R5）。

// ---------- 棋盘 ----------
export const TILE = 60;
export const COLS = 16;
export const ROWS = 10;
export const WIDTH = COLS * TILE; // 960
export const HEIGHT = ROWS * TILE; // 600

// 格子类型：
//   '.' 可建造   '#' 路径（不可建造）   'o' 装饰（不可建造，树/石）
// 这张表就是地图本身，不再由几何推算——PRD 缺口 1 的补齐。
export const MAP_GRID = [
  "ooooo......ooooo",
  "...............o",
  "#####....#####.o",
  "....#....#...#.o",
  "o...#....#...#..",
  "o...#....#...###",
  "oo..######......",
  "ooo..........ooo",
  "ooo..........ooo",
  "oooo........oooo",
];

// 路径折线（格坐标），逐段乘以 TILE 得到像素路径
export const PATH_POINTS = [
  [-1, 2], [4, 2], [4, 6], [9, 6], [9, 2], [13, 2], [13, 5], [15.6, 5],
];

export const PATH = PATH_POINTS.map(([x, y]) => ({ x: x * TILE, y: y * TILE }));

export const PATH_SEGMENTS = (() => {
  const segs = [];
  let total = 0;
  for (let i = 0; i < PATH.length - 1; i += 1) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    segs.push({ a, b, len, start: total, ux: dx / len, uy: dy / len });
    total += len;
  }
  return { segs, total }; // total ≈ 1656
})();

export const PATH_LENGTH = PATH_SEGMENTS.total;

/** 格坐标 → 类型字符；越界返回 null */
function tileAt(col, row) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return MAP_GRID[row][col];
}

/** 该格能否建塔（只看地形，不看是否已被占用） */
export function isBuildableTile(col, row) {
  return tileAt(col, row) === ".";
}

// ---------- 塔 ----------
// upgrade: 每级对面板的乘法/加法（PRD §4.2 R3）
export const MAX_LEVEL = 3;
export const UPGRADE = { damage: 1.65, range: 18, interval: 0.88 };

export const TOWERS = {
  cannon: {
    id: "cannon",
    name: "瓶子炮",
    cost: 100,
    damage: 9,
    range: 150,
    interval: 0.55,
    projectileSpeed: 560,
    color: "#4c8bd8",
    blurb: "便宜、射速快，前期主力",
  },
  ice: {
    id: "ice",
    name: "冰冻塔",
    cost: 150,
    damage: 5,
    range: 132,
    interval: 1.15,
    projectileSpeed: 520,
    slow: { factor: 0.45, duration: 2.2 },
    color: "#5fc4d8",
    blurb: "减速 45%，拖住快跑怪",
  },
  magic: {
    id: "magic",
    name: "魔法塔",
    cost: 200,
    damage: 22,
    range: 165,
    interval: 1.45,
    projectileSpeed: 480,
    splash: 72,
    color: "#9a6ee0",
    blurb: "范围溅射，清群",
  },
  sun: {
    id: "sun",
    name: "太阳花",
    cost: 120,
    damage: 0,
    range: 0,
    interval: 7,
    income: 16,
    color: "#e8b13a",
    blurb: "每 7 秒产 16 金币",
  },
  flame: {
    id: "flame",
    name: "火焰塔",
    cost: 240,
    damage: 7,
    range: 128,
    interval: 0.35,
    projectileSpeed: 0, // 0 = 瞬时命中，无飞行物
    burn: { dps: 9, duration: 2.5 },
    color: "#e2683c",
    blurb: "点燃持续掉血",
  },
};

export const TOWER_ORDER = ["cannon", "ice", "magic", "sun", "flame"];

// ---------- 怪物 ----------
export const ENEMIES = {
  grunt: { id: "grunt", name: "小怪", hp: 44, speed: 56, bounty: 9, radius: 18, leak: 1, armor: 0 },
  runner: { id: "runner", name: "快跑怪", hp: 30, speed: 104, bounty: 8, radius: 15, leak: 1, armor: 0 },
  armored: { id: "armored", name: "铁甲怪", hp: 150, speed: 40, bounty: 16, radius: 21, leak: 2, armor: 4 },
  shielded: {
    id: "shielded", name: "护盾怪", hp: 70, shield: 70, speed: 52, bounty: 18, radius: 19, leak: 2, armor: 0,
  },
  boss: { id: "boss", name: "首领", hp: 900, speed: 32, bounty: 130, radius: 30, leak: 5, armor: 3 },
};

// ---------- 波次 ----------
// 每一波 = 若干编队；编队字段：
//   type 怪物类型 | count 数量 | gap 同队生成间隔(秒) | delay 相对波次开始的延迟(秒)
export const WAVE_COUNT = 15;
export const BOSS_WAVES = [5, 10, 15];
const WAVE_HP_SCALE = 0.22; // 每波生命 ×(1 + 0.22×(w-1))

export const WAVES = [
  /* 1 */ [{ type: "grunt", count: 8, gap: 1.1, delay: 0 }],
  /* 2 */ [{ type: "grunt", count: 14, gap: 0.9, delay: 0 }],
  /* 3 */ [{ type: "runner", count: 8, gap: 0.85, delay: 0 }],
  /* 4 */ [{ type: "grunt", count: 12, gap: 0.8, delay: 0 }],
  /* 5 */ [{ type: "grunt", count: 6, gap: 1.0, delay: 0 }, { type: "boss", count: 1, gap: 0, delay: 3 }],
  /* 6 */ [{ type: "armored", count: 4, gap: 1.6, delay: 0 }],
  /* 7 */ [{ type: "runner", count: 8, gap: 0.8, delay: 0 }, { type: "grunt", count: 6, gap: 1.1, delay: 1 }],
  /* 8 */ [{ type: "shielded", count: 5, gap: 1.6, delay: 0 }],
  /* 9 */ [{ type: "armored", count: 6, gap: 1.4, delay: 0 }],
  /* 10 */ [{ type: "shielded", count: 4, gap: 1.4, delay: 0 }, { type: "boss", count: 1, gap: 0, delay: 4 }],
  /* 11 */ [{ type: "runner", count: 14, gap: 0.6, delay: 0 }, { type: "armored", count: 4, gap: 1.4, delay: 2 }],
  /* 12 */ [{ type: "shielded", count: 8, gap: 1.2, delay: 0 }],
  /* 13 */ [{ type: "armored", count: 10, gap: 1.1, delay: 0 }, { type: "runner", count: 8, gap: 0.7, delay: 3 }],
  /* 14 */ [{ type: "shielded", count: 8, gap: 1.1, delay: 0 }, { type: "boss", count: 1, gap: 0, delay: 5 }],
  /* 15 */ [
    { type: "armored", count: 4, gap: 1.4, delay: 0 },
    { type: "boss", count: 1, gap: 0, delay: 3 },
    { type: "runner", count: 10, gap: 0.6, delay: 6 },
  ],
];

// ---------- 经济 ----------
export const ECONOMY = {
  startCoins: 320,
  sellRefund: 0.6,          // 按累计投入返还
  upgradeCost: (base, level) => Math.round(base * Math.pow(1.3, level)),
  waveBonus: (wave) => 40 + wave * 10,
};

// ---------- 对局 ----------
export const CARROT_HP = 20;
export const BUILD_TIME = 12;   // 布防倒计时（秒）
export const SPEEDS = [1, 2, 3];

// ---------- 工具 ----------
// 说明：这里本来有一个 mulberry32 随机数生成器，但全项目从未调用过。
// 确定性来自"玩法里没有任何随机源"，不是来自种子——删掉它，别让代码说谎。

/** 波次生命倍率 */
export function hpScaleFor(wave) {
  return 1 + (wave - 1) * WAVE_HP_SCALE;
}
