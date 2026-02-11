module.exports = {
  daemon: true,
  run: [{
    method: "shell.run",
    params: {
      env: {
        OLLAMA_API_KEY: "ollama-local",
        OPENCLAW_GATEWAY_TOKEN: "pinokio-local-token"
      },
      path: "app",
      message: [
        "openclaw config set agents.defaults.sandbox.mode off",
        "node server.js --port {{port}}"
      ],
      on: [{
        event: "/(http:\\/\\/[0-9.:]+)/",
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
