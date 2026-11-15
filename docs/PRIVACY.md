# Data handling

Website Note Sync runs locally inside desktop Obsidian.

- Website notes and copied attachments are read from the local vault and written to the local website directory you configure.
- A preview and manual confirmation are required before sync changes either directory. Recovery snapshots are stored under the plugin's `backups` directory in the vault and are pruned to the configured limit after a successful sync.
- Git commands run through your local Git installation. Authentication uses the Git credential helper or SSH setup already configured on your computer. The plugin does not ask for or save a GitHub token.
- Media draft content stays in a temporary local Edge page until you choose a platform and click **Generate drafts**. The Wechatsync extension and selected platform receive the article content and images as required to create the draft. Publishing remains a separate action on the platform.
- Draft URLs and recent draft history are stored in the plugin's local `data.json` file. They are not included in this repository or added to site frontmatter.
- The plugin does not run analytics, telemetry, or a vendor-hosted sync service.

Treat `publish: true` as a public release. Website content and Git commits can remain in Git history after a note is withdrawn. Removing a note from the website does not erase copies already fetched, cached, mirrored, or committed remotely.

To report a vulnerability, follow [SECURITY.md](../SECURITY.md). Do not include private notes, cookies, tokens, or Edge profile data in an issue.
