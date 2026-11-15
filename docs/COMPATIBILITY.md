# Website compatibility

## Supported models

| Site type | Support | What the plugin writes | What the site owner configures |
| --- | --- | --- | --- |
| Jekyll | First-party example | A Markdown collection item, a rendered HTML include, copied note assets, and optionally a CSS snapshot | Collection output, article layout, MathJax, navigation, and hosting |
| Astro, Hugo, Eleventy, or another static generator | Generic Markdown mode | `<contentFolder>/<web_slug>.md` with public frontmatter and portable Markdown | Content discovery, frontmatter schema, URL rules, Markdown rendering, styling, navigation, and build |
| WordPress, hosted builders, database-backed CMS | No direct integration | Nothing | Use a separate importer or CMS integration |

The website must be a local directory. Git push is optional and uses the configured local Git remote. The plugin does not create a website, alter its navigation, or deploy it to a hosting provider.

## Jekyll setup

The repository root must contain `_config.yml`, and the configured content folder must already exist. The starter site under `examples/jekyll-site/` uses the default `_notes` folder, a `notes` collection, and `/notes/<slug>/` URLs. Copy or adapt its collection configuration and article layout to your site.

The generated frontmatter points to a file under `_includes/rendered-notes/`. The layout must include that file, for example with `{% include page.rendered_body %}`. The article layout must load `assets/css/border.css`; enable **Refresh body styles during sync** to have the plugin update that file from Obsidian's current computed styles.

If your site is published under a project subpath, set the plugin's **Website subpath** (for example `/my-project`) to match the site's `baseurl`. Set **Note URL path** to the path that your Jekyll collection actually uses.

## Generic Markdown setup

Select **Generic Markdown** and set the content folder to a directory your site generator already reads. For a note with `web_slug: control-basics`, the output is `control-basics.md` in that directory. The plugin leaves its frontmatter and body in Markdown; the site is responsible for rendering them.

Generic mode does not run Jekyll, copy a theme stylesheet, or write HTML includes. The route settings are used to convert links between published notes, so set the public note URL path and optional site subpath to match your real routes.

## Content and rendering limits

- Only Markdown files with `publish: true` are exported. Hidden folders and configured excluded folders are ignored.
- Frontmatter `web_slug` must contain lowercase English letters, digits, and single hyphens. Keep it stable after publishing.
- Standard Markdown, Obsidian callouts, local images, attachments, and MathJax formulas are supported by the Jekyll renderer. Unsupported dynamic query blocks are rejected to avoid leaking results that could include private notes.
- Theme capture covers common text, heading, table, callout, code, and syntax-token styles. It does not copy a theme's complete CSS or arbitrary plugin UI.
- Audio and video attachments can be copied to the site, but external site player behavior depends on the site's layout and browser support.
- CSDN and Zhihu draft creation is separate from website sync. It requires desktop Obsidian, Microsoft Edge, the Wechatsync extension, and an active platform login. The plugin does not click the platforms' final publish action.

## Before publishing

Run **Check configuration**, sync one non-sensitive test note, build the website yourself or enable the Jekyll build check, then inspect the rendered page at normal browser zoom. Confirm the route, images, formulas, code blocks, and theme before enabling public notes in bulk.
