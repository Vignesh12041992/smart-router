# Changelog

## Unreleased

- New proxy endpoints for coding tools: `POST /v1/chat/completions` (OpenAI), `POST /v1/messages` (Anthropic / Claude Code), `GET /v1/models`.
- Claude Code uses its own login by default: only the model changes (Haiku / Sonnet / Opus per tier). No extra key.
- OpenAI-format requests are routed to a tier, then forwarded to OpenRouter with streaming.
- Conversation memory, on by default with no setup: when Smart Router switches models mid-conversation, the new model is handed the earlier turns. Long conversations are kept within `SMART_ROUTER_MEMORY_TOKENS` (default 2000) by a running summary that the micro-tier model writes in the background. `SMART_ROUTER_MEMORY=off` turns it off; `OMNIROUTE_URL` optionally stores it in an OmniRoute server.
- Laya is no longer installed with the package. Install size drops from ~300 MB to ~5 MB. `smart-router download` installs it on demand.

## 1.0.0

- New `smart-router` command: `route`, `run`, `serve`, `models`, `download`, `doctor`, `version`.
- Install with npm, npx, pnpm, yarn, bun, pipx, pip or uv.
- Two routing engines: Laya (AI model) and keyword (offline, no download).
- The Laya model (~1.7 GB) is downloaded only when you ask for it, once per computer.
- Detects your installed Ollama models.
- Removed EverOS and Floci.
