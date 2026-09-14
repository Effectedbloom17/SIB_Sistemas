import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';

export interface ResidenteForm {
    id?: number | null;
    anio: number | null;
    nombre: string;
    edad: number | null;
    estancia: string;
    escuela_procedencia: string;
    carrera: string;
    fecha_ingreso: string;
    fecha_terminacion: string;
    nombre_proyecto: string;
    supervision_a_cargo: string;
    telefono: string;
    correo_personal: string;
    correo_institucional: string;
    matricula: string;
    asesor_academico: string;
    correo_asesor: string;
    tutor_nombre: string;
    tutor_telefono: string;
    direccion: string;
    nss: string;
    foto_url?: string | null;
    /** 1 = vigencia vigente; 0 = proceso de estadía finalizado (sigue visible). */
    vigente?: number | boolean | null;
    editor_url?: string | null;
    embed_url?: string | null;
    preview_url?: string | null;
    drive_file_id?: string | null;
    drive_sheet_title?: string | null;
    drive_sheet_gid?: string | null;
}

interface BorradorNuevoResidente {
    form: ResidenteForm;
    formPaso: 1 | 2 | 3;
    abierto: boolean;
    savedAt: number;
}

@Component({
    selector: 'app-residentes',
    templateUrl: './residentes.component.html',
    styleUrls: ['./residentes.component.scss']
})
export class ResidentesComponent implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();
    private readonly borradorKey = 'rrhh_residente_nuevo_borrador';
    private borradorTimer: ReturnType<typeof setInterval> | null = null;

    cargando = false;
    guardando = false;
    errorCarga = '';
    mensajeOk = '';
    busqueda = '';
    filtroAnio: number | '' = '';
    spreadsheetUrl = '';
    spreadsheetId = '1DIxeYf2pwQjaXJDvkaOGe_zHaVEGPE6f90xDxq0B75o';

    residentes: ResidenteForm[] = [];
    mostrarFormulario = false;
    mostrarDetalle = false;
    editandoDetalle = false;
    residenteDetalle: ResidenteForm | null = null;
    editandoId: number | null = null;
    formPaso: 1 | 2 | 3 = 1;
    form: ResidenteForm = this.formVacio();
    fotoPreview: string | null = null;
    borradorRestaurado = false;

    readonly supervisoresSugeridos = [
        'Ing. Leonel Pérez',
        'Ing. Eduardo Ortuño mercado'
    ];

    constructor(
        private backend: BackendServices,
        private documentPreview: DocumentPreviewService
    ) {}

    ngOnInit(): void {
        this.restaurarBorradorAlIniciar();
        this.cargar();
    }

    ngOnDestroy(): void {
        if (this.mostrarFormulario && !this.editandoId && !this.editandoDetalle) {
            this.persistirBorradorNuevo(true);
        }
        this.detenerAutoGuardadoBorrador();
        this.destroy$.next();
        this.destroy$.complete();
    }

    @HostListener('window:beforeunload')
    onBeforeUnload(): void {
        if (this.mostrarFormulario && !this.editandoId && !this.editandoDetalle) {
            this.persistirBorradorNuevo(true);
        }
    }

    formVacio(): ResidenteForm {
        return {
            id: null,
            anio: new Date().getFullYear(),
            nombre: '',
            edad: null,
            estancia: '',
            escuela_procedencia: '',
            carrera: '',
            fecha_ingreso: '',
            fecha_terminacion: '',
            nombre_proyecto: '',
            supervision_a_cargo: '',
            telefono: '',
            correo_personal: '',
            correo_institucional: '',
            matricula: '',
            asesor_academico: '',
            correo_asesor: '',
            tutor_nombre: '',
            tutor_telefono: '',
            direccion: '',
            nss: '',
            foto_url: null
        };
    }

    private clonarResidente(r: ResidenteForm): ResidenteForm {
        return {
            ...this.formVacio(),
            ...r,
            anio: r.anio != null ? Number(r.anio) : new Date().getFullYear(),
            edad: r.edad != null && r.edad !== ('' as any) ? Number(r.edad) : null,
            foto_url: r.foto_url || null
        };
    }

    private leerBorradorNuevo(): BorradorNuevoResidente | null {
        try {
            const raw = localStorage.getItem(this.borradorKey);
            if (!raw) return null;
            const data = JSON.parse(raw) as BorradorNuevoResidente;
            if (!data?.form || typeof data.form !== 'object') return null;
            const paso = Number(data.formPaso);
            return {
                form: this.clonarResidente(data.form),
                formPaso: (paso === 2 || paso === 3 ? paso : 1) as 1 | 2 | 3,
                abierto: !!data.abierto,
                savedAt: Number(data.savedAt) || Date.now()
            };
        } catch {
            return null;
        }
    }

    private borradorTieneContenido(form: ResidenteForm): boolean {
        const vacio = this.formVacio();
        const camposTexto: (keyof ResidenteForm)[] = [
            'nombre', 'estancia', 'escuela_procedencia', 'carrera', 'fecha_ingreso',
            'fecha_terminacion', 'nombre_proyecto', 'supervision_a_cargo', 'telefono',
            'correo_personal', 'correo_institucional', 'matricula', 'asesor_academico',
            'correo_asesor', 'tutor_nombre', 'tutor_telefono', 'direccion', 'nss'
        ];
        if (camposTexto.some((c) => String(form[c] || '').trim())) return true;
        if (form.edad != null && form.edad !== ('' as any)) return true;
        if (form.foto_url) return true;
        if (form.anio != null && Number(form.anio) !== vacio.anio) return true;
        return false;
    }

    /** Guarda borrador del alta (no edición). Si no hay datos, limpia el storage. */
    persistirBorradorNuevo(abierto = this.mostrarFormulario): void {
        if (this.editandoId || this.editandoDetalle) return;
        try {
            if (!this.borradorTieneContenido(this.form)) {
                // Solo limpia si el wizard de alta está abierto y el usuario vació el formulario.
                // No borrar al abrir un detalle (form en memoria vacío).
                if (this.mostrarFormulario && !this.editandoId) {
                    localStorage.removeItem(this.borradorKey);
                    this.borradorRestaurado = false;
                }
                return;
            }
            const payload: BorradorNuevoResidente = {
                form: this.clonarResidente(this.form),
                formPaso: this.formPaso,
                abierto: !!abierto,
                savedAt: Date.now()
            };
            try {
                localStorage.setItem(this.borradorKey, JSON.stringify(payload));
            } catch {
                // Cuota (p. ej. foto grande): reintentar sin imagen
                payload.form.foto_url = null;
                localStorage.setItem(this.borradorKey, JSON.stringify(payload));
            }
        } catch {
            /* noop */
        }
    }

    private limpiarBorradorNuevo(): void {
        try {
            localStorage.removeItem(this.borradorKey);
        } catch {
            /* noop */
        }
        this.borradorRestaurado = false;
    }

    private aplicarBorrador(data: BorradorNuevoResidente, reabrir: boolean): void {
        this.editandoId = null;
        this.editandoDetalle = false;
        this.form = this.clonarResidente(data.form);
        this.fotoPreview = this.form.foto_url || null;
        this.formPaso = data.formPaso;
        this.mostrarDetalle = false;
        this.borradorRestaurado = true;
        if (reabrir) {
            this.mostrarFormulario = true;
            this.iniciarAutoGuardadoBorrador();
        }
    }

    private restaurarBorradorAlIniciar(): void {
        const data = this.leerBorradorNuevo();
        if (!data || !this.borradorTieneContenido(data.form)) return;
        // Si el wizard estaba abierto al refrescar, lo reabrimos; si no, queda listo para "Nuevo".
        this.aplicarBorrador(data, !!data.abierto);
        if (!data.abierto) {
            this.form = this.clonarResidente(data.form);
            this.fotoPreview = this.form.foto_url || null;
            this.formPaso = data.formPaso;
            this.borradorRestaurado = true;
        }
    }

    private iniciarAutoGuardadoBorrador(): void {
        this.detenerAutoGuardadoBorrador();
        this.borradorTimer = setInterval(() => {
            if (this.mostrarFormulario && !this.editandoId && !this.editandoDetalle) {
                this.persistirBorradorNuevo(true);
            }
        }, 1500);
    }

    private detenerAutoGuardadoBorrador(): void {
        if (this.borradorTimer) {
            clearInterval(this.borradorTimer);
            this.borradorTimer = null;
        }
    }

    cargar(): void {
        this.cargando = true;
        this.errorCarga = '';
        this.backend
            .listarRrhhResidentes({
                anio: this.filtroAnio === '' ? undefined : this.filtroAnio,
                q: this.busqueda.trim() || undefined
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (res: any) => {
                    this.residentes = Array.isArray(res?.residentes) ? res.residentes : [];
                    this.spreadsheetUrl = res?.editorUrl || '';
                    if (res?.spreadsheetId) {
                        this.spreadsheetId = String(res.spreadsheetId);
                    }
                    this.cargando = false;
                    if (this.residenteDetalle?.id) {
                        const actualizado = this.residentes.find((x) => x.id === this.residenteDetalle?.id);
                        if (actualizado) {
                            this.residenteDetalle = actualizado;
                        }
                    }
                },
                error: (err) => {
                    this.cargando = false;
                    this.errorCarga = err?.error?.message || 'No se pudo cargar el listado de residentes.';
                }
            });
    }

    abrirNuevo(): void {
        this.editandoId = null;
        this.editandoDetalle = false;
        this.mensajeOk = '';
        this.errorCarga = '';
        this.mostrarDetalle = false;

        const data = this.leerBorradorNuevo();
        if (data && this.borradorTieneContenido(data.form)) {
            this.aplicarBorrador(data, true);
        } else {
            this.form = this.formVacio();
            this.fotoPreview = null;
            this.formPaso = 1;
            this.borradorRestaurado = false;
            this.mostrarFormulario = true;
            this.iniciarAutoGuardadoBorrador();
        }
    }

    /** @deprecated Se mantiene por compatibilidad; la edición ocurre en el detalle. */
    editar(r: ResidenteForm, event?: Event): void {
        if (event) event.stopPropagation();
        this.abrirDetalle(r);
        this.activarEdicionDetalle();
    }

    cancelarFormulario(): void {
        if (this.guardando) return;
        this.persistirBorradorNuevo(false);
        this.detenerAutoGuardadoBorrador();
        this.mostrarFormulario = false;
        this.editandoId = null;
        this.errorCarga = '';
        // Conserva form/paso/foto en memoria y en localStorage para reabrir el borrador
    }

    descartarBorradorNuevo(): void {
        if (this.guardando) return;
        this.limpiarBorradorNuevo();
        this.detenerAutoGuardadoBorrador();
        this.mostrarFormulario = false;
        this.editandoId = null;
        this.formPaso = 1;
        this.form = this.formVacio();
        this.fotoPreview = null;
        this.errorCarga = '';
        this.mensajeOk = 'Borrador descartado.';
    }

    get progresoStepper(): string {
        if (this.formPaso <= 1) return '0%';
        if (this.formPaso === 2) return '50%';
        return '100%';
    }

    abrirDetalle(r: ResidenteForm): void {
        this.persistirBorradorNuevo(false);
        this.detenerAutoGuardadoBorrador();
        this.mostrarFormulario = false;
        this.residenteDetalle = r;
        this.editandoDetalle = false;
        this.editandoId = null;
        this.form = this.formVacio();
        this.fotoPreview = null;
        this.errorCarga = '';
        this.mostrarDetalle = true;
    }

    cerrarDetalle(): void {
        if (this.guardando) return;
        this.mostrarDetalle = false;
        this.editandoDetalle = false;
        this.residenteDetalle = null;
        this.editandoId = null;
        this.form = this.formVacio();
        this.fotoPreview = null;
        this.errorCarga = '';
    }

    activarEdicionDetalle(): void {
        if (!this.residenteDetalle) return;
        this.editandoId = this.residenteDetalle.id ? Number(this.residenteDetalle.id) : null;
        this.form = this.clonarResidente(this.residenteDetalle);
        this.fotoPreview = this.residenteDetalle.foto_url || null;
        this.editandoDetalle = true;
        this.errorCarga = '';
        this.mensajeOk = '';
    }

    cancelarEdicionDetalle(): void {
        if (this.guardando) return;
        this.editandoDetalle = false;
        this.editandoId = null;
        this.form = this.formVacio();
        this.fotoPreview = null;
        this.errorCarga = '';
    }

    guardarDesdeDetalle(): void {
        if (!String(this.form.nombre || '').trim()) {
            this.errorCarga = 'El nombre del residente es obligatorio.';
            return;
        }
        if (!this.editandoId) {
            this.errorCarga = 'No se pudo identificar el residente a editar.';
            return;
        }
        this.guardando = true;
        this.errorCarga = '';
        const payload = { ...this.form, foto_url: this.form.foto_url || null };
        this.backend
            .actualizarRrhhResidente(this.editandoId, payload)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (res: any) => {
                    this.guardando = false;
                    this.mensajeOk = res?.message || 'Residente actualizado.';
                    const actualizado = res?.residente || { ...this.form, id: this.editandoId };
                    this.residenteDetalle = actualizado;
                    this.editandoDetalle = false;
                    this.editandoId = null;
                    this.form = this.formVacio();
                    this.fotoPreview = null;
                    this.cargar();
                },
                error: (err) => {
                    this.guardando = false;
                    this.errorCarga = err?.error?.message || 'No se pudo guardar el residente.';
                }
            });
    }

    irPaso(paso: 1 | 2 | 3): void {
        if (paso > 1 && !String(this.form.nombre || '').trim()) {
            this.errorCarga = 'El nombre del residente es obligatorio para continuar.';
            this.formPaso = 1;
            return;
        }
        this.errorCarga = '';
        this.formPaso = paso;
        this.persistirBorradorNuevo(true);
    }

    siguientePaso(): void {
        if (this.formPaso === 1) this.irPaso(2);
        else if (this.formPaso === 2) this.irPaso(3);
    }

    anteriorPaso(): void {
        if (this.formPaso === 3) this.formPaso = 2;
        else if (this.formPaso === 2) this.formPaso = 1;
        this.persistirBorradorNuevo(true);
    }

    onFotoSeleccionada(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input?.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            this.errorCarga = 'Selecciona una imagen (JPG, PNG o WEBP).';
            return;
        }
        if (file.size > 5_000_000) {
            this.errorCarga = 'La foto no debe superar 5 MB.';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            this.fotoPreview = result;
            this.form.foto_url = result;
            this.errorCarga = '';
            this.persistirBorradorNuevo(true);
        };
        reader.onerror = () => {
            this.errorCarga = 'No se pudo leer la imagen.';
        };
        reader.readAsDataURL(file);
    }

    quitarFoto(): void {
        this.fotoPreview = null;
        this.form.foto_url = null;
        this.persistirBorradorNuevo(true);
    }

    guardar(): void {
        if (!String(this.form.nombre || '').trim()) {
            this.errorCarga = 'El nombre del residente es obligatorio.';
            this.formPaso = 1;
            return;
        }
        this.guardando = true;
        this.errorCarga = '';
        this.mensajeOk = '';
        const payload = { ...this.form, foto_url: this.form.foto_url || null };
        const req$ = this.editandoId
            ? this.backend.actualizarRrhhResidente(this.editandoId, payload)
            : this.backend.crearRrhhResidente(payload);

        req$.pipe(takeUntil(this.destroy$)).subscribe({
            next: (res: any) => {
                this.guardando = false;
                this.mensajeOk = res?.message || 'Residente guardado.';
                this.mostrarFormulario = false;
                this.editandoId = null;
                this.formPaso = 1;
                this.form = this.formVacio();
                this.fotoPreview = null;
                this.detenerAutoGuardadoBorrador();
                this.limpiarBorradorNuevo();
                this.cargar();
            },
            error: (err) => {
                this.guardando = false;
                this.errorCarga = err?.error?.message || 'No se pudo guardar el residente.';
            }
        });
    }

    eliminar(r: ResidenteForm, event?: Event): void {
        if (event) event.stopPropagation();
        if (!r?.id) return;
        if (!confirm(`¿Desactivar el registro de ${r.nombre}? No se borrará de la base de datos.`)) return;
        this.backend
            .eliminarRrhhResidente(Number(r.id))
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: () => {
                    this.mensajeOk = 'Residente desactivado.';
                    if (this.residenteDetalle?.id === r.id) this.cerrarDetalle();
                    this.cargar();
                },
                error: (err) => {
                    this.errorCarga = err?.error?.message || 'No se pudo desactivar el residente.';
                }
            });
    }

    sincronizar(r: ResidenteForm, event?: Event): void {
        if (event) event.stopPropagation();
        if (!r?.id) return;
        this.backend
            .sincronizarRrhhResidenteDrive(Number(r.id))
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (res: any) => {
                    this.mensajeOk = res?.message || 'Sincronizado con Google Sheets.';
                    if (res?.residente) {
                        this.residenteDetalle = res.residente;
                    }
                    this.cargar();
                },
                error: (err) => {
                    this.errorCarga = err?.error?.message || 'No se pudo sincronizar con Drive.';
                }
            });
    }

    abrirHojaGeneral(): void {
        const embed = `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit?usp=sharing&embedded=true&single=true`;
        this.abrirVisorExcel({
            nombre: 'Registro de Residentes',
            editorUrl: this.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit?usp=sharing`,
            previewUrl: embed,
            driveFileId: this.spreadsheetId
        });
    }

    abrirHoja(r: ResidenteForm, event?: Event): void {
        if (event) event.stopPropagation();
        const fileId = r?.drive_file_id || this.spreadsheetId;
        const gid = r?.drive_sheet_gid || '';
        const embed = r?.embed_url
            || (gid
                ? `https://docs.google.com/spreadsheets/d/${fileId}/edit?usp=sharing&embedded=true&single=true&gid=${gid}#gid=${gid}`
                : `https://docs.google.com/spreadsheets/d/${fileId}/edit?usp=sharing&embedded=true&single=true`);
        const editor = r?.editor_url || this.spreadsheetUrl
            || `https://docs.google.com/spreadsheets/d/${fileId}/edit?usp=sharing`;
        this.abrirVisorExcel({
            nombre: r?.drive_sheet_title || r?.nombre || 'Hoja del residente',
            editorUrl: editor,
            previewUrl: embed,
            driveFileId: fileId
        });
    }

    private abrirVisorExcel(opts: {
        nombre: string;
        editorUrl?: string;
        previewUrl: string;
        driveFileId: string;
    }): void {
        this.documentPreview.abrir({
            nombre: opts.nombre,
            archivo_nombre: `${opts.nombre}.xlsx`,
            archivo_url: opts.driveFileId,
            previewUrl: opts.previewUrl,
            editorUrl: opts.editorUrl,
            tema: 'rrhh',
            etiqueta: 'Hoja Excel · Residentes'
        });
    }

    valorOGuion(v: unknown): string {
        const s = String(v == null ? '' : v).trim();
        return s || '—';
    }

    /** Vigencia vigente según bandera del backend (proceso de estadía aún activo). */
    esVigente(r: ResidenteForm | null | undefined): boolean {
        if (!r) return true;
        return !(r.vigente === 0 || r.vigente === false);
    }

    get residentesVigentes(): ResidenteForm[] {
        return this.residentes.filter((r) => this.esVigente(r));
    }

    get residentesTerminados(): ResidenteForm[] {
        return this.residentes.filter((r) => !this.esVigente(r));
    }
}
