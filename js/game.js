// 保卫萝卜 V2 · 游戏逻辑层
// 纯逻辑：不碰 DOM、不碰 Canvas、不读时间——时间由外部以 dt 喂进来。
// 因此整套玩法可以在 Node 里无头跑完（PRD G3 / §5.2）。

import {
  TOWERS, ENEMIES, WAVES, WAVE_COUNT, BOSS_WAVES, ECONOMY, CARROT_HP,
  BUILD_TIME, SPEEDS, MAX_LEVEL, PATH_SEGMENTS, isBuildableTile, hpScaleFor,
  TILE,
} from "./data.js";
import {
  statsAt, investedOf, pickTarget, applyDamage, applySlow, applyBurn,
  tickDebuffs, moveEnemy, pointAt, dist,
} from "./rules.js";

export const PHASE = { BUILD: "build", WAVE: "wave", WON: "won", LOST: "lost" };

/** 哪些操作在当前状态下被允许 —— 状态机的转换表（PRD 缺口 5） */
export function allowedActions(state) {
  const over = state.phase === PHASE.WON || state.phase === PHASE.LOST;
  return {
    place: !over,
    upgrade: !over,
    sell: !over,
    startWave: !over && !state.paused && state.phase === PHASE.BUILD,
    pause: !over,
    speed: !over,
    restart: true,
  };
}

export function createGame(seed = 1) {
  const state = {
    seed,
    phase: PHASE.BUILD,
    paused: false,
    speed: 1,
    time: 0,
    coins: ECONOMY.startCoins,
    hp: CARROT_HP,
    maxHp: CARROT_HP,
    wave: 0,
    buildTimer: BUILD_TIME,
    towers: [],
    enemies: [],
    projectiles: [],
    pending: [],
    floats: [],
    particles: [],
    stats: { kills: 0, leaks: 0, built: 0, spent: 0, earned: 0 },
    events: [],
    shake: { t: 0, dur: 0.3, mag: 0 },
    carrotFlinch: 0,
    nextId: 1,
  };
  return state;
}

function emit(state, type, payload = {}) {
  state.events.push({ type, ...payload });
}

// ---------------- 塔 ----------------
export function towerAt(state, col, row) {
  return state.towers.find((t) => t.col === col && t.row === row) || null;
}

export function placeTower(state, col, row, type) {
  if (!allowedActions(state).place) return { ok: false, reason: "对局已结束" };
  if (state.paused) return { ok: false, reason: "暂停中不能建造" };
  const def = TOWERS[type];
  if (!def) return { ok: false, reason: "没有这种塔" };
  if (!isBuildableTile(col, row)) return { ok: false, reason: "这里不能建造" };
  if (towerAt(state, col, row)) return { ok: false, reason: "这里已经有塔了" };
  if (state.coins < def.cost) {
    return { ok: false, reason: `金币不足，还差 ${def.cost - state.coins}` };
  }
  const upgradeCosts = [];
  for (let lv = 1; lv < MAX_LEVEL; lv += 1) upgradeCosts.push(ECONOMY.upgradeCost(def.cost, lv));
  const tower = {
    id: state.nextId++,
    type,
    def: { ...def, upgradeCosts },
    col,
    row,
    x: col * TILE + TILE / 2,
    y: row * TILE + TILE / 2,
    level: 1,
    cooldown: 0,
    incomeTimer: def.interval || 0,
    angle: -Math.PI / 2,
    kills: 0,
  };
  state.towers.push(tower);
  state.coins -= def.cost;
  state.stats.built += 1;
  state.stats.spent += def.cost;
  emit(state, "build", { tower });
  return { ok: true, tower };
}

export function upgradeCostOf(tower) {
  if (tower.level >= MAX_LEVEL) return 0;
  return tower.def.upgradeCosts[tower.level - 1];
}

export function upgradeTower(state, id) {
  if (!allowedActions(state).upgrade) return { ok: false, reason: "对局已结束" };
  if (state.paused) return { ok: false, reason: "暂停中不能升级" };
  const tower = state.towers.find((t) => t.id === id);
  if (!tower) return { ok: false, reason: "没有这座塔" };
  if (tower.level >= MAX_LEVEL) return { ok: false, reason: "已满级" };
  const cost = upgradeCostOf(tower);
  if (state.coins < cost) {
    return { ok: false, reason: `金币不足，还差 ${cost - state.coins}` };
  }
  state.coins -= cost;
  state.stats.spent += cost;
  tower.level += 1;
  emit(state, "upgrade", { tower });
  return { ok: true, tower };
}

export function sellTower(state, id) {
  if (!allowedActions(state).sell) return { ok: false, reason: "对局已结束" };
  if (state.paused) return { ok: false, reason: "暂停中不能拆除" };
  const idx = state.towers.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, reason: "没有这座塔" };
  const tower = state.towers[idx];
  const refund = Math.floor(investedOf(tower) * ECONOMY.sellRefund);
  state.towers.splice(idx, 1);
  state.coins += refund;
  emit(state, "sell", { refund, tower });
  return { ok: true, refund };
}

// ---------------- 波次 ----------------
export function startWave(state) {
  if (!allowedActions(state).startWave) return { ok: false, reason: "现在不能开波" };
  state.wave += 1;
  state.phase = PHASE.WAVE;
  state.buildTimer = 0;
  state.waveStartTime = state.time;
  const waveNo = state.wave;
  const scale = hpScaleFor(waveNo);
  const groups = WAVES[waveNo - 1] || [];
  let laneIdx = 0;
  for (const g of groups) {
    for (let i = 0; i < g.count; i += 1) {
      const at = g.delay + i * g.gap;
      // 车道偏移让同波怪物呈扇形错开，而不是压成一条线
      const lane = ((laneIdx++ % 3) - 1) * 9;
      state.pending.push({ at, type: g.type, scale, lane });
    }
  }
  state.pending.sort((a, b) => a.at - b.at);
  emit(state, "wave-start", { wave: waveNo, boss: BOSS_WAVES.includes(waveNo) });
  return { ok: true, wave: waveNo };
}

function spawn(state, item) {
  const def = ENEMIES[item.type];
  const hp = Math.round(def.hp * item.scale);
  const shield = def.shield ? Math.round(def.shield * item.scale) : 0;
  const enemy = {
    id: state.nextId++,
    type: def.id,
    name: def.name,
    hp,
    maxHp: hp,
    shield,
    maxShield: shield,
    speed: def.speed,
    bounty: def.bounty,
    radius: def.radius,
    leak: def.leak,
    armor: def.armor || 0,
    lane: item.lane,
    progress: 0,
    x: 0, y: 0,
    slowFactor: 1,
    slowTimer: 0,
    burnDps: 0,
    burnTimer: 0,
    burnAcc: 0,
    dead: false,
    hitFlash: 0,
  };
  const p = pointAt(0, enemy.lane);
  enemy.x = p.x; enemy.y = p.y;
  state.enemies.push(enemy);
  return enemy;
}

// ---------------- 帧推进 ----------------
// 倍速的正确做法：不放大步长，而是多跑几步。
// 放大步长会让碰撞、追尾、灼烧 tick 的结算随速度变化——那就不是"同一个游戏"了。
export function update(state, realDt) {
  const events = [];
  if (state.phase === PHASE.WON || state.phase === PHASE.LOST || state.paused) {
    // 冻结时也要把已入队的事件交付出去，否则它们会一直压到恢复那一帧集中补放
    if (state.events.length) {
      events.push(...state.events);
      state.events.length = 0;
    }
    return events;
  }
  const FIXED = 1 / 60;
  let budget = Math.min(realDt, 0.25) * state.speed;
  let guard = 0;
  while (budget > 1e-6 && guard < 32) {
    const slice = Math.min(FIXED, budget);
    events.push(...stepOnce(state, slice));
    budget -= slice;
    guard += 1;
    if (state.phase === PHASE.WON || state.phase === PHASE.LOST) break;
  }
  return events;
}

function stepOnce(state, dt) {
  const events = [];
  if (state.phase === PHASE.WON || state.phase === PHASE.LOST || state.paused) return events;
  state.time += dt;

  // 1) 布防倒计时
  if (state.phase === PHASE.BUILD) {
    state.buildTimer -= dt;
    if (state.buildTimer <= 0) startWave(state);
  }

  // 2) 生成
  if (state.phase === PHASE.WAVE && state.pending.length) {
    const t = state.time - state.waveStartTime;
    while (state.pending.length && state.pending[0].at <= t) {
      spawn(state, state.pending.shift());
    }
  }

  // 3) 怪物移动 + Debuff
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
    tickDebuffs(e, dt);
    if (e.hp <= 0) { e.dead = true; continue; }
    const arrived = moveEnemy(e, dt);
    if (arrived) {
      e.dead = true;
      // PRD R4：同时抵达按类型累加扣减，生命最低为 0，不出现负数
      state.hp = Math.max(0, state.hp - e.leak);
      state.stats.leaks += 1;
      // 漏怪是"你失败了"的信号，必须有分量：震屏 + 萝卜发抖
      state.shake = { t: 0.36, dur: 0.36, mag: e.leak >= 5 ? 12 : 8 };
      state.carrotFlinch = 0.5;
      emit(state, "leak", { leak: e.leak, name: e.name, hp: state.hp });
    }
  }

  // 4) 塔开火
  for (const tower of state.towers) {
    const s = statsAt(tower);
    if (tower.def.income) {
      tower.incomeTimer -= dt;
      if (tower.incomeTimer <= 0) {
        tower.incomeTimer += tower.def.interval;
        state.coins += s.income;
        state.stats.earned += s.income;
        state.floats.push({ x: tower.x, y: tower.y - 18, text: `+${s.income}`, life: 0.9, kind: "coin" });
      }
      continue;
    }
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;
    const target = pickTarget(tower, state.enemies);
    if (!target) continue;
    tower.cooldown = s.interval;
    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    state.particles.push({
      x: tower.x + Math.cos(tower.angle) * 20,
      y: tower.y + Math.sin(tower.angle) * 20,
      angle: tower.angle, life: 0.12, dur: 0.12, kind: "muzzle",
    });
    if (tower.def.projectileSpeed > 0) {
      state.projectiles.push({
        id: state.nextId++,
        x: tower.x + Math.cos(tower.angle) * 18,
        y: tower.y + Math.sin(tower.angle) * 18,
        targetId: target.id,
        tx: target.x,
        ty: target.y,
        speed: tower.def.projectileSpeed,
        damage: s.damage,
        splash: tower.def.splash || 0,
        slow: tower.def.slow || null,
        burn: tower.def.burn || null,
        color: tower.def.color,
        kind: tower.type,
        life: 3,
      });
    } else {
      // 瞬时命中（火焰塔）
      hitEnemy(state, target, s.damage, tower.def);
    }
  }

  // 5) 投射物
  for (const p of state.projectiles) {
    p.life -= dt;
    const target = state.enemies.find((e) => e.id === p.targetId && !e.dead);
    if (target) { p.tx = target.x; p.ty = target.y; }
    const d = dist(p.x, p.y, p.tx, p.ty);
    const step = p.speed * dt;
    if (d <= step + 6) {
      p.x = p.tx; p.y = p.ty;
      p.dead = true;
      if (target) hitEnemy(state, target, p.damage, p);
      if (p.splash > 0) {
        for (const e of state.enemies) {
          if (e.dead || e === target) continue;
          if (dist(e.x, e.y, p.x, p.y) <= p.splash + e.radius) {
            hitEnemy(state, e, p.damage, p);
          }
        }
        state.particles.push({ x: p.x, y: p.y, r: p.splash, life: 0.25, kind: "splash", color: p.color });
      }
    } else {
      p.x += ((p.tx - p.x) / d) * step;
      p.y += ((p.ty - p.y) / d) * step;
    }
    if (p.life <= 0) p.dead = true;
  }

  // 6) 清理 + 掉落
  for (const e of state.enemies) {
    if (e.dead && !e.rewarded) {
      e.rewarded = true;
      if (e.hp <= 0 || e.killedByTower) {
        state.coins += e.bounty;
        state.stats.earned += e.bounty;
        state.stats.kills += 1;
        state.floats.push({ x: e.x, y: e.y - 12, text: `+${e.bounty}`, life: 0.8, kind: "coin" });
        const isBoss = e.type === "boss";
        state.particles.push({
          x: e.x, y: e.y, r: e.radius, life: isBoss ? 0.55 : 0.3,
          kind: isBoss ? "boss-pop" : "pop",
          color: isBoss ? "#f08aa8" : "#f0c060",
          seed: e.id * 0.7,
        });
        if (isBoss) state.shake = { t: 0.28, dur: 0.28, mag: 7 };
      }
    }
  }
  state.enemies = state.enemies.filter((e) => !e.dead);
  state.projectiles = state.projectiles.filter((p) => !p.dead);

  // 7) 视觉特效寿命
  if (state.shake && state.shake.t > 0) state.shake.t = Math.max(0, state.shake.t - dt);
  if (state.carrotFlinch > 0) state.carrotFlinch = Math.max(0, state.carrotFlinch - dt);
  for (const p of state.particles) p.life -= dt;
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const f of state.floats) { f.life -= dt; f.y -= dt * 22; }
  state.floats = state.floats.filter((f) => f.life > 0);

  // 8) 胜负判定
  if (state.hp <= 0) {
    state.phase = PHASE.LOST;
    emit(state, "lost", { wave: state.wave, kills: state.stats.kills });
  } else if (state.phase === PHASE.WAVE && !state.pending.length && !state.enemies.length) {
    const bonus = ECONOMY.waveBonus(state.wave);
    state.coins += bonus;
    state.stats.earned += bonus;
    emit(state, "wave-clear", { wave: state.wave, bonus });
    if (state.wave >= WAVE_COUNT) {
      state.phase = PHASE.WON;
      emit(state, "won", { hp: state.hp, coins: state.coins });
    } else {
      state.phase = PHASE.BUILD;
      state.buildTimer = BUILD_TIME;
    }
  }

  events.push(...state.events);
  state.events.length = 0;
  return events;
}

function hitEnemy(state, enemy, damage, source) {
  if (enemy.dead) return;
  applyDamage(enemy, damage);
  enemy.hitFlash = 0.12;
  if (enemy.hp <= 0) enemy.killedByTower = true;
  if (source.slow && !enemy.dead) applySlow(enemy, source.slow.factor, source.slow.duration);
  if (source.burn && !enemy.dead) applyBurn(enemy, source.burn.dps, source.burn.duration);
}


// ---------------- 操作 ----------------
export function togglePause(state) {
  if (!allowedActions(state).pause) return { ok: false, reason: "对局已结束" };
  state.paused = !state.paused;
  return { ok: true, paused: state.paused };
}

export function cycleSpeed(state) {
  if (!allowedActions(state).speed) return { ok: false, reason: "对局已结束" };
  const i = SPEEDS.indexOf(state.speed);
  state.speed = SPEEDS[(i + 1) % SPEEDS.length];
  return { ok: true, speed: state.speed };
}

/** 对局进度快照，供 UI 与测试读取 */
export function snapshot(state) {
  return {
    phase: state.phase,
    paused: state.paused,
    speed: state.speed,
    coins: Math.floor(state.coins),
    hp: state.hp,
    wave: state.wave,
    towers: state.towers.length,
    enemies: state.enemies.length,
    buildTimer: Math.max(0, Math.ceil(state.buildTimer)),
    kills: state.stats.kills,
    leaks: state.stats.leaks,
  };
}
