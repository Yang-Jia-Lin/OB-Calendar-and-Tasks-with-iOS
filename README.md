# 日历与待办计时

Obsidian 桌面插件 `calendar-task-timer`，当前版本 **0.2.11**。本地 Markdown 待办、专注计时、可编辑时间轴；日历复用已安装的 Full Calendar Remastered（FCR）公开 API。

## 安装与升级

1. 构建后将 `Plugin/calendar-task-timer` 复制到笔记库的 `.obsidian/plugins/`，启用插件和 FCR。
2. 在本插件设置中“连接 FCR”，完成授权并选择默认分类。分类来自可写 CalDAV 日历。
3. 已安装 0.2.x：先暂停或结束计时、禁用插件，只替换 `main.js`、`manifest.json`、`styles.css`，保留 `data.json`、`sessions` 和 `Migration`，再启用。
4. 从“简洁待办计时”首次迁入：先结束并禁用旧插件，在新版尚无记录时点击“导入旧版”。保留旧文件与 UID，不导入授权令牌。

`npm run release` 生成 `Results/Release/calendar-task-timer-<版本>.zip`，包内恰有三个标准插件文件。构建和发布命令不会自动安装到日常笔记库。

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

预览地址 `http://127.0.0.1:4173`，也可打开 `Results/Preview/index.html`。示例可模拟断网／慢上传，不连接真实账户。浏览器检查默认使用 Chrome，可通过 `CTT_CHROME` 指定路径。

```text
Coding/
  Shared/             模型、计时、时间轴与后台调度
  Providers/Fcr/      公开 API 桥接与日历对账
  Clients/Obsidian/   生命周期、Markdown、日志、UI 和设置
  Build/              构建、测试和三文件打包
  Preview/ Tests/     独立示例与回归测试
  Probes/             独立提醒事项验证工具，不进入插件包
Notes/                当前架构、工程约定与验证记录
Plugin/               最新三文件插件（生成、忽略提交）
Results/              预览、测试、发布与本机探针环境（忽略提交）
```

文档：[架构与范围](Notes/Architecture.md)、[开发与仓库维护](Notes/Development.md)、[验证状态](Notes/Verification.md)。提醒事项另见[探针说明](Coding/Probes/IcloudReminders/README.md)、[验证标准](Notes/04-iCloud接口验证方案.md)和[实测记录](Notes/10-提醒事项接口实测记录.md)。

## 边界与来源

当前待办仍存 OB，独立提醒事项探针成功不代表已接入插件；不做跨设备活动计时接力。FCR 查询来自缓存，不是独立服务端条件事务；真实 OB/iCloud 完整往返和实机性能仍待验收。升级前应暂停／结束；异常重启按最后可靠心跳恢复为暂停，可能少计最后约 15 秒。

计时部分改编自旧工程 MIT `Simple-task-timer`，版权保留在 [LICENSE.md](LICENSE.md) 和构建文件头。FCR 是独立依赖，当前源码未复制其 GPL 实现。旧 FCR 工程保留于此远程仓库的早期提交。
