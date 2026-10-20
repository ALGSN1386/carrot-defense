/**
 * 纯逻辑层：不碰 DOM、不碰 canvas。
 *
 * 因此可以在 Node 里直接 import 这个模块跑仿真（见 sim/balance.mjs），
 * 用来验证平衡与胜负判定 —— 这是本作“顶级”要求的核心：玩法可自动化验证。
 *
 * 设计要点（PRD §5 / §6）：
 *  - 状态机只有 build | wave | won | lost 四态，避免“暂停时怪还在动”类 bug
 *  - 索敌取“沿路径行进最远(dist 最大)”的敌人
 *  - 伤害顺序：护盾优先 → 护甲减伤(最低1) → 灼烧无视护甲 → 范围边缘衰减最低 55%
 *  - 经济：起始 320，清波奖励 20+波次×4，击杀按赏金，太阳花周期产金，拆除返 60%
 */

import {
  BUILD_TIME,
  CARROT_HP,
  COLS,
  ENEMIES,
  PATH,
  ROWS,
  START_COINS,
  TOWERS,
  UPGRADE,
  WAVES,
  isBuildable,
} from './config.js';

let nextId = 1;
const uid = (prefix) => `${prefix}${nextId++}`;

export function createGame() {
  nextId = 1;
  return {
    phase: 'build', // build | wave | won | lost
    time: 0,
    coins: START_COINS,
    carrotHp: CARROT_HP,
    carrotMaxHp: CARROT_HP,
    wave: 0, // 已完成的波数
    buildTimer: BUILD_TIME,
    towers: [],
    enemies: [],
    projectiles: [],
    particles: [],
    floats: [],
    spawnQueue: [],
    selectedTowerId: null,
    kills: 0,
    leaks: 0,
    shake: 0,
    events: [],
  };
}

const emit = (state, event) => state.events.push(event);

/* ---------------- 建造 ---------------- */

export function towerAt(state, gx, gy) {
  return state.towers.find((tower) => tower.gx === gx && tower.gy === gy) || null;
}

export function towerCost(typeId, level = 1) {
  const def = TOWERS[typeId];
  if (!def) return Infinity;
  if (level === 1) return def.cost;
  return UPGRADE.cost({ cost: def.cost, level });
}

export function placeTower(state, gx, gy, typeId) {
  if (state.phase === 'lost' || state.phase === 'won') {
    return { ok: false, message: '本局已结束' };
  }
  const def = TOWERS[typeId];
  if (!def) return { ok: false, message: '没有这种塔' };
  if (!isBuildable(gx, gy)) return { ok: false, message: '这里不能建造' };
  if (towerAt(state, gx, gy)) return { ok: false, message: '这块地已经有塔了' };
  if (state.coins < def.cost) return { ok: false, message: `金币不够，还差 ${def.cost - state.coins}` };

  state.coins -= def.cost;
  const tower = {
    id: uid('t'),
    type: typeId,
    level: 1,
    gx,
    gy,
    x: (gx + 0.5) * 60,
    y: (gy + 0.5) * 60,
    cooldown: 0,
    invested: def.cost,
    angle: -Math.PI / 2,
    incomeTimer: def.kind === 'income' ? def.incomeEvery : 0,
    pulse: 0,
    kills: 0,
  };
  state.towers.push(tower);
  state.selectedTowerId = tower.id;
  emit(state, { type: 'build', tower });
  return { ok: true, tower, message: `${def.name} 建造完成` };
}

/** 当前等级下的有效数值（含升级缩放）。 */
export function stats(tower) {
  const def = TOWERS[tower.type];
  const level = tower.level;
  return {
    damage: Math.round(def.damage * UPGRADE.damageMul ** (level - 1)),
    range: def.range + UPGRADE.rangeAdd * (level - 1),
    rate: def.rate * UPGRADE.rateMul ** (level - 1),
    splash: def.splash ? def.splash + 6 * (level - 1) : 0,
    income: def.income ? Math.round(def.income * (1 + 0.5 * (level - 1))) : 0,
    burnDps: def.burnDps ? Math.round(def.burnDps * (1 + 0.5 * (level - 1))) : 0,
  };
}

export function upgradeTower(state, id) {
  const tower = state.towers.find((t) => t.id === id);
  if (!tower) return { ok: false, message: '没有选中塔' };
  if (tower.level >= UPGRADE.maxLevel) return { ok: false, message: '已经满级' };
  const cost = towerCost(tower.type, tower.level + 1);
  if (state.coins < cost) return { ok: false, message: `金币不够，还差 ${cost - state.coins}` };

  state.coins -= cost;
  tower.level += 1;
  tower.invested += cost;
  tower.pulse = 0.5;
  emit(state, { type: 'upgrade', tower });
  return { ok: true, tower, message: `升级到 ${tower.level} 级` };
}

export function sellTower(state, id) {
  const index = state.towers.findIndex((t) => t.id === id);
  if (index < 0) return { ok: false, message: '没有选中塔' };
  const tower = state.towers[index];
  const refund = Math.round(tower.invested * 0.6);
  state.coins += refund;
  state.towers.splice(index, 1);
  if (state.selectedTowerId === id) state.selectedTowerId = null;
  emit(state, { type: 'sell', tower, refund });
  return { ok: true, message: `拆除返还 ${refund} 金币` };
}

/* ---------------- 波次 ---------------- */

function hpScale(waveNumber) {
  return 1 + (waveNumber - 1) * 0.15;
}

export function startWave(state) {
  if (state.phase !== 'build') return { ok: false, message: '现在不能开波' };
  state.wave += 1;
  state.phase = 'wave';
  state.spawnQueue = [];

  const wave = WAVES[state.wave - 1] || [];
  const scale = hpScale(state.wave);

  for (const group of wave) {
    for (let i = 0; i < group.count; i += 1) {
      state.spawnQueue.push({
        type: group.type,
        at: state.time + (group.delay || 0) + i * group.gap,
        hpScale: scale,
      });
    }
  }
  state.spawnQueue.sort((a, b) => a.at - b.at);

  emit(state, { type: 'wave-start', wave: state.wave });
  return { ok: true, wave: state.wave };
}

function finishWave(state) {
  state.phase = 'build';
  state.buildTimer = BUILD_TIME;
  const bonus = 20 + state.wave * 4;
  state.coins += bonus;
  emit(state, { type: 'wave-clear', wave: state.wave, bonus });

  if (state.wave >= WAVES.length) {
    state.phase = 'won';
    emit(state, { type: 'won' });
  }
}

/* ---------------- 生成 ---------------- */

function spawnEnemy(state, typeId, scale) {
  const def = ENEMIES[typeId];
  const hp = Math.round(def.hp * scale);
  const start = PATH.pointAt(0);
  state.enemies.push({
    id: uid('e'),
    type: typeId,
    hp,
    maxHp: hp,
    shield: def.shield ? Math.round(def.shield * scale) : 0,
    maxShield: def.shield ? Math.round(def.shield * scale) : 0,
    dist: 0,
    x: start.x,
    y: start.y,
    speed: def.speed,
    // 横向错开（确定性，按序分到 5 条泳道），因生成间隔(gap)沿路径错开，不会重叠
    lane: ((nextId % 5) - 2) * 6,
    slowUntil: 0,
    slowFactor: 1,
    burnUntil: 0,
    burnDps: 0,
    radius: def.radius,
    dead: false,
    wobble: Math.random() * Math.PI * 2,
  });
}

/* ---------------- 伤害 ---------------- */

function hurt(state, enemy, amount, opts = {}) {
  if (enemy.dead) return;
  const def = ENEMIES[enemy.type];
  let remaining = amount;

  // 1) 护盾优先
  if (enemy.shield > 0) {
    const absorbed = Math.min(enemy.shield, remaining);
    enemy.shield -= absorbed;
    remaining -= absorbed;
    if (absorbed > 0) addParticles(state, enemy.x, enemy.y, 3, '#9fc0ff', 2.2);
  }
  if (remaining <= 0) return;

  // 2) 护甲减伤（灼烧无视护甲）
  const armor = opts.ignoreArmor ? 0 : def.armor || 0;
  const applied = Math.max(1, remaining - armor);
  enemy.hp -= applied;
  addFloats(state, enemy.x, enemy.y - enemy.radius, `-${Math.round(applied)}`, '#ffe9a8');

  if (enemy.hp <= 0) killEnemy(state, enemy, opts.towerId);
}

function killEnemy(state, enemy, towerId) {
  if (enemy.dead) return;
  enemy.dead = true;
  const def = ENEMIES[enemy.type];
  state.coins += def.reward;
  state.kills += 1;

  const tower = towerId ? state.towers.find((t) => t.id === towerId) : null;
  if (tower) tower.kills += 1;

  addFloats(state, enemy.x, enemy.y - 8, `+${def.reward}`, '#ffd25e');
  addParticles(state, enemy.x, enemy.y, 12, def.color, 3.4);
  if (enemy.type === 'boss') {
    state.shake = Math.max(state.shake, 0.5);
    addParticles(state, enemy.x, enemy.y, 26, '#c79bf0', 5);
  }
  emit(state, { type: 'kill', enemy });
}

/* ---------------- 效果 ---------------- */

function addParticles(state, x, y, count, color, speed = 3) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = speed * (0.4 + Math.random());
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity * 20,
      vy: Math.sin(angle) * velocity * 20 - 20,
      life: 0.5 + Math.random() * 0.35,
      maxLife: 0.85,
      size: 1.6 + Math.random() * 2.4,
      color,
    });
  }
}

function addFloats(state, x, y, text, color) {
  state.floats.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
}

/* ---------------- 更新 ---------------- */

export function update(state, dt) {
  state.time += dt;
  state.shake = Math.max(0, state.shake - dt * 2);

  // 粒子与飘字在任何阶段都继续，避免失败瞬间画面僵住。
  updateEffects(state, dt);

  if (state.phase === 'lost' || state.phase === 'won') return;

  if (state.phase === 'build') {
    state.buildTimer -= dt;
    if (state.buildTimer <= 0) startWave(state);
  }

  if (state.phase === 'wave') {
    spawnDue(state);
    updateEnemies(state, dt);
    updateTowers(state, dt);
    updateProjectiles(state, dt);

    const noMoreSpawn = state.spawnQueue.length === 0;
    const noEnemies = state.enemies.length === 0;
    // 守卫：本帧若已因漏怪判负(lost)，不再被清波逻辑错误覆盖
    if (state.phase === 'wave' && noMoreSpawn && noEnemies) finishWave(state);
  } else {
    // build 阶段塔仍可产金（太阳花），但不攻击
    updateTowers(state, dt);
  }
}

function spawnDue(state) {
  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.time) {
    const next = state.spawnQueue.shift();
    spawnEnemy(state, next.type, next.hpScale);
  }
}

function updateEnemies(state, dt) {
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;

    if (enemy.burnUntil > state.time) {
      hurt(state, enemy, enemy.burnDps * dt, { ignoreArmor: true });
      if (Math.random() < dt * 8) addParticles(state, enemy.x, enemy.y, 1, '#ff9a5a', 1.6);
    }

    const slowed = enemy.slowUntil > state.time;
    if (!slowed) enemy.slowFactor = 1;
    const speed = enemy.speed * enemy.slowFactor;
    enemy.dist += speed * dt;
    enemy.wobble += dt * (6 + speed / 20);

    const point = PATH.pointAt(enemy.dist);
    // 用路径切线求法线，把同类怪物横向错开，避免叠成一个点
    const ahead = PATH.pointAt(Math.min(PATH.length, enemy.dist + 2));
    const behind = PATH.pointAt(Math.max(0, enemy.dist - 2));
    const tx = ahead.x - behind.x;
    const ty = ahead.y - behind.y;
    const length = Math.hypot(tx, ty) || 1;
    enemy.x = point.x + (-ty / length) * enemy.lane;
    enemy.y = point.y + (tx / length) * enemy.lane;

    if (enemy.dist >= PATH.length) {
      enemy.dead = true;
      const def = ENEMIES[enemy.type];
      state.carrotHp -= def.damage;
      state.leaks += 1;
      state.shake = Math.max(state.shake, 0.35);
      addParticles(state, point.x, point.y, 14, '#ff7a7a', 4);
      addFloats(state, point.x, point.y - 20, `-${def.damage}`, '#ff8080');
      emit(state, { type: 'leak', enemy });
      if (state.carrotHp <= 0) {
        state.carrotHp = 0;
        state.phase = 'lost';
        emit(state, { type: 'lost' });
      }
    }
  }
  state.enemies = state.enemies.filter((enemy) => !enemy.dead);
}

function pickTarget(state, tower, range) {
  let best = null;
  let bestDist = -1;
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    const distance = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
    if (distance > range + enemy.radius) continue;
    // 索敌优先级：沿路径行进最远(dist 最大) 的敌人
    if (enemy.dist > bestDist) {
      bestDist = enemy.dist;
      best = enemy;
    }
  }
  return best;
}

function updateTowers(state, dt) {
  for (const tower of state.towers) {
    const def = TOWERS[tower.type];
    tower.pulse = Math.max(0, tower.pulse - dt);

    if (def.kind === 'income') {
      tower.incomeTimer -= dt;
      if (tower.incomeTimer <= 0) {
        tower.incomeTimer += def.incomeEvery;
        const amount = stats(tower).income;
        state.coins += amount;
        tower.pulse = 0.45;
        addFloats(state, tower.x, tower.y - 26, `+${amount}`, '#ffd25e');
        emit(state, { type: 'income', tower, amount });
      }
      continue;
    }

    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const s = stats(tower);
    const target = pickTarget(state, tower, s.range);
    if (!target) continue;

    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    tower.cooldown = s.rate;
    tower.pulse = 0.22;

    state.projectiles.push({
      id: uid('p'),
      x: tower.x + Math.cos(tower.angle) * 16,
      y: tower.y + Math.sin(tower.angle) * 16 - 6,
      targetId: target.id,
      tx: target.x,
      ty: target.y,
      speed: def.projectileSpeed,
      damage: s.damage,
      kind: def.kind,
      splash: s.splash,
      slowFactor: def.slowFactor,
      slowDuration: def.slowDuration,
      burnDps: s.burnDps,
      burnDuration: def.burnDuration,
      towerId: tower.id,
      color: def.color,
      trail: [],
      dead: false,
    });
  }
}

function updateProjectiles(state, dt) {
  for (const projectile of state.projectiles) {
    if (projectile.dead) continue;

    const target = state.enemies.find((enemy) => enemy.id === projectile.targetId && !enemy.dead);
    if (target) {
      projectile.tx = target.x;
      projectile.ty = target.y;
    }

    const dx = projectile.tx - projectile.x;
    const dy = projectile.ty - projectile.y;
    const distance = Math.hypot(dx, dy);
    const step = projectile.speed * dt;

    projectile.trail.push({ x: projectile.x, y: projectile.y });
    if (projectile.trail.length > 6) projectile.trail.shift();

    if (distance <= step || distance < 4) {
      projectile.x = projectile.tx;
      projectile.y = projectile.ty;
      impact(state, projectile, target);
      projectile.dead = true;
    } else {
      projectile.x += (dx / distance) * step;
      projectile.y += (dy / distance) * step;
    }
  }
  state.projectiles = state.projectiles.filter((p) => !p.dead);
}

function impact(state, projectile, target) {
  const aoe = projectile.kind === 'splash' || projectile.kind === 'slow';

  addParticles(state, projectile.x, projectile.y, aoe ? 8 : 4, projectile.color, 2.6);

  if (aoe) {
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      const distance = Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y);
      if (distance > projectile.splash) continue;
      // 范围边缘衰减：中心全额，边缘最低 55%
      const falloff = 1 - (distance / projectile.splash) * 0.45;
      if (projectile.damage > 0) {
        hurt(state, enemy, projectile.damage * falloff, { towerId: projectile.towerId });
      }
      if (projectile.kind === 'slow') {
        enemy.slowFactor = Math.min(enemy.slowFactor, projectile.slowFactor);
        enemy.slowUntil = Math.max(enemy.slowUntil, state.time + projectile.slowDuration);
      }
    }
    return;
  }

  if (target && !target.dead) {
    hurt(state, target, projectile.damage, { towerId: projectile.towerId });
    if (projectile.kind === 'burn' && projectile.burnDps > 0) {
      target.burnUntil = Math.max(target.burnUntil, state.time + projectile.burnDuration);
      target.burnDps = Math.max(target.burnDps, projectile.burnDps);
    }
  }
}

function updateEffects(state, dt) {
  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 260 * dt;
    particle.vx *= 0.98;
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  for (const float of state.floats) {
    float.life -= dt;
    float.y -= 34 * dt;
  }
  state.floats = state.floats.filter((f) => f.life > 0);
}

/* ---------------- 选购 ---------------- */

export function selectTower(state, id) {
  state.selectedTowerId = id;
}

export function restartable(state) {
  return state.phase === 'won' || state.phase === 'lost';
}

export function totalWaves() {
  return WAVES.length;
}

// 导出内部函数，便于 Node 侧断言测试（支撑 PRD “玩法可自动化验证” 要求）。
export { PATH, isBuildable, ENEMIES, TOWERS, COLS, ROWS, pickTarget, hurt };
