"use strict";
const { uid } = require("./core.cjs");

const LINE = /^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/;
const MARK = /\s*<!--\s*simple-task:([a-zA-Z0-9-]+)\s*-->\s*$/;
const DUE = /(?:^|\s)📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/;

function ensureTaskIds(text, makeId = uid) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const seen = new Set();
  return text.split(/\r?\n/).map(line => {
    const match = line.match(LINE);
    if (!match) return line;
    const mark = match[4].match(MARK);
    if (mark && !seen.has(mark[1])) { seen.add(mark[1]); return line; }
    const id = makeId(); seen.add(id);
    return line.replace(MARK, "") + ` <!-- simple-task:${id} -->`;
  }).join(eol);
}

function parseTasks(text, path) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const m = line.match(LINE);
    if (!m) return [];
    const marker = m[4].match(MARK);
    if (!marker) return [];
    const body = m[4].replace(MARK, "");
    const due = body.match(DUE)?.[1] || "";
    return [{ id: marker[1], title: body.replace(DUE, "").trim(), due,
      completed: m[2].toLowerCase() === "x", kind: "local", path, line: index }];
  });
}

function completeTaskText(text, id) {
  let found = false;
  const next = text.replace(/[^\r\n]+/g, line => {
    const match = line.match(LINE);
    if (match && match[4].match(MARK)?.[1] === id) {
      found = true;
      return match[1] + "x" + match[3] + match[4];
    }
    return line;
  });
  if (!found) throw new Error("原待办已被删除或移动；日历记录会保留。");
  return next;
}

function taskLine(title, due = "", id = uid()) {
  const clean = String(title || "").replace(/[\r\n]+/g, " ").replace(/<!--|-->/g, "").trim();
  if (!clean) throw new Error("请填写待办名称。");
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)) || new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due)) throw new Error("待办日期不正确。");
  return `- [ ] ${clean}${due ? ` 📅 ${due}` : ""} <!-- simple-task:${id} -->`;
}

class MarkdownTasks {
  constructor(app, getPath) { this.app = app; this.getPath = getPath; }
  path() {
    const path = String(this.getPath() || "待办计时/待办.md").replace(/\\/g, "/");
    if (path.startsWith("/") || path.split("/").some(x => x === ".." || x.startsWith(".")) || !path.endsWith(".md") || path.includes(":")) throw new Error("请使用笔记库内的普通 Markdown 文件路径。");
    return path;
  }
  async file(create = false) {
    const path = this.path();
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file && create) {
      const parts = path.split("/"); parts.pop();
      let folder = "";
      for (const part of parts) {
        folder = folder ? `${folder}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      }
      file = await this.app.vault.create(path, "# 待办\n\n");
    }
    if (file && !file.extension) throw new Error("待办路径指向文件夹，请更改路径。");
    return file;
  }
  async list() {
    const file = await this.file();
    if (!file) return [];
    const text = await this.app.vault.read(file);
    const normalized = ensureTaskIds(text);
    if (normalized !== text) {
      // Recompute inside process, preserving concurrent user edits.
      await this.app.vault.process(file, current => ensureTaskIds(current));
      return parseTasks(await this.app.vault.read(file), file.path);
    }
    return parseTasks(text, file.path);
  }
  async add(title, due) {
    const line = taskLine(title, due);
    const file = await this.file(true);
    await this.app.vault.process(file, current => `${current.trimEnd()}\n${line}\n`);
  }
  async complete(task) {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!file || file.extension !== "md") throw new Error("找不到原待办文件；日历记录会保留。");
    await this.app.vault.process(file, current => completeTaskText(current, task.id));
  }
}

module.exports = { ensureTaskIds, parseTasks, completeTaskText, taskLine, MarkdownTasks };
