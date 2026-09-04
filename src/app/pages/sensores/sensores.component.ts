import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, of, timer } from 'rxjs';
import { catchError, exhaustMap, finalize, takeUntil, tap } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';

export interface SensorDatastreamView {
  pin: string;
  value: number | string | null;
  role?: string | null;
}

export interface SensorDiagnosticsView {
  cloudOk: boolean;
  latencyMs: number | null;
  tokenHint: string | null;
  server: string | null;
  blynkStatus: string | null;
  lastReportedAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastSessionDurationSec: number | null;
  activatedAt: string | null;
  ip: string | null;
  country: string | null;
  boardType: string | null;
  blynkVersion: string | null;
  firmwareBuild: string | null;
  heartbeatIntervalSec: number | null;
  reception: {
    mode: 'live' | 'cached' | 'none' | string;
    label: string;
    ageSec: number | null;
  };
}

export interface SensorEstadoView {
  configured: boolean;
  deviceName: string;
  connected: boolean | null;
  volume: number | null;
  altura: number | null;
  pins: { volume?: string; altura?: string; range?: string };
  datastreams: SensorDatastreamView[];
  diagnostics: SensorDiagnosticsView;
  updatedAt: string | null;
}

export interface SensorPollSample {
  at: string;
  ok: boolean;
  connected: boolean | null;
  volume: number | null;
  altura: number | null;
  latencyMs: number | null;
}

export interface SensorHistorialRow {
  id: number;
  tomado_en: string;
  volumen: number | null;
  altura: number | null;
  lectura_ok: number | boolean;
  conectado: number | boolean | null;
  error_codigo: string | null;
  error_mensaje: string | null;
  latencia_ms: number | null;
  recepcion_modo: string | null;
}

@Component({
  selector: 'app-sensores',
  templateUrl: './sensores.component.html',
  styleUrls: ['./sensores.component.scss']
})
export class SensoresComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly pollMs = 15000;
  private readonly maxSamples = 10;
  private pollSub: Subscription | null = null;
  private requestInFlight = false;

  cargandoInicial = true;
  actualizando = false;
  errorMensaje: string | null = null;
  errorCode: string | null = null;
  partialErrors: Record<string, string> = {};
  samples: SensorPollSample[] = [];
  historial: SensorHistorialRow[] = [];
  historialIntervaloMin = 30;
  historialError: string | null = null;

  estado: SensorEstadoView = {
    configured: false,
    deviceName: 'Sensor de agua',
    connected: null,
    volume: null,
    altura: null,
    pins: {},
    datastreams: [],
    diagnostics: this.diagnosticosVacios(),
    updatedAt: null
  };

  constructor(private backend: BackendServices) {}

  ngOnInit(): void {
    this.iniciarPolling();
    this.cargarHistorial();
    timer(60_000, 60_000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.cargarHistorial());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollSub) {
      this.pollSub.unsubscribe();
      this.pollSub = null;
    }
  }

  actualizarManual(): void {
    if (this.requestInFlight) {
      return;
    }
    this.cargarEstado(true).subscribe();
  }

  reintentar(): void {
    this.errorMensaje = null;
    this.errorCode = null;
    this.cargandoInicial = true;
    this.iniciarPolling();
  }

  get volumenTexto(): string {
    return this.formatearNumero(this.estado.volume, 1);
  }

  get alturaTexto(): string {
    return this.formatearNumero(this.estado.altura, 1);
  }

  get volumenClamp(): number {
    return this.clampPct(this.estado.volume);
  }

  get alturaClamp(): number {
    return this.clampPct(this.estado.altura);
  }

  get gaugeStrokeDashoffset(): number {
    const circumference = 2 * Math.PI * 54;
    return circumference * (1 - this.volumenClamp / 100);
  }

  get conexionLabel(): string {
    if (this.estado.connected === true) return 'Online';
    if (this.estado.connected === false) return 'Offline';
    return 'Desconocido';
  }

  get conexionClass(): string {
    if (this.estado.connected === true) return 'is-online';
    if (this.estado.connected === false) return 'is-offline';
    return 'is-unknown';
  }

  get recepcionClass(): string {
    const mode = this.estado.diagnostics?.reception?.mode;
    if (mode === 'live') return 'is-live';
    if (mode === 'cached') return 'is-cached';
    return 'is-none';
  }

  get ultimaActualizacionTexto(): string {
    return this.formatearFecha(this.estado.updatedAt);
  }

  get intervaloTexto(): string {
    return `${this.pollMs / 1000} s`;
  }

  get latenciaTexto(): string {
    const ms = this.estado.diagnostics?.latencyMs;
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
    return `${Math.round(Number(ms))} ms`;
  }

  get antiguedadReporteTexto(): string {
    return this.formatearEdad(this.estado.diagnostics?.reception?.ageSec);
  }

  get sesionTexto(): string {
    const sec = this.estado.diagnostics?.lastSessionDurationSec;
    if (sec === null || sec === undefined || !Number.isFinite(Number(sec))) return '—';
    return this.formatearEdad(Number(sec));
  }

  get heartbeatTexto(): string {
    const sec = this.estado.diagnostics?.heartbeatIntervalSec;
    if (sec === null || sec === undefined || !Number.isFinite(Number(sec))) return '—';
    return `${sec} s`;
  }

  get cloudLabel(): string {
    return this.estado.diagnostics?.cloudOk ? 'Nube Blynk alcanzada' : 'Sin respuesta de Blynk';
  }

  fechaDiag(iso: string | null | undefined): string {
    return this.formatearFecha(iso || null);
  }

  usoStream(stream: SensorDatastreamView): string {
    const pin = String(stream?.pin || '').toLowerCase();
    if (pin === String(this.estado.pins?.volume || '').toLowerCase() || stream.role === 'volume') {
      return 'Volumen';
    }
    if (pin === String(this.estado.pins?.altura || this.estado.pins?.range || '').toLowerCase()
      || stream.role === 'altura' || stream.role === 'range') {
      return 'Altura';
    }
    return '—';
  }

  valorStream(value: number | string | null): string {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n.toLocaleString('es-MX', { maximumFractionDigits: 2 });
    }
    return String(value);
  }

  formatearMuestra(value: number | null, decimals: number): string {
    return this.formatearNumero(value, decimals);
  }

  sampleEstado(sample: SensorPollSample): string {
    if (!sample.ok) return 'Error';
    if (sample.connected === true) return 'En vivo';
    if (sample.connected === false) return 'Caché';
    return 'Parcial';
  }

  historialEstado(row: SensorHistorialRow): string {
    if (row.lectura_ok === 1 || row.lectura_ok === true) return 'OK';
    return row.error_codigo || 'Error';
  }

  private cargarHistorial(): void {
    this.backend.obtenerHistorialSensores(48)
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res) => {
        if (!res) {
          this.historialError = 'No se pudo leer el historial guardado.';
          return;
        }
        this.historialError = null;
        this.historial = Array.isArray(res.lecturas)
          ? (res.lecturas as unknown as SensorHistorialRow[])
          : [];
        if (res.intervaloMs) {
          this.historialIntervaloMin = Math.max(1, Math.round(Number(res.intervaloMs) / 60000));
        }
      });
  }

  private iniciarPolling(): void {
    if (this.pollSub) {
      this.pollSub.unsubscribe();
      this.pollSub = null;
    }

    this.pollSub = timer(0, this.pollMs)
      .pipe(
        takeUntil(this.destroy$),
        exhaustMap(() => this.cargarEstado(false))
      )
      .subscribe();
  }

  private cargarEstado(manual: boolean) {
    if (this.requestInFlight) {
      return of(null);
    }

    this.requestInFlight = true;
    if (manual || !this.cargandoInicial) {
      this.actualizando = true;
    }

    return this.backend.obtenerEstadoSensores().pipe(
      tap((res) => {
        this.errorMensaje = null;
        this.errorCode = null;
        this.aplicarRespuesta(res);
        this.registrarMuestra(true);
      }),
      catchError((err) => {
        const body = err?.error || {};
        this.errorCode = body.code || null;
        this.errorMensaje =
          body.message ||
          (err?.status === 503
            ? 'Blynk no está configurado en el servidor.'
            : 'No se pudo obtener el estado del sensor.');

        if (body && (body.configured !== undefined || body.deviceName || body.updatedAt || body.diagnostics)) {
          this.aplicarRespuesta(body);
        }
        this.registrarMuestra(false);
        return of(null);
      }),
      finalize(() => {
        this.requestInFlight = false;
        this.cargandoInicial = false;
        this.actualizando = false;
      })
    );
  }

  private aplicarRespuesta(res: any): void {
    this.partialErrors = res?.partialErrors && typeof res.partialErrors === 'object' ? res.partialErrors : {};
    const diagnostics = this.normalizarDiagnosticos(res?.diagnostics);
    this.estado = {
      configured: !!res?.configured,
      deviceName: String(res?.deviceName || this.estado.deviceName || 'Sensor de agua'),
      connected: typeof res?.connected === 'boolean' ? res.connected : null,
      volume: this.aNumeroONull(res?.volume),
      altura: this.aNumeroONull(res?.altura ?? res?.range),
      pins: res?.pins && typeof res.pins === 'object' ? res.pins : this.estado.pins,
      datastreams: Array.isArray(res?.datastreams) ? res.datastreams : [],
      diagnostics,
      updatedAt: res?.updatedAt ? String(res.updatedAt) : this.estado.updatedAt
    };
  }

  private registrarMuestra(ok: boolean): void {
    this.samples = [
      {
        at: new Date().toISOString(),
        ok,
        connected: this.estado.connected,
        volume: this.estado.volume,
        altura: this.estado.altura,
        latencyMs: this.estado.diagnostics?.latencyMs ?? null
      },
      ...this.samples
    ].slice(0, this.maxSamples);
  }

  private diagnosticosVacios(): SensorDiagnosticsView {
    return {
      cloudOk: false,
      latencyMs: null,
      tokenHint: null,
      server: null,
      blynkStatus: null,
      lastReportedAt: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastSessionDurationSec: null,
      activatedAt: null,
      ip: null,
      country: null,
      boardType: null,
      blynkVersion: null,
      firmwareBuild: null,
      heartbeatIntervalSec: null,
      reception: {
        mode: 'none',
        label: 'Sin datos de recepción todavía.',
        ageSec: null
      }
    };
  }

  private normalizarDiagnosticos(raw: any): SensorDiagnosticsView {
    const base = this.diagnosticosVacios();
    if (!raw || typeof raw !== 'object') return base;
    return {
      cloudOk: !!raw.cloudOk,
      latencyMs: this.aNumeroONull(raw.latencyMs),
      tokenHint: raw.tokenHint ? String(raw.tokenHint) : null,
      server: raw.server ? String(raw.server) : null,
      blynkStatus: raw.blynkStatus ? String(raw.blynkStatus) : null,
      lastReportedAt: raw.lastReportedAt ? String(raw.lastReportedAt) : null,
      lastConnectedAt: raw.lastConnectedAt ? String(raw.lastConnectedAt) : null,
      lastDisconnectedAt: raw.lastDisconnectedAt ? String(raw.lastDisconnectedAt) : null,
      lastSessionDurationSec: this.aNumeroONull(raw.lastSessionDurationSec),
      activatedAt: raw.activatedAt ? String(raw.activatedAt) : null,
      ip: raw.ip ? String(raw.ip) : null,
      country: raw.country ? String(raw.country) : null,
      boardType: raw.boardType ? String(raw.boardType) : null,
      blynkVersion: raw.blynkVersion ? String(raw.blynkVersion) : null,
      firmwareBuild: raw.firmwareBuild ? String(raw.firmwareBuild) : null,
      heartbeatIntervalSec: this.aNumeroONull(raw.heartbeatIntervalSec),
      reception: {
        mode: raw.reception?.mode ? String(raw.reception.mode) : 'none',
        label: String(raw.reception?.label || base.reception.label),
        ageSec: this.aNumeroONull(raw.reception?.ageSec)
      }
    };
  }

  private clampPct(value: number | null): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return 0;
    }
    return Math.max(0, Math.min(100, Number(value)));
  }

  private aNumeroONull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private formatearNumero(value: number | null, decimals: number): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '--';
    }
    return Number(value).toLocaleString('es-MX', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  private formatearFecha(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('es-MX', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  private formatearEdad(sec: number | null | undefined): string {
    if (sec === null || sec === undefined || !Number.isFinite(Number(sec))) return '—';
    const s = Math.max(0, Math.round(Number(sec)));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${s % 60} s`;
    const h = Math.floor(m / 60);
    return `${h} h ${m % 60} min`;
  }
}
