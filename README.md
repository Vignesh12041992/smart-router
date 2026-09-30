# Smart Router

Pick the best local [Ollama](https://ollama.com) model for any prompt.

It reads your prompt, decides what kind of task it is (chat, code, reasoning, or general writing),
rates how complex it is, and picks the best model you have installed. It uses
[Laya](https://huggingface.co/convaiinnovations/laya), a small System-1 decision model. It does not
generate text itself, so it is fast.

```sh
$ smart-router route "write a python function to reverse a linked list"
Model:       qwen2.5-coder:7b
Tier:        coder
Complexity:  1.46 / 3
Confidence:  83.3%
Engine:      laya
```

## Install

You need **Node.js 20+**. Pick one:

```sh
# npm (Windows cmd / PowerShell / Git Bash, macOS, Linux)
npm install -g laya-smart-router

# run once without installing
npx laya-smart-router route "hello"

# pipx (still needs Node.js 20+ installed)
pipx install laya-smart-router
```

Not published yet? Install straight from GitHub:

```sh
npm install -g github:vignesh12041992/smart-router
pipx install "git+https://github.com/vignesh12041992/smart-router.git#subdirectory=python"
```

## Use

```sh
smart-router route "fix my java null pointer bug"      # which model fits?
smart-router route --json "hello"                      # same, as JSON
echo "prove this theorem" | smart-router route         # prompt from a pipe
smart-router run "explain recursion simply"            # route, then answer with Ollama
smart-router serve                                     # web dashboard at http://localhost:3000
smart-router models                                    # list your Ollama models
smart-router download                                  # download the Laya model now
smart-router --help
```

### Engines

| Engine    | What it does                                                     |
|-----------|------------------------------------------------------------------|
| `auto`    | Default. Uses Laya. Falls back to `keyword` if Laya can't load.  |
| `laya`    | Always Laya. Fails with an error if it can't load.               |
| `keyword` | Fast word matching. Works offline, no download.                  |

Pick one with `-e`, for example `smart-router route -e keyword "hello"`.

The first Laya run downloads about 1.7 GB from Hugging Face into `~/.cache/receptron-laya`
(change it with `LAYA_CACHE`). Budget about 2.5 GB of free RAM.

### Settings

| Setting                          | Default                    |
|----------------------------------|----------------------------|
| `--ollama-url` or `OLLAMA_HOST`  | `http://localhost:11434`   |
| `--port` or `PORT` (serve)       | `3000`                     |
| `--host` (serve)                 | `127.0.0.1`                |

If Ollama is not running, `route` still works. It picks from a default model list.

## Develop

```sh
npm install
npm test          # build + run tests
npm start         # build + start the dashboard
```

Tip: set `ONNXRUNTIME_NODE_INSTALL=skip` before `npm install` to skip onnxruntime's optional GPU
download. Laya runs on the CPU.

### Publish

```sh
npm publish                                   # npm package: laya-smart-router
cd python && python -m build && twine upload dist/*   # PyPI package: laya-smart-router
```

Keep the version the same in `package.json`, `python/pyproject.toml` and
`python/smart_router_cli/__init__.py`. The pipx wrapper installs the npm package with that version.
