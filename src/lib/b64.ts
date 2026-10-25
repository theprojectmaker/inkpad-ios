// Base64 <-> bytes without Node's Buffer (Hermes and browsers both have btoa/atob).
export function b64FromBytes(bytes: Uint8Array): string {
  let s = '';
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(s);
}

export function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
