// Components native button extension. Components supplies `app`, `obsidian`, and this.currentFile.
module.exports = {
  name: "CalendarTaskTimerStart",
  scopes: ["button"],
  async entry(chooseTask = false) {
    const plugin = app.plugins.getPlugin("calendar-task-timer");
    if (!plugin?.startFromNote) {
      new obsidian.Notice("请先加载 0.2.14 或更高版本的日历与待办计时插件。");
      return { ok: false, code: "unavailable" };
    }
    return plugin.startFromNote(this.currentFile?.path || "", chooseTask === true);
  }
};
