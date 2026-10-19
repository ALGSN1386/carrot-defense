/**
 * 地图与数值配置。
 *
 * 这个文件不碰 DOM、不碰 canvas —— 逻辑层与渲染层都从这里取数据，
 * 因此数值可以在 Node 里直接跑仿真调整。
 */

export const TILE = 60;
export const COLS = 16;
export const ROWS = 10;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

/** 路径拐点（格子坐标，允许负数表示从画面外走进来）。 */
const PATH_POINTS = [
  [-1, 2],
  [4, 2],
  [4, 6],
  [9, 6],
  [9, 2],
  [13, 2],
  [13, 5],
  [15.6, 5],
];

export const CARROT = { gx: 15.6, gy: 5, x: 15.6 * TILE, y: 5 * TILE };

const key = (gx, gy) => `${gx},${gy}`;

function buildPath() {
  const points = PATH_POINTS.map(([gx, gy]) => ({
    gx,
    gy,
    x: (gx + 0.5) * TILE,
    y: (gy + 0.5) * TILE,
  }));

  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    segments.push({ a, b, dx, dy, length, start: total });
    total += length;
  }

  // 路上的格子（用于禁止建造）
  const tiles = new Set();
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.ceil(Math.max(Math.abs(b.gx - a.gx), Math.abs(b.gy - a.gy)) * 4);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const gx = Math.round(a.gx + (b.gx - a.gx) * t);
      const gy = Math.round(a.gy + (b.gy - a.gy) * t);
      if (gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS) tiles.add(key(gx, gy));
    }
  }

  function pointAt(distance) {
    const d = Math.max(0, Math.min(total, distance));
    let seg = segments[0];
    for (const candidate of segments) {
      if (d >= candidate.start) seg = candidate;
    }
    const local = d - seg.start;
    return {
      x: seg.a.x + (seg.dx / seg.length) * local,
      y: seg.a.y + (seg.dy / seg.length) * local,
    };
  }

  return { points, segments, tiles, length: total, pointAt };
}

export const PATH = buildPath();

/** 不可建造的格子：路面 + 装饰物占位。 */
export const DECOR = [
  { gx: 1, gy: 0, kind: 'tree' },
  { gx: 7, gy: 0, kind: 'tree' },
  { gx: 15, gy: 1, kind: 'tree' },
  { gx: 0, gy: 8, kind: 'tree' },
  { gx: 6, gy: 9, kind: 'bush' },
  { gx: 12, gy: 8, kind: 'tree' },
  { gx: 3, gy: 8, kind: 'rock' },
  { gx: 11, gy: 0, kind: 'bush' },
  { gx: 2, gy: 4, kind: 'flower' },
  { gx: 7, gy: 4, kind: 'flower' },
  { gx: 15, gy: 8, kind: 'flower' },
  { gx: 5, gy: 1, kind: 'flower' },
  { gx: 10, gy: 9, kind: 'rock' },
  { gx: 0, gy: 5, kind: 'bush' },
];

export const BLOCKED = new Set(PATH.tiles);
for (const item of DECOR) {
  if (item.kind !== 'flower') BLOCKED.add(key(item.gx, item.gy));
}

export function isBuildable(gx, gy) {
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return false;
  return !BLOCKED.has(key(gx, gy));
}

/* ------------------------------------------------------------------ */
/* 塔                                                                  */
/* ------------------------------------------------------------------ */

export const TOWERS = {
  cannon: {
    id: 'cannon',
    name: '瓶子炮',
    blurb: '射速快，单体输出稳定',
    cost: 100,
    range: 150,
    damage: 9,
    rate: 0.55,
    projectileSpeed: 430,
    kind: 'projectile',
    color: '#3f7f4f',
  },
  ice: {
    id: 'ice',
    name: '冰冻塔',
    blurb: '命中范围内的敌人减速',
    cost: 150,
    range: 132,
    damage: 5,
    rate: 1.15,
    projectileSpeed: 380,
    kind: 'slow',
    splash: 58,
    slowFactor: 0.45,
    slowDuration: 2.2,
    color: '#4aa8d8',
  },
  magic: {
    id: 'magic',
    name: '魔法塔',
    blurb: '范围伤害，清小怪快',
    cost: 200,
    range: 165,
    damage: 22,
    rate: 1.45,
    projectileSpeed: 300,
    kind: 'splash',
    splash: 72,
    color: '#8a6ad8',
  },
  sun: {
    id: 'sun',
    name: '太阳花',
    blurb: '每 6 秒产金币，不攻击',
    cost: 120,
    range: 0,
    damage: 0,
    rate: 0,
    kind: 'income',
    income: 16,
    incomeEvery: 7,
    color: '#f0a83c',
  },
  flame: {
    id: 'flame',
    name: '火焰塔',
    blurb: '持续灼烧，克制高血量',
    cost: 240,
    range: 128,
    damage: 7,
    rate: 0.35,
    projectileSpeed: 260,
    kind: 'burn',
    burnDuration: 2.5,
    burnDps: 9,
    color: '#e0643c',
  },
};

export const TOWER_ORDER = ['cannon', 'ice', 'magic', 'sun', 'flame'];

/** 升级：等级 2/3 的花费与倍率。 */
export const UPGRADE = {
  maxLevel: 3,
  cost: (tower) => Math.round(tower.cost * (tower.level === 1 ? 0.9 : 1.3)),
  damageMul: 1.65,
  rangeAdd: 18,
  rateMul: 0.88,
};

/* ------------------------------------------------------------------ */
/* 怪物                                                                */
/* ------------------------------------------------------------------ */

export const ENEMIES = {
  grunt: {
    id: 'grunt',
    name: '小怪',
    hp: 44,
    speed: 56,
    reward: 9,
    damage: 1,
    radius: 18,
    color: '#7fc45a',
    dark: '#4b8a30',
  },
  runner: {
    id: 'runner',
    name: '快跑怪',
    hp: 30,
    speed: 104,
    reward: 8,
    damage: 1,
    radius: 15,
    color: '#f0c94a',
    dark: '#b8912a',
  },
  armored: {
    id: 'armored',
    name: '铁甲怪',
    hp: 150,
    speed: 40,
    reward: 16,
    damage: 2,
    radius: 21,
    armor: 4,
    color: '#9aa7b5',
    dark: '#5d6a78',
  },
  shielded: {
    id: 'shielded',
    name: '护盾怪',
    hp: 70,
    speed: 52,
    reward: 18,
    damage: 2,
    radius: 19,
    shield: 70,
    color: '#6f8ff0',
    dark: '#3d5bb8',
  },
  boss: {
    id: 'boss',
    name: '首领',
    hp: 900,
    speed: 32,
    reward: 130,
    damage: 5,
    radius: 30,
    armor: 3,
    color: '#a76de0',
    dark: '#6d3fa8',
  },
};

export const CARROT_HP = 20;
export const START_COINS = 320;

/* ------------------------------------------------------------------ */
/* 波次                                                                */
/* ------------------------------------------------------------------ */

/**
 * 每一波是一组「生成指令」：类型、数量、间隔（秒）、起手延迟（秒）。
 * hp 会随波次线性放大，见 game.js 的 hpScale。
 */
export const WAVES = [
  [{ type: 'grunt', count: 8, gap: 0.9 }],
  [{ type: 'grunt', count: 10, gap: 0.8 }, { type: 'runner', count: 3, gap: 0.9, delay: 4 }],
  [{ type: 'runner', count: 8, gap: 0.6 }, { type: 'grunt', count: 6, gap: 1.0, delay: 3 }],
  [{ type: 'grunt', count: 12, gap: 0.7 }, { type: 'armored', count: 2, gap: 2, delay: 6 }],
  [{ type: 'boss', count: 1, gap: 1 }, { type: 'grunt', count: 8, gap: 0.8, delay: 3 }],
  [{ type: 'runner', count: 12, gap: 0.45 }, { type: 'armored', count: 3, gap: 1.6, delay: 5 }],
  [{ type: 'shielded', count: 4, gap: 1.8 }, { type: 'grunt', count: 12, gap: 0.6, delay: 2 }],
  [{ type: 'armored', count: 5, gap: 1.4 }, { type: 'runner', count: 10, gap: 0.5, delay: 4 }],
  [{ type: 'shielded', count: 6, gap: 1.4 }, { type: 'grunt', count: 14, gap: 0.55, delay: 2 }],
  [{ type: 'boss', count: 1, gap: 1 }, { type: 'shielded', count: 4, gap: 1.5, delay: 4 }],
  [{ type: 'armored', count: 8, gap: 1.1 }, { type: 'runner', count: 14, gap: 0.4, delay: 3 }],
  [{ type: 'shielded', count: 8, gap: 1.2 }, { type: 'armored', count: 6, gap: 1.3, delay: 4 }],
  [{ type: 'runner', count: 20, gap: 0.32 }, { type: 'grunt', count: 16, gap: 0.5, delay: 2 }],
  [{ type: 'shielded', count: 10, gap: 1.0 }, { type: 'armored', count: 8, gap: 1.1, delay: 3 }],
  [{ type: 'boss', count: 1, gap: 1 }, { type: 'shielded', count: 8, gap: 1.0, delay: 3 }, { type: 'runner', count: 16, gap: 0.35, delay: 8 }],
];

export const BUILD_TIME = 12;
export const SPEEDS = [1, 2, 3];
