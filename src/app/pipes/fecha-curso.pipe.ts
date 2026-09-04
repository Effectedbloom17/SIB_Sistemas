import { Pipe, PipeTransform } from '@angular/core';
import {
  formatearFechaCursoCortoEs,
  formatearFechaCursoEs,
  formatearFechaDdmmaaaa
} from '../utils/fecha.util';

export type FechaCursoFormat = 'ddmmaaaa' | 'cursoEs' | 'cortoEs';

@Pipe({ name: 'fechaCurso' })
export class FechaCursoPipe implements PipeTransform {
  transform(value: unknown, format: FechaCursoFormat = 'ddmmaaaa'): string {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    switch (format) {
      case 'cursoEs':
        return formatearFechaCursoEs(value);
      case 'cortoEs':
        return formatearFechaCursoCortoEs(value);
      default:
        return formatearFechaDdmmaaaa(value);
    }
  }
}
