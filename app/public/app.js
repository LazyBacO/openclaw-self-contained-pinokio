"use strict";

const DEFAULT_GIT_AUTOSAVE = {
  enabled: false,
  remote: "origin",
  branch: "main",
  alternatingAgents: true,
  consultBetweenAgents: true,
  nextAgentId: "strategist",
  agents: {
    strategist: {
      id: "strategist",
      name: "Strategist",
      email: "strategist@users.noreply.github.com"
    },
    builder: {
      id: "builder",
      name: "Builder",
      email: "builder@users.noreply.github.com"
    }
  },
  commitPrefix: "finance-autosave",
  lastActorId: null,
  lastConsultation: null,
  lastRunAt: null,
  lastResult: null,
  lastError: null
};

const state = {
  portfolio: {
    currency: "CAD",
    owner: "",
    objective: "",
    accounts: [],
    holdings: [],
    gitAutoSave: { ...DEFAULT_GIT_AUTOSAVE },
    lastStrategy: null,
    updatedAt: null
  }
};

const currencyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 2
});

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCad(value) {
  return currencyFormatter.format(toNumber(value));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeGitAutoSave(input) {
  const source = input && typeof input === "object" ? input : {};
  const sourceAgents = source.agents && typeof source.agents === "object" ? source.agents : {};
  const strategist = sourceAgents.strategist && typeof sourceAgents.strategist === "object"
    ? sourceAgents.strategist
    : {};
  const builder = sourceAgents.builder && typeof sourceAgents.builder === "object"
    ? sourceAgents.builder
    : {};

  const strategistName = String(
    strategist.name || source.agentName || DEFAULT_GIT_AUTOSAVE.agents.strategist.name
  ).trim() || DEFAULT_GIT_AUTOSAVE.agents.strategist.name;
  const strategistEmail = String(
    strategist.email || source.agentEmail || DEFAULT_GIT_AUTOSAVE.agents.strategist.email
  ).trim() || DEFAULT_GIT_AUTOSAVE.agents.strategist.email;
  const builderName = String(
    builder.name || DEFAULT_GIT_AUTOSAVE.agents.builder.name
  ).trim() || DEFAULT_GIT_AUTOSAVE.agents.builder.name;
  const builderEmail = String(
    builder.email || DEFAULT_GIT_AUTOSAVE.agents.builder.email
  ).trim() || DEFAULT_GIT_AUTOSAVE.agents.builder.email;

  return {
    enabled: Boolean(source.enabled),
    remote: String(source.remote || DEFAULT_GIT_AUTOSAVE.remote).trim() || DEFAULT_GIT_AUTOSAVE.remote,
    branch: String(source.branch || DEFAULT_GIT_AUTOSAVE.branch).trim() || DEFAULT_GIT_AUTOSAVE.branch,
    alternatingAgents: source.alternatingAgents === undefined
      ? DEFAULT_GIT_AUTOSAVE.alternatingAgents
      : Boolean(source.alternatingAgents),
    consultBetweenAgents: source.consultBetweenAgents === undefined
      ? DEFAULT_GIT_AUTOSAVE.consultBetweenAgents
      : Boolean(source.consultBetweenAgents),
    nextAgentId: String(source.nextAgentId || DEFAULT_GIT_AUTOSAVE.nextAgentId).trim() === "builder"
      ? "builder"
      : "strategist",
    agents: {
      strategist: {
        id: "strategist",
        name: strategistName,
        email: strategistEmail
      },
      builder: {
        id: "builder",
        name: builderName,
        email: builderEmail
      }
    },
    commitPrefix: String(source.commitPrefix || DEFAULT_GIT_AUTOSAVE.commitPrefix).trim() || DEFAULT_GIT_AUTOSAVE.commitPrefix,
    lastActorId: source.lastActorId ? String(source.lastActorId) : null,
    lastConsultation: source.lastConsultation ? String(source.lastConsultation) : null,
    lastRunAt: source.lastRunAt ? String(source.lastRunAt) : null,
    lastResult: source.lastResult ? String(source.lastResult) : null,
    lastError: source.lastError ? String(source.lastError) : null
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function setStatus(elementId, message, type = "") {
  const target = document.getElementById(elementId);
  target.textContent = message || "";
  target.className = "status";
  if (type === "error") {
    target.classList.add("error");
  }
  if (type === "ok") {
    target.classList.add("ok");
  }
}

function renderAccounts() {
  const body = document.getElementById("accounts-body");
  body.innerHTML = "";
  for (const account of state.portfolio.accounts) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${account.name || ""}</td>
      <td>${account.type || ""}</td>
      <td>${formatCad(account.balanceCad)}</td>
      <td><button type="button" class="row-remove" data-kind="account" data-id="${account.id}">Remove</button></td>
    `;
    body.appendChild(row);
  }
}

function holdingValue(holding) {
  const shares = toNumber(holding.shares);
  const price = toNumber(holding.currentPriceCad);
  return shares * price;
}

function renderHoldings() {
  const body = document.getElementById("holdings-body");
  body.innerHTML = "";
  for (const holding of state.portfolio.holdings) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${holding.symbol || ""}</td>
      <td>${toNumber(holding.shares)}</td>
      <td>${formatCad(holding.avgCostCad)}</td>
      <td>${formatCad(holding.currentPriceCad)}</td>
      <td>${formatCad(holdingValue(holding))}</td>
      <td><button type="button" class="row-remove" data-kind="holding" data-id="${holding.id}">Remove</button></td>
    `;
    body.appendChild(row);
  }
}

function renderTotals() {
  const accountTotal = state.portfolio.accounts.reduce((sum, account) => {
    return sum + toNumber(account.balanceCad);
  }, 0);
  const holdingsTotal = state.portfolio.holdings.reduce((sum, holding) => {
    return sum + holdingValue(holding);
  }, 0);
  const portfolioTotal = accountTotal + holdingsTotal;

  document.getElementById("accounts-total").textContent = formatCad(accountTotal);
  document.getElementById("holdings-total").textContent = formatCad(holdingsTotal);
  document.getElementById("portfolio-total").textContent = formatCad(portfolioTotal);
}

function hydrateMetaFields() {
  document.getElementById("owner").value = state.portfolio.owner || "";
  document.getElementById("objective").value = state.portfolio.objective || "";
}

function collectMetaFields() {
  state.portfolio.owner = document.getElementById("owner").value.trim();
  state.portfolio.objective = document.getElementById("objective").value.trim();
}

function hydrateGitFields() {
  const cfg = normalizeGitAutoSave(state.portfolio.gitAutoSave);
  document.getElementById("git-enabled").checked = cfg.enabled;
  document.getElementById("git-consult").checked = cfg.consultBetweenAgents;
  document.getElementById("git-remote").value = cfg.remote;
  document.getElementById("git-branch").value = cfg.branch;
  document.getElementById("git-prefix").value = cfg.commitPrefix;
  document.getElementById("git-next-agent").value = cfg.nextAgentId;
  document.getElementById("git-last-actor").value = cfg.lastActorId || "-";
  document.getElementById("git-strategist-name").value = cfg.agents.strategist.name;
  document.getElementById("git-strategist-email").value = cfg.agents.strategist.email;
  document.getElementById("git-builder-name").value = cfg.agents.builder.name;
  document.getElementById("git-builder-email").value = cfg.agents.builder.email;

  if (cfg.lastError) {
    setStatus("git-status", `Last run error: ${cfg.lastError}`, "error");
    return;
  }
  if (cfg.lastRunAt) {
    const suffix = cfg.lastResult ? ` (${cfg.lastResult})` : "";
    setStatus("git-status", `Last run: ${cfg.lastRunAt}${suffix}`, "ok");
    return;
  }
  setStatus("git-status", "No auto-save run yet.");
}

function collectGitFields() {
  state.portfolio.gitAutoSave = normalizeGitAutoSave({
    ...state.portfolio.gitAutoSave,
    enabled: document.getElementById("git-enabled").checked,
    alternatingAgents: true,
    consultBetweenAgents: document.getElementById("git-consult").checked,
    remote: document.getElementById("git-remote").value.trim(),
    branch: document.getElementById("git-branch").value.trim(),
    commitPrefix: document.getElementById("git-prefix").value.trim(),
    agents: {
      strategist: {
        id: "strategist",
        name: document.getElementById("git-strategist-name").value.trim(),
        email: document.getElementById("git-strategist-email").value.trim()
      },
      builder: {
        id: "builder",
        name: document.getElementById("git-builder-name").value.trim(),
        email: document.getElementById("git-builder-email").value.trim()
      }
    }
  });
}

function renderStrategy(strategy) {
  const container = document.getElementById("strategy-output");
  container.innerHTML = "";
  if (!strategy || !strategy.rounds) {
    container.innerHTML = `<p class="muted">No strategy generated yet.</p>`;
    return;
  }

  const header = document.createElement("p");
  header.className = "muted";
  header.textContent = `Generated at ${strategy.generatedAt || "n/a"} | risk=${strategy.riskProfile || "n/a"} | horizon=${strategy.horizonMonths || "n/a"} months`;
  container.appendChild(header);

  const cards = [
    { key: "strategistRound1", label: "Strategist - round 1" },
    { key: "builderRound1", label: "Builder - round 1" },
    { key: "strategistFinal", label: "Strategist - final synthesis" }
  ];

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "output-card";
    const title = document.createElement("h4");
    title.textContent = card.label;
    const content = document.createElement("pre");
    content.textContent = strategy.rounds[card.key] || "No output";
    article.appendChild(title);
    article.appendChild(content);
    container.appendChild(article);
  }
}

function renderAll() {
  hydrateMetaFields();
  hydrateGitFields();
  renderAccounts();
  renderHoldings();
  renderTotals();
  renderStrategy(state.portfolio.lastStrategy);
}

async function savePortfolio(quiet = false) {
  collectMetaFields();
  collectGitFields();
  const payload = {
    portfolio: state.portfolio
  };
  const result = await api("/api/portfolio", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.portfolio = result.portfolio;
  renderAll();
  if (!quiet) {
    setStatus("save-status", "Portfolio saved.", "ok");
  }
}

async function saveGitSettings() {
  collectGitFields();
  const result = await api("/api/autosave", {
    method: "POST",
    body: JSON.stringify({
      gitAutoSave: state.portfolio.gitAutoSave
    })
  });
  state.portfolio = result.portfolio;
  renderAll();
  const enabledText = state.portfolio.gitAutoSave.enabled ? "enabled" : "disabled";
  const nextAgent = state.portfolio.gitAutoSave.nextAgentId || "strategist";
  setStatus("git-status", `Git auto-save ${enabledText}. Next turn: ${nextAgent}.`, "ok");
}

async function runGitSaveNow() {
  setStatus("git-status", "Running git save now...");
  const result = await api("/api/autosave/run", {
    method: "POST",
    body: JSON.stringify({})
  });
  state.portfolio = result.portfolio;
  renderAll();
  if (result.ok) {
    const actor = state.portfolio.gitAutoSave.lastActorId || "n/a";
    const nextAgent = state.portfolio.gitAutoSave.nextAgentId || "strategist";
    setStatus("git-status", `${result.message || "Git save completed."} Last actor: ${actor}. Next: ${nextAgent}.`, "ok");
  } else {
    setStatus("git-status", result.message || "Git save failed.", "error");
  }
}

async function runStrategy() {
  setStatus("strategy-status", "Running strategist and builder...", "");
  try {
    await savePortfolio(true);
    const result = await api("/api/strategy", {
      method: "POST",
      body: JSON.stringify({
        goal: document.getElementById("strategy-goal").value.trim(),
        riskProfile: document.getElementById("strategy-risk").value,
        horizonMonths: toNumber(document.getElementById("strategy-horizon").value)
      })
    });
    state.portfolio.lastStrategy = result.strategy;
    renderStrategy(result.strategy);
    setStatus("strategy-status", "Strategy generated successfully.", "ok");
  } catch (error) {
    setStatus("strategy-status", error.message, "error");
  }
}

function bindEvents() {
  document.getElementById("account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const account = {
      id: createId("acc"),
      name: document.getElementById("account-name").value.trim(),
      type: document.getElementById("account-type").value.trim(),
      balanceCad: toNumber(document.getElementById("account-balance").value)
    };
    state.portfolio.accounts.push(account);
    event.target.reset();
    renderAccounts();
    renderTotals();
    setStatus("save-status", "Account added. Save to persist changes.");
  });

  document.getElementById("holding-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const holding = {
      id: createId("stk"),
      symbol: document.getElementById("holding-symbol").value.trim().toUpperCase(),
      shares: toNumber(document.getElementById("holding-shares").value),
      avgCostCad: toNumber(document.getElementById("holding-avg-cost").value),
      currentPriceCad: toNumber(document.getElementById("holding-current-price").value),
      accountType: document.getElementById("holding-account-type").value.trim()
    };
    state.portfolio.holdings.push(holding);
    event.target.reset();
    renderHoldings();
    renderTotals();
    setStatus("save-status", "Stock added. Save to persist changes.");
  });

  document.getElementById("accounts-body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const id = button.getAttribute("data-id");
    state.portfolio.accounts = state.portfolio.accounts.filter((account) => account.id !== id);
    renderAccounts();
    renderTotals();
    setStatus("save-status", "Account removed. Save to persist changes.");
  });

  document.getElementById("holdings-body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const id = button.getAttribute("data-id");
    state.portfolio.holdings = state.portfolio.holdings.filter((holding) => holding.id !== id);
    renderHoldings();
    renderTotals();
    setStatus("save-status", "Stock removed. Save to persist changes.");
  });

  document.getElementById("save-portfolio").addEventListener("click", async () => {
    try {
      await savePortfolio(false);
    } catch (error) {
      setStatus("save-status", error.message, "error");
    }
  });

  document.getElementById("save-git-settings").addEventListener("click", async () => {
    try {
      await saveGitSettings();
    } catch (error) {
      setStatus("git-status", error.message, "error");
    }
  });

  document.getElementById("run-git-now").addEventListener("click", async () => {
    try {
      await runGitSaveNow();
    } catch (error) {
      setStatus("git-status", error.message, "error");
    }
  });

  document.getElementById("run-strategy").addEventListener("click", async () => {
    await runStrategy();
  });
}

async function initialize() {
  bindEvents();
  try {
    const data = await api("/api/portfolio");
    state.portfolio = {
      ...data.portfolio,
      gitAutoSave: normalizeGitAutoSave(data.portfolio.gitAutoSave)
    };
  } catch (error) {
    setStatus("save-status", error.message, "error");
  }
  renderAll();
}

initialize();
