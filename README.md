# OB-Calendar-and-Tasks-with-iOS

基于 Full Calendar Remastered 精简开发的 Obsidian 插件，目标是在一个页面中完成日历、待办和实际用时记录。

## 目录

根目录只保留三个文件：.gitignore、LICENSE.md、README.md。

```text
Src/                             源码和开发配置
  Core/、Providers/、Ui/          日历、待办、同步和界面
  Features/                      功能模块
  Build/                         构建脚本和测试配置
  Testing/                       测试辅助代码
  Reference/                     待整合的计时参考
  Vendor/                        第三方代码
  package.json、pnpm-*.yaml       依赖和命令配置
  tsconfig.json                  TypeScript 配置
  node_modules/                  自动安装的开发依赖，不提交 Git
Data/                            静态资源与项目资料
  I18n/                          中文、英文界面文字
  Fixtures/                      测试样例
  Docs/                          项目说明与开发记录
  manifest.json                  插件名称、版本和 ID
Results/                         可重建的临时结果，按需保留或清理
Plugin/
  full-calendar-remastered/      最终安装目录，只有下面三个文件
    main.js
    manifest.json
    styles.css
```

项目目录首字母大写；node_modules、.git、.vscode 和 __tests__ 等工具约定名称保持原样。插件安装目录名使用 manifest 中的 ID。Results、Plugin、开发依赖和编辑器本机设置不提交 Git。

测试文件跟随对应功能留在 Src 中。package.json、锁文件、pnpm 配置和 TypeScript 配置均收进 Src，它也是 Node 项目的入口目录。

## 开发

在仓库根目录运行：

```powershell
pnpm --dir Src install --frozen-lockfile
pnpm --dir Src run compile
pnpm --dir Src test
pnpm --dir Src run test:timer
pnpm --dir Src run build
```

也可以先进入 Src，再使用 pnpm run build 等命令。开发监听命令为 pnpm --dir Src run dev。

构建直接生成 Plugin/<manifest.id>/ 中的三个安装文件，不保存重复的构建副本。许可证保留在仓库根目录。构建不会自动安装到日常笔记库。

Results/Cache 是依赖下载缓存，Results/Tests 是手动保存的测试报告，都可以删除；安装依赖或再次保存报告时可能重新生成。Src 内的测试代码和 node_modules 开发依赖不属于这些临时结果。

如需手动安装，将 Plugin 内的整个插件 ID 文件夹放入笔记库的 .obsidian/plugins/。当前仍暂用上游插件 ID，正式改版发布前会确定独立名称与 ID。

## 当前进度

- 已删除 AI、天气、统计图表、成就月报、可用时间分享、上游更新弹窗和 NLP 文字快速创建功能。
- 保留日历视图、事件编辑、重复日程、时区、CalDAV / iCloud 同步和待办基础。
- 中英文翻译直接内置，中文界面可离线加载。
- Src/Reference/Simple-task-timer/ 是已认可的计时参考，尚未整合进主插件。
- Apple 新版提醒事项接入仍待验证。

- [需求与项目范围](Data/Docs/项目说明.md)
- [源码结构](Data/Docs/功能结构分析.md)
- [开发与验证记录](Data/Docs/开发与验证.md)

## 来源与许可

本项目修改自 [Full Calendar Remastered](https://github.com/obsidian-full-calendar-remastered/plugin-full-calendar)，基线提交为 54efcc2eb089c2410ac67d955714c30b218e6628。原始 Full Calendar 由 Davis Haupt 开发，Remastered 由 Jovi Koikkara 及上游贡献者维护。

改版沿用 [GPL-3.0 许可证](LICENSE.md)。Src/Reference/Simple-task-timer/ 保留其 MIT 许可。此仓库独立管理 Git 历史，尚未发布改版安装包。

源码仓库：[Yang-Jia-Lin/OB-Calendar-and-Tasks-with-iOS](https://github.com/Yang-Jia-Lin/OB-Calendar-and-Tasks-with-iOS)。
