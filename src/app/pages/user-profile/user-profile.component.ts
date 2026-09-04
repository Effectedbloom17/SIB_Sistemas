import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.component.html',
  styleUrls: ['./user-profile.component.scss']
})
export class UserProfileComponent implements OnInit {
  cargando = true;
  guardando = false;
  usuario: any = null;
  empresa: any = null;
  fotoUrl: string | null = null;
  firmaUrl: string | null = null;

  // Previews para archivos seleccionados (antes de guardar)
  fotoPreviewUrl: string | null = null;
  firmaPreviewUrl: string | null = null;
  fotoFile: File | null = null;
  firmaFile: File | null = null;

  // Rol del usuario
  rolUsuario: string = '';

  // Edición inline
  editandoNombre = false;
  editNombre = '';
  editApellido = '';

  editandoEmail = false;
  editEmail = '';

  editandoTelefono = false;
  editTelefono = '';

  // Instructor feedback
  feedback: any = null;
  cargandoFeedback = false;
  comentariosLimite = 5;

  // Admin: rendimiento de instructores
  instructoresRendimiento: any[] = [];
  rendimientoGeneralAdmin: any = null;
  cargandoRendimiento = false;
  vistaAdminActiva: 'instructores' | 'general' = 'instructores';

  // Doctor: resumen
  resumenDoctor: any = null;
  cargandoDoctor = false;

  constructor(
    private authService: AuthService,
    private backendService: BackendServices
  ) {}

  private buildDrivePreviewUrl(driveId: string, version?: string | number): string {
    return this.backendService.resolverUrlDrivePreview(driveId) || '';
  }

  private buildFirmaPreviewUrl(driveId: string, version?: string | number): string {
    const token = version !== undefined ? String(version) : driveId;
    return `${environment.apiUrl}/firma-doctor/${driveId}?v=${encodeURIComponent(token)}`;
  }

  private sincronizarUsuarioSesion(): void {
    const usuarioSesion = this.authService.usuarioActualValue;
    const usuarioPerfil = this.usuario;
    if (!usuarioSesion || !usuarioPerfil) return;

    const idSesion = Number(usuarioSesion.usuario_id || usuarioSesion.id || 0);
    const idPerfil = Number(usuarioPerfil.usuario_id || usuarioPerfil.id || 0);
    if (!idSesion || !idPerfil || idSesion !== idPerfil) return;

    this.authService.setUsuario({
      ...usuarioSesion,
      ...usuarioPerfil,
      usuario_id: idPerfil,
      id: idPerfil,
      rol: usuarioPerfil.rol || usuarioSesion.rol,
      rol_nombre: usuarioPerfil.rol || usuarioSesion.rol_nombre,
      apellido_paterno: usuarioPerfil.apellido_paterno || usuarioPerfil.apellido || usuarioSesion.apellido_paterno || usuarioSesion.apellido,
      apellido: usuarioPerfil.apellido || usuarioSesion.apellido,
      foto_drive_id: usuarioPerfil.foto_drive_id || null,
      firma_drive_id: usuarioPerfil.firma_drive_id || null,
      empresa_id: usuarioPerfil.empresa_id || usuarioSesion.empresa_id,
      instructor_id: usuarioPerfil.instructor_id || usuarioSesion.instructor_id
    });
  }

  ngOnInit() {
    this.cargarPerfil();
  }

  get comentariosVisibles(): any[] {
    if (!this.feedback?.comentarios) return [];
    return this.feedback.comentarios.slice(0, this.comentariosLimite);
  }

  verMasComentarios(): void {
    this.comentariosLimite += 5;
  }

  cargarPerfil(): void {
    const userId = this.authService.getUsuarioId();
    if (!userId) return;

    this.backendService.obtenerUsuario(userId).subscribe({
      next: (res: any) => {
        if (res.success && res.usuario) {
          this.usuario = res.usuario;
          this.rolUsuario = (this.usuario.rol || '').toLowerCase();
          this.sincronizarUsuarioSesion();

          this.fotoUrl = this.backendService.resolverUrlDrivePreview(this.usuario.foto_drive_id || this.usuario.foto_url) || null;

          // Firma: instructores/doctores en tabla instructor, admin en tabla usuario
          if (this.usuario.firma_drive_id) {
            this.firmaUrl = this.buildFirmaPreviewUrl(this.usuario.firma_drive_id);
          } else {
            this.firmaUrl = null;
          }

          if (this.usuario.empresa_id) {
            this.cargarEmpresa(this.usuario.empresa_id);
          } else {
            this.cargando = false;
          }

          this.cargarDatosRol();
        } else {
          this.cargando = false;
        }
      },
      error: () => {
        this.cargando = false;
      }
    });
  }

  private cargarEmpresa(empresaId: number): void {
    this.backendService.obtenerEmpresa(empresaId).subscribe({
      next: (res: any) => {
        if (res.success && res.empresa) {
          this.empresa = res.empresa;
        }
        this.cargando = false;
      },
      error: () => {
        this.cargando = false;
      }
    });
  }

  private cargarDatosRol(): void {
    if (this.rolUsuario === 'instructor') {
      this.cargarFeedbackInstructor();
    } else if (this.rolUsuario === 'administrador' || this.rolUsuario === 'root') {
      this.cargarRendimientoInstructores();
    } else if (this.rolUsuario === 'doctor') {
      this.cargarResumenDoctor();
    }
  }

  private cargarFeedbackInstructor(): void {
    const instructorId = this.authService.getInstructorId();
    if (!instructorId) return;

    this.cargandoFeedback = true;
    this.backendService.obtenerFeedbackInstructor(instructorId).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.feedback = res;
        }
        this.cargandoFeedback = false;
      },
      error: () => {
        this.cargandoFeedback = false;
      }
    });
  }

  private cargarRendimientoInstructores(): void {
    this.cargandoRendimiento = true;
    this.backendService.obtenerRendimientoInstructores().subscribe({
      next: (res: any) => {
        if (res.success) {
          this.instructoresRendimiento = res.instructores || [];
          this.rendimientoGeneralAdmin = res.rendimiento_general || null;

          const hayInstructores = this.instructoresRendimiento.length > 0;
          const hayGeneral = (this.rendimientoGeneralAdmin?.total_respuestas || 0) > 0;
          this.vistaAdminActiva = hayInstructores ? 'instructores' : (hayGeneral ? 'general' : 'instructores');
        }
        this.cargandoRendimiento = false;
      },
      error: () => {
        this.instructoresRendimiento = [];
        this.rendimientoGeneralAdmin = null;
        this.vistaAdminActiva = 'instructores';
        this.cargandoRendimiento = false;
      }
    });
  }

  cambiarVistaAdmin(vista: 'instructores' | 'general'): void {
    this.vistaAdminActiva = vista;
  }

  private cargarResumenDoctor(): void {
    this.cargandoDoctor = true;
    this.backendService.obtenerResumenDoctor().subscribe({
      next: (res: any) => {
        if (res.success) {
          this.resumenDoctor = res;
        }
        this.cargandoDoctor = false;
      },
      error: () => {
        this.cargandoDoctor = false;
      }
    });
  }

  // ── Foto ──────────────────────────────────
  onFotoSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      Swal.fire({ icon: 'error', title: 'Formato no válido', text: 'Solo se permiten JPG, PNG o WebP', confirmButtonColor: '#38512F' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      Swal.fire({ icon: 'error', title: 'Archivo muy grande', text: 'La imagen no debe superar 5 MB', confirmButtonColor: '#38512F' });
      return;
    }

    this.fotoFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.fotoPreviewUrl = reader.result as string; };
    reader.readAsDataURL(file);

    this.guardarArchivo('foto');
    input.value = '';
  }

  // ── Firma ─────────────────────────────────
  onFirmaSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      Swal.fire({ icon: 'error', title: 'Formato no válido', text: 'Solo se permiten JPG, PNG o WebP', confirmButtonColor: '#38512F' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      Swal.fire({ icon: 'error', title: 'Archivo muy grande', text: 'La imagen no debe superar 5 MB', confirmButtonColor: '#38512F' });
      return;
    }

    this.firmaFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.firmaPreviewUrl = reader.result as string; };
    reader.readAsDataURL(file);

    this.guardarArchivo('firma');
    input.value = '';
  }

  private guardarArchivo(tipo: 'foto' | 'firma'): void {
    if (!this.usuario?.id) return;

    const formData = new FormData();
    formData.append('nombre', this.usuario.nombre || '');
    formData.append('apellidos', this.usuario.apellido || '');

    if (tipo === 'foto' && this.fotoFile) {
      formData.append('foto', this.fotoFile);
    } else if (tipo === 'firma' && this.firmaFile) {
      formData.append('firma', this.firmaFile);
    }

    this.guardando = true;
    this.backendService.actualizarUsuario(this.usuario.id, formData).subscribe({
      next: (res: any) => {
        this.guardando = false;
        if (res.success) {
          // Recargar perfil para obtener nuevos drive IDs
          this.recargarPerfil();
          this.mostrarAlertaActualizacion(
            tipo === 'foto' ? 'Foto actualizada' : 'Firma actualizada'
          );
        } else {
          Swal.fire({ icon: 'error', title: 'Error', text: res.message || 'No se pudo guardar', confirmButtonColor: '#38512F' });
        }
      },
      error: () => {
        this.guardando = false;
        Swal.fire({ icon: 'error', title: 'Error', text: 'Error de conexión al guardar', confirmButtonColor: '#38512F' });
      }
    });
  }

  // ── Edición de nombre ────────────────────
  iniciarEdicionNombre(): void {
    this.editNombre = this.usuario.nombre || '';
    this.editApellido = this.usuario.apellido || '';
    this.editandoNombre = true;
  }

  cancelarEdicionNombre(): void {
    this.editandoNombre = false;
  }

  guardarNombre(): void {
    const nombre = this.editNombre.trim();
    const apellido = this.editApellido.trim();
    if (!nombre) {
      Swal.fire({ icon: 'warning', title: 'Campo requerido', text: 'El nombre no puede estar vacío', confirmButtonColor: '#38512F' });
      return;
    }

    this.guardarCampo({ nombre, apellidos: apellido }, () => {
      this.usuario.nombre = nombre;
      this.usuario.apellido = apellido;
      this.editandoNombre = false;
    });
  }

  // ── Edición de email ─────────────────────
  iniciarEdicionEmail(): void {
    this.editEmail = this.usuario.email || '';
    this.editandoEmail = true;
  }

  guardarEmail(): void {
    const email = this.editEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Swal.fire({ icon: 'warning', title: 'Correo inválido', text: 'Ingresa un correo electrónico válido', confirmButtonColor: '#38512F' });
      return;
    }

    this.guardarCampo({ email }, () => {
      this.usuario.email = email;
      this.editandoEmail = false;
    });
  }

  // ── Edición de teléfono ──────────────────
  iniciarEdicionTelefono(): void {
    this.editTelefono = this.usuario.telefono || '';
    this.editandoTelefono = true;
  }

  guardarTelefono(): void {
    const telefono = this.editTelefono.trim();
    this.guardarCampo({ telefono }, () => {
      this.usuario.telefono = telefono;
      this.editandoTelefono = false;
    });
  }

  // ── Helper: guardar campo de texto ───────
  private guardarCampo(datos: Record<string, string>, onSuccess: () => void): void {
    if (!this.usuario?.id) return;

    const formData = new FormData();
    // Always include nombre/apellidos so multer doesn't set them empty
    formData.append('nombre', datos['nombre'] ?? this.usuario.nombre ?? '');
    formData.append('apellidos', datos['apellidos'] ?? this.usuario.apellido ?? '');

    if (datos['email'] !== undefined) formData.append('email', datos['email']);
    if (datos['telefono'] !== undefined) formData.append('telefono', datos['telefono']);

    this.guardando = true;
    this.backendService.actualizarUsuario(this.usuario.id, formData).subscribe({
      next: (res: any) => {
        this.guardando = false;
        if (res.success) {
          onSuccess();
          this.mostrarAlertaActualizacion('Datos actualizados');
        } else {
          Swal.fire({ icon: 'error', title: 'Error', text: res.message || 'No se pudo guardar', confirmButtonColor: '#38512F' });
        }
      },
      error: () => {
        this.guardando = false;
        Swal.fire({ icon: 'error', title: 'Error', text: 'Error de conexión al guardar', confirmButtonColor: '#38512F' });
      }
    });
  }

  private mostrarAlertaActualizacion(titulo: string): void {
    Swal.fire({
      icon: 'success',
      title: titulo,
      text: 'Los cambios se guardaron correctamente y se sincronizaron en la sesión actual.',
      confirmButtonColor: '#38512F',
      confirmButtonText: 'Entendido'
    });
  }

  private recargarPerfil(): void {
    const userId = this.authService.getUsuarioId();
    if (!userId) return;

    this.backendService.obtenerUsuario(userId).subscribe({
      next: (res: any) => {
        if (res.success && res.usuario) {
          this.usuario = res.usuario;
          this.sincronizarUsuarioSesion();
          this.fotoPreviewUrl = null;
          this.firmaPreviewUrl = null;
          this.fotoFile = null;
          this.firmaFile = null;

          this.fotoUrl = this.usuario.foto_drive_id
            ? this.buildDrivePreviewUrl(this.usuario.foto_drive_id, Date.now())
            : null;
          this.firmaUrl = this.usuario.firma_drive_id
            ? this.buildFirmaPreviewUrl(this.usuario.firma_drive_id, Date.now())
            : null;
        }
      }
    });
  }

  getIniciales(): string {
    if (!this.usuario) return '?';
    const n = this.usuario.nombre?.charAt(0) || '';
    const a = this.usuario.apellido?.charAt(0) || '';
    return (n + a).toUpperCase() || this.usuario.username?.charAt(0)?.toUpperCase() || '?';
  }

  getRolBadgeClass(): string {
    const rol = this.usuario?.rol?.toLowerCase();
    switch (rol) {
      case 'administrador': return 'badge-admin';
      case 'instructor': return 'badge-instructor';
      case 'empresa': return 'badge-empresa';
      case 'doctor': return 'badge-doctor';
      case 'consulta': return 'badge-consulta';
      case 'sgc': return 'badge-sgc';
      default: return 'badge-default';
    }
  }

  getScoreClass(puntaje: number): string {
    if (puntaje >= 80) return 'score-excelente';
    if (puntaje >= 60) return 'score-bueno';
    if (puntaje >= 40) return 'score-regular';
    return 'score-bajo';
  }

  getScoreLabel(puntaje: number): string {
    if (puntaje >= 80) return 'Excelente';
    if (puntaje >= 60) return 'Bueno';
    if (puntaje >= 40) return 'Regular';
    return 'Mejorar';
  }

  getInstructorFotoUrl(inst: any): string | null {
    if (inst.foto_drive_id) {
      return this.buildDrivePreviewUrl(inst.foto_drive_id);
    }
    return null;
  }

  getInstructorIniciales(inst: any): string {
    return (inst.nombre || '?').charAt(0).toUpperCase();
  }

  formatFecha(fecha: string | null): string {
    if (!fecha) return 'Sin registro';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatFechaCorta(fecha: string | null): string {
    if (!fecha) return 'Sin registro';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }

  formatMesAnio(fecha: string | null): string {
    if (!fecha) return 'Sin registro';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
  }
}
