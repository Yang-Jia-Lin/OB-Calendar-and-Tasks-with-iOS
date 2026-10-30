# iCloud 提醒事项最小探针

仅验证真正的 Apple 提醒事项；失败后保留本地待办，不实现日历事件代替待办。

候选源码：`timlaing/pyicloud`，固定提交 `af5246511c729eee4d5a95671135ad75fdd77b22`。本机解压源码和独立 Python 3.13 环境在根目录 `Results/Probes/IcloudReminders`，依赖版本见 `requirements.lock.txt`。这是独立探针，不是产品安装包，不接入现有插件。

首次克隆后，先安装 Python 3.13 和 PowerShell 7，在项目根目录运行 `pwsh -NoProfile -File .\Coding\Probes\IcloudReminders\Setup.ps1`。脚本下载固定提交并核对 SHA-256、建立隔离环境、按锁文件安装依赖，只执行无账户预检。已有本机会话保留，不随整合删除。探针环境与会话不进入 Git 或插件安装包。

本次实际使用 `local_ui.py` 提供本机回环登录页；运行地址由启动输出给出，端口动态分配。它使用同一个探针流程，输入内容不进入聊天、请求日志或状态文件。私有目录须先按下方脚本准备，不应裸启动后使用未保护的 Cookie 目录。

终端备用入口，在项目根目录运行：

```powershell
pwsh -NoProfile -File .\Coding\Probes\IcloudReminders\Run.ps1
```

需要改用本机登录页时使用同一脚本的 `-Browser` 参数，先保护会话目录再启动页面；不要同时运行两轮：

```powershell
pwsh -NoProfile -File .\Coding\Probes\IcloudReminders\Run.ps1 -Browser
```

只能在本机终端输入 Apple 账户、密码和验证码，密码不回显；不要通过聊天提供。账户地区在终端选择。若有验证码请求，先核对 Apple 设备上的登录提示。会话和精确对象 ID 保存到 Results 中由当前 Windows 用户与 SYSTEM 访问的 `.private` 目录；该路径由启动脚本先设置 ACL，Results 已忽略提交。脱敏状态保存在 `status.json`。

登录后在 iPad 的 **iCloud 提醒事项** 新建名称以 `ICT-Verify-` 开头的普通列表，并手动添加一条 `ICT-设备验证` 任务。终端确认读取后，探针只创建四条专用样例，检查无日期、日期和具体时刻、同标题独立身份、改名、完成／恢复，并提示逐步核对 iPad。现有个人任务不被写入。

若创建响应丢失，停止自动创建；不按标题自动找回或删除。失败后保留清单供人工核对。正常完成时可在终端选择只清理本次创建的四条样例；手动建立的验证任务和列表保留。iPad 反向删除、跨午夜、重启／隔日、认证失效、分页与原生字段完整保护等仍须后续实测，不因核心探针通过便标记全部验收通过。

2026-10-29 的完成状态核查已由用户确认是隐藏已完成项目造成的显示误判。若要继续**同一批样例**的恢复、反向修改和删除，使用下面入口，不重新运行初始新建：

```powershell
pwsh -NoProfile -File .\Coding\Probes\IcloudReminders\Run.ps1 -Browser -Resume
```

继续入口只复用本次既有可信会话，失效时停止，不会用密码登录兜底；原失败结果归档保留，另记用户更正确认。它不会创建任务，仍须在页面核对 iPad，清理只处理原清单 ID。该入口针对当前中断位置，不是任意位置都可重入的通用恢复器。

无账户预检及安全测试：

```powershell
.\Results\Probes\IcloudReminders\.venv\Scripts\python.exe .\Coding\Probes\IcloudReminders\probe.py --preflight
.\Results\Probes\IcloudReminders\.venv\Scripts\python.exe -m unittest discover -s .\Coding\Probes\IcloudReminders -p test_*.py -v
```

预检不会访问账户。详细测试计划以 Notes/04 为准，实际状态以 Notes/10 和脱敏运行结果为准。

## 受控异常与真实外部修改

`reliability.py` 已执行本轮受控故障注入和两客户端冲突检查，`reliability_finish.py` 已核对用户的 iPad 原生改名／删除，并清理本轮四条样例。结果是根 `Results/Probes/IcloudReminders/reliability-status.json`，精确对象清单在受 ACL 保护的 `.private/reliability-*.json`。不要为了查看结果重新运行新建入口。

断网和请求超时在本进程传输层模拟；响应丢失是在真实写入应答后抛出模拟超时。模拟 401 只送入 CloudKit 客户端，不破坏真实会话。它们不代表物理断网或真实认证自然到期。并发和外部删除则确实操作了专用云端样例；没有改系统网络、Apple 安全设置或现有 OB 插件。

候选库高层 `create()` 不接收客户端指定 ID。本探针在发送前提取请求中的 UUID 并持久化，才能按 ID 核对不确定提交。后续 Provider 必须保留这个步骤或提供等效机制，不能因为本次测试通过就盲重试普通 `create()`。

隔日只读检查（北京时间次日才会访问账户；同日只报告未到观察日期）：

```powershell
.\Results\Probes\IcloudReminders\.venv\Scripts\python.exe .\Coding\Probes\IcloudReminders\overnight_check.py
```

它不创建定时任务，也不自动提交密码；会话不能复用时停止并记录。通过仅说明隔日会话与列表读取，不代表隔日写入或真实过期已验收。
