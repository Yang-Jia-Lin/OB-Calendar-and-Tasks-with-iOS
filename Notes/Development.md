# 开发、发布与仓库维护

更新：2026-10-30。本地环境 Node.js 24.14.0、Python 3.13、PowerShell 7；命令见根 README。

## 工程约定

源码、配置、锁文件、测试和探针集中在 Coding，必要说明放 Notes。Git 不提交依赖、Plugin、Results、会话、环境、凭据和临时文件。

保留 Shared／Providers／Clients 分层，不复制 FCR，不预建未来端。TypeScript 开启未使用代码检查；esbuild 压缩插件，Obsidian 保持 external，MIT 文件头保留。预览保留可调试构建，标题从 manifest 自动生成。

`npm run release` 构建并核对三文件后生成版本 ZIP，不自动安装。当前保留最新与前一版回退包，旧包归入整合前备份。修改核心运行 check／test，修改 UI／DOM 后运行浏览器回归；不得为清理工程重跑真实云端新建／删除。

提醒事项 `Setup.ps1` 按固定提交和 SHA-256 准备 SDK，锁定依赖。Results 内环境、上游源码、状态与 ACL 保护的 `.private` 不进 Git；整合不删除现有会话。运行与恢复工具见探针 README。

## Git 迁移与恢复

远程为 `https://github.com/Yang-Jia-Lin/OB-Calendar-and-Tasks-with-iOS.git`，旧 main 基线 `0720d2a28efc7e2a4931a059f6090295f0f8e1e6`。按用户 2026-10-30 指令，以当前整合项目替换 main 文件树并删除旧本地项目。

保留旧提交为历史父提交，以指定旧 SHA 的 force-with-lease 防止覆盖中途新增的远程提交。旧目录只在备份与远端核对后删除；日常库及已安装 FCR 不在删除范围。

忽略提交的 `Results/Archive/Before-Consolidation-20261030` 保留：

- `legacy-history.bundle`：完整旧 refs，已通过 bundle verify。
- `legacy-working-tree.zip`：旧源码与两份未提交文档，排除可重建依赖和重复 Git 目录。
- `current-source-and-releases.zip`：整合前源码、原设计、历史包与界面证据。

恢复应在临时目录解压或 clone bundle，勿直接覆盖当前项目或日常库。这些备份不上传远端。

## 来源

当前计时插件沿用旧 `Src/Reference/Simple-task-timer` 的 MIT 版权。FCR GPL 实现仅在旧历史和独立安装插件中。提醒事项 SDK 固定 `timlaing/pyicloud` 提交 `af5246511c729eee4d5a95671135ad75fdd77b22`，运行时下载到 Results，并保留上游许可。账号、Cookie、真实对象清单和日志不得当样例提交。
