# Release Process

GnarTerm uses **tag-based releases** with zero code changes. CI derives the version from the git tag — do not edit version files manually.

## Quick Release

```bash
git tag v0.4.0
git push origin v0.4.0
```

This triggers the release workflow, which builds for all platforms, signs the macOS binaries, and creates a GitHub Release with downloadable installers.

## How It Works

1. **Tag push** triggers `.github/workflows/release.yml`
2. The workflow extracts the version from the tag (`v0.4.0` → `0.4.0`)
3. `Cargo.toml` version is updated in CI via `sed` to match the tag (not committed)
4. `tauri-action` builds platform-specific installers:
   - **macOS:** `.dmg` for both `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel)
   - **Linux:** `.deb` and `.AppImage` for `x86_64`
5. Builds are signed and notarized (macOS) using secrets stored in GitHub
6. A GitHub Release is created with all artifacts attached
7. The Homebrew tap is updated via `.github/workflows/update-homebrew.yml`

## Prerequisites

### GitHub Secrets

The following secrets must be configured in the repository settings:

| Secret                       | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `APPLE_SIGNING_IDENTITY`     | macOS code signing identity (certificate name) |
| `APPLE_CERTIFICATE`          | Base64-encoded `.p12` certificate              |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate            |
| `APPLE_ID`                   | Apple ID email for notarization                |
| `APPLE_PASSWORD`             | App-specific password for notarization         |
| `APPLE_TEAM_ID`              | Apple Developer Team ID                        |
| `HOMEBREW_TAP_TOKEN`         | PAT with repo scope for the Homebrew tap repo  |

### macOS Signing Setup

1. Create a Developer ID Application certificate in the Apple Developer portal
2. Export it as a `.p12` file with a password
3. Base64-encode the `.p12`: `base64 -i certificate.p12 | pbcopy`
4. Store the base64 string as `APPLE_CERTIFICATE` and the password as `APPLE_CERTIFICATE_PASSWORD`
5. Set `APPLE_SIGNING_IDENTITY` to the certificate's common name (e.g., `Developer ID Application: Your Name (TEAMID)`)

### Notarization

Apple notarization requires an app-specific password:

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. Generate a new password
3. Store it as `APPLE_PASSWORD` along with your `APPLE_ID` and `APPLE_TEAM_ID`

## Version Strategy

- Tags follow semver: `v0.4.0`, `v0.4.1`, `v1.0.0`
- Pre-release tags are supported: `v0.4.0-beta.1`
- The version in `package.json` and `Cargo.toml` is the _development_ version — CI overrides it from the tag at build time
- Do not manually bump version files for releases

## Troubleshooting

### Build fails on macOS

- Verify all `APPLE_*` secrets are set correctly
- Ensure the certificate hasn't expired
- Check that the signing identity matches exactly

### Homebrew tap not updated

- Verify `HOMEBREW_TAP_TOKEN` has `repo` scope
- Check the `update-homebrew.yml` workflow logs

### Release not created

- Ensure the tag starts with `v` (e.g., `v0.4.0`, not `0.4.0`)
- Check that the `GITHUB_TOKEN` has `contents: write` permission
