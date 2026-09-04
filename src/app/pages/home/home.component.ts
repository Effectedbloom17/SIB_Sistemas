import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';
import {
  formatearFechaVisual as formatearFechaVisualUtil,
  normalizarFechaInput as normalizarFechaInputUtil
} from 'src/app/utils/fecha.util';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  categorias: any[] = [];
  cargandoCategorias: boolean = true;

  // Búsqueda en home
  terminoBusquedaHome: string = '';
  cursosParaBusqueda: any[] = [];
  cargandoBusqueda: boolean = false;

  // Modal de gestión
  mostrarModalGestion: boolean = false;
  mostrarModalEdicionCurso: boolean = false;
  mostrarFormulario: boolean = false;
  modoEdicion: boolean = false;
  cursoEnEdicionId: number | null = null;

  // Lista de cursos
  cursos: any[] = [];
  cargandoCursos: boolean = false;
  terminoBusqueda: string = '';
  filtroEstado: 'activos' | 'ocultos' = 'activos';

  // Áreas temáticas para el select
  areas: any[] = [];

  // Formulario - campos alineados con la BD (tabla curso)
  cursoForm: any = {
    curso_id: null,
    nombre_curso: '',
    descripcion: '',
    objetivo: '',
    created_at: '',
    imagen: '',
    imagen_updated_at: null,
    area_id: null,
    horas: null
  };
  imagenCursoFile: File | null = null;
  imagenPreviewTemporal: string = '';
  objetivosEspecificos: { texto: string }[] = [];

  // Mapeo de slugs a imágenes de fondo
  private imagenesArea: { [slug: string]: string } = {
    'seguridad': '/assets/img/seguridad_general.jpg',
    'higiene-seguridad': '/assets/img/seguridad_higiene.jpg',
    'salud': '/assets/img/salud_bienestar.jpg',
    'ambientales': '/assets/img/medio_ambiente.jpg',
    'productividad': '/assets/img/productividad.jpg',
    'conduccion-vehiculos': '/assets/img/conduccion.jpg',
    'areas-diversas': '/assets/img/areas_diversas.jpg',
    'cursos-especiales': '/assets/img/areas_diversas.jpg'
  };

  constructor(
    private router: Router,
    private backendService: BackendServices,
    private auth: AuthService
  ) { }

  get puedeDesactivarCursos(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  get puedeVerOcultos(): boolean {
    return this.auth.esRoot();
  }

  ngOnInit(): void {
    this.cargarCategorias();
    this.cargarAreas();
    this.cargarCursosParaBusqueda();
  }

  ngOnDestroy(): void {
    this.restaurarScrollBody();
  }

  @HostListener('document:keydown.escape')
  onEscapeGestion(): void {
    if (!this.mostrarModalGestion) return;
    if (this.mostrarModalEdicionCurso) {
      this.cerrarModalEdicionCurso();
      return;
    }
    if (this.mostrarFormulario) {
      this.cancelarFormulario();
      return;
    }
    this.cerrarModalGestion();
  }

  // trackBy: evita re-render de las tarjetas de cursos al buscar/filtrar.
  trackByCursoId(_index: number, curso: any): any {
    return curso?.curso_id ?? _index;
  }

  // Cargar todos los cursos para el buscador del home
  cargarCursosParaBusqueda() {
    this.cargandoBusqueda = true;
    this.backendService.cursos().subscribe(
      (response: any) => {
        const datos = Array.isArray(response) ? response : (response.cursos || []);
        this.cursosParaBusqueda = datos
          .sort((a: any, b: any) => a.nombre_curso.localeCompare(b.nombre_curso))
          .map((c: any) => ({
            ...c,
            imagen: c.imagen || null,
            imagen_updated_at: c.imagen_updated_at || null
          }));
        this.cargandoBusqueda = false;
      },
      () => { this.cargandoBusqueda = false; }
    );
  }

  // ── Resolución de imágenes (igual que cursosbiz) ──────────────────────────
  private imagenesDisponibles: { [key: string]: string } = {};
  private imagenesInit = false;

  resolverImagenCurso(nombreCurso: string): string | null {
    if (!nombreCurso) return null;
    if (!this.imagenesInit) { this.inicializarMapaImagenes(); this.imagenesInit = true; }
    const key = this.normalizarNombre(nombreCurso);
    const keyCompacto = this.normalizarCompacto(nombreCurso);
    if (this.imagenesDisponibles[key]) return this.imagenesDisponibles[key];
    for (const [imgKey, imgPath] of Object.entries(this.imagenesDisponibles)) {
      if (key.includes(imgKey) || imgKey.includes(key)) return imgPath;
    }
    for (const [imgKey, imgPath] of Object.entries(this.imagenesDisponibles)) {
      const imgKeyCompacto = imgKey.replace(/\s+/g, '');
      if (keyCompacto.includes(imgKeyCompacto) || imgKeyCompacto.includes(keyCompacto)) return imgPath;
    }
    return null;
  }

  private normalizarNombre(nombre: string): string {
    if (!nombre) return '';
    return String(nombre).toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  private normalizarCompacto(nombre: string): string {
    return this.normalizarNombre(nombre).replace(/\s+/g, '');
  }

  private inicializarMapaImagenes(): void {
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

  get resultadosBusquedaHome() {
    const term = this.terminoBusquedaHome.trim().toLowerCase();
    if (!term) return [];
    return this.cursosParaBusqueda.filter(c =>
      (c.nombre_curso && c.nombre_curso.toLowerCase().includes(term)) ||
      (c.nombre_area && c.nombre_area.toLowerCase().includes(term)) ||
      (c.area_tematica && c.area_tematica.toLowerCase().includes(term)) ||
      (c.objetivo && c.objetivo.toLowerCase().includes(term)) ||
      (c.descripcion && c.descripcion.toLowerCase().includes(term))
    );
  }

  limpiarBusquedaHome() {
    this.terminoBusquedaHome = '';
  }

  // Cargar categorías dinámicas desde BD (áreas con conteo de cursos)
  cargarCategorias() {
    this.cargandoCategorias = true;
    this.backendService.obtenerAreasConCursos().subscribe(
      (response: any) => {
        if (response.success) {
          this.categorias = response.areas.map((area: any) => ({
            ...area,
            imagen: this.imagenesArea[area.slug] || '/assets/img/areas_diversas.jpg'
          }));
        }
        this.cargandoCategorias = false;
      },
      (error) => {
        console.error('Error al cargar categorías:', error);
        this.cargandoCategorias = false;
      }
    );
  }

  // Obtener imagen de fondo para un área
  getImagenArea(slug: string): string {
    return this.imagenesArea[slug] || '/assets/img/areas_diversas.jpg';
  }

  navegarACategoria(slug: string): void {
    this.router.navigate(['/cursosbiz', slug]);
  }

  irACurso(cursoId: number, nombreCurso: string, areaSlug: string): void {
    this.router.navigate(['/informacion-general', cursoId], {
      queryParams: { nombre: nombreCurso, categoria: areaSlug }
    });
  }

  // Cargar áreas temáticas para el select del formulario
  cargarAreas() {
    this.backendService.obtenerAreas().subscribe(
      (response: any) => {
        if (response.success) {
          this.areas = response.areas;
        }
      },
      (error) => {
        console.error('Error al cargar áreas:', error);
      }
    );
  }

  // Abrir modal de gestión
  abrirModalGestionCursos() {
    this.mostrarModalGestion = true;
    this.filtroEstado = 'activos';
    this.bloquearScrollBody();
    this.cargarCursos();
  }

  // Cerrar modal
  cerrarModalGestion() {
    this.mostrarModalGestion = false;
    this.mostrarModalEdicionCurso = false;
    this.mostrarFormulario = false;
    this.cursoEnEdicionId = null;
    this.filtroEstado = 'activos';
    this.terminoBusqueda = '';
    this.limpiarSeleccionImagen();
    this.limpiarFormulario();
    this.restaurarScrollBody();
  }

  private bloquearScrollBody() {
    document.body.style.overflow = 'hidden';
  }

  private restaurarScrollBody() {
    document.body.style.overflow = '';
  }

  cursoEstaActivo(curso: any): boolean {
    const valor = curso?.activo;
    if (valor === false || valor === 0 || valor === '0') return false;
    return true;
  }

  cambiarFiltroEstado(estado: 'activos' | 'ocultos') {
    if (estado === 'ocultos' && !this.puedeVerOcultos) {
      this.filtroEstado = 'activos';
      return;
    }
    this.filtroEstado = estado;
  }

  get totalActivos(): number {
    return this.cursos.filter((c) => this.cursoEstaActivo(c)).length;
  }

  get totalInactivos(): number {
    return this.cursos.filter((c) => !this.cursoEstaActivo(c)).length;
  }

  // Cargar todos los cursos (incluye ocultos para poder reactivarlos)
  cargarCursos() {
    this.cargandoCursos = true;
    this.backendService.cursos(this.puedeVerOcultos).subscribe(
      (response: any) => {
        const datos = Array.isArray(response) ? response : (response.cursos || []);
        this.cursos = datos.map((c: any) => ({
          ...c,
          imagen: c.imagen || null,
          imagen_updated_at: c.imagen_updated_at || null
        })).sort((a: any, b: any) => {
          return String(a.nombre_curso || '').localeCompare(String(b.nombre_curso || ''));
        });
        this.cargandoCursos = false;
      },
      (error) => {
        console.error('Error al cargar cursos:', error);
        this.cargandoCursos = false;
        Swal.fire('Error', 'No se pudieron cargar los cursos', 'error');
      }
    );
  }

  // Abrir formulario para nuevo curso
  abrirFormularioNuevo() {
    this.mostrarModalEdicionCurso = false;
    this.mostrarFormulario = true;
    this.modoEdicion = false;
    this.cursoEnEdicionId = null;
    this.limpiarFormulario();
    this.cursoForm.created_at = this.normalizarFechaInput(new Date());
  }

  // Editar curso
  editarCurso(curso: any) {
    this.mostrarFormulario = true;
    this.modoEdicion = true;
    this.cursoEnEdicionId = curso.curso_id;
    this.liberarPreviewBlob();

    this.cursoForm = {
      curso_id: curso.curso_id || null,
      nombre_curso: curso.nombre_curso || '',
      descripcion: curso.descripcion || '',
      objetivo: curso.objetivo || '',
      created_at: this.normalizarFechaInput(curso.created_at) || '',
      imagen: curso.imagen || '',
      imagen_updated_at: curso.imagen_updated_at || null,
      area_id: curso.area_id || null,
      horas: curso.horas || null
    };

    this.objetivosEspecificos = this.aListaCampos(curso.objetivos_especificos);
    this.imagenCursoFile = null;
    this.imagenPreviewTemporal = this.obtenerImagenCurso(curso) || '';

    setTimeout(() => {
      document.querySelector('.cac-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  private aListaCampos(valor: any): { texto: string }[] {
    const items = Array.isArray(valor)
      ? valor.map((item: any) => String(item || '').trim()).filter(Boolean)
      : [];
    return items.map((texto) => ({ texto }));
  }

  agregarObjetivoEspecifico() {
    this.objetivosEspecificos = [...this.objetivosEspecificos, { texto: '' }];
  }

  quitarObjetivoEspecifico(index: number) {
    this.objetivosEspecificos = this.objetivosEspecificos.filter((_, i) => i !== index);
  }

  trackByIndex(index: number): number {
    return index;
  }

  cerrarModalEdicionCurso() {
    this.cancelarFormulario();
  }

  onImagenCursoSeleccionada(event: any) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      Swal.fire('Archivo no válido', 'Solo se permiten imágenes JPG, PNG o WebP', 'warning');
      event.target.value = '';
      return;
    }

    if (file.size > (6 * 1024 * 1024)) {
      Swal.fire('Archivo muy grande', 'La imagen debe ser menor o igual a 6MB', 'warning');
      event.target.value = '';
      return;
    }

    this.liberarPreviewBlob();
    this.imagenCursoFile = file;

    const reader = new FileReader();
    reader.onload = () => {
      this.imagenPreviewTemporal = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.onerror = () => {
      this.imagenPreviewTemporal = '';
      Swal.fire('Error', 'No se pudo previsualizar la imagen seleccionada', 'error');
    };
    reader.readAsDataURL(file);

    if (event?.target) {
      event.target.value = '';
    }
  }

  limpiarSeleccionImagen() {
    this.liberarPreviewBlob();
    this.imagenCursoFile = null;
    this.imagenPreviewTemporal = this.obtenerImagenCurso(this.cursoForm) || '';
  }

  private liberarPreviewBlob() {
    if (this.imagenPreviewTemporal && this.imagenPreviewTemporal.startsWith('blob:')) {
      URL.revokeObjectURL(this.imagenPreviewTemporal);
    }
  }

  private guardarConImagenOpcional(cursoId: number, titulo: string, texto: string) {
    if (!Number.isFinite(cursoId) || cursoId <= 0) {
      Swal.fire('Error', 'No se pudo identificar el curso para subir su imagen', 'error');
      return;
    }

    if (!this.imagenCursoFile) {
      this.finalizarGuardado(titulo, texto);
      return;
    }

    const formData = new FormData();
    formData.append('imagen', this.imagenCursoFile);

    this.backendService.subirImagenCurso(cursoId, formData).subscribe(
      (response: any) => {
        const imagenActualizada = response?.imagen || this.cursoForm.imagen || '';
        const imagenUpdatedAt = response?.imagen_updated_at || new Date().toISOString();
        this.actualizarImagenCursoLocal(cursoId, imagenActualizada, imagenUpdatedAt);
        this.finalizarGuardado(titulo, texto);
      },
      (error) => {
        console.error('Error al subir imagen:', error);
        const mensaje = error.error?.message || 'El curso se guardó, pero la imagen no pudo actualizarse';
        Swal.fire('Curso guardado con advertencia', mensaje, 'warning');
        this.cargarCursos();
        this.cargarCursosParaBusqueda();
        this.cancelarFormulario();
      }
    );
  }

  private finalizarGuardado(titulo: string, texto: string) {
    Swal.fire({
      title: titulo,
      text: texto,
      icon: 'success',
      confirmButtonColor: '#38512F'
    });
    this.cargarCursos();
    this.cargarCursosParaBusqueda();
    this.cargarCategorias();
    this.cancelarFormulario();
  }

  private actualizarImagenCursoLocal(cursoId: number, imagen: string, imagenUpdatedAt?: string | null) {
    this.cursoForm.imagen = imagen || '';
    this.cursoForm.imagen_updated_at = imagenUpdatedAt || null;
    this.imagenPreviewTemporal = this.obtenerImagenCurso(this.cursoForm) || '';

    this.cursos = this.cursos.map((curso: any) => {
      if (Number(curso.curso_id) !== Number(cursoId)) return curso;
      return {
        ...curso,
        imagen,
        imagen_updated_at: imagenUpdatedAt || null
      };
    });

    this.cursosParaBusqueda = this.cursosParaBusqueda.map((curso: any) => {
      if (Number(curso.curso_id) !== Number(cursoId)) return curso;
      return {
        ...curso,
        imagen,
        imagen_updated_at: imagenUpdatedAt || null
      };
    });
  }

  // Guardar curso (crear o actualizar)
  guardarCurso() {
    // Validaciones
    if (!this.cursoForm.nombre_curso || !this.cursoForm.nombre_curso.trim()) {
      Swal.fire('Error', 'El nombre del curso es requerido', 'warning');
      return;
    }

    if (!this.cursoForm.area_id) {
      Swal.fire('Error', 'El área temática es requerida', 'warning');
      return;
    }

    if (!this.cursoForm.horas || this.cursoForm.horas < 1) {
      Swal.fire('Error', 'Las horas deben ser mayor a 0', 'warning');
      return;
    }

    const objetivoNormalizado = String(this.cursoForm.objetivo || '').trim();
    const descripcionNormalizada = String(this.cursoForm.descripcion || '').trim();
    const objetivosEspecificos = this.objetivosEspecificos
      .map((item) => String(item?.texto || '').trim())
      .filter(Boolean);

    const payload: any = {
      curso_id: this.cursoForm.curso_id,
      nombre_curso: this.cursoForm.nombre_curso.trim(),
      descripcion: descripcionNormalizada || objetivoNormalizado || null,
      objetivo: objetivoNormalizado || null,
      objetivos_especificos: objetivosEspecificos,
      area_id: Number(this.cursoForm.area_id),
      horas: Number(this.cursoForm.horas),
      imagen: this.cursoForm.imagen || null
    };

    const fechaRegistro = this.normalizarFechaInput(this.cursoForm.created_at);
    if (fechaRegistro) {
      payload.created_at = fechaRegistro;
    }

    if (this.modoEdicion) {
      // Actualizar
      this.backendService.actualizarCurso(payload).subscribe(
        (response: any) => {
          if (response.success) {
            this.guardarConImagenOpcional(payload.curso_id, 'Actualizado', 'Curso actualizado exitosamente');
          } else {
            Swal.fire('Error', response.message || 'No se pudo actualizar', 'error');
          }
        },
        (error) => {
          console.error('Error al actualizar:', error);
          const mensaje = error.error?.message || error.message || 'Error de conexión con el servidor';
          Swal.fire({
            title: 'Error al Actualizar',
            text: mensaje,
            icon: 'error'
          });
        }
      );
    } else {
      // Crear nuevo
      this.backendService.crearCurso(payload).subscribe(
        (response: any) => {
          if (response.success) {
            const nuevoCursoId = Number(response.curso_id);
            this.guardarConImagenOpcional(nuevoCursoId, 'Guardado', 'Curso creado exitosamente');
          } else {
            Swal.fire('Error', response.message || 'No se pudo crear', 'error');
          }
        },
        (error) => {
          console.error('Error al crear:', error);
          const mensaje = error.error?.message || error.message || 'Error de conexión con el servidor';
          Swal.fire({
            title: 'Error al Crear Curso',
            text: mensaje,
            icon: 'error'
          });
        }
      );
    }
  }

  // Desactivar curso (soft delete: activo = 0). Solo administradores y root.
  eliminarCurso(curso: any) {
    if (!this.puedeDesactivarCursos) {
      Swal.fire({
        icon: 'info',
        title: 'Acción restringida',
        text: 'Solo un administrador puede desactivar cursos del catálogo.',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#38512F',
        customClass: { popup: 'swal2-fm-alert swal2-fm-alert--cac' }
      });
      return;
    }

    const nombre = this.escapeHtml(curso.nombre_curso || 'este curso');
    Swal.fire({
      icon: 'warning',
      title: '¿Desactivar este curso?',
      html: `
        <p class="mb-1">Vas a ocultar <strong>${nombre}</strong> del catálogo, categorías y asignaciones nuevas.</p>
        <div class="fm-alert-destino">
          <i class="fas fa-shield-alt"></i>
          El registro se conserva: historial, DC-3 y relaciones quedan intactos.
        </div>
      `,
      showCancelButton: true,
      reverseButtons: true,
      focusCancel: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Conservar activo',
      confirmButtonColor: '#c05621',
      cancelButtonColor: '#5a6f52',
      customClass: {
        popup: 'swal2-fm-alert swal2-fm-alert--cac',
        confirmButton: 'cac-swal-danger'
      }
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendService.eliminarCurso(curso.curso_id).subscribe(
        (response: any) => {
          if (response.success) {
            Swal.fire({
              icon: 'success',
              title: 'Curso desactivado',
              html: this.puedeVerOcultos
                ? `<p class="mb-1"><strong>${nombre}</strong> ya no es visible en el catálogo.</p>
                   <div class="fm-alert-destino"><i class="fas fa-undo"></i> Puedes reactivarlo desde la pestaña Ocultos.</div>`
                : `<p class="mb-1"><strong>${nombre}</strong> ya no es visible en el catálogo.</p>
                   <div class="fm-alert-destino"><i class="fas fa-user-shield"></i> El super administrador puede reactivarlo desde Ocultos.</div>`,
              confirmButtonText: 'Entendido',
              confirmButtonColor: '#38512F',
              customClass: { popup: 'swal2-fm-alert swal2-fm-alert--cac' }
            });
            this.cargarCursos();
            this.cargarCursosParaBusqueda();
            this.cargarCategorias();
          } else {
            Swal.fire({
              icon: 'error',
              title: 'No se pudo desactivar',
              text: response.message || 'No se pudo desactivar el curso.',
              confirmButtonColor: '#38512F',
              customClass: { popup: 'swal2-fm-alert swal2-fm-alert--cac' }
            });
          }
        },
        (error) => {
          console.error('Error al desactivar:', error);
          const mensaje = error.error?.message || error.message || 'Error de conexión con el servidor';
          Swal.fire({
            icon: 'error',
            title: 'Error al desactivar',
            text: mensaje,
            confirmButtonColor: '#38512F',
            customClass: { popup: 'swal2-fm-alert swal2-fm-alert--cac' }
          });
        }
      );
    });
  }

  reactivarCurso(curso: any) {
    if (!this.puedeVerOcultos) {
      return;
    }
    const nombre = this.escapeHtml(curso.nombre_curso || 'este curso');
    Swal.fire({
      icon: 'question',
      title: '¿Reactivar este curso?',
      html: `
        <p class="mb-1"><strong>${nombre}</strong> volverá a ser visible en el catálogo y en las asignaciones nuevas.</p>
        <div class="fm-alert-destino">
          <i class="fas fa-eye"></i>
          El registro pasa a activo = 1. Historial y relaciones se mantienen.
        </div>
      `,
      showCancelButton: true,
      reverseButtons: true,
      focusCancel: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      customClass: { popup: 'swal2-fm-alert swal2-fm-alert--cac' }
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendService.activarCurso(curso.curso_id).subscribe(
        (response: any) => {
          if (response.success) {
            Swal.fire({
              icon: 'success',
              title: 'Curso activo',
              html: `<p class="mb-1"><strong>${nombre}</strong> ya es visible en el catálogo y en las asignaciones.</p>`,
              confirmButtonText: 'Entendido',
              confirmButtonColor: '#38512F',
              customClass: { popup: 'swal2-fm-alert swal2-fm-alert--cac' }
            });
            this.filtroEstado = 'activos';
            this.cargarCursos();
            this.cargarCursosParaBusqueda();
            this.cargarCategorias();
          } else {
            Swal.fire('Error', response.message || 'No se pudo reactivar', 'error');
          }
        },
        (error) => {
          console.error('Error al reactivar:', error);
          const mensaje = error.error?.message || error.message || 'Error de conexión con el servidor';
          Swal.fire('Error al reactivar', mensaje, 'error');
        }
      );
    });
  }

  private escapeHtml(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Cancelar formulario
  cancelarFormulario() {
    this.mostrarModalEdicionCurso = false;
    this.mostrarFormulario = false;
    this.cursoEnEdicionId = null;
    this.limpiarSeleccionImagen();
    this.limpiarFormulario();
  }

  // Limpiar formulario
  limpiarFormulario() {
    this.liberarPreviewBlob();
    this.cursoForm = {
      curso_id: null,
      nombre_curso: '',
      descripcion: '',
      objetivo: '',
      created_at: '',
      imagen: '',
      imagen_updated_at: null,
      area_id: null,
      horas: null
    };
    this.imagenCursoFile = null;
    this.imagenPreviewTemporal = '';
    this.objetivosEspecificos = [];
    this.modoEdicion = false;
  }

  normalizarFechaInput(fecha: any): string {
    return normalizarFechaInputUtil(fecha);
  }

  formatearFechaVisual(fecha: any): string {
    return formatearFechaVisualUtil(fecha);
  }

  obtenerImagenCurso(curso: any): string | null {
    return this.resolverUrlImagenConVersion(curso?.imagen, curso?.imagen_updated_at)
      || this.resolverImagenCurso(curso?.nombre_curso)
      || null;
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
    if (!version) {
      return normalizada;
    }

    const separador = normalizada.includes('?') ? '&' : '?';
    return `${normalizada}${separador}v=${version}`;
  }

  // Getter para filtrar cursos en tiempo real
  get cursosFiltrados() {
    const quiereActivos = this.filtroEstado !== 'ocultos' || !this.puedeVerOcultos;
    const porEstado = this.cursos.filter((c) => this.cursoEstaActivo(c) === quiereActivos);

    if (!this.terminoBusqueda || this.terminoBusqueda.trim() === '') {
      return porEstado;
    }
    const term = this.terminoBusqueda.toLowerCase().trim();
    return porEstado.filter(c =>
      (c.nombre_curso && c.nombre_curso.toLowerCase().includes(term)) ||
      (c.area_tematica && c.area_tematica.toLowerCase().includes(term)) ||
      (c.nombre_area && c.nombre_area.toLowerCase().includes(term)) ||
      (c.objetivo && c.objetivo.toLowerCase().includes(term)) ||
      (c.descripcion && c.descripcion.toLowerCase().includes(term))
    );
  }
}
