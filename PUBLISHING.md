# SDK Publishing Guide

This document describes how to publish the ScreenForge SDKs to npm and PyPI.

## Overview

ScreenForge provides two official SDKs:
- **JavaScript/TypeScript SDK** (`@screenforge/sdk`) — published to npm
- **Python SDK** (`screenforge`) — published to PyPI

Both SDKs use independent versioning with tag prefixes to trigger automated publishing via GitHub Actions.

---

## Prerequisites

### Required GitHub Secrets

Both publishing workflows require secrets to be configured in the GitHub repository settings:

1. **`NPM_TOKEN`** — npm access token with publish permissions for `@screenforge/sdk`
   - Create at: https://www.npmjs.com/settings/[username]/tokens
   - Token type: **Automation** (recommended for CI/CD)
   - Scope: **Read and write** permissions
   - Add to GitHub: Repository Settings → Secrets and variables → Actions → New repository secret

2. **`PYPI_TOKEN`** — PyPI API token with upload permissions for `screenforge`
   - Create at: https://pypi.org/manage/account/token/
   - Scope: **Project-specific** (recommended) or **Account-wide**
   - Add to GitHub: Repository Settings → Secrets and variables → Actions → New repository secret

---

## Publishing Workflows

### Automated Publishing (Recommended)

Both SDKs are published automatically when version tags are pushed to the repository:

#### JavaScript SDK

1. **Update version** in `sdk/js/package.json`:
   ```bash
   cd sdk/js
   npm version patch  # or minor, major
   ```

2. **Verify the build** locally:
   ```bash
   npm ci
   npm run build
   npm run test
   ```

3. **Create and push the tag**:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore(sdk-js): bump version to X.Y.Z"
   git tag sdk-js-vX.Y.Z
   git push origin main
   git push origin sdk-js-vX.Y.Z
   ```

4. **Monitor the workflow**: https://github.com/hodlthedoor/screenforge/actions/workflows/publish-sdk-js.yml

The workflow will:
- Install dependencies with `npm ci`
- Build the package with `npm run build`
- Publish to npm with `npm publish`

#### Python SDK

1. **Update version** in `sdk/python/pyproject.toml`:
   ```toml
   [project]
   version = "X.Y.Z"
   ```

2. **Verify the build** locally:
   ```bash
   cd sdk/python
   python -m pip install --upgrade pip build twine
   python -m build
   python -m pytest
   ```

3. **Create and push the tag**:
   ```bash
   git add pyproject.toml
   git commit -m "chore(sdk-py): bump version to X.Y.Z"
   git tag sdk-py-vX.Y.Z
   git push origin main
   git push origin sdk-py-vX.Y.Z
   ```

4. **Monitor the workflow**: https://github.com/hodlthedoor/screenforge/actions/workflows/publish-sdk-python.yml

The workflow will:
- Install build tools (`pip`, `build`, `twine`)
- Build source distribution and wheel with `python -m build`
- Upload to PyPI with `python -m twine upload`

---

### Manual Publishing (Fallback)

If the automated workflows fail or you need to publish manually:

#### JavaScript SDK

```bash
cd sdk/js

# Install dependencies
npm ci

# Build the package
npm run build

# Test locally
npm run test

# Login to npm (one-time)
npm login

# Publish
npm publish --access public
```

#### Python SDK

```bash
cd sdk/python

# Install build tools
python -m pip install --upgrade pip build twine

# Build distribution packages
python -m build

# Test locally
python -m pytest

# Upload to PyPI
python -m twine upload dist/*
```

You'll be prompted for your PyPI credentials or API token (use `__token__` as username and the token as password).

---

## Versioning Strategy

### Independent Versioning

Each SDK maintains its own version number independently:
- JavaScript SDK follows semantic versioning (e.g., `1.2.3`)
- Python SDK follows semantic versioning (e.g., `1.0.0`)

Version numbers do NOT need to match between SDKs.

### Tag Prefixes

Tags use prefixes to distinguish SDK releases from other release types:
- `sdk-js-v*` — triggers JavaScript SDK publish workflow
- `sdk-py-v*` — triggers Python SDK publish workflow
- `v*` — triggers Docker image release workflow (separate from SDKs)

### Version Consistency Check

**CRITICAL**: Before pushing a version tag, ensure the tag matches the version in the package manifest:

```bash
# JavaScript SDK
TAG=sdk-js-v1.2.3
PACKAGE_VERSION=$(node -p "require('./sdk/js/package.json').version")
if [ "v$PACKAGE_VERSION" != "${TAG#sdk-js-}" ]; then
  echo "ERROR: Tag $TAG does not match package.json version $PACKAGE_VERSION"
  exit 1
fi

# Python SDK
TAG=sdk-py-v1.0.0
PACKAGE_VERSION=$(grep -oP 'version = "\K[^"]+' sdk/python/pyproject.toml)
if [ "v$PACKAGE_VERSION" != "${TAG#sdk-py-}" ]; then
  echo "ERROR: Tag $TAG does not match pyproject.toml version $PACKAGE_VERSION"
  exit 1
fi
```

---

## Troubleshooting

### npm Publish Fails with 403 Forbidden

**Cause**: Invalid or expired `NPM_TOKEN`, or token lacks publish permissions for `@screenforge/sdk`.

**Fix**:
1. Verify the token has **read and write** permissions
2. Verify the token is for an npm account that is an owner/maintainer of `@screenforge/sdk`
3. Generate a new token if expired and update the GitHub secret

### PyPI Upload Fails with 403 Forbidden

**Cause**: Invalid or expired `PYPI_TOKEN`, or token lacks upload permissions for `screenforge`.

**Fix**:
1. Verify the token is valid and has not been revoked
2. For project-scoped tokens, verify the token is scoped to the `screenforge` project
3. Generate a new token if expired and update the GitHub secret

### Version Already Exists

**Cause**: npm and PyPI do not allow re-publishing the same version number.

**Fix**:
1. Bump the version number in the package manifest
2. Create a new tag with the incremented version
3. Push the new tag

### Workflow Does Not Trigger

**Cause**: Tag does not match the trigger pattern (`sdk-js-v*` or `sdk-py-v*`).

**Fix**:
1. Verify the tag matches the pattern exactly (e.g., `sdk-js-v1.2.3`, not `sdk-js-1.2.3` or `js-sdk-v1.2.3`)
2. Delete the incorrect tag locally and remotely:
   ```bash
   git tag -d incorrect-tag
   git push origin :refs/tags/incorrect-tag
   ```
3. Create the correct tag and push again

### Build Fails in Workflow

**Cause**: Missing dependencies, compilation errors, or test failures.

**Fix**:
1. Run the build locally to reproduce the error:
   ```bash
   # JavaScript
   cd sdk/js && npm ci && npm run build && npm run test

   # Python
   cd sdk/python && python -m build && python -m pytest
   ```
2. Fix the errors locally
3. Commit the fixes
4. Delete the failed tag and create a new one with the fixed code

---

## Release Checklist

Before publishing a new SDK version:

- [ ] Update `CHANGELOG.md` in the SDK directory
- [ ] Bump version number in package manifest
- [ ] Run tests locally and ensure they pass
- [ ] Run build locally and ensure it succeeds
- [ ] Commit version bump with conventional commit message
- [ ] Create version tag matching the package version
- [ ] Push commits to `main` branch
- [ ] Push version tag to trigger workflow
- [ ] Monitor GitHub Actions workflow for success
- [ ] Verify package appears on npm/PyPI
- [ ] Test installation of published package

---

## References

- npm Automation Tokens: https://docs.npmjs.com/creating-and-viewing-access-tokens
- PyPI API Tokens: https://pypi.org/help/#apitoken
- GitHub Actions Secrets: https://docs.github.com/en/actions/security-guides/encrypted-secrets
