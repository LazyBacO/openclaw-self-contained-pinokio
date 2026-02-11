module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: "git pull"
      }
    },
    {
      method: "shell.run",
      params: {
        message: "npm i -g openclaw@latest"
      }
    },
    {
      method: "shell.run",
      when: "{{which('ollama')}}",
      params: {
        message: "ollama pull gpt-oss:20b"
      }
    },
    {
      method: "shell.run",
      params: {
        env: {
          OLLAMA_API_KEY: "ollama-local"
        },
        message: [
          "openclaw models set ollama/gpt-oss:20b"
        ]
      }
    }
  ]
}
