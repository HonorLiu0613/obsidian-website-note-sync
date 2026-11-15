# Changelog

## 2.1.2

- Make the test command portable across Windows, macOS, and Linux shells.
- Resolve Git repository roots through real paths so macOS temporary-directory symlinks do not block safe publishing.

## 2.1.1

- Normalize Git top-level paths across Windows drive and slash formats so the publishing safety check works on Windows runners.

## 2.1.0

- Publish as a standalone open-source repository with bilingual setup guides and a Jekyll starter site.
- Keep website pushes scoped to exact generated files; refuse pushes that could include existing commits or staged work.
- Run configured Jekyll build checks before showing the final push preview.
- Fix backup pruning so recognized dated snapshots are rotated while unrelated folders are retained.
- Support locating Microsoft Edge on Windows, macOS, and Linux.
- Remove unsupported social platforms; media drafts remain available for CSDN and Zhihu.
- Add tests for local Git publishing boundaries and media handoff origin checks.
