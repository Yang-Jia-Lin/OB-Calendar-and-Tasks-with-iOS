<%*
// 日记创建后的单次更新入口；生成逻辑仍由计时插件维护。
const cttDiaryPath = tp.file.path(true);
const cttDiaryApp = tp.app;
const cttDiaryNotice = tp.obsidian.Notice;
let cttDiaryAutoDone = false;
tp.hooks.on_all_templates_executed(async () => {
    if (cttDiaryAutoDone) return;
    cttDiaryAutoDone = true;
    try {
        const timer = cttDiaryApp.plugins.getPlugin("calendar-task-timer");
        if (typeof timer?.updateDiaryFromNote !== "function") {
            throw new Error("请先启用支持日记时间轴的计时插件版本");
        }
        await timer.updateDiaryFromNote(cttDiaryPath);
    } catch (error) {
        new cttDiaryNotice(`日记已创建，时间轴未自动更新：${error?.message || String(error)}。可稍后点击“更新时间轴”重试。`);
    }
});
%>
