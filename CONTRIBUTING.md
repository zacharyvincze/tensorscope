# Contributing

## Commits

Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/). release-please reads them to pick the next version and write the changelog.

| prefix | use for | version bump (0.x) |
|---|---|---|
| `feat:` | new behaviour | patch |
| `fix:` | bug fix | patch |
| `feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer | incompatible change to the C++ API, the bundle format or the extension | minor |
| `docs:`, `ci:`, `build:`, `refactor:`, `test:`, `chore:` | everything else | none |

An optional scope names the part: `feat(extension): …`, `fix(capture): …`, `docs(spec): …`.

PRs are squash-merged, so the PR title is the commit message. The **PR title** check enforces the format.

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`:

- **Capture library:** builds the tests and examples against the system GoogleTest, runs `ctest`, and runs `doxygen` with warnings as errors.
- **Extension:** on Node 18, `npm ci` and `npm run package` (type-check, unit tests, `.vsix` build).

## API reference

The headers carry Doxygen block comments (`/** ... */`, with `@param[in]`/`@param[out]` on every parameter). Run `doxygen` from the repo root to build the HTML reference into `build/docs/html`; the usage guide stays in [docs/capture-library.md](docs/capture-library.md).

## Versions

One version covers the whole repo: the C++ library, the extension and the tag `vX.Y.Z`. release-please keeps these in sync:

- `CMakeLists.txt` (`project(... VERSION ...)`)
- `Doxyfile` (`PROJECT_NUMBER`)
- `extension/package.json` and `extension/package-lock.json`
- the `GIT_TAG` in the FetchContent snippets of `README.md` and `docs/capture-library.md`

Two other version numbers change independently, only when compatibility requires it:

- the bundle format's `version` in `manifest.json` (see [spec/format.md](spec/format.md)),
- the C++ `inline namespace v1`.

Releases before 1.0 are marked as pre-releases on GitHub.

## Releasing

1. Merge PRs into `main` as usual. `.github/workflows/release.yml` keeps a release PR open that bumps the versions and updates `CHANGELOG.md`.
2. To release, merge the release PR. release-please tags `vX.Y.Z` and creates the GitHub Release.
3. The same workflow builds the `.vsix` from the tag and attaches it to the release.

To force a specific version, add `Release-As: X.Y.Z` to a commit message body.

### Patching an older release

Only when `main` has moved past a version that needs a fix: branch `release/X.Y` from the tag, cherry-pick the fix, and run release-please against that branch (`target-branch: release/X.Y`). No long-lived release branches otherwise.

## Repository setup

One-time settings on GitHub:

- **Settings → Actions → General → Workflow permissions:** enable "Allow GitHub Actions to create and approve pull requests", so release-please can open the release PR.
- **Secret `RELEASE_PLEASE_TOKEN`:** a fine-grained PAT for this repo with Contents and Pull requests read/write. PRs opened with the default `GITHUB_TOKEN` don't trigger CI, so without it the release PR has no checks.
- **Branch protection on `main`:** require the **Capture library**, **Extension** and **Conventional commit** checks; allow squash merges only.
