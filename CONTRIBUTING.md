# Contributing

## Setup

```sh
git clone https://github.com/Vignesh12041992/smart-router.git
cd smart-router
npm install
```

## Everyday commands

| Command             | What it does                          |
|---------------------|---------------------------------------|
| `npm run build`     | Compile TypeScript into `dist/`       |
| `npm run dev`       | Rebuild on every save                 |
| `npm run typecheck` | Check types without building          |
| `npm test`          | Build and run all tests               |
| `npm start`         | Build and open the dashboard          |
| `npm run clean`     | Delete `dist/`                        |
| `npm link`          | Use your local copy as `smart-router` |

`dist/` is committed so installs from GitHub work. Run `npm run build` before you commit.

## Pull requests

1. Make a branch.
2. Add or update tests in `tests/`.
3. Run `npm test`.
4. Open a pull request. CI runs on Linux, macOS and Windows.

## Releasing

1. Set the same new version in `package.json`, `python/pyproject.toml` and
   `python/smart_router_cli/__init__.py`. A test checks that they match.
2. Add a line to `CHANGELOG.md`.
3. Run `npm install` (updates `package-lock.json`) and `npm test`, then commit.
4. Tag and push: `git tag v1.0.1 && git push origin v1.0.1`.

The **Release** workflow then publishes to npm and PyPI. It needs, one time:
- an `NPM_TOKEN` repository secret (an npm "automation" token), and
- a PyPI trusted publisher for this repo and the `release.yml` workflow.
