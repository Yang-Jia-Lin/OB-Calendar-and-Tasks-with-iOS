"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.STT_PLAYWRIGHT || "playwright");

(async () => {
  const url = process.argv[2];
  const out = path.resolve(process.argv[3] || "preview/test-results");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STT_BROWSER_CHANNEL || "chrome" });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: "Asia/Shanghai" });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await page.getByText("日历已连接", { exact: true }).waitFor();
  await page.getByRole("button", { name: "计时", exact: true }).first().waitFor();
  assert.equal(await page.getByText("阅读论文", { exact: true }).count(), 1);

  // Test the actual bundled plugin in a synthetic Obsidian host, not a separate UI implementation.
  await page.getByRole("button", { name: "计时", exact: true }).first().click();
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await page.locator("[data-timer-readout]").textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("[data-timer-readout]").textContent(), paused);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(out, "running-light.png"), fullPage: true });
  await page.getByRole("button", { name: "结束并完成", exact: true }).click();
  await page.getByText("已完成 1 条（原始记录保留在待办来源中）", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => __preview.events.filter(x => x.event.title === "阅读论文").length), 2);
  assert.equal(await page.getByRole("checkbox", { name: "完成 阅读论文", exact: true }).count(), 0);

  // Offline completion must leave the task open and persist a retryable outbox item.
  await page.getByRole("checkbox", { name: "模拟断网" }).check();
  await page.getByRole("button", { name: "计时", exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "结束并完成", exact: true }).click();
  await page.getByText("待同步 1 条", { exact: true }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: "完成 整理笔记", exact: true }).count(), 1);
  await page.getByRole("checkbox", { name: "模拟断网" }).uncheck();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("已完成 2 条（原始记录保留在待办来源中）", { exact: true }).waitFor();
  assert.equal(await page.getByText("待同步 1 条", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => __preview.events.filter(x => x.event.title === "整理笔记").length), 1);

  // Editing the title of a UTC timer event must preserve its local clock time.
  const beforeEdit = await page.evaluate(() => __preview.events.find(x => x.event.title === "整理笔记").event);
  await page.locator(".stt-event").filter({ has: page.getByText("整理笔记", { exact: true }) }).click();
  const shownTime = await page.getByLabel("开始时间", { exact: true }).inputValue();
  const localStart = new Date(`${beforeEdit.date}T${beforeEdit.startTime}Z`).toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hour12: false });
  assert.equal(shownTime, localStart);
  await page.getByRole("textbox", { name: "标题", exact: true }).fill("整理笔记（完成）");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("整理笔记（完成）", { exact: true }).waitFor();

  const malicious = '测试 <img src=x onerror="window.bad=true">';
  await page.getByRole("textbox", { name: "新待办名称", exact: true }).fill(malicious);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByText(malicious, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => !!window.bad || document.querySelector("#app img") !== null), false);

  // Manual calendar creation and editing use the same FCR bridge as timer records.
  await page.getByRole("button", { name: "新增日程", exact: true }).click();
  await page.getByRole("textbox", { name: "标题", exact: true }).fill("手动日程测试");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("手动日程测试", { exact: true }).waitFor();
  await page.getByRole("button").filter({ has: page.getByText("手动日程测试", { exact: true }) }).click();
  await page.getByRole("textbox", { name: "标题", exact: true }).fill("已修改的日程");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已修改的日程", { exact: true }).waitFor();

  // A running session survives a reload, paused at its last saved heartbeat.
  await page.getByRole("button", { name: "计时", exact: true }).first().click();
  await page.waitForTimeout(1100);
  await page.evaluate(() => __preview.plugin.controller.heartbeat());
  await page.reload();
  await page.getByRole("button", { name: "继续", exact: true }).waitFor();
  assert.equal(await page.getByText("已暂停", { exact: true }).count(), 1);
  await page.getByRole("checkbox", { name: "深色", exact: true }).check();
  await page.screenshot({ path: path.join(out, "paused-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 520, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(out, "narrow.png"), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { status: "passed", browserErrors: errors, checks: ["bundled-plugin-boot", "task-selection", "pause-excludes-idle", "calendar-write-and-task-complete", "offline-outbox", "retry-no-duplicate", "title-escaping", "calendar-create-edit", "restart-recovery", "dark-mode", "narrow-layout"],
    limitation: "Synthetic Obsidian/FCR host. No live iCloud account was used." };
  fs.writeFileSync(path.join(out, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
