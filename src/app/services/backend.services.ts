import { Injectable } from "@angular/core";
import { HttpClient, HttpEvent, HttpResponse } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "src/environments/environment";

@Injectable({
    providedIn: "root"
})
export class BackendServices {
    private baseUrl = environment.apiUrl;

    constructor(
        private httpClient: HttpClient
    ) {}

    // ============================================
    // AUTENTICACIÓN
    // ============================================
    
    login(usuario: string, contrasena: string){
        return this.httpClient.post(`${this.baseUrl}/login`, {usuario, contrasena});
    }

    /** Versión desplegada en el servidor (pública, sin auth). */
    obtenerVersionApp(): Observable<{ success: boolean; version?: string }> {
        return this.httpClient.get<{ success: boolean; version?: string }>(
            `${this.baseUrl}/version?_nc=${Date.now()}`
        );
    }

    verificarPassword(password: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/verificar-password`, { password });
    }

    // ============================================
    // RECUPERACIÓN DE CONTRASEÑA
    // ============================================

    solicitarCodigoRecuperacion(identifier: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/forgot-password`, { identifier });
    }

    verificarCodigoRecuperacion(identifier: string, code: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/verify-reset-code`, { identifier, code });
    }

    restablecerPassword(identifier: string, reset_token: string, nueva_password: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/reset-password`, { identifier, reset_token, nueva_password });
    }

    // ============================================
    // USUARIOS
    // ============================================

    obtenerUsuarios(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/usuarios`);
    }

    obtenerUsuario(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/usuarios/${id}`);
    }

    obtenerResponsableCalidad(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/usuarios/responsable-calidad`);
    }

    obtenerCorreosSugeridos(limit: number = 200): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/usuarios/correos-sugeridos?limit=${limit}`);
    }

    guardarCorreosPersonales(correos: string[]): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/usuarios/correos-personales`, { correos });
    }

    crearUsuario(usuario: any): Observable<any> {
        // Si es FormData (con archivo), enviar sin Content-Type para que el browser ponga el boundary
        if (usuario instanceof FormData) {
            return this.httpClient.post(`${this.baseUrl}/usuarios`, usuario);
        }
        return this.httpClient.post(`${this.baseUrl}/usuarios`, usuario);
    }

    obtenerRoles(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/roles`);
    }

    actualizarUsuario(id: number, datos: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/usuarios/${id}`, datos);
    }

    eliminarUsuario(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/usuarios/${id}`);
    }

    resetearPassword(id: number, nueva_password: string, credencialesCorreosExtra: string[] = []): Observable<any> {
        const payload: any = { nueva_password };
        if (Array.isArray(credencialesCorreosExtra) && credencialesCorreosExtra.length > 0) {
            payload.credenciales_correos_extra = credencialesCorreosExtra;
        }
        return this.httpClient.post(`${this.baseUrl}/usuarios/${id}/resetear-password`, payload);
    }

    verificarPasswordActualUsuario(id: number, password_actual: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/usuarios/${id}/verificar-password-actual`, { password_actual });
    }

    obtenerPasswordActualUsuario(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/usuarios/${id}/password-actual`);
    }

    // ============================================
    // CORREO
    // ============================================

    obtenerCarpetasCorreo(apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/${apiBase}/carpetas?_nc=${Date.now()}`);
    }

    obtenerFirmaDigitalCorreo(apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/${apiBase}/firma-digital?_nc=${Date.now()}`);
    }

    obtenerCorreosPerfil(
        limit: number = 50,
        carpeta: string = 'inbox',
        incluirCarpetas = false,
        apiBase: 'correo' | 'correo-empresa' = 'correo',
        pagina = 1,
        busqueda = ''
    ): Observable<any> {
        const incluir = incluirCarpetas ? '1' : '0';
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        const consulta = encodeURIComponent(String(busqueda || '').trim());
        return this.httpClient.get(
            `${this.baseUrl}/${apiBase}?limit=${limit}&pagina=${pagina}&q=${consulta}&carpeta=${carpetaNormalizada}&incluirCarpetas=${incluir}&_nc=${Date.now()}`
        );
    }

    obtenerBusquedasCorreo(apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/${apiBase}/busquedas?_nc=${Date.now()}`);
    }

    guardarBusquedaCorreo(termino: string, apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/${apiBase}/busquedas`, { termino });
    }

    eliminarBusquedaCorreo(id: number, apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/${apiBase}/busquedas/${id}`);
    }

    borrarBusquedasCorreo(apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/${apiBase}/busquedas`);
    }

    obtenerHtmlCorreo(uid: string | number, carpeta: string = 'inbox', apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<string> {
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        return this.httpClient.get(
            `${this.baseUrl}/${apiBase}/${uid}/html?carpeta=${carpetaNormalizada}&_nc=${Date.now()}`,
            { responseType: 'text' }
        );
    }

    obtenerVistaCorreo(uid: string | number, carpeta: string = 'inbox', apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        return this.httpClient.get(
            `${this.baseUrl}/${apiBase}/${uid}/vista?carpeta=${carpetaNormalizada}&_nc=${Date.now()}`
        );
    }

    obtenerAdjuntosCorreo(uid: string | number, carpeta: string = 'inbox', apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        return this.httpClient.get(
            `${this.baseUrl}/${apiBase}/${uid}/adjuntos?carpeta=${carpetaNormalizada}&_nc=${Date.now()}`
        );
    }

    descargarAdjuntoCorreo(
        uid: string | number,
        indice: number,
        carpeta: string = 'inbox',
        apiBase: 'correo' | 'correo-empresa' = 'correo'
    ): Observable<HttpResponse<Blob>> {
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        return this.httpClient.get(
            `${this.baseUrl}/${apiBase}/${uid}/adjuntos/${indice}?carpeta=${carpetaNormalizada}&_nc=${Date.now()}`,
            { observe: 'response', responseType: 'blob' }
        );
    }

    eliminarCorreo(uid: string | number, carpeta: string = 'inbox', apiBase: 'correo' | 'correo-empresa' = 'correo'): Observable<any> {
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        return this.httpClient.delete(
            `${this.baseUrl}/${apiBase}/${uid}?carpeta=${carpetaNormalizada}&_nc=${Date.now()}`
        );
    }

    accionCorreo(
        uid: string | number,
        carpeta: string,
        accion: string,
        activo?: boolean,
        apiBase: 'correo' | 'correo-empresa' = 'correo'
    ): Observable<any> {
        const payload: { accion: string; activo?: boolean } = { accion };
        if (typeof activo === 'boolean') {
            payload.activo = activo;
        }
        const carpetaNormalizada = encodeURIComponent(String(carpeta || 'inbox').trim().toLowerCase());
        return this.httpClient.post(
            `${this.baseUrl}/${apiBase}/${uid}/accion?carpeta=${carpetaNormalizada}&_nc=${Date.now()}`,
            payload
        );
    }

    enviarCorreoPerfil(
        payload: {
            destinatario: string;
            asunto: string;
            mensaje: string;
            html?: string;
            cc?: string;
            cco?: string;
            inReplyTo?: string;
            references?: string;
            adjuntos?: Array<{ nombre: string; contentType: string; contenidoBase64: string }>;
        },
        apiBase: 'correo' | 'correo-empresa' = 'correo'
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/${apiBase}/enviar`, payload);
    }

    // ============================================
    // CURSOS
    // ============================================
    
    cursos(incluirInactivos = false){
        const query = incluirInactivos ? '?incluirInactivos=1' : '';
        return this.httpClient.get(`${this.baseUrl}/cursos${query}`);
    }

    obtenerCurso(cursoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}`);
    }

    crearCurso(curso: any){
        return this.httpClient.post(`${this.baseUrl}/cursos`, curso);
    }

    actualizarCurso(curso: any){
        return this.httpClient.put(`${this.baseUrl}/cursos/${curso.curso_id}`, curso);
    }

    subirImagenCurso(cursoId: number, formData: FormData): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos/${cursoId}/imagen`, formData);
    }

    eliminarCurso(cursoId: number){
        return this.httpClient.delete(`${this.baseUrl}/cursos/${cursoId}`);
    }

    activarCurso(cursoId: number){
        return this.httpClient.post(`${this.baseUrl}/cursos/${cursoId}/activar`, {});
    }

    estadisticasCursos(){
        return this.httpClient.get(`${this.baseUrl}/estadisticas/cursos`);
    }

    // ============================================
    // ÁREAS TEMÁTICAS
    // ============================================

    obtenerAreas(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/areas`);
    }

    obtenerAreasConCursos(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/areas/con-cursos`);
    }

    // ============================================
    // EMPRESAS
    // ============================================
    
    obtenerEmpresas(): Observable<any> {
        return this.httpClient.get<any>(`${this.baseUrl}/empresas`);
    }

    obtenerEmpresa(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/empresas/${empresaId}`);
    }

    registrarEmpresa(nombre_empresa: string, rfc: string){
        const body = { nombre_empresa, rfc };
        return this.httpClient.post(`${this.baseUrl}/registrar-empresa`, body);
    }

    registrarEmpresaCompleta(empresa: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/registrar-empresa`, empresa);
    }

    registrarEmpresaConArchivo(formData: FormData){
        return this.httpClient.post(`${this.baseUrl}/registrar-empresa-archivo`, formData);
    }

    validarSimilitudRegistroEmpresa(datos: {
        nombre_empresa?: string;
        rfc: string;
        estado?: string;
        ciudad?: string;
        codigo_postal?: string;
        email?: string;
        telefono?: string;
        contacto_email?: string;
        contacto_telefono?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/empresas/validar-registro`, datos);
    }

    actualizarEmpresa(empresaId: number, empresa: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/empresas/${empresaId}`, empresa);
    }

    actualizarLogoEmpresa(empresaId: number, formData: FormData): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/empresas/${empresaId}`, formData);
    }

    // Ocultar empresa del sistema (soft delete - datos permanecen para auditorías)
    eliminarEmpresa(empresaId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/empresas/${empresaId}`);
    }

    listarEmpresaRepositorio(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/empresas/${empresaId}/repositorio`);
    }

    crearEmpresaRepositorioCarpeta(empresaId: number, payload: {
        nombre: string;
        carpeta_padre?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/empresas/${empresaId}/repositorio/carpetas`, payload);
    }

    eliminarEmpresaRepositorioCarpeta(empresaId: number, ruta: string): Observable<any> {
        return this.httpClient.request('delete', `${this.baseUrl}/empresas/${empresaId}/repositorio/carpetas`, {
            body: { ruta }
        });
    }

    moverEmpresaRepositorio(empresaId: number, id: number, carpeta_relativa: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/empresas/${empresaId}/repositorio/${id}/mover`, {
            carpeta_relativa
        });
    }

    subirEmpresaRepositorio(empresaId: number, payload: {
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
        carpeta_relativa?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/empresas/${empresaId}/repositorio/subir`, payload);
    }

    subirEmpresaRepositorioLote(empresaId: number, archivos: {
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
        carpeta_relativa?: string;
    }[]): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/empresas/${empresaId}/repositorio/subir-lote`, { archivos });
    }

    descargarEmpresaRepositorio(empresaId: number, id: number): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/empresas/${empresaId}/repositorio/${id}/archivo`, {
            responseType: 'blob'
        });
    }

    miniaturaEmpresaRepositorio(empresaId: number, id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/empresas/${empresaId}/repositorio/${id}/miniatura`);
    }

    eliminarEmpresaRepositorio(empresaId: number, id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/empresas/${empresaId}/repositorio/${id}`);
    }

    prepararVistaEmpresaRepositorio(empresaId: number, id: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/empresas/${empresaId}/repositorio/${id}/preparar-vista`,
            {}
        );
    }

    /** Asegura Google Sheet/Docs nativo y URL de editor embebible en repositorio empresarial. */
    asegurarEditorEmpresaRepositorio(empresaId: number, id: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/empresas/${empresaId}/repositorio/${id}/asegurar-editor`,
            {}
        );
    }

    actualizarConstancia(rfc: string, formData: FormData){
        return this.httpClient.put(`${this.baseUrl}/empresas/${rfc}/constancia`, formData);
    }

    obtenerUrlConstancia(rfc: string): string {
        return `${this.baseUrl}/empresas/${rfc}/constancia`;
    }

    obtenerSectores(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sectores`);
    }

    buscarCodigoPostalMx(codigoPostal: string): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/catalogos/codigo-postal/${codigoPostal}`);
    }

    obtenerMunicipiosPorEstadoInegi(cveEstado: string): Observable<any> {
        return this.httpClient.get(`https://gaia.inegi.org.mx/wscatgeo/mgem/${cveEstado}`);
    }

    // ============================================
    // EMPLEADOS
    // ============================================
    
    obtenerEmpleadosPorEmpresa(empresa_id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/empresas/${empresa_id}/empleados`);
    }

    obtenerEmpleadosEmpresaCurso(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/empleados-empresa`);
    }

    crearEmpleado(empleado: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/empleados`, empleado);
    }

    actualizarEmpleado(empleado_id: number, empleado: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/empleados/${empleado_id}`, empleado);
    }

    eliminarEmpleado(empleado_id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/empleados/${empleado_id}`);
    }

    // ============================================
    // INSTRUCTORES
    // ============================================
    
    obtenerInstructores(areaId?: number): Observable<any> {
        const url = areaId
            ? `${this.baseUrl}/instructores?area_id=${areaId}`
            : `${this.baseUrl}/instructores`;
        return this.httpClient.get(url);
    }

    obtenerInstructor(instructorId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/instructores/${instructorId}`);
    }

    crearInstructor(instructor: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/instructores`, instructor);
    }

    actualizarInstructor(instructorId: number, instructor: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/instructores/${instructorId}`, instructor);
    }

    eliminarInstructor(instructorId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/instructores/${instructorId}`);
    }

    // ============================================
    // HISTORIAL DE CURSOS
    // ============================================
    
    obtenerHistorialCursos(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/historial-cursos`);
    }

    obtenerHistorialPorEmpresa(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/historial-cursos?empresa_id=${empresaId}`);
    }

    crearHistorialCurso(historial: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/historial-cursos`, historial);
    }

    actualizarHistorialCurso(historial_id: number, historial: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/historial-cursos/${historial_id}`, historial);
    }

    obtenerHistorialCompletados(cursoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}/historial-completados`);
    }

    obtenerCursosImpartidosEmpresa(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/empresas/${empresaId}/cursos-programados-impartidos`);
    }

    obtenerDocumentosDrive(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/documentos-drive`);
    }

    // ============================================
    // CURSOS PROGRAMADOS
    // ============================================
    
    obtenerCursosProgramados(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados`);
    }

    obtenerEmpresaContacto(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/empresa-contacto`);
    }

    obtenerSugerenciaEstructuraInforme(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/informe-estructura-sugerida`);
    }

    crearCursoProgramado(cursoProgramado: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados`, cursoProgramado);
    }

    crearEventoCursoGoogleCalendar(datosEvento: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/google-calendar/eventos/curso`, datosEvento);
    }

    enviarInvitacionCurso(datos: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/enviar-invitacion-curso`, datos);
    }

    actualizarCursoProgramado(programado_id: number, cursoProgramado: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos-programados/${programado_id}`, cursoProgramado);
    }

    eliminarCursoProgramado(programadoId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/cursos-programados/${programadoId}`);
    }

    /** URL SSE para eliminar curso programado con progreso en tiempo real */
    getEliminarCursoStreamUrl(programadoId: number, token: string): string {
        return `${this.baseUrl}/cursos-programados/${programadoId}/eliminar-stream?token=${encodeURIComponent(token)}`;
    }

    obtenerCursosProgramadosPorEmpresa(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/empresa/${empresaId}`);
    }

    obtenerCursosProgramadosPorInstructor(instructorId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/instructor/${instructorId}`);
    }

    registrarEmpleadosCurso(programadoId: number, payload: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/registrar-empleados`, payload);
    }

    obtenerNotificaciones(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/notificaciones`);
    }

    descartarNotificacion(id: number): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/notificaciones/${id}/descartar`, {});
    }

    obtenerAreasTickets(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/tickets/areas`);
    }

    /** Mantenimiento EIN-F-02: subir evidencias a Drive (con progreso) */
    subirEvidenciasMantenimiento(folio: string, archivos: File[]): Observable<HttpEvent<any>> {
        const formData = new FormData();
        for (const file of archivos || []) {
            if (file) {
                formData.append('evidencias', file, file.name);
            }
        }
        return this.httpClient.post(
            `${this.baseUrl}/mantenimiento/solicitudes/${encodeURIComponent(folio)}/evidencias`,
            formData,
            { reportProgress: true, observe: 'events' }
        );
    }

    eliminarEvidenciaMantenimiento(fileId: string): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/mantenimiento/evidencias/${encodeURIComponent(fileId)}`);
    }

    /** Genera EIN-F-02 (Excel/Google Sheet) a partir de la solicitud */
    generarSolicitudMantenimientoF02(folio: string, payload: {
        nombreSolicitante?: string;
        puesto?: string;
        area?: string;
        fechaSolicitud?: string;
        descripcionProblema?: string;
        observacionesAdministrador?: string;
        nombreArchivo?: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/mantenimiento/solicitudes/${encodeURIComponent(folio)}/reporte-f02`,
            payload || {}
        );
    }

    /** Genera EIN-F-03 Bitácora (Excel/Google Sheet) — una fila o varias */
    generarBitacoraMantenimientoF03(folio: string, payload: {
        filas?: Array<{
            no?: number;
            tipoInfraestructura?: string;
            idSerie?: string;
            tipoMantenimiento?: string;
            internoExterno?: string;
            actividades?: string;
            responsable?: string;
            fechaRealizado?: string;
            observaciones?: string;
        }>;
        tipoInfraestructura?: string;
        idSerie?: string;
        tipoMantenimiento?: string;
        internoExterno?: string;
        actividades?: string;
        responsable?: string;
        fechaRealizado?: string;
        observaciones?: string;
        nombreArchivo?: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/mantenimiento/solicitudes/${encodeURIComponent(folio)}/bitacora-f03`,
            payload || {}
        );
    }

    /** Guarda EIN-F-01 Programa en Excel/Drive */
    guardarProgramaMantenimientoF01(payload: {
        meta?: object;
        filas?: unknown[];
        anio?: number;
        spreadsheetId?: string;
        nombreArchivo?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/mantenimiento/programa-f01/guardar`, payload || {});
    }

    /** Guarda EIN-F-03 Bitácora en Excel/Drive */
    guardarBitacoraMantenimientoF03Global(payload: {
        folio?: string;
        filas?: unknown[];
        spreadsheetId?: string;
        nombreArchivo?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/mantenimiento/bitacora-f03/guardar`, payload || {});
    }

    /** Descarga PDF del reporte EIN-F-04 (genera Word + exporta) */
    descargarPdfReporteMantenimientoF04(folio: string, payload: {
        descripcionMantenimientoRealizado?: string;
        descripcionMantenimiento?: string;
        evidencias?: Array<{ driveFileId?: string; url?: string; webViewLink?: string; nombre?: string }>;
        tipoMantenimiento?: string;
        fechaSolicitud?: string;
        fechaRealizado?: string;
        responsable?: string;
        nombreSolicitante?: string;
        nombreArchivo?: string;
        reporteDriveFileId?: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/mantenimiento/solicitudes/${encodeURIComponent(folio)}/reporte-f04/pdf`,
            payload || {},
            { responseType: 'blob', observe: 'response' }
        );
    }

    /** Estadísticas de respuestas del Google Form EIN-F-02 */
    obtenerEstadisticasFormsMantenimientoF02(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/mantenimiento/forms-f02/estadisticas`);
    }

    /** Genera EIN-F-04 (Word/Google Doc) a partir de la solicitud */
    generarReporteMantenimientoF04(folio: string, payload: {
        descripcionMantenimientoRealizado?: string;
        descripcionMantenimiento?: string;
        evidencias?: Array<{ driveFileId?: string; url?: string; webViewLink?: string; nombre?: string }>;
        tipoMantenimiento?: string;
        fechaSolicitud?: string;
        fechaRealizado?: string;
        responsable?: string;
        nombreSolicitante?: string;
        nombreArchivo?: string;
        reporteDriveFileId?: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/mantenimiento/solicitudes/${encodeURIComponent(folio)}/reporte-f04`,
            payload || {}
        );
    }

    /** Sube PDF firmado EIN-F-04 a Drive */
    subirPdfFirmadoMantenimientoF04(folio: string, archivo: File): Observable<any> {
        const formData = new FormData();
        formData.append('pdf', archivo, archivo.name);
        return this.httpClient.post(
            `${this.baseUrl}/mantenimiento/solicitudes/${encodeURIComponent(folio)}/pdf-firmado`,
            formData
        );
    }

    crearTicket(payload: {
        area: string;
        descripcion: string;
        prioridad?: string;
        tipo: string;
        evidencias?: Array<{ file: File; descripcion?: string }>;
    }): Observable<any> {
        const formData = new FormData();
        formData.append('area', payload.area);
        formData.append('descripcion', payload.descripcion);
        formData.append('prioridad', payload.prioridad || 'normal');
        formData.append('tipo', payload.tipo);
        const evidencias = payload.evidencias || [];
        formData.append(
            'evidenciaDescripciones',
            JSON.stringify(evidencias.map((e) => e.descripcion || ''))
        );
        for (const ev of evidencias) {
            if (ev?.file) {
                formData.append('evidencias', ev.file, ev.file.name);
            }
        }
        return this.httpClient.post(`${this.baseUrl}/tickets`, formData);
    }

    obtenerTickets(estado?: string, ciclo?: string): Observable<any> {
        const params: string[] = [];
        if (estado) params.push(`estado=${encodeURIComponent(estado)}`);
        if (ciclo) params.push(`ciclo=${encodeURIComponent(ciclo)}`);
        const q = params.length ? `?${params.join('&')}` : '';
        return this.httpClient.get(`${this.baseUrl}/tickets${q}`);
    }

    obtenerTicketsPendientes(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/tickets/pendientes`);
    }

    obtenerMisTickets(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/tickets/mios`);
    }

    actualizarTicket(id: number, estado: string): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/tickets/${id}`, { estado });
    }

    obtenerOpiniones(estado?: string): Observable<any> {
        const q = estado ? `?estado=${encodeURIComponent(estado)}` : '';
        return this.httpClient.get(`${this.baseUrl}/opiniones${q}`);
    }

    crearOpinion(payload: { tipo: string; descripcion: string; cliente?: string }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/opiniones`, payload);
    }

    actualizarOpinion(id: number, estado: string): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/opiniones/${id}`, { estado });
    }

    obtenerEvidenciaTicket(ticketId: number, evidenciaId: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/tickets/${ticketId}/evidencias/${evidenciaId}`,
            { responseType: 'blob' }
        );
    }

    // Chat Empresas (asistido / manual)
    obtenerChatConversaciones(opts?: { q?: string; soloNoLeidos?: boolean }): Observable<any> {
        const params: string[] = [];
        if (opts?.q) params.push(`q=${encodeURIComponent(opts.q)}`);
        if (opts?.soloNoLeidos) params.push('soloNoLeidos=1');
        const q = params.length ? `?${params.join('&')}` : '';
        return this.httpClient.get(`${this.baseUrl}/chat-empresas/conversaciones${q}`);
    }

    obtenerChatMensajes(conversacionId: number, afterId?: number): Observable<any> {
        const q = afterId ? `?afterId=${encodeURIComponent(String(afterId))}` : '';
        return this.httpClient.get(`${this.baseUrl}/chat-empresas/conversaciones/${conversacionId}/mensajes${q}`);
    }

    enviarChatMensaje(payload: { cuerpo: string; conversacionId?: number; empresaId?: number }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/chat-empresas/mensajes`, payload);
    }

    marcarChatLeidos(conversacionId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/chat-empresas/conversaciones/${conversacionId}/leidos`, {});
    }

    actualizarChatConversacion(conversacionId: number, estado: string): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/chat-empresas/conversaciones/${conversacionId}`, { estado });
    }

    // Notas de versión (novedades entre releases)
    obtenerNotasVersion(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/notas-version`);
    }

    crearNotaVersion(payload: { titulo: string; descripcion: string; icono?: string }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/notas-version`, payload);
    }

    eliminarNotaVersion(id: string): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/notas-version/${encodeURIComponent(id)}`);
    }

    publicarNotasVersion(version?: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/notas-version/publicar`, version ? { version } : {});
    }

    generarSGCF33Drive(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/generar-sgcf33-drive`, {});
    }

    generarSGCF33VaciaDrive(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/generar-sgcf33-vacia-drive`, {});
    }

    generarEntregaDocumentosDrive(programadoId: number, payload: { personaEntrega?: string } = {}): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/generar-entrega-documentos-drive`,
            payload
        );
    }

    subirEntregaDocumentosFirmado(programadoId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/subir-entrega-documentos-firmado`,
            formData
        );
    }

    descargarSGCF33Vacia(programadoId: number): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/generar-sgcf33-vacia`, {
            responseType: 'blob'
        });
    }

    eliminarInscripcion(inscripcionId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/inscripciones/${inscripcionId}`);
    }

    actualizarAsistencia(inscripcionId: number, asistio: boolean, nota: string, calificacionTeorica?: number | null, calificacionPractica?: number | null, calificacionDiagnostica?: number | null): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/inscripciones/${inscripcionId}/asistencia`, { asistio, nota, calificacionTeorica, calificacionPractica, calificacionDiagnostica });
    }

    guardarProgresoCurso(programadoId: number, pasosCompletados: number[]): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/cursos-programados/${programadoId}/progreso`, { pasosCompletados });
    }

    actualizarEstatusCurso(programadoId: number, estatus: string): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/cursos-programados/${programadoId}/estatus`, { estatus });
    }

    /** Cursos finalizados pendientes de consulta en historial (admins). */
    obtenerHistorialPendientes(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/historial-pendientes`);
    }

    marcarHistorialConsultado(programadoId: number): Observable<any> {
        return this.httpClient.patch(
            `${this.baseUrl}/cursos-programados/${programadoId}/historial-consultado`,
            { consultado: true }
        );
    }

    // ============================================
    // PARTICIPANTES Y ASISTENCIA
    // ============================================

    /**
     * Obtener participantes (inscritos) de un curso programado
     */
    obtenerParticipantesCurso(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/participantes`);
    }

    obtenerColaboradorasDocumentos(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/colaboradoras-documentos`);
    }

    guardarColaboradorasDocumentos(programadoId: number, payload: {
        usa_empresas_colaboradoras: boolean;
        asignaciones?: Array<{
            inscripcion_id: number;
            empresa_documento_id: number | null;
            curso_documento_id: number | null;
        }>;
    }): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos-programados/${programadoId}/colaboradoras-documentos`, payload);
    }

    /**
     * Agregar un nuevo participante a un curso
     */
    agregarParticipanteCurso(cursoId: number, nombre: string, curp: string, puesto: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${cursoId}/participantes`, {
            nombre,
            curp,
            puesto
        });
    }

    /**
     * Actualizar datos de un participante
     */
    actualizarParticipante(inscripcionId: number, nombre: string, curp: string, puesto: string): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/inscripciones/${inscripcionId}/datos`, {
            nombre,
            curp,
            puesto
        });
    }

    /**
     * Registrar asistencia de participantes
     */
    registrarAsistencia(programadoId: number, payload: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/asistencia`, payload);
    }

    /**
     * Obtener asistencia de un curso programado
     */
    obtenerAsistencia(programadoId: number, fechaSesion?: string): Observable<any> {
        const url = fechaSesion 
            ? `${this.baseUrl}/cursos-programados/${programadoId}/asistencia?fecha=${fechaSesion}`
            : `${this.baseUrl}/cursos-programados/${programadoId}/asistencia`;
        return this.httpClient.get(url);
    }

    // ============================================
    // PROGRESO DEL CURSO (10 PASOS)
    // ============================================

    /**
     * Obtener progreso de los pasos del curso
     */
    obtenerProgresoCurso(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/progreso`);
    }

    /**
     * Actualizar progreso de un paso específico
     */
    actualizarPasoCurso(programadoId: number, pasoNumero: number, datos: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos-programados/${programadoId}/progreso/${pasoNumero}`, datos);
    }

    /**
     * Marcar paso como completado
     */
    completarPasoCurso(programadoId: number, pasoNumero: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/progreso/${pasoNumero}/completar`, {});
    }

    /**
     * Obtener examen diagnóstico de un curso programado
     */
    obtenerExamenDiagnostico(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/examen-diagnostico`);
    }

    /**
     * Obtener documento de un curso programado por tipo (genérico)
     */
    obtenerDocumentoCursoPorTipo(programadoId: number, tipo: string): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/documento`, {
            params: { tipo }
        });
    }

    /**
     * Obtener TODOS los documentos de un curso programado
     */
    obtenerTodosDocumentosCurso(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/todos-documentos`);
    }

    /**
     * Obtener URL para descargar documento
     */
    obtenerUrlDescargaDocumento(documentoId: number): string {
        return `${this.baseUrl}/cursos/${documentoId}/documentos/descargar`;
    }

    /**
     * Subir examen resuelto (PDF global) a la carpeta de capacitación en Drive
     */
    subirExamenResuelto(programadoId: number, file: File, tipoExamen: string = 'diagnostico'): Observable<any> {
        const formData = new FormData();
        formData.append('archivo', file);
        formData.append('tipo_examen', tipoExamen);
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/subir-examen-resuelto`,
            formData
        );
    }

    /**
     * Subir fotos de evidencia (múltiples imágenes) a Drive
     */
    subirFotosEvidencia(programadoId: number, fotos: File[]): Observable<any> {
        const formData = new FormData();
        for (const foto of fotos) {
            formData.append('fotos', foto);
        }
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/subir-fotos-evidencia`,
            formData
        );
    }

    /**
     * Subir lista de asistencia física (PDF/JPG) a Drive
     */
    subirListaAsistenciaFisica(programadoId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/subir-lista-asistencia-fisica`,
            formData
        );
    }

    // ============================================
    // EVALUACIONES Y CALIFICACIONES
    // ============================================

    /**
     * Obtener evaluaciones de un participante
     */
    obtenerEvaluacionesParticipante(inscripcionId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/inscripciones/${inscripcionId}/evaluaciones`);
    }

    /**
     * Registrar calificación de evaluación
     */
    registrarCalificacion(inscripcionId: number, evaluacionId: number, datos: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/inscripciones/${inscripcionId}/evaluaciones/${evaluacionId}/calificacion`, datos);
    }

    /**
     * Subir archivo de evaluación
     */
    subirArchivoEvaluacion(inscripcionId: number, evaluacionId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.post(
            `${this.baseUrl}/inscripciones/${inscripcionId}/evaluaciones/${evaluacionId}/archivo`,
            formData
        );
    }

    /**
     * Obtener evaluaciones de un curso
     */
    obtenerEvaluacionesCurso(cursoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}/evaluaciones`);
    }

    // ============================================
    // CONSTANCIAS Y DIPLOMAS
    // ============================================

    guardarCalificacionesFinalesEnDrive(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/generar-calificaciones-drive`, {});
    }

    generarInformeFinalExcel(programadoId: number, payload: any): Observable<Blob> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/generar-informe-final-excel`,
            payload,
            { responseType: 'blob' }
        );
    }

    generarInformeFinalEnDrive(programadoId: number, payload: any): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/generar-informe-final-drive`,
            payload
        );
    }

    refrescarInformeFinalPdfOficial(programadoId: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/refrescar-informe-final-pdf-oficial`,
            {}
        );
    }

    generarInformeFotografico(programadoId: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/generar-informe-fotografico`,
            {}
        );
    }

    asegurarInformeFotograficoPdfOficial(programadoId: number, force = false, slidesDriveFileId?: string | null): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/asegurar-informe-fotografico-pdf`,
            {
                force,
                slidesDriveFileId: slidesDriveFileId || null
            }
        );
    }

    asegurarAccesoPublicoDrive(fileId: string): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/drive/${encodeURIComponent(fileId)}/asegurar-acceso-lectura`,
            {}
        );
    }

    asegurarGoogleSheetDrive(
        fileId: string,
        payload: { nombre?: string; programado_id?: number | null } = {}
    ): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/drive/${encodeURIComponent(fileId)}/asegurar-google-sheet`,
            payload || {}
        );
    }

    generarChecklistVerificacionEnDrive(programadoId: number, payload: any): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/generar-checklist-verificacion-drive`,
            payload
        );
    }

    descargarDocumentosGeneradosZip(programadoId: number, cursoId?: number): Observable<Blob> {
        const options: { responseType: 'blob'; params?: any } = { responseType: 'blob' };
        if (cursoId !== undefined && cursoId !== null) {
            options.params = { curso_id: String(cursoId) };
        }
        return this.httpClient.get(
            `${this.baseUrl}/cursos-programados/${programadoId}/documentos-generados-zip`,
            options
        );
    }

    /**
     * ZIP de documentos individuales:
     * - constancias: todas las constancias individuales
     * - dc3: todos los DC-3 individuales
     * - ambos: carpeta por empleado con constancia + DC-3
     */
    descargarDocumentosIndividualesZip(
        programadoId: number,
        tipo: 'constancias' | 'dc3' | 'ambos',
        cursoId?: number
    ): Observable<Blob> {
        const params: any = { tipo };
        if (cursoId !== undefined && cursoId !== null && Number.isFinite(Number(cursoId))) {
            params.curso_id = String(cursoId);
        }
        return this.httpClient.get(
            `${this.baseUrl}/cursos-programados/${programadoId}/documentos-individuales-zip`,
            { responseType: 'blob', params }
        );
    }

    descargarConstanciasCombinadasPdf(programadoId: number, cursoId?: number): Observable<Blob> {
        const options: { responseType: 'blob'; params?: any } = { responseType: 'blob' };
        if (cursoId !== undefined && cursoId !== null) {
            options.params = { curso_id: String(cursoId) };
        }
        return this.httpClient.get(
            `${this.baseUrl}/cursos-programados/${programadoId}/constancias-combinadas-pdf`,
            options
        );
    }

    descargarDc3CombinadosPdf(programadoId: number, cursoId?: number): Observable<Blob> {
        const options: { responseType: 'blob'; params?: any } = { responseType: 'blob' };
        if (cursoId !== undefined && cursoId !== null) {
            options.params = { curso_id: String(cursoId) };
        }
        return this.httpClient.get(
            `${this.baseUrl}/cursos-programados/${programadoId}/dc3-combinados-pdf`,
            options
        );
    }

    registrarDescargaConstanciasDc3(
        programadoId: number,
        payload: { origen?: string; detalle?: string } = {}
    ): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/registrar-descarga-constancias-dc3`,
            payload
        );
    }

    diagnosticarConstanciasDc3(programadoId: number): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/cursos-programados/${programadoId}/constancias-dc3/diagnostico`
        );
    }

    listarParticipantesConstanciasDc3(programadoId: number, cursoCatalogoId: number): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/cursos-programados/${programadoId}/constancias-dc3/participantes`,
            { params: { curso_catalogo_id: String(cursoCatalogoId) } }
        );
    }

    bajaParticipanteConstanciasDc3(
        programadoId: number,
        cursoCatalogoId: number,
        inscripcionId: number
    ): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/constancias-dc3/baja-participante`,
            { curso_catalogo_id: cursoCatalogoId, inscripcion_id: inscripcionId }
        );
    }

    limpiarConstanciasDc3(
        programadoId: number,
        cursoCatalogoId: number,
        modo: 'curso' | 'huerfanos' = 'curso'
    ): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/cursos-programados/${programadoId}/constancias-dc3`,
            { body: { curso_catalogo_id: cursoCatalogoId, modo } }
        );
    }

    buscarHistorialConstanciasDc3(folio: string): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/historial-constancias-dc3`, {
            params: { folio }
        });
    }

    descargarArchivoHistorialConstanciasDc3(driveFileId: string, nombreArchivo: string): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/historial-constancias-dc3/archivo/${encodeURIComponent(String(driveFileId || '').trim())}`,
            {
                params: { nombre: nombreArchivo || 'documento.pdf' },
                responseType: 'blob'
            }
        );
    }

    // ============================================
    // DOCUMENTOS DEL CURSO PROGRAMADO
    // ============================================

    /**
     * Subir documento del curso programado (informe final, fotos, etc.)
     */
    subirDocumentoCursoProgramado(
        programadoId: number,
        tipoDocumento: string,
        file: File,
        descripcion?: string,
        opciones?: { modo?: 'agregar' | 'reemplazar' }
    ): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('tipo_documento', tipoDocumento);
        if (descripcion) {
            formData.append('descripcion', descripcion);
        }
        if (opciones?.modo === 'agregar') {
            formData.append('modo', 'agregar');
        }
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/documentos`,
            formData
        );
    }

    /** Vincular Entrega de Documentos (SP-F-03) a otros cursos sin re-subir archivo */
    vincularEntregaDocumentosProgramados(programadoId: number, payload: {
        programadoIds: number[];
        driveFileId?: string | null;
        archivoUrl?: string | null;
        nombreArchivo?: string | null;
        descripcion?: string | null;
        tipoDocumento?: string | null;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/cursos-programados/${programadoId}/entrega-documentos/vincular`,
            payload
        );
    }

    /**
     * Obtener documentos de un curso programado
     */
    obtenerDocumentosCursoProgramado(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/documentos-programado`);
    }

    /**
     * Eliminar documento del curso programado (elimina de Drive y BD)
     */
    eliminarDocumentoCursoProgramado(documentoProgId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/documentos-curso-programado/${documentoProgId}`);
    }

    /**
     * Limpiar calificaciones de todos los participantes al eliminar un documento de examen
     */
    limpiarCalificacionesCurso(programadoId: number, tipo: 'diagnostico' | 'evaluacion'): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/limpiar-calificaciones`, { tipo });
    }

    /**
     * Sincronizar documentos: verifica que archivos en Drive existan, elimina huérfanos de BD
     */
    sincronizarDocumentosCursoProgramado(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/sincronizar-documentos`, {});
    }

    // ============================================
    // ENCUESTAS DE SATISFACCIÓN
    // ============================================

    /**
     * Guardar encuesta de satisfacción
     */
    guardarEncuesta(inscripcionId: number, encuesta: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/inscripciones/${inscripcionId}/encuesta`, encuesta);
    }

    /**
     * Obtener encuestas de un curso programado
     */
    obtenerEncuestasCurso(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/encuestas`);
    }

    /**
     * Generar link de encuesta
     */
    generarLinkEncuesta(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/link-encuesta`, {});
    }

    // ============================================
    // GOOGLE FORMS - Encuestas
    // ============================================

    obtenerEncuestaConfigCurso(cursoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}/encuesta-config`);
    }

    guardarEncuestaConfigCurso(cursoId: number, encuesta_url: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos/${cursoId}/encuesta-config`, { encuesta_url });
    }

    crearEncuestaGoogleForm(cursoId: number, payload: { titulo?: string; descripcion?: string } = {}): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos/${cursoId}/encuesta-form`, payload);
    }

    actualizarEncuestaGoogleForm(
        cursoId: number,
        payload: { titulo?: string; descripcion?: string; regenerar_plantilla?: boolean } = {}
    ): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos/${cursoId}/encuesta-form`, payload);
    }

    eliminarEncuestaGoogleForm(cursoId: number, permanent: boolean = false): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/cursos/${cursoId}/encuesta-form?permanent=${permanent}`);
    }

    obtenerEncuestaConfigProgramado(programadoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/encuesta-config`);
    }

    crearEncuestaGoogleFormProgramado(
        programadoId: number,
        payload: { titulo?: string; descripcion?: string } = {}
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/encuesta-form`, payload);
    }

    actualizarEncuestaGoogleFormProgramado(
        programadoId: number,
        payload: { titulo?: string; descripcion?: string; regenerar_plantilla?: boolean } = {}
    ): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos-programados/${programadoId}/encuesta-form`, payload);
    }

    eliminarEncuestaGoogleFormProgramado(programadoId: number, permanent: boolean = false): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/cursos-programados/${programadoId}/encuesta-form?permanent=${permanent}`);
    }

    obtenerEncuestaStatsProgramado(programadoId: number, cacheBust?: number): Observable<any> {
        const params: any = {};
        if (cacheBust !== undefined) {
            params._t = String(cacheBust);
        }
        return this.httpClient.get(`${this.baseUrl}/cursos-programados/${programadoId}/encuesta-stats`, { params });
    }

    cerrarEncuestaProgramado(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/cerrar-encuesta`, {});
    }

    habilitarEncuestaProgramado(programadoId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos-programados/${programadoId}/habilitar-encuesta`, {});
    }

    // ============================================
    // ESTADÍSTICAS
    // ============================================

    obtenerEstadisticasGenerales(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/estadisticas/general`);
    }

    // ============================================
    // DASHBOARD V2 — Endpoint unico consolidado
    // ============================================

    obtenerDashboardCompleto(filtros?: { anio?: number; empresaId?: number; cursoId?: number }): Observable<any> {
        const params: any = {};
        if (filtros?.anio) params.anio = String(filtros.anio);
        if (filtros?.empresaId) params.empresaId = String(filtros.empresaId);
        if (filtros?.cursoId) params.cursoId = String(filtros.cursoId);
        return this.httpClient.get(`${this.baseUrl}/v2/dashboard`, { params });
    }

    descargarControlCapacitacionPdf(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/dashboard/control-capacitacion/pdf`, {
            responseType: 'blob'
        });
    }

    descargarControlCapacitacionExcel(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/dashboard/control-capacitacion/excel`, {
            responseType: 'blob'
        });
    }

    obtenerEstadoControlCapacitacionExcelDrive(anio?: number): Observable<any> {
        const params = anio ? `?anio=${anio}` : '';
        return this.httpClient.get(`${this.baseUrl}/dashboard/control-capacitacion/excel/estado-drive${params}`);
    }

    guardarControlCapacitacionExcelDrive(anio?: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/dashboard/control-capacitacion/excel/guardar-drive`, {
            ...(anio ? { anio } : {})
        });
    }

    obtenerRegistrosControlCapacitacion(anio?: number): Observable<any> {
        const params: any = {};
        if (anio) params.anio = String(anio);
        return this.httpClient.get(`${this.baseUrl}/dashboard/control-capacitacion/registros`, { params });
    }

    // ============================================
    // CHECKLIST DE CURSOS
    // ============================================

    obtenerChecklistCurso(cursoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}/checklist`);
    }

    agregarItemChecklist(cursoId: number, item: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos/${cursoId}/checklist`, item);
    }

    actualizarItemChecklist(cursoId: number, checklistId: number, datos: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos/${cursoId}/checklist/${checklistId}`, datos);
    }

    eliminarItemChecklist(cursoId: number, checklistId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/cursos/${cursoId}/checklist/${checklistId}`);
    }

    reordenarChecklist(cursoId: number, items: any[]): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos/${cursoId}/checklist-orden`, { items });
    }



    // ============================================
    // DOCUMENTOS DE CURSOS
    // ============================================

    obtenerDocumentosCurso(cursoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}/documentos`);
    }

    crearDocumentoRequerido(cursoId: number, documento: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/cursos/${cursoId}/documentos`, documento);
    }

    subirArchivoDocumento(cursoId: number, documentoId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.post(
            `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/archivo`,
            formData
        );
    }

    subirArchivoDocumentoConProgreso(cursoId: number, documentoId: number, file: File): Observable<HttpEvent<any>> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.post<any>(
            `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/archivo`,
            formData,
            {
                observe: 'events',
                reportProgress: true
            }
        );
    }

    actualizarDocumentoCurso(cursoId: number, documentoId: number, datos: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}`, datos);
    }

    eliminarDocumentoCurso(cursoId: number, documentoId: number, eliminarDeTodos: boolean = false): Observable<any> {
        if (eliminarDeTodos) {
            return this.httpClient.post(`${this.baseUrl}/documentos/${documentoId}/eliminar-todos`, {});
        }
        return this.httpClient.delete(`${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}`);
    }

    descargarDocumentoCurso(cursoId: number, documentoId: number): string {
        return `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/descargar`;
    }

    // Obtener URL de Google Drive para ver el archivo
    obtenerUrlDrive(cursoId: number, documentoId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/url-drive`);
    }

    // Reemplazar archivo existente
    reemplazarArchivoDocumento(cursoId: number, documentoId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.put(
            `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/archivo`,
            formData
        );
    }

    reemplazarArchivoDocumentoConProgreso(cursoId: number, documentoId: number, file: File): Observable<HttpEvent<any>> {
        const formData = new FormData();
        formData.append('file', file);
        return this.httpClient.put<any>(
            `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/archivo`,
            formData,
            {
                observe: 'events',
                reportProgress: true
            }
        );
    }

    // Eliminar solo el archivo (mantiene el documento)
    eliminarSoloArchivoDocumento(cursoId: number, documentoId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/archivo`);
    }

    // Descargar archivo de documento como Blob (incluye token via interceptor)
    descargarArchivoDocumento(cursoId: number, documentoId: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/descargar`,
            { responseType: 'blob' }
        );
    }

    descargarArchivoDocumentoEventos(cursoId: number, documentoId: number): Observable<HttpEvent<Blob>> {
        return this.httpClient.get(
            `${this.baseUrl}/cursos/${cursoId}/documentos/${documentoId}/descargar`,
            { responseType: 'blob', observe: 'events', reportProgress: true }
        );
    }

    // Obtener documento como PDF para impresión (convierte Office → PDF automáticamente)
    imprimirDocumentoComoPDF(documentoId: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/documentos/${documentoId}/imprimir`,
            { responseType: 'blob' }
        );
    }

    // Obtener un archivo de Drive como PDF para impresión (por drive_file_id)
    imprimirArchivoDriveComoPDF(fileId: string, filename?: string, forceLandscape: boolean = false): Observable<Blob> {
        const safeFileId = encodeURIComponent(String(fileId || '').trim());
        const safeFilename = encodeURIComponent(String(filename || 'documento').trim());
        const landscape = forceLandscape ? '1' : '0';
        return this.httpClient.get(
            `${this.baseUrl}/drive/${safeFileId}/imprimir-pdf?filename=${safeFilename}&landscape=${landscape}`,
            { responseType: 'blob' }
        );
    }

    imprimirArchivoDriveComoPDFEventos(
        fileId: string,
        filename?: string,
        forceLandscape: boolean = false
    ): Observable<HttpEvent<Blob>> {
        const safeFileId = encodeURIComponent(String(fileId || '').trim());
        const safeFilename = encodeURIComponent(String(filename || 'documento').trim());
        const landscape = forceLandscape ? '1' : '0';
        return this.httpClient.get(
            `${this.baseUrl}/drive/${safeFileId}/imprimir-pdf?filename=${safeFilename}&landscape=${landscape}`,
            { responseType: 'blob', observe: 'events', reportProgress: true }
        );
    }

    // Descargar un archivo de Drive en su formato nativo (xlsx, pdf, png, etc.)
    descargarArchivoDrive(fileId: string, filename?: string): Observable<Blob> {
        const safeFileId = encodeURIComponent(String(fileId || '').trim());
        const safeFilename = encodeURIComponent(String(filename || 'archivo').trim());
        return this.httpClient.get(
            `${this.baseUrl}/drive/${safeFileId}/descargar?filename=${safeFilename}`,
            { responseType: 'blob' }
        );
    }

    descargarArchivoDriveEventos(fileId: string, filename?: string): Observable<HttpEvent<Blob>> {
        const safeFileId = encodeURIComponent(String(fileId || '').trim());
        const safeFilename = encodeURIComponent(String(filename || 'archivo').trim());
        return this.httpClient.get(
            `${this.baseUrl}/drive/${safeFileId}/descargar?filename=${safeFilename}`,
            { responseType: 'blob', observe: 'events', reportProgress: true }
        );
    }

    // Descargar constancia de empresa como Blob (incluye token via interceptor)
    descargarConstanciaBlob(rfc: string): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/empresas/${rfc}/constancia`,
            { responseType: 'blob' }
        );
    }

    // ============================================
    // PROTECCIÓN CIVIL
    // ============================================

    /**
     * Generar constancias y DC-3 TEMPORAL para empleado
     * (sin crear curso en BD ni guardar en Drive)
     * Usa SSE para progreso en tiempo real
     */
    generarConstanciasDC3Temporal(payload: {
        empleado: { nombre: string; curp: string; puesto: string };
        curso: { nombre: string; horas: string | number };
        instructor: { nombre: string; apellido_paterno?: string; apellido_materno?: string; instructor_id?: number };
        tipoDocumento?: 'constancia' | 'dc3' | 'ambos';
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/generar-constancias-temporal-empleado`, payload);
    }

    generarConstanciasDC3TemporalZip(payload: {
        empleado: {
            empleado_id?: number;
            empresa_id?: number;
            nombre: string;
            nombre_base?: string;
            apellido_paterno?: string;
            apellido_materno?: string;
            curp: string;
            puesto: string;
            departamento?: string;
        };
        curso: { curso_id?: number; nombre: string; horas: string | number };
        instructor: { nombre: string; apellido_paterno?: string; apellido_materno?: string; instructor_id?: number };
        tipoDocumento?: 'constancia' | 'dc3' | 'ambos';
        fecha?: string;
        empresa_id?: number;
    }): Observable<Blob> {
        return this.httpClient.post(`${this.baseUrl}/generar-constancias-temporal-empleado-zip`, payload, {
            responseType: 'blob'
        });
    }

    // Obtener empresas con conteo de documentos de PC
    obtenerEmpresasProteccionCivil(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas`);
    }

    // Obtener documentos de PC de una empresa
    obtenerDocumentosProteccionCivil(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentos`);
    }

    // Agregar documento de PC a una empresa
    agregarDocumentoProteccionCivil(empresaId: number, documento: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentos`, documento);
    }

    // Actualizar estatus de documento de PC
    actualizarEstatusDocumentoPC(empresaId: number, documentoId: number, estatus: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/proteccion-civil/documentos/${documentoId}/estatus`, { estatus });
    }

    // Guardar comentario en documento de PC
    guardarComentarioDocumentoPC(empresaId: number, documentoId: number, comentarios: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/proteccion-civil/documentos/${documentoId}/comentario`, { comentarios });
    }

    // Eliminar documento de PC
    eliminarDocumentoProteccionCivil(empresaId: number, documentoId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/proteccion-civil/documentos/${documentoId}`);
    }

    // Eliminar archivo de documento de PC (sin eliminar el documento asignado)
    eliminarArchivoProteccionCivil(empresaId: number, documentoId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentos/${documentoId}/archivo`);
    }

    // Eliminar un archivo específico de un requerimiento PC
    eliminarArchivoEspecificoProteccionCivil(empresaId: number, documentoId: number, archivoId: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentos/${documentoId}/archivos/${archivoId}`
        );
    }

    // Subir archivo de documento de PC
    subirArchivoProteccionCivil(formData: FormData): Observable<any> {
        const documentoId = formData.get('documento_id');
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/documentos/${documentoId}/archivo`, formData);
    }

    listarPcDocumentacionExtra(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentacion-extra`);
    }

    /**
     * Sube archivos a Documentación Extra.
     * @param items.carpetaRelativa Ruta bajo Documentación Extra ('' = raíz). Ej: "Planos" o "Planos/2024".
     */
    subirPcDocumentacionExtra(
        empresaId: number,
        items: Array<File | { file: File; carpetaRelativa?: string }>
    ): Observable<any> {
        const formData = new FormData();
        const carpetasRelativas: string[] = [];
        for (const item of items) {
            const file = item instanceof File ? item : item.file;
            const carpetaRelativa = item instanceof File ? '' : (item.carpetaRelativa || '');
            formData.append('archivos', file, file.name);
            carpetasRelativas.push(carpetaRelativa);
        }
        formData.append('carpetasRelativasJson', JSON.stringify(carpetasRelativas));
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentacion-extra`,
            formData
        );
    }

    descargarPcDocumentacionExtra(empresaId: number, id: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentacion-extra/${id}/archivo`,
            { responseType: 'blob' }
        );
    }

    eliminarPcDocumentacionExtra(empresaId: number, id: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentacion-extra/${id}`
        );
    }

    eliminarPcDocumentacionExtraCarpeta(empresaId: number, ruta: string): Observable<any> {
        return this.httpClient.request(
            'delete',
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentacion-extra/carpetas`,
            { body: { ruta } }
        );
    }

    prepararVistaPcDocumentacionExtra(empresaId: number, id: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/documentacion-extra/${id}/preparar-vista`,
            {}
        );
    }

    // Descargar archivo de documento de PC como Blob (desde Google Drive)
    descargarArchivoProteccionCivil(documentoId: number, archivoId?: number): Observable<Blob> {
        const params: any = {};
        if (archivoId) {
            params.archivo_id = String(archivoId);
        }
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/documentos/${documentoId}/descargar`,
            { params, responseType: 'blob' }
        );
    }

    /** Vista previa: convierte Office a PDF en servidor cuando aplica. */
    vistaPreviaArchivoProteccionCivil(documentoId: number, archivoId?: number): Observable<Blob> {
        const params: any = { preview: '1' };
        if (archivoId) {
            params.archivo_id = String(archivoId);
        }
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/documentos/${documentoId}/descargar`,
            { params, responseType: 'blob' }
        );
    }

    extraerDriveId(rawValue: unknown): string {
        const raw = String(rawValue || '').trim();
        if (!raw) return '';
        if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;

        const byIdParam = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        const byPath = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
        return byIdParam?.[1] || byPath?.[1] || '';
    }

    obtenerUrlDrivePreview(driveId: string): string {
        // Prefer the backend proxy which downloads the file server-side and serves it with proper headers.
        // This avoids CORS/permission issues when embedding images in <img>.
        return `${this.baseUrl}/drive-preview/${encodeURIComponent(driveId)}`;
    }

    private resolverUrlArchivoPublico(rawValue: string): string | null {
        if (!rawValue) return null;

        if (/^\/?(?:api\/)?uploads\//i.test(rawValue)) {
            const basePublicUrl = this.baseUrl.replace(/\/api\/?$/i, '');
            const normalizedPath = rawValue.replace(/^\/?api\//i, '/');
            return `${basePublicUrl}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
        }

        if (/^data:/i.test(rawValue)) {
            return rawValue;
        }

        return null;
    }

    resolverUrlDrivePreview(rawValue: unknown): string | null {
        const raw = String(rawValue || '').trim();
        if (!raw) return null;

        const driveId = this.extraerDriveId(raw);
        if (driveId) {
            return this.obtenerUrlDrivePreview(driveId);
        }

        const urlPublica = this.resolverUrlArchivoPublico(raw);
        if (urlPublica) {
            return urlPublica;
        }

        return raw.startsWith('http') ? raw : null;
    }

    // Obtener historial de documentos aprobados de PC de una empresa
    obtenerHistorialDocumentosPC(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/historial`);
    }

    // Eliminar documento del historial de PC
    eliminarHistorialDocumentoPC(historialId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/proteccion-civil/historial/${historialId}`);
    }

    // Eliminar texto capturado del historial de PC
    eliminarHistorialTextoPC(historialTextoId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/proteccion-civil/historial-textos/${historialTextoId}`);
    }

    // Reemplazar archivo en el historial de PC
    reemplazarHistorialDocumentoPC(historialId: number, formData: FormData): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/historial/${historialId}/reemplazar`, formData);
    }

    // Cancelar asignación de documento principal de PC (eliminar documento padre y sus hijos)
    cancelarAsignacionDocumentoPC(empresaId: number, documentoId: number | string): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/proteccion-civil/documentos/${documentoId}`);
    }

    // Guardar valor de texto de un documento de PC (tipo_entrada = 'texto')
    guardarTextoDocumentoPC(documentoId: number, valorTexto: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/proteccion-civil/documentos/${documentoId}/texto`, { valor_texto: valorTexto });
    }

    // Actualizar datos base de empresa para autollenado de textos en Protección Civil
    actualizarDatosCapturaEmpresaPC(empresaId: number, datos: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/datos-captura`, datos);
    }

    // Finalizar revisión: eliminar aprobados, conservar rechazados
    finalizarRevisionPC(empresaId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/finalizar-revision`, {});
    }

    obtenerCentroOperacionesPC(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones`);
    }

    guardarFechaCentroOperacionesPC(empresaId: number, campo: string, valor: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones/fechas`, { campo, valor });
    }

    guardarResponsablePipcEmpresa(empresaId: number, usuarioId: number | null): Observable<any> {
        return this.httpClient.put(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones/responsable-pipc`,
            { usuario_id: usuarioId }
        );
    }

    sincronizarResolutivosCentroOperacionesPC(empresaId: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones/sincronizar-resolutivos`,
            {}
        );
    }

    completarPasoCentroOperacionesPC(empresaId: number, paso: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones/completar-paso`, { paso });
    }

    desbloquearPasoCentroOperacionesPC(empresaId: number, paso: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones/desbloquear-paso`, { paso });
    }

    cerrarCicloCentroOperacionesPC(empresaId: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/centro-operaciones/cerrar-ciclo`, {});
    }

    obtenerRecorridoPC(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido`);
    }

    guardarRecorridoPipcPC(empresaId: number, documentoPipcId: number, datos: unknown): Observable<any> {
        return this.httpClient.put(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido/pipc/${documentoPipcId}`,
            { datos }
        );
    }

    subirImagenRecorridoPC(
        empresaId: number,
        documentoPipcId: number,
        payload: {
            campo: 'problema' | 'observaciones';
            item_index: number;
            slot_index?: number;
            reporte_folio?: string;
            imagen_base64: string;
            mime_type?: string;
            nombre_archivo?: string;
        }
    ): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido/pipc/${documentoPipcId}/imagen`,
            payload
        );
    }

    eliminarRecorridoPipcPC(empresaId: number, documentoPipcId: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido/pipc/${documentoPipcId}`
        );
    }

    establecerModoRecorridoPC(empresaId: number, modo: 'manual' | 'pdf'): Observable<any> {
        return this.httpClient.put(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido/modo`,
            { modo }
        );
    }

    subirPdfRecorridoPC(empresaId: number, documentoPipcId: number, archivo: File): Observable<any> {
        const formData = new FormData();
        formData.append('archivo', archivo);
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido/pipc/${documentoPipcId}/pdf`,
            formData
        );
    }

    eliminarPdfRecorridoPC(empresaId: number, pdfId: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/recorrido/pdf/${pdfId}`
        );
    }

    obtenerEmpresasHistorialPC(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/historial-pc/empresas`);
    }

    obtenerCiclosHistorialPC(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/historial-pc/ciclos`);
    }

    obtenerDetalleCicloHistorialPC(empresaId: number, operacionId: number): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/historial-pc/ciclos/${operacionId}`
        );
    }

    /** Contexto para modal SP-F-29 (empresa, responsable, asignación) */
    obtenerContextoResolutivoPC(empresaId: number, documentoAsignacionId?: number): Observable<any> {
        let url = `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/resolutivo-contexto`;
        if (documentoAsignacionId) {
            url += `?documento_asignacion_id=${documentoAsignacionId}`;
        }
        return this.httpClient.get(url);
    }

    /** Registrar fila en SP-F-29 (Google Sheets) y BD satélite SGC */
    registrarResolutivoPC(empresaId: number, payload: {
        documento_asignacion_id?: number;
        nombre_asignacion?: string;
        tipo_tramite: string;
        fecha_aprobacion: string;
        fecha_vencimiento: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/registrar-resolutivo`,
            payload
        );
    }

    listarResolutivosPC(empresaId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/empresas/${empresaId}/resolutivos`);
    }

    descargarControlResolutivosPdf(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/control-resolutivos/pdf`, {
            responseType: 'blob'
        });
    }

    descargarListadoEstatusPipcPdf(documentoPadreId: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/documentos/${documentoPadreId}/listado-estatus/pdf`,
            { responseType: 'blob' }
        );
    }

    descargarControlResolutivosExcel(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/control-resolutivos/excel`, {
            responseType: 'blob'
        });
    }

    obtenerEstadoControlResolutivosExcelDrive(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/control-resolutivos/excel/estado-drive`);
    }

    obtenerEstadisticasResolutivosPipc(anio?: number): Observable<any> {
        const params = anio ? `?anio=${anio}` : '';
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/control-resolutivos/estadisticas${params}`);
    }

    guardarControlResolutivosExcelDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/control-resolutivos/excel/guardar-drive`, {});
    }

    obtenerRegistrosControlResolutivos(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/control-resolutivos/registros`);
    }

    actualizarRegistroControlResolutivo(resolutivoId: number, payload: {
        empresa_id?: number | null;
        nombre_empresa?: string;
        tipo_tramite?: string | null;
        responsable?: string;
        responsable_usuario_id?: number | null;
        fecha_ingreso_tramite?: string | null;
        fecha_oficio_observaciones?: string | null;
        fecha_aprobacion?: string | null;
        fecha_vencimiento?: string | null;
        municipio?: string | null;
        estado?: string | null;
    }): Observable<any> {
        return this.httpClient.put(
            `${this.baseUrl}/proteccion-civil/control-resolutivos/registros/${resolutivoId}`,
            payload
        );
    }

    desactivarRegistroControlResolutivo(resolutivoId: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/control-resolutivos/registros/${resolutivoId}`
        );
    }

    // Obtener catálogo de Protección Civil (dinámico, desde BD proteccion_civil)
    obtenerCatalogoProteccionCivil(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/proteccion-civil/catalogo`);
    }

    // Sincronizar catálogo de Protección Civil contra Google Drive
    sincronizarCatalogoProteccionCivil(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/proteccion-civil/catalogo/sincronizar`, {});
    }

    // Crear categoría en catálogo de Protección Civil
    crearCategoriaCatalogoPC(nombre: string): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/catalogo/categorias`,
            { nombre }
        );
    }

    // Quitar categoría del catálogo de Protección Civil
    eliminarCategoriaCatalogoPC(categoriaId: string): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/catalogo/categorias/${encodeURIComponent(categoriaId)}`
        );
    }

    // Cambiar nombre de categoría del catálogo de Protección Civil
    actualizarCategoriaCatalogoPC(categoriaId: string, nombre: string): Observable<any> {
        return this.httpClient.put(
            `${this.baseUrl}/proteccion-civil/catalogo/categorias/${encodeURIComponent(categoriaId)}`,
            { nombre }
        );
    }

    // Descargar archivo de documento del catálogo de Protección Civil
    descargarArchivoCatalogoProteccionCivil(documentoId: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/${documentoId}/descargar`,
            { responseType: 'blob' }
        );
    }

    // Reemplazar archivo de catálogo de PC en Google Drive (mismo nombre, actualiza fecha)
    reemplazarArchivoCatalogoPC(documentoId: number, formData: FormData): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/${documentoId}/reemplazar`,
            formData
        );
    }

    // Subir nuevo documento al catálogo de PC (Drive + BD)
    subirDocumentoCatalogoPC(formData: FormData): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos`,
            formData
        );
    }

    // Crear formato del catálogo PC desde plantilla Google Sheets (PIPC)
    crearDocumentoCatalogoDesdePlantillaPC(payload: { categoria_id: string; nombre: string }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/desde-plantilla`,
            payload
        );
    }

    // Eliminar documento del catálogo de PC (elimina de Drive + BD)
    eliminarDocumentoCatalogoPC(documentoId: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/${documentoId}`
        );
    }

    // Asignar documentos del catálogo a una empresa (Backend descarga xlsx y parsea sub-documentos)
    obtenerItemsPlantillaPipc(documentoId: number): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/${documentoId}/plantilla-items`
        );
    }

    sincronizarAsignacionesDesdeCatalogoPC(documentoId: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/${documentoId}/sincronizar-asignaciones`,
            {}
        );
    }

    obtenerUrlEditorCatalogoPC(documentoId: number, modo: 'edit' | 'preview' = 'edit'): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/proteccion-civil/catalogo/documentos/${documentoId}/url-editor`,
            { params: { modo } }
        );
    }

    asignarDocumentosCatalogo(empresaId: number, documentos: any[], opciones?: { omitir_correo_empresa?: boolean }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/proteccion-civil/empresas/${empresaId}/asignar-catalogo`,
            {
                documentos,
                omitir_correo_empresa: opciones?.omitir_correo_empresa === true
            }
        );
    }

    // ============================================
    // EXPEDIENTES MÉDICOS - HISTORIAS CLÍNICAS
    // ============================================

    guardarHistoriaClinica(data: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/historias-clinicas`, data);
    }

    obtenerEmpresasExpedientes(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/historias-clinicas/empresas`);
    }

    obtenerEstadisticasExpedientes(empresaId?: number): Observable<any> {
        const params = empresaId ? `?empresa_id=${empresaId}` : '';
        return this.httpClient.get(`${this.baseUrl}/historias-clinicas/estadisticas${params}`);
    }

    obtenerHistoriasClinicas(filtros?: any): Observable<any> {
        let params = '';
        if (filtros) {
            const p = new URLSearchParams();
            if (filtros.instructor_id) p.set('instructor_id', filtros.instructor_id.toString());
            if (filtros.empresa_id) p.set('empresa_id', filtros.empresa_id.toString());
            if (filtros.matricula) p.set('matricula', filtros.matricula);
            if (filtros.nombre) p.set('nombre', filtros.nombre);
            if (filtros.tipo) p.set('tipo', filtros.tipo);
            params = '?' + p.toString();
        }
        return this.httpClient.get(`${this.baseUrl}/historias-clinicas${params}`);
    }

    actualizarHistoriaClinica(id: number, data: any): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/historias-clinicas/${id}`, data);
    }

    obtenerHistoriaClinica(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/historias-clinicas/${id}`);
    }

    eliminarHistoriaClinica(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/historias-clinicas/${id}`);
    }

    subirPdfExpedienteMedico(id: number, pdfBase64: string, nombreArchivo?: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/historias-clinicas/${id}/subir-pdf`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo
        });
    }

    obtenerEstadoAuthDrive(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/drive/auth-status`);
    }

    obtenerAvisoPrivacidadEmpresa(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/empresa/aviso-privacidad`);
    }

    // ============================================
    // PERFIL — Feedback instructores / Doctor resumen
    // ============================================

    obtenerFeedbackInstructor(instructorId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/instructores/${instructorId}/feedback`);
    }

    obtenerRendimientoInstructores(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/admin/instructores-rendimiento`);
    }

    obtenerPerfilDoctor(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/doctor/perfil`);
    }

    obtenerResumenDoctor(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/doctor/resumen`);
    }

    // ── Reporte de Salud (Google Slides) ──
    generarReporteSaludSlides(datos: any): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/expedientes-medicos/generar-reporte-slides`, datos);
    }

    // ============================================
    // SISTEMA DE GESTIÓN DE CALIDAD (BD biznaga_sgc)
    // ============================================

    obtenerEstadoBiznagaSgc(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/estado-db`);
    }

    obtenerMiPermisoEditorSgc(formatoCodigo?: string): Observable<any> {
        const formato = String(formatoCodigo || '').trim().toLowerCase();
        const params = formato ? `?formato=${encodeURIComponent(formato)}` : '';
        return this.httpClient.get(`${this.baseUrl}/sgc/editores-delegados/mi-permiso${params}`);
    }

    obtenerEditoresDelegadosSgc(formatoCodigo: string): Observable<any> {
        const formato = String(formatoCodigo || '').trim().toLowerCase();
        return this.httpClient.get(
            `${this.baseUrl}/sgc/editores-delegados?formato=${encodeURIComponent(formato)}`
        );
    }

    guardarEditoresDelegadosSgc(formatoCodigo: string, usuarioIds: number[]): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/sgc/editores-delegados`, {
            formato_codigo: String(formatoCodigo || '').trim().toLowerCase(),
            usuario_ids: usuarioIds
        });
    }

    cargarDgF01Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-01`);
    }

    guardarDgF01Formato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-01/guardar`, {
            datos,
            origen: 'sistema'
        });
    }

    obtenerImagenDgF01Mapa(version?: number | string | null): Observable<Blob> {
        const query = version != null && version !== '' ? `?v=${encodeURIComponent(String(version))}` : '';
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-01/imagen${query}`, {
            responseType: 'blob'
        });
    }

    subirImagenMapaDgF01(imagenBase64: string, mimeType: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-01/subir-imagen`, {
            imagen_base64: imagenBase64,
            mime_type: mimeType
        });
    }

    subirPdfFirmadoDgF01(pdfBase64: string, nombreArchivo: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-01/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo
        });
    }

    cargarDgF02Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-02`);
    }

    guardarDgF02Formato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-02/guardar`, {
            datos,
            origen: 'sistema'
        });
    }

    subirPdfFirmadoDgF02(pdfBase64: string, nombreArchivo: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-02/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo
        });
    }

    descargarPlantillaDgF02Pdf(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-02/descargar-plantilla-pdf`, {
            responseType: 'blob'
        });
    }

    cargarDgF04Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-04`);
    }

    guardarDgF04Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-04/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarDgF04DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-04/sincronizar-drive`, {});
    }

    actualizarPlantillaDgF04(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-04/actualizar-plantilla`, {});
    }

    cargarDgF05Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-05`);
    }

    cargarSgcF07Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-07`);
    }

    guardarSgcF07Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-07/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF07DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-07/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF07(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-07/actualizar-plantilla`, {});
    }

    cargarSgcF08Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-08`);
    }

    guardarSgcF08Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-08/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF08DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-08/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF08(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-08/actualizar-plantilla`, {});
    }

    cargarSgcF10Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-10`);
    }

    guardarSgcF10Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-10/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    guardarHistoricoSgcF10Formato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-10/guardar-historico`, {
            datos,
            origen: 'sistema'
        });
    }

    listarHistorialSgcF10(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-10/historial`);
    }

    sincronizarSgcF10DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-10/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF10(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-10/actualizar-plantilla`, {});
    }

    /** Formatos limpios (página /formatos): IDs activos tras reemplazos versionados. */
    obtenerFormatosDescargaActivosSgc(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos-descarga/activos`);
    }

    subirFormatoDescargaSgc(formData: FormData): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos-descarga/subir`, formData);
    }

    desactivarFormatoDescargaSgc(catalogKey: string, codigo: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos-descarga/desactivar`, {
            catalog_key: catalogKey,
            codigo
        });
    }

    eliminarFormatoDescargaSgc(catalogKey: string, codigo: string, driveFileId: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos-descarga/eliminar`, {
            catalog_key: catalogKey,
            codigo,
            drive_file_id: driveFileId
        });
    }

    reemplazarFormatoDescargaSgc(formData: FormData): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos-descarga/reemplazar`, formData);
    }

    historialFormatoDescargaSgc(catalogKey: string): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/sgc/formatos-descarga/${encodeURIComponent(catalogKey)}/historial`
        );
    }

    listarSgcNormativas(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/normativas`);
    }

    // ── Seguridad · Catálogo normativas (BD normativas) ──
    listarSeguridadNormativas(busqueda?: string, categoria?: string): Observable<any> {
        const params = new URLSearchParams();
        if (busqueda) params.set('busqueda', busqueda);
        if (categoria) params.set('categoria', categoria);
        const qs = params.toString();
        return this.httpClient.get(`${this.baseUrl}/seguridad/normativas${qs ? `?${qs}` : ''}`);
    }

    obtenerSeguridadNormativa(id: number, busqueda?: string): Observable<any> {
        const qs = busqueda ? `?busqueda=${encodeURIComponent(busqueda)}` : '';
        return this.httpClient.get(`${this.baseUrl}/seguridad/normativas/${id}${qs}`);
    }

    importarSeguridadNormativa(archivo: File): Observable<any> {
        const formData = new FormData();
        formData.append('archivo', archivo, archivo.name);
        return this.httpClient.post(`${this.baseUrl}/seguridad/normativas/importar`, formData);
    }

    eliminarSeguridadNormativa(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/seguridad/normativas/${id}`);
    }

    actualizarSeguridadNormativa(id: number, datos: { titulo: string }): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/seguridad/normativas/${id}`, datos);
    }

    actualizarSeguridadRequisito(normativaId: number, requisitoId: number, datos: Record<string, unknown>): Observable<any> {
        return this.httpClient.put(
            `${this.baseUrl}/seguridad/normativas/${normativaId}/requisitos/${requisitoId}`,
            datos
        );
    }

    reemplazarSgcNormativa(fileId: string, formData: FormData): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/sgc/normativas/${encodeURIComponent(fileId)}/reemplazar`,
            formData
        );
    }

    cargarSgcF05Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-05`);
    }

    guardarSgcF05Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-05/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF05DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-05/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF05(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-05/actualizar-plantilla`, {});
    }

    registrarQuejaSgcF05(registro: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-05/registro`, { registro });
    }

    cargarSgcF14Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-14`);
    }

    guardarSgcF14Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-14/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF14DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-14/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF14(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-14/actualizar-plantilla`, {});
    }

    cargarSgcF16Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-16`);
    }

    guardarSgcF16Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-16/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF16DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-16/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF16(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-16/actualizar-plantilla`, {});
    }

    subirPdfFirmadoSgcF16(pdfBase64: string, nombreArchivo: string, minutaId: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-16/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo,
            minutaId
        });
    }

    descargarPdfSgcF16(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-16/descargar-pdf`, {
            responseType: 'blob'
        });
    }

    cargarSgcF29Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-29`);
    }

    guardarSgcF29Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-29/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF29DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-29/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF29(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-29/actualizar-plantilla`, {});
    }

    listarEvidenciasSgcF29(evaluacionId: string): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/sgc/formatos/sgc-f-29/evidencias/${encodeURIComponent(evaluacionId)}`
        );
    }

    contarEvidenciasSgcF29(ids: string[]): Observable<any> {
        const q = (ids || []).filter(Boolean).join(',');
        return this.httpClient.get(
            `${this.baseUrl}/sgc/formatos/sgc-f-29/evidencias/conteos`,
            { params: { ids: q } }
        );
    }

    subirEvidenciaSgcF29(payload: {
        evaluacion_id: string;
        proveedor?: string;
        referencia?: string;
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-29/evidencias/subir`, payload);
    }

    subirEvidenciasLoteSgcF29(payload: {
        evaluacion_id: string;
        proveedor?: string;
        referencia?: string;
        archivos: Array<{
            nombre_archivo: string;
            mime_type?: string;
            archivo_base64: string;
        }>;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-29/evidencias/subir-lote`, payload);
    }

    eliminarEvidenciaSgcF29(id: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/sgc/formatos/sgc-f-29/evidencias/documento/${id}`
        );
    }

    urlArchivoEvidenciaSgcF29(id: number): string {
        return `${this.baseUrl}/sgc/formatos/sgc-f-29/evidencias/documento/${id}/archivo`;
    }

    cargarSgcF28Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-28`);
    }

    guardarSgcF28Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-28/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF28DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-28/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF28(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-28/actualizar-plantilla`, {});
    }

    cargarSpF02Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sp-f-02`);
    }

    guardarSpF02Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sp-f-02/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSpF02DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sp-f-02/sincronizar-drive`, {});
    }

    actualizarPlantillaSpF02(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sp-f-02/actualizar-plantilla`, {});
    }

    subirImagenSpF02(payload: {
        campo: 'problema' | 'observaciones';
        item_index: number;
        slot_index?: number;
        reporte_folio?: string;
        imagen_base64: string;
        mime_type?: string;
        nombre_archivo?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sp-f-02/imagen`, payload);
    }

    cargarAthF08Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/ath-f-08`);
    }

    guardarAthF08Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-08/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarAthF08DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-08/sincronizar-drive`, {});
    }

    actualizarPlantillaAthF08(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-08/actualizar-plantilla`, {});
    }

    cargarAthF02Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/ath-f-02`);
    }

    guardarAthF02Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-02/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarAthF02DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-02/sincronizar-drive`, {});
    }

    actualizarPlantillaAthF02(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-02/actualizar-plantilla`, {});
    }

    subirPdfFirmadoAthF02(pdfBase64: string, nombreArchivo: string, perfilId: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-02/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo,
            perfilId
        });
    }

    cargarAthF09Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/ath-f-09`);
    }

    guardarAthF09Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-09/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarAthF09DesdeDrive(cotizacionActivaId?: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-09/sincronizar-drive`, {
            cotizacionActivaId: cotizacionActivaId || null
        });
    }

    actualizarPlantillaAthF09(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-09/actualizar-plantilla`, {});
    }

    subirPdfFirmadoAthF09(
        pdfBase64: string,
        nombreArchivo: string,
        cotizacionId: string,
        folioPropuesto?: string
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-09/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo,
            cotizacionId,
            folioPropuesto: folioPropuesto || null
        });
    }

    cargarAthF11Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/ath-f-11`);
    }

    guardarAthF11Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-11/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarAthF11DesdeDrive(evaluacionActivaId?: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-11/sincronizar-drive`, {
            evaluacionActivaId: evaluacionActivaId || null
        });
    }

    actualizarPlantillaAthF11(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-11/actualizar-plantilla`, {});
    }

    descargarPdfAthF11(evaluacionId: string): Observable<Blob> {
        const params = evaluacionId
            ? `?evaluacionId=${encodeURIComponent(evaluacionId)}`
            : '';
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/ath-f-11/descargar-pdf${params}`, {
            responseType: 'blob'
        });
    }

    subirPdfFirmadoAthF11(
        pdfBase64: string,
        nombreArchivo: string,
        evaluacionId: string
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/ath-f-11/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo,
            evaluacionId
        });
    }

    // ============================================
    // SGC — Dashboard de Calidad (indicadores)
    // ============================================

    obtenerDashboardSgc(anio?: number, refrescar = false): Observable<any> {
        const params: any = {};
        if (anio) params.anio = String(anio);
        if (refrescar) params.refrescar = '1';
        return this.httpClient.get(`${this.baseUrl}/sgc/dashboard`, { params });
    }

    crearAuditoriaSgc(datos: {
        titulo: string;
        fecha?: string | null;
        anio?: number;
        area?: string;
        no_conformidades: number;
        observaciones?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/auditorias`, datos);
    }

    eliminarAuditoriaSgc(auditoriaId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/sgc/auditorias/${auditoriaId}`);
    }

    crearQuejaSgc(datos: {
        cliente: string;
        fecha?: string | null;
        anio?: number;
        descripcion?: string;
        estatus?: string;
        area?: string;
        fecha_cierre?: string | null;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/quejas`, datos);
    }

    eliminarQuejaSgc(quejaId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/sgc/quejas/${quejaId}`);
    }

    crearEvaluacionProveedorSgc(datos: {
        proveedor: string;
        fecha?: string | null;
        anio?: number;
        calificacion: number;
        observaciones?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/evaluaciones-proveedor`, datos);
    }

    eliminarEvaluacionProveedorSgc(evaluacionId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/sgc/evaluaciones-proveedor/${evaluacionId}`);
    }

    obtenerDashboardControlProyectos(empresaId?: number | string): Observable<any> {
        const query = empresaId ? `?empresaId=${empresaId}` : '';
        return this.httpClient.get(`${this.baseUrl}/control-proyectos/dashboard${query}`);
    }

    listarControlProyectos(empresaId?: number | string): Observable<any> {
        const query = empresaId ? `?empresaId=${empresaId}` : '';
        return this.httpClient.get(`${this.baseUrl}/control-proyectos/proyectos${query}`);
    }

    guardarControlProyectos(proyectos: Array<{
        id?: number;
        folio?: string;
        empresaId?: number | null;
        empresaNombre?: string;
        nombreProyecto?: string;
        item?: string;
        condicionRequerimiento?: string;
        actividadesAccion?: string;
        referenciaNormativa?: string;
        responsable?: string;
        responsableUsuarioIds?: number[];
        fechaInicio?: string;
        fechaCompromiso?: string;
        entregables?: string;
        prioridad?: string;
        estatus?: string;
        avance?: number | string;
    }>, empresaId?: number | null): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/proyectos/guardar`, { proyectos, empresaId });
    }

    crearControlProyecto(proyecto: {
        folio?: string;
        empresaId?: number | null;
        empresaNombre?: string;
        nombreProyecto: string;
        item?: string;
        condicionRequerimiento?: string;
        actividadesAccion?: string;
        referenciaNormativa?: string;
        responsable?: string;
        responsableUsuarioIds?: number[];
        fechaInicio?: string;
        fechaCompromiso?: string;
        entregables?: string;
        prioridad?: string;
        estatus?: string;
        avance?: number | string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/proyectos/crear`, proyecto);
    }

    refrescarControlProyectosDesdeBd(empresaId?: number | string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/refrescar-bd`, { empresaId });
    }

    actualizarPlantillaControlProyectos(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/actualizar-plantilla`, {});
    }

    listarControlProyectosEliminados(empresaId?: number | string): Observable<any> {
        const query = empresaId ? `?empresaId=${empresaId}` : '';
        return this.httpClient.get(`${this.baseUrl}/control-proyectos/eliminados${query}`);
    }

    desactivarControlProyectos(ids: number[], empresaId?: number | null): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/eliminados/desactivar`, {
            ids,
            empresaId
        });
    }

    desactivarProyectoControlProyectos(ids: number[], empresaId?: number | null): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/proyectos/desactivar`, {
            ids,
            empresaId
        });
    }

    restaurarControlProyectosEliminados(body: {
        ids?: number[];
        proyecto?: {
            empresaId?: number | null;
            folio?: string;
            nombreProyecto?: string;
        };
        empresaId?: number | null;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/control-proyectos/eliminados/restaurar`, body || {});
    }

    // ============================================
    // SENSORES IoT (Blynk)
    // ============================================

    obtenerEstadoSensores(): Observable<{
        success: boolean;
        configured?: boolean;
        deviceName?: string;
        connected?: boolean | null;
        volume?: number | null;
        altura?: number | null;
        range?: number | null;
        pins?: { volume?: string; altura?: string; range?: string };
        datastreams?: Array<{ pin: string; value: number | string | null; role?: string | null }>;
        diagnostics?: Record<string, unknown>;
        updatedAt?: string;
        message?: string;
        code?: string;
        partialErrors?: Record<string, string>;
    }> {
        return this.httpClient.get<{
            success: boolean;
            configured?: boolean;
            deviceName?: string;
            connected?: boolean | null;
            volume?: number | null;
            altura?: number | null;
            range?: number | null;
            pins?: { volume?: string; altura?: string; range?: string };
            datastreams?: Array<{ pin: string; value: number | string | null; role?: string | null }>;
            diagnostics?: Record<string, unknown>;
            updatedAt?: string;
            message?: string;
            code?: string;
            partialErrors?: Record<string, string>;
        }>(`${this.baseUrl}/sensores/estado`);
    }

    obtenerHistorialSensores(limit = 48): Observable<{
        success: boolean;
        intervaloMs?: number;
        ultima?: Record<string, unknown> | null;
        lecturas?: Array<Record<string, unknown>>;
    }> {
        return this.httpClient.get<{
            success: boolean;
            intervaloMs?: number;
            ultima?: Record<string, unknown> | null;
            lecturas?: Array<Record<string, unknown>>;
        }>(`${this.baseUrl}/sensores/historial`, { params: { limit: String(limit) } });
    }

    guardarDgF05Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-05/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarDgF05DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-05/sincronizar-drive`, {});
    }

    actualizarPlantillaDgF05(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-05/actualizar-plantilla`, {});
    }

    cargarDgF07Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-07`);
    }

    guardarDgF07Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-07/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarDgF07DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-07/sincronizar-drive`, {});
    }

    actualizarPlantillaDgF07(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-07/actualizar-plantilla`, {});
    }

    cargarSgcF18Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-18`);
    }

    guardarSgcF18Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-18/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF18DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-18/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF18(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-18/actualizar-plantilla`, {});
    }

    cargarSgcF06Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-06`);
    }

    guardarSgcF06Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-06/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF06DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-06/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF06(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-06/actualizar-plantilla`, {});
    }

    cargarSgcPo01Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-po-01`);
    }

    guardarSgcPo01Formato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-po-01/guardar`, {
            datos,
            origen: 'sistema'
        });
    }

    subirPdfFirmadoSgcPo01(pdfBase64: string, nombreArchivo: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-po-01/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo
        });
    }

    descargarPlantillaSgcPo01Pdf(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-po-01/descargar-plantilla-pdf`, {
            responseType: 'blob'
        });
    }

    cargarDgF08Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-08`);
    }

    guardarDgF08Formato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-08/guardar`, {
            datos,
            origen: 'sistema'
        });
    }

    subirPdfFirmadoDgF08(pdfBase64: string, nombreArchivo: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-08/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo
        });
    }

    descargarPlantillaDgF08Pdf(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-08/descargar-plantilla-pdf`, {
            responseType: 'blob'
        });
    }

    cargarSgcF11Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-11`);
    }

    guardarSgcF11Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-11/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF11DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-11/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF11(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-11/actualizar-plantilla`, {});
    }

    cargarSgcF01Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-01`);
    }

    guardarSgcF01Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-01/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    actualizarDocumentoSgcF01(documento: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-01/documento`, {
            documento
        });
    }

    listarCodigosNoVigentesSgcF01(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-01/no-vigentes`);
    }

    sincronizarSgcF01DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-01/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF01(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-01/actualizar-plantilla`, {});
    }

    cargarSgcF02Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-02`);
    }

    guardarSgcF02Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-02/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF02DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-02/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF02(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-02/actualizar-plantilla`, {});
    }

    listarDocumentosFisicosSgcF02(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-02/documentos-fisicos`);
    }

    subirDocumentosFisicosSgcF02(archivos: File[]): Observable<any> {
        const formData = new FormData();
        (archivos || []).forEach((file) => formData.append('archivos', file, file.name));
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-02/documentos-fisicos`, formData);
    }

    eliminarDocumentoFisicoSgcF02(fileId: string): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/sgc/formatos/sgc-f-02/documentos-fisicos/${encodeURIComponent(fileId)}`
        );
    }

    obtenerCatalogoDocumentosSgcSolicitud(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/solicitud-documentos/catalogo`);
    }

    crearSolicitudDocumentoSgc(payload: {
        nombreDocumento?: string;
        codigo?: string;
        versionActual?: string;
        tipoDocumento?: string;
        tipoSolicitud: string;
        motivo: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/solicitud-documentos`, payload);
    }

    obtenerSolicitudesDocumentosSgc(estado?: string): Observable<any> {
        const q = estado ? `?estado=${encodeURIComponent(estado)}` : '';
        return this.httpClient.get(`${this.baseUrl}/sgc/solicitud-documentos${q}`);
    }

    actualizarSolicitudDocumentoSgc(id: number, estado: string): Observable<any> {
        return this.httpClient.patch(`${this.baseUrl}/sgc/solicitud-documentos/${id}`, { estado });
    }

    obtenerContextoSolicitudDocumentoSgc(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/solicitud-documentos/${id}/contexto`);
    }

    autorizarSolicitudDocumentoSgc(id: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/solicitud-documentos/${id}/autorizar`, {});
    }

    reemplazarFormatoSolicitudDocumentoSgc(id: number, formData: FormData): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/sgc/solicitud-documentos/${id}/reemplazar-formato`,
            formData
        );
    }

    marcarFormatoListoSolicitudDocumentoSgc(id: number, payload?: {
        catalogKey?: string;
        driveFileId?: string;
        versionNueva?: string;
        fechaRevisionNueva?: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/sgc/solicitud-documentos/${id}/formato-listo`,
            payload || {}
        );
    }

    actualizarListaMaestraSolicitudDocumentoSgc(id: number, documento: Record<string, unknown>): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/sgc/solicitud-documentos/${id}/lista-maestra`,
            documento
        );
    }

    cerrarSolicitudDocumentoSgc(id: number, payload: {
        notificar: boolean;
        descripcion?: string;
    }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/sgc/solicitud-documentos/${id}/cerrar`,
            payload
        );
    }

    regresarPasoSolicitudDocumentoSgc(id: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/sgc/solicitud-documentos/${id}/regresar`,
            {}
        );
    }

    cargarSgcF12Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-12`);
    }

    guardarSgcF12Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-12/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF12DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-12/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF12(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-12/actualizar-plantilla`, {});
    }

    cargarSgcF04Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/sgc-f-04`);
    }

    guardarSgcF04Formato(datos: unknown, editorActivo = false): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-04/guardar`, {
            datos,
            origen: 'sistema',
            editorActivo
        });
    }

    sincronizarSgcF04DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-04/sincronizar-drive`, {});
    }

    actualizarPlantillaSgcF04(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-04/actualizar-plantilla`, {});
    }

    subirPdfFirmadoSgcF04(pdfBase64: string, nombreArchivo: string, reporteId: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/sgc-f-04/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo,
            reporteId
        });
    }

    cargarDgF03Formato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-03`);
    }

    guardarDgF03Formato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-03/guardar`, {
            datos,
            origen: 'sistema'
        });
    }

    subirPdfFirmadoDgF03(pdfBase64: string, nombreArchivo: string): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/dg-f-03/subir-pdf-firmado`, {
            pdf_base64: pdfBase64,
            nombre_archivo: nombreArchivo
        });
    }

    descargarPlantillaDgF03Pdf(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/dg-f-03/descargar-plantilla-pdf`, {
            responseType: 'blob'
        });
    }

    cargarMetodologiaAmefFormato(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/formatos/metodologia-amef`);
    }

    guardarMetodologiaAmefFormato(datos: unknown): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/metodologia-amef/guardar`, {
            datos,
            origen: 'sistema'
        });
    }

    importarMetodologiaAmefDesdePlantilla(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/formatos/metodologia-amef/importar-plantilla`, {});
    }

    listarSgcProcedimientos(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/procedimientos`);
    }

    subirSgcProcedimiento(payload: {
        codigo: string;
        titulo: string;
        categoria_id: string;
        nombre_archivo?: string;
        mime_type?: string;
        archivo_base64: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/procedimientos/subir`, payload);
    }

    reemplazarSgcProcedimiento(
        id: number,
        payload: {
            nombre_archivo?: string;
            mime_type?: string;
            archivo_base64: string;
            titulo?: string;
        }
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/procedimientos/${id}/reemplazar`, payload);
    }

    listarSgcInstructivos(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/instructivos`);
    }

    subirSgcInstructivo(payload: {
        codigo: string;
        titulo: string;
        categoria_id: string;
        nombre_archivo?: string;
        mime_type?: string;
        archivo_base64: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/instructivos/subir`, payload);
    }

    reemplazarSgcInstructivo(
        id: number,
        payload: {
            nombre_archivo?: string;
            mime_type?: string;
            archivo_base64: string;
            titulo?: string;
        }
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/instructivos/${id}/reemplazar`, payload);
    }

    listarSgcDocumentacionExtra(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/documentacion-extra`);
    }

    /** Buscador global del navbar (documentos/registros por módulo y rol). */
    buscarGlobalSistema(q: string): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/busqueda-global`, {
            params: { q: String(q || '').trim() }
        });
    }

    crearSgcDocumentacionExtraCarpeta(payload: {
        nombre: string;
        carpeta_padre?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/documentacion-extra/carpetas`, payload);
    }

    eliminarSgcDocumentacionExtraCarpeta(ruta: string): Observable<any> {
        return this.httpClient.request('delete', `${this.baseUrl}/sgc/documentacion-extra/carpetas`, {
            body: { ruta }
        });
    }

    moverSgcDocumentacionExtra(id: number, carpeta_relativa: string): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/sgc/documentacion-extra/${id}/mover`, {
            carpeta_relativa
        });
    }

    subirSgcDocumentacionExtra(payload: {
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
        carpeta_relativa?: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/documentacion-extra/subir`, payload);
    }

    subirSgcDocumentacionExtraLote(archivos: {
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
        carpeta_relativa?: string;
    }[]): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/documentacion-extra/subir-lote`, { archivos });
    }

    descargarSgcDocumentacionExtra(id: number): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/sgc/documentacion-extra/${id}/archivo`, {
            responseType: 'blob'
        });
    }

    miniaturaSgcDocumentacionExtra(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/sgc/documentacion-extra/${id}/miniatura`);
    }

    eliminarSgcDocumentacionExtra(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/sgc/documentacion-extra/${id}`);
    }

    prepararVistaSgcDocumentacionExtra(id: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/sgc/documentacion-extra/${id}/preparar-vista`, {});
    }

    // =====================================================
    // Módulo Ambiental (SP-F-15 / SP-F-28)
    // =====================================================

    listarAmbientalOficios(busqueda?: string): Observable<any> {
        const params = busqueda ? `?busqueda=${encodeURIComponent(busqueda)}` : '';
        return this.httpClient.get(`${this.baseUrl}/ambiental/oficios${params}`);
    }

    crearAmbientalOficio(payload: { numero_oficio: number; empresa: string; motivo: string }, anexo?: File | null): Observable<any> {
        return this.guardarAmbientalOficioFormData(null, payload, anexo);
    }

    actualizarAmbientalOficio(oficioId: number, payload: { numero_oficio: number; empresa: string; motivo: string }, anexo?: File | null): Observable<any> {
        return this.guardarAmbientalOficioFormData(oficioId, payload, anexo);
    }

    private guardarAmbientalOficioFormData(
        oficioId: number | null,
        payload: { numero_oficio: number; empresa: string; motivo: string },
        anexo?: File | null
    ): Observable<any> {
        const formData = new FormData();
        formData.append('numero_oficio', String(payload.numero_oficio));
        formData.append('empresa', payload.empresa);
        formData.append('motivo', payload.motivo);
        if (anexo) {
            formData.append('anexo', anexo, anexo.name);
        }
        if (oficioId) {
            return this.httpClient.put(`${this.baseUrl}/ambiental/oficios/${oficioId}`, formData);
        }
        return this.httpClient.post(`${this.baseUrl}/ambiental/oficios`, formData);
    }

    eliminarAmbientalOficio(oficioId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/ambiental/oficios/${oficioId}`);
    }

    listarAmbientalTramites(filtros?: { busqueda?: string; estatus?: string; responsable?: string; empresa_id?: number | null; empresa_nombre?: string }): Observable<any> {
        const params = new URLSearchParams();
        if (filtros?.busqueda) params.set('busqueda', filtros.busqueda);
        if (filtros?.estatus) params.set('estatus', filtros.estatus);
        if (filtros?.responsable) params.set('responsable', filtros.responsable);
        if (filtros?.empresa_id !== undefined && filtros?.empresa_id !== null) {
            params.set('empresa_id', String(filtros.empresa_id));
        }
        if (filtros?.empresa_nombre) params.set('empresa_nombre', filtros.empresa_nombre);
        const qs = params.toString();
        return this.httpClient.get(`${this.baseUrl}/ambiental/tramites${qs ? `?${qs}` : ''}`);
    }

    listarAmbientalEmpresasConTramites(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/ambiental/tramites/empresas-con-registros`);
    }

    listarAmbientalTramiteArchivos(tramiteId: number, ambito: 'documento' | 'contestacion'): Observable<any> {
        return this.httpClient.get(
            `${this.baseUrl}/ambiental/tramites/${tramiteId}/archivos`,
            { params: { ambito } }
        );
    }

    subirAmbientalTramiteArchivos(
        tramiteId: number,
        ambito: 'documento' | 'contestacion',
        items: Array<{ file: File; carpetaRelativa?: string }>
    ): Observable<any> {
        const formData = new FormData();
        formData.append('ambito', ambito);
        const carpetas: string[] = [];
        for (const item of items) {
            formData.append('archivos', item.file, item.file.name);
            carpetas.push(item.carpetaRelativa || '');
        }
        formData.append('carpetasRelativasJson', JSON.stringify(carpetas));
        return this.httpClient.post(
            `${this.baseUrl}/ambiental/tramites/${tramiteId}/archivos`,
            formData
        );
    }

    descargarAmbientalTramiteArchivo(tramiteId: number, archivoId: number): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/ambiental/tramites/${tramiteId}/archivos/${archivoId}/archivo`,
            { responseType: 'blob' }
        );
    }

    eliminarAmbientalTramiteArchivo(tramiteId: number, archivoId: number): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/ambiental/tramites/${tramiteId}/archivos/${archivoId}`
        );
    }

    prepararVistaAmbientalTramiteArchivo(tramiteId: number, archivoId: number): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/ambiental/tramites/${tramiteId}/archivos/${archivoId}/preparar-vista`,
            {}
        );
    }

    crearAmbientalTramite(
        payload: Record<string, unknown>,
        anexo?: File | null,
        contestacion?: File | null
    ): Observable<any> {
        return this.guardarAmbientalTramiteFormData(null, payload, anexo, contestacion);
    }

    actualizarAmbientalTramite(
        tramiteId: number,
        payload: Record<string, unknown>,
        anexo?: File | null,
        contestacion?: File | null
    ): Observable<any> {
        return this.guardarAmbientalTramiteFormData(tramiteId, payload, anexo, contestacion);
    }

    private guardarAmbientalTramiteFormData(
        tramiteId: number | null,
        payload: Record<string, unknown>,
        anexo?: File | null,
        contestacion?: File | null
    ): Observable<any> {
        const formData = new FormData();
        Object.keys(payload).forEach((key) => {
            const value = payload[key];
            if (value === undefined || value === null) {
                formData.append(key, '');
            } else {
                formData.append(key, String(value));
            }
        });
        if (anexo) {
            formData.append('anexo', anexo, anexo.name);
        }
        if (contestacion) {
            formData.append('contestacion', contestacion, contestacion.name);
        }
        if (tramiteId) {
            return this.httpClient.put(`${this.baseUrl}/ambiental/tramites/${tramiteId}`, formData);
        }
        return this.httpClient.post(`${this.baseUrl}/ambiental/tramites`, formData);
    }

    eliminarAmbientalTramite(tramiteId: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/ambiental/tramites/${tramiteId}`);
    }

    obtenerAmbientalSpF15EstadoDrive(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/ambiental/sp-f-15/estado-drive`);
    }

    guardarAmbientalSpF15Drive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/ambiental/sp-f-15/guardar-drive`, {});
    }

    sincronizarAmbientalSpF15DesdeDrive(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/ambiental/sp-f-15/sincronizar-drive`, {});
    }

    obtenerAmbientalSpF28EstadoDrive(empresaId?: number | null, empresaNombre?: string): Observable<any> {
        const params = new URLSearchParams();
        if (empresaId !== undefined && empresaId !== null) params.set('empresa_id', String(empresaId));
        if (empresaNombre) params.set('empresa_nombre', empresaNombre);
        const qs = params.toString();
        return this.httpClient.get(`${this.baseUrl}/ambiental/sp-f-28/estado-drive${qs ? `?${qs}` : ''}`);
    }

    guardarAmbientalSpF28Drive(
        tramites?: Record<string, unknown>[],
        meta?: { nombre_empresa?: string; nombre_consultor?: string },
        empresaId?: number | null
    ): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/ambiental/sp-f-28/guardar-drive`, {
            tramites: tramites || [],
            meta: meta || null,
            empresa_id: empresaId ?? null
        });
    }

    sincronizarAmbientalSpF28DesdeDrive(empresaId?: number | null): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/ambiental/sp-f-28/sincronizar-drive`, {
            empresa_id: empresaId ?? null
        });
    }

    // =====================================================
    // Recursos Humanos — Residentes
    // =====================================================

    listarRrhhResidentes(filtros?: { anio?: number | string; q?: string }): Observable<any> {
        const params = new URLSearchParams();
        if (filtros?.anio !== undefined && filtros?.anio !== null && filtros?.anio !== '') {
            params.set('anio', String(filtros.anio));
        }
        if (filtros?.q) params.set('q', filtros.q);
        const qs = params.toString();
        return this.httpClient.get(`${this.baseUrl}/rrhh/residentes${qs ? `?${qs}` : ''}`);
    }

    obtenerRrhhResidente(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/rrhh/residentes/${id}`);
    }

    crearRrhhResidente(payload: Record<string, unknown>): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/rrhh/residentes`, payload);
    }

    actualizarRrhhResidente(id: number, payload: Record<string, unknown>): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/rrhh/residentes/${id}`, payload);
    }

    eliminarRrhhResidente(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/rrhh/residentes/${id}`);
    }

    sincronizarRrhhResidenteDrive(id: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/rrhh/residentes/${id}/sincronizar-drive`, {});
    }

    // =====================================================
    // Recursos Humanos — Colaboradores (expediente Drive)
    // =====================================================

    listarRrhhColaboradores(refresh = false): Observable<any> {
        const qs = refresh ? '?refresh=1' : '';
        return this.httpClient.get(`${this.baseUrl}/rrhh/colaboradores${qs}`);
    }

    obtenerRrhhColaboradorExpediente(folderId: string, refresh = false): Observable<any> {
        const qs = refresh ? '?refresh=1' : '';
        return this.httpClient.get(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}${qs}`
        );
    }

    listarRrhhColaboradorContenido(folderId: string, carpetaId?: string | null, refresh = false): Observable<any> {
        const params = new URLSearchParams();
        if (carpetaId) params.set('carpetaId', carpetaId);
        if (refresh) params.set('refresh', '1');
        const qs = params.toString();
        return this.httpClient.get(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/contenido${qs ? `?${qs}` : ''}`
        );
    }

    crearRrhhColaboradorCarpeta(folderId: string, payload: { nombre: string; parentId?: string }): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/carpetas`,
            payload
        );
    }

    crearRrhhColaboradorCarpetasSugeridas(folderId: string): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/carpetas-sugeridas`,
            {}
        );
    }

    reescribirRrhhColaboradorArchivos(
        folderId: string,
        archivos: Array<{ id: string; nombre: string }>
    ): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/reescribir`,
            { archivos }
        );
    }

    subirRrhhColaboradorArchivo(folderId: string, file: File, parentId?: string): Observable<any> {
        const form = new FormData();
        form.append('file', file, file.name);
        if (parentId) form.append('parentId', parentId);
        return this.httpClient.post(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/archivos`,
            form
        );
    }

    eliminarRrhhColaboradorItem(folderId: string, itemId: string): Observable<any> {
        return this.httpClient.delete(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/items/${encodeURIComponent(itemId)}`
        );
    }

    moverRrhhColaboradorItem(folderId: string, itemId: string, destinoId: string): Observable<any> {
        return this.httpClient.post(
            `${this.baseUrl}/rrhh/colaboradores/${encodeURIComponent(folderId)}/mover`,
            { itemId, destinoId }
        );
    }

    descargarRrhhColaboradorArchivo(fileId: string, filename?: string, descargar = false): Observable<Blob> {
        const params = new URLSearchParams();
        if (filename) params.set('filename', filename);
        if (descargar) params.set('download', '1');
        const qs = params.toString();
        return this.httpClient.get(
            `${this.baseUrl}/rrhh/colaboradores/archivo/${encodeURIComponent(fileId)}${qs ? `?${qs}` : ''}`,
            { responseType: 'blob' }
        );
    }

    miniaturaRrhhColaboradorArchivo(fileId: string): Observable<Blob> {
        return this.httpClient.get(
            `${this.baseUrl}/rrhh/colaboradores/archivo/${encodeURIComponent(fileId)}/miniatura`,
            { responseType: 'blob' }
        );
    }

    // =====================================================
    // Diseño e Innovación — Cotización Señalización
    // =====================================================

    listarInnovacionSigns(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/signs`);
    }

    crearInnovacionSign(payload: {
        apartado_oficial?: number;
        categoria?: 'biznaga' | 'iso';
        nombre_senal: string;
        descripcion: string;
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
        permitir_incompleto?: boolean;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/signs`, payload);
    }

    actualizarInnovacionSign(
        id: number,
        payload: {
            nombre_senal?: string;
            descripcion?: string;
            clasificacion?: string | null;
            costo_unitario?: number | null;
            categoria?: 'biznaga' | 'iso';
            nombre_archivo?: string;
            mime_type?: string;
            archivo_base64?: string;
        }
    ): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/innovacion/signs/${id}`, payload);
    }

    descargarInnovacionSignArchivo(id: number): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/signs/${id}/archivo`, {
            responseType: 'blob'
        });
    }

    eliminarInnovacionSign(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/innovacion/signs/${id}`);
    }

    listarInnovacionCotizaciones(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/cotizaciones`);
    }

    crearInnovacionCotizacion(payload: {
        sign_id: number;
        tipo_cotizacion: 'produccion' | 'cliente';
        cotizacion_origen_id?: number | null;
        forma: string;
        forma_personalizado_texto?: string | null;
        aristas_personalizado?: number | null;
        distancia_visualizacion_m?: number | null;
        largo_cm: number;
        ancho_cm: number;
        cantidad: number;
        materiales: string[];
        notas?: string | null;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/cotizaciones`, payload);
    }

    listarInnovacionCotizacionesProyecto(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/cotizaciones-proyecto`);
    }

    obtenerSiguienteFolioCotizacionProyecto(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/cotizaciones-proyecto/siguiente-folio`);
    }

    obtenerInnovacionCotizacionProyecto(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/cotizaciones-proyecto/${id}`);
    }

    crearInnovacionCotizacionProyecto(payload: {
        empresa_id?: number | null;
        empresa_nombre: string;
        nombre_proyecto: string;
        fecha_cotizacion: string;
        tipo_cotizacion?: string;
        lineas: Array<{
            sign_id: number;
            forma: string;
            forma_personalizado_texto?: string;
            distancia_visualizacion_m?: number | null;
            largo_cm: number;
            ancho_cm: number;
            cantidad: number;
            materiales: string[];
            costo_unitario?: number;
            notas?: string | null;
        }>;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/cotizaciones-proyecto`, payload);
    }

    actualizarInnovacionCotizacionProyecto(
        id: number,
        payload: {
            empresa_id?: number | null;
            empresa_nombre: string;
            nombre_proyecto: string;
            fecha_cotizacion: string;
            tipo_cotizacion?: string;
            lineas: Array<{
                sign_id: number;
                forma: string;
                forma_personalizado_texto?: string;
                distancia_visualizacion_m?: number | null;
                largo_cm: number;
                ancho_cm: number;
                cantidad: number;
                materiales: string[];
                costo_unitario?: number;
                notas?: string | null;
            }>;
        }
    ): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/innovacion/cotizaciones-proyecto/${id}`, payload);
    }

    eliminarInnovacionCotizacionProyecto(id: number): Observable<any> {
        return this.desactivarInnovacionCotizacionProyecto(id);
    }

    desactivarInnovacionCotizacionProyecto(id: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/cotizaciones-proyecto/${id}/desactivar`, {});
    }

    exportarExcelCotizacionesProyecto(): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/cotizaciones-proyecto/exportar-excel`, {
            responseType: 'blob'
        });
    }

    listarInnovacionMateriales(): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/materiales`);
    }

    crearInnovacionMaterial(payload: { label: string }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/materiales`, payload);
    }

    listarInnovacionInventario(opciones?: { incluirInactivos?: boolean }): Observable<any> {
        const params: any = {};
        if (opciones?.incluirInactivos) {
            params.incluirInactivos = '1';
        }
        return this.httpClient.get(`${this.baseUrl}/innovacion/inventario`, { params });
    }

    crearInnovacionInventario(payload: {
        descripcion: string;
        tipo?: string | null;
        tamano: string;
        material: string;
        cantidad: number;
        notas?: string | null;
        imagenDocumentoId?: number | null;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario`, payload);
    }

    actualizarInnovacionInventario(id: number, payload: {
        descripcion?: string;
        tipo?: string | null;
        tamano?: string;
        material?: string;
        cantidad?: number;
        notas?: string | null;
        imagenDocumentoId?: number | null;
    }): Observable<any> {
        return this.httpClient.put(`${this.baseUrl}/innovacion/inventario/${id}`, payload);
    }

    eliminarInnovacionInventario(id: number): Observable<any> {
        return this.httpClient.delete(`${this.baseUrl}/innovacion/inventario/${id}`);
    }

    reactivarInnovacionInventario(id: number): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/${id}/reactivar`, {});
    }

    desactivarTodoInnovacionInventario(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/desactivar-todos`, {});
    }

    desactivarSeleccionInnovacionInventario(ids: number[]): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/desactivar-seleccion`, { ids });
    }

    borrarDefinitivoSeleccionInnovacionInventario(ids: number[]): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/borrar-definitivo-seleccion`, { ids });
    }

    borrarDefinitivoTodoInnovacionInventario(): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/borrar-definitivo-todos`, {});
    }

    importarExcelInnovacionInventario(payload: {
        nombre_archivo?: string;
        archivo_base64: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/importar-excel`, payload);
    }

    /** Sube imagen a la raíz del Repositorio DI para asociarla al inventario. */
    subirImagenInnovacionInventario(payload: {
        nombre_archivo: string;
        mime_type?: string;
        archivo_base64: string;
    }): Observable<any> {
        return this.httpClient.post(`${this.baseUrl}/innovacion/inventario/subir-imagen`, payload);
    }

    /** Descarga la imagen asociada a un ítem de inventario. */
    descargarImagenInnovacionInventario(id: number): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/inventario/${id}/imagen`, {
            responseType: 'blob'
        });
    }

    /** Miniatura estable (data URL) de un ítem de inventario. */
    miniaturaInnovacionInventario(id: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/inventario/${id}/miniatura`);
    }

    /** Descarga una imagen del repositorio DI (para selector / miniaturas). */
    descargarDocumentoImagenInnovacionInventario(docId: number): Observable<Blob> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/inventario/documentos/${docId}/archivo`, {
            responseType: 'blob'
        });
    }

    /** Miniatura estable (data URL) de un documento del repositorio DI. */
    miniaturaDocumentoInnovacionInventario(docId: number): Observable<any> {
        return this.httpClient.get(`${this.baseUrl}/innovacion/inventario/documentos/${docId}/miniatura`);
    }
}