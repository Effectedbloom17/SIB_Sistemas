const ITERACIONES = 210000;

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

async function derivarClave(password: string, salt: Uint8Array, iteraciones: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iteraciones, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function cifrarFirma(bytes: ArrayBuffer, password: string): Promise<{
  cifrado: string;
  salt: string;
  iv: string;
  iteraciones: number;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clave = await derivarClave(password, salt, ITERACIONES);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, clave, bytes);
  return {
    cifrado: aBase64(cifrado),
    salt: aBase64(salt),
    iv: aBase64(iv),
    iteraciones: ITERACIONES
  };
}

export async function imagenAPngBase64(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar el PNG.');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

export async function descifrarFirma(paquete: {
  cifrado: string;
  salt: string;
  iv: string;
  iteraciones: number;
}, password: string): Promise<Blob> {
  const salt = desdeBase64(paquete.salt);
  const iv = desdeBase64(paquete.iv);
  const data = desdeBase64(paquete.cifrado);
  const clave = await derivarClave(password, salt, Number(paquete.iteraciones) || ITERACIONES);
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, clave, data as BufferSource);
  return new Blob([plano], { type: 'image/png' });
}
