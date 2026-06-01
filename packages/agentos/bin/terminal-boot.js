import readline from "node:readline";

const LARGE_AGENT_WORDMARK = [
  " █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  "██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  "╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   "
];

const LARGE_OS_WORDMARK = [
  " ██████╗ ███████╗",
  "██╔═══██╗██╔════╝",
  "██║   ██║███████╗",
  "██║   ██║╚════██║",
  "╚██████╔╝███████║",
  " ╚═════╝ ╚══════╝"
];

export const AGENTOS_BOOT_HEADER = LARGE_AGENT_WORDMARK
  .map((line, index) => `${line}  ${LARGE_OS_WORDMARK[index]}`)
  .join("\n");

export const TERMINAL_THEME = {
  neonRed: "#FF1744",
  softRed: "#FF5A6D",
  deepRed: "#6E0A17",
  successGreen: "#39D353",
  warningAmber: "#FFD166",
  dangerRed: "#FF3B3B",
  mutedGray: "#8B949E",
  textWhite: "#F0F6FC",
  brightWhite: "#FFFFFF",
  dividerGray: "#4A121B"
};

const HEADER_TITLE = "AGENTOS CONTROL ROOM";
const BOOT_PRIMARY_LINE = "Built on OpenClaw";
const BOOT_SECONDARY_LINE = "Human operating layer for AI agents";
const BOOT_TAGLINE = `${BOOT_PRIMARY_LINE} · ${BOOT_SECONDARY_LINE}`;
const MEDIUM_HEADER_MIN_COLUMNS = 48;
const LARGE_HEADER_MIN_COLUMNS = 82;
const DASHBOARD_MIN_COLUMNS = 56;
const PANEL_MAX_COLUMNS = 80;
const MEDIUM_AGENT_WORDMARK = [
  "▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀",
  "█▀█ █▄█ ██▄ █░▀█  █ "
];
const MEDIUM_OS_WORDMARK = [
  " █▀█ █▀",
  " █▄█ ▄█"
];

const STATE_META = {
  checking: { label: "CHECKING", color: "brand", symbol: "…", ascii: "..." },
  waiting: { label: "WAITING", color: "muted", symbol: "…", ascii: "..." },
  loading: { label: "LOADING", color: "brand", symbol: "…", ascii: "..." },
  starting: { label: "STARTING", color: "brand", symbol: "…", ascii: "..." },
  resolving: { label: "RESOLVING", color: "brand", symbol: "…", ascii: "..." },
  preparing: { label: "PREPARING", color: "brand", symbol: "…", ascii: "..." },
  connected: { label: "CONNECTED", color: "success", symbol: "✓", ascii: "OK" },
  active: { label: "ACTIVE", color: "success", symbol: "✓", ascii: "OK" },
  ready: { label: "READY", color: "success", symbol: "✓", ascii: "OK" },
  success: { label: "SUCCESS", color: "success", symbol: "✓", ascii: "OK" },
  ok: { label: "OK", color: "success", symbol: "✓", ascii: "OK" },
  warning: { label: "WARNING", color: "warning", symbol: "⚠", ascii: "!" },
  degraded: { label: "DEGRADED", color: "warning", symbol: "⚠", ascii: "!" },
  failed: { label: "FAILED", color: "danger", symbol: "✕", ascii: "x" },
  unreachable: { label: "UNREACHABLE", color: "danger", symbol: "✕", ascii: "x" },
  broken: { label: "BROKEN", color: "danger", symbol: "✕", ascii: "x" },
  error: { label: "ERROR", color: "danger", symbol: "✕", ascii: "x" },
  disabled: { label: "DISABLED", color: "muted", symbol: "–", ascii: "-" },
  skipped: { label: "SKIPPED", color: "muted", symbol: "–", ascii: "-" },
  inactive: { label: "INACTIVE", color: "muted", symbol: "–", ascii: "-" },
  pending: { label: "PENDING", color: "muted", symbol: "–", ascii: "-" }
};

const VALID_STATES = new Set(Object.keys(STATE_META));

const STATUS_ROWS = [
  ["agentosVersion", "AgentOS", "ready", ""],
  ["update", "Update", "pending", ""],
  ["openclawGateway", "OpenClaw Gateway", "checking", ""],
  ["nativeGateway", "Native Gateway", "waiting", ""],
  ["workspaceEngine", "Workspace Engine", "loading", ""],
  ["agentRuntime", "Agent Runtime", "starting", ""],
  ["models", "Models", "resolving", ""],
  ["channels", "Channels", "preparing", ""],
  ["localServerUrl", "Local Server URL", "pending", ""]
];

const UNICODE_FRAMES = [
  "OpenClaw Gateway ▰▱▱  AgentOS Runtime ▱▱▱  Local UI",
  "OpenClaw Gateway ▰▰▱  AgentOS Runtime ▰▱▱  Local UI",
  "OpenClaw Gateway ▰▰▰  AgentOS Runtime ▰▰▱  Local UI",
  "OpenClaw Gateway ▰▰▰  AgentOS Runtime ▰▰▰  Local UI"
];

const ASCII_FRAMES = [
  "OpenClaw Gateway [#--]  AgentOS Runtime [---]  Local UI",
  "OpenClaw Gateway [##-]  AgentOS Runtime [#--]  Local UI",
  "OpenClaw Gateway [###]  AgentOS Runtime [##-]  Local UI",
  "OpenClaw Gateway [###]  AgentOS Runtime [###]  Local UI"
];

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
  const forceLarge = env.AGENTOS_LARGE_BOOT_HEADER === "1";
  const large = !compact && (forceLarge || columns >= LARGE_HEADER_MIN_COLUMNS) && env.AGENTOS_MEDIUM_BOOT_HEADER !== "1";
  const statusRows = normalizeRows(options.statusRows);
  const complete = Boolean(options.complete);
  const frameIndex = options.frameIndex ?? 0;

  if (complete) {
    return renderCompleteFrame({
      color,
      columns,
      compact,
      large,
      unicode,
      statusRows,
      finalInfo: options.finalInfo
    });
  }

  const lines = [""];

  lines.push(...renderHeaderLines({
    color,
    columns,
    compact,
    large,
    unicode
  }));

  lines.push("");

  const frames = unicode ? UNICODE_FRAMES : ASCII_FRAMES;
  lines.push(color.muted(truncate(frames[frameIndex % frames.length], columns)));
  lines.push("");
  lines.push(...renderStatusSection({
    title: "SYSTEM CHECK",
    rows: statusRows,
    color,
    columns,
    unicode
  }));

  return lines.join("\n");
}

export function renderStatusDashboard(options = {}) {
  const env = options.env ?? process.env;
  const columns = normalizeColumns(options.columns ?? process.stdout.columns);
  const colorEnabled = options.color ?? supportsBootColor({ stdout: options.stdout, env });
  const color = createColor(colorEnabled);
  const unicode = options.unicode ?? supportsBootUnicode(env);
  const rows = normalizeRows(options.rows);
  const lines = [""];

  if (options.header !== false) {
    lines.push(...renderHeaderLines({
      color,
      columns,
      compact: !unicode || columns < MEDIUM_HEADER_MIN_COLUMNS,
      large: unicode && columns >= LARGE_HEADER_MIN_COLUMNS,
      unicode
    }));
    lines.push("");
  }

  lines.push(...renderStatusSection({
    title: options.title || "SYSTEM CHECK",
    rows,
    color,
    columns,
    unicode
  }));

  if (options.finalInfo) {
    lines.push("");
    lines.push(...renderReadyBlock({
      color,
      columns,
      finalInfo: options.finalInfo,
      unicode
    }));
  } else if (options.footer) {
    lines.push("");
    lines.push(color.muted(options.footer));
  }

  return lines.join("\n");
}

export function renderDoctorReport(options = {}) {
  const env = options.env ?? process.env;
  const columns = normalizeColumns(options.columns ?? process.stdout.columns);
  const colorEnabled = options.color ?? supportsBootColor({ stdout: options.stdout, env });
  const color = createColor(colorEnabled);
  const unicode = options.unicode ?? supportsBootUnicode(env);
  const rows = normalizeRows(options.rows);
  const lines = [""];

  lines.push(color.bold(color.primary(options.title || "AGENTOS DOCTOR")));
  lines.push(color.muted(truncate(options.subtitle || BOOT_TAGLINE, columns)));
  lines.push(color.divider(divider(columns, unicode)));
  lines.push(...formatStatusRows(rows, {
    color,
    columns,
    unicode
  }));

  if (options.footer) {
    lines.push(color.divider(divider(columns, unicode)));
    lines.push(color.muted(truncate(options.footer, columns)));
  }

  return lines.join("\n");
}

export function formatStatusBadge(state, options = {}) {
  const color = options.color ?? createColor(false);
  const unicode = options.unicode ?? true;
  const meta = getStateMeta(state);
  const symbol = unicode ? meta.symbol : meta.ascii;
  const text = `${symbol} ${meta.label}`;
  const padded = text.padEnd(options.width ?? 15);

  return color[meta.color](padded);
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

  return rows.map((row) => ({
    ...row,
    state: VALID_STATES.has(row.state) ? row.state : "warning"
  }));
}

function renderStatusSection(options) {
  const title = options.title || "SYSTEM CHECK";
  const columns = normalizeColumns(options.columns);

  if (columns < DASHBOARD_MIN_COLUMNS) {
    return renderCompactStatusSection({
      ...options,
      title,
      columns
    });
  }

  const width = panelWidth(columns);
  const innerWidth = width - 4;
  const rows = options.rows;
  const labelWidth = Math.min(23, Math.max(17, ...rows.map((row) => row.label.length)));
  const badgeWidth = 15;
  const detailWidth = Math.max(8, innerWidth - labelWidth - badgeWidth - 4);
  const lines = [
    renderBorder({
      color: options.color,
      title,
      unicode: options.unicode,
      width,
      edge: "top"
    }),
    boxLine(formatDashboardHeader({
      badgeWidth,
      color: options.color,
      detailWidth,
      labelWidth
    }), {
      color: options.color,
      unicode: options.unicode,
      width
    }),
    renderBorder({
      color: options.color,
      unicode: options.unicode,
      width,
      edge: "middle"
    })
  ];

  lines.push(...rows.map((row) => formatDashboardRow(row, {
    badgeWidth,
    color: options.color,
    detailWidth,
    labelWidth,
    unicode: options.unicode,
    width
  })));
  lines.push(renderBorder({
    color: options.color,
    unicode: options.unicode,
    width,
    edge: "bottom"
  }));

  return lines;
}

function formatStatusRows(rows, options) {
  const compact = options.columns < 62;
  const labelWidth = compact ? 17 : Math.min(22, Math.max(17, ...rows.map((row) => row.label.length)));
  const badgeWidth = compact ? 14 : 15;

  return rows.map((row) => formatStatusRow(row, {
    ...options,
    compact,
    labelWidth,
    badgeWidth
  }));
}

function formatStatusRow(row, options) {
  const state = row.state || "pending";
  const detail = row.message || row.detail || "";
  const label = truncate(row.label, options.labelWidth).padEnd(options.labelWidth);
  const badge = formatStatusBadge(state, {
    color: options.color,
    unicode: options.unicode,
    width: options.badgeWidth
  });
  const availableDetailWidth = Math.max(0, options.columns - options.labelWidth - options.badgeWidth - 4);
  const detailText = truncate(String(detail), availableDetailWidth);
  const formattedDetail = formatDetail(detailText, options.color);

  return `${options.color.text(label)}  ${badge}  ${formattedDetail}`;
}

function renderMediumHeader(options) {
  return MEDIUM_AGENT_WORDMARK.map((line, index) => {
    const agent = options.color.bold(options.color.text(line));
    const os = options.color.bold(options.color.brand(MEDIUM_OS_WORDMARK[index]));

    return `${options.color.dim(options.color.brand("▌"))} ${agent}${os}`;
  });
}

function renderCompleteFrame(options) {
  const lines = [""];

  lines.push(...renderHeaderLines(options));
  lines.push("");
  lines.push(...renderStatusSection({
    title: "SYSTEM CHECK",
    rows: options.statusRows,
    color: options.color,
    columns: options.columns,
    unicode: options.unicode
  }));
  lines.push("");
  lines.push(...renderReadyBlock({
    color: options.color,
    columns: options.columns,
    finalInfo: options.finalInfo,
    unicode: options.unicode
  }));

  return lines.join("\n");
}

function renderHeaderLines(options) {
  const width = panelWidth(options.columns);
  const lines = [
    renderBorder({
      color: options.color,
      title: HEADER_TITLE,
      unicode: options.unicode,
      width,
      edge: "top"
    })
  ];
  const logoLines = options.compact
    ? [formatCompactHeader(options.color)]
    : options.large
      ? renderLargeHeader(options)
      : renderMediumHeader(options);

  for (const line of logoLines) {
    lines.push(boxLine(line, {
      color: options.color,
      unicode: options.unicode,
      width
    }));
  }

  lines.push(boxLine("", {
    color: options.color,
    unicode: options.unicode,
    width
  }));
  lines.push(boxLine(options.color.text(BOOT_PRIMARY_LINE), {
    color: options.color,
    unicode: options.unicode,
    width
  }));
  lines.push(boxLine(options.color.muted(BOOT_SECONDARY_LINE), {
    color: options.color,
    unicode: options.unicode,
    width
  }));
  lines.push(renderBorder({
    color: options.color,
    unicode: options.unicode,
    width,
    edge: "bottom"
  }));

  return lines;
}

function createColor(enabled) {
  const ansi = (codes, value) => enabled ? `\u001B[${codes}m${value}\u001B[0m` : value;
  const rgbCode = (value) => {
    const [red, green, blue] = parseHex(value);
    return `38;2;${red};${green};${blue}`;
  };
  const hex = (value, text) => {
    if (!enabled) {
      return text;
    }

    return ansi(rgbCode(value), text);
  };

  return {
    bold: (value) => ansi("1", value),
    dim: (value) => ansi("2", value),
    underline: (value) => ansi("4", value),
    brand: (value) => hex(TERMINAL_THEME.neonRed, value),
    accent: (value) => hex(TERMINAL_THEME.softRed, value),
    primary: (value) => hex(TERMINAL_THEME.neonRed, value),
    soft: (value) => hex(TERMINAL_THEME.softRed, value),
    success: (value) => hex(TERMINAL_THEME.successGreen, value),
    warning: (value) => hex(TERMINAL_THEME.warningAmber, value),
    danger: (value) => hex(TERMINAL_THEME.dangerRed, value),
    muted: (value) => hex(TERMINAL_THEME.mutedGray, value),
    text: (value) => hex(TERMINAL_THEME.textWhite, value),
    bright: (value) => hex(TERMINAL_THEME.brightWhite, value),
    divider: (value) => hex(TERMINAL_THEME.dividerGray, value),
    url: (value) => enabled ? ansi(`4;${rgbCode(TERMINAL_THEME.brightWhite)}`, value) : value,
    cyan: (value) => hex(TERMINAL_THEME.neonRed, value),
    green: (value) => hex(TERMINAL_THEME.successGreen, value),
    yellow: (value) => hex(TERMINAL_THEME.warningAmber, value),
    red: (value) => hex(TERMINAL_THEME.dangerRed, value),
    gradient: (value, index) => {
      const palette = [
        TERMINAL_THEME.textWhite,
        TERMINAL_THEME.textWhite,
        TERMINAL_THEME.textWhite,
        TERMINAL_THEME.textWhite,
        TERMINAL_THEME.neonRed,
        TERMINAL_THEME.neonRed
      ];
      return hex(palette[index % palette.length], value);
    }
  };
}

function getStateMeta(state) {
  return STATE_META[state] || STATE_META.warning;
}

function formatDetail(value, color) {
  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return color.url(value);
  }

  return color.text(value);
}

function renderCompactStatusSection(options) {
  const width = panelWidth(options.columns);
  const lines = [
    options.color.bold(options.color.brand(options.title)),
    options.color.divider(divider(width, options.unicode))
  ];

  for (const row of options.rows) {
    const badge = formatStatusBadge(row.state || "pending", {
      color: options.color,
      unicode: options.unicode,
      width: 0
    }).trimEnd();
    const detail = row.message || row.detail || "";

    lines.push(`${options.color.text(truncate(row.label, Math.max(8, width - 18)))}  ${badge}`);

    if (detail) {
      lines.push(`  ${formatDetail(truncate(String(detail), Math.max(8, width - 2)), options.color)}`);
    }
  }

  lines.push(options.color.divider(divider(width, options.unicode)));

  return lines;
}

function formatDashboardHeader(options) {
  return [
    options.color.muted("SUBSYSTEM".padEnd(options.labelWidth)),
    options.color.muted("STATUS".padEnd(options.badgeWidth)),
    options.color.muted("DETAIL".padEnd(options.detailWidth))
  ].join("  ");
}

function formatDashboardRow(row, options) {
  const state = row.state || "pending";
  const detail = row.message || row.detail || "";
  const label = options.color.text(truncate(row.label, options.labelWidth).padEnd(options.labelWidth));
  const badge = formatStatusBadge(state, {
    color: options.color,
    unicode: options.unicode,
    width: options.badgeWidth
  });
  const detailText = truncate(String(detail), options.detailWidth);
  const formattedDetail = formatDetail(detailText, options.color);
  const content = `${label}  ${badge}  ${formattedDetail}`;

  return boxLine(content, {
    color: options.color,
    unicode: options.unicode,
    width: options.width
  });
}

function renderLargeHeader(options) {
  return LARGE_AGENT_WORDMARK.map((line, index) => {
    const agent = options.color.bold(options.color.text(line));
    const os = options.color.bold(options.color.brand(LARGE_OS_WORDMARK[index]));

    return `${options.color.dim(options.color.brand("▌"))} ${agent}  ${os}`;
  });
}

function formatCompactHeader(color) {
  return `${color.bold(color.text("Agent"))}${color.bold(color.brand("OS"))}`;
}

function renderReadyBlock(options) {
  const width = panelWidth(options.columns);
  const readyLine = options.color.bold(options.color.success("✓ AgentOS ready"));
  const localUiLine = options.finalInfo
    ? `${options.color.text("Local UI:")} ${formatDetail(options.finalInfo, options.color)}`
    : "";

  if (width < DASHBOARD_MIN_COLUMNS) {
    return localUiLine ? [readyLine, localUiLine] : [readyLine];
  }

  const lines = [
    renderBorder({
      color: options.color,
      title: "READY",
      unicode: options.unicode,
      width,
      edge: "top"
    }),
    boxLine(readyLine, {
      color: options.color,
      unicode: options.unicode,
      width
    })
  ];

  if (localUiLine) {
    lines.push(boxLine(localUiLine, {
      color: options.color,
      unicode: options.unicode,
      width
    }));
  }

  lines.push(renderBorder({
    color: options.color,
    unicode: options.unicode,
    width,
    edge: "bottom"
  }));

  return lines;
}

function renderBorder(options) {
  const chars = boxChars(options.unicode);
  const left = options.edge === "bottom" ? chars.bottomLeft : options.edge === "middle" ? chars.middleLeft : chars.topLeft;
  const right = options.edge === "bottom" ? chars.bottomRight : options.edge === "middle" ? chars.middleRight : chars.topRight;
  const horizontal = options.edge === "middle" ? chars.middle : chars.horizontal;
  const innerWidth = Math.max(0, options.width - 2);

  if (options.title && options.edge === "top") {
    const title = ` ${options.title} `;
    const safeTitle = truncate(title, Math.max(0, innerWidth - 2));
    const remaining = Math.max(0, innerWidth - safeTitle.length - 1);

    return options.color.brand(`${left}${horizontal}${safeTitle}${horizontal.repeat(remaining)}${right}`);
  }

  const paintBorder = options.edge === "middle" ? options.color.accent : options.color.brand;

  return paintBorder(`${left}${horizontal.repeat(innerWidth)}${right}`);
}

function boxLine(value, options) {
  const chars = boxChars(options.unicode);
  const innerWidth = Math.max(0, options.width - 4);
  const safeValue = stripAnsi(value).length > innerWidth ? truncate(stripAnsi(value), innerWidth) : value;
  const padded = padAnsi(safeValue, innerWidth);

  return `${options.color.brand(chars.vertical)} ${padded} ${options.color.brand(chars.vertical)}`;
}

function boxChars(unicode) {
  if (!unicode) {
    return {
      topLeft: "+",
      topRight: "+",
      bottomLeft: "+",
      bottomRight: "+",
      middleLeft: "+",
      middleRight: "+",
      horizontal: "-",
      middle: "-",
      vertical: "|"
    };
  }

  return {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    middleLeft: "├",
    middleRight: "┤",
    horizontal: "─",
    middle: "─",
    vertical: "│"
  };
}

function divider(columns, unicode = true) {
  return (unicode ? "─" : "-").repeat(Math.max(24, Math.min(normalizeColumns(columns), PANEL_MAX_COLUMNS)));
}

function parseHex(value) {
  const normalized = value.replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
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

function panelWidth(columns) {
  return Math.max(24, Math.min(normalizeColumns(columns), PANEL_MAX_COLUMNS));
}

function padAnsi(value, width) {
  const visibleLength = stripAnsi(value).length;

  if (visibleLength >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - visibleLength)}`;
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
