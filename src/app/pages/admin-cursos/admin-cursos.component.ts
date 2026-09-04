import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-admin-cursos',
  templateUrl: './admin-cursos.component.html',
  styleUrls: ['./admin-cursos.component.scss']
})
export class AdminCursosComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();
  categoriaSeleccionada: string = '';
  tituloCategoria: string = 'Todos los cursos';
  cursosFiltrados: any[] = [];

  // --- BASE DE DATOS SIMULADA ---
  cursosSimulados = [
    // Categoría: SEGURIDAD
    {
      id: 1,
      nombre: 'Comisión de Seguridad e Higiene',
      categoria: 'seguridad',
      estado: 'abierto', // abierto | cerrado
      cupos: 25,
      ocupados: 10,
      empresa: 'Coca-Cola FEMSA',
      instructor: 'Ing. Roberto Gómez'
    },
    {
      id: 2,
      nombre: 'Búsqueda y Rescate',
      categoria: 'seguridad',
      estado: 'cerrado',
      cupos: 15,
      ocupados: 15,
      empresa: 'Nestlé México',
      instructor: 'Lic. Ana Torres'
    },
    {
      id: 3,
      nombre: 'Trabajos en Alturas',
      categoria: 'seguridad',
      estado: 'abierto',
      cupos: 10,
      ocupados: 2,
      empresa: 'Cemex',
      instructor: 'Ing. Roberto Gómez'
    },

    // Categoría: SALUD
    {
      id: 4,
      nombre: 'Primeros Auxilios Básicos',
      categoria: 'salud',
      estado: 'abierto',
      cupos: 30,
      ocupados: 0,
      empresa: 'Pendiente',
      instructor: 'Dr. House'
    },
    
    // Categoría: CONDUCCION
    {
      id: 5,
      nombre: 'Manejo Defensivo',
      categoria: 'conduccion',
      estado: 'abierto',
      cupos: 5,
      ocupados: 5,
      empresa: 'Transportes Castores',
      instructor: 'Pedro Picapiedra'
    }
  ];

  constructor(private route: ActivatedRoute) { }

  ngOnInit(): void {
    // Escuchar cambios en la URL para saber qué categoría mostrar
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.categoriaSeleccionada = params['cat'] || 'todas';
      this.filtrarCursos();
      this.formatearTitulo();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  filtrarCursos() {
    if (this.categoriaSeleccionada === 'todas') {
      this.cursosFiltrados = this.cursosSimulados;
    } else {
      this.cursosFiltrados = this.cursosSimulados.filter(
        c => c.categoria === this.categoriaSeleccionada
      );
    }
  }

  formatearTitulo() {
    // Convierte "areas-diversas" a "Áreas Diversas" (Solo estético)
    const titulos: any = {
      'seguridad': 'Seguridad',
      'higiene': 'Higiene y Seguridad',
      'areas-diversas': 'Áreas Diversas',
      'salud': 'Salud',
      'ambientales': 'Ambientales',
      'productividad': 'Productividad',
      'conduccion': 'Conducción'
    };
    this.tituloCategoria = titulos[this.categoriaSeleccionada] || 'Listado General';
  }
  
  // Acción simulada para ver detalles
  verDetalleCurso(curso: any) {
    alert(`Ir a gestión del curso: ${curso.nombre}`);
    // Aquí redirigirías a: /admin-agenda/1
  }
}