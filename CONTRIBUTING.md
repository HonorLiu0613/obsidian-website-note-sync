# Contributing

Bug reports, compatibility notes, documentation improvements, and focused pull requests are welcome.

## Before opening an issue

- Search existing issues for the same problem.
- Include the Obsidian version, operating system, plugin version, selected website mode, and the exact error text.
- Remove private note text, local file paths, credentials, cookies, and personal website details from logs or screenshots.

## Before opening a pull request

- Keep changes focused and explain the user-visible behavior they change.
- Add or update tests when changing synchronization, path handling, publishing, or media handoff behavior.
- Run `npm ci`, `npm test`, `npm run check`, and `npm run build`.
- Do not commit `data.json`, vault backups, website content, generated `dist/` files, or credentials.
- Update both README files when setup or user-facing behavior changes.

The project targets desktop Obsidian and uses CommonJS modules bundled with esbuild. Keep Obsidian APIs external to the bundle and avoid network access from the plugin except for the user-selected Edge media draft workflow and local Git operations.
