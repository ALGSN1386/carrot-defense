// 保卫萝卜 V2 · 热路径原语（纯函数，Node 与浏览器共用）
// 这些函数被 game.js 在每帧调用，抽象成独立模块是为了让 tools/benchmark.mjs
// 能直接 import 真实代码做 A/B 实验，而不是复刻一份"差不多的实现"。

/**
 * 原地压缩：把未死亡的元素前移，就地截断数组，返回保留数量。
 * 与 arr.filter(x => !x.dead) 语义一致（保持相对顺序），但零数组分配。
 */
export function compactDead(arr) {
  let w = 0;
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i];
    if (!v.dead) { arr[w] = v; w += 1; }
  }
  arr.length = w;
  return w;
}

/** 原地按谓词保留元素，零数组分配。 */
export function compactBy(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i];
    if (keep(v)) { arr[w] = v; w += 1; }
  }
  arr.length = w;
  return w;
}

/**
 * 由当前存活敌人建 id → enemy 索引，每帧建一次，供该帧全部投射物共享。
 * 替代每个投射物各自 state.enemies.find(e => e.id === targetId && !e.dead)。
 */
export function indexEnemies(enemies) {
  const map = new Map();
  for (const e of enemies) {
    if (!e.dead) map.set(e.id, e);
  }
  return map;
}
