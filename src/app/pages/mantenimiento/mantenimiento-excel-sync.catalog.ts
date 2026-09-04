/** Estado de sincronización Excel/Drive para EIN-F-01 y EIN-F-03 */

export const STORAGE_KEY_F01_DRIVE = 'biznaga:ein-f01:drive';
export const STORAGE_KEY_F03_DRIVE = 'biznaga:ein-f03:drive';

/** Plantilla Google Sheets oficial EIN-F-01 */
export const EIN_F01_TEMPLATE_ID = '1MaXJjsd9IcjiNd70Z4zXmzouEP0pZG_k9l6izOkGSng';

/** Plantilla Google Sheets oficial EIN-F-03 */
export const EIN_F03_TEMPLATE_ID = '1CmYDinQTOv_nuDUTa0AmiWwgN-pWJWgypQifVOU0oi0';

export interface MantenimientoDriveState {
  driveFileId?: string;
  webViewLink?: string;
  nombre?: string;
  templateId?: string;
  actualizadoEn?: string;
}

export function cargarDriveState(key: string): MantenimientoDriveState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as MantenimientoDriveState;
  } catch {
    return {};
  }
}

export function guardarDriveState(key: string, state: MantenimientoDriveState): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ ...state, actualizadoEn: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}
