// 保卫萝卜 V2 · 战斗规则层
// 这里放的全是 PRD「缺口 3」要求写死、但原文档没定义的规则。
// 每条规则都在注释里写明"为什么是这条"，因为换一条，手感就变了。

import { PATH_SEGMENTS, UPGRADE, MAX_LEVEL } from "./data.js";

// 战斗规则的设计取舍（这些是注释，不是配置——只有下面被真正读取的常量才算配置）：
//
//   索敌   射程内「沿路径走得最远」的敌人，同进度取 id 更小者。
//          不用"最近"：塔防玩家的心算模型是"先挡住最危险的那个"。
//   减伤   减法，且伤害最低保留 1 点。铁甲 armor=4 让 9 点伤害只能打 5 点，
//          但绝不出现完全免疫，否则玩家会觉得塔坏了。
//   减速   取最强的那个生效，重复命中只刷新时长、不叠加。
//          叠加会让冰塔堆到怪物静止，游戏直接失去张力。
//   溅射   命中点半径内全部受伤，不衰减。衰减会让边缘目标吃不到伤害，
//          玩家无法判断"这一炮到底打没打到"。
//   投射物 追踪目标当前位置；目标提前死亡则飞向最后已知点并消失，不重新索敌。
//
// 注意：灼烧不吃护甲（见 applyDamage 的 ignoreArmor 参数）——护甲是"打不穿"，
// 火是贴着烧的。否则 2.25 点/跳被 armor 削到 1 点，火焰塔直接废掉。

/** 灼烧的结算间隔（秒）。DPR 的伤害只在这里被真正读取。 */
export const BURN_TICK = 0.25;

/** 两点距离 */
export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** 路径进度值 → 世界坐标（含横向车道偏移） */
export function pointAt(progress, lane = 0) {
  const { segs, total } = PATH_SEGMENTS;
  const p = Math.max(0, Math.min(total, progress));
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    if (p <= s.start + s.len) { seg = s; break; }
  }
  const t = p - seg.start;
  const x = seg.a.x + seg.ux * t;
  const y = seg.a.y + seg.uy * t;
  // 车道偏移：沿法线方向，让同波怪物不重叠成一条线
  const nx = -seg.uy;
  const ny = seg.ux;
  return { x: x + nx * lane, y: y + ny * lane, ux: seg.ux, uy: seg.uy };
}

/** 塔在某一级下的实际面板 */
export function statsAt(tower) {
  const def = tower.def;
  const lv = tower.level - 1;
  const damage = def.damage ? def.damage * Math.pow(UPGRADE.damage, lv) : 0;
  const range = def.range ? def.range + UPGRADE.range * lv : 0;
  const interval = def.interval ? def.interval * Math.pow(UPGRADE.interval, lv) : 0;
  return { damage, range, interval, income: def.income ? def.income + 4 * lv : 0 };
}

/** 累计投入（用于拆除返还） */
export function investedOf(tower) {
  let sum = tower.def.cost;
  for (let lv = 1; lv < tower.level; lv += 1) {
    sum += tower.def.upgradeCosts[lv - 1];
  }
  return sum;
}

/** 最终伤害（先扣护盾，再扣护甲） */
export function applyDamage(enemy, raw, ignoreArmor = false) {
  if (raw <= 0) return 0;
  let dmg = ignoreArmor ? raw : Math.max(1, raw - (enemy.armor || 0));
  let dealt = dmg;
  if (enemy.shield > 0) {
    const absorbed = Math.min(enemy.shield, dmg);
    enemy.shield -= absorbed;
    dmg -= absorbed;
  }
  enemy.hp -= dmg;
  return dealt;
}

/** 索敌：射程内进度最大的敌人 */
export function pickTarget(tower, enemies) {
  const s = statsAt(tower);
  if (!s.range) return null;
  let best = null;
  for (const e of enemies) {
    if (e.dead) continue;
    if (dist(tower.x, tower.y, e.x, e.y) > s.range + e.radius) continue;
    if (!best || e.progress > best.progress || (e.progress === best.progress && e.id < best.id)) {
      best = e;
    }
  }
  return best;
}

/** 上减速：取最强，刷新时长 */
export function applySlow(enemy, factor, duration) {
  // factor 是"减速百分比"：0.45 表示速度降到 55%，数字越大越强。
  // 所以"更强的减速" = 更小的速度系数 f。
  const f = 1 - factor;
  if (f < enemy.slowFactor) enemy.slowFactor = f;
  enemy.slowTimer = Math.max(enemy.slowTimer, duration);
}

/** 上灼烧：刷新时长，取更高 dps */
export function applyBurn(enemy, dps, duration) {
  enemy.burnDps = Math.max(enemy.burnDps, dps);
  enemy.burnTimer = Math.max(enemy.burnTimer, duration);
}

/** 每帧推进 Debuff 计时并按 tick 结算灼烧 */
export function tickDebuffs(enemy, dt) {
  if (enemy.slowTimer > 0) {
    enemy.slowTimer -= dt;
    if (enemy.slowTimer <= 0) { enemy.slowFactor = 1; enemy.slowTimer = 0; }
  }
  if (enemy.burnTimer > 0) {
    enemy.burnTimer -= dt;
    enemy.burnAcc += dt;
    while (enemy.burnAcc >= BURN_TICK) {
      enemy.burnAcc -= BURN_TICK;
      // 灼烧不吃护甲：护甲是"打不穿"的概念，而火是贴着烧的。
      // 顺带让火焰塔在铁甲怪面前仍然有意义（否则 2.25 点/跳减 4 只算 1 点）。
      applyDamage(enemy, enemy.burnDps * BURN_TICK, true);
    }
    if (enemy.burnTimer <= 0) { enemy.burnDps = 0; enemy.burnAcc = 0; }
  }
}

/** 移动：沿路径前进，返回是否已抵达终点 */
export function moveEnemy(enemy, dt) {
  const speed = enemy.speed * enemy.slowFactor;
  enemy.progress += speed * dt;
  if (enemy.progress >= PATH_SEGMENTS.total) {
    enemy.progress = PATH_SEGMENTS.total;
    const p = pointAt(enemy.progress, enemy.lane);
    enemy.x = p.x; enemy.y = p.y;
    return true;
  }
  const p = pointAt(enemy.progress, enemy.lane);
  enemy.x = p.x; enemy.y = p.y;
  return false;
}

export { UPGRADE, MAX_LEVEL };
