"use strict";

const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3199;
const AUTOSAVE_INTERVAL_MINUTES = 30;
const AUTOSAVE_INTERVAL_MS = AUTOSAVE_INTERVAL_MINUTES * 60 * 1000;
const STATIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "portfolio.json");
const PROJECT_ROOT = path.resolve(__dirname, "..");

const portArgIndex = process.argv.indexOf("--port");
const argPort = portArgIndex > -1 ? Number(process.argv[portArgIndex + 1]) : null;
const envPort = Number(process.env.PORT);
const PORT = Number.isFinite(argPort) && argPort > 0
  ? argPort
  : (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PORT);

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

const DEFAULT_PORTFOLIO = {
  currency: "CAD",
  owner: "",
  objective: "",
  accounts: [],
  holdings: [],
  gitAutoSave: { ...DEFAULT_GIT_AUTOSAVE },
  lastStrategy: null,
  updatedAt: null
};

const autoSaveRuntime = {
  timer: null,
  running: false
};

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAgentProfile(input, fallback) {
  const source = input && typeof input === "object" ? input : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const id = toText(source.id) || toText(base.id);
  return {
    id: id || "strategist",
    name: toText(source.name) || toText(base.name) || "Agent",
    email: toText(source.email) || toText(base.email) || "agent@users.noreply.github.com"
  };
}

function getAlternateAgentId(agentId) {
  return agentId === "builder" ? "strategist" : "builder";
}

function normalizeGitAutoSave(input) {
  const source = input && typeof input === "object" ? input : {};
  const strategistFallback = DEFAULT_GIT_AUTOSAVE.agents.strategist;
  const builderFallback = DEFAULT_GIT_AUTOSAVE.agents.builder;
  const normalizedAgents = {
    strategist: normalizeAgentProfile(source.agents && source.agents.strategist, strategistFallback),
    builder: normalizeAgentProfile(source.agents && source.agents.builder, builderFallback)
  };

  // Backward compatibility: map old single-agent keys to strategist when present.
  if (toText(source.agentName) && !toText(source.agents && source.agents.strategist && source.agents.strategist.name)) {
    normalizedAgents.strategist.name = toText(source.agentName);
  }
  if (toText(source.agentEmail) && !toText(source.agents && source.agents.strategist && source.agents.strategist.email)) {
    normalizedAgents.strategist.email = toText(source.agentEmail);
  }

  const nextAgentId = toText(source.nextAgentId) === "builder" ? "builder" : "strategist";

  return {
    enabled: Boolean(source.enabled),
    remote: toText(source.remote) || DEFAULT_GIT_AUTOSAVE.remote,
    branch: toText(source.branch) || DEFAULT_GIT_AUTOSAVE.branch,
    alternatingAgents: source.alternatingAgents === undefined
      ? DEFAULT_GIT_AUTOSAVE.alternatingAgents
      : Boolean(source.alternatingAgents),
    consultBetweenAgents: source.consultBetweenAgents === undefined
      ? DEFAULT_GIT_AUTOSAVE.consultBetweenAgents
      : Boolean(source.consultBetweenAgents),
    nextAgentId,
    agents: normalizedAgents,
    commitPrefix: toText(source.commitPrefix) || DEFAULT_GIT_AUTOSAVE.commitPrefix,
    lastActorId: toText(source.lastActorId) || null,
    lastConsultation: toText(source.lastConsultation) || null,
    lastRunAt: toText(source.lastRunAt) || null,
    lastResult: toText(source.lastResult) || null,
    lastError: toText(source.lastError) || null
  };
}

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DATA_FILE);
  } catch {
    await fsp.writeFile(DATA_FILE, JSON.stringify(DEFAULT_PORTFOLIO, null, 2), "utf8");
  }
}

async function loadPortfolio() {
  await ensureDataFile();
  const raw = await fsp.readFile(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return sanitizePortfolio(parsed);
  } catch {
    return sanitizePortfolio(DEFAULT_PORTFOLIO);
  }
}

function clearAutoSaveTimer() {
  if (autoSaveRuntime.timer) {
    clearInterval(autoSaveRuntime.timer);
    autoSaveRuntime.timer = null;
  }
}

function ensureAutoSaveScheduler(portfolio) {
  const config = portfolio && portfolio.gitAutoSave
    ? portfolio.gitAutoSave
    : DEFAULT_GIT_AUTOSAVE;

  if (!config.enabled) {
    clearAutoSaveTimer();
    return;
  }

  if (autoSaveRuntime.timer) {
    return;
  }

  autoSaveRuntime.timer = setInterval(() => {
    runGitAutoSaveOnce("scheduled", false).catch((error) => {
      console.error(`[git-autosave] ${error.message}`);
    });
  }, AUTOSAVE_INTERVAL_MS);

  if (typeof autoSaveRuntime.timer.unref === "function") {
    autoSaveRuntime.timer.unref();
  }
}

async function savePortfolio(portfolio, options = {}) {
  const sanitized = sanitizePortfolio(portfolio);
  sanitized.updatedAt = new Date().toISOString();
  await fsp.writeFile(DATA_FILE, JSON.stringify(sanitized, null, 2), "utf8");
  if (!options.skipScheduler) {
    ensureAutoSaveScheduler(sanitized);
  }
  return sanitized;
}

function sanitizePortfolio(input) {
  const source = input && typeof input === "object" ? input : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  const holdings = Array.isArray(source.holdings) ? source.holdings : [];

  return {
    currency: "CAD",
    owner: toText(source.owner),
    objective: toText(source.objective),
    accounts: accounts.map((account) => ({
      id: toText(account && account.id) || makeId("acc"),
      name: toText(account && account.name),
      type: toText(account && account.type),
      balanceCad: toNumber(account && account.balanceCad)
    })),
    holdings: holdings.map((holding) => ({
      id: toText(holding && holding.id) || makeId("stk"),
      symbol: toText(holding && holding.symbol).toUpperCase(),
      shares: toNumber(holding && holding.shares),
      avgCostCad: toNumber(holding && holding.avgCostCad),
      currentPriceCad: toNumber(holding && holding.currentPriceCad),
      accountType: toText(holding && holding.accountType)
    })),
    gitAutoSave: normalizeGitAutoSave(source.gitAutoSave),
    lastStrategy: source.lastStrategy && typeof source.lastStrategy === "object"
      ? source.lastStrategy
      : null,
    updatedAt: toText(source.updatedAt) || null
  };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "application/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".ico") return "image/x-icon";
  return "text/plain; charset=utf-8";
}

async function serveStatic(req, res, urlObj) {
  const requestedPath = urlObj.pathname === "/" ? "/index.html" : urlObj.pathname;
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(STATIC_DIR, normalized);
  if (!fullPath.startsWith(STATIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden path" });
    return;
  }
  try {
    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      const indexPath = path.join(fullPath, "index.html");
      const indexData = await fsp.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexData);
      return;
    }
    const data = await fsp.readFile(fullPath);
    res.writeHead(200, { "Content-Type": getMimeType(fullPath) });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not Found" });
  }
}

function extractJsonChunk(raw) {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Unable to parse OpenClaw JSON output");
  }
  return raw.slice(first, last + 1);
}

function extractAgentText(response) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const payloads = response.result && Array.isArray(response.result.payloads)
    ? response.result.payloads
    : [];
  return payloads
    .map((payload) => (payload && typeof payload.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} failed with code ${code}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

function runOpenClawAgent({ agentId, sessionId, message }) {
  return new Promise((resolve, reject) => {
    const args = [
      "agent",
      "--agent", agentId,
      "--session-id", sessionId,
      "--message", message,
      "--json"
    ];
    const child = spawn("openclaw", args, {
      cwd: __dirname,
      env: process.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    const timeoutMs = 10 * 60 * 1000;

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`OpenClaw agent timeout for ${agentId}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new Error("OpenClaw CLI is missing. Run launcher Install first."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Agent ${agentId} failed (exit ${code}): ${stderr || stdout}`));
        return;
      }
      try {
        const json = JSON.parse(extractJsonChunk(stdout.trim()));
        const text = extractAgentText(json);
        if (!text) {
          reject(new Error(`Agent ${agentId} returned no text payload`));
          return;
        }
        resolve({
          raw: json,
          text
        });
      } catch (error) {
        reject(new Error(`Failed to decode agent output for ${agentId}: ${error.message}`));
      }
    });
  });
}

function firstNonEmptyLine(text) {
  return toText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function makeCommitMessage(config, reason, actorProfile, consultationHint) {
  const prefix = toText(config.commitPrefix) || DEFAULT_GIT_AUTOSAVE.commitPrefix;
  const cleanPrefix = prefix.replace(/[\r\n]+/g, " ").trim().slice(0, 60);
  const actorLabel = actorProfile && actorProfile.name
    ? actorProfile.name.replace(/[\r\n]+/g, " ").trim().slice(0, 24)
    : "Agent";
  const cleanReason = toText(reason).replace(/[\r\n]+/g, " ").trim().slice(0, 30) || "scheduled";
  const cleanHint = toText(consultationHint).replace(/[\r\n]+/g, " ").trim().slice(0, 48);
  const ts = new Date().toISOString();
  return cleanHint
    ? `${cleanPrefix} [${actorLabel}] (${cleanReason}) ${cleanHint} ${ts}`
    : `${cleanPrefix} [${actorLabel}] (${cleanReason}) ${ts}`;
}

async function runAutosaveConsultation({ actorId, reviewerId, changedFiles, commitPrefix }) {
  const fileList = changedFiles.length > 0 ? changedFiles.map((item) => `- ${item}`).join("\n") : "- no file list";

  const actorPrompt = [
    "Tu participes a une sauvegarde Git auto.",
    `Tu es l'agent actif: ${actorId}.`,
    "Contexte: alternance strategique entre strategist et builder.",
    `Prefix commit: ${commitPrefix}.`,
    "Fichiers modifies:",
    fileList,
    "Donne une proposition courte de focus de commit en 1 phrase."
  ].join("\n");

  const actorReply = await runOpenClawAgent({
    agentId: actorId,
    sessionId: "finance-autosave-consult",
    message: actorPrompt
  });

  const reviewerPrompt = [
    "Tu es l'agent reviewer d'une sauvegarde Git auto.",
    `Agent actif: ${actorId}. Reviewer: ${reviewerId}.`,
    "Fichiers modifies:",
    fileList,
    "Proposition de l'agent actif:",
    actorReply.text,
    "Valide ou corrige en 1 phrase courte pour le message de commit."
  ].join("\n");

  const reviewerReply = await runOpenClawAgent({
    agentId: reviewerId,
    sessionId: "finance-autosave-consult",
    message: reviewerPrompt
  });

  return {
    actorText: actorReply.text,
    reviewerText: reviewerReply.text,
    hint: firstNonEmptyLine(reviewerReply.text) || firstNonEmptyLine(actorReply.text)
  };
}

async function updateGitAutoSaveStatus(partial) {
  const portfolio = await loadPortfolio();
  const current = normalizeGitAutoSave(portfolio.gitAutoSave);
  const next = {
    ...portfolio,
    gitAutoSave: normalizeGitAutoSave({
      ...current,
      ...partial
    })
  };
  return savePortfolio(next, { skipScheduler: true });
}

async function runGitAutoSaveOnce(reason, forceRun) {
  if (autoSaveRuntime.running) {
    return {
      ok: false,
      skipped: true,
      message: "Git auto-save is already running."
    };
  }

  autoSaveRuntime.running = true;
  try {
    const portfolio = await loadPortfolio();
    const config = normalizeGitAutoSave(portfolio.gitAutoSave);

    if (!config.enabled && !forceRun) {
      return {
        ok: false,
        skipped: true,
        message: "Git auto-save is disabled."
      };
    }

    const repoCheck = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: PROJECT_ROOT
    });
    if (repoCheck.stdout.trim() !== "true") {
      throw new Error("Current project is not a git repository.");
    }

    const status = await runCommand("git", ["status", "--porcelain"], {
      cwd: PROJECT_ROOT
    });
    if (!status.stdout.trim()) {
      await updateGitAutoSaveStatus({
        lastRunAt: new Date().toISOString(),
        lastResult: "no_changes",
        lastError: null
      });
      return {
        ok: true,
        skipped: true,
        message: "No changes to commit."
      };
    }

    const actorId = config.alternatingAgents ? config.nextAgentId : "strategist";
    const actorProfile = actorId === "builder"
      ? config.agents.builder
      : config.agents.strategist;
    const reviewerId = getAlternateAgentId(actorId);

    const changedFiles = status.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.length >= 4 ? line.slice(3).trim() : line);

    let consultationHint = "";
    let consultationSnapshot = null;
    if (config.consultBetweenAgents && changedFiles.length > 0) {
      try {
        const consultation = await runAutosaveConsultation({
          actorId,
          reviewerId,
          changedFiles,
          commitPrefix: config.commitPrefix
        });
        consultationHint = consultation.hint;
        consultationSnapshot = `actor=${actorId}; reviewer=${reviewerId}; actorNote=${firstNonEmptyLine(consultation.actorText)}; reviewerNote=${firstNonEmptyLine(consultation.reviewerText)}`;
      } catch (error) {
        consultationSnapshot = `consultation_error=${error.message}`;
      }
    }

    await runCommand("git", ["add", "-A"], { cwd: PROJECT_ROOT });

    const commitMessage = makeCommitMessage(config, reason, actorProfile, consultationHint);
    await runCommand("git", [
      "-c", `user.name=${actorProfile.name}`,
      "-c", `user.email=${actorProfile.email}`,
      "commit",
      "-m", commitMessage
    ], { cwd: PROJECT_ROOT });

    await runCommand("git", ["push", config.remote, config.branch], { cwd: PROJECT_ROOT });

    const nextAgentId = config.alternatingAgents ? getAlternateAgentId(actorId) : actorId;
    await updateGitAutoSaveStatus({
      lastRunAt: new Date().toISOString(),
      lastResult: "pushed",
      nextAgentId,
      lastActorId: actorId,
      lastConsultation: consultationSnapshot,
      lastError: null
    });

    return {
      ok: true,
      skipped: false,
      message: `Changes pushed to ${config.remote}/${config.branch} as ${actorProfile.name} (${actorId}).`
    };
  } catch (error) {
    await updateGitAutoSaveStatus({
      lastRunAt: new Date().toISOString(),
      lastResult: "error",
      lastError: error.message
    });
    return {
      ok: false,
      skipped: false,
      message: error.message
    };
  } finally {
    autoSaveRuntime.running = false;
  }
}

function buildPortfolioSummary(portfolio) {
  const accountLines = portfolio.accounts.map((account) => {
    return `- ${account.name || "Account"} | type=${account.type || "n/a"} | balanceCAD=${account.balanceCad.toFixed(2)}`;
  });
  const holdingLines = portfolio.holdings.map((holding) => {
    return `- ${holding.symbol || "N/A"} | shares=${holding.shares} | avgCostCAD=${holding.avgCostCad.toFixed(2)} | currentPriceCAD=${holding.currentPriceCad.toFixed(2)} | account=${holding.accountType || "n/a"}`;
  });
  if (accountLines.length === 0) {
    accountLines.push("- none");
  }
  if (holdingLines.length === 0) {
    holdingLines.push("- none");
  }
  return [
    `Owner: ${portfolio.owner || "not specified"}`,
    `Objective: ${portfolio.objective || "not specified"}`,
    "Accounts:",
    ...accountLines,
    "Holdings:",
    ...holdingLines
  ].join("\n");
}

async function generateCollaborativeStrategy(portfolio, options) {
  const goal = toText(options.goal) || portfolio.objective || "Grow CAD capital with controlled risk.";
  const riskProfile = toText(options.riskProfile) || "balanced";
  const horizonMonths = Math.max(1, Math.floor(toNumber(options.horizonMonths) || 24));
  const summary = buildPortfolioSummary(portfolio);

  const strategistPrompt = [
    "You are Strategist in a 2-agent finance workflow.",
    "Language: French.",
    "Constraint: educational analysis only, not financial advice.",
    `Goal: ${goal}`,
    `Risk profile: ${riskProfile}`,
    `Horizon months: ${horizonMonths}`,
    "Portfolio in CAD:",
    summary,
    "Task:",
    "1) Detect missing information and ask concise questions.",
    "2) Propose a first strategy draft (allocation, risk controls, cash management).",
    "3) End with a handoff block for Builder."
  ].join("\n");

  const strategistRound1 = await runOpenClawAgent({
    agentId: "strategist",
    sessionId: "finance-strategist",
    message: strategistPrompt
  });

  const builderPrompt = [
    "You are Builder in a 2-agent finance workflow.",
    "Language: French.",
    "Constraint: educational analysis only, not financial advice.",
    `Goal: ${goal}`,
    `Risk profile: ${riskProfile}`,
    `Horizon months: ${horizonMonths}`,
    "Portfolio in CAD:",
    summary,
    "Message from Strategist:",
    strategistRound1.text,
    "Task:",
    "1) Critique the strategy draft.",
    "2) Add practical implementation steps and measurable checkpoints.",
    "3) Highlight risks and edge cases.",
    "4) End with a handoff block for Strategist."
  ].join("\n");

  const builderRound1 = await runOpenClawAgent({
    agentId: "builder",
    sessionId: "finance-builder",
    message: builderPrompt
  });

  const strategistFinalPrompt = [
    "You are Strategist and must synthesize final action plan.",
    "Language: French.",
    "Constraint: educational analysis only, not financial advice.",
    `Goal: ${goal}`,
    `Risk profile: ${riskProfile}`,
    `Horizon months: ${horizonMonths}`,
    "Portfolio in CAD:",
    summary,
    "Your previous draft:",
    strategistRound1.text,
    "Builder feedback:",
    builderRound1.text,
    "Task:",
    "Deliver final plan with:",
    "- Priority actions (0-30 days, 30-90 days, 90+ days)",
    "- Position sizing/risk guardrails",
    "- Monitoring KPIs in CAD",
    "- Explicit assumptions and unanswered questions"
  ].join("\n");

  const strategistFinal = await runOpenClawAgent({
    agentId: "strategist",
    sessionId: "finance-strategist",
    message: strategistFinalPrompt
  });

  return {
    generatedAt: new Date().toISOString(),
    goal,
    riskProfile,
    horizonMonths,
    rounds: {
      strategistRound1: strategistRound1.text,
      builderRound1: builderRound1.text,
      strategistFinal: strategistFinal.text
    }
  };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "GET" && urlObj.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      gitAutoSave: {
        enabled: Boolean(autoSaveRuntime.timer),
        running: autoSaveRuntime.running,
        everyMinutes: AUTOSAVE_INTERVAL_MINUTES
      }
    });
    return;
  }

  if (req.method === "GET" && urlObj.pathname === "/api/portfolio") {
    try {
      const portfolio = await loadPortfolio();
      sendJson(res, 200, { portfolio });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && urlObj.pathname === "/api/portfolio") {
    try {
      const body = await parseJsonBody(req);
      const payload = body && typeof body === "object" && body.portfolio ? body.portfolio : body;
      const saved = await savePortfolio(payload);
      sendJson(res, 200, { portfolio: saved });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && urlObj.pathname === "/api/strategy") {
    try {
      const options = await parseJsonBody(req);
      const portfolio = await loadPortfolio();
      if (portfolio.accounts.length === 0 && portfolio.holdings.length === 0) {
        sendJson(res, 400, {
          error: "Portfolio is empty. Add CAD account values and stock holdings first."
        });
        return;
      }
      const strategy = await generateCollaborativeStrategy(portfolio, options);
      const updated = {
        ...portfolio,
        lastStrategy: strategy
      };
      await savePortfolio(updated);
      sendJson(res, 200, {
        strategy,
        note: "Educational output only. Validate decisions independently."
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && urlObj.pathname === "/api/autosave") {
    try {
      const portfolio = await loadPortfolio();
      sendJson(res, 200, {
        gitAutoSave: normalizeGitAutoSave(portfolio.gitAutoSave),
        runtime: {
          enabled: Boolean(autoSaveRuntime.timer),
          running: autoSaveRuntime.running,
          everyMinutes: AUTOSAVE_INTERVAL_MINUTES
        }
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && urlObj.pathname === "/api/autosave") {
    try {
      const body = await parseJsonBody(req);
      const payload = body && typeof body === "object" && body.gitAutoSave ? body.gitAutoSave : body;
      const portfolio = await loadPortfolio();
      const updated = await savePortfolio({
        ...portfolio,
        gitAutoSave: {
          ...normalizeGitAutoSave(portfolio.gitAutoSave),
          ...(payload && typeof payload === "object" ? payload : {})
        }
      });
      sendJson(res, 200, {
        portfolio: updated,
        gitAutoSave: normalizeGitAutoSave(updated.gitAutoSave),
        runtime: {
          enabled: Boolean(autoSaveRuntime.timer),
          running: autoSaveRuntime.running,
          everyMinutes: AUTOSAVE_INTERVAL_MINUTES
        }
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && urlObj.pathname === "/api/autosave/run") {
    try {
      const result = await runGitAutoSaveOnce("manual", true);
      const portfolio = await loadPortfolio();
      sendJson(res, 200, {
        ...result,
        portfolio,
        gitAutoSave: normalizeGitAutoSave(portfolio.gitAutoSave)
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res, urlObj);
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, HOST, () => {
  console.log(`http://${HOST}:${PORT}`);
});

loadPortfolio()
  .then((portfolio) => {
    ensureAutoSaveScheduler(portfolio);
  })
  .catch((error) => {
    console.error(`[bootstrap] ${error.message}`);
  });

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
