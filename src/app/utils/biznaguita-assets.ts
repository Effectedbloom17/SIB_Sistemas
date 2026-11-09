/**
 * Rutas de mascota Biznaguita.
 * En Linux (producción) la carpeta puede existir como Biznaguita o biznaguita.
 * Preferimos mayúscula (como en prod) y hacemos fallback a minúscula.
 */
export function biznaguitaAsset(fileName: string, preferCapital = true): string {
  const nombre = String(fileName || '').replace(/^\/+/, '');
  const carpeta = preferCapital ? 'Biznaguita' : 'biznaguita';
  return `assets/img/${carpeta}/${nombre}`;
}

/** onerror en <img>: prueba la otra capitalización una sola vez. */
export function onBiznaguitaAssetError(event: Event, fileName: string): void {
  const img = event?.target as HTMLImageElement | null;
  if (!img || img.dataset['bizCaseTried'] === '1') return;
  img.dataset['bizCaseTried'] = '1';
  const src = String(img.getAttribute('src') || '');
  const veniaEnMayuscula = src.includes('/Biznaguita/');
  img.src = biznaguitaAsset(fileName, !veniaEnMayuscula);
}
