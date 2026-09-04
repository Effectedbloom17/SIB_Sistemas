import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';

interface Participante {
  id: number;
  nombre: string;
  curp: string;
  puesto: string;
  examenDiagnostico: DocumentoParticipante;
  evaluacionAprendizaje: DocumentoParticipante;
  instrumentoSatisfaccion: DocumentoParticipante;
  constancia: DocumentoParticipante;
  certificacionDC3: DocumentoParticipante;
}

interface DocumentoParticipante {
  existe: boolean;
  url?: string;
  nombre?: string;
}

@Component({
  selector: 'app-lista-asistencia',
  templateUrl: './lista-asistencia.component.html',
  styleUrls: ['./lista-asistencia.component.scss']
})
export class ListaAsistenciaComponent implements OnInit {
  cursoId: number;
  empresaNombre: string = '';
  fechaCurso: string = '';
  participantes: Participante[] = [];
  participantesFiltrados: Participante[] = [];
  filtroNombre: string = '';
  loading: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.cursoId = +this.route.snapshot.params['id'];
    this.empresaNombre = this.route.snapshot.queryParams['empresa'] || 'Empresa';
    this.fechaCurso = this.route.snapshot.queryParams['fecha'] || '';
    this.cargarParticipantes();
  }

  cargarParticipantes() {
    // Datos de ejemplo - conectar con backend
    this.participantes = [
      {
        id: 1,
        nombre: 'Juan Pablo Rodríguez Morales',
        curp: 'ROMJ850315HDFRDR03',
        puesto: 'Supervisor de Obra',
        examenDiagnostico: { existe: true, url: 'assets/docs/examen-1.pdf', nombre: 'Examen Diagnóstico' },
        evaluacionAprendizaje: { existe: true, url: 'assets/docs/evaluacion-1.pdf', nombre: 'Evaluación' },
        instrumentoSatisfaccion: { existe: true, url: 'assets/docs/satisfaccion-1.pdf', nombre: 'Satisfacción' },
        constancia: { existe: true, url: 'assets/docs/constancia-1.pdf', nombre: 'Constancia' },
        certificacionDC3: { existe: true, url: 'assets/docs/dc3-1.pdf', nombre: 'DC-3' }
      },
      {
        id: 2,
        nombre: 'María Elena González Sánchez',
        curp: 'GOSM901022MDFNLR08',
        puesto: 'Ingeniera de Seguridad',
        examenDiagnostico: { existe: true, url: 'assets/docs/examen-2.pdf', nombre: 'Examen Diagnóstico' },
        evaluacionAprendizaje: { existe: true, url: 'assets/docs/evaluacion-2.pdf', nombre: 'Evaluación' },
        instrumentoSatisfaccion: { existe: true, url: 'assets/docs/satisfaccion-2.pdf', nombre: 'Satisfacción' },
        constancia: { existe: true, url: 'assets/docs/constancia-2.pdf', nombre: 'Constancia' },
        certificacionDC3: { existe: true, url: 'assets/docs/dc3-2.pdf', nombre: 'DC-3' }
      },
      {
        id: 3,
        nombre: 'Carlos Alberto Ramírez López',
        curp: 'RALC780512HDFMPR01',
        puesto: 'Operador de Maquinaria',
        examenDiagnostico: { existe: true, url: 'assets/docs/examen-3.pdf', nombre: 'Examen Diagnóstico' },
        evaluacionAprendizaje: { existe: true, url: 'assets/docs/evaluacion-3.pdf', nombre: 'Evaluación' },
        instrumentoSatisfaccion: { existe: true, url: 'assets/docs/satisfaccion-3.pdf', nombre: 'Satisfacción' },
        constancia: { existe: true, url: 'assets/docs/constancia-3.pdf', nombre: 'Constancia' },
        certificacionDC3: { existe: false } // No aplica DC-3
      },
      {
        id: 4,
        nombre: 'Ana Patricia Hernández Torres',
        curp: 'HETA920807MDFRRN04',
        puesto: 'Coordinadora de Capacitación',
        examenDiagnostico: { existe: true, url: 'assets/docs/examen-4.pdf', nombre: 'Examen Diagnóstico' },
        evaluacionAprendizaje: { existe: true, url: 'assets/docs/evaluacion-4.pdf', nombre: 'Evaluación' },
        instrumentoSatisfaccion: { existe: true, url: 'assets/docs/satisfaccion-4.pdf', nombre: 'Satisfacción' },
        constancia: { existe: true, url: 'assets/docs/constancia-4.pdf', nombre: 'Constancia' },
        certificacionDC3: { existe: true, url: 'assets/docs/dc3-4.pdf', nombre: 'DC-3' }
      },
      {
        id: 5,
        nombre: 'Roberto Carlos Martínez Flores',
        curp: 'MAFR881205HDFRBL09',
        puesto: 'Técnico de Mantenimiento',
        examenDiagnostico: { existe: true, url: 'assets/docs/examen-5.pdf', nombre: 'Examen Diagnóstico' },
        evaluacionAprendizaje: { existe: true, url: 'assets/docs/evaluacion-5.pdf', nombre: 'Evaluación' },
        instrumentoSatisfaccion: { existe: true, url: 'assets/docs/satisfaccion-5.pdf', nombre: 'Satisfacción' },
        constancia: { existe: true, url: 'assets/docs/constancia-5.pdf', nombre: 'Constancia' },
        certificacionDC3: { existe: false } // No aplica DC-3
      },
      {
        id: 6,
        nombre: 'Laura Ivonne Pérez Gutiérrez',
        curp: 'PEGL950318MDFRTL02',
        puesto: 'Asistente Administrativa',
        examenDiagnostico: { existe: true, url: 'assets/docs/examen-6.pdf', nombre: 'Examen Diagnóstico' },
        evaluacionAprendizaje: { existe: true, url: 'assets/docs/evaluacion-6.pdf', nombre: 'Evaluación' },
        instrumentoSatisfaccion: { existe: true, url: 'assets/docs/satisfaccion-6.pdf', nombre: 'Satisfacción' },
        constancia: { existe: true, url: 'assets/docs/constancia-6.pdf', nombre: 'Constancia' },
        certificacionDC3: { existe: true, url: 'assets/docs/dc3-6.pdf', nombre: 'DC-3' }
      }
    ];
    this.participantesFiltrados = [...this.participantes];
  }

  filtrarParticipantes() {
    if (!this.filtroNombre || this.filtroNombre.trim() === '') {
      this.participantesFiltrados = [...this.participantes];
    } else {
      const filtro = this.filtroNombre.toLowerCase();
      this.participantesFiltrados = this.participantes.filter(p => 
        p.nombre.toLowerCase().includes(filtro) ||
        p.curp.toLowerCase().includes(filtro) ||
        p.puesto.toLowerCase().includes(filtro)
      );
    }
  }

  descargarConstancias() {
    Swal.fire({
      icon: 'info',
      title: 'Descargando Constancias',
      text: 'Se están preparando las constancias de todos los participantes...',
      confirmButtonColor: '#38512F',
      timer: 2000
    });
  }

  descargarDC3() {
    Swal.fire({
      icon: 'info',
      title: 'Descargando DC-3',
      text: 'Se están preparando los certificados DC-3 de todos los participantes...',
      confirmButtonColor: '#38512F',
      timer: 2000
    });
  }

  volverADetalleCurso() {
    this.router.navigate(['/informacion-general', this.cursoId]);
  }

  verDetallesDocumentos(participante: Participante) {
    const documentos = [
      { nombre: 'Examen Diagnóstico', doc: participante.examenDiagnostico, tipo: 'Examen Diagnóstico' },
      { nombre: 'Evaluación de Aprendizaje', doc: participante.evaluacionAprendizaje, tipo: 'Evaluación' },
      { nombre: 'Instrumento de Satisfacción', doc: participante.instrumentoSatisfaccion, tipo: 'Satisfacción' },
      { nombre: 'Constancia', doc: participante.constancia, tipo: 'Constancia' },
      { nombre: 'Certificación DC-3', doc: participante.certificacionDC3, tipo: 'DC-3' }
    ];

    let tablaHTML = `
      <div style="text-align: left; padding: 1rem;">
        <div style="margin-bottom: 1.5rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
          <h4 style="margin: 0 0 0.5rem 0; color: #2c3e50;">${participante.nombre}</h4>
          <p style="margin: 0; color: #7f8c8d; font-size: 0.9rem;">
            <strong>CURP:</strong> ${participante.curp} | <strong>Puesto:</strong> ${participante.puesto}
          </p>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: linear-gradient(135deg, #38512F 0%, #768D6B 100%); color: white;">
                <th style="padding: 0.875rem; text-align: left; font-size: 0.875rem; font-weight: 600;">Documento</th>
                <th style="padding: 0.875rem; text-align: center; font-size: 0.875rem; font-weight: 600; width: 30%;">Acciones</th>
              </tr>
            </thead>
            <tbody>
    `;

    documentos.forEach((item, index) => {
      const bgColor = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
      const disponible = item.doc.existe;

      tablaHTML += `
        <tr style="background: ${bgColor}; border-bottom: 1px solid #e9ecef;">
          <td style="padding: 1rem; color: #2c3e50;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <i class="fas fa-file-pdf" style="color: #f5365c; font-size: 1.25rem;"></i>
              <div>
                <div style="font-weight: 600;">${item.nombre}</div>
              </div>
            </div>
          </td>
          <td style="padding: 1rem; text-align: center;">
            <div style="display: flex; gap: 0.5rem; justify-content: center; align-items: center;">
              <button 
                id="btn-ver-${index}" 
                style="background: linear-gradient(135deg, #2196f3 0%, #64b5f6 100%); color: white; border: none; padding: 0.5rem; border-radius: 6px; font-weight: 600; cursor: ${disponible ? 'pointer' : 'not-allowed'}; opacity: ${disponible ? '1' : '0.5'}; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.3s ease;"
                ${!disponible ? 'disabled' : ''}
                title="Ver documento"
              >
                <i class="fas fa-eye"></i>
              </button>
              <button 
                id="btn-descargar-${index}" 
                style="background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%); color: white; border: none; padding: 0.5rem; border-radius: 6px; font-weight: 600; cursor: ${disponible ? 'pointer' : 'not-allowed'}; opacity: ${disponible ? '1' : '0.5'}; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.3s ease;"
                ${!disponible ? 'disabled' : ''}
                title="Descargar documento"
              >
                <i class="fas fa-download"></i>
              </button>
              <button 
                id="btn-enviar-${index}" 
                style="background: linear-gradient(135deg, #38512F 0%, #768D6B 100%); color: white; border: none; padding: 0.5rem; border-radius: 6px; font-weight: 600; cursor: not-allowed; opacity: 0.7; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;"
                disabled
                title="Funcionalidad próximamente"
              >
                <i class="fas fa-paper-plane"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tablaHTML += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    Swal.fire({
      title: 'Documentos del Participante',
      html: tablaHTML,
      width: '700px',
      showCloseButton: true,
      showConfirmButton: false,
      customClass: {
        popup: 'modal-documentos-participante',
        closeButton: 'btn-close-modal'
      },
      didOpen: () => {
        // Agregar event listeners a los botones "Ver" y "Descargar"
        documentos.forEach((item, index) => {
          if (item.doc.existe) {
            const btnVer = document.getElementById(`btn-ver-${index}`);
            const btnDescargar = document.getElementById(`btn-descargar-${index}`);
            
            if (btnVer) {
              btnVer.addEventListener('click', () => {
                Swal.close();
                this.previsualizarDocumentoModal(item.doc, participante.nombre, item.nombre);
              });

              // Añadir efecto hover
              btnVer.addEventListener('mouseenter', () => {
                btnVer.style.transform = 'translateY(-2px)';
                btnVer.style.boxShadow = '0 4px 12px rgba(33, 150, 243, 0.4)';
              });
              btnVer.addEventListener('mouseleave', () => {
                btnVer.style.transform = 'translateY(0)';
                btnVer.style.boxShadow = 'none';
              });
            }

            if (btnDescargar) {
              btnDescargar.addEventListener('click', () => {
                this.descargarDocumentoParticipante(item.doc, participante.nombre, item.nombre);
              });

              // Añadir efecto hover
              btnDescargar.addEventListener('mouseenter', () => {
                btnDescargar.style.transform = 'translateY(-2px)';
                btnDescargar.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.4)';
              });
              btnDescargar.addEventListener('mouseleave', () => {
                btnDescargar.style.transform = 'translateY(0)';
                btnDescargar.style.boxShadow = 'none';
              });
            }
          }
        });
      }
    });
  }

  descargarDocumentoParticipante(doc: DocumentoParticipante, nombreParticipante: string, tipoDoc: string) {
    if (!doc.existe || !doc.url) {
      Swal.fire({
        icon: 'warning',
        title: 'Documento no disponible',
        text: 'Este documento no está disponible',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    Swal.fire({
      icon: 'success',
      title: 'Descargando...',
      text: `${tipoDoc} de ${nombreParticipante}`,
      timer: 1500,
      showConfirmButton: false
    });
    
    // Simular descarga
  }

  previsualizarDocumentoModal(doc: DocumentoParticipante, nombreParticipante: string, tipoDoc: string) {
    if (!doc.existe || !doc.url) {
      Swal.fire({
        icon: 'warning',
        title: 'Documento no disponible',
        text: 'Este documento no está disponible',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Modal con iframe para previsualizar y botón de descarga
    Swal.fire({
      title: `${tipoDoc} - ${nombreParticipante}`,
      html: `
        <div style="position: relative;">
          <iframe 
            src="${doc.url}" 
            style="width: 100%; height: 500px; border: 1px solid #e3e6e9; border-radius: 8px;"
            frameborder="0">
          </iframe>
        </div>
      `,
      width: '80%',
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-download mr-2"></i>Descargar',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      customClass: {
        popup: 'modal-preview-documento',
        confirmButton: 'btn-download-documento'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        this.descargarDocumento(doc, nombreParticipante);
      }
    });
  }

  enviarPorCorreo(participante: Participante, tipoDoc: string) {
    Swal.fire({
      title: 'Enviar por Correo Electrónico',
      html: `
        <div style="text-align: left; padding: 1rem;">
          <p style="margin-bottom: 1rem; color: #525f7f;">
            <strong>Documento:</strong> ${tipoDoc}<br>
            <strong>Participante:</strong> ${participante.nombre}
          </p>
          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; color: #2c3e50; font-weight: 600;">
              Correo Electrónico:
            </label>
            <input 
              id="email-input" 
              type="email" 
              class="swal2-input" 
              placeholder="ejemplo@correo.com"
              style="width: 100%; padding: 0.75rem; border: 2px solid #e3e6e9; border-radius: 8px; font-size: 1rem;"
            >
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.5rem; color: #2c3e50; font-weight: 600;">
              Mensaje (opcional):
            </label>
            <textarea 
              id="message-input" 
              class="swal2-textarea" 
              placeholder="Agregar un mensaje..."
              style="width: 100%; padding: 0.75rem; border: 2px solid #e3e6e9; border-radius: 8px; font-size: 1rem; min-height: 100px;"
            ></textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-paper-plane mr-2"></i>Enviar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      preConfirm: () => {
        const email = (document.getElementById('email-input') as HTMLInputElement).value;
        const message = (document.getElementById('message-input') as HTMLTextAreaElement).value;
        
        if (!email) {
          Swal.showValidationMessage('Por favor ingresa un correo electrónico');
          return false;
        }
        
        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          Swal.showValidationMessage('Por favor ingresa un correo electrónico válido');
          return false;
        }
        
        return { email, message };
      }
    }).then((result) => {
      if (result.isConfirmed) {
        // Simular envío de correo
        Swal.fire({
          icon: 'success',
          title: '¡Correo enviado!',
          text: `${tipoDoc} enviado a ${result.value.email}`,
          confirmButtonColor: '#38512F',
          timer: 2500
        });
      }
    });
  }

  descargarDocumento(doc: DocumentoParticipante, nombreParticipante: string) {
    if (!doc.existe || !doc.url) {
      Swal.fire({
        icon: 'warning',
        title: 'Documento no disponible',
        text: 'Este documento no está disponible',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const link = document.createElement('a');
    link.href = doc.url;
    link.download = `${doc.nombre}_${nombreParticipante}`;
    link.click();

    Swal.fire({
      icon: 'success',
      title: 'Descarga iniciada',
      text: `Descargando ${doc.nombre}`,
      confirmButtonColor: '#38512F',
      timer: 1500,
      showConfirmButton: false
    });
  }
}
