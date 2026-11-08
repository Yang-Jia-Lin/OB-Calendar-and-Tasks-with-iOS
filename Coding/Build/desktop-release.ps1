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

本版补充待办行内删除及应用内确认、编辑时切换分类、今天待办快捷筛选；未完成的逾期／过期安排显示到今天，同时保留原日期和逾期标记。日历上的计时记录可直接编辑，保留原记录身份及暂停分段。灵动岛提供明确的收起和隐藏按钮，拖动区域与控制按钮分离，移除 Windows 阴影白边并设透明背景。

先从托盘退出旧程序，再覆盖安装到原位置，无需卸载、重复交接或清空数据。保留自定义安装路径修复和已完成设置自动收起。当前计时中的任务需先结束计时再删除；同步冲突和复杂原生任务的保护继续保留。

已实现主窗口、桌面底层日历、计时灵动岛、待办拖动安排与撤销、日程／工时／生活补记、独立后台及 iCloud 适配。Node／Python／固定 SDK 随包提供，正常启动不在线安装依赖。后续版本再统一视觉和动画。

OB 0.8.1 继续连接同一后台，本轮没有改动插件或绑定。保留课题按钮、日记及侧栏自动整理，不运行另一套计时或同步。

尚未交接的旧用户使用 Results/Obsidian/V0.7.0_calendar-task-timer 保留版本生成交接目录，再在首次设置导入。新用户确认旧写入者停止后启用独立模式。新插件不回退为旧完整模式，迁移保护和凭据保护仍保留。

安排日期与截止日期独立，首次 Apple 原生提醒事项备注往返通过后，验证入口自动收起；不需要反复验证。默认结束只记工时，手动暂停不计入，明确退出保存为暂停。

本机已查看主窗口与灵动岛，核对同一任务的启动／暂停同步；用户手动确认 Win+D 后日历和灵动岛可见，日历可以点击。仍需验收资源管理器重启、多屏／DPI、物理睡眠／休眠、Apple 原生往返、实际课题按钮／日记以及正式数据迁移。首次主窗口关闭采样超出内存目标，已增加隐藏 WebView 暂停与 Python 空闲退出；修正进程统计后仍需复测 350MB 目标。因此此包仍为预览。

本轮通过 TypeScript、272 项核心、23 项 Python 适配和 19 个桌面交互场景。按用户要求未测内存或启动速度，未操作真实任务做测试；实际结果见 Notes/开发日志.md。业务数据、凭据、绑定、历史和待提交队列保留。

数据位置：`%LOCALAPPDATA%/CalendarTaskTimer/Desktop`。已有日记和手写区保留。回退前先结束并退出桌面、核对待提交队列、备份桌面与导出数据，再恢复旧程序和旧设置；存在桌面新增业务时不直接覆盖旧文件回灌。

Mac 轻量工具未包含在本包。正式业务没有被本次开发自动迁移；已安装 OB 程序不会自动重新加载。
'@.Replace('__VERSION__',$config.version) | Set-Content -LiteralPath (Join-Path $release 'README.md') -Encoding utf8
Write-Output ('Published preview installer: '+$target)
Write-Output ('SHA256: '+$checksum)
