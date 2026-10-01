# Changelog

## Unreleased

- New proxy endpoints for coding tools: `POST /v1/chat/completions` (OpenAI), `POST /v1/messages` (Anthropic / Claude Code), `GET /v1/models`.
- Requests are routed to a tier, then forwarded to OpenRouter with streaming.
- Laya is no longer installed with the package. Install size drops from ~300 MB to ~5 MB. `smart-router download` installs it on demand.

## 1.0.0

- New `smart-router` command: `route`, `run`, `serve`, `models`, `download`, `doctor`, `version`.
- Install with npm, npx, pnpm, yarn, bun, pipx, pip or uv.
- Two routing engines: Laya (AI model) and keyword (offline, no download).
- The Laya model (~1.7 GB) is downloaded only when you ask for it, once per computer.
- Detects your installed Ollama models.
- Removed EverOS and Floci.
