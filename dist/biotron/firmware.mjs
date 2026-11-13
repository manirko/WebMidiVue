// https://github.com/Playtronica/biotron-firmware/releases/tag/1.8.2 · published 2025-12-14 · checked 2026-11-13.
export const BIOTRON_FIRMWARE = '1.8.2';
export const FIRMWARE_URL = 'https://settings.playtronica.com/#/biotron';
export function parseVersionReply(data, outputIndex) {
  const b = Array.from(data || []);
  if (b.length !== 8 || b[0] !== 240 || b[1] !== 11 || b[2] !== 126 || b[3] !== outputIndex || b[7] !== 247 ||
      !b.slice(1,-1).every(value => Number.isInteger(value) && value >= 0 && value < 128)) return null;
  return b.slice(4,7).join('.');
}
export function needsFirmwareUpdate(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) &&
    version.split('.').every(v => Number(v) < 128) && version.split('.').map(Number).join('.') !== BIOTRON_FIRMWARE;
}
