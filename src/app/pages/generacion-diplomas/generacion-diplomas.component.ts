import { Component, OnInit } from '@angular/core';
import { BackendServices } from '../../services/backend.services';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';
import { fechaSoloDiaATimestamp } from '../../utils/fecha.util';

@Component({
  selector: 'app-generacion-diplomas',
  templateUrl: './generacion-diplomas.component.html',
  styleUrls: ['./generacion-diplomas.component.scss']
})
export class GeneracionDiplomAsComponent implements OnInit {

  // Navegación por pasos
  pasoActual: number = 1;

  // Datos
  cursos: any[] = [];
  cursosFiltrados: any[] = [];
  empresas: any[] = [];
  participantes: any[] = [];
  cursoSeleccionado: any = null;

  // Filtros
  filtroEmpresa: string = '';
  filtroEstatus: string = '';
  filtroBusqueda: string = '';

  // Firmas
  firma1Nombre: string = '';
  firma1Cargo: string = '';
  firma2Nombre: string = '';
  firma2Cargo: string = '';

  // Ordenamiento
  ordenCampo: string = 'fecha_inicio';
  ordenAsc: boolean = false; // false = más reciente primero

  // Estado
  cargandoCursos: boolean = true;
  cargandoParticipantes: boolean = false;
  generando: boolean = false;
  progresoTexto: string = 'Generando...';
  tipoDocumento: string = 'constancia';

  private coloresAvatar = [
    'linear-gradient(135deg, #38512F 0%, #5a7456 100%)',
    'linear-gradient(135deg, #768D6B 0%, #8fa382 100%)',
    'linear-gradient(135deg, #5a7456 0%, #768D6B 100%)',
    'linear-gradient(135deg, #38512F 0%, #768D6B 100%)',
    'linear-gradient(135deg, #8fa382 0%, #C2D1B2 100%)'
  ];

  constructor(
    private backendServices: BackendServices
  ) {}

  ngOnInit(): void {
    this.cargarDatos();
  }

  // ═══════════════════════════════════════
  // Carga de datos
  // ═══════════════════════════════════════
  cargarDatos(): void {
    this.cargandoCursos = true;

    this.backendServices.obtenerEmpresas().subscribe(
      (res: any) => {
        this.empresas = res.success ? res.empresas : (Array.isArray(res) ? res : []);
      }
    );

    this.backendServices.obtenerCursosProgramados().subscribe(
      (res: any) => {
        const data = res.success ? res.cursosProgramados : (Array.isArray(res) ? res : []);
        this.cursos = (data || []).map((c: any) => ({
          ...c,
          horas: c.curso_horas || c.horas,
          instructor_apellidos: [c.instructor_apellido_paterno, c.instructor_apellido_materno].filter(Boolean).join(' ')
        }));
        this.filtrarCursos();
        this.cargandoCursos = false;
      },
      (error) => {
        console.error('Error cargando cursos:', error);
        this.cargandoCursos = false;
        Swal.fire({
          title: 'Error',
          text: 'No se pudieron cargar los cursos programados',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    );
  }

  // ═══════════════════════════════════════
  // Filtrado
  // ═══════════════════════════════════════
  filtrarCursos(): void {
    if (!Array.isArray(this.cursos)) {
      this.cursosFiltrados = [];
      return;
    }
    let resultado = [...this.cursos];

    if (this.filtroEmpresa) {
      resultado = resultado.filter(c => c.empresa_id == this.filtroEmpresa);
    }

    if (this.filtroEstatus) {
      resultado = resultado.filter(c => c.estatus === this.filtroEstatus);
    }

    if (this.filtroBusqueda) {
      const busqueda = this.filtroBusqueda.toLowerCase();
      resultado = resultado.filter(c =>
        c.nombre_curso?.toLowerCase().includes(busqueda) ||
        c.nombre_empresa?.toLowerCase().includes(busqueda) ||
        c.ubicacion?.toLowerCase().includes(busqueda)
      );
    }

    resultado.sort((a, b) => {
      let valA: any, valB: any;
      if (this.ordenCampo === 'fecha_inicio') {
        valA = fechaSoloDiaATimestamp(a.fecha_inicio);
        valB = fechaSoloDiaATimestamp(b.fecha_inicio);
      } else {
        valA = (a[this.ordenCampo] || '').toString().toLowerCase();
        valB = (b[this.ordenCampo] || '').toString().toLowerCase();
      }
      if (valA < valB) return this.ordenAsc ? -1 : 1;
      if (valA > valB) return this.ordenAsc ? 1 : -1;
      return 0;
    });

    this.cursosFiltrados = resultado;
  }

  ordenarPor(campo: string): void {
    if (this.ordenCampo === campo) {
      this.ordenAsc = !this.ordenAsc;
    } else {
      this.ordenCampo = campo;
      this.ordenAsc = campo !== 'fecha_inicio'; // fecha default desc, texto default asc
    }
    this.filtrarCursos();
  }

  // ═══════════════════════════════════════
  // Selección de curso
  // ═══════════════════════════════════════
  seleccionarCurso(curso: any): void {
    this.cursoSeleccionado = curso;
    this.cargarParticipantes(curso.programado_id);

    if (curso.instructor_nombre) {
      this.firma1Nombre = `${curso.instructor_nombre} ${curso.instructor_apellidos || ''}`.trim();
      this.firma1Cargo = 'Instructor';
    }

    this.pasoActual = 2;
  }

  deseleccionarCurso(): void {
    this.cursoSeleccionado = null;
    this.participantes = [];
    this.firma1Nombre = '';
    this.firma1Cargo = '';
    this.firma2Nombre = '';
    this.firma2Cargo = '';
    this.pasoActual = 1;
  }

  // ═══════════════════════════════════════
  // Navegación entre pasos
  // ═══════════════════════════════════════
  irAPaso(paso: number): void {
    if (paso < 1 || paso > 3) return;
    if (paso === 2 && !this.cursoSeleccionado) return;
    if (paso === 3 && this.participantesSeleccionados.length === 0) return;
    this.pasoActual = paso;
  }

  siguientePaso(): void {
    if (this.puedeSiguiente()) {
      this.pasoActual++;
    }
  }

  pasoAnterior(): void {
    if (this.pasoActual > 1) {
      this.pasoActual--;
    }
  }

  puedeSiguiente(): boolean {
    switch (this.pasoActual) {
      case 1: return !!this.cursoSeleccionado;
      case 2: return this.participantesSeleccionados.length > 0;
      default: return false;
    }
  }

  // ═══════════════════════════════════════
  // Participantes
  // ═══════════════════════════════════════
  cargarParticipantes(programadoId: number): void {
    this.cargandoParticipantes = true;
    this.backendServices.obtenerParticipantesCurso(programadoId).subscribe(
      (res: any) => {
        const data = res.success ? res.participantes : (Array.isArray(res) ? res : []);

        this.participantes = data
          .filter((p: any) => p.asistio === 1 || p.asistio === true)
          .map((p: any) => ({
            ...p,
            nombre_completo: [p.apellido_paterno, p.apellido_materno, p.nombre].filter(Boolean).join(' '),
            seleccionado: !p.certificado_generado // Pre-seleccionar solo los que NO tienen constancia
          }));

        this.cargandoParticipantes = false;
      },
      (error) => {
        console.error('Error cargando participantes:', error);
        this.cargandoParticipantes = false;
      }
    );
  }

  // ═══════════════════════════════════════
  // Selección de participantes
  // ═══════════════════════════════════════
  get participantesSeleccionados(): any[] {
    return this.participantes.filter(p => p.seleccionado);
  }

  get todosSeleccionados(): boolean {
    return this.participantes.length > 0 && this.participantes.every(p => p.seleccionado);
  }

  seleccionarTodos(): void {
    this.participantes.forEach(p => p.seleccionado = true);
  }

  deseleccionarTodos(): void {
    this.participantes.forEach(p => p.seleccionado = false);
  }

  toggleTodos(event: any): void {
    const checked = event.target.checked;
    this.participantes.forEach(p => p.seleccionado = checked);
  }

  // ═══════════════════════════════════════
  // Generación de documentos (Google Slides API + SSE)
  // ═══════════════════════════════════════
  async generarDocumentos(): Promise<void> {
    if (this.participantesSeleccionados.length === 0) {
      Swal.fire({ title: 'Sin selección', text: 'Selecciona al menos un participante', icon: 'warning', confirmButtonColor: '#38512F' });
      return;
    }

    const tipoLabel = this.tipoDocumento === 'ambos' ? 'constancias y DC-3' : (this.tipoDocumento === 'dc3' ? 'DC-3' : 'constancias');
    const totalDocs = this.participantesSeleccionados.length;

    const { isConfirmed } = await Swal.fire({
      title: '<i class="fas fa-bolt" style="color: #1565C0;"></i> Generar V2',
      html: `
        Se generarán <strong>${totalDocs}</strong> ${tipoLabel} con Google Slides API directo.
        <br><small class="text-muted">Estimado: ~${Math.max(5, Math.ceil(totalDocs / 8) * 10)} segundos</small>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-bolt"></i> Generar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1565C0',
      cancelButtonColor: '#A8A9A2'
    });

    if (!isConfirmed) return;

    this.generando = true;
    this.progresoTexto = '0/' + totalDocs;

    // Mostrar Swal con barra de progreso
    const tituloModal = this.tipoDocumento === 'ambos' ? 'Generando constancias + DC-3' : (this.tipoDocumento === 'dc3' ? 'Generando DC-3' : 'Generando constancias');
    Swal.fire({
      title: tituloModal,
      html: this.buildProgressHtml(0, totalDocs, 'Preparando...'),
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        // Iniciar generación con SSE
        this.iniciarGeneracionSSE(totalDocs, tipoLabel);
      }
    });
  }

  private buildProgressHtml(completados: number, total: number, mensaje: string, pct: number = 0): string {
    return `
      <div style="text-align: center; padding: 8px 0;">
        <div style="position: relative; height: 28px; background: #e9ecef; border-radius: 14px; overflow: hidden; margin: 16px 0;">
          <div id="swal-bar" style="
            height: 100%;
            width: ${pct}%;
            background: linear-gradient(90deg, #1565C0, #42A5F5);
            border-radius: 14px;
            transition: width 0.4s ease;
          "></div>
          <span id="swal-bar-text" style="
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            font-size: 0.8rem; font-weight: 700; color: ${pct > 45 ? '#fff' : '#333'};
            text-shadow: ${pct > 45 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'};
          ">${pct}%</span>
        </div>
        <p id="swal-count" style="font-size: 1.1rem; font-weight: 600; color: #1565C0; margin: 8px 0;">
          ${completados} / ${total}
        </p>
        <p id="swal-msg" style="font-size: 0.82rem; color: #888; margin: 4px 0;">
          ${mensaje}
        </p>
      </div>
    `;
  }

  private updateProgressUI(pct: number, completados: number, total: number, mensaje: string): void {
    const bar = document.getElementById('swal-bar');
    const barText = document.getElementById('swal-bar-text');
    const count = document.getElementById('swal-count');
    const msg = document.getElementById('swal-msg');
    if (bar) {
      bar.style.width = pct + '%';
    }
    if (barText) {
      barText.textContent = pct + '%';
      barText.style.color = pct > 45 ? '#fff' : '#333';
      barText.style.textShadow = pct > 45 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none';
    }
    if (count) count.innerHTML = `${completados} / ${total}`;
    if (msg) msg.textContent = mensaje;
  }

  private iniciarGeneracionSSE(totalDocs: number, tipoLabel: string): void {
    const payload = {
      firmas: {
        firma1: { nombre: this.firma1Nombre, cargo: this.firma1Cargo },
        firma2: { nombre: this.firma2Nombre, cargo: this.firma2Cargo }
      },
      tipoDocumento: this.tipoDocumento,
      participantes: this.participantesSeleccionados.map(p => ({
        inscripcion_id: p.inscripcion_id,
        empleado_id: p.empleado_id,
        nombre_completo: p.nombre_completo,
        nombre: p.nombre || '',
        apellido_paterno: p.apellido_paterno || '',
        apellido_materno: p.apellido_materno || '',
        curp: p.curp,
        puesto: p.puesto || '',
        departamento: p.departamento || ''
      }))
    };

    const url = `${environment.apiUrl}/cursos-programados/${this.cursoSeleccionado.programado_id}/generar-constancias-v2`;
    const token = localStorage.getItem('auth_token');

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    }).then(response => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) {
            this.generando = false;
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.substring(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.substring(6));
                this.handleSSEEvent(currentEvent, data, totalDocs, tipoLabel);
              } catch (e) {}
              currentEvent = '';
            }
          }

          processStream();
        });
      };

      processStream();
    }).catch(error => {
      this.generando = false;
      Swal.fire({
        title: 'Error de conexión',
        text: 'No se pudo conectar al servidor. Verifica que esté activo.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    });
  }

  private handleSSEEvent(event: string, data: any, totalDocs: number, tipoLabel: string): void {
    switch (event) {
      case 'progress':
        this.progresoTexto = `${data.completados || 0}/${totalDocs}`;
        this.updateProgressUI(
          data.pct || 0,
          data.completados || 0,
          totalDocs,
          data.mensaje || 'Procesando...'
        );
        break;

      case 'done':
        this.generando = false;
        this.progresoTexto = '';

        // Marcar participantes exitosos
        this.participantesSeleccionados.forEach(p => {
          p.certificado_generado = 1;
          p.seleccionado = false;
        });

        let extra = data.carpeta ? `<br><small style="color:#888;">Carpeta: ${data.carpeta}</small>` : '';
        if (data.fallidos > 0) {
          extra += `<br><small style="color:#e74c3c;">${data.fallidos} fallaron</small>`;
        }

        // Detalles por tipo de documento
        let detalles = '';
        if (data.constancias && data.dc3) {
          detalles = `<p style="font-size: 1.1rem;">${data.constancias.exitosos} constancias + ${data.dc3.exitosos} DC-3 en <strong>${data.duracion}s</strong></p>`;
        } else {
          detalles = `<p style="font-size: 1.1rem;"><strong>${data.exitosos}</strong> ${tipoLabel} en <strong>${data.duracion}s</strong></p>`;
        }

        const tituloFinal = tipoLabel.includes('DC-3') && !tipoLabel.includes('constancia') ? 'DC-3 generados' : 'Documentos generados';

        Swal.fire({
          title: tituloFinal,
          html: `${detalles}${extra}`,
          icon: data.fallidos === 0 ? 'success' : 'warning',
          confirmButtonColor: '#1565C0'
        });
        break;

      case 'error':
        this.generando = false;
        Swal.fire({
          title: 'Error',
          text: data.message || 'Error al generar documentos',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        break;
    }
  }

  // ═══════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════
  getIniciales(nombre: string): string {
    if (!nombre) return '?';
    const partes = nombre.split(' ').filter(Boolean);
    if (partes.length >= 2) {
      return (partes[0][0] + partes[1][0]).toUpperCase();
    }
    return partes[0][0].toUpperCase();
  }

  getColorAvatar(index: number): string {
    return this.coloresAvatar[index % this.coloresAvatar.length];
  }

  getEstatusColor(estatus: string): string {
    const colores: any = {
      completado: '#2dce89',
      en_curso: '#11cdef',
      programado: '#fb6340',
      cancelado: '#f5365c'
    };
    return colores[estatus] || '#adb5bd';
  }
}
