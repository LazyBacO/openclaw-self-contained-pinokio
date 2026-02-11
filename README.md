# OpenClaw (Self-Contained Local Launcher)

This launcher runs OpenClaw with a fully local model stack:

- OpenClaw gateway
- Ollama local runtime
- `gpt-oss:20b` model (default)

No LM Studio dependency is required.

## Install This Repo

### Prerequisites

- Pinokio installed on your machine
- Internet access for first-time installs (`openclaw`, `ollama`, and model download)

### Option A: Install via Pinokio (Recommended)

1. In Pinokio, add/download this repository:
   - `https://github.com/LazyBacO/openclaw-self-contained-pinokio`
2. Open the project in Pinokio.
3. Click `Install` once.
4. Wait for installation to finish (first model pull is large).

## Execute The Repo

1. Click `Install` in Pinokio.
2. Wait for:
   - OpenClaw CLI install/update
   - Ollama install (if missing)
   - `gpt-oss:20b` pull
   - OpenClaw config set to `ollama/gpt-oss:20b`
3. Click `Start`.
4. Open the `Open Dashboard` tab from the launcher.

If no Ollama models are detected, run `ollama serve` once in a terminal, then run `Install` again.

### Option B: Clone then open in Pinokio

```bash
git clone https://github.com/LazyBacO/openclaw-self-contained-pinokio.git
```

Then open that folder as a Pinokio project and run `Install`, then `Start`.

## What The Scripts Do

- `install.json`
  - Installs OpenClaw globally
  - Installs Ollama if needed
  - Runs non-interactive OpenClaw onboarding in local/loopback mode
  - Pulls `gpt-oss:20b`
  - Sets default model to `ollama/gpt-oss:20b`
- `start.js`
  - Forces local gateway mode + Ollama provider config
  - Starts OpenClaw gateway
  - Captures dashboard URL and exposes it to Pinokio UI
- `update.js`
  - Pulls launcher updates
  - Updates OpenClaw CLI
  - Refreshes local model + model config

## Programmatic Access

### JavaScript (Node.js)

```javascript
import { execSync } from "node:child_process";

// Gateway health as JSON
const health = execSync("openclaw gateway health --json", { encoding: "utf-8" });
console.log(JSON.parse(health));
```

### Python

```python
import json
import subprocess

out = subprocess.check_output(
    ["openclaw", "gateway", "health", "--json"],
    text=True
)
print(json.loads(out))
```

### Curl (Ollama Inference API)

```bash
curl -s http://127.0.0.1:11434/api/generate \
  -d '{"model":"gpt-oss:20b","prompt":"Summarize today tasks","stream":false}'
```
