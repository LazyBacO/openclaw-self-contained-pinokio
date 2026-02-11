module.exports = {
  version: "5.0",
  menu: async (kernel, info) => {
    let running = {
      install: info.running("install.json"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      uninstall: info.running("uninstall.js")
    }
    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.json",
      }]
    }
    if (running.start) {
      let local = info.local("start.js")
      if (local && local.url) {
        return [{
          default: true,
          icon: "fa-solid fa-rocket",
          text: "Open Dashboard",
          href: local.url,
        }, {
          icon: "fa-solid fa-terminal",
          text: "Terminal",
          href: "start.js",
        }]
      }
      return [{
        default: true,
        icon: "fa-solid fa-terminal",
        text: "Starting",
        href: "start.js",
      }]
    }
    if (running.update) {
      return [{
        default: true,
        icon: "fa-solid fa-arrows-rotate",
        text: "Updating",
        href: "update.js",
      }]
    }
    if (running.uninstall) {
      return [{
        default: true,
        icon: "fa-regular fa-trash-can",
        text: "Uninstalling",
        href: "uninstall.js",
      }]
    }
    return [{
      default: true,
      icon: "fa-solid fa-circle-play",
      text: "Start",
      href: "start.js",
    }, {
      icon: "fa-solid fa-plug",
      text: "Install",
      href: "install.json",
    }, {
      icon: "fa-solid fa-arrows-rotate",
      text: "Update",
      href: "update.js",
    }, {
      icon: "fa-regular fa-trash-can",
      text: "Uninstall",
      href: "uninstall.js",
    }]
  }
}
