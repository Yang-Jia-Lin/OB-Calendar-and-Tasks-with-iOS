"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const files = fs.readdirSync(path.join(root, "Src")).filter(x => x.endsWith(".cjs")).map(x => path.join(root, "Src", x));
files.push(path.resolve(root, "../../../Results/Reference/simple-task-timer/main.js"));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status) process.exit(result.status);
}
console.log(`Syntax OK: ${files.length} files`);
