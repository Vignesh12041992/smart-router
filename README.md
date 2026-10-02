# Smart Router

[![CI](https://github.com/Vignesh12041992/smart-router/actions/workflows/ci.yml/badge.svg)](https://github.com/Vignesh12041992/smart-router/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/laya-smart-router)](https://www.npmjs.com/package/laya-smart-router)
[![PyPI](https://img.shields.io/pypi/v/laya-smart-router)](https://pypi.org/project/laya-smart-router/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pick the best local [Ollama](https://ollama.com) model for any prompt.

Smart Router reads your prompt, works out what kind of task it is (chat, code, reasoning or
writing), rates how complex it is, and picks the best model you have installed.

```console
$ smart-router route "write a python function to reverse a linked list"
Model:       qwen2.5-coder:7b
Tier:        coder
Complexity:  1.46 / 3
Confidence:  83.3%
Engine:      keyword
```

- Works on **Windows** (cmd, PowerShell, Git Bash), **macOS** and **Linux**.
- Install with **npm, npx, pnpm, yarn, bun, pipx, pip or uv**.
- Routing works even when Ollama is off.
- Optional AI routing with [Laya](https://huggingface.co/convaiinnovations/laya), a small decision
  model that does not generate text, so it is fast.

## Contents

- [Use it with Claude Code, Copilot or Devin](#use-it-with-claude-code-copilot-or-devin)
- [Quick start](#quick-start)
- [Install](#install)
- [Commands](#commands)
- [Engines and the Laya model](#engines-and-the-laya-model)
- [Options and environment variables](#options-and-environment-variables)
- [Web dashboard and HTTP API](#web-dashboard-and-http-api)
- [Use it as a library](#use-it-as-a-library)
- [Update and uninstall](#update-and-uninstall)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Use it with Claude Code, Copilot or Devin

Smart Router sits between your coding tool and the model provider. For each prompt it picks a
model (small, coding, or reasoning) and forwards the request. Answers stream back.

### Claude Code: no extra key

```sh
npx laya-smart-router serve                 # ~5 MB install, no model download
ANTHROPIC_BASE_URL=http://localhost:3000 claude
```

Claude Code keeps using **your normal login** (Claude subscription or API key). Smart Router only
changes the `model` field, then sends the request to Anthropic with your own credentials.

| Tier | Example prompt | Default model |
| --- | --- | --- |
| micro | "hi", "thanks" | `claude-haiku-4-5` |
| coder | "fix this TypeScript bug" | `claude-sonnet-5-5` |
| reasoner | "prove this step by step" | `claude-opus-5-5` |
| general | "write a summary" | `claude-sonnet-5-5` |

Change one with `SMART_ROUTER_CLAUDE_<TIER>_MODEL`, for example
`SMART_ROUTER_CLAUDE_REASONER_MODEL=claude-fable-5-1`.

- The model is picked from your latest typed message, so it stays the same while Claude Code works
  through that task's tool calls.
- Claude Code's own Haiku background calls (titles, summaries) are left alone.

### Other tools (OpenAI format): need an OpenRouter key

```sh
export OPENROUTER_API_KEY=sk-or-...         # https://openrouter.ai/keys
npx laya-smart-router serve
```

Set the tool's base URL to `http://localhost:3000/v1` and its model to `smart-router/auto`.
Tier models default to `openrouter/free`. Change them with `SMART_ROUTER_<TIER>_MODEL`.
To send Claude Code to OpenRouter too, set `SMART_ROUTER_CLAUDE_PROVIDER=openrouter`.

Copilot and Devin sign in to their own services, and Smart Router cannot borrow those logins.
They work only where the tool lets you set a custom OpenAI-compatible endpoint, with a key.

Endpoints: `POST /v1/messages`, `POST /v1/messages/count_tokens`, `POST /v1/chat/completions`,
`GET /v1/models`. Response headers `X-Smart-Router-Tier` and `X-Smart-Router-Model` show each decision.

The default engine is the offline keyword engine, so nothing large is downloaded.
The Laya AI engine is optional: `smart-router download` installs it (~2 GB) into `~/.smart-router`.

## Quick start

```sh
npm install -g laya-smart-router
smart-router doctor                        # check your setup
smart-router route "fix my java null pointer bug"
smart-router run "explain recursion simply"  # needs Ollama running
```

## Install

**You need [Node.js](https://nodejs.org) 20 or newer**, even for the pipx and pip installs.
[Ollama](https://ollama.com) is needed only to get answers (`run` and the dashboard), not to route.

### npm and other JavaScript package managers

```sh
npm install -g laya-smart-router     # npm
pnpm add -g laya-smart-router        # pnpm
yarn global add laya-smart-router    # yarn (v1)
bun add -g laya-smart-router         # bun
```

Run it once without installing:

```sh
npx laya-smart-router route "hello"
pnpm dlx laya-smart-router route "hello"
bunx laya-smart-router route "hello"
```

### Python tools

```sh
pipx install laya-smart-router                    # recommended for Python users
uv tool install laya-smart-router                 # uv
uvx --from laya-smart-router smart-router route "hello"   # run once with uv
pip install --user laya-smart-router              # plain pip
python -m smart_router_cli route "hello"          # if the command is not on your PATH
```

The Python package is a small wrapper. On first run it installs the matching npm package into a
private folder, then runs it. After that it starts instantly.

### Straight from GitHub (before the npm release, or for the latest code)

```sh
npm install -g https://github.com/Vignesh12041992/smart-router/tarball/main
pipx install "git+https://github.com/Vignesh12041992/smart-router.git#subdirectory=python"
```

Use the full `https://.../tarball/...` link. The short `github:user/repo` form breaks global npm
installs.

### From source

```sh
git clone https://github.com/Vignesh12041992/smart-router.git
cd smart-router
npm install
npm link            # makes `smart-router` point at your local copy
```

### Windows

All commands above work the same in **cmd**, **PowerShell** and **Git Bash**. npm creates
`smart-router.cmd` and `smart-router.ps1` for you.
If PowerShell says running scripts is disabled, run this once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Commands

| Command                           | What it does                                          |
|-----------------------------------|-------------------------------------------------------|
| `smart-router route "<prompt>"`   | Show which model fits the prompt                      |
| `smart-router run "<prompt>"`     | Route the prompt, then stream the answer from Ollama  |
| `smart-router serve`              | Start the web dashboard at http://localhost:3000      |
| `smart-router models`             | List your installed Ollama models                     |
| `smart-router download`           | Install the optional Laya AI engine (~2 GB, one time)  |
| `smart-router doctor`             | Check Node.js, Ollama and the Laya model              |
| `smart-router version`            | Show the version                                      |
| `smart-router --help`             | Show help                                             |

### Examples

```sh
# Route a prompt
smart-router route "prove that the square root of 2 is irrational"

# JSON output, for scripts
smart-router route --json "hello"

# Read the prompt from a pipe or a file
echo "summarize this article" | smart-router route
smart-router run < prompt.txt            # macOS / Linux / Git Bash
type prompt.txt | smart-router run       # Windows cmd
Get-Content prompt.txt | smart-router run   # PowerShell

# Force an engine
smart-router route -e keyword "hello"
smart-router route -e laya "hello"

# Use Ollama on another machine
smart-router run --ollama-url http://192.168.1.20:11434 "write a haiku"

# Dashboard on another port, reachable from your network
smart-router serve --port 8080 --host 0.0.0.0
```

`route --json` prints:

```json
{
  "tier": "coder",
  "modelName": "qwen2.5-coder:7b",
  "complexityScore": "1.43",
  "confidence": "100.0%",
  "engine": "keyword",
  "cached": false
}
```

### Tiers

| Tier       | Used for                                   | Looks for models named like      |
|------------|--------------------------------------------|----------------------------------|
| `micro`    | Greetings, chit-chat, short answers        | `phi`, `gemma`, `llama3.2:1b`    |
| `coder`    | Code, scripts, bugs                        | `coder`, `code`, `qwen`          |
| `reasoner` | Math, logic, multi-step reasoning          | `deepseek-r1`, `r1`, `reasoning` |
| `general`  | Writing, summaries, everything else        | `llama3`, `mistral`, `latest`    |

If none of your models match a tier, it uses your first model. If Ollama is off, it picks from
a default list (`phi:latest`, `qwen2.5-coder:7b`, `deepseek-r1:8b`, `llama3:latest`).

## Engines and the Laya model

| Engine            | What it does                                                       |
|-------------------|--------------------------------------------------------------------|
| `auto` (default)  | Uses Laya if it is already downloaded. Otherwise uses `keyword`.   |
| `laya`            | Always uses Laya. Downloads it first if needed.                    |
| `keyword`         | Fast word matching. Works offline. No download.                    |

**Do I have to download 1.7 GB every time I install?** No.

- Installing never downloads the model.
- The model is downloaded only when you run `smart-router download` or use `-e laya`.
- It is saved once per computer, in `~/.cache/receptron-laya`
  (on Windows: `C:\Users\<you>\.cache\receptron-laya`).
- Reinstalls, updates, `npx`, pipx and uv all reuse that same copy.
- Change the folder with the `LAYA_CACHE` environment variable.
- Laya needs about 2.5 GB of free RAM while running.

Want AI routing? Run this once:

```sh
smart-router download
```

## Options and environment variables

| Option                             | Env variable      | Default                  |
|------------------------------------|-------------------|--------------------------|
| `-e, --engine <auto\|laya\|keyword>`|                   | `auto`                   |
| `--ollama-url <url>`               | `OLLAMA_HOST`     | `http://localhost:11434` |
| `-p, --port <number>` (serve)      | `PORT`            | `3000`                   |
| `--host <address>` (serve)         |                   | `127.0.0.1`              |
| `--json` (route)                   |                   | off                      |
| `-q, --quiet`                      |                   | off                      |
|                                    | `LAYA_CACHE`      | `~/.cache/receptron-laya`|
|                                    | `HF_TOKEN`        | Hugging Face token, if needed |

Settings for the Python wrapper:

| Env variable            | What it does                                              |
|-------------------------|-----------------------------------------------------------|
| `SMART_ROUTER_HOME`     | Where the wrapper keeps its private npm install           |
| `SMART_ROUTER_NPM_SPEC` | Install a different npm package, tarball or URL           |

Exit codes: `0` success, `1` error (for example Ollama not reachable), `2` bad arguments.

## Web dashboard and HTTP API

```sh
smart-router serve
```

Open http://localhost:3000, type a prompt, and watch the answer stream in.

The same server has a small API:

| Method | Path                                  | Returns                                 |
|--------|---------------------------------------|-----------------------------------------|
| `GET`  | `/api/status`                         | Engine, Ollama status, model list       |
| `POST` | `/api/route` with `{"prompt": "..."}` | The routing decision (same as `--json`) |
| `GET`  | `/api/stream?model=...&prompt=...`    | The answer as Server-Sent Events        |

```sh
curl -X POST http://localhost:3000/api/route \
  -H "Content-Type: application/json" \
  -d '{"prompt": "write a bash script"}'
```

## Use it as a library

```sh
npm install laya-smart-router
```

```js
import { IntelligentRouter } from "laya-smart-router";

const router = new IntelligentRouter({ engine: "keyword" });
await router.init();
const decision = await router.processRequest("debug my rust code");
console.log(decision.modelName); // e.g. "qwen2.5-coder:7b"
```

Also exported: `classifyWithKeywords`, `listOllamaModels`, `streamOllama`, `createApp`,
`startServer`, `ROUTING_TIERS`.

## Update and uninstall

| Installed with | Update                                  | Uninstall                              |
|----------------|-----------------------------------------|----------------------------------------|
| npm            | `npm update -g laya-smart-router`       | `npm uninstall -g laya-smart-router`   |
| pnpm           | `pnpm update -g laya-smart-router`      | `pnpm remove -g laya-smart-router`     |
| yarn           | `yarn global upgrade laya-smart-router` | `yarn global remove laya-smart-router` |
| bun            | `bun update -g laya-smart-router`       | `bun remove -g laya-smart-router`      |
| pipx           | `pipx upgrade laya-smart-router`        | `pipx uninstall laya-smart-router`     |
| uv             | `uv tool upgrade laya-smart-router`     | `uv tool uninstall laya-smart-router`  |
| pip            | `pip install -U laya-smart-router`      | `pip uninstall laya-smart-router`      |

To also free the disk space used by the Laya model, delete `~/.cache/receptron-laya`.

## Troubleshooting

Start with `smart-router doctor`. It checks everything below.

| Problem | Fix |
|---------|-----|
| `npm error 404` on install | The npm release is not out yet. Install from GitHub (see above). |
| `smart-router: command not found` | Open a new terminal. For npm, check `npm prefix -g` is on your PATH. For pipx, run `pipx ensurepath`. |
| `Permission denied` on macOS/Linux | Update to the latest version, or reinstall. |
| `EACCES` during `npm install -g` | Don't use `sudo`. Use a Node version manager (nvm, fnm, volta) or `npm config set prefix ~/.npm-global`. |
| `Ollama not reachable` | Install Ollama and run `ollama serve`, or pass `--ollama-url`. |
| Ollama has no models | `ollama pull llama3` (and e.g. `ollama pull qwen2.5-coder:7b`). |
| `onnxruntime-node` fails to install | Set `ONNXRUNTIME_NODE_INSTALL=skip` and install again. Laya runs on the CPU, so nothing is lost. |
| Laya download fails | Check your internet access to `huggingface.co`, or use `-e keyword`. |
| pipx says Node.js is missing | Install Node.js 20+ from https://nodejs.org. |

## Development

```sh
npm install
npm test            # build + run all tests
npm run dev         # rebuild on save
npm start           # build + open the dashboard
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for all scripts and how to release, and
[CHANGELOG.md](CHANGELOG.md) for changes.

## License

[MIT](LICENSE)
