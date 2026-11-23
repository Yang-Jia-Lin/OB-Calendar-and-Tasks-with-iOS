param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$codingRoot=Split-Path $PSScriptRoot -Parent
$projectRoot=Split-Path $codingRoot -Parent
if(-not $SkipBuild){& (Join-Path $PSScriptRoot 'desktop-package.ps1')}
$config=Get-Content -Raw -LiteralPath (Join-Path $codingRoot 'Clients/Desktop/native/tauri.conf.json') | ConvertFrom-Json
if($config.identifier -ne 'com.yangjialin.calendar-task-timer' -or $config.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Unexpected desktop package identity.'}
$name='Calendar Task Timer_'+$config.version+'_x64-setup.exe'
$source=Join-Path $projectRoot ('Agents/Tests/Desktop/target/release/bundle/nsis/'+$name)
if(-not (Test-Path -LiteralPath $source)){throw 'Build the installer before publishing.'}
$release=Join-Path $projectRoot ('Results/PC/V'+$config.version+'_calendar-task-timer-desktop_preview')
New-Item -ItemType Directory -Path $release -Force | Out-Null
$target=Join-Path $release $name
Copy-Item -LiteralPath $source -Destination $target -Force
$checksum=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
if($checksum -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()){throw 'Installer copy checksum mismatch.'}
($checksum+'  '+$name) | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding utf8
@'
# Windows 桌面 __VERSION__ 功能预览

安装文件：`Calendar Task Timer___VERSION___x64-setup.exe`，Windows 11 x64 用户级安装。当前未配置发布签名，不自动安装或更新。

主窗口打开即显示「今天」，保留搜索、分类和状态筛选。「日历」采用左侧导航、中间月／周历、右侧可收起任务池，支持拖拽安排和撤销。「计时」可选择待办开始，支持暂停、继续、结束和结束并完成。

「设置 → 外观」可切换日间／夜间和字体大小，设置保存在本机。Ctrl + 加号放大，Ctrl + 减号缩小，Ctrl + 0 恢复默认。

新计时和重新保存的历史工时使用北京时间（Asia/Shanghai）写入日历。改存时区会保留原有起止时刻及日历事件身份。升级前排队的工时继续按原格式同步。Apple 日历的 GMT 标签和日程块样式待实机核对。

「记录」和「日历」均可编辑工时，起止使用设备本地时间显示，跨天时标出日期。修改先保存到本机，再由队列同步。

先从托盘退出旧程序，再覆盖安装到原位置，无需卸载、重复交接或清空数据。保留自定义安装路径修复和已完成设置自动收起。当前计时中的任务需先结束计时再删除；同步冲突和复杂原生任务的保护继续保留。

Node／Python／固定 SDK 随包提供，正常启动无需在线安装依赖。

OB 0.8.1 继续连接同一后台，本轮没有改动插件或绑定。保留课题按钮、日记及侧栏自动整理，不运行另一套计时或同步。

尚未交接的旧用户使用 Results/Obsidian/V0.7.0_calendar-task-timer 保留版本生成交接目录，再在首次设置导入。新用户确认旧写入者停止后启用独立模式。新插件不回退为旧完整模式，迁移保护和凭据保护仍保留。

安排日期与截止日期独立，首次 Apple 原生提醒事项备注往返通过后，验证入口自动收起；不需要反复验证。默认结束只记工时，手动暂停不计入，明确退出保存为暂停。

隔离环境的检查结果见 Notes/开发日志.md。业务数据、凭据、绑定、历史和待提交队列保留。

数据位置：`%LOCALAPPDATA%/CalendarTaskTimer/Desktop`。已有日记和手写区保留。回退前先结束并退出桌面、核对待提交队列、备份桌面与导出数据，再恢复旧程序和旧设置；存在桌面新增业务时不直接覆盖旧文件回灌。

Mac 轻量工具未包含在本包。正式业务没有被本次开发自动迁移；已安装 OB 程序不会自动重新加载。
'@.Replace('__VERSION__',$config.version) | Set-Content -LiteralPath (Join-Path $release 'README.md') -Encoding utf8
Write-Output ('Published preview installer: '+$target)
Write-Output ('SHA256: '+$checksum)
