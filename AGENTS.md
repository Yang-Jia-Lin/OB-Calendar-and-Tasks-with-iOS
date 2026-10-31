# 项目开发约定

- 开始修改前阅读 `Notes/0-开发约定.md`，以 `Notes/1-产品需求.md` 和 `Notes/2-架构设计.md` 为当前需求与架构基线。
- 每次实质开发、验证或文档调整后，更新 `Notes/开发日志.md`；新日期／版本在最前，保留实际验证与未完成边界。
- 插件产物只保留 `Results/Release/V<manifest版本>_calendar-task-timer/` 内三个标准文件，不生成 ZIP，不再输出根目录 Plugin。需要区分渠道时，文件夹追加 `_preview` 或 `_stable`；插件 ID 固定 `calendar-task-timer`。
- 浏览器交互预览生成到 `Results/Release/Preview/`，与可安装插件目录分开；不再生成外层 Results/Preview。
- 用户已授权：每次插件更新且相关检查通过后，执行 `npm run release`，自动覆盖 `D:\笔记\.obsidian\plugins\calendar-task-timer` 的 `main.js`、`manifest.json`、`styles.css`。保留 data.json、sessions、Migration 和其他用户数据；只在三文件发生变化时备份旧文件，不自动重载正在运行的插件。仅构建用 `npm run build`，只发布不安装用 `npm run release -- -NoInstall`。
- Results 只保留必要产物与证据。清理前核对范围；不得删除账户会话、私有对象清单、待同步／恢复状态或唯一回退资料。Results、依赖和秘密不入 Git。
- 用户已授权：完成重大功能、新阶段接入、重要同步／数据可靠性修复或实质架构变更，且相关检查通过后，自动提交本次相关代码／文档并 push 到已核对的现有远程。重大更新不要求主版本号变化；纯文档、微小 UI 和产物整理不自动 commit／push，用户明确要求提交时执行。
- 提交前检查 diff 和暂存范围，保留用户无关改动；推送使用正常 push，不重做历史仓库迁移，不使用 force／reset。遇到远端分叉、权限或网络失败保留本地结果并报告，不强行覆盖。
