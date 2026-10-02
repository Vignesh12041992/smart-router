# laya-smart-router (Python / pipx / uv)

Installs the `smart-router` command with Python tools. It picks the best local Ollama model for
any prompt.

This package is a thin wrapper around the `laya-smart-router` npm package, so
**Node.js 20+ must be installed**.

```sh
pipx install laya-smart-router        # or: uv tool install laya-smart-router
smart-router doctor
smart-router route "write a python function to sort a list"
```

On first run it installs the Node package into a private folder (no global npm install).
Later runs start instantly. The 1.7 GB Laya model is never downloaded unless you run
`smart-router download`.

Full docs: https://github.com/Vignesh12041992/smart-router#readme
