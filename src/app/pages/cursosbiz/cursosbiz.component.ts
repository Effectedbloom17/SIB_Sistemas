import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackendServices } from '../../services/backend.services';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-cursosbiz',
  templateUrl: './cursosbiz.component.html',
  styleUrls: ['./cursosbiz.component.scss']
})
export class CursosbizComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  categoria: string = '';
  cursos: any[] = [];
  cursosFiltrados: any[] = [];
  filtroNombre: string = '';
  loading: boolean = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backendServices: BackendServices
  ) { }

  ngOnInit() {
    // Escuchar cambios en la URL (por si el usuario cambia de categoría sin recargar)
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.categoria = params['categoria'] || 'seguridad';
      this.cursos = [];
      this.cursosFiltrados = [];
      this.cargarCursosDesdeBD();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargarCursosDesdeBD() {
    this.loading = true;
    this.backendServices.cursos().pipe(takeUntil(this.destroy$)).subscribe(
      (data: any[]) => {
        // La vista v_cursos_completo devuelve: nombre_area, area_slug, area_icono, area_color
        this.cursos = data
          .map(cursoBD => {
            const slug = cursoBD.area_slug || 'areas-diversas';
            return {
              id: cursoBD.curso_id,
              nombre: cursoBD.nombre_curso,
              descripcion: cursoBD.descripcion || 'Sin descripción disponible',
              horas: cursoBD.horas || 0,
              icono: cursoBD.area_icono || 'fa-shapes',
              color: '#E67E22',
              slugCategoria: slug,
              imagen: this.resolverUrlImagenConVersion(cursoBD.imagen, cursoBD.imagen_updated_at)
                || this.resolverImagenCurso(cursoBD.nombre_curso)
            };
          })
          .filter(c => c.slugCategoria === this.categoria);

        this.cursosFiltrados = [...this.cursos];
        this.loading = false;
      },
      (error) => {
        console.error('Error al cargar cursos', error);
        this.loading = false;
      }
    );
  }

  filtrarCursos() {
    if (!this.filtroNombre || this.filtroNombre.trim() === '') {
      this.cursosFiltrados = [...this.cursos];
    } else {
      const filtro = this.filtroNombre.toLowerCase();
      this.cursosFiltrados = this.cursos.filter(c =>
        c.nombre.toLowerCase().includes(filtro) ||
        c.descripcion.toLowerCase().includes(filtro)
      );
    }
  }

  abrirCurso(cursoId: number) {
    // Encontrar el curso para obtener su nombre
    const curso = this.cursos.find(c => c.id === cursoId);
    const nombreCurso = curso ? curso.nombre : 'Curso';

    // Navegar a información general con el ID del curso, nombre y categoría de origen
    this.router.navigate(['/informacion-general', cursoId], {
      queryParams: { nombre: nombreCurso, categoria: this.categoria }
    });
  }

  volverAlInicio() {
    this.router.navigate(['/home']);
  }

  getNombreCategoria(slug: string): string {
    const categorias: any = {
      'seguridad': 'Seguridad General',
      'higiene-seguridad': 'Higiene y Seguridad',
      'areas-diversas': 'Áreas Diversas',
      'cursos-especiales': 'Cursos especiales',
      'salud': 'Salud y Bienestar',
      'ambientales': 'Medio Ambiente',
      'productividad': 'Productividad',
      'conduccion-vehiculos': 'Conducción'
    };
    return categorias[slug] || 'Cursos Disponibles';
  }

  volverACategorias() {
    this.router.navigate(['/home']);
  }

  /** Mapa de nombre de curso → archivo de imagen (precalculado en ngOnInit) */
  private imagenesDisponibles: { [key: string]: string } = {};
  private imagenesInit = false;

  /**
   * Resuelve la ruta de imagen para un curso.
   * Busca coincidencia exacta o parcial con los archivos en assets/img/imag_cursos.
   */
  resolverImagenCurso(nombreCurso: string): string | null {
    if (!nombreCurso) return null;
    // Inicializar mapa de imágenes disponibles (solo la primera vez)
    if (!this.imagenesInit) {
      this.inicializarMapaImagenes();
      this.imagenesInit = true;
    }
    const key = this.normalizarNombre(nombreCurso);
    const keyCompacto = this.normalizarCompacto(nombreCurso);
    // Búsqueda exacta
    if (this.imagenesDisponibles[key]) {
      return this.imagenesDisponibles[key];
    }
    // Búsqueda parcial: nombre contiene archivo o viceversa
    for (const [imgKey, imgPath] of Object.entries(this.imagenesDisponibles)) {
      if (key.includes(imgKey) || imgKey.includes(key)) {
        return imgPath;
      }
    }
    // Búsqueda compacta (sin espacios) para nombres con caracteres especiales como ISO 14001:2015
    for (const [imgKey, imgPath] of Object.entries(this.imagenesDisponibles)) {
      const imgKeyCompacto = imgKey.replace(/\s+/g, '');
      if (keyCompacto.includes(imgKeyCompacto) || imgKeyCompacto.includes(keyCompacto)) {
        return imgPath;
      }
    }
    return null;
  }

  private normalizarNombre(nombre: string): string {
    if (!nombre) return '';
    return String(nombre)
      .toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
      .replace(/[^A-Z0-9 ]/g, '')  // quitar símbolos (incluyendo : ; etc)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Versión compacta sin espacios para matching más agresivo */
  private normalizarCompacto(nombre: string): string {
    return this.normalizarNombre(nombre).replace(/\s+/g, '');
  }

  private inicializarMapaImagenes(): void {
    // Lista de archivos en assets/img/imag_cursos
    const archivos = [
      'AUDITOR INTERNO EN LAS NORMAS ISO 140012015 E ISO 450012018.png',
      'AUDITOR LIDER ISO 9001 2015.jpg',
      'AVANZADO ISO 9001 2015.jpg',
      'BUSQUEDA Y RESCATE.jpg',
      'CAMBIO CLIMATICO Y REDUCCION DE RIESGOS DE DESASTRES.png',
      'CAPACITACION Y FUNCIONAMIENTO DE LAS COMISIONES DE SEGURIDAD E HIGIENE.jpg',
      'COMISION DE SEGURIDAD E HIGIENE.jpg',
      'CONDICIONES DE SEGURIDAD Y SALUD EN LA CONSTRUCCION (NOM-031-STPS-2011).jpg',
      'DESARROLLO DE HABILIDADES GERENCIALES LIDER DE LIDERES.png',
      'ERGONOMIA DEL TRABAJO.jpg',
      'EVACUACION DE INMUEBLES.jpg',
      'FORMACION DE INSTRUCTORES DE PRIMEROS RESPONDIENTES EN PRIMEROS AUXILIOS.jpg',
      'IDENTIFICACION DE TUBERIAS Y SEÑALES DE SEGURIDAD (NOM-026-STPS-2008).jpg',
      'INTERPRETACION A LAS NORMAS ISO 140012015 E ISO 450012018.png',
      'INVESTIGACION DE INCIDENTES Y ANALISIS DE CAUSA RAIZ.png',
      'LIDER DE LIDERES.png',
      'MANEJO A LA DEFENSIVA.jpg',
      'MANTENIMIENTO INSTALACIONES ELECTRICAS (NOM-029-STPS-2011).jpg',
      'METODOLOGIA DE ANALISIS DE RIESGOS EN LOS PROCESOS.png',
      'METODOLOGIA DE ENTRENAMIENTO EMPRESARIAL SUSTENTABLE CEFE.jpg',
      'NOM 005-STPS-MANEJO, TRANSPORTE Y ALMACENAMIENTO DE SUSTANCIAS QUIMICAS PELIGROSAS.png',
      'NOM 017 STPS 2008.png',
      'NOM 026 STPS 2008.png',
      'NOM 18 SISTEMA GLOBALMENTE ARMONIZADO.png',
      'NOM-035-STPS-2018 FACTORES DE RIESGO PSICOSOCIAL EN EL TRABAJO - IDENTIFICACION, ANALISIS Y PREVENCION.jpg',
      'OPERACION SEGURA DE MONTACARGAS.jpg',
      'PREVENCION PARA TRABAJOS EN ALTURA (NOM-009-STPS-2011).png',
      'PREVENCION RIESGOS POR ELECTRICIDAD ESTATICA (NOM-022-STPS-2015).jpg',
      'PREVENCION Y COMBATE A INCENDIOS.png',
      'PREVENCION Y CONTROL DE DERRAMES.png',
      'PRIMEROS AUXILIOS.png',
      'RIESGOS DE MAQUINARIA (NOM-004-STPS-1999).jpg',
      'SALUD EN EL TRABAJO.png',
      'SEGURIDAD INDUSTRIAL Y PREVENCION DE RIESGOS.jpg',
      'SEGURIDAD PARA TRABAJO EN ESPACIOS CONFINADOS (NOM-033-STPS-2015).jpg',
      'SOLDADURA Y OXICORTE.jpg',
      'TRABAJO EN ALTURAS, NOM 004-STPS-2011 CONDICIONES DE SEGURIDAD PARA REALIZAR TRABAJOS EN ALTURAS.jpg',
      'AISLAMIENTO DE ENERGÍAS PELIGROSAS MEDIANTE BLOQUEOS Y ETIQUETAS (LOTO).jpg',
      'CONDICIONES DE ILUMINACION NOM-025-STPS-2008.jpg',
      'MANEJO DE EMERGENCIAS Y USO DE EXTINTOR.jpg',
      'PREVENCIÓN DE LESIONES MUSCULOESQUELETICAS POR CARGA.jpg'
    ];
    for (const archivo of archivos) {
      const sinExt = archivo.replace(/\.(png|jpg|jpeg)$/i, '');
      const key = this.normalizarNombre(sinExt);
      this.imagenesDisponibles[key] = 'assets/img/imag_cursos/' + archivo;
    }
  }

  private normalizarUrlImagen(url: string | null | undefined): string | null {
    if (!url) return null;
    if (/^(blob:|data:)/i.test(url)) return url;
    if (/^https?:\/\//i.test(url) || url.startsWith('assets/')) return url;
    const apiBase = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${apiBase}${url}`;
  }

  private normalizarVersionImagen(valor: unknown): string | null {
    if (!valor) return null;

    if (valor instanceof Date) {
      return String(valor.getTime());
    }

    const texto = String(valor).trim();
    if (!texto) return null;

    if (/^\d+$/.test(texto)) {
      return texto;
    }

    const timestamp = Date.parse(texto);
    if (!Number.isNaN(timestamp)) {
      return String(timestamp);
    }

    return texto;
  }

  private resolverUrlImagenConVersion(url: string | null | undefined, imagenUpdatedAt?: unknown): string | null {
    const normalizada = this.normalizarUrlImagen(url);
    if (!normalizada) return null;

    const version = this.normalizarVersionImagen(imagenUpdatedAt);
    if (!version) return normalizada;

    const separador = normalizada.includes('?') ? '&' : '?';
    return `${normalizada}${separador}v=${version}`;
  }

  onImageError(curso: any): void {
    curso.imagen = null; // fallback al diseño con ícono
  }
}