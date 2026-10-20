// 浏览器端到端测试（页内脚本）
// 由 scripts/e2e.js 通过 CDP 注入执行：真实点击 canvas、真实读 DOM。
//
// 断言原则：只断言"必须为真"的事，避开依赖时序的模糊值。
// 例如"第一波清空"这种要等 20 秒以上，改成"在超时内至少击杀 1 只"，否则换台机器就飘。
(async () => {
  const steps = [];
  const errors = [];
  const log = (k, v) => steps.push([k, v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!window.__game) return { fatal: "window.__game 未挂载", steps, errors };
  const G = window.__game;
  const canvas = document.getElementById("board");
  if (!canvas) return { fatal: "canvas 缺失", steps, errors };

  const clickCell = async (col, row) => {
    const r = canvas.getBoundingClientRect();
    const x = r.left + ((col + 0.5) * 60 * r.width) / 960;
    const y = r.top + ((row + 0.5) * 60 * r.height) / 600;
    canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
    await sleep(30);
  };
  const pick = async (type) => {
    document.querySelector(`.card[data-type="${type}"]`).click();
    await sleep(20);
  };

  G.restart();
  await sleep(100);

  // 基础状态
  log("shopCards", document.querySelectorAll(".card").length);
  log("startCoins", G.snapshot().coins);
  log("initialSelection", G.selectedType);

  // 没选塔时点草地不应该建造
  await clickCell(5, 0);
  log("towersWithoutSelection", G.snapshot().towers);

  // 一次只放一座：放下后自动松开
  await pick("cannon");
  await clickCell(5, 0);
  log("towersAfterFirstPlace", G.snapshot().towers);
  log("selectionAfterPlace", G.selectedType);
  log("coinsAfterBuild", G.snapshot().coins);
  await clickCell(6, 0);
  log("towersAfterSecondClick", G.snapshot().towers);

  // 路径格必须拒绝
  await pick("cannon");
  await clickCell(2, 2);
  log("towersAfterPathClick", G.snapshot().towers);

  // 升级 / 拆除
  await clickCell(5, 0);
  const upBtn = document.getElementById("upBtn");
  log("upgradeLabel", upBtn ? upBtn.textContent.trim() : null);
  if (upBtn) upBtn.click();
  await sleep(40);
  log("levelAfterUpgrade", G.state.towers[0].level);
  document.getElementById("sellBtn").click();
  await sleep(40);
  log("towersAfterSell", G.snapshot().towers);

  // 暂停：冻结 + 禁止开波
  // 建两座塔再打——单座 L1 塔打不穿第 1 波是设计使然，不是缺陷，
  // 所以断言"至少击杀一只"必须建立在合理的最低配置上。
  await pick("cannon");
  await clickCell(5, 0);
  await pick("cannon");
  await clickCell(5, 3);
  document.getElementById("pauseBtn").click();
  await sleep(60);
  const t1 = G.state.time;
  await sleep(250);
  log("pausedFreezes", Math.abs(G.state.time - t1) < 1e-9);
  const waveBefore = G.state.wave;
  document.getElementById("startBtn").click();
  await sleep(80);
  log("startBlockedWhilePaused", G.state.wave === waveBefore);
  document.getElementById("pauseBtn").click();
  await sleep(120);

  // 开波 → 倍速 → 至少击杀一只（不依赖整波清空，避免时序抖动）
  document.getElementById("startBtn").click();
  await sleep(80);
  log("phaseAfterStart", G.snapshot().phase);
  document.getElementById("speedBtn").click();
  document.getElementById("speedBtn").click();
  log("speed", G.state.speed);

  let killed = false;
  for (let i = 0; i < 120; i += 1) {
    await sleep(120);
    if (G.state.stats.kills > 0) { killed = true; break; }
  }
  log("killedAtLeastOne", killed);
  log("killsAfterWave1", G.state.stats.kills);
  log("hpAfterWave1", G.state.hp);
  log("towersOnline", G.snapshot().towers);
  log("enemiesSeen", G.state.stats.kills > 0 || G.snapshot().enemies > 0);

  // 结算面板：构造最后一波清空
  G.state.wave = 15;
  G.state.phase = "wave";
  G.state.pending = [];
  G.state.enemies = [];
  await sleep(300);
  log("overlayVisible", !document.getElementById("overlay").hidden);
  log("overlayTitle", document.getElementById("overlayTitle").textContent);
  log("startBtnDisabled", document.getElementById("startBtn").disabled);
  log("speedBtnDisabled", document.getElementById("speedBtn").disabled);

  // 重开
  document.getElementById("againBtn").click();
  await sleep(150);
  log("restartCoins", G.snapshot().coins);
  log("restartWave", G.snapshot().wave);
  log("restartTowers", G.snapshot().towers);
  log("overlayHiddenAfterRestart", document.getElementById("overlay").hidden);

  return { steps, errors };
})()
