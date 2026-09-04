import { Component, OnInit, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { HistorialPendientesService, HistorialPendienteItem } from 'src/app/services/historial-pendientes.service';
import { Observable, firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import Swal from 'sweetalert2';
import {
  formatearFechaCursoEs,
  obtenerFinDiaTimestamp,
  parsearFechaSoloDia
} from 'src/app/utils/fecha.util';

interface CursoImpartido {
  programado_id: number;
  curso_id: number;
  nombre_curso: string;
  empresa_id: number;
  nombre_empresa: string;
  instructor_id?: number;
  rfc?: string;
  instructor_nombre?: string;
  fecha_inicio: Date;
  fecha_fin?: Date;
  modalidad?: string;
  lugar?: string;
  estado?: string;
  ciudad?: string;
  total_participantes?: number;
  estatus?: string;
  estatus_acreditaciones?: string;
  tiene_entrega_documentos?: number | boolean | null;
  anexo_subido?: number | boolean | null;
  tiene_anexo?: number | boolean | null;
  anexo_firmado_subido?: number | boolean | null;
  estatus_anexo?: string;
  estatus_entrega_documentos?: string;
  empresa_logo?: string | null;
  logo?: string | null;
  logo_url?: string | null;
}

interface EmpresaConHistorial {
  empresa_id: number;
  nombre_empresa: string;
  rfc?: string;
  estado?: string;
  ciudad?: string;
  logo?: string | null;
  logo_url?: string | null;
  total_cursos: number;
  total_cursos_filtrados?: number;
  ultima_fecha?: Date;
}

@Component({
  selector: 'app-historial-cursos',
  templateUrl: './historial-cursos.component.html',
  styleUrls: ['./historial-cursos.component.scss']
})
export class HistorialCursosComponent implements OnInit {
  private readonly estatusNoFinalizados = new Set(['programado', 'en_curso', 'pospuesto', 'cancelado']);
  private readonly estatusFinalizados = new Set(['completado', 'finalizado', 'cerrado', 'terminado']);
  private readonly FILTROS_STORAGE_PREFIX = 'historial-cursos-filtros';
  private restaurandoEstadoFiltros = false;
  private empresaSeleccionadaIdRestaurada: number | null = null;

  cargando = false;
  esPerfilAdmin = false;
  esPerfilSgc = false;
  esPerfilEmpresa = false;
  esPerfilInstructor = false;
  empresaUsuarioId: number | null = null;
  instructorUsuarioId: number | null = null;

  readonly empresasPageSizeNormal = 6;
  readonly empresasPageSizeCompacto = 9;
  readonly cursosPageSizeNormal = 5;
  readonly cursosPageSizeCompacto = 8;
  modoVisual: 'normal' | 'compacto' = 'normal';

  empresasVisibleLimit = this.empresasPageSize;
  cursosVisibleLimit = this.cursosPageSize;
  empresasCurrentPage = 1;
  cursosCurrentPage = 1;

  cursosImpartidos: CursoImpartido[] = [];
  empresas: EmpresaConHistorial[] = [];
  empresasFiltradas: EmpresaConHistorial[] = [];
  descargandoZipProgramadoId: number | null = null;
  imprimiendoProgramadoId: number | null = null;
  limpiandoConstanciasProgramadoId: number | null = null;

  empresaSeleccionada: EmpresaConHistorial | null = null;
  cursosEmpresaFiltrados: CursoImpartido[] = [];

  textoBusquedaEmpresa = '';
  estadoSeleccionado = '';
  municipioSeleccionado = '';
  estados: string[] = [];
  municipios: string[] = [];

  anoSeleccionado = 0;
  mesSeleccionado = 0;
  filtroAnexoSubido = '';
  anosDisponibles: number[] = [];
  readonly meses = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' }
  ];

  private programadoIdDeepLink: number | null = null;

  /** Alertas de cursos finalizados sin gestionar (solo admins). */
  alertasPendientesAbiertas = false;
  cursosPendientesGestion: HistorialPendienteItem[] = [];
  filtroAlertasBusqueda = '';

  constructor(
    private backendService: BackendServices,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private historialPendientes: HistorialPendientesService
  ) {}

  ngOnInit(): void {
    this.empresaUsuarioId = this.authService.getEmpresaId();
    this.instructorUsuarioId = this.authService.getInstructorId();
    this.esPerfilAdmin = this.authService.esAdministradorOSuperior()
      || this.authService.tieneRol('control_documental');
    this.esPerfilSgc = this.authService.tieneAlgunRol(['sgc']);
    this.esPerfilEmpresa = !this.esPerfilAdmin && !this.esPerfilSgc
      && !!this.empresaUsuarioId
      && this.authService.tieneAlgunRol(['empresa', 'consulta']);
    this.esPerfilInstructor = !this.esPerfilAdmin && !this.esPerfilSgc
      && this.authService.esInstructor() && !this.esPerfilEmpresa;
    this.aplicarDeepLinkQueryParams();
    if (!this.empresaSeleccionadaIdRestaurada && !this.filtroAnexoSubido && !this.programadoIdDeepLink) {
      this.restaurarEstadoFiltros();
    }
    this.restaurandoEstadoFiltros = true;
    this.cargarCursosConHistorial();

    if (this.authService.puedeGestionarHistorialPendientes()) {
      this.historialPendientes.refrescar().subscribe();
      this.historialPendientes.items$.subscribe((items) => {
        this.cursosPendientesGestion = items || [];
      });
    }
  }

  @HostListener('document:click')
  cerrarAlertasPendientes(): void {
    if (this.alertasPendientesAbiertas) {
      this.filtroAlertasBusqueda = '';
    }
    this.alertasPendientesAbiertas = false;
  }

  toggleAlertasPendientes(event: Event): void {
    event.stopPropagation();
    this.alertasPendientesAbiertas = !this.alertasPendientesAbiertas;
    if (this.alertasPendientesAbiertas) {
      this.historialPendientes.refrescar();
    }
  }

  get mostrarBotonAlertasPendientes(): boolean {
    return this.authService.puedeGestionarHistorialPendientes();
  }

  get totalAlertasPendientes(): number {
    return this.cursosPendientesGestion.length;
  }

  get cursosPendientesFiltrados(): HistorialPendienteItem[] {
    const q = String(this.filtroAlertasBusqueda || '').trim().toLowerCase();
    if (!q) {
      return this.cursosPendientesGestion;
    }
    return this.cursosPendientesGestion.filter((item) => {
      const curso = String(item?.nombre_curso || '').toLowerCase();
      const empresa = String(item?.nombre_empresa || '').toLowerCase();
      const fecha = this.formatearFechaFinalizacion(item).toLowerCase();
      return curso.includes(q) || empresa.includes(q) || fecha.includes(q);
    });
  }

  formatearFechaFinalizacion(item: HistorialPendienteItem): string {
    const raw = item?.historial_finalizado_at || item?.updated_at;
    if (!raw) return 'Fecha no disponible';
    return formatearFechaCursoEs(raw);
  }

  abrirAlertaPendiente(item: HistorialPendienteItem, event: Event): void {
    event.stopPropagation();
    this.alertasPendientesAbiertas = false;
    if (!item?.programado_id || !item?.curso_id) {
      return;
    }
    this.historialPendientes.marcarConsultado(item.programado_id);
    this.router.navigate(['/informacion-general', item.curso_id], {
      queryParams: {
        nombre: item.nombre_curso,
        categoria: 'seguridad',
        origen: 'historial-cursos',
        vista: 'historial',
        programado_id: item.programado_id,
        empresa_id: item.empresa_id
      }
    });
  }

  trackByPendienteId(_i: number, item: HistorialPendienteItem): number {
    return Number(item?.programado_id) || _i;
  }

  private aplicarDeepLinkQueryParams(): void {
    const qp = this.route.snapshot.queryParamMap;
    const empresaId = Number(qp.get('empresa_id') || 0);
    const filtroAnexo = String(qp.get('filtro_anexo') || '').trim();
    const programadoId = Number(qp.get('programado_id') || 0);

    if (empresaId > 0) {
      this.empresaSeleccionadaIdRestaurada = empresaId;
    }
    if (filtroAnexo === 'sin_anexo' || filtroAnexo === 'con_anexo') {
      this.filtroAnexoSubido = filtroAnexo;
    }
    if (programadoId > 0) {
      this.programadoIdDeepLink = programadoId;
    }
  }

  private getStorageKeyFiltros(): string {
    const usuarioId = this.authService.getUsuarioId() || 'anon';
    return `${this.FILTROS_STORAGE_PREFIX}-${usuarioId}`;
  }

  private guardarEstadoFiltros(): void {
    try {
      sessionStorage.setItem(this.getStorageKeyFiltros(), JSON.stringify({
        textoBusquedaEmpresa: this.textoBusquedaEmpresa,
        estadoSeleccionado: this.estadoSeleccionado,
        municipioSeleccionado: this.municipioSeleccionado,
        empresasCurrentPage: this.empresasCurrentPage,
        empresaSeleccionadaId: this.empresaSeleccionada?.empresa_id ?? null,
        anoSeleccionado: this.anoSeleccionado,
        mesSeleccionado: this.mesSeleccionado,
        filtroAnexoSubido: this.filtroAnexoSubido,
        cursosCurrentPage: this.cursosCurrentPage
      }));
    } catch (_) { /* sessionStorage no disponible */ }
  }

  private restaurarEstadoFiltros(): void {
    try {
      const raw = sessionStorage.getItem(this.getStorageKeyFiltros());
      if (!raw) return;

      const estado = JSON.parse(raw);
      this.textoBusquedaEmpresa = typeof estado.textoBusquedaEmpresa === 'string' ? estado.textoBusquedaEmpresa : '';
      this.estadoSeleccionado = typeof estado.estadoSeleccionado === 'string' ? estado.estadoSeleccionado : '';
      this.municipioSeleccionado = typeof estado.municipioSeleccionado === 'string' ? estado.municipioSeleccionado : '';
      this.empresasCurrentPage = Number(estado.empresasCurrentPage) > 0 ? Number(estado.empresasCurrentPage) : 1;
      this.empresaSeleccionadaIdRestaurada = Number.isFinite(Number(estado.empresaSeleccionadaId))
        ? Number(estado.empresaSeleccionadaId)
        : null;
      this.anoSeleccionado = Number(estado.anoSeleccionado) || 0;
      this.mesSeleccionado = Number(estado.mesSeleccionado) || 0;
      this.filtroAnexoSubido = typeof estado.filtroAnexoSubido === 'string' ? estado.filtroAnexoSubido : '';
      this.cursosCurrentPage = Number(estado.cursosCurrentPage) > 0 ? Number(estado.cursosCurrentPage) : 1;
    } catch (_) { /* estado corrupto, usar valores por defecto */ }
  }

  private finalizarRestauracionFiltros(): void {
    this.restaurarEmpresaSeleccionada();
    this.abrirCursoDesdeDeepLink();
    this.restaurandoEstadoFiltros = false;
    this.ajustarPaginacionValida();
    this.guardarEstadoFiltros();
  }

  private abrirCursoDesdeDeepLink(): void {
    if (!this.programadoIdDeepLink) return;
    const curso = this.cursosImpartidos.find((c) => Number(c.programado_id) === this.programadoIdDeepLink);
    this.programadoIdDeepLink = null;
    if (curso) {
      this.abrirDetalleCurso(curso);
    }
  }

  private restaurarEmpresaSeleccionada(): void {
    if (!this.empresaSeleccionadaIdRestaurada || this.esPerfilEmpresa) {
      return;
    }

    const empresa = this.empresasFiltradas.find((item) => item.empresa_id === this.empresaSeleccionadaIdRestaurada);
    if (empresa) {
      this.seleccionarEmpresa(empresa, true);
    }

    this.empresaSeleccionadaIdRestaurada = null;
  }

  private ajustarPaginacionValida(): void {
    if (this.totalEmpresasPages > 0 && this.empresasCurrentPage > this.totalEmpresasPages) {
      this.empresasCurrentPage = this.totalEmpresasPages;
    }
    if (this.totalCursosPages > 0 && this.cursosCurrentPage > this.totalCursosPages) {
      this.cursosCurrentPage = this.totalCursosPages;
    }
  }

  // trackBy: evita re-render completo de las tarjetas de empresas/cursos al paginar o filtrar.
  trackByEmpresaId(_index: number, empresa: any): any {
    return empresa?.empresa_id ?? _index;
  }

  trackByCursoProgramado(_index: number, curso: any): any {
    return curso?.programado_id ?? _index;
  }

  get mostrarSelectorEmpresas(): boolean {
    return !this.esPerfilEmpresa;
  }

  get tituloPrincipal(): string {
    if (this.esPerfilEmpresa) {
      return 'Historial de cursos finalizados de tu empresa';
    }

    if (this.esPerfilInstructor) {
      return 'Mis cursos finalizados';
    }

    return 'Seleccionar empresa con cursos finalizados';
  }

  get totalCursosImpartidos(): number {
    return this.cursosImpartidos.length;
  }

  get empresasPageSize(): number {
    return this.modoVisual === 'compacto'
      ? this.empresasPageSizeCompacto
      : this.empresasPageSizeNormal;
  }

  get cursosPageSize(): number {
    return this.modoVisual === 'compacto'
      ? this.cursosPageSizeCompacto
      : this.cursosPageSizeNormal;
  }

  get empresasVisibles(): EmpresaConHistorial[] {
    const inicio = (this.empresasCurrentPage - 1) * this.empresasPageSize;
    return this.empresasVisiblesBase.slice(inicio, inicio + this.empresasPageSize);
  }

  get cursosVisibles(): CursoImpartido[] {
    const inicio = (this.cursosCurrentPage - 1) * this.cursosPageSize;
    return this.cursosVisiblesBase.slice(inicio, inicio + this.cursosPageSize);
  }

  get empresasVisiblesBase(): EmpresaConHistorial[] {
    return this.empresasFiltradas.slice(0, this.empresasVisibleLimit);
  }

  get cursosVisiblesBase(): CursoImpartido[] {
    return this.cursosEmpresaFiltrados.slice(0, this.cursosVisibleLimit);
  }

  get hayMasEmpresas(): boolean {
    return this.empresasVisibleLimit < this.empresasFiltradas.length;
  }

  get hayMasCursos(): boolean {
    return this.cursosVisibleLimit < this.cursosEmpresaFiltrados.length;
  }

  get totalEmpresasPages(): number {
    const total = Math.ceil(this.empresasVisiblesBase.length / this.empresasPageSize);
    return Math.max(total, 1);
  }

  get totalCursosPages(): number {
    const total = Math.ceil(this.cursosVisiblesBase.length / this.cursosPageSize);
    return Math.max(total, 1);
  }

  get empresasPageNumbers(): number[] {
    return this.generarPaginas(this.totalEmpresasPages);
  }

  get cursosPageNumbers(): number[] {
    return this.generarPaginas(this.totalCursosPages);
  }

  cargarCursosConHistorial(): void {
    this.cargando = true;

    const request$ = this.obtenerCursosSegunPerfil();
    if (!request$) {
      this.cursosImpartidos = [];
      this.empresas = [];
      this.empresasFiltradas = [];
      this.cursosEmpresaFiltrados = [];
      this.cargando = false;
      if (this.restaurandoEstadoFiltros) {
        this.finalizarRestauracionFiltros();
      }
      return;
    }

    request$.subscribe({
      next: (response: any) => {
        const cursos = Array.isArray(response?.cursosProgramados) ? response.cursosProgramados : [];

        this.backendService.obtenerEmpresas().subscribe({
          next: (empresasResponse: any) => {
            const empresas = empresasResponse?.success && Array.isArray(empresasResponse.empresas)
              ? empresasResponse.empresas
              : [];

            this.procesarCursosConHistorial(cursos, empresas);
          },
          error: () => {
            this.procesarCursosConHistorial(cursos, []);
          }
        });
      },
      error: (error) => {
        console.error('Error al cargar historial de cursos:', error);
        this.cargando = false;
        if (this.restaurandoEstadoFiltros) {
          this.finalizarRestauracionFiltros();
        }
      }
    });
  }

  async descargarZipConstanciasDc3(curso: CursoImpartido): Promise<void> {
    const programadoId = Number(curso?.programado_id || 0);
    if (!programadoId || this.descargandoZipProgramadoId === programadoId || this.imprimiendoProgramadoId === programadoId) {
      return;
    }

    this.descargandoZipProgramadoId = programadoId;
    Swal.fire({
      title: 'Preparando ZIP...',
      text: 'Descargando constancias y DC-3',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    const zip = new JSZip();
    const errores: string[] = [];
    const fecha = new Date().toISOString().split('T')[0];

    try {
      try {
        const constanciasBlob = await firstValueFrom(this.backendService.descargarConstanciasCombinadasPdf(programadoId));
        zip.file(`Constancias_${fecha}.pdf`, constanciasBlob);
      } catch {
        errores.push('Constancias');
      }

      try {
        const dc3Blob = await firstValueFrom(this.backendService.descargarDc3CombinadosPdf(programadoId));
        zip.file(`DC3_${fecha}.pdf`, dc3Blob);
      } catch {
        errores.push('DC-3');
      }

      if (errores.length === 2) {
        Swal.close();
        await Swal.fire({
          title: 'Sin documentos',
          text: 'No se pudieron obtener constancias ni DC-3 para este curso.',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      Swal.close();

      const nombreCurso = String(curso?.nombre_curso || `curso_${programadoId}`)
        .replace(/[<>:"/\\|?*]+/g, ' ')
        .replace(/\s+/g, '_')
        .trim()
        .substring(0, 60);
      this.descargarBlob(zipBlob, `Constancias_DC3_${nombreCurso || programadoId}_${fecha}.zip`);

      try {
        await firstValueFrom(this.backendService.registrarDescargaConstanciasDc3(programadoId, {
          origen: 'historial_cursos_zip',
          detalle: `curso:${curso?.curso_id || ''}`
        }));
      } catch {
        // No bloquear la descarga si falla el registro.
      }

      if (errores.length > 0) {
        await Swal.fire({
          title: 'ZIP con incidencias',
          text: `El ZIP se generó sin: ${errores.join(', ')}.`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
      }
    } catch {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo generar el ZIP de constancias y DC-3.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoZipProgramadoId = null;
    }
  }

  get esPerfilAdminLimpieza(): boolean {
    return this.esPerfilAdmin;
  }

  onLimpiarConstanciasDc3DesdeTarjeta(event: MouseEvent, curso: CursoImpartido): void {
    event.stopPropagation();
    void this.limpiarConstanciasDc3Curso(curso);
  }

  private cerrarModalSwalCompletamente(): void {
    Swal.close();
    document.querySelectorAll('.swal2-container').forEach((elemento) => elemento.remove());
    document.body.classList.remove('swal2-shown', 'swal2-height-auto');
    document.documentElement.classList.remove('swal2-shown', 'swal2-height-auto');
    document.body.style.paddingRight = '';
  }

  private mostrarCargandoSwal(titulo: string, texto?: string): void {
    void Swal.fire({
      title: titulo,
      text: texto,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });
  }

  private escaparHtmlLimpieza(valor: unknown): string {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private construirTarjetasCursoLimpieza(grupos: any[]): string {
    return grupos.map((grupo) => {
      const id = Number(grupo.curso_catalogo_id);
      const nombre = this.escaparHtmlLimpieza(grupo.nombre_curso);
      const constancias = Number(grupo.total_constancias) || 0;
      const dc3 = Number(grupo.total_dc3) || 0;
      const huerfanos = Number(grupo.huerfanos) || 0;
      const huerfanosHtml = huerfanos > 0
        ? `<span class="clean-docs-stat clean-docs-stat--warn"><i class="fas fa-unlink"></i>${huerfanos} huérfano(s)</span>`
        : '';

      return `
        <button type="button" class="clean-docs-course-card" data-value="${id}" aria-pressed="false">
          <div class="clean-docs-course-card__main">
            <span class="clean-docs-course-card__icon"><i class="fas fa-graduation-cap"></i></span>
            <span class="clean-docs-course-card__name">${nombre}</span>
          </div>
          <div class="clean-docs-course-card__stats">
            <span class="clean-docs-stat clean-docs-stat--const"><i class="fas fa-certificate"></i>${constancias} const.</span>
            <span class="clean-docs-stat clean-docs-stat--dc3"><i class="fas fa-id-card"></i>${dc3} DC-3</span>
            ${huerfanosHtml}
          </div>
        </button>`;
    }).join('');
  }

  private async seleccionarCursoParaLimpieza(grupos: any[], nombrePrograma: string): Promise<number | null> {
    const programa = this.escaparHtmlLimpieza(nombrePrograma);
    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-broom"></i> Limpieza administrativa</div>
          <h3 class="clean-docs-modal__title">Selecciona el curso a limpiar</h3>
          <p class="clean-docs-modal__program">Programa: <strong>${programa}</strong></p>
          <p class="clean-docs-modal__hint">Elige el curso (NOM, módulo, etc.) cuyas constancias y DC-3 deseas eliminar. Los demás cursos no se modifican.</p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="clean-docs-course-list">
            ${this.construirTarjetasCursoLimpieza(grupos)}
          </div>
        </div>
        <div class="clean-docs-modal__footer">
          <button type="button" class="download-action-btn download-action-btn--cancel" data-action="cancelar">Cancelar</button>
        </div>
      </div>`;

    return new Promise((resolve) => {
      let resuelto = false;
      const finalizar = (valor: number | null) => {
        if (resuelto) {
          return;
        }
        resuelto = true;
        resolve(valor);
      };

      void Swal.fire({
        title: 'Selecciona el curso a limpiar',
        html,
        showConfirmButton: false,
        showCancelButton: false,
        showCloseButton: false,
        width: 640,
        customClass: { popup: 'swal2-clean-docs' },
        allowOutsideClick: false,
        allowEscapeKey: true,
        didOpen: () => {
          const popup = Swal.getPopup();
          if (!popup) {
            return;
          }

          popup.querySelector('[data-action="cancelar"]')?.addEventListener('click', () => {
            finalizar(null);
            this.cerrarModalSwalCompletamente();
          });

          const cards = Array.from(popup.querySelectorAll('.clean-docs-course-card')) as HTMLElement[];
          cards.forEach((card) => {
            card.addEventListener('click', () => {
              const valor = card.dataset.value;
              if (!valor) {
                return;
              }
              cards.forEach((item) => {
                item.classList.remove('selected');
                item.setAttribute('aria-pressed', 'false');
              });
              card.classList.add('selected');
              card.setAttribute('aria-pressed', 'true');
              finalizar(Number(valor));
              this.cerrarModalSwalCompletamente();
            });
          });
        },
        didClose: () => finalizar(null)
      });
    });
  }

  private async elegirModoLimpieza(grupo: any): Promise<'curso' | 'huerfanos' | 'especifico' | null> {
    const nombre = this.escaparHtmlLimpieza(grupo.nombre_curso);
    const huerfanos = Number(grupo.huerfanos) || 0;
    const constancias = Number(grupo.total_constancias) || 0;
    const dc3 = Number(grupo.total_dc3) || 0;
    const huerfanosClass = huerfanos > 0 ? 'clean-docs-summary-card__value--warn' : 'clean-docs-summary-card__value--ok';

    const accionHuerfanos = huerfanos > 0 ? `
      <button type="button" class="clean-docs-action-card clean-docs-action-card--safe" data-modo="huerfanos">
        <div class="clean-docs-action-card__row">
          <span class="clean-docs-action-card__icon"><i class="fas fa-unlink"></i></span>
          <div>
            <div class="clean-docs-action-card__title">Solo huérfanos (${huerfanos})</div>
            <div class="clean-docs-action-card__desc">Elimina registros sin archivo en Drive, conservando los documentos válidos.</div>
          </div>
        </div>
      </button>` : '';

    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-sliders-h"></i> Paso 2 de 3</div>
          <h3 class="clean-docs-modal__title">¿Qué deseas eliminar?</h3>
          <p class="clean-docs-modal__program">Curso: <strong>${nombre}</strong></p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="clean-docs-summary-grid">
            <div class="clean-docs-summary-card">
              <span class="clean-docs-summary-card__label">Constancias</span>
              <span class="clean-docs-summary-card__value">${constancias}</span>
            </div>
            <div class="clean-docs-summary-card">
              <span class="clean-docs-summary-card__label">DC-3</span>
              <span class="clean-docs-summary-card__value">${dc3}</span>
            </div>
            <div class="clean-docs-summary-card">
              <span class="clean-docs-summary-card__label">Huérfanos</span>
              <span class="clean-docs-summary-card__value ${huerfanosClass}">${huerfanos}</span>
            </div>
          </div>
          <div class="clean-docs-info-box">
            <i class="fas fa-info-circle"></i>
            Solo se eliminarán constancias y DC-3 de <strong>este curso</strong>. Listas, informes, evidencias y demás documentos no se tocan.
          </div>
          <div class="clean-docs-action-list">
            <button type="button" class="clean-docs-action-card clean-docs-action-card--danger" data-modo="curso">
              <div class="clean-docs-action-card__row">
                <span class="clean-docs-action-card__icon"><i class="fas fa-trash-alt"></i></span>
                <div>
                  <div class="clean-docs-action-card__title">Eliminar constancias y DC-3</div>
                  <div class="clean-docs-action-card__desc">Borra ${Number(grupo.total) || 0} registro(s) de este curso en BD y Drive.</div>
                </div>
              </div>
            </button>
            <button type="button" class="clean-docs-action-card" data-modo="especifico" style="border-color:#b45309;">
              <div class="clean-docs-action-card__row">
                <span class="clean-docs-action-card__icon" style="background:#fff7ed;color:#b45309;"><i class="fas fa-user-slash"></i></span>
                <div>
                  <div class="clean-docs-action-card__title">Baja específica por participante</div>
                  <div class="clean-docs-action-card__desc">Desactiva constancias/DC-3 de un <strong>inscripcion_id</strong>, guarda bitácora y mueve los archivos a <em>Registros Borrados</em>.</div>
                </div>
              </div>
            </button>
            ${accionHuerfanos}
          </div>
        </div>
        <div class="clean-docs-modal__footer">
          <button type="button" class="download-action-btn download-action-btn--cancel" data-action="cancelar">Cancelar</button>
        </div>
      </div>`;

    return new Promise((resolve) => {
      let resuelto = false;
      const finalizar = (modo: 'curso' | 'huerfanos' | 'especifico' | null) => {
        if (resuelto) {
          return;
        }
        resuelto = true;
        resolve(modo);
      };

      void Swal.fire({
        title: '¿Qué deseas eliminar?',
        html,
        showConfirmButton: false,
        showCancelButton: false,
        width: 640,
        customClass: { popup: 'swal2-clean-docs' },
        allowOutsideClick: false,
        didOpen: () => {
          const popup = Swal.getPopup();
          if (!popup) {
            return;
          }

          popup.querySelector('[data-action="cancelar"]')?.addEventListener('click', () => {
            finalizar(null);
            this.cerrarModalSwalCompletamente();
          });
          popup.querySelectorAll('[data-modo]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const modo = (btn as HTMLElement).dataset.modo;
              if (modo === 'curso' || modo === 'huerfanos' || modo === 'especifico') {
                finalizar(modo);
                this.cerrarModalSwalCompletamente();
              }
            });
          });
        },
        didClose: () => finalizar(null)
      });
    });
  }

  private async seleccionarParticipanteParaBaja(
    programadoId: number,
    cursoCatalogoId: number,
    nombreCurso: string
  ): Promise<any | null> {
    this.mostrarCargandoSwal('Cargando participantes...');
    let participantes: any[] = [];
    try {
      const resp: any = await firstValueFrom(
        this.backendService.listarParticipantesConstanciasDc3(programadoId, cursoCatalogoId)
      );
      participantes = Array.isArray(resp?.participantes) ? resp.participantes : [];
    } catch (err: any) {
      this.cerrarModalSwalCompletamente();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudieron cargar los participantes.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return null;
    }
    this.cerrarModalSwalCompletamente();

    if (participantes.length === 0) {
      await Swal.fire({
        title: 'Sin participantes',
        text: 'No hay constancias/DC-3 individuales activos para dar de baja.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      return null;
    }

    const curso = this.escaparHtmlLimpieza(nombreCurso);
    const cards = participantes.map((p) => {
      const id = Number(p.inscripcion_id);
      const nombreRaw = String(p.nombre_completo || `Inscripción ${id}`).trim();
      const nombre = this.escaparHtmlLimpieza(nombreRaw);
      const curp = this.escaparHtmlLimpieza(p.curp || 'Sin CURP');
      const constancias = Number(p.total_constancias) || 0;
      const dc3 = Number(p.total_dc3) || 0;
      const iniciales = nombreRaw
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((parte) => parte.charAt(0))
        .join('')
        .toUpperCase() || 'P';

      return `
        <button type="button" class="baja-part-card" data-inscripcion="${id}" data-search="${nombre} ${curp} ${id}">
          <span class="baja-part-card__avatar" aria-hidden="true">${this.escaparHtmlLimpieza(iniciales)}</span>
          <span class="baja-part-card__content">
            <span class="baja-part-card__top">
              <span class="baja-part-card__name">${nombre}</span>
              <span class="baja-part-card__id">#${id}</span>
            </span>
            <span class="baja-part-card__meta">${curp}</span>
            <span class="baja-part-card__chips">
              <span class="baja-part-chip baja-part-chip--const">
                <i class="fas fa-certificate"></i> ${constancias} constancia${constancias === 1 ? '' : 's'}
              </span>
              <span class="baja-part-chip baja-part-chip--dc3">
                <i class="fas fa-id-card"></i> ${dc3} DC-3
              </span>
            </span>
          </span>
          <span class="baja-part-card__action" aria-hidden="true"><i class="fas fa-chevron-right"></i></span>
        </button>`;
    }).join('');

    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-user-slash"></i> Baja específica</div>
          <h3 class="clean-docs-modal__title">Selecciona el participante</h3>
          <p class="clean-docs-modal__program">Curso: <strong>${curso}</strong></p>
          <p class="clean-docs-modal__hint">Elige a quién desactivar. Los documentos se archivan, no se eliminan.</p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="baja-part-toolbar">
            <label class="baja-part-search" for="baja-part-search-input">
              <i class="fas fa-search"></i>
              <input id="baja-part-search-input" type="search" placeholder="Buscar por nombre, CURP o ID..." autocomplete="off" />
            </label>
            <span class="baja-part-count">${participantes.length} participante${participantes.length === 1 ? '' : 's'}</span>
          </div>
          <div class="baja-part-list">${cards}</div>
          <p class="baja-part-empty" hidden>No hay coincidencias con tu búsqueda.</p>
        </div>
        <div class="clean-docs-modal__footer">
          <button type="button" class="download-action-btn download-action-btn--cancel" data-action="cancelar">Cancelar</button>
        </div>
      </div>`;

    return new Promise((resolve) => {
      let resuelto = false;
      const finalizar = (valor: any | null) => {
        if (resuelto) return;
        resuelto = true;
        resolve(valor);
      };

      void Swal.fire({
        title: 'Selecciona el participante',
        html,
        showConfirmButton: false,
        showCancelButton: false,
        width: 680,
        customClass: { popup: 'swal2-clean-docs' },
        allowOutsideClick: false,
        didOpen: () => {
          const popup = Swal.getPopup();
          if (!popup) return;

          popup.querySelector('[data-action="cancelar"]')?.addEventListener('click', () => {
            finalizar(null);
            this.cerrarModalSwalCompletamente();
          });

          const lista = popup.querySelector('.baja-part-list') as HTMLElement | null;
          const vacio = popup.querySelector('.baja-part-empty') as HTMLElement | null;
          const contador = popup.querySelector('.baja-part-count') as HTMLElement | null;
          const input = popup.querySelector('#baja-part-search-input') as HTMLInputElement | null;

          const filtrar = () => {
            const q = String(input?.value || '').trim().toLowerCase();
            const cardsEl = Array.from(popup.querySelectorAll('.baja-part-card')) as HTMLElement[];
            let visibles = 0;
            cardsEl.forEach((card) => {
              const hay = !q || String(card.dataset.search || '').toLowerCase().includes(q);
              card.hidden = !hay;
              if (hay) visibles += 1;
            });
            if (lista) lista.hidden = visibles === 0;
            if (vacio) vacio.hidden = visibles > 0;
            if (contador) {
              contador.textContent = q
                ? `${visibles} de ${participantes.length}`
                : `${participantes.length} participante${participantes.length === 1 ? '' : 's'}`;
            }
          };

          input?.addEventListener('input', filtrar);

          popup.querySelectorAll('[data-inscripcion]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const id = Number((btn as HTMLElement).dataset.inscripcion);
              const seleccionado = participantes.find((p) => Number(p.inscripcion_id) === id) || null;
              finalizar(seleccionado);
              this.cerrarModalSwalCompletamente();
            });
          });
        },
        didClose: () => finalizar(null)
      });
    });
  }

  private async confirmarBajaEspecifica(participante: any, nombreCurso: string): Promise<boolean> {
    const nombre = this.escaparHtmlLimpieza(participante?.nombre_completo || '');
    const id = Number(participante?.inscripcion_id) || 0;
    const total = Number(participante?.total) || 0;
    const curso = this.escaparHtmlLimpieza(nombreCurso);

    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-exclamation-triangle"></i> Confirmar baja</div>
          <h3 class="clean-docs-modal__title">¿Desactivar documentos?</h3>
          <p class="clean-docs-modal__hint">
            Se desactivarán <strong>${total}</strong> documento(s) de <strong>${nombre}</strong>
            (ID <strong>${id}</strong>) en <strong>${curso}</strong>.
          </p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="clean-docs-alert clean-docs-alert--warn">
            <i class="fas fa-info-circle"></i>
            Los archivos se archivan en <strong>Registros Borrados</strong>; no se eliminan de forma permanente.
          </div>
        </div>
        <div class="clean-docs-modal__footer">
          <button type="button" class="download-action-btn download-action-btn--cancel" data-action="cancelar">Cancelar</button>
          <button type="button" class="download-action-btn" data-action="confirmar" style="background:#b45309;color:#fff;border-color:#b45309;">
            <i class="fas fa-check"></i> Sí, desactivar
          </button>
        </div>
      </div>`;

    return new Promise((resolve) => {
      let resuelto = false;
      const finalizar = (ok: boolean) => {
        if (resuelto) return;
        resuelto = true;
        resolve(ok);
      };

      void Swal.fire({
        title: 'Confirmar baja',
        html,
        showConfirmButton: false,
        showCancelButton: false,
        width: 560,
        customClass: { popup: 'swal2-clean-docs' },
        allowOutsideClick: false,
        didOpen: () => {
          const popup = Swal.getPopup();
          if (!popup) return;
          popup.querySelector('[data-action="cancelar"]')?.addEventListener('click', () => {
            finalizar(false);
            this.cerrarModalSwalCompletamente();
          });
          popup.querySelector('[data-action="confirmar"]')?.addEventListener('click', () => {
            finalizar(true);
            this.cerrarModalSwalCompletamente();
          });
        },
        didClose: () => finalizar(false)
      });
    });
  }

  private async mostrarResultadoBajaEspecifica(data: any, erroresDrive: string[]): Promise<void> {
    const nombre = this.escaparHtmlLimpieza(data?.empleado_nombre || '');
    const desactivados = Number(data?.desactivados_bd) || 0;
    const movidos = Number(data?.movidos_drive) || 0;
    const alerta = erroresDrive.length > 0
      ? `<div class="clean-docs-alert clean-docs-alert--error"><i class="fas fa-exclamation-circle"></i> ${erroresDrive.length} archivo(s) no se pudieron mover en Drive.</div>`
      : `<div class="clean-docs-alert" style="background:#eef4ea;border-color:#cfdbc9;color:#38512F;"><i class="fas fa-check-circle"></i> Baja registrada correctamente.</div>`;

    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-check"></i> Completado</div>
          <h3 class="clean-docs-modal__title">Baja específica aplicada</h3>
          <p class="clean-docs-modal__program">Participante: <strong>${nombre}</strong></p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="clean-docs-result-grid">
            <div class="clean-docs-result-card">
              <div class="clean-docs-result-card__label">Desactivados BD</div>
              <div class="clean-docs-result-card__value">${desactivados}</div>
            </div>
            <div class="clean-docs-result-card">
              <div class="clean-docs-result-card__label">Movidos Drive</div>
              <div class="clean-docs-result-card__value">${movidos}</div>
            </div>
          </div>
          ${alerta}
          <div class="clean-docs-alert" style="background:#f8fafc;border-color:#e2e8f0;color:#475569;margin-top:.55rem;">
            <i class="fas fa-folder"></i> Destino Drive: <strong>Registros Borrados</strong>
          </div>
        </div>
        <div class="clean-docs-modal__footer">
          <button type="button" class="download-action-btn" data-action="ok">OK</button>
        </div>
      </div>`;

    await new Promise<void>((resolve) => {
      void Swal.fire({
        title: 'Baja específica aplicada',
        html,
        showConfirmButton: false,
        width: 520,
        customClass: { popup: 'swal2-clean-docs' },
        didOpen: () => {
          Swal.getPopup()?.querySelector('[data-action="ok"]')?.addEventListener('click', () => {
            this.cerrarModalSwalCompletamente();
            resolve();
          });
        },
        didClose: () => resolve()
      });
    });
  }

  private async confirmarLimpieza(
    grupo: any,
    modo: 'curso' | 'huerfanos'
  ): Promise<boolean> {
    const nombre = this.escaparHtmlLimpieza(grupo.nombre_curso);
    const totalEliminar = modo === 'huerfanos'
      ? Number(grupo.huerfanos) || 0
      : Number(grupo.total) || 0;
    const titulo = modo === 'huerfanos' ? '¿Eliminar solo huérfanos?' : 'Confirmar eliminación';
    const descripcion = modo === 'huerfanos'
      ? `Se borrarán <strong>${totalEliminar}</strong> registro(s) sin archivo en Drive de <strong>${nombre}</strong>.`
      : `Se borrarán <strong>${totalEliminar}</strong> registro(s) de constancias/DC-3 de <strong>${nombre}</strong> en BD y Drive.`;

    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-exclamation-triangle"></i> Paso 3 de 3</div>
          <h3 class="clean-docs-modal__title">${titulo}</h3>
          <p class="clean-docs-modal__hint">${descripcion}</p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="clean-docs-alert clean-docs-alert--warn">
            <i class="fas fa-shield-alt"></i> Esta acción no se puede deshacer. Verifica que seleccionaste el curso correcto.
          </div>
        </div>
        <div class="clean-docs-modal__footer">
          <button type="button" class="download-action-btn download-action-btn--cancel" data-action="cancelar">Cancelar</button>
          <button type="button" class="download-action-btn" data-action="confirmar" style="background:#b42318;color:#fff;border-color:#b42318;">
            <i class="fas fa-check"></i> Sí, eliminar
          </button>
        </div>
      </div>`;

    return new Promise((resolve) => {
      let resuelto = false;
      const finalizar = (confirmado: boolean) => {
        if (resuelto) {
          return;
        }
        resuelto = true;
        resolve(confirmado);
      };

      void Swal.fire({
        title: titulo,
        html,
        showConfirmButton: false,
        showCancelButton: false,
        width: 520,
        customClass: { popup: 'swal2-clean-docs' },
        allowOutsideClick: false,
        didOpen: () => {
          const popup = Swal.getPopup();
          if (!popup) {
            return;
          }

          popup.querySelector('[data-action="cancelar"]')?.addEventListener('click', () => {
            finalizar(false);
            this.cerrarModalSwalCompletamente();
          });
          popup.querySelector('[data-action="confirmar"]')?.addEventListener('click', () => {
            finalizar(true);
            this.cerrarModalSwalCompletamente();
          });
        },
        didClose: () => finalizar(false)
      });
    });
  }

  private async mostrarResultadoLimpieza(grupo: any, data: any, erroresDrive: string[]): Promise<void> {
    const nombre = this.escaparHtmlLimpieza(data.nombre_curso || grupo.nombre_curso);
    const eliminadosBd = Number(data.eliminados_bd) || 0;
    const eliminadosDrive = Number(data.eliminados_drive) || 0;
    const carpetasDrive = Array.isArray(data.carpetas_drive_eliminadas) ? data.carpetas_drive_eliminadas : [];
    const alertaDrive = erroresDrive.length > 0
      ? `<div class="clean-docs-alert clean-docs-alert--error"><i class="fas fa-exclamation-circle"></i> No se pudieron borrar ${erroresDrive.length} archivo(s) en Drive.</div>`
      : `<div class="clean-docs-alert" style="background:#eef4ea;border-color:#cfdbc9;color:#38512F;"><i class="fas fa-check-circle"></i> Limpieza finalizada correctamente.</div>`;
    const carpetasHtml = carpetasDrive.length > 0
      ? `<div class="clean-docs-alert" style="background:#f8fafc;border-color:#e2e8f0;color:#475569;margin-top:0.55rem;"><i class="fas fa-folder-minus"></i> Carpetas vacías eliminadas en Drive: <strong>${carpetasDrive.length}</strong></div>`
      : '';

    const html = `
      <div class="clean-docs-modal">
        <div class="clean-docs-modal__hero">
          <div class="clean-docs-modal__badge"><i class="fas fa-check"></i> Completado</div>
          <h3 class="clean-docs-modal__title">Limpieza completada</h3>
          <p class="clean-docs-modal__program">Curso: <strong>${nombre}</strong></p>
        </div>
        <div class="clean-docs-modal__body">
          <div class="clean-docs-result-grid">
            <div class="clean-docs-result-card">
              <div class="clean-docs-result-card__label">Registros en BD</div>
              <div class="clean-docs-result-card__value">${eliminadosBd}</div>
            </div>
            <div class="clean-docs-result-card">
              <div class="clean-docs-result-card__label">Archivos en Drive</div>
              <div class="clean-docs-result-card__value">${eliminadosDrive}</div>
            </div>
          </div>
          ${alertaDrive}
          ${carpetasHtml}
        </div>
      </div>`;

    await Swal.fire({
      title: 'Limpieza completada',
      html,
      showConfirmButton: true,
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#38512F',
      showCancelButton: false,
      width: 520,
      customClass: { popup: 'swal2-clean-docs swal2-clean-docs--result' },
      allowOutsideClick: false,
      allowEscapeKey: true
    });
    this.cerrarModalSwalCompletamente();
  }

  async limpiarConstanciasDc3Curso(curso: CursoImpartido): Promise<void> {
    const programadoId = Number(curso?.programado_id || 0);
    if (!programadoId || !this.esPerfilAdminLimpieza || this.limpiandoConstanciasProgramadoId === programadoId) {
      return;
    }

    this.limpiandoConstanciasProgramadoId = programadoId;
    this.mostrarCargandoSwal('Verificando documentos...');

    try {
      const response: any = await firstValueFrom(this.backendService.diagnosticarConstanciasDc3(programadoId));
      const grupos: any[] = Array.isArray(response?.diagnostico?.grupos) ? response.diagnostico.grupos : [];
      const nombrePrograma = curso?.nombre_curso || response?.curso?.nombre_curso || 'este programa';

      this.cerrarModalSwalCompletamente();

      if (grupos.length === 0) {
        await Swal.fire({
          title: 'Sin documentos',
          text: `No hay constancias ni DC-3 registrados para "${nombrePrograma}".`,
          icon: 'info',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const cursoCatalogoId = await this.seleccionarCursoParaLimpieza(grupos, nombrePrograma);
      if (!cursoCatalogoId) {
        return;
      }

      const grupo = grupos.find((g) => Number(g.curso_catalogo_id) === cursoCatalogoId);
      if (!grupo) {
        return;
      }

      const modo = await this.elegirModoLimpieza(grupo);
      if (!modo) {
        return;
      }

      if (modo === 'especifico') {
        const participante = await this.seleccionarParticipanteParaBaja(
          programadoId,
          cursoCatalogoId,
          grupo.nombre_curso || nombrePrograma
        );
        if (!participante) {
          return;
        }

        const confirmadoEspecifico = await this.confirmarBajaEspecifica(
          participante,
          grupo.nombre_curso || nombrePrograma
        );
        if (!confirmadoEspecifico) {
          return;
        }

        this.mostrarCargandoSwal(
          'Desactivando...',
          `Baja de ${participante.nombre_completo || 'participante'}`
        );

        const resultadoBaja: any = await firstValueFrom(
          this.backendService.bajaParticipanteConstanciasDc3(
            programadoId,
            cursoCatalogoId,
            Number(participante.inscripcion_id)
          )
        );
        this.cerrarModalSwalCompletamente();

        const dataBaja = resultadoBaja?.resultado || {};
        const erroresDriveBaja = Array.isArray(dataBaja.errores_drive) ? dataBaja.errores_drive : [];
        await this.mostrarResultadoBajaEspecifica(dataBaja, erroresDriveBaja);
        return;
      }

      const confirmado = await this.confirmarLimpieza(grupo, modo);
      if (!confirmado) {
        return;
      }

      this.mostrarCargandoSwal('Limpiando...', `Eliminando documentos de ${grupo.nombre_curso}`);

      const resultado: any = await firstValueFrom(
        this.backendService.limpiarConstanciasDc3(programadoId, cursoCatalogoId, modo)
      );
      this.cerrarModalSwalCompletamente();

      const data = resultado?.resultado || {};
      const erroresDrive = Array.isArray(data.errores_drive) ? data.errores_drive : [];
      await this.mostrarResultadoLimpieza(grupo, data, erroresDrive);
    } catch (error: any) {
      this.cerrarModalSwalCompletamente();
      const detalle = error?.error?.message
        || (error?.status === 404 ? 'El servicio de limpieza no está disponible en el servidor.' : null)
        || 'No se pudo limpiar constancias y DC-3 del curso seleccionado.';
      await Swal.fire({
        title: 'Error',
        text: detalle,
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.limpiandoConstanciasProgramadoId = null;
    }
  }

  private descargarBlob(blob: Blob, nombreArchivo: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private obtenerCursosSegunPerfil(): Observable<any> | null {
    if (this.esPerfilAdmin || this.esPerfilSgc) {
      return this.backendService.obtenerCursosProgramados();
    }

    if (this.esPerfilEmpresa) {
      if (!this.empresaUsuarioId) {
        return null;
      }
      return this.backendService.obtenerCursosProgramadosPorEmpresa(this.empresaUsuarioId);
    }

    if (this.esPerfilInstructor) {
      if (!this.instructorUsuarioId) {
        return null;
      }
      return this.backendService.obtenerCursosProgramadosPorInstructor(this.instructorUsuarioId);
    }

    return this.backendService.obtenerCursosProgramados();
  }

  private procesarCursosConHistorial(cursos: any[], empresas: any[]): void {
    const cursosEnriquecidos = this.enriquecerCursosConLogoEmpresa(cursos, empresas);

    this.cursosImpartidos = cursosEnriquecidos
      .filter((curso: any) => this.esCursoImpartido(curso))
      .map((curso: any) => {
        const fechaInicio = parsearFechaSoloDia(curso.fecha_inicio);
        if (!fechaInicio) {
          return null;
        }

        return {
          programado_id: Number(curso.programado_id),
          curso_id: Number(curso.curso_id),
          nombre_curso: curso.nombre_curso || 'Curso sin nombre',
          empresa_id: Number(curso.empresa_id),
          nombre_empresa: curso.nombre_empresa || 'Empresa sin nombre',
          instructor_id: Number.isFinite(Number(curso.instructor_id)) ? Number(curso.instructor_id) : undefined,
          rfc: curso.rfc || '',
          instructor_nombre: curso.instructor_nombre || '-',
          fecha_inicio: fechaInicio,
          fecha_fin: parsearFechaSoloDia(curso.fecha_fin) || undefined,
          modalidad: curso.modalidad || '-',
          lugar: curso.lugar || curso.ubicacion || '',
          estado: curso.estado || '',
          ciudad: curso.ciudad || '',
          total_participantes: Number(curso.inscritos || curso.total_participantes || 0),
          estatus: curso.estatus || '',
          estatus_acreditaciones: curso.estatus_acreditaciones || '',
          tiene_entrega_documentos: curso.tiene_entrega_documentos,
          anexo_subido: curso.anexo_subido,
          tiene_anexo: curso.tiene_anexo,
          anexo_firmado_subido: curso.anexo_firmado_subido,
          estatus_anexo: curso.estatus_anexo || '',
          estatus_entrega_documentos: curso.estatus_entrega_documentos || '',
          empresa_logo: curso.empresa_logo || curso.logo || curso.logo_url || null,
          logo: curso.logo || curso.empresa_logo || curso.logo_url || null,
          logo_url: curso.logo_url || curso.logo || curso.empresa_logo || null
        } as CursoImpartido;
      })
      .filter((curso): curso is CursoImpartido => !!curso)
      .sort((a: CursoImpartido, b: CursoImpartido) => b.fecha_inicio.getTime() - a.fecha_inicio.getTime());

    this.construirEmpresasDesdeCursos();
    this.actualizarEstadosDisponibles();
    this.filtrarEmpresas();
    if (this.restaurandoEstadoFiltros) {
      this.finalizarRestauracionFiltros();
    }
    this.cargando = false;
  }

  private enriquecerCursosConLogoEmpresa(cursos: any[], empresas: any[]): any[] {
    const empresasPorId = new Map<number, any>();

    empresas.forEach((empresa) => {
      if (empresa?.empresa_id) {
        empresasPorId.set(empresa.empresa_id, empresa);
      }
    });

    return cursos.map((curso) => {
      const empresa = empresasPorId.get(curso.empresa_id) || {};
      const logo = curso.empresa_logo || curso.logo || curso.logo_url || empresa.logo || empresa.logo_url || null;

      return {
        ...empresa,
        ...curso,
        empresa_logo: logo,
        logo,
        logo_url: curso.logo_url || curso.empresa_logo || empresa.logo_url || empresa.logo || null
      };
    });
  }

  private esCursoImpartido(curso: any): boolean {
    const estatus = String(curso?.estatus || '').toLowerCase();
    const ahora = Date.now();
    const fechaFinCurso = this.obtenerTimestampFinCurso(curso);

    // Historial: excluir explícitamente cursos no finalizados.
    if (this.estatusNoFinalizados.has(estatus)) {
      return false;
    }

    // Cursos marcados como finalizados entran al historial de inmediato (misma regla que el dashboard).
    if (this.estatusFinalizados.has(estatus)) {
      return true;
    }

    // Fallback para datos históricos con estatus vacío o legacy: considerar solo cursos cuya fecha de fin ya pasó.
    return fechaFinCurso !== null && fechaFinCurso <= ahora;
  }

  private obtenerTimestampFinCurso(curso: any): number | null {
    const fechaFinRaw = curso?.fecha_fin || curso?.fecha_inicio;
    return obtenerFinDiaTimestamp(fechaFinRaw);
  }

  private construirEmpresasDesdeCursos(): void {
    const mapaEmpresas = new Map<number, EmpresaConHistorial>();

    this.cursosImpartidos.forEach((curso) => {
      if (!curso.empresa_id) {
        return;
      }

      const existente = mapaEmpresas.get(curso.empresa_id);
      const logo = curso.empresa_logo || curso.logo || curso.logo_url || null;

      if (!existente) {
        mapaEmpresas.set(curso.empresa_id, {
          empresa_id: curso.empresa_id,
          nombre_empresa: curso.nombre_empresa,
          rfc: curso.rfc,
          estado: curso.estado,
          ciudad: curso.ciudad,
          logo,
          logo_url: curso.logo_url || curso.logo || curso.empresa_logo || null,
          total_cursos: 1,
          ultima_fecha: curso.fecha_inicio
        });
        return;
      }

      existente.total_cursos += 1;
      if (!existente.ultima_fecha || curso.fecha_inicio > existente.ultima_fecha) {
        existente.ultima_fecha = curso.fecha_inicio;
      }
      if (!existente.logo_url && logo) {
        existente.logo = logo;
        existente.logo_url = curso.logo_url || curso.logo || curso.empresa_logo || null;
      }
    });

    this.empresas = Array.from(mapaEmpresas.values())
      .sort((a, b) => a.nombre_empresa.localeCompare(b.nombre_empresa));
  }

  private actualizarEstadosDisponibles(): void {
    this.estados = Array.from(new Set(
      this.empresas
        .map((empresa) => empresa.estado || '')
        .filter((estado) => !!estado)
    )).sort();

    this.actualizarMunicipiosDisponibles();
  }

  private actualizarMunicipiosDisponibles(): void {
    const base = this.empresas.filter((empresa) =>
      !this.estadoSeleccionado || empresa.estado === this.estadoSeleccionado
    );

    this.municipios = Array.from(new Set(
      base
        .map((empresa) => empresa.ciudad || '')
        .filter((ciudad) => !!ciudad)
    )).sort();

    if (this.municipioSeleccionado && !this.municipios.includes(this.municipioSeleccionado)) {
      this.municipioSeleccionado = '';
    }
  }

  filtrarEmpresas(): void {
    if (this.esPerfilEmpresa) {
      this.empresasFiltradas = this.empresas
        .filter((empresa) => empresa.empresa_id === this.empresaUsuarioId)
        .map((empresa) => ({
          ...empresa,
          total_cursos_filtrados: this.contarCursosEmpresaSegunFiltroAnexo(empresa.empresa_id, '')
        }));
      this.empresasVisibleLimit = this.empresasPageSize;
      this.empresasCurrentPage = 1;
      this.aplicarSeleccionAutomaticaEmpresa();
      return;
    }

    const filtro = this.normalizarTexto(this.textoBusquedaEmpresa);
    const estadoSeleccionado = this.normalizarTexto(this.estadoSeleccionado);
    const municipioSeleccionado = this.normalizarTexto(this.municipioSeleccionado);
    const filtroAnexo = String(this.filtroAnexoSubido || '').trim();

    this.empresasFiltradas = this.empresas.filter((empresa) => {
      const nombreEmpresa = this.normalizarTexto(empresa.nombre_empresa);
      const rfcEmpresa = this.normalizarTexto(empresa.rfc || '');
      const estadoEmpresa = this.normalizarTexto(empresa.estado || '');
      const municipioEmpresa = this.normalizarTexto(empresa.ciudad || '');

      const coincideTexto = !filtro
        || nombreEmpresa.includes(filtro)
        || rfcEmpresa.includes(filtro)
        || estadoEmpresa.includes(filtro)
        || municipioEmpresa.includes(filtro);

      const coincideEstado = !estadoSeleccionado || estadoEmpresa === estadoSeleccionado;
      const coincideMunicipio = !municipioSeleccionado || municipioEmpresa === municipioSeleccionado;
      const coincideAnexo = !filtroAnexo || this.empresaCumpleFiltroAnexo(empresa.empresa_id, filtroAnexo);

      return coincideTexto && coincideEstado && coincideMunicipio && coincideAnexo;
    }).map((empresa) => ({
      ...empresa,
      total_cursos_filtrados: this.contarCursosEmpresaSegunFiltroAnexo(empresa.empresa_id, filtroAnexo)
    }));

    if (!this.restaurandoEstadoFiltros) {
      this.empresasVisibleLimit = this.empresasPageSize;
      this.empresasCurrentPage = 1;
    }

    if (this.empresaSeleccionada && !this.restaurandoEstadoFiltros) {
      const existeSeleccion = this.empresasFiltradas.some((empresa) => empresa.empresa_id === this.empresaSeleccionada?.empresa_id);
      if (!existeSeleccion) {
        this.empresaSeleccionada = null;
        this.cursosEmpresaFiltrados = [];
        this.cursosVisibleLimit = this.cursosPageSize;
        this.cursosCurrentPage = 1;
      } else {
        this.actualizarAnosDisponibles();
        this.filtrarCursosEmpresa();
      }
    }

    this.guardarEstadoFiltros();
  }

  onEstadoChange(): void {
    this.actualizarMunicipiosDisponibles();
    this.filtrarEmpresas();
  }

  seleccionarEmpresa(empresa: EmpresaConHistorial, preservarFiltrosTemporales = false): void {
    this.empresaSeleccionada = empresa;
    if (!preservarFiltrosTemporales) {
      this.anoSeleccionado = 0;
      this.mesSeleccionado = 0;
      this.cursosVisibleLimit = this.cursosPageSize;
      this.cursosCurrentPage = 1;
    }
    this.actualizarAnosDisponibles();
    this.filtrarCursosEmpresa();
    this.guardarEstadoFiltros();
  }

  actualizarAnosDisponibles(): void {
    const cursosBase = this.obtenerCursosBaseSeleccionados();
    if (cursosBase.length === 0) {
      this.anosDisponibles = [];
      return;
    }

    const anos = cursosBase
      .map((curso) => curso.fecha_inicio.getFullYear());

    this.anosDisponibles = Array.from(new Set(anos)).sort((a, b) => b - a);
  }

  filtrarCursosEmpresa(): void {
    const cursosBase = this.obtenerCursosBaseSeleccionados();
    if (cursosBase.length === 0) {
      this.cursosEmpresaFiltrados = [];
      return;
    }

    const anoFiltro = Number(this.anoSeleccionado) || 0;
    const mesFiltro = Number(this.mesSeleccionado) || 0;
    const filtroAnexo = String(this.filtroAnexoSubido || '').trim();
    this.anoSeleccionado = anoFiltro;
    this.mesSeleccionado = mesFiltro;
    this.filtroAnexoSubido = filtroAnexo;

    this.cursosEmpresaFiltrados = cursosBase
      .filter((curso) => anoFiltro === 0 || curso.fecha_inicio.getFullYear() === anoFiltro)
      .filter((curso) => mesFiltro === 0 || (curso.fecha_inicio.getMonth() + 1) === mesFiltro)
      .filter((curso) => {
        if (!filtroAnexo) return true;
        const tieneAnexo = this.cursoTieneAnexoSubido(curso);
        if (filtroAnexo === 'con_anexo') return tieneAnexo;
        if (filtroAnexo === 'sin_anexo') return !tieneAnexo;
        return true;
      })
      .sort((a, b) => b.fecha_inicio.getTime() - a.fecha_inicio.getTime());

    if (!this.restaurandoEstadoFiltros) {
      this.cursosVisibleLimit = this.cursosPageSize;
      this.cursosCurrentPage = 1;
    }

    this.guardarEstadoFiltros();
  }

  cargarMasEmpresas(): void {
    this.empresasVisibleLimit += this.empresasPageSize;
    this.empresasCurrentPage = this.totalEmpresasPages;
  }

  cargarMasCursos(): void {
    this.cursosVisibleLimit += this.cursosPageSize;
    this.cursosCurrentPage = this.totalCursosPages;
  }

  irPaginaEmpresas(page: number): void {
    if (page < 1 || page > this.totalEmpresasPages) {
      return;
    }
    this.empresasCurrentPage = page;
    this.guardarEstadoFiltros();
  }

  irPaginaCursos(page: number): void {
    if (page < 1 || page > this.totalCursosPages) {
      return;
    }
    this.cursosCurrentPage = page;
    this.guardarEstadoFiltros();
  }

  onCursoCardSpace(event: KeyboardEvent, curso: CursoImpartido): void {
    event.preventDefault();
    this.abrirDetalleCurso(curso);
  }

  onDescargarZipDesdeTarjeta(event: MouseEvent, curso: CursoImpartido): void {
    event.stopPropagation();
    void this.preguntarAccionConstanciasDc3(curso);
  }

  async preguntarAccionConstanciasDc3(curso: CursoImpartido): Promise<void> {
    const programadoId = Number(curso?.programado_id || 0);
    if (
      !programadoId ||
      this.descargandoZipProgramadoId === programadoId ||
      this.imprimiendoProgramadoId === programadoId
    ) {
      return;
    }

    const result = await Swal.fire({
      title: 'Constancias y DC-3',
      html: '<p class="mb-0">¿Deseas <strong>descargar</strong> los documentos o <strong>imprimirlos</strong> directamente?</p>',
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      focusConfirm: false,
      confirmButtonText: '<i class="fas fa-download"></i> Descargar',
      denyButtonText: '<i class="fas fa-print"></i> Imprimir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      denyButtonColor: '#768D6B',
      cancelButtonColor: '#6c757d'
    });

    if (result.isConfirmed) {
      await this.descargarZipConstanciasDc3(curso);
      return;
    }

    if (result.isDenied) {
      await this.imprimirConstanciasDc3(curso);
    }
  }

  async imprimirConstanciasDc3(curso: CursoImpartido): Promise<void> {
    const programadoId = Number(curso?.programado_id || 0);
    if (!programadoId || this.imprimiendoProgramadoId === programadoId || this.descargandoZipProgramadoId === programadoId) {
      return;
    }

    this.imprimiendoProgramadoId = programadoId;
    Swal.fire({
      title: 'Preparando impresión...',
      text: 'Obteniendo constancias y DC-3',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    const documentos: { nombre: string; blob: Blob }[] = [];
    const errores: string[] = [];

    try {
      try {
        const constanciasBlob = await firstValueFrom(this.backendService.descargarConstanciasCombinadasPdf(programadoId));
        documentos.push({
          nombre: 'Constancias',
          blob: new Blob([constanciasBlob], { type: 'application/pdf' })
        });
      } catch {
        errores.push('Constancias');
      }

      try {
        const dc3Blob = await firstValueFrom(this.backendService.descargarDc3CombinadosPdf(programadoId));
        documentos.push({
          nombre: 'DC-3',
          blob: new Blob([dc3Blob], { type: 'application/pdf' })
        });
      } catch {
        errores.push('DC-3');
      }

      if (documentos.length === 0) {
        Swal.close();
        await Swal.fire({
          title: 'Sin documentos',
          text: 'No se pudieron obtener constancias ni DC-3 para este curso.',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      try {
        await firstValueFrom(this.backendService.registrarDescargaConstanciasDc3(programadoId, {
          origen: 'historial_cursos_imprimir',
          detalle: `curso:${curso?.curso_id || ''}`
        }));
      } catch {
        // No bloquear la impresión si falla el registro.
      }

      Swal.close();

      for (let i = 0; i < documentos.length; i++) {
        await this.imprimirPdfBlob(documentos[i].blob);
        if (i < documentos.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }

      if (errores.length > 0) {
        await Swal.fire({
          title: 'Impresión parcial',
          text: `Se preparó la impresión sin: ${errores.join(', ')}.`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
      }
    } catch {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: 'No se pudieron preparar los documentos para impresión.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.imprimiendoProgramadoId = null;
    }
  }

  private imprimirPdfBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      let resuelto = false;
      let impresionLanzada = false;

      const finalizar = (): void => {
        if (resuelto) {
          return;
        }
        resuelto = true;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        resolve();
      };

      const lanzarImpresion = (ventana: Window | null): void => {
        if (impresionLanzada) {
          return;
        }
        impresionLanzada = true;
        try {
          ventana?.focus();
          ventana?.print();
        } catch {
          // Si el diálogo nativo falla, al menos queda la vista del PDF abierta.
        }
        finalizar();
      };

      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          setTimeout(() => lanzarImpresion(printWindow), 800);
        });

        // Fallback si el evento load no dispara
        setTimeout(() => lanzarImpresion(printWindow), 2000);
        return;
      }

      // Popup bloqueado: imprimir con iframe oculto
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;border:0;';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        setTimeout(() => {
          lanzarImpresion(iframe.contentWindow);
          setTimeout(() => {
            if (iframe.parentNode) {
              document.body.removeChild(iframe);
            }
          }, 2000);
        }, 800);
      };
    });
  }

  abrirDetalleCurso(curso: CursoImpartido): void {
    if (curso?.programado_id && this.authService.puedeGestionarHistorialPendientes()) {
      this.historialPendientes.marcarConsultado(curso.programado_id);
    }
    this.router.navigate(['/informacion-general', curso.curso_id], {
      queryParams: {
        nombre: curso.nombre_curso,
        categoria: 'seguridad',
        origen: 'historial-cursos',
        vista: 'historial',
        programado_id: curso.programado_id,
        empresa_id: curso.empresa_id
      }
    });
  }

  getInicialesEmpresa(nombre: string): string {
    if (!nombre) return 'EM';
    const palabras = nombre.trim().split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) {
      return `${palabras[0][0]}${palabras[1][0]}`.toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  getLogoEmpresaUrl(empresa: EmpresaConHistorial): string | null {
    return this.backendService.resolverUrlDrivePreview(empresa?.logo || empresa?.logo_url);
  }

  onLogoError(empresa: EmpresaConHistorial): void {
    if (!empresa) return;
    empresa.logo = null;
    empresa.logo_url = null;
  }

  limpiarSeleccionEmpresa(): void {
    if (this.esPerfilEmpresa) {
      this.aplicarSeleccionAutomaticaEmpresa();
      return;
    }

    this.empresaSeleccionada = null;
    this.anoSeleccionado = 0;
    this.mesSeleccionado = 0;
    this.cursosEmpresaFiltrados = [];
    this.cursosVisibleLimit = this.cursosPageSize;
    this.cursosCurrentPage = 1;
    this.guardarEstadoFiltros();
  }

  cambiarModoVisual(modo: 'normal' | 'compacto'): void {
    if (this.modoVisual === modo) {
      return;
    }

    this.modoVisual = modo;

    this.empresasVisibleLimit = Math.max(this.empresasVisibleLimit, this.empresasPageSize);
    this.cursosVisibleLimit = Math.max(this.cursosVisibleLimit, this.cursosPageSize);

    this.empresasCurrentPage = Math.min(this.empresasCurrentPage, this.totalEmpresasPages);
    this.cursosCurrentPage = Math.min(this.cursosCurrentPage, this.totalCursosPages);
  }

  private generarPaginas(totalPages: number): number[] {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  private obtenerCursosBaseSeleccionados(): CursoImpartido[] {
    if (this.empresaSeleccionada?.empresa_id) {
      return this.cursosImpartidos.filter((curso) => curso.empresa_id === this.empresaSeleccionada?.empresa_id);
    }

    if (this.esPerfilEmpresa) {
      return this.cursosImpartidos;
    }

    return [];
  }

  private aplicarSeleccionAutomaticaEmpresa(): void {
    if (!this.esPerfilEmpresa) {
      return;
    }

    const empresaPreferida = this.empresasFiltradas.find((empresa) => empresa.empresa_id === this.empresaUsuarioId)
      || this.empresasFiltradas[0]
      || null;

    if (!empresaPreferida) {
      this.empresaSeleccionada = null;
      this.cursosEmpresaFiltrados = [];
      this.cursosVisibleLimit = this.cursosPageSize;
      this.cursosCurrentPage = 1;
      return;
    }

    this.seleccionarEmpresa(empresaPreferida);
  }

  formatFechaCurso(fecha: Date | string | null | undefined): string {
    return formatearFechaCursoEs(fecha);
  }

  private normalizarTexto(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private esValorVerdadero(valor: unknown): boolean {
    if (typeof valor === 'boolean') {
      return valor;
    }
    if (typeof valor === 'number') {
      return valor > 0;
    }
    const normalizado = this.normalizarTexto(String(valor || ''));
    return normalizado === '1' || normalizado === 'true' || normalizado === 'si' || normalizado === 'sí';
  }

  private cursoTieneAnexoSubido(curso: CursoImpartido): boolean {
    if (this.esValorVerdadero(curso.tiene_entrega_documentos)
      || this.esValorVerdadero(curso.anexo_subido)
      || this.esValorVerdadero(curso.tiene_anexo)
      || this.esValorVerdadero(curso.anexo_firmado_subido)) {
      return true;
    }

    const estatusAcreditaciones = this.normalizarTexto(curso.estatus_acreditaciones || '');
    if (estatusAcreditaciones === 'entregadas') {
      return true;
    }

    const estatusAnexo = this.normalizarTexto(curso.estatus_anexo || curso.estatus_entrega_documentos || '');
    return ['subido', 'entregado', 'cargado', 'firmado', 'completado'].includes(estatusAnexo);
  }

  private empresaCumpleFiltroAnexo(empresaId: number, filtroAnexo: string): boolean {
    return this.contarCursosEmpresaSegunFiltroAnexo(empresaId, filtroAnexo) > 0;
  }

  private contarCursosEmpresaSegunFiltroAnexo(empresaId: number, filtroAnexo: string): number {
    const cursosEmpresa = this.cursosImpartidos.filter((curso) => curso.empresa_id === empresaId);
    if (cursosEmpresa.length === 0) {
      return 0;
    }

    if (!filtroAnexo) {
      return cursosEmpresa.length;
    }

    if (filtroAnexo === 'con_anexo') {
      return cursosEmpresa.filter((curso) => this.cursoTieneAnexoSubido(curso)).length;
    }

    if (filtroAnexo === 'sin_anexo') {
      return cursosEmpresa.filter((curso) => !this.cursoTieneAnexoSubido(curso)).length;
    }

    return cursosEmpresa.length;
  }
}
