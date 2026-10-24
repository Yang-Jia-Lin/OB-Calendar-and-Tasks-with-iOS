"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const names = ["core", "tasks", "fcr", "ui", "plugin"];
const modules = names.map(name => `${JSON.stringify(name)}: function(module, exports, require) {\n${fs.readFileSync(path.join(root, "Src", `${name}.cjs`), "utf8")}\n}`).join(",\n");
const bundle = `/* 简洁待办计时 0.1.0 — source included in src/; MIT */\n(function(outerRequire, outerModule) {\nconst modules = {${modules}};\nconst cache = {};\nfunction load(id) {\n if (!id.startsWith('./')) return outerRequire(id);\n const name = id.slice(2).replace(/\\.cjs$/, '');\n if (cache[name]) return cache[name].exports;\n if (!modules[name]) throw new Error('Unknown module: ' + id);\n const local = {exports: {}}; cache[name] = local;\n modules[name](local, local.exports, load); return local.exports;\n}\nouterModule.exports = load('./plugin.cjs');\n})(require, module);\n`;
const dist = path.resolve(root, "../../../Results/Reference/simple-task-timer");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "main.js"), bundle);
for (const file of ["manifest.json", "styles.css", "README.md", "LICENSE"]) {
  if (fs.existsSync(path.join(root, file))) fs.copyFileSync(path.join(root, file), path.join(dist, file));
}
console.log(`Built ${path.relative(root, dist)} (${Buffer.byteLength(bundle)} bytes)`);
