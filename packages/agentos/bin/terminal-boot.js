import readline from "node:readline";

export const AGENTOS_BOOT_HEADER = ` █████╗  ██████╗ ███████╗███╗   ██╗████████╗ ██████╗ ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║   ██║███████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║╚════██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ╚██████╔╝███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚══════╝`;

const BOOT_TAGLINE = "Built on OpenClaw · Human operating layer for AI agents";
const COMPACT_HEADER = "AgentOS · Built on OpenClaw";
const MEDIUM_HEADER_MIN_COLUMNS = 48;
const MEDIUM_WORDMARK = [
  "▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █▀█ █▀",
  "█▀█ █▄█ ██▄ █░▀█  █  █▄█ ▄█"
];
const VALID_STATES = new Set([
  "checking",
  "waiting",
  "loading",
  "starting",
  "connected",
  "active",
  "ready",
  "warning",
  "failed",
  "disabled",
  "pending"
]);

const STATUS_ROWS = [
  ["openclawGateway", "OpenClaw Gateway", "checking", ""],
  ["nativeGateway", "Native Gateway", "waiting", ""],
  ["workspaceEngine", "Workspace Engine", "loading", ""],
  ["agentRuntime", "Agent Runtime", "starting", ""],
  ["models", "Models", "loading", "resolving"],
  ["channels", "Channels", "pending", "preparing"],
  ["localServerUrl", "Local Server URL", "pending", ""]
];

const UNICODE_FRAMES = [
  "Workspace ▣──◆──▢ Agent ▢────▣ Channel",
  "Workspace ▣────▣ Agent ▢──◆──▢ Channel",
  "Workspace ▢────▣ Agent ▣──◆──▢ Channel",
  "Workspace ▢──◆──▢ Agent ▣────▣ Channel"
];

const ASCII_FRAMES = [
  "Workspace [#]--<>--[ ] Agent [ ]----[#] Channel",
  "Workspace [#]----[#] Agent [ ]--<>--[ ] Channel",
  "Workspace [ ]----[#] Agent [#]--<>--[ ] Channel",
  "Workspace [ ]--<>--[ ] Agent [#]----[#] Channel"
];

const STATUS_COLORS = {
  checking: "cyan",
  waiting: "dim",
  loading: "cyan",
  starting: "cyan",
  connected: "green",
  active: "green",
  ready: "green",
  warning: "yellow",
  failed: "red",
  disabled: "dim",
  pending: "dim",
  resolving: "cyan",
  preparing: "cyan"
};

export function createTerminalBoot(options = {}) {
  return new TerminalBoot(options);
}

export function shouldUsePlainBoot(options = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  if (options.plain) {
    return true;
  }

  if (env.CI || env.AGENTOS_BOOT_UI === "0") {
    return true;
  }

  if (env.AGENTOS_FORCE_BOOT_UI === "1") {
    return false;
  }

  return !stdout.isTTY || !stderr.isTTY;
}

export function supportsBootColor(options = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;

  if (env.NO_COLOR || env.FORCE_COLOR === "0") {
    return false;
  }

  return Boolean(stdout.isTTY || env.AGENTOS_FORCE_BOOT_UI === "1") && env.TERM !== "dumb";
}

export function supportsBootUnicode(env = process.env) {
  if (env.AGENTOS_ASCII_BOOT === "1") {
    return false;
  }

  if (process.platform !== "win32") {
    return true;
  }

  return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === "ON" || env.ANSICON);
}

export function renderBootFrame(options = {}) {
  const env = options.env ?? process.env;
  const columns = normalizeColumns(options.columns);
  const color = createColor(options.color);
  const unicode = options.unicode ?? supportsBootUnicode(env);
  const compact = !unicode || columns < MEDIUM_HEADER_MIN_COLUMNS;
  const large = !compact && env.AGENTOS_LARGE_BOOT_HEADER === "1";
  const statusRows = normalizeRows(options.statusRows);
  const complete = Boolean(options.complete);
  const frameIndex = options.frameIndex ?? 0;

  if (complete) {
    return renderCompleteFrame({
      color,
      columns,
      compact,
      large,
      statusRows,
      finalInfo: options.finalInfo
    });
  }

  const lines = [""];

  lines.push(...renderHeaderLines({
    color,
    columns,
    compact,
    large
  }));

  lines.push("");

  const frames = unicode ? UNICODE_FRAMES : ASCII_FRAMES;
  lines.push(color.dim(truncate(frames[frameIndex % frames.length], columns)));
  lines.push("");

  for (const row of statusRows) {
    lines.push(formatStatusRow(row, {
      color,
      columns
    }));
  }

  return lines.join("\n");
}

class TerminalBoot {
  constructor(options = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.env = options.env ?? process.env;
    this.plain = shouldUsePlainBoot({
      plain: options.plain,
      stdout: this.stdout,
      stderr: this.stderr,
      env: this.env
    });
    this.colorEnabled = supportsBootColor({
      stdout: this.stdout,
      env: this.env
    });
    this.unicode = supportsBootUnicode(this.env);
    this.frameIndex = 0;
    this.lineCount = 0;
    this.timer = null;
    this.started = false;
    this.completed = false;
    this.statusRows = STATUS_ROWS.map(([key, label, state, message]) => ({
      key,
      label,
      state,
      message
    }));
  }

  isPlain() {
    return this.plain;
  }

  start() {
    if (this.plain || this.started) {
      return;
    }

    this.started = true;
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex += 1;
      this.render();
    }, 220);
    this.timer.unref?.();
  }

  updateStatus(key, state, message = "") {
    const row = this.statusRows.find((entry) => entry.key === key);

    if (!row) {
      return;
    }

    row.state = VALID_STATES.has(state) ? state : "warning";
    row.message = message;
    this.render();
  }

  log(message) {
    this.writeLog(message, this.stdout);
  }

  warn(message) {
    this.writeLog(message, this.stderr);
  }

  error(error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    this.writeLog(message, this.stderr);
  }

  complete(finalInfo = "") {
    if (this.plain || this.completed) {
      return;
    }

    this.completed = true;
    this.stopTimer();
    this.clear();
    this.stdout.write(`${this.renderFrame({
      complete: true,
      finalInfo
    })}\n\n`);
    this.lineCount = 0;
  }

  stop(options = {}) {
    if (this.plain) {
      return;
    }

    this.stopTimer();

    if (options.clear) {
      this.clear();
    }
  }

  render() {
    if (this.plain || !this.started || this.completed) {
      return;
    }

    this.clear();
    const output = this.renderFrame();
    this.stdout.write(output);
    this.lineCount = countTerminalLines(output, this.stdout.columns);
  }

  renderFrame(options = {}) {
    return renderBootFrame({
      ...options,
      color: this.colorEnabled,
      unicode: this.unicode,
      columns: this.stdout.columns,
      frameIndex: this.frameIndex,
      statusRows: this.statusRows
    });
  }

  writeLog(message, stream) {
    if (this.plain || !this.started || this.completed) {
      stream.write(ensureNewline(String(message)));
      return;
    }

    this.clear();
    stream.write(ensureNewline(String(message)));
    this.render();
  }

  clear() {
    if (!this.lineCount) {
      return;
    }

    readline.cursorTo(this.stdout, 0);
    readline.moveCursor(this.stdout, 0, -Math.max(0, this.lineCount - 1));
    readline.clearScreenDown(this.stdout);
    this.lineCount = 0;
  }

  stopTimer() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }
}

function normalizeRows(rows = []) {
  if (!rows.length) {
    return STATUS_ROWS.map(([key, label, state, message]) => ({
      key,
      label,
      state,
      message
    }));
  }

  return rows;
}

function formatStatusRow(row, options) {
  const labelWidth = 18;
  const stateWidth = 11;
  const state = row.state || "pending";
  const message = row.message ? ` ${row.message}` : "";
  const availableMessageWidth = Math.max(0, options.columns - labelWidth - stateWidth - 3);
  const stateColor = STATUS_COLORS[state] || "dim";
  const coloredState = options.color[stateColor](state.padEnd(stateWidth));

  return `${row.label.padEnd(labelWidth)} ${coloredState}${truncate(message, availableMessageWidth)}`;
}

function renderMediumHeader(options) {
  const available = Math.max(0, options.columns - 4);
  const ruleWidth = Math.min(available, 72);

  return [
    ...MEDIUM_WORDMARK.map((line) => `  ${options.color.bold(options.color.cyan(line))}`),
    `  ${options.color.dim(truncate(BOOT_TAGLINE, available))}`,
    options.color.dim(`  ${"─".repeat(ruleWidth)}`)
  ];
}

function renderCompleteFrame(options) {
  const lines = [""];
  const message = options.finalInfo ? `AgentOS ready · ${options.finalInfo}` : "AgentOS ready";

  lines.push(...renderHeaderLines(options));
  lines.push("");

  for (const row of options.statusRows) {
    lines.push(formatStatusRow(row, options));
  }

  lines.push("");
  lines.push(options.color.bold(options.color.green(message)));

  return lines.join("\n");
}

function renderHeaderLines(options) {
  if (options.compact) {
    return [options.color.bold(options.color.cyan(COMPACT_HEADER))];
  }

  if (options.large) {
    return [
      ...AGENTOS_BOOT_HEADER.split("\n").map((line, index) => options.color.gradient(line, index)),
      options.color.dim(BOOT_TAGLINE)
    ];
  }

  return renderMediumHeader(options);
}

function createColor(enabled) {
  const wrap = (code, value) => enabled ? `\u001B[${code}m${value}\u001B[0m` : value;

  return {
    bold: (value) => wrap("1", value),
    dim: (value) => wrap("2", value),
    cyan: (value) => wrap("36", value),
    green: (value) => wrap("32", value),
    yellow: (value) => wrap("33", value),
    red: (value) => wrap("31", value),
    gradient: (value, index) => {
      if (!enabled) {
        return value;
      }

      const palette = [81, 87, 117, 159, 117, 87];
      return `\u001B[38;5;${palette[index % palette.length]}m${value}\u001B[0m`;
    }
  };
}

function truncate(value, width) {
  if (width <= 0) {
    return "";
  }

  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

function normalizeColumns(columns) {
  return typeof columns === "number" && Number.isFinite(columns) && columns > 0 ? columns : 80;
}

function countTerminalLines(value, columns) {
  const normalized = value.endsWith("\n") ? value.slice(0, -1) : value;

  if (!normalized) {
    return 0;
  }

  const width = normalizeColumns(columns);

  return normalized.split("\n").reduce((total, line) => {
    const visibleLength = stripAnsi(line).length;
    return total + Math.max(1, Math.floor(Math.max(visibleLength - 1, 0) / width) + 1);
  }, 0);
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function ensureNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}
