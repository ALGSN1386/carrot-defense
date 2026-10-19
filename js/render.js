/**
 * 渲染层：只读 state，不修改它。
 * 所有绘制都是 canvas 2D，没有图片资源 —— 整个游戏因此可以单文件部署。
 */

import {
  CARROT,
  COLS,
  DECOR,
  ENEMIES,
  HEIGHT,
  PATH,
  ROWS,
  TILE,
  TOWERS,
  WIDTH,
} from './config.js';
import { stats } from './game.js';

/* ---------------- 工具 ---------------- */

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ease = (value) => Math.sin(value * Math.PI);

/* ---------------- 背景 ---------------- */

export function buildBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const random = rng(20261019);

  // 草地：底色 + 轻微的随机明暗，而不是明显的棋盘格
  ctx.fillStyle = '#7cc44c';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let gy = 0; gy < ROWS; gy += 1) {
    for (let gx = 0; gx < COLS; gx += 1) {
      const shade = random();
      ctx.fillStyle = shade > 0.5 ? `rgba(255, 255, 255, ${(shade - 0.5) * 0.12})` : `rgba(20, 60, 10, ${(0.5 - shade) * 0.12})`;
      ctx.fillRect(gx * TILE, gy * TILE, TILE, TILE);
    }
  }

  // 大块柔和光斑，打散网格感
  for (let i = 0; i < 14; i += 1) {
    const cx = random() * WIDTH;
    const cy = random() * HEIGHT;
    const radius = 70 + random() * 150;
    const patch = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const light = random() > 0.5;
    patch.addColorStop(0, light ? 'rgba(255, 255, 190, .10)' : 'rgba(30, 90, 20, .08)');
    patch.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = patch;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 草叶
  ctx.strokeStyle = 'rgba(70, 130, 50, .30)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 700; i += 1) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const h = 3 + random() * 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 3, y - h);
    ctx.stroke();
  }

  // 路面
  const stroke = (width, color) => {
    ctx.beginPath();
    ctx.moveTo(PATH.points[0].x, PATH.points[0].y);
    for (let i = 1; i < PATH.points.length; i += 1) {
      ctx.lineTo(PATH.points[i].x, PATH.points[i].y);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  ctx.save();
  ctx.translate(0, 6);
  stroke(58, 'rgba(40, 70, 30, .22)');
  ctx.restore();
  stroke(58, '#c69a68');
  stroke(48, '#dfb887');

  // 路面碎石
  ctx.fillStyle = 'rgba(150, 108, 66, .35)';
  for (let d = 0; d < PATH.length; d += 17) {
    const point = PATH.pointAt(d);
    const offset = (random() - 0.5) * 34;
    ctx.beginPath();
    ctx.ellipse(point.x + offset, point.y + (random() - 0.5) * 22, 1.6 + random() * 2, 1.2 + random() * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 终点小土台
  ctx.fillStyle = '#b98f5c';
  ctx.beginPath();
  ctx.ellipse(CARROT.x, CARROT.y + 20, 46, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cfa373';
  ctx.beginPath();
  ctx.ellipse(CARROT.x, CARROT.y + 16, 40, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // 入口指示
  const start = PATH.points[0];
  ctx.save();
  ctx.translate(start.x + 54, start.y - 8);
  ctx.fillStyle = 'rgba(30, 50, 20, .2)';
  ctx.beginPath();
  ctx.ellipse(0, 24, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b5e3c';
  roundRect(ctx, -5, -30, 9, 54, 4);
  ctx.fill();
  ctx.fillStyle = '#a5714a';
  roundRect(ctx, -14, -46, 62, 32, 8);
  ctx.fill();
  ctx.fillStyle = '#f2d9b0';
  roundRect(ctx, -10, -42, 54, 24, 6);
  ctx.fill();
  ctx.fillStyle = '#8b5e3c';
  ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('入口', 17, -29);
  ctx.restore();

  // 装饰
  for (const item of DECOR) {
    const x = (item.gx + 0.5) * TILE;
    const y = (item.gy + 0.5) * TILE;
    if (item.kind === 'tree') drawTree(ctx, x, y, 0.9 + random() * 0.3);
    if (item.kind === 'bush') drawBush(ctx, x, y);
    if (item.kind === 'rock') drawRock(ctx, x, y);
    if (item.kind === 'flower') drawFlower(ctx, x, y, random);
  }

  return canvas;
}

function drawTree(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.fillStyle = 'rgba(30, 60, 20, .18)';
  ctx.beginPath();
  ctx.ellipse(0, 20, 24, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#8a5a34';
  roundRect(ctx, -5, -6, 10, 26, 4);
  ctx.fill();

  const blobs = [
    [-14, -12, 16],
    [12, -14, 15],
    [0, -26, 18],
    [-4, -4, 14],
  ];
  for (const [bx, by, r] of blobs) {
    ctx.fillStyle = '#3f8a35';
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#57a844';
  ctx.beginPath();
  ctx.arc(-2, -30, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBush(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(30, 60, 20, .16)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 20, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [bx, by, r] of [[-10, 2, 12], [10, 2, 11], [0, -6, 14]]) {
    ctx.fillStyle = '#4b9a3c';
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5faf4a';
  ctx.beginPath();
  ctx.arc(-4, -8, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRock(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(30, 60, 20, .16)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa4ad';
  ctx.beginPath();
  ctx.moveTo(-16, 10);
  ctx.lineTo(-8, -12);
  ctx.lineTo(6, -16);
  ctx.lineTo(17, 2);
  ctx.lineTo(10, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#bcc5cc';
  ctx.beginPath();
  ctx.moveTo(-8, -12);
  ctx.lineTo(6, -16);
  ctx.lineTo(2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlower(ctx, x, y, random) {
  const colors = ['#ff8fb1', '#ffd93b', '#c79bf0', '#ffffff'];
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 3; i += 1) {
    const ox = (random() - 0.5) * 26;
    const oy = (random() - 0.5) * 20;
    ctx.fillStyle = 'rgba(60, 120, 40, .5)';
    ctx.fillRect(ox - 1, oy, 2, 6);
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    for (let p = 0; p < 5; p += 1) {
      const angle = (p / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(ox + Math.cos(angle) * 3.4, oy + Math.sin(angle) * 3.4, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.arc(ox, oy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------- 萝卜 ---------------- */

function drawCarrot(ctx, state, time) {
  const ratio = state.carrotHp / state.carrotMaxHp;
  const hurt = state.shake > 0 ? Math.sin(time * 40) * state.shake * 6 : 0;
  const bob = Math.sin(time * 2.2) * 2;

  ctx.save();
  ctx.translate(CARROT.x + hurt, CARROT.y + bob);

  ctx.fillStyle = 'rgba(30, 50, 20, .25)';
  ctx.beginPath();
  ctx.ellipse(0, 26, 26, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 叶子
  ctx.fillStyle = '#3f9a3a';
  for (const [angle, len] of [[-0.5, 26], [0, 30], [0.5, 26]]) {
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, -34 - len / 4, 7, len / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 身体
  const body = ctx.createLinearGradient(-20, -20, 20, 26);
  body.addColorStop(0, '#ff9a3c');
  body.addColorStop(1, '#e86a17');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-20, -12);
  ctx.quadraticCurveTo(-22, 22, 0, 28);
  ctx.quadraticCurveTo(22, 22, 20, -12);
  ctx.quadraticCurveTo(0, -26, -20, -12);
  ctx.closePath();
  ctx.fill();

  // 横纹
  ctx.strokeStyle = 'rgba(180, 90, 20, .35)';
  ctx.lineWidth = 2;
  for (const offset of [-2, 8, 17]) {
    ctx.beginPath();
    ctx.moveTo(-14 + Math.abs(offset) * 0.25, offset);
    ctx.lineTo(14 - Math.abs(offset) * 0.25, offset);
    ctx.stroke();
  }

  // 表情
  const eyeY = -4;
  ctx.fillStyle = '#2f2118';
  ctx.beginPath();
  ctx.arc(-7, eyeY, 3.2, 0, Math.PI * 2);
  ctx.arc(7, eyeY, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-6, eyeY - 1, 1.1, 0, Math.PI * 2);
  ctx.arc(8, eyeY - 1, 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 120, 120, .45)';
  ctx.beginPath();
  ctx.arc(-12, 6, 4, 0, Math.PI * 2);
  ctx.arc(12, 6, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#2f2118';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ratio > 0.55) {
    ctx.arc(0, 6, 5, 0.15 * Math.PI, 0.85 * Math.PI);
  } else {
    ctx.arc(0, 12, 5, 1.15 * Math.PI, 1.85 * Math.PI);
  }
  ctx.stroke();

  ctx.restore();
}

/* ---------------- 塔 ---------------- */

const TOWER_BASE = '#7d5a3c';

function drawTowerBase(ctx, tower) {
  ctx.fillStyle = 'rgba(30, 50, 20, .22)';
  ctx.beginPath();
  ctx.ellipse(tower.x, tower.y + 16, 24, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#8a6a48';
  ctx.beginPath();
  ctx.ellipse(tower.x, tower.y + 12, 24, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TOWER_BASE;
  ctx.beginPath();
  ctx.ellipse(tower.x, tower.y + 8, 22, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, .12)';
  ctx.beginPath();
  ctx.ellipse(tower.x - 6, tower.y + 4, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTowerLevel(ctx, tower) {
  for (let i = 0; i < tower.level; i += 1) {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(tower.x - 8 + i * 8, tower.y + 20, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 80, 10, .5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawTower(ctx, tower, time) {
  const def = TOWERS[tower.type];
  drawTowerBase(ctx, tower);

  const sway = Math.sin(time * 2 + tower.x * 0.01) * 0.04;
  ctx.save();
  ctx.translate(tower.x, tower.y);

  if (tower.type === 'cannon') {
    // 炮管先画，炮身盖住根部，看起来像从瓶子里伸出来
    ctx.save();
    ctx.rotate(tower.angle);
    ctx.fillStyle = '#1f4a2b';
    roundRect(ctx, 6, -7, 30, 14, 6);
    ctx.fill();
    ctx.fillStyle = '#357a44';
    roundRect(ctx, 8, -5, 26, 10, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(160, 230, 170, .5)';
    roundRect(ctx, 10, -3.5, 20, 3, 1.5);
    ctx.fill();
    ctx.fillStyle = '#c98b4b';
    roundRect(ctx, 32, -6, 8, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#f0c58a';
    roundRect(ctx, 33, -4, 4, 8, 2);
    ctx.fill();
    ctx.restore();

    const body = ctx.createLinearGradient(-16, -20, 16, 12);
    body.addColorStop(0, '#67b276');
    body.addColorStop(1, '#2c6639');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, -4, 18, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 50, 25, .45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, .3)';
    ctx.beginPath();
    ctx.ellipse(-7, -11, 6, 4, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d8f0a0';
    roundRect(ctx, -8, -16, 16, 5, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 90, 40, .5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (tower.type === 'ice') {
    ctx.rotate(sway + time * 0.6);
    const glow = ctx.createRadialGradient(0, -8, 2, 0, -8, 26);
    glow.addColorStop(0, 'rgba(150, 230, 255, .85)');
    glow.addColorStop(1, 'rgba(150, 230, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -8, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#bfeaff';
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(7, -10);
      ctx.lineTo(0, -4);
      ctx.lineTo(-7, -10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#7fc9f0';
    ctx.beginPath();
    ctx.arc(0, -10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, .7)';
    ctx.beginPath();
    ctx.arc(-3, -13, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (tower.type === 'magic') {
    const bob = Math.sin(time * 3) * 3;
    ctx.fillStyle = '#5b4a8a';
    roundRect(ctx, -14, -2, 28, 10, 4);
    ctx.fill();

    const glow = ctx.createRadialGradient(0, -16 + bob, 2, 0, -16 + bob, 24);
    glow.addColorStop(0, 'rgba(200, 160, 255, .95)');
    glow.addColorStop(1, 'rgba(160, 120, 240, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -16 + bob, 24, 0, Math.PI * 2);
    ctx.fill();

    const orb = ctx.createRadialGradient(-4, -20 + bob, 1, 0, -16 + bob, 13);
    orb.addColorStop(0, '#e6d4ff');
    orb.addColorStop(1, '#7a5cd0');
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(0, -16 + bob, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(220, 200, 255, .8)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -16 + bob, 18, 7, time * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (tower.type === 'sun') {
    ctx.rotate(time * 0.35);
    for (let i = 0; i < 8; i += 1) {
      ctx.save();
      ctx.rotate((i / 8) * Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? '#ffd34d' : '#ffb727';
      ctx.beginPath();
      ctx.ellipse(0, -18, 5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.arc(0, -6, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b3733a';
    ctx.beginPath();
    ctx.arc(0, -6, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(0, -6, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (tower.type === 'flame') {
    ctx.fillStyle = '#6b4a34';
    roundRect(ctx, -13, -6, 26, 14, 5);
    ctx.fill();
    ctx.fillStyle = '#8b6444';
    roundRect(ctx, -15, 0, 30, 6, 3);
    ctx.fill();

    const flicker = 0.8 + Math.sin(time * 12) * 0.2;
    const glow = ctx.createRadialGradient(0, -18, 2, 0, -18, 26 * flicker);
    glow.addColorStop(0, 'rgba(255, 200, 90, .9)');
    glow.addColorStop(0.5, 'rgba(255, 130, 40, .45)');
    glow.addColorStop(1, 'rgba(255, 90, 20, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -18, 26 * flicker, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.moveTo(0, -34 - Math.sin(time * 10) * 3);
    ctx.quadraticCurveTo(12, -18, 0, -6);
    ctx.quadraticCurveTo(-12, -18, 0, -34 - Math.sin(time * 10) * 3);
    ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.quadraticCurveTo(6, -16, 0, -9);
    ctx.quadraticCurveTo(-6, -16, 0, -28);
    ctx.fill();
  }

  ctx.restore();
  drawTowerLevel(ctx, tower);
}

/* ---------------- 怪物 ---------------- */

function drawEnemy(ctx, enemy, time) {
  const def = ENEMIES[enemy.type];
  const bob = Math.sin(enemy.wobble) * 2;
  const slowed = enemy.slowUntil > time;

  ctx.save();
  ctx.translate(enemy.x, enemy.y + bob);

  ctx.fillStyle = 'rgba(30, 50, 20, .2)';
  ctx.beginPath();
  ctx.ellipse(0, enemy.radius * 0.85, enemy.radius * 0.8, enemy.radius * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // 脚
  const step = Math.sin(enemy.wobble * 1.6);
  ctx.fillStyle = def.dark;
  ctx.beginPath();
  ctx.ellipse(-enemy.radius * 0.45, enemy.radius * 0.72, 4, 2.6 + step, 0, 0, Math.PI * 2);
  ctx.ellipse(enemy.radius * 0.45, enemy.radius * 0.72, 4, 2.6 - step, 0, 0, Math.PI * 2);
  ctx.fill();

  // 身体
  const body = ctx.createRadialGradient(-enemy.radius * 0.3, -enemy.radius * 0.4, 2, 0, 0, enemy.radius * 1.4);
  body.addColorStop(0, def.color);
  body.addColorStop(1, def.dark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, enemy.radius, enemy.radius * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  if (slowed) {
    ctx.fillStyle = 'rgba(120, 200, 255, .35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, enemy.radius + 3, enemy.radius * 0.95 + 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (enemy.type === 'armored') {
    ctx.strokeStyle = '#dfe7ee';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius - 3, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillStyle = '#cfd8e2';
    for (const sx of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.moveTo(sx, -enemy.radius + 2);
      ctx.lineTo(sx + 3, -enemy.radius - 7);
      ctx.lineTo(sx + 6, -enemy.radius + 2);
      ctx.fill();
    }
  }

  if (enemy.type === 'boss') {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.moveTo(-14, -enemy.radius - 2);
    ctx.lineTo(-9, -enemy.radius - 14);
    ctx.lineTo(-3, -enemy.radius - 4);
    ctx.lineTo(3, -enemy.radius - 16);
    ctx.lineTo(9, -enemy.radius - 4);
    ctx.lineTo(15, -enemy.radius - 12);
    ctx.lineTo(15, -enemy.radius + 2);
    ctx.closePath();
    ctx.fill();
  }

  // 眼睛
  const eyeOffset = enemy.radius * 0.34;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-eyeOffset, -eyeOffset * 0.5, enemy.radius * 0.3, 0, Math.PI * 2);
  ctx.arc(eyeOffset, -eyeOffset * 0.5, enemy.radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#241a12';
  ctx.beginPath();
  ctx.arc(-eyeOffset + 1, -eyeOffset * 0.5, enemy.radius * 0.15, 0, Math.PI * 2);
  ctx.arc(eyeOffset + 1, -eyeOffset * 0.5, enemy.radius * 0.15, 0, Math.PI * 2);
  ctx.fill();

  // 嘴
  ctx.strokeStyle = 'rgba(40, 25, 15, .7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, enemy.radius * 0.3, enemy.radius * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // 护盾
  if (enemy.shield > 0) {
    ctx.strokeStyle = `rgba(150, 200, 255, ${0.45 + Math.sin(time * 6) * 0.15})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 血条
  const hpRatio = enemy.hp / enemy.maxHp;
  if (hpRatio < 1 || enemy.shield > 0) {
    const width = enemy.radius * 2;
    const y = -enemy.radius - 12;
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    roundRect(ctx, -width / 2, y, width, 5, 2.5);
    ctx.fill();
    const bar = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
    bar.addColorStop(0, hpRatio > 0.5 ? '#7ee36a' : '#ffb648');
    bar.addColorStop(1, hpRatio > 0.5 ? '#4cbf3a' : '#ff6b4a');
    ctx.fillStyle = bar;
    roundRect(ctx, -width / 2, y, width * Math.max(0, hpRatio), 5, 2.5);
    ctx.fill();

    if (enemy.maxShield > 0) {
      ctx.fillStyle = 'rgba(120, 170, 255, .8)';
      roundRect(ctx, -width / 2, y - 3, width * (enemy.shield / enemy.maxShield), 2.5, 1.2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/* ---------------- 投射物 ---------------- */

function drawProjectile(ctx, projectile) {
  ctx.save();

  for (let i = 0; i < projectile.trail.length; i += 1) {
    const point = projectile.trail[i];
    const alpha = (i / projectile.trail.length) * 0.35;
    ctx.fillStyle = `${projectile.color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3 + i * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const glow = ctx.createRadialGradient(projectile.x, projectile.y, 1, projectile.x, projectile.y, 12);
  glow.addColorStop(0, 'rgba(255, 255, 255, .9)');
  glow.addColorStop(0.4, projectile.color);
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = projectile.kind === 'splash' ? '#e0d0ff' : '#fff6df';
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ---------------- 覆盖层 ---------------- */

function drawRange(ctx, x, y, radius, color) {
  ctx.save();
  ctx.fillStyle = `${color}22`;
  ctx.strokeStyle = `${color}99`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGridHint(ctx, state, view) {
  if (view.hoverGx == null || view.hoverGy == null) return;
  const ok = view.canPlace;
  ctx.save();
  ctx.fillStyle = ok ? 'rgba(120, 230, 120, .22)' : 'rgba(255, 90, 90, .25)';
  ctx.strokeStyle = ok ? 'rgba(120, 230, 120, .8)' : 'rgba(255, 90, 90, .8)';
  ctx.lineWidth = 2;
  roundRect(ctx, view.hoverGx * TILE + 3, view.hoverGy * TILE + 3, TILE - 6, TILE - 6, 12);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/* ---------------- 主绘制 ---------------- */

export function draw(ctx, state, view) {
  const time = view.time;

  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake * 8, (Math.random() - 0.5) * state.shake * 8);
  }

  if (!view.background) view.background = buildBackground();
  ctx.drawImage(view.background, 0, 0);

  drawCarrot(ctx, state, time);

  const selected = state.towers.find((tower) => tower.id === state.selectedTowerId);
  if (selected && TOWERS[selected.type].range > 0) {
    const s = stats(selected);
    drawRange(ctx, selected.x, selected.y, s.range, '#ffd75e');
  }

  if (view.placingType) {
    drawGridHint(ctx, state, view);
    if (view.hoverGx != null && view.canPlace) {
      const def = TOWERS[view.placingType];
      drawRange(ctx, (view.hoverGx + 0.5) * TILE, (view.hoverGy + 0.5) * TILE, def.range, '#8ef08e');
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawTower(
        ctx,
        {
          type: view.placingType,
          x: (view.hoverGx + 0.5) * TILE,
          y: (view.hoverGy + 0.5) * TILE,
          level: 1,
          angle: -Math.PI / 2,
        },
        time
      );
      ctx.restore();
    }
  }

  for (const tower of state.towers) {
    if (selected && selected.id === tower.id) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tower.x, tower.y + 6, 26, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    drawTower(ctx, tower, time);
  }

  // 后面的怪先画，形成自然的遮挡
  const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
  for (const enemy of sorted) drawEnemy(ctx, enemy, time);

  for (const projectile of state.projectiles) drawProjectile(ctx, projectile);

  for (const particle of state.particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const float of state.floats) {
    const alpha = Math.min(1, float.life / float.maxLife + 0.2);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(40, 30, 20, .55)';
    ctx.strokeText(float.text, float.x, float.y);
    ctx.fillStyle = float.color;
    ctx.fillText(float.text, float.x, float.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

export { WIDTH, HEIGHT };
