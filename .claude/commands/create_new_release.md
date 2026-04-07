# Create a New Release

Create a new GnarTerm release. Version is derived from the git tag — no code changes needed.

## Usage

Argument: version number (e.g. `0.4.0`)

## Steps

1. Confirm you are on the `main` branch with a clean working tree
2. Pull latest from origin to ensure you're up to date
3. Verify the version tag `v$ARGUMENTS` does not already exist
4. Create the tag: `git tag v$ARGUMENTS`
5. Push the tag: `git push origin v$ARGUMENTS`
6. Confirm the tag was pushed successfully
7. Report the release URL: `https://github.com/TheGnarCo/gnar-term/releases/tag/v$ARGUMENTS`

## How it works

- The `release.yml` workflow triggers on `v*` tag pushes
- CI extracts the version from the tag and injects it via `sed` into `Cargo.toml` and `--config {"version":"..."}` into tauri-action
- Builds run on macOS (aarch64 + x86_64), Ubuntu, and Windows
- tauri-action creates the GitHub Release and uploads platform installers
- The `update-homebrew.yml` workflow updates the Homebrew tap after release assets are published

## Important

- Do NOT edit version files (package.json, Cargo.toml, tauri.conf.json) — CI handles versioning from the tag
- Do NOT create a branch or PR for the release — it's just a tag on main
- If the release workflow fails, check the Actions tab: https://github.com/TheGnarCo/gnar-term/actions/workflows/release.yml
