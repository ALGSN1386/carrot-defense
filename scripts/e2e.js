// 端到端测试驱动（仓库内可复跑）
//
// 用法：
//   1) 起静态服务器：python -m http.server 8080
//   2) 起一个带调试端口的浏览器：
//        msedge --headless=new --remote-debugging-port=9222 about:blank
//   3) node scripts/e2e.js --url http://127.0.0.1:8080/ [--port 9222] [--shot out.png]
//
// 退出码：0 = 全部通过；1 = 有断言失败或页面异常。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const port = opt("port", "9222");
const url = opt("url", "http://127.0.0.1:8080/");
const shot = opt("shot", null);
const scriptPath = path.join(here, "..", "tests", "browser", "e2e.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", async (ev) => {
    let raw = ev.data;
    if (typeof raw !== "string") raw = await raw.text();
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, ready, send };
}

async function main() {
  const targets = await listTargets().catch(() => null);
  if (!targets) {
    console.error(`无法连接 CDP: http://127.0.0.1:${port}/json/list`);
    console.error("请先用 --remote-debugging-port 启动浏览器。");
    process.exit(1);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) {
    console.error("没有可用的 page target");
    process.exit(1);
  }

  const { ws, ready, send } = connect(page.webSocketDebuggerUrl);
  await ready;
  await send("Page.enable");
  await send("Runtime.enable");
  // 改完源码必须禁用缓存，否则测的是上一版
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });

  await send("Page.navigate", { url });
  let booted = false;
  for (let i = 0; i < 60; i += 1) {
    const probe = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true });
    if (probe.result?.result?.value) { booted = true; break; }
    await sleep(250);
  }
  if (!booted) {
    const err = await send("Runtime.evaluate", { expression: "window.__bootError || null", returnByValue: true });
    console.error("应用未挂载。页面错误: " + (err.result?.result?.value || "无"));
    ws.close();
    process.exit(1);
  }
  await sleep(300);

  const source = fs.readFileSync(scriptPath, "utf8");
  const res = await send("Runtime.evaluate", { expression: source, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.error("脚本异常: " + JSON.stringify(res.result.exceptionDetails).slice(0, 600));
    ws.close();
    process.exit(1);
  }

  const out = res.result?.result?.value || {};
  if (out.fatal) {
    console.error("致命: " + out.fatal);
    ws.close();
    process.exit(1);
  }

  let failed = 0;
  for (const [k, v] of out.steps || []) {
    console.log(`  ${k.padEnd(26)} ${v}`);
  }
  if ((out.errors || []).length) {
    console.error("页面异常: " + JSON.stringify(out.errors));
    failed += 1;
  }

  // 必须为真的关键断言
  const must = {
    shopCards: 5,
    towersWithoutSelection: 0,
    towersAfterFirstPlace: 1,
    selectionAfterPlace: null,
    towersAfterSecondClick: 1,
    towersAfterPathClick: 1,
    pausedFreezes: true,
    startBlockedWhilePaused: true,
    killedAtLeastOne: true,
    overlayVisible: true,
    startBtnDisabled: true,
    restartCoins: 320,
    restartTowers: 0,
  };
  const got = Object.fromEntries(out.steps || []);
  console.log("");
  for (const [k, expected] of Object.entries(must)) {
    const ok = JSON.stringify(got[k]) === JSON.stringify(expected);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${k} = ${JSON.stringify(got[k])}${ok ? "" : ` ← 期望 ${JSON.stringify(expected)}`}`);
    if (!ok) failed += 1;
  }

  if (shot && (await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).result?.data) {
    const data = (await send("Page.captureScreenshot", { format: "png" })).result.data;
    fs.writeFileSync(shot, Buffer.from(data, "base64"));
    console.log("  截图: " + shot);
  }

  ws.close();
  console.log(failed === 0 ? "\n端到端全部通过。" : `\n端到端失败 ${failed} 项。`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED " + e.message);
  process.exit(1);
});
