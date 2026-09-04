import { Component, OnInit, OnDestroy } from '@angular/core';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { Router } from '@angular/router';

type Vista = 'login' | 'forgot' | 'verify' | 'newpass' | 'success';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  // Login
  usuario: string = '';
  contrasena: string = '';
  mensajeError: string = '';
  mensajeExito: string = '';
  cargando: boolean = false;

  // Navegación entre vistas
  vista: Vista = 'login';

  // Recuperación de contraseña
  resetIdentifier: string = '';
  resetCode: string = '';
  emailHint: string = '';
  resetToken: string = '';
  nuevaPassword: string = '';
  confirmarPassword: string = '';

  // Countdown timer
  countdown: number = 0;
  countdownDisplay: string = '';
  private countdownInterval: any = null;

  constructor(
    private router: Router, 
    private backendService: BackendServices,
    private authService: AuthService
  ) {}

  ngOnInit() {
    if (this.authService.isLoggedIn()) {
      this.redirigirSegunRol();
    }
  }

  ngOnDestroy() {
    this.limpiarCountdown();
  }

  // ============================================
  // LOGIN
  // ============================================

  private redirigirSegunRol(): void {
    const rol = this.authService.getRol()?.toLowerCase();
    if (rol === 'empresa') {
      this.router.navigate(['/curso-activos']);
    } else if (rol === 'doctor') {
      this.router.navigate(['/expedientes-medicos']);
    } else if (rol === 'proteccion_civil') {
      this.router.navigate(['/proteccion-civil']);
    } else if (rol === 'sgc') {
      this.router.navigate(['/sistema-gestion-calidad']);
    } else if (rol === 'ambiental') {
      this.router.navigate(['/ambiental']);
    } else if (rol === 'control_documental') {
      this.router.navigate(['/historial-cursos']);
    } else if (rol === 'iot') {
      this.router.navigate(['/sensores']);
    } else if (rol === 'rrhh') {
      this.router.navigate(['/recursos-humanos/colaboradores']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  public iniciarSesion() {
    this.mensajeError = '';
    
    if (!this.usuario || !this.contrasena) {
      this.mensajeError = 'Por favor ingresa usuario y contraseña';
      return;
    }

    this.cargando = true;

    this.backendService.login(this.usuario, this.contrasena).subscribe(
      (response: any) => {
        this.cargando = false;
        
        if (response.success === true && response.usuario) {
          if (response.token) {
            this.authService.setToken(response.token);
          }
          this.authService.setUsuario(response.usuario);
          this.usuario = '';
          this.contrasena = '';
          this.redirigirSegunRol();
        } else {
          this.mensajeError = response.message || 'Usuario o contraseña incorrectos';
        } 
      },
      (error) => {
        this.cargando = false;
        console.error('Error en la solicitud de login:', error);
        this.mensajeError = 'Error de conexión con el servidor';
      }
    );
  }

  // ============================================
  // RECUPERACIÓN DE CONTRASEÑA
  // ============================================

  mostrarRecuperacion(): void {
    this.vista = 'forgot';
    this.limpiarEstadoRecuperacion();
  }

  volverLogin(): void {
    this.vista = 'login';
    this.limpiarEstadoRecuperacion();
  }

  private limpiarEstadoRecuperacion(): void {
    this.mensajeError = '';
    this.mensajeExito = '';
    this.resetIdentifier = '';
    this.resetCode = '';
    this.emailHint = '';
    this.resetToken = '';
    this.nuevaPassword = '';
    this.confirmarPassword = '';
    this.limpiarCountdown();
  }

  /** Paso 1: Solicitar código de recuperación */
  solicitarCodigo(): void {
    this.mensajeError = '';
    this.mensajeExito = '';

    if (!this.resetIdentifier || !this.resetIdentifier.trim()) {
      this.mensajeError = 'Ingresa tu nombre de usuario o correo electrónico';
      return;
    }

    this.cargando = true;

    this.backendService.solicitarCodigoRecuperacion(this.resetIdentifier.trim()).subscribe(
      (res: any) => {
        this.cargando = false;
        if (res.success) {
          this.emailHint = res.email_hint || '';
          this.vista = 'verify';
          this.resetCode = '';
          this.mensajeError = '';
          this.iniciarCountdown(10 * 60); // 10 minutos
        } else {
          this.mensajeError = res.message || 'No se pudo procesar la solicitud';
        }
      },
      (error) => {
        this.cargando = false;
        if (error.status === 429) {
          this.mensajeError = error.error?.message || 'Espera antes de solicitar un nuevo código.';
        } else {
          this.mensajeError = 'Error de conexión con el servidor. Intenta de nuevo.';
        }
      }
    );
  }

  /** Reenviar código (desde la vista de verificación) */
  reenviarCodigo(): void {
    this.mensajeError = '';
    this.cargando = true;

    this.backendService.solicitarCodigoRecuperacion(this.resetIdentifier.trim()).subscribe(
      (res: any) => {
        this.cargando = false;
        if (res.success) {
          this.emailHint = res.email_hint || this.emailHint;
          this.resetCode = '';
          this.iniciarCountdown(10 * 60);
        } else {
          this.mensajeError = res.message;
        }
      },
      (error) => {
        this.cargando = false;
        if (error.status === 429) {
          this.mensajeError = error.error?.message || 'Espera antes de solicitar un nuevo código.';
        } else {
          this.mensajeError = 'Error de conexión. Intenta de nuevo.';
        }
      }
    );
  }

  /** Paso 2: Verificar código */
  verificarCodigo(): void {
    this.mensajeError = '';

    if (!this.resetCode || this.resetCode.length !== 6) {
      this.mensajeError = 'Ingresa el código de 6 dígitos';
      return;
    }

    this.cargando = true;

    this.backendService.verificarCodigoRecuperacion(this.resetIdentifier.trim(), this.resetCode.trim()).subscribe(
      (res: any) => {
        this.cargando = false;
        if (res.success) {
          this.resetToken = res.reset_token;
          this.vista = 'newpass';
          this.mensajeError = '';
          this.limpiarCountdown();
        } else {
          this.mensajeError = res.message || 'Código incorrecto';
        }
      },
      (error) => {
        this.cargando = false;
        this.mensajeError = 'Error de conexión. Intenta de nuevo.';
      }
    );
  }

  /** Paso 3: Establecer nueva contraseña */
  restablecerPassword(): void {
    this.mensajeError = '';

    if (!this.nuevaPassword || this.nuevaPassword.length < 6) {
      this.mensajeError = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    if (this.nuevaPassword !== this.confirmarPassword) {
      this.mensajeError = 'Las contraseñas no coinciden';
      return;
    }

    this.cargando = true;

    this.backendService.restablecerPassword(
      this.resetIdentifier.trim(),
      this.resetToken,
      this.nuevaPassword
    ).subscribe(
      (res: any) => {
        this.cargando = false;
        if (res.success) {
          this.vista = 'success';
          this.mensajeError = '';
        } else {
          this.mensajeError = res.message || 'No se pudo cambiar la contraseña';
        }
      },
      (error) => {
        this.cargando = false;
        this.mensajeError = 'Error de conexión. Intenta de nuevo.';
      }
    );
  }

  // ============================================
  // PASSWORD STRENGTH
  // ============================================

  get passwordStrength(): number {
    if (!this.nuevaPassword) return 0;
    let score = 0;
    const p = this.nuevaPassword;
    if (p.length >= 6) score += 20;
    if (p.length >= 8) score += 15;
    if (p.length >= 12) score += 10;
    if (/[a-z]/.test(p)) score += 10;
    if (/[A-Z]/.test(p)) score += 15;
    if (/[0-9]/.test(p)) score += 15;
    if (/[^a-zA-Z0-9]/.test(p)) score += 15;
    return Math.min(score, 100);
  }

  get passwordStrengthText(): string {
    const s = this.passwordStrength;
    if (s < 40) return 'Débil';
    if (s < 70) return 'Media';
    return 'Fuerte';
  }

  // ============================================
  // COUNTDOWN TIMER
  // ============================================

  private iniciarCountdown(seconds: number): void {
    this.limpiarCountdown();
    this.countdown = seconds;
    this.actualizarCountdownDisplay();

    this.countdownInterval = setInterval(() => {
      this.countdown--;
      this.actualizarCountdownDisplay();
      if (this.countdown <= 0) {
        this.limpiarCountdown();
      }
    }, 1000);
  }

  private actualizarCountdownDisplay(): void {
    const min = Math.floor(this.countdown / 60);
    const sec = this.countdown % 60;
    this.countdownDisplay = `${min}:${sec.toString().padStart(2, '0')}`;
  }

  private limpiarCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.countdown = 0;
  }
}
