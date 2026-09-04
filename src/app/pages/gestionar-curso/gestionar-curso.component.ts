import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { BackendServices } from '../../services/backend.services';
import { GoogleCalendarService } from '../../services/google-calendar.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';
import { formatearFechaDdmmaaaa, normalizarFechaInput, parsearFechaSoloDia } from 'src/app/utils/fecha.util';

@Component({
  selector: 'app-gestionar-curso',
  templateUrl: './gestionar-curso.component.html',
  styleUrls: ['./gestionar-curso.component.scss']
})
export class GestionarCursoComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private progresoRefreshTimer: any = null;
  cursoId: number | null = null;
  curso: any = null;
  loading: boolean = true;
  error: string = '';

  // Datos del curso
  nombreCurso: string = '';
  empresaNombre: string = '';
  instructorNombre: string = '';
  fechaInicio: string = '';
  fechaFin: string = '';
  horaInicio: string = '';
  horaFin: string = '';
  modalidad: string = '';
  ubicacion: string = '';
  participantes: number = 0;
  cupo: number = 0;
  estatus: string = '';

  // Pasos del curso
  pasosCompletados: number[] = [];
  pasosCurso = [
    // --- CAPACITACIÓN ---
    { numero: 1, nombre: 'Inicio', icono: 'fa-play', descripcion: 'Inicio del curso', seccion: 'capacitacion' },
    { numero: 2, nombre: 'Checklist', icono: 'fa-tasks', descripcion: 'Control de materiales', seccion: 'capacitacion' },
    { numero: 3, nombre: 'Encuesta', icono: 'fa-poll', descripcion: 'Encuesta de satisfacción', seccion: 'capacitacion' },
    { numero: 4, nombre: 'Pase de lista', icono: 'fa-clipboard-check', descripcion: 'Registro de asistencia', seccion: 'capacitacion' },
    // --- DOCUMENTACIÓN ---
    { numero: 5, nombre: 'Examenes', icono: 'fa-file-alt', descripcion: 'Diagnóstico y evaluación final', seccion: 'documentacion' },
    { numero: 6, nombre: 'Evidencias', icono: 'fa-camera', descripcion: 'Fotos del curso', seccion: 'documentacion' },
    { numero: 7, nombre: 'Informe final', icono: 'fa-file-pdf', descripcion: 'Reporte de resultados', seccion: 'documentacion' },
    { numero: 8, nombre: 'Constancias y DC-3', icono: 'fa-certificate', descripcion: 'Generación de documentos', seccion: 'documentacion' },
    { numero: 10, nombre: 'Finalizado', icono: 'fa-check-circle', descripcion: 'Curso completado', seccion: 'documentacion' }
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private backendServices: BackendServices,
    private authService: AuthService,
    private googleCalendarService: GoogleCalendarService
  ) {}

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['id']) {
        this.cursoId = +params['id'];
        this.resetState();
        this.cargarDatosCurso();
      } else {
        this.error = 'No se proporcionó ID de curso';
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.detenerAutoRefreshProgreso();
    this.destroy$.next();
    this.destroy$.complete();
  }

  resetState(): void {
    this.curso = null;
    this.nombreCurso = '';
    this.empresaNombre = '';
    this.instructorNombre = '';
    this.fechaInicio = '';
    this.fechaFin = '';
    this.pasosCompletados = [];
    this.error = '';
  }

  /**
   * Carga los datos del curso desde el backend
   */
  cargarDatosCurso(): void {
    if (!this.cursoId) return;

    this.loading = true;
    this.error = '';

    this.backendServices.obtenerCursosProgramados().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        const cursos = response.cursosProgramados || response;
        const encontrado = (Array.isArray(cursos) ? cursos : []).find(
          (c: any) => c.programado_id === this.cursoId
        );

        if (encontrado) {
          this.curso = encontrado;
          this.nombreCurso = encontrado.nombre_curso || '';
          this.empresaNombre = encontrado.nombre_empresa || '';
          this.instructorNombre = encontrado.instructor_nombre || encontrado.nombre_instructor || '';
          this.fechaInicio = normalizarFechaInput(encontrado.fecha_inicio) || '';
          this.fechaFin = normalizarFechaInput(encontrado.fecha_fin) || '';
          this.horaInicio = encontrado.hora_inicio || '';
          this.horaFin = encontrado.hora_fin || '';
          this.modalidad = encontrado.modalidad || '';
          this.ubicacion = encontrado.lugar || encontrado.localidad || '';
          this.participantes = encontrado.inscritos || 0;
          this.cupo = encontrado.cupo || 0;
          this.estatus = encontrado.estatus || 'programado';

          // Cargar progreso directamente del objeto curso (viene del endpoint con pasos_completados)
          this.parsearPasosDesdeObjeto(encontrado);
          // También intentar endpoint separado y auto-refresh
          this.cargarProgreso();
          this.iniciarAutoRefreshProgreso();
        } else {
          this.error = 'Curso no encontrado';
          this.detenerAutoRefreshProgreso();
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Error al cargar los datos del curso';
        this.detenerAutoRefreshProgreso();
        this.loading = false;
      }
    });
  }

  /**
   * Formatea una fecha para mostrar
   */
  formatDate(fecha: string): string {
    return formatearFechaDdmmaaaa(fecha);
  }

  /**
   * Volver a la página anterior
   */
  volver(): void {
    this.router.navigate(['/curso-activos']);
  }

  // =====================================================
  // ACCIONES DE CAMBIO DE ESTATUS (conectadas al backend)
  // =====================================================

  /**
   * Iniciar el curso
   */
  async iniciarCurso(): Promise<void> {
    const result = await Swal.fire({
      title: '¿Iniciar curso?',
      text: 'El estatus se cambiará a "En Curso". ¿Desea continuar?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Sí, iniciar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      this.actualizarEstatus('en_curso');
    }
  }

  /**
   * Finalizar el curso
   */
  async finalizarCurso(): Promise<void> {
    const result = await Swal.fire({
      title: '¿Finalizar curso?',
      text: 'El estatus se cambiará a "Completado". Esta acción indica que el curso se dio por completo.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Sí, finalizar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      this.actualizarEstatus('completado');
    }
  }

  /**
   * Cancelar el curso
   */
  async cancelarCurso(): Promise<void> {
    if (!this.esAdmin) {
      Swal.fire({
        icon: 'error',
        title: 'Sin permisos',
        text: 'Solo los administradores pueden cancelar cursos.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (!this.curso?.programado_id) {
      return;
    }

    const curso = this.curso;

    Swal.fire({
      title: '¿Eliminar este curso?',
      html: `
        <div style="text-align: left; margin-bottom: 1rem;">
          <p style="margin-bottom: 0.5rem;"><strong>${curso.nombre_curso || this.nombreCurso}</strong></p>
          <small class="text-muted">${curso.nombre_empresa || this.empresaNombre || 'Sin empresa'} · ${this.formatDate(curso.fecha_inicio || this.fechaInicio)}</small>
          ${(curso.inscritos || this.participantes || 0) > 0 ? `<div class="mt-2" style="color: #f5365c; font-size: 0.85rem;"><i class="fas fa-exclamation-triangle mr-1"></i>Se eliminarán <strong>${curso.inscritos || this.participantes} inscripción(es)</strong> asociadas.</div>` : ''}
        </div>
        <hr style="border-top: 1px solid #dee2e6;">
        <div style="text-align: left; margin-top: 1rem;">
          <label style="font-weight: 600; color: #1A1A1A; font-size: 0.9rem;">
            <i class="fas fa-lock mr-2" style="color: #38512F;"></i>
            Confirma tu contraseña:
          </label>
          <input type="text" id="passwordConfirmDelete" class="form-control mt-2" placeholder="Ingresa tu contraseña"
                 autocomplete="off" data-lpignore="true" data-form-type="other" data-1p-ignore
                 style="border: 2px solid #dee2e6; border-radius: 8px; padding: 0.6rem; -webkit-text-security: disc; text-security: disc;">
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      didOpen: () => {
        const pwInput = document.getElementById('passwordConfirmDelete') as HTMLInputElement;
        if (pwInput) {
          pwInput.focus();
        }
      },
      preConfirm: () => {
        const passwordInput = document.getElementById('passwordConfirmDelete') as HTMLInputElement;
        const password = passwordInput?.value;
        if (!password) {
          Swal.showValidationMessage('Debes ingresar tu contraseña');
          return false;
        }
        return password;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        this.backendServices.verificarPassword(result.value)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (authResponse: any) => {
              if (!authResponse.success) {
                Swal.fire({
                  icon: 'error',
                  title: 'Contraseña incorrecta',
                  text: 'La contraseña ingresada no es correcta',
                  confirmButtonColor: '#38512F'
                });
                return;
              }

              const token = this.authService.getToken();
              if (!token) {
                Swal.fire({ icon: 'error', title: 'Error', text: 'Sesión expirada', confirmButtonColor: '#38512F' });
                return;
              }

              const actualizarBarra = (pct: number, texto?: string) => {
                const bar = document.getElementById('swal-prog-bar');
                const pctEl = document.getElementById('swal-prog-pct');
                const txEl = document.getElementById('swal-paso-txt');
                if (bar) bar.style.width = `${pct}%`;
                if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
                if (txEl && texto) txEl.textContent = texto;
              };

              Swal.fire({
                title: 'Eliminando curso',
                html: `
                  <p id="swal-paso-txt" style="color:#6c757d;font-size:0.88rem;margin-bottom:0.75rem;">Conectando...</p>
                  <div style="background:#e9ecef;border-radius:8px;overflow:hidden;height:12px;">
                    <div id="swal-prog-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#38512F,#768D6B);border-radius:8px;transition:width 0.4s ease;"></div>
                  </div>
                  <p id="swal-prog-pct" style="color:#38512F;font-weight:600;margin-top:0.4rem;font-size:0.85rem;">0%</p>
                `,
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false
              });

              const sseUrl = this.backendServices.getEliminarCursoStreamUrl(curso.programado_id, token);
              const sse = new EventSource(sseUrl);
              let lastProgress = 0;
              let completed = false;

              sse.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.error) {
                  sse.close();
                  Swal.fire({
                    icon: 'error',
                    title: 'Error al eliminar',
                    text: data.message || 'No se pudo eliminar el curso programado',
                    confirmButtonColor: '#38512F'
                  });
                  return;
                }

                if (data.progress !== undefined) {
                  lastProgress = data.progress;
                  actualizarBarra(data.progress, data.message);
                }

                if (data.done) {
                  completed = true;
                  sse.close();
                  actualizarBarra(100, 'Completado');

                  this.googleCalendarService.deleteEventsByCursoId(curso.programado_id)
                    .then(() => { })
                    .catch(() => { });

                  setTimeout(() => {
                    Swal.fire({
                      icon: 'success',
                      title: 'Curso eliminado',
                      html: `<p>${data.message || 'Curso eliminado correctamente'}</p>${(data.inscripcionesEliminadas ?? 0) > 0 ? `<small class="text-muted">${data.inscripcionesEliminadas} inscripción(es) eliminadas</small>` : ''}`,
                      confirmButtonColor: '#38512F',
                      timer: 2500
                    });
                  }, 400);

                  this.router.navigate(['/curso-activos']);
                }
              };

              sse.onerror = () => {
                sse.close();
                if (completed) return;
                if (lastProgress > 50) {
                  Swal.fire({
                    icon: 'warning',
                    title: 'Conexión interrumpida',
                    text: 'La eliminación pudo haberse completado. Recarga la página para verificar.',
                    confirmButtonColor: '#38512F'
                  });
                  this.router.navigate(['/curso-activos']);
                } else {
                  Swal.fire({
                    icon: 'error',
                    title: 'Error de conexión',
                    text: 'Se perdió la conexión con el servidor. Intenta de nuevo.',
                    confirmButtonColor: '#38512F'
                  });
                }
              };
            },
            error: () => {
              Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'No se pudo verificar la contraseña',
                confirmButtonColor: '#38512F'
              });
            }
          });
      }
    });
  }

  /**
   * Envía el nuevo estatus al backend y actualiza local
   */
  private actualizarEstatus(nuevoEstatus: string): void {
    if (!this.curso?.programado_id) return;

    Swal.fire({
      title: 'Actualizando estatus...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendServices.actualizarCursoProgramado(this.curso.programado_id, { estatus: nuevoEstatus }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.estatus = nuevoEstatus;

          Swal.fire({
            title: 'Listo',
            text: `Curso actualizado a "${this.getEstatusLabel(nuevoEstatus)}"`,
            icon: 'success',
            confirmButtonColor: '#38512F',
            timer: 1500,
            showConfirmButton: false
          });
        }
      },
      error: () => {
        Swal.fire({
          title: 'Error',
          text: 'No se pudo actualizar el estatus del curso',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  // =====================================================
  // MÉTODOS DE NAVIGACIÓN (stubs pendientes)
  // =====================================================

  verParticipantes(): void {
    if (!this.cursoId) {
      return;
    }

    Swal.fire({
      title: 'Cargando participantes...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendServices.obtenerParticipantesCurso(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (resp: any) => {
        const participantes = Array.isArray(resp?.participantes) ? resp.participantes : [];

        if (participantes.length === 0) {
          Swal.fire({
            title: 'Sin participantes',
            text: 'Este curso aún no tiene empleados registrados.',
            icon: 'info',
            confirmButtonColor: '#38512F'
          });
          return;
        }

        const filas = participantes.map((p: any, i: number) => {
          const nombre = p.nombre_completo || [p.nombre, p.apellido_paterno, p.apellido_materno].filter(Boolean).join(' ');
          return `
            <tr>
              <td style="padding:0.55rem 0.4rem; border-bottom:1px solid #eceff5;">${i + 1}</td>
              <td style="padding:0.55rem 0.4rem; border-bottom:1px solid #eceff5; font-weight:600;">${this.escapeHtml(nombre || '-')}</td>
              <td style="padding:0.55rem 0.4rem; border-bottom:1px solid #eceff5;">${this.escapeHtml(p.curp || '-')}</td>
              <td style="padding:0.55rem 0.4rem; border-bottom:1px solid #eceff5;">${this.escapeHtml(p.puesto || '-')}</td>
              <td style="padding:0.55rem 0.4rem; border-bottom:1px solid #eceff5;">${p.empleado_id || '-'}</td>
            </tr>
          `;
        }).join('');

        Swal.fire({
          title: `Participantes (${participantes.length})`,
          width: 980,
          html: `
            <div style="text-align:left; margin-bottom:0.75rem; color:#6c757d; font-size:0.88rem;">
              Curso: <strong style="color:#38512F;">${this.escapeHtml(this.nombreCurso)}</strong>
            </div>
            <div style="max-height:420px; overflow:auto; border:1px solid #eceff5; border-radius:8px;">
              <table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
                <thead style="position:sticky; top:0; background:#f8f9fe; z-index:1;">
                  <tr>
                    <th style="padding:0.65rem 0.4rem; text-align:left; border-bottom:1px solid #dde2ef;">#</th>
                    <th style="padding:0.65rem 0.4rem; text-align:left; border-bottom:1px solid #dde2ef;">Nombre</th>
                    <th style="padding:0.65rem 0.4rem; text-align:left; border-bottom:1px solid #dde2ef;">CURP</th>
                    <th style="padding:0.65rem 0.4rem; text-align:left; border-bottom:1px solid #dde2ef;">Puesto</th>
                    <th style="padding:0.65rem 0.4rem; text-align:left; border-bottom:1px solid #dde2ef;">ID Empleado</th>
                  </tr>
                </thead>
                <tbody>${filas}</tbody>
              </table>
            </div>
          `,
          confirmButtonColor: '#38512F'
        });
      },
      error: () => {
        Swal.fire({
          title: 'Error',
          text: 'No se pudieron cargar los participantes del curso.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  editarCurso(): void {
    if (!this.curso?.programado_id) {
      return;
    }

    const c = this.curso;
    const fechaInicio = this.toDateInput(c.fecha_inicio || this.fechaInicio);
    const fechaFin = this.toDateInput(c.fecha_fin || this.fechaFin || c.fecha_inicio);
    const horaInicio = this.toTimeInput(c.hora_inicio || this.horaInicio);
    const horaFin = this.toTimeInput(c.hora_fin || this.horaFin);

    Swal.fire({
      title: 'Cargando opciones...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    Promise.all([
      firstValueFrom(this.backendServices.cursos()),
      firstValueFrom(this.backendServices.obtenerEmpresas()),
      firstValueFrom(this.backendServices.obtenerInstructores())
    ]).then(([cursosResp, empresasResp, instructoresResp]: any[]) => {
      const cursos = Array.isArray(cursosResp) ? cursosResp : (cursosResp?.cursos || []);
      const empresas = Array.isArray(empresasResp?.empresas) ? empresasResp.empresas : (Array.isArray(empresasResp) ? empresasResp : []);
      const instructores = Array.isArray(instructoresResp?.instructores) ? instructoresResp.instructores : (Array.isArray(instructoresResp) ? instructoresResp : []);

      const opcionesCurso = cursos
        .map((item: any) => `<option value="${item.curso_id}" ${Number(item.curso_id) === Number(c.curso_id) ? 'selected' : ''}>${this.escapeHtml(item.nombre_curso || `Curso #${item.curso_id}`)}</option>`)
        .join('');
      const opcionesEmpresa = empresas
        .map((item: any) => `<option value="${item.empresa_id}" ${Number(item.empresa_id) === Number(c.empresa_id) ? 'selected' : ''}>${this.escapeHtml(item.nombre_empresa || `Empresa #${item.empresa_id}`)}</option>`)
        .join('');
      const opcionesInstructor = [`<option value="" disabled ${!c.instructor_id ? 'selected' : ''}>— Selecciona un instructor —</option>`]
        .concat(instructores.map((item: any) => {
          const nombre = [item.nombre, item.apellido_paterno, item.apellido_materno].filter(Boolean).join(' ').trim();
          return `<option value="${item.instructor_id}" ${Number(item.instructor_id) === Number(c.instructor_id) ? 'selected' : ''}>${this.escapeHtml(nombre || `Instructor #${item.instructor_id}`)}</option>`;
        }))
        .join('');

      Swal.fire({
      title: '',
      width: 780,
      padding: 0,
      showCloseButton: true,
      reverseButtons: true,
      focusConfirm: false,
      backdrop: `rgba(15, 23, 42, 0.42)`,
      customClass: {
        container: 'gc-edit-swal-container',
        popup: 'gc-edit-swal',
        htmlContainer: 'gc-edit-swal__html',
        actions: 'gc-edit-swal__actions',
        confirmButton: 'gc-edit-btn gc-edit-btn--primary',
        cancelButton: 'gc-edit-btn gc-edit-btn--ghost',
        closeButton: 'gc-edit-swal__close'
      },
      didOpen: () => {
        const container = document.querySelector('.gc-edit-swal-container') as HTMLElement | null;
        if (container) {
          container.style.background = 'rgba(15, 23, 42, 0.42)';
          container.style.setProperty('backdrop-filter', 'blur(10px) saturate(0.88)');
          container.style.setProperty('-webkit-backdrop-filter', 'blur(10px) saturate(0.88)');
        }
        const actions = document.querySelector('.gc-edit-swal__actions');
        if (actions && !actions.querySelector('.gc-edit-footnote')) {
          const note = document.createElement('span');
          note.className = 'gc-edit-footnote';
          note.innerHTML = '<i class="fas fa-info-circle"></i> Revisa asignación, agenda y observaciones antes de guardar';
          actions.insertBefore(note, actions.firstChild);
        }
      },
      html: `
        <style>
          .gc-edit-swal-container.swal2-backdrop-show {
            background: rgba(15, 23, 42, 0.42) !important;
            backdrop-filter: blur(10px) saturate(0.88) !important;
            -webkit-backdrop-filter: blur(10px) saturate(0.88) !important;
          }
          .gc-edit-swal {
            border-radius: 20px !important;
            overflow: hidden !important;
            background: #f7f9f6 !important;
            border: 1px solid rgba(255,255,255,0.65) !important;
            box-shadow:
              0 0 0 1px rgba(26, 38, 32, 0.04),
              0 28px 80px rgba(26, 38, 32, 0.32),
              0 8px 24px rgba(56, 81, 47, 0.12) !important;
            font-family: 'Open Sans', sans-serif !important;
          }
          .gc-edit-swal .swal2-title { display: none !important; }
          .gc-edit-swal .swal2-html-container {
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            text-align: left !important;
          }
          .gc-edit-swal .swal2-validation-message {
            margin: 0 1.35rem 0.75rem !important;
            border-radius: 10px !important;
            background: #fdf2f2 !important;
            color: #9b2c2c !important;
          }
          .gc-edit-swal__close {
            position: absolute !important;
            top: 1.1rem !important;
            right: 1.15rem !important;
            z-index: 6 !important;
            width: 2.35rem !important;
            height: 2.35rem !important;
            border-radius: 10px !important;
            border: 1px solid rgba(255,255,255,0.35) !important;
            background: rgba(255,255,255,0.14) !important;
            color: #fff !important;
            font-size: 1.05rem !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-shadow: none !important;
            transition: background 0.2s ease, transform 0.2s ease !important;
          }
          .gc-edit-swal__close:hover {
            background: rgba(255,255,255,0.26) !important;
            color: #fff !important;
            transform: rotate(90deg) !important;
          }
          .gc-edit-swal__actions {
            margin: 0 !important;
            padding: 0.85rem 1.35rem 1.1rem !important;
            gap: 0.65rem !important;
            display: flex !important;
            flex-wrap: wrap !important;
            align-items: center !important;
            justify-content: flex-end !important;
            background: rgba(255,255,255,0.94) !important;
            border-top: 1px solid rgba(226, 232, 222, 0.9) !important;
          }
          .gc-edit-footnote {
            margin: 0 auto 0 0 !important;
            font-size: 0.72rem !important;
            color: #6b7c6e !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 0.35rem !important;
            flex: 1 1 auto !important;
            text-align: left !important;
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
          }
          .gc-edit-footnote i { color: #38512F; }
          .gc-edit-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 0.4rem !important;
            padding: 0.55rem 1.05rem !important;
            font-size: 0.82rem !important;
            font-weight: 600 !important;
            border-radius: 10px !important;
            border: none !important;
            box-shadow: none !important;
            transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
          }
          .gc-edit-btn--ghost {
            background: #fff !important;
            color: #5a6b58 !important;
            border: 1.5px solid #d8e0d4 !important;
          }
          .gc-edit-btn--ghost:hover {
            background: #f4f6f2 !important;
            color: #38512F !important;
            transform: translateY(-1px) !important;
          }
          .gc-edit-btn--primary {
            background: linear-gradient(135deg, #38512F 0%, #5a7456 100%) !important;
            color: #fff !important;
            box-shadow: 0 4px 14px rgba(56, 81, 47, 0.28) !important;
          }
          .gc-edit-btn--primary:hover {
            transform: translateY(-2px) !important;
            box-shadow: 0 8px 20px rgba(56, 81, 47, 0.32) !important;
          }
          .gc-edit-modal { position: relative; text-align: left; }
          .gc-edit-header {
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
          }
          .gc-edit-header__bg {
            position: absolute;
            inset: 0;
            background:
              linear-gradient(135deg, rgba(36,54,31,0.95) 0%, rgba(56,81,47,0.9) 45%, rgba(45,70,38,0.96) 100%);
          }
          .gc-edit-header__bg::after {
            content: '';
            position: absolute;
            inset: 0;
            background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
            opacity: 0.55;
            pointer-events: none;
          }
          .gc-edit-header__content {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-columns: auto 1fr;
            align-items: center;
            gap: 1rem;
            padding: 1.2rem 3.4rem 1.15rem 1.35rem;
          }
          .gc-edit-header__badge {
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.28rem;
            min-width: 4.4rem;
            padding: 0.55rem 0.6rem;
            border-radius: 12px;
            background: rgba(255,255,255,0.16);
            border: 1px solid rgba(255,255,255,0.28);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            font-size: 0.56rem;
            font-weight: 800;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            text-align: center;
            line-height: 1.2;
          }
          .gc-edit-header__badge i { font-size: 1.05rem; }
          .gc-edit-header__title {
            margin: 0;
            font-size: clamp(1.05rem, 2.4vw, 1.3rem);
            font-weight: 800;
            color: #fff;
            letter-spacing: -0.02em;
            line-height: 1.2;
          }
          .gc-edit-header__sub {
            margin: 0.25rem 0 0;
            font-size: 0.76rem;
            color: rgba(255,255,255,0.88);
          }
          .gc-edit-form { position: relative; overflow: hidden; }
          .gc-edit-deco {
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            overflow: hidden;
          }
          .gc-edit-deco::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 48%;
            transform: translate(-50%, -50%);
            width: min(980px, 135%);
            height: min(980px, 125%);
            background-color: #5a7456;
            opacity: 0.15;
            filter: blur(2px);
            mask-image: url('/assets/img/img_deco/Fondo_cent_1.png');
            -webkit-mask-image: url('/assets/img/img_deco/Fondo_cent_1.png');
            mask-repeat: no-repeat;
            -webkit-mask-repeat: no-repeat;
            mask-size: contain;
            -webkit-mask-size: contain;
            mask-position: center;
            -webkit-mask-position: center;
          }
          .gc-edit-body {
            position: relative;
            z-index: 1;
            padding: 1rem 1.4rem 0.5rem;
            max-height: min(58vh, 520px);
            overflow-y: auto;
          }
          .gc-edit-body::-webkit-scrollbar { width: 6px; }
          .gc-edit-body::-webkit-scrollbar-thumb { background: #c2d1b2; border-radius: 999px; }
          .gc-edit-card__head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 1rem;
            padding-bottom: 0.85rem;
            border-bottom: 1px solid rgba(56, 81, 47, 0.12);
          }
          .gc-edit-card__eyebrow {
            margin: 0;
            font-size: 0.68rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #8a9a86;
            font-weight: 700;
          }
          .gc-edit-card__title {
            margin: 0.2rem 0 0;
            font-size: 1rem;
            font-weight: 800;
            color: #1f2d1c;
            line-height: 1.25;
          }
          .gc-edit-card__meta {
            margin: 0.25rem 0 0;
            font-size: 0.75rem;
            color: #6b7c6e;
          }
          .gc-edit-card__hero {
            width: 2.75rem;
            height: 2.75rem;
            border-radius: 14px;
            background: linear-gradient(135deg, #38512F, #5a7456);
            color: #fff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
            flex-shrink: 0;
            box-shadow: 0 4px 12px rgba(56, 81, 47, 0.25);
          }
          .gc-edit-group-label {
            margin: 0.85rem 0 0.55rem;
            font-size: 0.66rem;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #8a9a86;
          }
          .gc-edit-group-label:first-of-type { margin-top: 0; }
          .gc-edit-layout { display: grid; gap: 0.85rem; }
          .gc-edit-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.85rem; }
          .gc-edit-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.85rem; }
          .gc-edit-field { display: grid; gap: 0.4rem; margin: 0; }
          .gc-edit-field--wide { grid-column: 1 / -1; }
          .gc-edit-field__label {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            font-size: 0.74rem;
            font-weight: 700;
            color: #4a5c48;
          }
          .gc-edit-field__label i {
            width: 1rem;
            text-align: center;
            color: #38512F;
            font-size: 0.72rem;
          }
          .gc-edit-field__control {
            display: flex;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.94);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1.5px solid rgba(216, 224, 212, 0.95);
            box-shadow: 0 2px 10px rgba(36, 54, 31, 0.05);
            transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
          }
          .gc-edit-field__control:focus-within {
            border-color: rgba(56, 81, 47, 0.75);
            background: #fff;
            box-shadow: 0 0 0 4px rgba(56, 81, 47, 0.1), 0 2px 10px rgba(36, 54, 31, 0.05);
          }
          .gc-edit-field__control input,
          .gc-edit-field__control select,
          .gc-edit-field__control textarea {
            width: 100%;
            border: none;
            background: transparent;
            padding: 0.62rem 0.85rem;
            font-size: 0.84rem;
            color: #1f2d1c;
            font-family: inherit;
            outline: none;
            border-radius: 12px;
          }
          .gc-edit-field__control select {
            appearance: none;
            cursor: pointer;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%238a9a86' d='M1.4.6L6 5.2 10.6.6 12 2 6 8 0 2z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 0.85rem center;
            padding-right: 2rem;
          }
          .gc-edit-field__control textarea {
            min-height: 5rem;
            resize: vertical;
            line-height: 1.45;
          }
          .gc-edit-field__control input::placeholder,
          .gc-edit-field__control textarea::placeholder { color: #94a3a0; }
          @media (max-width: 700px) {
            .gc-edit-grid-2,
            .gc-edit-grid-3 { grid-template-columns: 1fr 1fr; }
            .gc-edit-header__content { gap: 0.75rem; padding-right: 3.2rem; }
          }
          @media (max-width: 520px) {
            .gc-edit-grid-2,
            .gc-edit-grid-3 { grid-template-columns: 1fr; }
            .gc-edit-swal__actions { justify-content: stretch !important; }
            .gc-edit-btn { flex: 1 1 auto !important; justify-content: center !important; }
            .gc-edit-footnote { flex-basis: 100%; margin-bottom: 0.35rem !important; }
          }
        </style>

        <div class="gc-edit-modal">
          <div class="gc-edit-header">
            <div class="gc-edit-header__bg" aria-hidden="true"></div>
            <div class="gc-edit-header__content">
              <div class="gc-edit-header__badge">
                <i class="fas fa-edit"></i>
                <span>Curso</span>
              </div>
              <div>
                <h5 class="gc-edit-header__title">Editar información del curso</h5>
                <p class="gc-edit-header__sub">Actualiza asignación, agenda y observaciones</p>
              </div>
            </div>
          </div>

          <div class="gc-edit-form">
            <div class="gc-edit-deco" aria-hidden="true"></div>
            <div class="gc-edit-body">
              <header class="gc-edit-card__head">
                <div>
                  <p class="gc-edit-card__eyebrow">Curso programado</p>
                  <h3 class="gc-edit-card__title">${this.escapeHtml(c.nombre_curso || this.nombreCurso || 'Curso')}</h3>
                  <p class="gc-edit-card__meta"><i class="fas fa-building" style="margin-right:0.3rem;color:#38512F;"></i>${this.escapeHtml(c.nombre_empresa || this.empresaNombre || 'Sin empresa')}</p>
                </div>
                <div class="gc-edit-card__hero"><i class="fas fa-graduation-cap"></i></div>
              </header>

              <p class="gc-edit-group-label">Asignación</p>
              <div class="gc-edit-layout">
                <div class="gc-edit-grid-2">
                  <label class="gc-edit-field" for="edit_curso_id">
                    <span class="gc-edit-field__label"><i class="fas fa-book-open"></i> Curso</span>
                    <div class="gc-edit-field__control">
                      <select id="edit_curso_id">${opcionesCurso}</select>
                    </div>
                  </label>
                  <label class="gc-edit-field" for="edit_empresa_id">
                    <span class="gc-edit-field__label"><i class="fas fa-building"></i> Empresa</span>
                    <div class="gc-edit-field__control">
                      <select id="edit_empresa_id">${opcionesEmpresa}</select>
                    </div>
                  </label>
                  <label class="gc-edit-field gc-edit-field--wide" for="edit_instructor_id">
                    <span class="gc-edit-field__label"><i class="fas fa-user-tie"></i> Instructor</span>
                    <div class="gc-edit-field__control">
                      <select id="edit_instructor_id">${opcionesInstructor}</select>
                    </div>
                  </label>
                </div>
              </div>

              <p class="gc-edit-group-label">Agenda y detalles</p>
              <div class="gc-edit-grid-3">
                <label class="gc-edit-field" for="edit_fecha_inicio">
                  <span class="gc-edit-field__label"><i class="fas fa-calendar-day"></i> Fecha inicio</span>
                  <div class="gc-edit-field__control">
                    <input id="edit_fecha_inicio" type="date" value="${fechaInicio}">
                  </div>
                </label>
                <label class="gc-edit-field" for="edit_fecha_fin">
                  <span class="gc-edit-field__label"><i class="fas fa-calendar-check"></i> Fecha fin</span>
                  <div class="gc-edit-field__control">
                    <input id="edit_fecha_fin" type="date" value="${fechaFin}">
                  </div>
                </label>
                <label class="gc-edit-field" for="edit_hora_inicio">
                  <span class="gc-edit-field__label"><i class="fas fa-clock"></i> Hora inicio</span>
                  <div class="gc-edit-field__control">
                    <input id="edit_hora_inicio" type="time" value="${horaInicio}">
                  </div>
                </label>
                <label class="gc-edit-field" for="edit_hora_fin">
                  <span class="gc-edit-field__label"><i class="fas fa-hourglass-end"></i> Hora fin</span>
                  <div class="gc-edit-field__control">
                    <input id="edit_hora_fin" type="time" value="${horaFin}">
                  </div>
                </label>
                <label class="gc-edit-field" for="edit_modalidad">
                  <span class="gc-edit-field__label"><i class="fas fa-desktop"></i> Modalidad</span>
                  <div class="gc-edit-field__control">
                    <select id="edit_modalidad">
                      <option value="presencial" ${(c.modalidad || this.modalidad) === 'presencial' ? 'selected' : ''}>Presencial</option>
                      <option value="virtual" ${(c.modalidad || this.modalidad) === 'virtual' ? 'selected' : ''}>Virtual</option>
                      <option value="hibrido" ${(c.modalidad || this.modalidad) === 'hibrido' ? 'selected' : ''}>Híbrido</option>
                    </select>
                  </div>
                </label>
                <label class="gc-edit-field" for="edit_cupo">
                  <span class="gc-edit-field__label"><i class="fas fa-users"></i> Cupo</span>
                  <div class="gc-edit-field__control">
                    <input id="edit_cupo" type="number" min="1" value="${c.cupo ?? this.cupo ?? 25}">
                  </div>
                </label>
              </div>

              <p class="gc-edit-group-label">Observaciones</p>
              <label class="gc-edit-field" for="edit_notas">
                <span class="gc-edit-field__label"><i class="fas fa-align-left"></i> Detalles adicionales</span>
                <div class="gc-edit-field__control">
                  <textarea id="edit_notas" rows="3" placeholder="Detalles adicionales del curso">${this.escapeHtml(c.notas || '')}</textarea>
                </div>
              </label>
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-save"></i> Guardar',
      cancelButtonText: '<i class="fas fa-times"></i> Cancelar',
      confirmButtonColor: '#38512F',
      preConfirm: () => {
        const fechaInicioVal = (document.getElementById('edit_fecha_inicio') as HTMLInputElement)?.value || '';
        const horaInicioVal = (document.getElementById('edit_hora_inicio') as HTMLInputElement)?.value || '';
        const modalidadVal = (document.getElementById('edit_modalidad') as HTMLSelectElement)?.value || 'presencial';
        const cupoVal = Number((document.getElementById('edit_cupo') as HTMLInputElement)?.value || 0);
        const instructorVal = (document.getElementById('edit_instructor_id') as HTMLSelectElement)?.value || '';

        if (!instructorVal) {
          Swal.showValidationMessage('Debes asignar un instructor al curso');
          return false;
        }
        if (!fechaInicioVal) {
          Swal.showValidationMessage('La fecha de inicio es obligatoria');
          return false;
        }
        if (!horaInicioVal) {
          Swal.showValidationMessage('La hora de inicio es obligatoria');
          return false;
        }
        if (!Number.isFinite(cupoVal) || cupoVal <= 0) {
          Swal.showValidationMessage('El cupo debe ser mayor a 0');
          return false;
        }

        return {
          curso_id: Number((document.getElementById('edit_curso_id') as HTMLSelectElement)?.value || 0),
          empresa_id: Number((document.getElementById('edit_empresa_id') as HTMLSelectElement)?.value || 0),
          instructor_id: (document.getElementById('edit_instructor_id') as HTMLSelectElement)?.value
            ? Number((document.getElementById('edit_instructor_id') as HTMLSelectElement)?.value)
            : null,
          fecha_inicio: fechaInicioVal,
          fecha_fin: (document.getElementById('edit_fecha_fin') as HTMLInputElement)?.value || null,
          hora_inicio: horaInicioVal,
          hora_fin: (document.getElementById('edit_hora_fin') as HTMLInputElement)?.value || null,
          modalidad: modalidadVal,
          cupo: cupoVal,
          notas: ((document.getElementById('edit_notas') as HTMLTextAreaElement)?.value || '').trim() || null
        };
      }
    }).then((result) => {
      if (!result.isConfirmed || !result.value) {
        return;
      }

      Swal.fire({
        title: 'Guardando cambios...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
      });

      this.backendServices.actualizarCursoProgramado(c.programado_id, result.value)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (resp: any) => {
            if (!resp?.success) {
              Swal.fire({
                title: 'Error',
                text: resp?.message || 'No se pudo actualizar el curso.',
                icon: 'error',
                confirmButtonColor: '#38512F'
              });
              return;
            }

            Swal.fire({
              title: 'Actualizado',
              text: 'La información del curso fue actualizada.',
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 1500,
              showConfirmButton: false
            });

            this.cargarDatosCurso();
          },
          error: () => {
            Swal.fire({
              title: 'Error',
              text: 'No se pudieron guardar los cambios del curso.',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        });
    });
    }).catch(() => {
      Swal.fire({
        title: 'Error',
        text: 'No se pudieron cargar los catálogos para edición.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    });
  }

  private toDateInput(fecha: any): string {
    const d = parsearFechaSoloDia(fecha);
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toTimeInput(hora: any): string {
    if (!hora) return '';
    const raw = String(hora).trim();
    if (!raw) return '';
    const partes = raw.split(':');
    if (partes.length >= 2) {
      const hh = String(partes[0]).padStart(2, '0');
      const mm = String(partes[1]).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    return raw;
  }

  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  verDocumentos(paso: any): void {
    Swal.fire({
      title: paso.nombre,
      text: 'Los documentos de esta fase se implementarán próximamente',
      icon: 'info',
      confirmButtonColor: '#38512F'
    });
  }

  // =====================================================
  // PROGRESO REAL DESDE EL BACKEND
  // =====================================================

  /**
   * Parsea pasos_completados directamente del objeto curso que viene del listado.
   * Esta es la fuente primaria de datos, garantiza que al menos se muestre el progreso al cargar.
   */
  parsearPasosDesdeObjeto(curso: any): void {
    let pasos = curso.pasos_completados;
    if (!pasos) {
      return;
    }
    // Puede venir como string JSON o como array
    if (typeof pasos === 'string') {
      try {
        pasos = JSON.parse(pasos);
      } catch (e) {
        console.error('[ADMIN] Error parseando pasos_completados:', e);
        return;
      }
    }
    if (Array.isArray(pasos)) {
      this.pasosCompletados = this.normalizarPasosCompletados(pasos);
    }
  }

  cargarProgreso(): void {
    if (!this.cursoId) return;

    // Llamada directa con cache-busting para obtener siempre datos frescos del backend
    const url = `${environment.apiUrl}/cursos-programados/${this.cursoId}/progreso?_t=${Date.now()}`;
    this.http.get<any>(url).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success && response.pasosCompletados) {
          // Asignar directamente como lo hace el instructor (timeline-curso)
          this.pasosCompletados = Array.isArray(response.pasosCompletados)
            ? this.normalizarPasosCompletados(response.pasosCompletados)
            : [];
        }
      },
      error: (err) => {
        console.error('[ADMIN] Error cargando progreso:', err);
      }
    });
  }

    private normalizarPasosCompletados(pasosRaw: any[]): number[] {
      const pasos = Array.from(new Set(
        (pasosRaw || [])
          .map((p: any) => Number(p))
          .filter((p: number) => Number.isFinite(p) && p >= 1 && p <= 10)
      ));

      // Compatibilidad con cursos previos donde el paso 9 era "Finalizado".
      const estatusCompletado = String(this.estatus || this.curso?.estatus || '').toLowerCase() === 'completado';
      if (estatusCompletado && pasos.includes(9) && !pasos.includes(10)) {
        pasos.push(10);
      }

      const pasosValidos = new Set(this.pasosCurso.map((paso: any) => paso.numero));
      return pasos.filter((paso: number) => pasosValidos.has(paso));
    }

  private iniciarAutoRefreshProgreso(): void {
    this.detenerAutoRefreshProgreso();
    this.progresoRefreshTimer = setInterval(() => {
      this.cargarProgreso();
    }, 5000);
  }

  private detenerAutoRefreshProgreso(): void {
    if (this.progresoRefreshTimer) {
      clearInterval(this.progresoRefreshTimer);
      this.progresoRefreshTimer = null;
    }
  }

  // =====================================================
  // HELPERS DE PASOS
  // =====================================================

  isPasoCompletado(numeroPaso: number): boolean {
    return this.pasosCompletados.includes(numeroPaso);
  }

  isPasoActual(numeroPaso: number): boolean {
    // El paso actual es el primer paso no completado
    if (this.pasosCompletados.length === 0) {
      return numeroPaso === (this.pasosCurso[0]?.numero || 1);
    }

    for (const paso of this.pasosCurso) {
      if (!this.pasosCompletados.includes(paso.numero)) {
        return numeroPaso === paso.numero;
      }
    }

    return numeroPaso === (this.pasosCurso[this.pasosCurso.length - 1]?.numero || 1);
  }

  getPasoActual(): number {
    if (this.pasosCompletados.length === 0) {
      return this.pasosCurso[0]?.numero || 1;
    }

    for (const paso of this.pasosCurso) {
      if (!this.pasosCompletados.includes(paso.numero)) {
        return paso.numero;
      }
    }

    return this.pasosCurso[this.pasosCurso.length - 1]?.numero || 1;
  }

  getPorcentajeProgreso(): number {
    return (this.pasosCompletados.length / this.pasosCurso.length) * 100;
  }

  getProgresoSeccion(seccion: string): number {
    const pasosSeccion = this.pasosCurso.filter((paso: any) => paso.seccion === seccion);
    if (!pasosSeccion.length) {
      return 0;
    }

    const completados = pasosSeccion.filter((paso: any) => this.pasosCompletados.includes(paso.numero)).length;
    return (completados / pasosSeccion.length) * 100;
  }

  get isEmpresa(): boolean {
    return this.authService.esEmpresa();
  }

  get esAdmin(): boolean {
    return this.authService.esAdministradorOSuperior();
  }

  esPasoGestionablePorAdmin(numeroPaso: number): boolean {
    return this.pasosCurso.some((paso: any) => paso.numero === numeroPaso);
  }

  /** Navega al timeline-curso en el paso seleccionado con perfil admin (incluye desbloqueo de edición). */
  abrirTimelinePaso(numeroPaso: number): void {
    if (!this.cursoId) return;

    const paso = this.esPasoGestionablePorAdmin(numeroPaso) ? numeroPaso : 1;
    this.router.navigate(['/timeline-curso'], {
      queryParams: { id: this.cursoId, paso },
      state: { curso: this.curso }
    });
  }

  /** Navega al timeline-curso en el paso 8 (Constancias y DC-3) con perfil admin */
  abrirTimelinePaso8(): void {
    this.abrirTimelinePaso(8);
  }

  getEstatusLabel(estatus: string): string {
    switch (estatus) {
      case 'programado': return 'Programado';
      case 'en_curso': return 'En Curso';
      case 'completado': return 'Completado';
      case 'cancelado': return 'Cancelado';
      case 'pospuesto': return 'Pospuesto';
      default: return estatus;
    }
  }
}
