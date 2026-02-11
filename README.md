# OpenClaw Finance Copilot (Pinokio Launcher)

This project provides a local Finance Copilot app integrated with OpenClaw agents.

You manually enter:
- CAD account balances
- account types (TFSA, RRSP, cash, etc.)
- stock holdings (symbol, shares, average cost, current price)

Then two OpenClaw agents collaborate:
- `strategist`: first strategy draft + questions
- `builder`: implementation feedback + risks
- `strategist` again: final synthesis plan

All outputs are educational only (not professional financial advice).

## How To Use

1. Open this project in Pinokio.
2. Run `Install` once.
3. Launch `Finance Copilot` from the menu.
4. Add your portfolio data in CAD.
5. (Optional) Configure `GitHub Auto Save`:
   - Enable auto save every 30 minutes
   - Set remote/branch
   - Set Strategist + Builder commit identities
   - Keep consultation enabled so they review each save together
6. Click `Save portfolio`.
7. Click `Generate collaborative strategy`.
8. Review 3 outputs:
   - Strategist round 1
   - Builder round 1
   - Strategist final synthesis

## Menu Scripts

- `install.json`
  - Installs/updates OpenClaw CLI
  - Installs Ollama if missing
  - Pulls `gpt-oss:20b`
  - Configures OpenClaw for local usage
- `finance.js`
  - Sets `agents.defaults.sandbox.mode=off` for local no-Docker agent turns
  - Runs the Finance Copilot server (`app/server.js`)
  - Captures and exposes web URL to Pinokio UI
  - Supports GitHub auto-save every 30 minutes (`git add/commit/push`)
  - Alternates commit author turn-by-turn: Strategist -> Builder -> Strategist -> ...
  - Optional consultation: active agent proposes commit focus, other agent reviews
- `start.js`
  - Starts OpenClaw gateway + dashboard
- `update.js`
  - Updates launcher + OpenClaw model config

## App API

Base URL is the Finance Copilot URL shown by Pinokio, usually `http://127.0.0.1:<port>`.

### Endpoints

- `GET /api/health`
- `GET /api/portfolio`
- `POST /api/portfolio`
- `POST /api/strategy`
- `GET /api/autosave`
- `POST /api/autosave`
- `POST /api/autosave/run`

`POST /api/portfolio` expects:

```json
{
  "portfolio": {
    "owner": "Alex",
    "objective": "Grow CAD capital with controlled risk",
    "accounts": [
      {
        "id": "acc-1",
        "name": "Main TFSA",
        "type": "TFSA",
        "balanceCad": 15000
      }
    ],
    "holdings": [
      {
        "id": "stk-1",
        "symbol": "RY.TO",
        "shares": 25,
        "avgCostCad": 129.5,
        "currentPriceCad": 138.2,
        "accountType": "TFSA"
      }
    ],
    "gitAutoSave": {
      "enabled": true,
      "remote": "origin",
      "branch": "main",
      "consultBetweenAgents": true,
      "nextAgentId": "strategist",
      "agents": {
        "strategist": {
          "id": "strategist",
          "name": "Strategist",
          "email": "strategist@users.noreply.github.com"
        },
        "builder": {
          "id": "builder",
          "name": "Builder",
          "email": "builder@users.noreply.github.com"
        }
      },
      "commitPrefix": "finance-autosave"
    }
  }
}
```

`POST /api/strategy` expects:

```json
{
  "goal": "Optional goal override",
  "riskProfile": "balanced",
  "horizonMonths": 24
}
```

## Programmatic Access

### JavaScript (Node.js)

```javascript
const baseUrl = "http://127.0.0.1:3199";

async function main() {
  const saveResponse = await fetch(`${baseUrl}/api/portfolio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      portfolio: {
        owner: "Alex",
        objective: "Long term CAD growth",
        accounts: [{ id: "acc-1", name: "TFSA", type: "TFSA", balanceCad: 12000 }],
        holdings: [{ id: "stk-1", symbol: "AAPL", shares: 10, avgCostCad: 210, currentPriceCad: 235, accountType: "TFSA" }]
      }
    })
  });
  const saveJson = await saveResponse.json();
  console.log("Saved owner:", saveJson.portfolio.owner);

  const strategyResponse = await fetch(`${baseUrl}/api/strategy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ riskProfile: "balanced", horizonMonths: 24 })
  });
  const strategyJson = await strategyResponse.json();
  console.log(strategyJson.strategy.rounds.strategistFinal);
}

main().catch(console.error);
```

### Python

```python
import requests

base_url = "http://127.0.0.1:3199"

portfolio_payload = {
    "portfolio": {
        "owner": "Alex",
        "objective": "Long term CAD growth",
        "accounts": [
            {"id": "acc-1", "name": "TFSA", "type": "TFSA", "balanceCad": 12000}
        ],
        "holdings": [
            {
                "id": "stk-1",
                "symbol": "AAPL",
                "shares": 10,
                "avgCostCad": 210,
                "currentPriceCad": 235,
                "accountType": "TFSA"
            }
        ]
    }
}

r1 = requests.post(f"{base_url}/api/portfolio", json=portfolio_payload, timeout=30)
r1.raise_for_status()

r2 = requests.post(
    f"{base_url}/api/strategy",
    json={"riskProfile": "balanced", "horizonMonths": 24},
    timeout=600
)
r2.raise_for_status()
print(r2.json()["strategy"]["rounds"]["strategistFinal"])
```

### Curl

```bash
curl -s http://127.0.0.1:3199/api/portfolio \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"portfolio":{"owner":"Alex","objective":"Long term CAD growth","accounts":[{"id":"acc-1","name":"TFSA","type":"TFSA","balanceCad":12000}],"holdings":[{"id":"stk-1","symbol":"AAPL","shares":10,"avgCostCad":210,"currentPriceCad":235,"accountType":"TFSA"}]}}'

curl -s http://127.0.0.1:3199/api/strategy \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"riskProfile":"balanced","horizonMonths":24}'

curl -s http://127.0.0.1:3199/api/autosave \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"gitAutoSave":{"enabled":true,"remote":"origin","branch":"main","consultBetweenAgents":true,"nextAgentId":"strategist","agents":{"strategist":{"id":"strategist","name":"Strategist","email":"strategist@users.noreply.github.com"},"builder":{"id":"builder","name":"Builder","email":"builder@users.noreply.github.com"}},"commitPrefix":"finance-autosave"}}'

curl -s http://127.0.0.1:3199/api/autosave/run \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{}'
```
