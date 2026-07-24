# CLAUDE.md

## Release process

Releases are cut from `main` by pushing a `vX.Y.Z` tag — `.github/workflows/release.yml`
then builds the Windows installer and publishes it to GitHub Releases automatically.
Do not run `npm run release` locally; that uses electron-builder's own GitHub publisher,
which races the CI workflow and creates duplicate releases.

Starting a new in-progress version (right after the previous release):
1. Bump `version` in `package.json`.
2. Add a new entry to the top of the `CHANGELOG` array in
   `src/renderer/src/components/ChangelogModal.tsx`, with `tag: 'new'` (renders as
   "Unreleased").
3. Commit as `chore: begin X.Y.Z (unreleased)`.

Cutting the release once the version's work is merged to `main`:
1. In `ChangelogModal.tsx`, flip the new version's `tag` from `'new'` to `'latest'`,
   and remove the `tag` field from the previous entry (it no longer needs a badge).
2. Commit as `chore(release): X.Y.Z`.
3. Push the commit, then create and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The GitHub Actions workflow takes it from there — no local build/publish step needed.
