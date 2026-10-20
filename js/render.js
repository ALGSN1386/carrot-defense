// 保卫萝卜 V2 · 渲染层
// 只读 state，不写 state。所有画面都是程序化绘制——仓库里没有任何图片素材。
//
// 表现层要解决三件事：
//   1) 玩家能 0.2 秒内辨认出威胁（每种怪一个独立剪影）
//   2) 每次命中有反馈（受击闪白、炮口火光、死亡碎裂）
//   3) 重要事件有分量（漏怪震屏、萝卜挨打发抖）

import {
  TILE, COLS, ROWS, WIDTH, HEIGHT, MAP_GRID, PATH_SEGMENTS, PATH, TOWERS,
} from "./data.js";
import { statsAt } from "./rules.js";

const COLORS = {
  dirt: "#c9a26a",
  dirtEdge: "#ab8752",
  trunk: "#7b5230",
  leaf: "#4e8f3c",
  leafLight: "#63a94b",
  rock: "#9aa3ad",
  rockDark: "#7d868f",
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// ---------------- 静态背景 ----------------
export function buildBackground() {
  const cv = document.createElement("canvas");
  cv.width = WIDTH;
  cv.height = HEIGHT;
  const g = cv.getContext("2d");

  const base = g.createLinearGradient(0, 0, 0, HEIGHT);
  base.addColorStop(0, "#96c661");
  base.addColorStop(0.55, "#8abd55");
  base.addColorStop(1, "#7cae4b");
  g.fillStyle = base;
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // 低频光斑：制造连续感，避免棋盘格
  for (let i = 0; i < 30; i += 1) {
    const x = hash2(i, 11) * (WIDTH + 200) - 100;
    const y = hash2(i, 23) * (HEIGHT + 200) - 100;
    const r = 90 + hash2(i, 37) * 160;
    const light = hash2(i, 51) > 0.5;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, light ? "rgba(200,232,150,0.22)" : "rgba(84,132,56,0.16)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // 极淡格线：帮助判断落点，但不抢戏
  g.strokeStyle = "rgba(255,255,255,0.055)";
  g.lineWidth = 1;
  for (let c = 1; c < COLS; c += 1) {
    g.beginPath(); g.moveTo(c * TILE + 0.5, 0); g.lineTo(c * TILE + 0.5, HEIGHT); g.stroke();
  }
  for (let r = 1; r < ROWS; r += 1) {
    g.beginPath(); g.moveTo(0, r * TILE + 0.5); g.lineTo(WIDTH, r * TILE + 0.5); g.stroke();
  }

  // 路面收窄到 37px / 30px：让相邻格的塔不再压进路面（这是"塔像摆在路上"的根因）
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = COLORS.dirtEdge;
  g.lineWidth = TILE * 0.62;
  strokePath(g);
  g.strokeStyle = COLORS.dirt;
  g.lineWidth = TILE * 0.5;
  strokePath(g);

  for (let d = 0; d < PATH_SEGMENTS.total; d += 24) {
    const p = pointAtPath(d);
    const off = (hash2(d, 3) - 0.5) * TILE * 0.3;
    g.fillStyle = `rgba(140,110,70,${0.16 + hash2(d, 9) * 0.18})`;
    g.beginPath();
    g.arc(p.x + off, p.y + off * 0.6, 1.6 + hash2(d, 5) * 2, 0, Math.PI * 2);
    g.fill();
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (MAP_GRID[row][col] !== "o") continue;
      const cx = col * TILE + TILE / 2;
      const cy = row * TILE + TILE / 2;
      const h = hash2(col + 7, row + 3);
      const s = 0.8 + h * 0.45;
      if (h < 0.6) drawTree(g, cx + (hash2(col, row) - 0.5) * 10, cy + (hash2(row, col) - 0.5) * 8, s);
      else drawRock(g, cx + (hash2(col + 1, row) - 0.5) * 12, cy + (hash2(col, row + 1) - 0.5) * 10, s);
    }
  }

  const start = PATH[0];
  const end = PATH[PATH.length - 1];
  g.fillStyle = "rgba(60,80,45,0.30)";
  g.fillRect(start.x - 8, start.y - TILE * 0.31, 20, TILE * 0.62);
  g.fillStyle = "rgba(38,62,28,0.8)";
  g.font = "700 14px system-ui, sans-serif";
  g.textAlign = "left";
  g.fillText("入口", 10, start.y - 20);
  g.textAlign = "right";
  g.fillText("终点", end.x - 44, end.y - 48);

  // 四角压暗，把视线收到中间
  const vg = g.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.35, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.95);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(20,40,20,0.22)");
  g.fillStyle = vg;
  g.fillRect(0, 0, WIDTH, HEIGHT);

  return cv;
}

function strokePath(g) {
  g.beginPath();
  g.moveTo(PATH[0].x, PATH[0].y);
  for (let i = 1; i < PATH.length; i += 1) g.lineTo(PATH[i].x, PATH[i].y);
  g.stroke();
}

function pointAtPath(d) {
  for (const seg of PATH_SEGMENTS.segs) {
    if (d <= seg.start + seg.len) {
      const t = d - seg.start;
      return { x: seg.a.x + seg.ux * t, y: seg.a.y + seg.uy * t };
    }
  }
  const last = PATH[PATH.length - 1];
  return { x: last.x, y: last.y };
}

function drawTree(g, x, y, s) {
  g.fillStyle = "rgba(20,40,20,0.18)";
  g.beginPath();
  g.ellipse(x, y + 12 * s, 18 * s, 7 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.trunk;
  g.fillRect(x - 2.6 * s, y - 2 * s, 5.2 * s, 15 * s);
  g.fillStyle = "#3f7a31";
  g.beginPath();
  g.arc(x, y - 8 * s, 14 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.leaf;
  g.beginPath();
  g.arc(x - 2 * s, y - 9 * s, 12 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.leafLight;
  g.beginPath();
  g.arc(x - 5 * s, y - 13 * s, 6.5 * s, 0, Math.PI * 2);
  g.fill();
}

function drawRock(g, x, y, s) {
  g.fillStyle = "rgba(20,30,40,0.18)";
  g.beginPath();
  g.ellipse(x, y + 9 * s, 15 * s, 6 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.rockDark;
  g.beginPath();
  g.moveTo(x - 13 * s, y + 7 * s);
  g.lineTo(x - 6 * s, y - 10 * s);
  g.lineTo(x + 5 * s, y - 8 * s);
  g.lineTo(x + 13 * s, y + 7 * s);
  g.closePath();
  g.fill();
  g.fillStyle = COLORS.rock;
  g.beginPath();
  g.moveTo(x - 13 * s, y + 7 * s);
  g.lineTo(x - 6 * s, y - 10 * s);
  g.lineTo(x + 1 * s, y - 2 * s);
  g.closePath();
  g.fill();
}

// ---------------- 场景 ----------------
export function drawScene(ctx, state, view) {
  ctx.save();
  // 漏怪震屏：只影响画面，不影响逻辑
  if (state.shake && state.shake.t > 0) {
    const k = Math.max(0, state.shake.t / state.shake.dur);
    const mag = state.shake.mag * k * k;
    const t = now();
    ctx.translate(Math.sin(t * 71) * mag, Math.cos(t * 83) * mag);
  }

  ctx.clearRect(-20, -20, WIDTH + 40, HEIGHT + 40);
  ctx.drawImage(view.background, 0, 0);

  if (view.hover) drawHover(ctx, state, view);
  drawCarrot(ctx, state);
  for (const t of state.towers) drawTower(ctx, t, view);
  for (const e of state.enemies) drawEnemy(ctx, e);
  for (const p of state.projectiles) drawProjectile(ctx, p);
  for (const p of state.particles) drawParticle(ctx, p);
  for (const f of state.floats) drawFloat(ctx, f);
  if (view.selectedTower) drawRangeOf(ctx, view.selectedTower, "#5b9bf0", 0.09);
  ctx.restore();
}

function drawHover(ctx, state, view) {
  const { col, row, type } = view.hover;
  const ok = view.hoverOk;
  const x = col * TILE;
  const y = row * TILE;
  ctx.fillStyle = ok ? "rgba(90,200,110,0.28)" : "rgba(220,80,80,0.26)";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = ok ? "rgba(70,180,90,0.9)" : "rgba(200,60,60,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  if (ok && type && TOWERS[type]) {
    const def = TOWERS[type];
    if (def.range) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2, def.range, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(63,127,214,0.10)";
      ctx.fill();
      ctx.strokeStyle = "rgba(63,127,214,0.45)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 0.55;
    drawBody(ctx, x + TILE / 2, y + TILE / 2, type, 1, -Math.PI / 2, 0, 0);
    ctx.globalAlpha = 1;
  }
}

function drawRangeOf(ctx, tower, color, alpha) {
  const s = statsAt(tower);
  if (!s.range) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, s.range, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ---------------- 萝卜 ----------------
function drawCarrot(ctx, state) {
  const p = PATH[PATH.length - 1];
  const x = p.x - 26;
  const y = p.y;
  const ratio = Math.max(0, state.hp / state.maxHp);
  const flinch = state.carrotFlinch || 0;

  ctx.save();
  ctx.translate(x, y + 18);
  // 挨打时抖一下——原版靠这个制造情绪
  if (flinch > 0) {
    ctx.rotate(Math.sin(flinch * 90) * 0.09 * Math.min(1, flinch * 4));
    ctx.translate(Math.sin(flinch * 120) * 2.5, 0);
  }
  ctx.fillStyle = "rgba(20,40,20,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 24, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#4f9b3d";
  for (const dx of [-9, 0, 9]) {
    ctx.beginPath();
    ctx.ellipse(dx, -34, 6, 15, dx * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  const grad = ctx.createLinearGradient(-20, -20, 20, 20);
  grad.addColorStop(0, "#f79a3c");
  grad.addColorStop(1, "#e8721f");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-21, -16);
  ctx.quadraticCurveTo(0, -28, 21, -16);
  ctx.quadraticCurveTo(13, 28, 0, 32);
  ctx.quadraticCurveTo(-13, 28, -21, -16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(180,80,20,0.45)";
  ctx.lineWidth = 1.5;
  for (const dy of [-7, 3, 13]) {
    ctx.beginPath();
    ctx.moveTo(-12, dy);
    ctx.lineTo(12, dy - 3);
    ctx.stroke();
  }
  // 血量越低表情越惨
  const happy = ratio > 0.45;
  ctx.strokeStyle = "#3a2416";
  ctx.fillStyle = "#3a2416";
  if (happy) {
    ctx.beginPath(); ctx.arc(-7, -8, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(7, -8, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 1, 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  } else {
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(-4, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(4, -6); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 6, 5, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
  }
  ctx.restore();

  const bw = 64;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x - bw / 2, y + 42, bw, 8, 4);
  ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? "#5bd06a" : ratio > 0.25 ? "#e8c24a" : "#e2603c";
  roundRect(ctx, x - bw / 2 + 1, y + 43, Math.max(0, (bw - 2) * ratio), 6, 3);
  ctx.fill();
}

// ---------------- 塔 ----------------
function drawTower(ctx, tower, view) {
  const isSel = view.selectedTower && view.selectedTower.id === tower.id;
  const s = statsAt(tower);
  // 后坐力从冷却进度反推，不需要额外状态
  const recoil = !s.interval ? 0 : Math.max(0, 1 - tower.cooldown / s.interval);

  ctx.save();
  ctx.fillStyle = "rgba(20,40,20,0.16)";
  ctx.beginPath();
  ctx.ellipse(tower.x, tower.y + 16, 17, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 建造台：一块实心石台。之前用半透明白，在草地上会糊成一团雾。
  ctx.fillStyle = "rgba(58,48,34,0.26)";
  roundRect(ctx, tower.x - 22, tower.y - 22, 44, 44, 10);
  ctx.fill();
  ctx.fillStyle = "rgba(226,232,214,0.30)";
  roundRect(ctx, tower.x - 20, tower.y - 20, 40, 40, 8);
  ctx.fill();
  ctx.strokeStyle = isSel ? "#8fc2ff" : "rgba(70,90,60,0.42)";
  ctx.lineWidth = isSel ? 2 : 1.2;
  roundRect(ctx, tower.x - 22, tower.y - 22, 44, 44, 10);
  ctx.stroke();

  drawBody(ctx, tower.x, tower.y, tower.type, tower.level, tower.angle, now() + tower.id, recoil);

  for (let i = 0; i < tower.level; i += 1) {
    ctx.fillStyle = "#ffe9a8";
    ctx.strokeStyle = "rgba(120,90,20,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tower.x - 10 + i * 10, tower.y + 19, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** 塔本体；商店图标复用同一函数，保证图标与实物永远一致 */
export function drawBody(ctx, x, y, type, level, angle, pulse = 0, recoil = 0) {
  ctx.save();
  ctx.translate(x, y);
  // 0.82 系数：让塔圆不压到相邻路面——路与塔的视觉分离靠它
  const scale = (1 + (level - 1) * 0.08) * 0.82;
  ctx.scale(scale, scale);
  const back = recoil * 4;

  ctx.fillStyle = "#5f6f47";
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8c9a6b";
  ctx.beginPath();
  ctx.arc(0, -2, 18, 0, Math.PI * 2);
  ctx.fill();

  if (type === "cannon") {
    ctx.save();
    ctx.rotate(angle);
    ctx.translate(-back, 0);
    ctx.fillStyle = "#1d3350";
    roundRect(ctx, 4, -6.5, 26, 13, 6);
    ctx.fill();
    ctx.fillStyle = "#4c8bd8";
    roundRect(ctx, 1, -9, 15, 18, 6);
    ctx.fill();
    ctx.fillStyle = "#7fb2ea";
    roundRect(ctx, 4, -6, 6, 12, 3);
    ctx.fill();
    ctx.fillStyle = "#12263d";
    ctx.beginPath();
    ctx.arc(30, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (type === "ice") {
    ctx.fillStyle = "#2f6e7d";
    ctx.beginPath();
    ctx.arc(0, -3, 14, 0, Math.PI * 2);
    ctx.fill();
    const spin = pulse * 0.6;
    ctx.fillStyle = "#8fdcf0";
    for (let i = 0; i < 6; i += 1) {
      ctx.save();
      ctx.rotate((i / 6) * Math.PI * 2 + spin);
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(0, -21);
      ctx.lineTo(2.8, -3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#d7f6ff";
    ctx.beginPath();
    ctx.arc(0, -3, 6.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "magic") {
    const glow = 0.55 + 0.45 * Math.sin(pulse * 3);
    ctx.fillStyle = "#4a3172";
    ctx.beginPath();
    ctx.moveTo(-15, 2);
    ctx.lineTo(-9, -17);
    ctx.lineTo(9, -17);
    ctx.lineTo(15, 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.35 * glow;
    ctx.fillStyle = "#c9a4ff";
    ctx.beginPath();
    ctx.arc(0, -14, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#c9a4ff";
    ctx.beginPath();
    ctx.arc(0, -14, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2e6ff";
    ctx.beginPath();
    ctx.arc(-1.5, -16, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "sun") {
    ctx.save();
    ctx.rotate(pulse * 0.5);
    ctx.fillStyle = "#f2c14e";
    for (let i = 0; i < 8; i += 1) {
      ctx.save();
      ctx.rotate((i / 8) * Math.PI * 2);
      roundRect(ctx, -3.2, -22, 6.4, 11, 3.2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = "#c98a1e";
    ctx.beginPath();
    ctx.arc(0, -2, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(0, -2, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7a4f12";
    ctx.beginPath(); ctx.arc(-3.6, -3.5, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3.6, -3.5, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#7a4f12";
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(0, 0.5, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  } else if (type === "flame") {
    ctx.fillStyle = "#4a2a19";
    ctx.beginPath();
    ctx.arc(0, -2, 15, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 3; i += 1) {
      const h = 15 + Math.sin(pulse * 7 + i * 1.7) * 4;
      ctx.fillStyle = i === 0 ? "#ffd166" : i === 1 ? "#f3803a" : "#d9432b";
      ctx.beginPath();
      ctx.ellipse(Math.sin(pulse * 3 + i) * 1.5, -7 - i * 3, 8.5 - i * 2, h * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------- 怪物 ----------------
const ENEMY_SKIN = {
  grunt: { body: "#9aa0aa", dark: "#6a707a" },
  runner: { body: "#b7d16a", dark: "#7f9440" },
  armored: { body: "#7c8794", dark: "#4a545f" },
  shielded: { body: "#8fb8d8", dark: "#5a7f9c" },
  boss: { body: "#c46a8a", dark: "#8b425c" },
};

function drawEnemy(ctx, e) {
  const bob = Math.sin((e.progress + e.id * 37) * 0.045) * 2.2;
  const x = e.x;
  const y = e.y + bob;
  const r = e.radius;
  const slow = e.slowFactor < 1;

  ctx.save();
  ctx.fillStyle = "rgba(20,40,20,0.22)";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + r * 0.78, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  if (e.burnTimer > 0) {
    const f = 0.5 + 0.5 * Math.sin(now() * 12 + e.id);
    ctx.fillStyle = `rgba(240,110,40,${0.18 + 0.14 * f})`;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const skin = slow ? "#8fc6e2" : ENEMY_SKIN[e.type].body;
  const edge = slow ? "#5b93b0" : ENEMY_SKIN[e.type].dark;

  if (e.type === "runner") {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x - r - 6 - i * 5, y - 4 + i * 4);
      ctx.lineTo(x - r - 1 - i * 5, y - 4 + i * 4);
      ctx.stroke();
    }
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.82, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (e.type === "armored") {
    ctx.fillStyle = skin;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (r - 5), y + Math.sin(a) * (r - 5), 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (e.type === "shielded") {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (e.shield > 0) {
      const sr = r + 5;
      ctx.strokeStyle = `rgba(120,205,255,${0.35 + 0.35 * (e.shield / e.maxShield)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = x + Math.cos(a) * sr;
        const py = y + Math.sin(a) * sr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  } else if (e.type === "boss") {
    const glow = 0.4 + 0.3 * Math.sin(now() * 3);
    ctx.fillStyle = `rgba(200,90,130,${glow * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#5d2740";
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sgn * r * 0.55, y - r * 0.75);
      ctx.lineTo(x + sgn * r * 0.95, y - r * 1.55);
      ctx.lineTo(x + sgn * r * 0.15, y - r * 0.95);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y - r * 1.02);
    ctx.lineTo(x - r * 0.3, y - r * 1.32);
    ctx.lineTo(x, y - r * 1.06);
    ctx.lineTo(x + r * 0.3, y - r * 1.32);
    ctx.lineTo(x + r * 0.5, y - r * 1.02);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = edge;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sgn * r * 0.45, y - r * 0.82);
      ctx.lineTo(x + sgn * r * 0.72, y - r * 1.25);
      ctx.lineTo(x + sgn * r * 0.2, y - r * 0.95);
      ctx.closePath();
      ctx.fill();
    }
  }

  const ey = -r * 0.15;
  const eyeR = Math.max(1.6, r * 0.16);
  ctx.fillStyle = "#1c1f26";
  ctx.beginPath(); ctx.arc(x - r * 0.3, y + ey, eyeR, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.3, y + ey, eyeR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath(); ctx.arc(x - r * 0.3 - eyeR * 0.3, y + ey - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.3 - eyeR * 0.3, y + ey - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2); ctx.fill();

  // 受击闪白：之前这个字段只赋值不绘制，等于命中没有任何反馈
  if (e.hitFlash > 0) {
    ctx.globalAlpha = Math.min(0.85, e.hitFlash / 0.12);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const bw = r * 2.2;
  const by = y - r - 13;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(ctx, x - bw / 2, by, bw, 5, 2.5);
  ctx.fill();
  const ratio = Math.max(0, e.hp / e.maxHp);
  ctx.fillStyle = ratio > 0.5 ? "#67d477" : ratio > 0.25 ? "#e8c24a" : "#e2603c";
  roundRect(ctx, x - bw / 2, by, bw * ratio, 5, 2.5);
  ctx.fill();
  if (e.shield > 0) {
    ctx.fillStyle = "rgba(120,205,255,0.92)";
    roundRect(ctx, x - bw / 2, by - 6, bw * (e.shield / e.maxShield), 3, 1.5);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------- 子弹 / 特效 ----------------
function drawProjectile(ctx, p) {
  ctx.save();
  if (p.kind === "magic") {
    ctx.strokeStyle = "rgba(200,160,255,0.35)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p.x - (p.tx - p.x) * 0.06, p.y - (p.ty - p.y) * 0.06);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.shadowColor = "#9a6ee0";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#d9bcff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "ice") {
    ctx.strokeStyle = "rgba(180,235,250,0.3)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p.x - (p.tx - p.x) * 0.07, p.y - (p.ty - p.y) * 0.07);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = "#d8f4ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(60,60,70,0.28)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x - (p.tx - p.x) * 0.05, p.y - (p.ty - p.y) * 0.05);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = "#3a3f46";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(p.x - 1.4, p.y - 1.4, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticle(ctx, p) {
  const a = Math.max(0, Math.min(1, p.life * 3));
  ctx.save();
  ctx.globalAlpha = a;
  if (p.kind === "muzzle") {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle || 0);
    const k = 1 - p.life / (p.dur || 0.12);
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.ellipse(8 + k * 6, 0, 9 * (1 - k * 0.4), 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,200,80,0.55)";
    ctx.beginPath();
    ctx.arc(6, 0, Math.max(0.1, 10 * (1 - k)), 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "splash") {
    ctx.strokeStyle = p.color || "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.1, p.r * (1 - p.life * 2)), 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const n = p.kind === "boss-pop" ? 12 : 6;
    ctx.fillStyle = p.color || "#f0c060";
    for (let i = 0; i < n; i += 1) {
      const ang = (i / n) * Math.PI * 2 + (p.seed || 0);
      const d = (1 - p.life * 3) * (p.kind === "boss-pop" ? 40 : 22);
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, p.kind === "boss-pop" ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFloat(ctx, f) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, f.life * 2);
  ctx.font = "700 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = f.kind === "coin" ? "#ffd75e" : "#fff";
  ctx.strokeStyle = "rgba(60,40,0,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeText(f.text, f.x, f.y);
  ctx.fillText(f.text, f.x, f.y);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

