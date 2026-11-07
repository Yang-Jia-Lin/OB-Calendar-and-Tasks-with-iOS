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
$release=Join-Path $projectRoot ('Results/Release/V'+$config.version+'_calendar-task-timer-desktop_preview')
New-Item -ItemType Directory -Path $release -Force | Out-Null
$target=Join-Path $release $name
Copy-Item -LiteralPath $source -Destination $target -Force
$checksum=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
if($checksum -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()){throw 'Installer copy checksum mismatch.'}
($checksum+'  '+$name) | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding utf8
@'
# Windows 桌面 0.1.1 功能首版预览

安装文件：`Calendar Task Timer_0.1.1_x64-setup.exe`，Windows 11 x64 用户级安装。当前未配置发布签名，不自动安装或更新。

0.1.1 修复自定义安装路径启动时 Node 报 `EISDIR ... lstat 'S:'`：原生宿主为随包后台启用保留模块路径的启动选项，避免 Windows 扩展路径被错误解析。可继续使用原安装位置；先从托盘退出旧桌面程序，再覆盖安装此版本，无需卸载或清空数据。

已实现主窗口、桌面底层日历、计时灵动岛、待办拖动安排与撤销、日程／工时／生活补记、独立后台及 iCloud 适配。Node／Python／固定 SDK 随包提供，正常启动不在线安装依赖。后续版本再统一视觉和动画。

已有 OB 用户：先退出桌面；加载 OB 0.7.0 完整模式，结束计时并等当前请求结束；执行“准备交接到 Windows 桌面版”；再打开桌面，在设置预览并导入导出目录，然后重新加载 OB 为连接模式。导入保留旧稳定身份，不按标题新建同名任务。不要同时运行旧完整插件和桌面写入者。

没有旧数据的新用户：设置中明确确认旧写入者已停止，启用独立模式，再配置账户、工时日历和列表映射。未交接／确认前不启动第二套计时或提交业务操作。OB 0.7.0 与桌面另有本机宿主互斥；旧 0.6.1 不能识别新互斥，不能跳过升级及交接。

安排日期与截止日期独立；在设置创建专用验证样例、经 Apple 原生提醒事项编辑并回读核对后，才用于真实任务。默认结束只记工时；睡眠／休眠继续计时，手动暂停不计入，明确退出保存为暂停。

本机已查看主窗口与灵动岛，核对同一任务的启动／暂停同步；用户手动确认 Win+D 后日历和灵动岛可见，日历可以点击。仍需验收资源管理器重启、多屏／DPI、物理睡眠／休眠、Apple 原生往返、实际课题按钮／日记以及正式数据迁移。首次主窗口关闭采样超出内存目标，已增加隐藏 WebView 暂停与 Python 空闲退出；修正进程统计后仍需复测 350MB 目标。因此此包仍为预览。

0.1.1 已通过 3 个安装路径专项场景及使用实际安装资源的 10 个隔离后台场景。首版 0.1.0 验证记录为 TypeScript、280 项核心／本机传输、22 项 Python、10 项桌面浏览器、167 项原有 UI 及 10 个随包后台场景；其空闲隔离样例后台操作 P95 为 169ms。0.1.1 安装资源测试与编译并行，P95 241ms，不作为空闲性能达标。详细结果见项目 Notes/开发日志.md。

数据位置：`%LOCALAPPDATA%/CalendarTaskTimer/Desktop`。已有日记和手写区保留。回退前先结束并退出桌面、核对待提交队列、备份桌面与导出数据，再恢复旧程序和旧设置；存在桌面新增业务时不直接覆盖旧文件回灌。

Mac 轻量工具未包含在本包。正式业务没有被本次开发自动迁移；已安装 OB 程序不会自动重新加载。
'@ | Set-Content -LiteralPath (Join-Path $release 'README.md') -Encoding utf8
Write-Output ('Published preview installer: '+$target)
Write-Output ('SHA256: '+$checksum)
