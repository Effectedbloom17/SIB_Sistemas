import { Component, OnDestroy, OnInit } from '@angular/core';
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
    editor_url?: string | null;
    embed_url?: string | null;
    preview_url?: string | null;
    drive_file_id?: string | null;
    drive_sheet_title?: string | null;
    drive_sheet_gid?: string | null;
}

@Component({
    selector: 'app-residentes',
    templateUrl: './residentes.component.html',
    styleUrls: ['./residentes.component.scss']
})
export class ResidentesComponent implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();

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

    readonly supervisoresSugeridos = [
        'Ing. Leonel Pérez',
        'Ing. Eduardo Ortuño mercado'
    ];

    constructor(
        private backend: BackendServices,
        private documentPreview: DocumentPreviewService
    ) {}

    ngOnInit(): void {
        this.cargar();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
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
        this.form = this.formVacio();
        this.fotoPreview = null;
        this.formPaso = 1;
        this.mensajeOk = '';
        this.errorCarga = '';
        this.mostrarDetalle = false;
        this.mostrarFormulario = true;
    }

    /** @deprecated Se mantiene por compatibilidad; la edición ocurre en el detalle. */
    editar(r: ResidenteForm, event?: Event): void {
        if (event) event.stopPropagation();
        this.abrirDetalle(r);
        this.activarEdicionDetalle();
    }

    cancelarFormulario(): void {
        if (this.guardando) return;
        this.mostrarFormulario = false;
        this.editandoId = null;
        this.formPaso = 1;
        this.form = this.formVacio();
        this.fotoPreview = null;
        this.errorCarga = '';
    }

    get progresoStepper(): string {
        if (this.formPaso <= 1) return '0%';
        if (this.formPaso === 2) return '50%';
        return '100%';
    }

    abrirDetalle(r: ResidenteForm): void {
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
    }

    siguientePaso(): void {
        if (this.formPaso === 1) this.irPaso(2);
        else if (this.formPaso === 2) this.irPaso(3);
    }

    anteriorPaso(): void {
        if (this.formPaso === 3) this.formPaso = 2;
        else if (this.formPaso === 2) this.formPaso = 1;
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
        };
        reader.onerror = () => {
            this.errorCarga = 'No se pudo leer la imagen.';
        };
        reader.readAsDataURL(file);
    }

    quitarFoto(): void {
        this.fotoPreview = null;
        this.form.foto_url = null;
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
}
