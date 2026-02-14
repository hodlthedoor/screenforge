# NPM Publishing Instructions for @screenforge/sdk

## Status

✅ **Package prepared and ready to publish**
✅ **GitHub release v1.0.0 created**: https://github.com/hodlthedoor/atlas-project/releases/tag/v1.0.0
❌ **npm publish requires authentication**

## Prerequisites

You need to authenticate with npm first:

```bash
npm login
```

You'll be prompted for:
- Username
- Password
- Email
- One-time password (if 2FA is enabled)

## Publishing Steps

1. **Authenticate with npm** (one-time):
   ```bash
   npm login
   # Follow prompts to authenticate
   ```

2. **Verify authentication**:
   ```bash
   npm whoami
   # Should print your npm username
   ```

3. **Navigate to SDK directory**:
   ```bash
   cd /home/sam/atlas-project/screenforge/sdk/js
   ```

4. **Verify package builds**:
   ```bash
   npm run build
   npm run typecheck
   npm test
   ```

5. **Test package artifact** (optional but recommended):
   ```bash
   npm pack --dry-run
   ```

6. **Publish to npm**:
   ```bash
   npm publish --access public
   ```

   The `--access public` flag is required for scoped packages (@screenforge/sdk) unless you have a paid npm org.

## Verification

After publishing, verify the package is live:

```bash
# Check version
npm view @screenforge/sdk version

# Check dist tags
npm view @screenforge/sdk dist-tags

# Check full metadata
npm view @screenforge/sdk --json

# Test install in a temp directory
cd /tmp
mkdir test-sdk && cd test-sdk
npm init -y
npm install @screenforge/sdk
node -e "import('@screenforge/sdk').then(m => console.log('ESM works:', Object.keys(m)))"
node -e "const m = require('@screenforge/sdk'); console.log('CJS works:', Object.keys(m))"
```

## Package Details

- **Name**: `@screenforge/sdk`
- **Version**: `1.0.0`
- **License**: MIT
- **Repository**: https://github.com/hodlthedoor/atlas-project
- **Homepage**: https://github.com/hodlthedoor/atlas-project/tree/main/sdk/js#readme
- **Keywords**: screenshot, api, pdf, og-image, puppeteer, playwright, render, screenforge

## What's Included in the Package

The published package includes:
- `dist/` — Built ESM, CJS, and TypeScript definitions
- `README.md` — SDK documentation
- `LICENSE` — MIT license text
- `package.json` — Package metadata

Source files (`src/`, `tests/`, config files) are excluded from the published package.

## Troubleshooting

### Error: 403 Forbidden

You may not have permission to publish to the `@screenforge` scope. Options:
1. Create the `@screenforge` organization on npm
2. Publish under a different scope you own (e.g., `@your-username/screenforge-sdk`)
3. Publish as an unscoped package (change name to `screenforge-sdk`)

### Error: Version already exists

If `1.0.0` is already published, you cannot overwrite it. Bump the version:
```bash
npm version patch  # 1.0.0 → 1.0.1
# or
npm version minor  # 1.0.0 → 1.1.0
```

Then commit, tag, and push:
```bash
git add package.json
git commit -m "chore(sdk): bump version to $(node -p require('./package.json').version)"
git tag -a v$(node -p require('./package.json').version) -m "v$(node -p require('./package.json').version)"
git push origin main --tags
npm publish --access public
```

## Post-Publish Tasks

After successful publish:
1. Update main README with installation instructions
2. Announce on social media / product channels
3. Consider setting up npm provenance (attaches GitHub Actions metadata to package)
4. Monitor npm stats: https://www.npmjs.com/package/@screenforge/sdk

## Notes

- This is a **public package** with MIT license
- Published packages are **immutable** — you cannot delete or overwrite versions
- Be careful with credentials in test/example code
- The package supports both ESM (`import`) and CJS (`require`)
