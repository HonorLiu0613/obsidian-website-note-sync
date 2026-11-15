# Website Note Sync

Publish selected Obsidian notes to a Git-backed personal website. Review every sync, keep conflicts visible, and push only the files generated for the selected notes.

[简体中文说明](README.zh-CN.md) · [Compatibility](docs/COMPATIBILITY.md) · [Privacy](docs/PRIVACY.md)

## What it does

- Syncs notes manually in one direction or both directions, with a preview and conflict choices.
- Keeps notes private by default. A note is eligible for website sync only when its frontmatter contains `publish: true`.
- Supports Jekyll with rendered Obsidian Markdown, or a generic Markdown export for sites that already have their own content pipeline.
- Can capture common rendered styles from the active Obsidian theme for Jekyll article bodies.
- Can prepare CSDN and Zhihu drafts in Microsoft Edge through the Wechatsync extension. You review and publish those drafts yourself.
- Creates recoverable backups before changing notes or website files.
- Uses the local Git installation for optional, previewed pushes. Existing staged changes and unrelated local commits block a push.

It does not require a hosted sync service, does not collect telemetry, and does not store Git, CSDN, or Zhihu credentials. See [data handling](docs/PRIVACY.md).

## Install

The plugin is desktop-only because it reads and writes local website files and uses Git.

1. Download the latest release ZIP from the repository's GitHub Releases page.
2. In your vault, create `.obsidian/plugins/website-note-sync/` if it does not exist.
3. Extract `main.js`, `manifest.json`, `styles.css`, and `versions.json` from the ZIP into that folder. Keep any existing `data.json` and `backups` folder.
4. In Obsidian, open **Settings → Community plugins**, reload the plugin list if needed, then enable **Website Note Sync**.

For development, clone this repository, run `npm ci` and `npm run build`, then copy the four files from `dist/` into the plugin folder. The release workflow attaches the same files to tagged releases.

## First setup

1. Keep your website in a local Git checkout. Confirm that `git status` is clean or that you understand the existing changes.
2. Open **Settings → Website Note Sync**. Choose the website mode, set the local repository path, and set the content folder. The default content folder is `_notes`.
3. For Jekyll, use the starter files in `examples/jekyll-site/` as a reference. The repository root must contain `_config.yml`, and the selected content folder must already exist.
4. Run **Check configuration**. This checks local paths and Git access without syncing or publishing anything.
5. Add the note template from `examples/website-note-template.md` to Templater or copy its frontmatter fields into a new note.
6. Set a stable, lowercase English `web_slug`, review the article, then change `publish: false` to `publish: true` only when it is ready to be public.
7. Open the left ribbon's sync center, preview the changes, resolve any conflicts, and confirm sync. Sync writes to the local website only.
8. To publish the website, open **Push website**, inspect the exact file list, enter a commit message, and confirm. GitHub Pages or your hosting provider deploys separately.

The conservative defaults are intentional: website sync is manual, new notes are private, local website builds are off, and Git pushes require a separate preview.

## Website support

The plugin is designed for source-controlled Markdown websites. Jekyll has a first-party example. Astro, Hugo, Eleventy, and similar generators can use **Generic Markdown** when their content pipeline accepts `<content folder>/<web_slug>.md`; their layout, collection rules, navigation, and deployment remain under your site's control. WordPress, hosted site builders, and database-backed CMSs are not directly integrated. See [compatibility details](docs/COMPATIBILITY.md).

Generic Markdown exports content and public frontmatter; it does not reproduce Obsidian's theme CSS. Jekyll style capture covers common Markdown elements and the current computed theme styles. It cannot reproduce every Obsidian plugin, dynamic view, or theme behavior, so check the generated page before publishing.

## Note fields

```yaml
---
title: Kalman Filter Notes
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

`publish` must be the boolean `true` or `false` without quotes. Leave it false while drafting. The plugin creates stable identifiers when needed and does not move existing notes based on their topic.

## Development

Requirements: Node.js 20 or newer and Git.

```sh
npm ci
npm test
npm run check
npm run build
npm run release
```

`npm run release` creates `dist/website-note-sync-<version>.zip` and the individual Obsidian plugin release files. See [contributing](CONTRIBUTING.md) before opening a pull request.

## License

MIT. This is an independent community project and is not affiliated with Obsidian, CSDN, Zhihu, or Wechatsync.
