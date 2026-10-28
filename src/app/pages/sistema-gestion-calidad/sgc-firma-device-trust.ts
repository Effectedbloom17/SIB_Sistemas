/** Confianza del dispositivo para la contraseña de firma (7 días, localStorage). */

const DIAS = 7;
const DEVICE_KEY = 'sgc-firma-device-id';
const TRUST_PREFIX = 'sgc-firma-trust-v1-';
const ITERACIONES = 120000;

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY) || '';
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID())
        || `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'device-local';
  }
}

function trustKey(usuarioId: number): string {
  return `${TRUST_PREFIX}${Number(usuarioId) || 0}`;
}

function aBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < view.length; i += 1) bin += String.fromCharCode(view[i]);
  return btoa(bin);
}

function desdeBase64(valor: string): Uint8Array {
  const bin = atob(valor);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function claveDispositivo(salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(deviceId()),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERACIONES, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface FirmaTrustInfo {
  activo: boolean;
  hasta: number | null;
}

export function leerInfoConfianzaFirma(usuarioId: number): FirmaTrustInfo {
  try {
    const raw = localStorage.getItem(trustKey(usuarioId));
    if (!raw) return { activo: false, hasta: null };
    const data = JSON.parse(raw);
    const hasta = Number(data?.hasta) || 0;
    if (!hasta || Date.now() > hasta) {
      localStorage.removeItem(trustKey(usuarioId));
      return { activo: false, hasta: null };
    }
    return { activo: true, hasta };
  } catch {
    return { activo: false, hasta: null };
  }
}

export async function recordarClaveFirma(usuarioId: number, password: string): Promise<void> {
  if (!usuarioId || !password || password.length < 8) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clave = await claveDispositivo(salt);
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    clave,
    new TextEncoder().encode(password)
  );
  const hasta = Date.now() + DIAS * 24 * 60 * 60 * 1000;
  localStorage.setItem(trustKey(usuarioId), JSON.stringify({
    hasta,
    salt: aBase64(salt),
    iv: aBase64(iv),
    cifrado: aBase64(cifrado)
  }));
}

export async function recuperarClaveFirma(usuarioId: number): Promise<string | null> {
  const info = leerInfoConfianzaFirma(usuarioId);
  if (!info.activo) return null;
  try {
    const raw = localStorage.getItem(trustKey(usuarioId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    const salt = desdeBase64(String(data.salt || ''));
    const iv = desdeBase64(String(data.iv || ''));
    const cifrado = desdeBase64(String(data.cifrado || ''));
    if (salt.length !== 16 || iv.length !== 12 || !cifrado.length) return null;
    const clave = await claveDispositivo(salt);
    const plano = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      clave,
      cifrado as BufferSource
    );
    const password = new TextDecoder().decode(plano);
    return password.length >= 8 ? password : null;
  } catch {
    olvidarClaveFirma(usuarioId);
    return null;
  }
}

export function olvidarClaveFirma(usuarioId: number): void {
  try {
    localStorage.removeItem(trustKey(usuarioId));
  } catch {
    /* sin storage */
  }
}
