# Website Note Sync

把选定的 Obsidian 笔记发布到使用 Git 管理的个人网站。每次同步先预览，冲突由你选择；推送时只提交插件为选中笔记生成的文件。

[English](README.md) · [网站兼容说明](docs/COMPATIBILITY.md) · [数据与隐私](docs/PRIVACY.md)

## 功能

- 手动单向或双向同步，执行前显示预览，双边修改时提供冲突选项。
- 笔记默认不公开；只有 frontmatter 中的 `publish: true` 才参与网站同步。
- 支持 Jekyll 正文渲染，也支持由你的网站内容管线负责排版的通用 Markdown 导出。
- Jekyll 模式可从当前 Obsidian 主题提取常见正文样式。
- 可通过 Microsoft Edge 和 Wechatsync 扩展生成 CSDN、知乎草稿；最终发布由你在平台确认。
- 修改笔记或网站文件前创建可恢复的备份。
- 可使用本机 Git 推送；推送前展示文件列表，已有暂存改动或其他未推送提交时会停止。

插件不依赖托管同步服务，不收集遥测信息，也不保存 Git、CSDN 或知乎凭据。详见[数据处理说明](docs/PRIVACY.md)。

## 安装

插件仅支持桌面版，因为它需要读写本地网站文件并运行 Git。

1. 从 GitHub Releases 下载最新版本 ZIP。
2. 在仓库中创建 `.obsidian/plugins/website-note-sync/` 文件夹。
3. 将 ZIP 中的 `main.js`、`manifest.json`、`styles.css` 和 `versions.json` 解压到该目录。升级时保留已有的 `data.json` 和 `backups` 文件夹。
4. 在 Obsidian 打开 **设置 → 第三方插件**，必要时刷新插件列表，然后启用 **Website Note Sync**。

开发安装：克隆仓库，运行 `npm ci` 和 `npm run build`，再把 `dist/` 中的四个文件复制到插件目录。标记版本的 GitHub Release 会自动附上这些文件。

## 首次配置

1. 确认个人网站已克隆到本地并由 Git 管理。先检查 `git status`，了解当前工作区改动。
2. 打开 **设置 → Website Note Sync**，选择网站模式，填写本地仓库路径和笔记输出目录。默认输出目录是 `_notes`。
3. 使用 Jekyll 时可参考 `examples/jekyll-site/`。仓库根目录需有 `_config.yml`，笔记输出目录需预先创建。
4. 点击 **检查配置**。它只检查路径与 Git，不会同步或发布。
5. 将 `examples/website-note-template.md` 加入 Templater，或手动使用其中的属性模板。
6. 为文章设置稳定的小写英文 `web_slug`。确认内容可公开后，再将 `publish: false` 改为 `publish: true`。
7. 点击左侧功能区的同步中心，预览变更、处理冲突并确认同步。此步骤只写入本地网站。
8. 发布网站时打开 **推送网站**，核对文件列表、填写提交说明并确认。GitHub Pages 或其他托管服务随后独立部署。

默认设置会要求手动操作：笔记默认私有，网站构建默认关闭，Git 推送必须再次预览确认。

## 网站支持范围

插件面向由 Git 管理的 Markdown 网站。Jekyll 提供了可运行的示例。Astro、Hugo、Eleventy 等静态站点生成器，只要内容管线接受 `<笔记目录>/<web_slug>.md`，可以选择**通用 Markdown**；布局、集合规则、导航和部署仍由你的网站管理。插件不直接连接 WordPress、托管式建站平台或数据库型 CMS。详见[兼容性说明](docs/COMPATIBILITY.md)。

通用 Markdown 模式导出正文和公开属性，不会复制 Obsidian 主题 CSS。Jekyll 的样式提取覆盖常见 Markdown 元素和当前主题的计算样式，但无法复刻所有 Obsidian 插件、动态视图或主题行为。公开发布前请检查生成页面。

## 笔记属性

```yaml
---
title: 卡尔曼滤波笔记
date: 2026-11-15
updated: 2026-11-15
publish: false
web_slug: kalman-filter-notes
domain: Control and Estimation
tags:
  - Kalman Filter
featured: false
excerpt: Notes on state estimation.
---
```

`publish` 必须是未加引号的布尔值 `true` 或 `false`。草稿保持 `false`。插件会在需要时创建稳定 ID，不会根据主题关键词搬动你已有的笔记。

## 开发

需要 Node.js 20 或更新版本，以及 Git。

```sh
npm ci
npm test
npm run check
npm run build
npm run release
```

`npm run release` 会生成 `dist/website-note-sync-<版本>.zip` 和 Obsidian 发布所需的单独文件。提交改动前请阅读[贡献指南](CONTRIBUTING.md)。

## 许可证

MIT。本项目是独立的社区项目，与 Obsidian、CSDN、知乎或 Wechatsync 均无隶属关系。
