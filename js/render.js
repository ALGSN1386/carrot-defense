/**
 * 渲染层：全部用 canvas 基本图形程序化绘制，仓库内无任何图片资源。
 *
 * 约定：所有绘制使用“逻辑坐标”(960×600)。缩放由 ui.js 通过 ctx.setTransform 统一处理，
 * 因此本文件无需关心 DPR 或屏幕宽度（PRD §8.2）。
 */

import { COLS, ROWS, TILE, PATH, DECOR, TOWERS, ENEMIES, WIDTH, HEIGHT } from './config.js';
import { stats } from './game.js';

const C = {
  grass: '#cfe8a8',
  grassAlt: '#c4e29c',
  path: '#e8d3a0',
  pathEdge: '#d8bd84',
  blocked: '#bcd690',
  carrot: '#f08a3c',
  carrotLeaf: '#4f9d3a',
  text: '#3a3327',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawDecor(ctx, item) {
  const x = item.gx * TILE + TILE / 2;
  const y = item.gy * TILE + TILE / 2;
  if (item.kind === 'tree') {
    ctx.fillStyle = '#8a6d4a';
    ctx.fillRect(x - 3, y, 6, 14);
    ctx.fillStyle = '#3f8f3a';
    ctx.beginPath();
    ctx.arc(x, y - 6, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4fa84a';
    ctx.beginPath();
    ctx.arc(x - 6, y - 2, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (item.kind === 'bush') {
    ctx.fillStyle = '#5aa84a';
    for (const o of [[-8, 2], [8, 2], [0, -6]]) {
      ctx.beginPath();
      ctx.arc(x + o[0], y + o[1], 11, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (item.kind === 'rock') {
    ctx.fillStyle = '#9aa0a6';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 16, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b3b9bf';
    ctx.beginPath();
    ctx.ellipse(x - 4, y, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (item.kind === 'flower') {
    ctx.strokeStyle = '#4f9d3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y - 4);
    ctx.stroke();
    ctx.fillStyle = '#ff7aa8';
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 5, y - 4 + Math.sin(a) * 5, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd95e';
    ctx.beginPath();
    ctx.arc(x, y - 4, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCarrot(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  // 叶子
  ctx.fillStyle = C.carrotLeaf;
  for (const a of [-0.5, 0, 0.5]) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, -18, 5, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 身体
  ctx.fillStyle = C.carrot;
  ctx.beginPath();
  ctx.moveTo(-11, -4);
  ctx.lineTo(11, -4);
  ctx.lineTo(0, 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d9742c';
  for (const ry of [-1, 6, 13]) {
    ctx.fillRect(-9, ry, 18, 1.6);
  }
  ctx.restore();
}

function drawTower(ctx, tower) {
  const def = TOWERS[tower.type];
  const x = tower.x;
  const y = tower.y;
  const s = stats(tower);

  // 底座
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 20, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);

  if (tower.pulse > 0) {
    ctx.fillStyle = `rgba(255,255,255,${tower.pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  if (def.kind === 'income') {
    // 太阳花
    ctx.fillStyle = def.color;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(-3, -22, 6, 12);
      ctx.restore();
    }
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 塔身
    ctx.fillStyle = def.color;
    roundRect(ctx, -15, -6, 30, 22, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, -15, -6, 30, 8, 5);
    ctx.fill();
    // 炮管（朝向目标）
    ctx.rotate(tower.angle);
    ctx.fillStyle = def.dark || '#2c2c2c';
    ctx.fillRect(0, -4, 20, 8);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
  }

  // 等级点
  ctx.fillStyle = '#fff';
  for (let i = 0; i < tower.level; i += 1) {
    ctx.beginPath();
    ctx.arc(-8 + i * 8, 16, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemy(ctx, enemy) {
  const def = ENEMIES[enemy.type];
  const x = enemy.x;
  const y = enemy.y + Math.sin(enemy.wobble) * 1.5;

  // 身体
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.arc(x, y, enemy.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = def.dark;
  ctx.beginPath();
  ctx.arc(x, y, enemy.radius, Math.PI * 0.15, Math.PI * 0.85);
  ctx.fill();
  // 眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x - enemy.radius * 0.35, y - enemy.radius * 0.2, 3, 0, Math.PI * 2);
  ctx.arc(x + enemy.radius * 0.35, y - enemy.radius * 0.2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(x - enemy.radius * 0.35, y - enemy.radius * 0.2, 1.4, 0, Math.PI * 2);
  ctx.arc(x + enemy.radius * 0.35, y - enemy.radius * 0.2, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // 减速光圈
  if (enemy.slowUntil > 0) {
    ctx.strokeStyle = 'rgba(120,200,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, enemy.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 灼烧光圈
  if (enemy.burnUntil > 0) {
    ctx.strokeStyle = 'rgba(255,140,60,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, enemy.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 血条
  const w = enemy.radius * 2;
  const ratio = Math.max(0, enemy.hp / enemy.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - w / 2, y - enemy.radius - 9, w, 4);
  ctx.fillStyle = ratio > 0.5 ? '#6fd06f' : ratio > 0.25 ? '#e8c84a' : '#e8604a';
  ctx.fillRect(x - w / 2, y - enemy.radius - 9, w * ratio, 4);

  // 护盾条
  if (enemy.maxShield > 0) {
    const sr = Math.max(0, enemy.shield / enemy.maxShield);
    ctx.fillStyle = 'rgba(120,150,255,0.85)';
    ctx.fillRect(x - w / 2, y - enemy.radius - 14, w * sr, 3);
  }
}

function drawProjectile(ctx, p) {
  if (p.kind === 'slow') ctx.fillStyle = '#bfe6ff';
  else if (p.kind === 'splash') ctx.fillStyle = '#d8c0ff';
  else if (p.kind === 'burn') ctx.fillStyle = '#ff9a5a';
  else ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawParticle(ctx, p) {
  ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFloat(ctx, f) {
  ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
  ctx.fillStyle = f.color;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(f.text, f.x, f.y);
  ctx.globalAlpha = 1;
}

/** 主渲染入口。hover 信息来自 ui 层传入。 */
export function render(ctx, state, ui) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // 草地棋盘
  for (let gy = 0; gy < ROWS; gy += 1) {
    for (let gx = 0; gx < COLS; gx += 1) {
      ctx.fillStyle = (gx + gy) % 2 === 0 ? C.grass : C.grassAlt;
      ctx.fillRect(gx * TILE, gy * TILE, TILE, TILE);
    }
  }

  // 路径
  ctx.strokeStyle = C.path;
  ctx.lineWidth = TILE * 0.82;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(PATH.points[0].x, PATH.points[0].y);
  for (let i = 1; i < PATH.points.length; i += 1) {
    ctx.lineTo(PATH.points[i].x, PATH.points[i].y);
  }
  ctx.stroke();
  ctx.strokeStyle = C.pathEdge;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 装饰
  for (const item of DECOR) drawDecor(ctx, item);

  // 萝卜（终点）
  drawCarrot(ctx, PATH.points[PATH.points.length - 1].x - 6, PATH.points[PATH.points.length - 1].y);

  // 建造预览 / 射程提示
  if (ui && ui.hover) {
    const { gx, gy, buildable, selectedType } = ui.hover;
    const cx = gx * TILE + TILE / 2;
    const cy = gy * TILE + TILE / 2;
    ctx.fillStyle = buildable ? 'rgba(80,200,90,0.35)' : 'rgba(220,80,80,0.35)';
    ctx.fillRect(gx * TILE, gy * TILE, TILE, TILE);
    if (buildable && selectedType) {
      const def = TOWERS[selectedType];
      const rng = def.range + (def.range ? 18 * 0 : 0);
      ctx.strokeStyle = 'rgba(60,120,200,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, def.range, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 选中塔的射程圈
  if (ui && ui.selectedTower) {
    const t = ui.selectedTower;
    const s = stats(t);
    ctx.strokeStyle = 'rgba(60,120,200,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(t.x, t.y, s.range || 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const tower of state.towers) drawTower(ctx, tower);
  for (const enemy of state.enemies) drawEnemy(ctx, enemy);
  for (const p of state.projectiles) drawProjectile(ctx, p);
  for (const p of state.particles) drawParticle(ctx, p);
  for (const f of state.floats) drawFloat(ctx, f);
}
