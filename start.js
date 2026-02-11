module.exports = {
  daemon: true,
  run: [{
    method: "shell.run",
    params: {
      env: {
        OLLAMA_API_KEY: "ollama-local",
        OPENCLAW_GATEWAY_TOKEN: "pinokio-local-token"
      },
      message: [
        "openclaw config set gateway.mode local",
        "openclaw config set gateway.bind loopback",
        "openclaw models set ollama/gpt-oss:20b",
        "openclaw gateway run"
      ],
      on: [{
        event: "/listening on.*ws:\\/\\/([0-9.:]+)/",
        done: true
      }]
    }
  }, {
    method: "shell.run",
    params: {
      env: {
        OLLAMA_API_KEY: "ollama-local",
        OPENCLAW_GATEWAY_TOKEN: "pinokio-local-token"
      },
      message: [
        "openclaw dashboard --no-open"
      ],
      on: [{
        event: "/(http:\\/\\/[0-9.:]+\\S*)/",
        done: true
      }]
    }
  }, {
    method: "local.set",
    params: {
      url: "{{input.event[1]}}"
    }
  }]
}
