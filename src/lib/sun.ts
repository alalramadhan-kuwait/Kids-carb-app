// Sunrise and sunset for Kuwait City (NOAA's sunrise equation, ±2 minutes), for shading night on the home graph.
// Kuwait keeps UTC+3 all year (no daylight saving), so a Kuwait day starts at 21:00 UTC the day before.

const RAD = Math.PI / 180, DAY = 86400000, KW = 3 * 3600000;
export const KUWAIT = { lat: 29.3759, lon: 47.9774 };

/** Sunrise and sunset (epoch ms) of the Kuwait calendar day that contains `ms`. */
export function sunTimes(ms: number, lat = KUWAIT.lat, lon = KUWAIT.lon): { rise: number; set: number } {
  const day0 = Math.floor((ms + KW) / DAY) * DAY;                     // 00:00 of that day, as if it were UTC
  const n = Math.round((day0 + 12 * 3600000) / DAY + 2440587.5 - 2451545.0 + 0.0008); // days since J2000 at noon
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const dec = Math.asin(Math.sin(L * RAD) * Math.sin(23.4397 * RAD));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
  const toMs = (j: number) => (j - 2440587.5) * DAY;
  return { rise: toMs(Jtransit - H / 360), set: toMs(Jtransit + H / 360) };
}
