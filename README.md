# 日历与待办计时

AI 开发入口：[Agents/AGENTS.md](Agents/AGENTS.md)。检查产物集中在 Agents/Tests，不属于插件交付内容。

面向电脑主力记录的日历／待办工作台，结合 OB 科研执行入口与 iPad 原生应用。**目标业务数据统一使用 iCloud：日历保存安排和实际记录，提醒事项保存行动任务。**

当前已交付的是 Obsidian 插件 `calendar-task-timer` **0.2.11**：Markdown 待办、计时和可编辑时间轴，日历通过 FCR 访问。独立桌面 APP、Components 按钮、双日期和提醒事项产品接入都尚未完成，不将目标设计写成已实现。

## 2026-10-31 设计基线

- 电脑为主，独立桌面 APP 必做；以待办和核心摘要为方向，不预设整月记录视图，具体展示待定。
- 下一步先做 OB／Components 共用任务和计时入口。按钮、插件页和状态栏操作同一会话，不另建任务副本。
- 安排日期与截止日期分开；无安排日期的任务进入“待安排”，不每天全部塞进日历。
- 生活活动可直接补记，科研采用任务→计时→工时流程；结束计时与完成任务分开。
- iPad 沿用原生应用，Android 暂缓。活动计时先在本设备恢复；本地草稿和恢复日志不属于额外云端主库。

先读[需求与实施顺序](Notes/1-产品需求.md)，再读[架构与 Components 接入设计](Notes/2-架构设计.md)。以下安装／使用说明描述现有 0.2.11，未触发新功能实现或数据迁移。

## 安装与升级

1. 构建或解压后，将 `Results/Release/V<版本>_calendar-task-timer` 内的三个文件复制到笔记库 `.obsidian/plugins/calendar-task-timer/`，启用插件和 FCR。版本前缀只用于产物命名，安装目录和插件 ID 保持 `calendar-task-timer`。
2. 在本插件设置中“连接 FCR”，完成授权并选择默认分类。分类来自可写 CalDAV 日历。
3. 已安装 0.2.x：先暂停或结束计时、禁用插件，只替换 `main.js`、`manifest.json`、`styles.css`，保留 `data.json`、`sessions` 和 `Migration`，再启用。
4. 从“简洁待办计时”首次迁入：先结束并禁用旧插件，在新版尚无记录时点击“导入旧版”。保留旧文件与 UID，不导入授权令牌。

`npm run build` 生成 `Results/Release/V<版本>_calendar-task-timer/`，只含三个标准插件文件，不生成 ZIP。版本取自 manifest（例如 `V0.2.11_calendar-task-timer`）；目录统一拼写为 `Results/Release`。

插件更新并检查通过后，`npm run release` 自动将这三个文件覆盖到 `D:\笔记\.obsidian\plugins\calendar-task-timer/`，保留设置、会话和迁移数据；旧文件有变化才备份，不自动重载运行中的插件。只生成目录可用 `npm run release -- -NoInstall`；预览／稳定版可用 `-Channel preview`／`-Channel stable`，在文件夹名追加对应标注。换库可用 `-VaultPath`。

## 使用

- 新建待办时选择分类，可设置日期；点击 ▷ 计时。点击标题可改名称、分类和日期。
- 待办支持手动／日期／标题排序。手动模式拖动 ⠿，或聚焦手柄后按 Alt + ↑ / ↓；分类内排序保留其他分类位置。⇅ 可排序或隐藏分类。
- 计时支持暂停／继续、补改开始时间和本次分类。“结束并完成”先保存本机并完成本地待办，再后台上传；“只记时间”保留待办。
- 时间轴合并日程、工时和待同步记录。点击可编辑起止、分类或删除；暂停分段分别计时，删除只处理选中时段。全天和重复日程交给完整 FCR。
- 右上角同步按钮提供进度、错误与重试。网络错误退避重试；授权或真实内容冲突等待处理。不要删除日志来清空队列。
- 宽屏时间轴／待办为 1:2，窄屏自动堆叠。专注区平滑展开，支持明暗主题、减少动画、字号和字重；底部状态栏显示当前或下一项。

遇到旧“需要核对”项，先刷新再重试。已修复未确认写入后不刷新，以及资源元数据、零秒格式、缺省字段造成的假冲突；真实内容变化仍停止覆盖。

## 开发

在 `Coding` 目录运行，使用 Node.js 24 和 PowerShell 7：

```powershell
npm ci
npm run check
npm test
npm run release
npm run preview
# 预览服务运行后，另一个终端执行：
npm run test:ui
```

预览地址 `http://127.0.0.1:4173`，也可打开 `Results/Release/Preview/index.html`。示例可模拟断网／慢上传，不连接真实账户。浏览器检查默认使用 Chrome，可通过 `CTT_CHROME` 指定路径。

```text
Coding/
  Shared/             模型、计时、时间轴与后台调度
  Providers/Fcr/      公开 API 桥接与日历对账
  Clients/Obsidian/   生命周期、Markdown、日志、UI 和设置
  Build/              构建、测试和三文件打包
  Preview/ Tests/     独立示例与回归测试
  Probes/             独立提醒事项验证工具，不进入插件包
Notes/                当前架构、工程约定与验证记录
Agents/
  AGENTS.md           AI 开发约定
  Tests/              检查报告、编译测试与 Visuals 截图（可重建）
  Backups/            有变更时的安装前备份（按需生成）
Results/
  Release/
    V<版本>_calendar-task-timer/  三个插件文件
    Preview/                    可重建交互预览
  Probes/             现有本机探针环境与会话
```

文档：[开发约定](Notes/0-开发约定.md)、[产品需求](Notes/1-产品需求.md)、[架构设计](Notes/2-架构设计.md)、[开发日志](Notes/开发日志.md)。版本变化、验收标准和提醒事项实测已统一归入开发日志，按新到旧排列；后续每次开发或验证更新该日志。探针运行方法见[探针说明](Coding/Probes/IcloudReminders/README.md)。

完成重大功能、重要可靠性修复或实质架构变更并通过相关检查后，自动提交并正常推送远程；文档、微小 UI、产物整理不自动提交，用户明确要求提交时执行。具体边界见开发约定和 [Agents/AGENTS.md](Agents/AGENTS.md)。

## 边界与来源

当前待办仍存 OB，属于目标 iCloud 任务接入前的兼容状态；独立探针成功不代表已集成。FCR 查询来自缓存，不是独立服务端条件事务；真实 OB/iCloud 完整往返和实机性能仍待验收。升级前应暂停／结束；异常重启按最后可靠心跳恢复为暂停，可能少计最后约 15 秒。

计时部分改编自旧工程 MIT `Simple-task-timer`，版权保留在 [LICENSE.md](LICENSE.md) 和构建文件头。FCR 是独立依赖，当前源码未复制其 GPL 实现。旧 FCR 工程保留于此远程仓库的早期提交。
