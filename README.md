# Smart Router

[![CI](https://github.com/Vignesh12041992/smart-router/actions/workflows/ci.yml/badge.svg)](https://github.com/Vignesh12041992/smart-router/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Smart Router picks the right model for each prompt, so simple prompts use cheap, fast models
and hard prompts use strong ones.

It runs on your computer and sits between your coding tool and the model provider:

```text
Claude Code / Copilot / Devin / your app
            │
            ▼
   Smart Router (localhost:3000)   ← reads the prompt, picks a tier
            │
            ├─ "hey", "what is 1+1?"          → micro    → Claude Haiku
            ├─ "fix this TypeScript bug"      → coder    → Claude Sonnet
            ├─ "prove this step by step"      → reasoner → Claude Opus
            └─ "write a summary"              → general  → Claude Sonnet
            │
            ▼
   Anthropic (your own login) · OpenRouter · local Ollama
```

- **Claude Code needs no extra key.** It keeps using your normal login.
- **Context is never lost when the model changes.** The next model gets the whole conversation.
- **Built-in memory** for tools that send one message at a time, kept small by a running summary.
- **Works offline** with the keyword engine. An optional AI engine (Laya) is available.
- Works on **Windows**, **macOS** and **Linux**. Needs [Node.js](https://nodejs.org) 20 or newer.

## Contents

- [Quick start with Claude Code](#quick-start-with-claude-code)
- [How routing works](#how-routing-works)
- [Switching models keeps the context](#switching-models-keeps-the-context)
- [Other tools (OpenAI format)](#other-tools-openai-format)
- [Memory for one-message-at-a-time clients](#memory-for-one-message-at-a-time-clients)
- [Local models with Ollama](#local-models-with-ollama)
- [Install](#install)
- [Commands](#commands)
- [Settings](#settings)
- [HTTP API](#http-api)
- [Use it as a library](#use-it-as-a-library)
- [Engines and the Laya model](#engines-and-the-laya-model)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Quick start with Claude Code

**1. Install** (the npm package is not published yet, so install from GitHub):

```sh
npm install -g https://github.com/Vignesh12041992/smart-router/tarball/main
```

**2. Start Smart Router** in one terminal, and leave it open:

```sh
smart-router serve
```

**3. Start Claude Code through it** in a second terminal:

```sh
export ANTHROPIC_BASE_URL=http://localhost:3000     # Windows PowerShell: $env:ANTHROPIC_BASE_URL="http://localhost:3000"
claude
```

`export` lasts only for that terminal. Close it, and `claude` goes straight to Anthropic again.

**4. Check it works.** Each prompt prints a line in the first terminal:

```text
[smart-router] claude micro claude-opus-5-5 -> claude-haiku-4-5 (stream)
```

That reads: tier `micro`; Claude Code asked for Opus; Smart Router sent it to Haiku.

**Make it permanent (optional).** Add this to `~/.claude/settings.json`:

```json
{ "env": { "ANTHROPIC_BASE_URL": "http://localhost:3000" } }
```

Then plain `claude` always goes through Smart Router. Claude Code will not work while
`smart-router serve` is stopped, so remove the line to go back.

**Just testing from a clone?** Skip the global install:

```sh
git clone https://github.com/Vignesh12041992/smart-router.git
cd smart-router
npm install
node dist/cli.js serve
```

## How routing works

Smart Router reads your **latest typed message** and puts it in one of four tiers:

| Tier | Example prompts | Claude Code model | Change with |
| --- | --- | --- | --- |
| `micro` | "hey", "thanks", "what is 1+1?" | `claude-haiku-4-5` | `SMART_ROUTER_CLAUDE_MICRO_MODEL` |
| `coder` | "fix this TypeScript bug" | `claude-sonnet-5-5` | `SMART_ROUTER_CLAUDE_CODER_MODEL` |
| `reasoner` | "prove this step by step" | `claude-opus-5-5` | `SMART_ROUTER_CLAUDE_REASONER_MODEL` |
| `general` | "write a summary", everything else | `claude-sonnet-5-5` | `SMART_ROUTER_CLAUDE_GENERAL_MODEL` |

Example: send coding prompts to Opus too.

```sh
SMART_ROUTER_CLAUDE_CODER_MODEL=claude-opus-5-5 smart-router serve
```

Details that keep routing correct:

- **One model per task.** While Claude Code works through a task's tool calls, the tier stays the
  one picked for your message.
- **Hidden context is ignored.** Claude Code adds `<system-reminder>` blocks (CLAUDE.md, todo
  lists) to your message. They are not routed, so "hey" stays `micro`.
- **Claude Code's own background calls** (Haiku for titles and summaries) are left alone.
- **Requests are adjusted to fit Haiku.** Claude Code shapes each request for the model you chose.
  When Smart Router sends it to Haiku instead, it caps output at 64K tokens and leaves out
  adaptive thinking and `effort`, which Haiku does not accept.
- **Long conversations skip Haiku.** Haiku has a 200K token window. A conversation over about
  130K tokens goes to the `general` model instead, and the log says so.

## Switching models keeps the context

Claude Code sends the **whole conversation** with every request. So when Smart Router moves from
Opus to Haiku and back, each model sees everything: your prompts, earlier answers, tool calls and
file contents. Nothing is cut.

Two things to know:

- **Hidden reasoning stays with its model.** Opus's private thinking stays in the history, but
  other models ignore it. Haiku sees Opus's answers, not how Opus got there.
- **Each model has its own cache.** The first prompt on a new model reads the conversation at full
  price. On Haiku that is usually a few cents.

## Other tools (OpenAI format)

Copilot, Devin, Cursor, Continue, Aider and most chat apps speak the OpenAI format. Smart Router
forwards them to [OpenRouter](https://openrouter.ai), which needs a key:

```sh
export OPENROUTER_API_KEY=sk-or-...       # https://openrouter.ai/keys
smart-router serve
```

In the tool, set:

- **Base URL:** `http://localhost:3000/v1`
- **Model:** `smart-router/auto`

Tier models default to `openrouter/free`. Change them with `SMART_ROUTER_<TIER>_MODEL`, for example
`SMART_ROUTER_CODER_MODEL=qwen/qwen3-coder:free`. A full OpenRouter id such as
`anthropic/claude-sonnet-4` is used as is, without routing.

Copilot and Devin sign in to their own services, and Smart Router cannot use those logins. They
work only where the tool lets you set a custom OpenAI-compatible endpoint and key.

To send Claude Code to OpenRouter as well, set `SMART_ROUTER_CLAUDE_PROVIDER=openrouter`.

## Memory for one-message-at-a-time clients

Some clients send only the new message, not the conversation. Examples: the dashboard, simple
scripts, some API callers. For them, Smart Router remembers the conversation and hands it to
whichever model answers next.

It is **on by default and needs no setup**: no extra server, URL or key.

1. After each answer, the prompt and reply are saved for that conversation (session).
2. When a request arrives without earlier turns, they are added back as normal messages.
3. Each request gets at most `SMART_ROUTER_MEMORY_TOKENS` (default 2000) tokens of earlier context:
   - Short conversations go over word for word.
   - Past the budget, older turns are folded into a **running summary** (goals, decisions,
     facts, names, file names, open questions). Recent turns stay word for word.
   - The summary is written by the cheap micro-tier model with the request's own login or key,
     in the background after the reply, so it never slows an answer.
   - If a summary fails, the oldest turns are left out, so the budget still holds.

Clients that send the whole conversation, such as Claude Code, get nothing added and never trigger
a summary.

**Sessions.** A session is one conversation. It comes from, in order: the `X-Smart-Router-Session`
header, Claude Code's conversation id, the OpenAI `user` field, or else the client's address.
Send your own `X-Smart-Router-Session` to keep conversations apart.

**Storage.** Memory lives inside the Smart Router process. It is cleared on restart, and sessions
idle for 6 hours are dropped. To share memory between several Smart Router processes, point
`OMNIROUTE_URL` at an [OmniRoute](https://github.com/diegosouzapw/OmniRoute) server.

Turn memory off with `SMART_ROUTER_MEMORY=off`.

## Local models with Ollama

Smart Router can also pick from your installed [Ollama](https://ollama.com) models, with no cloud
at all.

```console
$ smart-router route "write a python function to reverse a linked list"
Model:       qwen2.5-coder:7b
Tier:        coder
Complexity:  1.46 / 3
Confidence:  83.3%
Engine:      keyword
```

```sh
smart-router run "explain recursion simply"   # route, then stream the answer from Ollama
smart-router serve                            # dashboard at http://localhost:3000
```

For local models, each tier looks for models named like this:

| Tier | Looks for |
| --- | --- |
| `micro` | `phi`, `gemma`, `llama3.2:1b` |
| `coder` | `coder`, `code`, `qwen` |
| `reasoner` | `deepseek-r1`, `r1`, `reasoning` |
| `general` | `llama3`, `mistral`, `latest` |

If nothing matches, it uses your first model. Routing works even when Ollama is off; only `run`
and the dashboard need it.

## Install

You need [Node.js](https://nodejs.org) 20 or newer.

**From GitHub** (recommended until the npm release):

```sh
npm install -g https://github.com/Vignesh12041992/smart-router/tarball/main
pipx install "git+https://github.com/Vignesh12041992/smart-router.git#subdirectory=python"
```

Use the full `https://.../tarball/...` link. The short `github:user/repo` form breaks global npm
installs.

**From source:**

```sh
git clone https://github.com/Vignesh12041992/smart-router.git
cd smart-router
npm install
npm link        # optional: makes `smart-router` point at this copy
```

**After the npm and PyPI release** (not published yet):

```sh
npm install -g laya-smart-router      # or: npx laya-smart-router serve
pipx install laya-smart-router        # or: uv tool install laya-smart-router
```

The Python package is a small wrapper. On first run it installs the matching npm package into a
private folder.

**Windows:** everything works the same in cmd, PowerShell and Git Bash. If PowerShell says running
scripts is disabled, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**Update or remove:** run the same install command again to update.
Remove with `npm uninstall -g laya-smart-router` or `pipx uninstall laya-smart-router`.

## Commands

| Command | What it does |
| --- | --- |
| `smart-router serve` | Start the proxy and the dashboard at http://localhost:3000 |
| `smart-router route "<prompt>"` | Show which tier and model fit a prompt |
| `smart-router run "<prompt>"` | Route a prompt, then stream the answer from Ollama |
| `smart-router models` | List your installed Ollama models |
| `smart-router doctor` | Check Node.js, Ollama, keys, memory and the Laya model |
| `smart-router download` | Install the optional Laya AI engine (~2 GB, one time) |
| `smart-router version` | Show the version |

Common options:

| Option | Default |
| --- | --- |
| `-p, --port <number>` (serve) | `3000`, or `$PORT` |
| `--host <address>` (serve) | `127.0.0.1` |
| `-e, --engine <auto\|laya\|keyword>` | `auto` |
| `--ollama-url <url>` | `$OLLAMA_HOST` or `http://localhost:11434` |
| `--json` (route) | off |
| `-q, --quiet` | off |

The prompt can also come from a pipe: `echo "fix my python bug" | smart-router route`.

## Settings

All settings are optional environment variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `SMART_ROUTER_CLAUDE_<TIER>_MODEL` | see [tiers](#how-routing-works) | Claude model per tier for Claude Code |
| `SMART_ROUTER_CLAUDE_PROVIDER` | `anthropic` | `openrouter` sends Claude Code to OpenRouter |
| `OPENROUTER_API_KEY` | — | Key for OpenAI-format tools |
| `SMART_ROUTER_<TIER>_MODEL` | `openrouter/free` | OpenRouter model per tier |
| `SMART_ROUTER_MEMORY` | on | `off` turns memory off |
| `SMART_ROUTER_MEMORY_TOKENS` | `2000` | Most tokens of earlier context per request |
| `OMNIROUTE_URL`, `OMNIROUTE_API_KEY` | — | Keep memory in an OmniRoute server |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama address |
| `PORT` | `3000` | Port for `serve` |
| `LAYA_CACHE` | `~/.cache/receptron-laya` | Where the Laya model is stored |
| `HF_TOKEN` | — | Hugging Face token, if the Laya download needs one |
| `SMART_ROUTER_HOME`, `SMART_ROUTER_NPM_SPEC` | — | Python wrapper: install folder, package to install |

`<TIER>` is `MICRO`, `CODER`, `REASONER` or `GENERAL`.

## HTTP API

`smart-router serve` exposes:

| Method | Path | For |
| --- | --- | --- |
| `POST` | `/v1/messages` | Anthropic format (Claude Code) |
| `POST` | `/v1/messages/count_tokens` | Claude Code token counts |
| `POST` | `/v1/chat/completions` | OpenAI format (Copilot, Devin, Cursor, ...) |
| `GET` | `/v1/models` | Model list, including `smart-router/auto` |
| `POST` | `/api/route` with `{"prompt": "..."}` | The routing decision only |
| `GET` | `/api/stream?model=...&prompt=...&session=...` | Dashboard answer from Ollama (Server-Sent Events) |
| `GET` | `/api/status` | Engine, Ollama status, models, memory mode |

Every routed response carries headers that show what happened:

| Header | Meaning |
| --- | --- |
| `X-Smart-Router-Tier` | Tier picked, or `manual` when the client named a model |
| `X-Smart-Router-Model` | Model the request was sent to |
| `X-Smart-Router-Session` | Conversation the request belongs to |
| `X-Smart-Router-Memory` | Earlier turns added, e.g. `2+summary` |

```sh
curl -X POST http://localhost:3000/api/route \
  -H "Content-Type: application/json" \
  -d '{"prompt": "write a bash script"}'
```

## Use it as a library

```js
import { IntelligentRouter } from "laya-smart-router";

const router = new IntelligentRouter({ engine: "keyword" });
await router.init();
const decision = await router.processRequest("debug my rust code");
console.log(decision.tier, decision.modelName);   // "coder" "qwen2.5-coder:7b"
```

Also exported: `startServer`, `createApp`, `mountProxy`, `classifyWithKeywords`, `ROUTING_TIERS`,
`claudeModels`, `openRouterModels`, `fitToClaudeModel`, `estimateTokens`, `lastUserText`,
`ConversationMemory`, `LocalStore`, `OmniRouteStore`, `memoryFromEnv`, `listOllamaModels`,
`streamOllama`.

## Engines and the Laya model

| Engine | What it does |
| --- | --- |
| `auto` (default) | Laya if it is already downloaded, else `keyword` |
| `keyword` | Fast word matching. Offline. No download. |
| `laya` | [Laya](https://huggingface.co/convaiinnovations/laya), a small AI decision model |

Laya is never downloaded on install. Run `smart-router download` once to get it (~2 GB). It is
stored once per computer in `~/.cache/receptron-laya`, needs about 2.5 GB of free RAM, and every
install reuses it.

## Troubleshooting

Start with `smart-router doctor`.

| Problem | Fix |
| --- | --- |
| `npm error 404` on install | The npm release is not out yet. [Install from GitHub](#install). |
| `smart-router: command not found` | Open a new terminal. Check `npm prefix -g` is on your PATH. |
| Claude Code: `max_tokens: 128000 > 64000 ... claude-haiku-4-5` | Update Smart Router; requests sent to Haiku are now adjusted. |
| "hey" goes to Sonnet, not Haiku | Update Smart Router. If the log says "too long for Haiku", the chat is over ~130K tokens; that is expected. |
| Claude Code cannot connect | `smart-router serve` must be running. Or remove `ANTHROPIC_BASE_URL`. |
| OpenAI-format tool gets `401` | Set `OPENROUTER_API_KEY`, or enter your OpenRouter key in the tool. |
| `Ollama not reachable` | Run `ollama serve`, or pass `--ollama-url`. |
| Ollama has no models | `ollama pull llama3` (and e.g. `ollama pull qwen2.5-coder:7b`). |
| `EACCES` during `npm install -g` | Don't use `sudo`. Use nvm/fnm/volta, or `npm config set prefix ~/.npm-global`. |
| `onnxruntime-node` fails to install | Set `ONNXRUNTIME_NODE_INSTALL=skip` and install again. |

## Development

```sh
npm install
npm test        # build + run all tests
npm run dev     # rebuild on save
```

`dist/` is committed so installs from GitHub work; run `npm run build` before you commit. See
[CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
