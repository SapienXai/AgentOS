import RFB from "/novnc/core/rfb.js";

const parentOrigin = window.location.origin;
const screen = document.getElementById("screen");
const path = new URLSearchParams(window.location.search).get("path") || "";
const allowedPath =
  /^api\/accounts\/browser-live\/ws\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let rfb = null;
let generation = 0;
let selectedMode = "adaptive";

function notify(type, status) {
  window.parent.postMessage(
    {
      source: "agentos-secure-browser",
      type,
      ...(status ? { status } : {})
    },
    parentOrigin
  );
}

function websocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/${path}`;
}

function configure(mode) {
  if (!rfb || !["adaptive", "fit", "actual"].includes(mode)) return;
  selectedMode = mode;
  rfb.scaleViewport = mode === "fit";
  rfb.resizeSession = mode === "adaptive";
  rfb.clipViewport = false;
  rfb.dragViewport = false;
}

function connect() {
  if (!allowedPath.test(path)) {
    notify("status", "error");
    return;
  }

  const activeGeneration = ++generation;
  notify("status", "connecting");
  screen.replaceChildren();

  try {
    rfb = new RFB(screen, websocketUrl(), { shared: true });
    rfb.focusOnClick = true;
    rfb.showDotCursor = true;
    rfb.qualityLevel = 7;
    rfb.compressionLevel = 3;
    configure(selectedMode);

    rfb.addEventListener("connect", () => {
      if (activeGeneration !== generation) return;
      configure(selectedMode);
      rfb.focus();
      notify("status", "connected");
    });
    rfb.addEventListener("disconnect", (event) => {
      if (activeGeneration !== generation) return;
      notify("status", event.detail.clean ? "disconnected" : "error");
    });
    rfb.addEventListener("credentialsrequired", () => {
      if (activeGeneration !== generation) return;
      notify("status", "error");
      rfb.disconnect();
    });
    rfb.addEventListener("securityfailure", () => {
      if (activeGeneration !== generation) return;
      notify("status", "error");
    });
  } catch {
    notify("status", "error");
  }
}

window.addEventListener("message", (event) => {
  if (
    event.origin !== parentOrigin ||
    event.source !== window.parent ||
    !event.data ||
    event.data.source !== "agentos-live-view"
  ) {
    return;
  }

  switch (event.data.command) {
    case "configure":
      configure(event.data.mode);
      break;
    case "focus":
      rfb?.focus();
      break;
    case "ctrl-alt-delete":
      rfb?.sendCtrlAltDel();
      break;
    case "reconnect":
      generation += 1;
      rfb?.disconnect();
      window.setTimeout(connect, 120);
      break;
  }
});

screen.addEventListener("pointerdown", () => rfb?.focus());
window.addEventListener("beforeunload", () => rfb?.disconnect());

notify("ready");
connect();
