export interface PasoFlujoSgc {
  num: number;
  titulo: string;
  estado: 'done' | 'current' | 'todo';
}

export interface TarjetaCapituloSgc {
  slug: string;
  numero: number;
  titulo: string;
  descripcion: string;
  iconClass: string;
  colorInicio: string;
  colorFin: string;
  totalFormatos: number;
}

export interface FormatoBusquedaItem {
  capituloSlug: string;
  capituloNumero: number;
  capituloTitulo: string;
  colorInicio: string;
  colorFin: string;
  codigo: string;
  titulo: string;
  nombre: string;
  previewSlug?: string;
}
