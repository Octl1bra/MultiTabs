import type { PatchConfig } from "./types";

export const SIGNAL_NAME = "mt";
/** 超过这个长度不生成信号，只靠兜底路径 */
export const SIGNAL_MAX_BYTES = 16 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeSignalDesc(cfg: PatchConfig): string | null {
  const json = JSON.stringify(cfg);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > SIGNAL_MAX_BYTES) return null;
  return toBase64Url(bytes);
}

/** 完整的 Server-Timing 头值 */
export function encodeSignalHeader(cfg: PatchConfig): string | null {
  const desc = encodeSignalDesc(cfg);
  return desc === null ? null : `${SIGNAL_NAME};desc="${desc}"`;
}

export function decodeSignalDesc(desc: string): PatchConfig | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(desc));
    const v = JSON.parse(json);
    if (!v || typeof v.sid !== "string" || !Array.isArray(v.cookies)) return null;
    return v as PatchConfig;
  } catch {
    return null;
  }
}
