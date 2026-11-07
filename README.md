# 日历、待办与计时

更新：2026-11-07。目标调整为 **Windows 桌面版承担完整功能，Obsidian 保留按钮入口，Mac 使用原生 App 加轻量计时工具**。

| 端 | 目标职责 | 当前状态 |
| --- | --- | --- |
| Windows 桌面版 | 待办、日程、计时、记录和 iCloud 同步；关闭 OB 后仍可运行 | 0.1.0 首版预览：独立后台、主窗口、桌面日历、灵动岛；真实账户与平台场景待验收 |
| Obsidian／Components | 课题按钮发出开始／暂停／结束指令，显示本机桌面计时状态 | 0.7.0 增加轻量连接及交接入口；切换前仍保留完整插件模式 |
| Mac | 原生日历／提醒事项处理日常事务；小型计时 App 负责本机计时，结束后写入 iCloud 日历 | 待开发及真机验证 |
| iPhone／iPad | 使用原生日历和提醒事项，查看和管理同一账户的数据 | 沿用现有原生应用 |

**活动计时只在发起的电脑上运行，不同步开始／暂停／进行中状态，不要求 Windows 与 Mac 接续计时。** 每台电脑本机的 OB 按钮和计时 App 操作同一会话。结束后的工时进入 iCloud 日历，再由云端共享已保存的结果。Mac 不需要 Windows 在线。

## 当前文档

| 文档 | 用途 |
| --- | --- |
| [产品需求](Notes/1-产品需求.md) | 当前目标、各端范围、实施顺序和验收标准 |
| [架构设计](Notes/2-架构设计.md) | 本机唯一计时、OB 连接、Windows 同步和 Mac 日历写入 |
| [使用与迁移](Notes/3-使用与迁移.md) | 当前 0.6.1 怎么继续用，以及以后如何安全切换 |
| [开发约定](Notes/0-开发约定.md) | 工程、验证、发布、数据保护和文档维护 |
| [开发日志](Notes/开发日志.md) | 最近的决定、工作结果及真实完成边界 |
| [历史归档](Notes/Archive/2026-11-07-OB完整工作台/README.md) | 旧完整 OB 工作台方案、详细使用手册和版本历史 |

AI 接续入口：[Agents/AGENTS.md](Agents/AGENTS.md)，当前交接：[Agents/Handoff.md](Agents/Handoff.md)。历史资料只用于查证，不覆盖当前需求。

## 现有软件

Obsidian 插件 `calendar-task-timer` **0.7.0** 保留原计时／待办／日历、提醒事项、普通重复任务、Components 和日记，并新增受控桌面交接及连接模式。默认不自动转换旧业务；未重新加载的宿主不据磁盘文件声称已经升级。Mac 兼容性尚未建立。

Windows 桌面 **0.1.0 预览版** 已具备本机持久化、队列、拖动安排及撤销、日历面板、灵动岛和打包运行时。先验证专用样例，再执行 OB 交接；没有自动迁移真实任务或停用旧运行实例。安排日期通过 Apple 原生备注往返核对后才用于真实任务。实际睡眠、Win+D、资源管理器恢复、多屏及真实 OB／日记仍需验收，详见使用与迁移。

源码位于 `Coding/`；插件产物位于 `Results/Release/V0.7.0_calendar-task-timer/`，只包含三个程序文件；Windows 安装包及校验说明位于 `Results/Release/V0.1.0_calendar-task-timer-desktop_preview/`。构建与验证命令见[开发约定](Notes/0-开发约定.md)。首版先功能、后视觉精修；Mac 轻量工具仍为后续独立工作。

Windows 安装包：[0.1.0 功能预览](<Results/Release/V0.1.0_calendar-task-timer-desktop_preview/Calendar Task Timer_0.1.0_x64-setup.exe>)，安装及迁移步骤见[随包说明](Results/Release/V0.1.0_calendar-task-timer-desktop_preview/README.md)。

许可证见 [LICENSE.md](LICENSE.md)，依赖许可见[第三方声明](Coding/THIRD-PARTY-NOTICES.md)。Windows 提醒事项的专用验证工具见[探针说明](Coding/Probes/IcloudReminders/README.md)。
