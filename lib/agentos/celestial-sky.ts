export type CelestialSky = {
  accent: string;
  auroraOpacity: number;
  bottom: string;
  horizon: string;
  label: string;
  middle: string;
  moonOpacity: number;
  moonX: number;
  moonY: number;
  starOpacity: number;
  sunOpacity: number;
  sunX: number;
  sunY: number;
  top: string;
};

type SkyStop = {
  accent: string;
  auroraOpacity: number;
  bottom: string;
  horizon: string;
  label: string;
  middle: string;
  minute: number;
  starOpacity: number;
  top: string;
};

const SKY_STOPS: readonly SkyStop[] = [
  { minute: 0, label: "Midnight", top: "#020611", middle: "#081329", bottom: "#172443", horizon: "#293654", accent: "#7c8cff", starOpacity: 0.78, auroraOpacity: 0.3 },
  { minute: 240, label: "Before dawn", top: "#071127", middle: "#17264a", bottom: "#604d72", horizon: "#bc7690", accent: "#9c8cff", starOpacity: 0.5, auroraOpacity: 0.24 },
  { minute: 330, label: "First light", top: "#213963", middle: "#9b6986", bottom: "#f7a27f", horizon: "#ffd8a1", accent: "#ff8f70", starOpacity: 0.12, auroraOpacity: 0.12 },
  { minute: 420, label: "Sunrise", top: "#3d78b4", middle: "#8eb9d2", bottom: "#f7c59d", horizon: "#fff0c2", accent: "#ffb35c", starOpacity: 0, auroraOpacity: 0.08 },
  { minute: 570, label: "Morning", top: "#197ac3", middle: "#62b5dc", bottom: "#b9dfe9", horizon: "#e9f5e8", accent: "#7dd7f2", starOpacity: 0, auroraOpacity: 0.08 },
  { minute: 750, label: "Solar noon", top: "#086db7", middle: "#51acd4", bottom: "#b5dde2", horizon: "#eef2d8", accent: "#8be4ef", starOpacity: 0, auroraOpacity: 0.06 },
  { minute: 990, label: "Late afternoon", top: "#1767aa", middle: "#69a7c6", bottom: "#ecc5a3", horizon: "#ffe2a2", accent: "#f6c66f", starOpacity: 0, auroraOpacity: 0.1 },
  { minute: 1110, label: "Golden hour", top: "#344f88", middle: "#b6758d", bottom: "#f18769", horizon: "#ffd27c", accent: "#ff8b5b", starOpacity: 0.04, auroraOpacity: 0.16 },
  { minute: 1200, label: "Sunset", top: "#17294f", middle: "#68466d", bottom: "#c95d68", horizon: "#f6a064", accent: "#ff6f61", starOpacity: 0.18, auroraOpacity: 0.24 },
  { minute: 1290, label: "Blue hour", top: "#09162f", middle: "#1e3155", bottom: "#554b70", horizon: "#a55e7b", accent: "#7d8dff", starOpacity: 0.52, auroraOpacity: 0.34 },
  { minute: 1440, label: "Midnight", top: "#020611", middle: "#081329", bottom: "#172443", horizon: "#293654", accent: "#7c8cff", starOpacity: 0.78, auroraOpacity: 0.3 }
] as const;

export function getCelestialSky(date: Date): CelestialSky {
  return getCelestialSkyAtMinute(date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60);
}

export function getCelestialSkyAtMinute(rawMinute: number): CelestialSky {
  const minute = ((rawMinute % 1440) + 1440) % 1440;
  const nextIndex = SKY_STOPS.findIndex((stop) => stop.minute >= minute);
  const end = SKY_STOPS[Math.max(1, nextIndex)];
  const start = SKY_STOPS[Math.max(0, nextIndex - 1)];
  const progress = smoothstep((minute - start.minute) / Math.max(1, end.minute - start.minute));
  const sunProgress = clamp((minute - 330) / (1200 - 330));
  const sunVisible = smoothWindow(minute, 315, 355, 1180, 1220);
  const nightMinute = minute < 360 ? minute + 1440 : minute;
  const moonProgress = clamp((nightMinute - 1200) / (1800 - 1200));
  const moonVisible = Math.max(
    smoothWindow(nightMinute, 1170, 1230, 1740, 1800),
    smoothWindow(minute, -30, 30, 300, 360)
  );

  return {
    accent: mixHex(start.accent, end.accent, progress),
    auroraOpacity: mix(start.auroraOpacity, end.auroraOpacity, progress),
    bottom: mixHex(start.bottom, end.bottom, progress),
    horizon: mixHex(start.horizon, end.horizon, progress),
    label: progress < 0.5 ? start.label : end.label,
    middle: mixHex(start.middle, end.middle, progress),
    moonOpacity: moonVisible,
    moonX: 8 + moonProgress * 84,
    moonY: 77 - Math.sin(moonProgress * Math.PI) * 65,
    starOpacity: mix(start.starOpacity, end.starOpacity, progress),
    sunOpacity: sunVisible,
    sunX: 8 + sunProgress * 84,
    sunY: 78 - Math.sin(sunProgress * Math.PI) * 68,
    top: mixHex(start.top, end.top, progress)
  };
}

function smoothWindow(value: number, fadeInStart: number, fullStart: number, fullEnd: number, fadeOutEnd: number) {
  if (value <= fadeInStart || value >= fadeOutEnd) return 0;
  if (value < fullStart) return smoothstep((value - fadeInStart) / (fullStart - fadeInStart));
  if (value > fullEnd) return 1 - smoothstep((value - fullEnd) / (fadeOutEnd - fullEnd));
  return 1;
}

function smoothstep(value: number) {
  const normalized = clamp(value);
  return normalized * normalized * (3 - 2 * normalized);
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mix(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function mixHex(start: string, end: string, progress: number) {
  const from = hexToRgb(start);
  const to = hexToRgb(end);
  const channels = from.map((value, index) => Math.round(mix(value, to[index], progress)));
  return `rgb(${channels.join(" ")})`;
}

function hexToRgb(value: string) {
  const normalized = value.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}
