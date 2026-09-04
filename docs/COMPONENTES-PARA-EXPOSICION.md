# BIZNAGA R&T — Componentes y tecnologías (guía de exposición)

> Documento para explicar el sistema en una presentación.
> Fecha: 2026-09-02 · Versión de referencia del sistema: ver `package.json`

---

## 1. En una frase

**BIZNAGA R&T** es la plataforma web interna de Biznaga: un sistema de 3 capas (Angular + Node.js + MariaDB) que concentra capacitación, documentos, trámites y operación con empresas cliente.

**Dónde corre hoy**

| Pieza | Dónde | Dirección pública |
|---|---|---|
| Interfaz (frontend) | GoDaddy (Apache) | https://sistema.biznaga.com.mx |
| API (backend) | AWS Lightsail + PM2 | https://api.sistema.biznaga.com.mx |
| Datos | MariaDB 10.6 en GoDaddy | Acceso interno desde el API |

---

## 2. Cómo explicarlo en 30 segundos

> El usuario abre el navegador y entra a una página hecha en **Angular**. Esa página no guarda los datos: cada acción (iniciar sesión, ver un curso, subir un archivo) viaja por HTTPS al **backend en Node.js**, que está en un servidor de **AWS**. El backend valida quién es (JWT), aplica reglas de negocio y consulta **MariaDB** en GoDaddy. Los archivos grandes viven en **Google Drive**. En desarrollo local, la base se levanta con **Docker** para no tocar producción.

---

## 3. Diagrama de arquitectura (producción)

```
Usuario (navegador)
        │
        │  HTTPS
        ▼
┌───────────────────────────────────┐
│  FRONTEND  — Angular 14           │
│  GoDaddy · Apache 2.4             │
│  sistema.biznaga.com.mx           │
└───────────────┬───────────────────┘
                │  REST + JWT + Socket.io
                │  HTTPS
                ▼
┌───────────────────────────────────┐
│  BACKEND  — Node.js + Express 5   │
│  AWS Lightsail · PM2 · Nginx      │
│  api.sistema.biznaga.com.mx       │
└───────┬───────────────┬───────────┘
        │               │
        │ TCP 3306      │ APIs
        ▼               ▼
┌──────────────┐  Google Drive / Forms / Gmail
│  MariaDB     │  Blynk (sensores)
│  GoDaddy     │
└──────────────┘
```

**Frase para el público:** “La cara está en GoDaddy, el cerebro en AWS, la memoria en MariaDB de GoDaddy.”

---

## 4. Componentes (qué es y para qué lo usamos)

Usar esta tabla como “ficha de cada tecnología”. Para cada una: **qué es → analogía → para qué en Biznaga**.

### 4.1 Angular 14 (frontend)

| | |
|---|---|
| **Qué es** | Framework de Google para construir aplicaciones web de una sola página (SPA). Se escribe en TypeScript. |
| **Analogía** | El mostrador y las pantallas que ve el usuario. |
| **En Biznaga** | Toda la interfaz: menús por rol, cursos, SGC, médicos, mantenimiento, correo, etc. |
| **Piezas internas** | Componentes, rutas, *guards* (quién entra a cada pantalla), *interceptors* (pegan el JWT a cada llamada), servicios HTTP. |
| **UI** | Bootstrap 4.6, Angular Material, SCSS, plantilla Argon Dashboard. |
| **Extras** | Gráficas (ApexCharts, Chart.js, ECharts), PDF en el navegador (jsPDF, pdf.js), Excel (xlsx), alertas (SweetAlert2, Toastr). |

**Cómo decirlo:** “Angular no es la base de datos: es la aplicación que corre en el navegador. Cuando das clic, Angular pide datos al API.”

---

### 4.2 TypeScript / JavaScript

| | |
|---|---|
| **TypeScript** | JavaScript con tipos. Se usa en el frontend Angular. |
| **JavaScript (CommonJS)** | Lenguaje del backend (`backend/*.js`). |
| **Analogía** | TypeScript es el plano con medidas; JavaScript es el idioma que entiende el servidor. |

---

### 4.3 Node.js + Express 5 (backend)

| | |
|---|---|
| **Qué es Node.js** | Entorno para ejecutar JavaScript **en el servidor** (no en el navegador). |
| **Qué es Express** | Framework HTTP encima de Node: define rutas `/api/...`, recibe JSON, responde. |
| **Analogía** | Node es el motor; Express es el mostrador de ventanillas (cada ruta es una ventanilla). |
| **En Biznaga** | Toda la lógica: login, cursos, documentos, tickets, SGC, sensores, correo, Drive. Archivo principal: `backend/server.js`. |
| **Proceso en producción** | **PM2** mantiene el proceso `biznaga-api` vivo y lo reinicia si cae. |
| **Frente al internet** | **Nginx** en Lightsail termina HTTPS y reenvía al Node (límite de subida 512 MB para PDFs/evidencias). |

Otras librerías del API que conviene nombrar si preguntan:

- **mysql2** — conexión a MariaDB (pool de conexiones)
- **jsonwebtoken + bcryptjs** — sesión (JWT) y contraseñas hasheadas
- **cors + express-rate-limit** — orígenes permitidos y límite de peticiones
- **multer** — subida de archivos
- **googleapis** — Drive, Forms, Slides
- **nodemailer + imapflow** — enviar y leer correo
- **exceljs / pdf-lib / pdfkit / sharp** — Excel, PDF e imágenes en servidor
- **socket.io** — chat en tiempo real (asesoría empresas)

---

### 4.4 MariaDB / MySQL (base de datos)

| | |
|---|---|
| **Qué es** | Motor de base de datos relacional (tablas, SQL). MariaDB es compatible con MySQL. |
| **Analogía** | El archivo maestro: usuarios, cursos, trámites, expedientes. |
| **Producción** | MariaDB 10.6 en el hosting de **GoDaddy**. El API en AWS se conecta por red (puerto 3306). |
| **Estrategia** | Varias bases por dominio, no un solo “dump” gigante. |

Bases (nombres de desarrollo → idea de producción):

| Desarrollo (Docker) | Dominio |
|---|---|
| `biznaga` | Principal: usuarios, empresas, cursos, tickets… |
| `medicos_biznaga` | Expedientes médicos |
| `proteccion_civil` | Protección civil / PIPC |
| `biznaga_sgc` | Sistema de Gestión de Calidad |
| `sensores` | Historial IoT |

**Cómo decirlo:** “No mezclamos expedientes médicos con el catálogo de cursos. Cada área tiene su base, el mismo servidor las hospeda.”

---

### 4.5 Docker (solo desarrollo)

| | |
|---|---|
| **Qué es** | Emppaqueta un programa (aquí: MariaDB y phpMyAdmin) en un contenedor reproducible. |
| **Analogía** | Una caja con la base de datos lista: la abres en cualquier PC y queda igual. |
| **En Biznaga** | `docker-compose.yml` levanta **MariaDB 10.6** (puerto 3306) y **phpMyAdmin** (http://localhost:8080). **No** corre el frontend ni el API dentro de Docker. |
| **Producción** | Docker **no** hospeda el sistema. Producción es GoDaddy + AWS Lightsail. |

**Cómo decirlo:** “Docker nos da una base local para no ensayar contra la base real de clientes.”

Comando típico: `docker compose up -d` → luego `npm start` (Angular + Node en la PC).

---

### 4.6 AWS Lightsail (servidor del backend)

| | |
|---|---|
| **Qué es** | Servicio de Amazon: máquina virtual en la nube, más simple que EC2 “a la carta”. |
| **Analogía** | Una computadora alquilada en un data center de Amazon, encendida 24/7. |
| **En Biznaga** | Ahí vive **solo el backend** (Node + PM2 + Nginx). Usuario Linux `ubuntu`. |
| **URL** | https://api.sistema.biznaga.com.mx |
| **Qué no es** | No es donde está la página que ves ni la base de datos. |

**Cómo decirlo:** “Pasamos el API de una Raspberry a AWS para tener un servidor estable, con HTTPS propio y sin depender de un equipo en oficina.”

---

### 4.7 GoDaddy (frontend + base de datos)

| | |
|---|---|
| **Qué es** | Hosting compartido (Apache) + MariaDB del dominio. |
| **Frontend** | Archivos estáticos del build Angular (`dist/`) + `.htaccess` para que las rutas SPA no den 404. |
| **Base de datos** | MariaDB de producción. |
| **URL** | https://sistema.biznaga.com.mx |

**Cómo decirlo:** “GoDaddy sirve la aplicación al mundo y guarda los datos. AWS ejecuta la lógica.”

---

### 4.8 HTTPS, Apache y Nginx

| Pieza | Dónde | Rol |
|---|---|---|
| **Apache 2.4** | GoDaddy | Sirve el frontend y reescribe URLs al `index.html` (SPA). |
| **Nginx** | AWS Lightsail | Proxy inverso: HTTPS → proceso Node; subidas grandes. |
| **HTTPS / SSL** | Ambos dominios | Cifrado del tráfico (login, documentos, tokens). |

---

### 4.9 JWT (autenticación)

| | |
|---|---|
| **Qué es** | JSON Web Token: un “pase” firmado que el servidor emite al iniciar sesión. |
| **Flujo** | Login → el API devuelve el token → Angular lo guarda en `sessionStorage` → el *interceptor* lo manda en `Authorization: Bearer …` en cada request. |
| **Roles** | `root`, administrador, instructor, empresa, doctor, sgc, ambiental, etc. El menú y las rutas se filtran con **RoleGuard**. |
| **Analogía** | Un gafete temporal: sin él no entras a las oficinas del API. |

---

### 4.10 Integraciones externas

| Tecnología | Capa | Para qué |
|---|---|---|
| **Google Drive** | Backend | Carpetas y evidencias de cursos, repositorios, firmas, documentos. |
| **Google Forms** | Backend | Encuestas de satisfacción por curso. |
| **Google Slides** | Backend | Plantillas de constancias. |
| **Google Calendar** | Frontend | Agenda / calendario de la operación. |
| **Gmail (SMTP + IMAP)** | Backend | Envío y buzón interno (`nodemailer`, `imapflow`). |
| **Blynk** | Backend | Sensores IoT (humedad/otros) → módulo Sensorización. |
| **Socket.io** | Ambos | Chat de asesoría con empresas en tiempo real. |

---

### 4.11 Git, npm y el deploy

| Pieza | Rol |
|---|---|
| **Git / GitHub** | Versionado del código. Rama de trabajo típica: `capacitacion`. |
| **npm** | Instala librerías (`package.json` del frontend y de `backend/`). |
| **`npm start`** | En local: arranca API + Angular a la vez (`concurrently`). |
| **`ng build`** | Compila Angular a archivos estáticos en `dist/` (lo que se sube a GoDaddy). |
| **`deploy.ps1`** | Script de producción: ZIP del frontend → GoDaddy; backend → Lightsail; reinicio PM2. |

---

## 5. Desarrollo vs producción (para que no se confundan)

| | Desarrollo (tu PC) | Producción |
|---|---|---|
| Frontend | `ng serve` → http://localhost:4200 | GoDaddy |
| Backend | `node server.js` (p. ej. puerto 3100) | AWS Lightsail + PM2 |
| Base de datos | Docker MariaDB 10.6 | MariaDB GoDaddy |
| phpMyAdmin | Docker :8080 | cPanel GoDaddy |
| Docker | Sí (solo BD) | No hospeda la app |

---

## 6. Recorrido de una petición (para cerrar la exposición)

Ejemplo: un instructor abre “Cursos activos”.

1. El navegador ya tiene Angular cargado desde GoDaddy.
2. Angular llama `GET https://api.sistema.biznaga.com.mx/api/...` con el JWT.
3. Nginx en AWS recibe la petición y la pasa a Node (PM2).
4. Express verifica el token, el rol y consulta MariaDB en GoDaddy.
5. Responde JSON.
6. Angular pinta la tabla.

Si hay un archivo de evidencia, el API lo sube o lo lee de **Google Drive**, no de la tabla SQL.

---

## 7. Glosario rápido (preguntas del público)

| Pregunta | Respuesta corta |
|---|---|
| ¿Es una app móvil? | No: es web (SPA). Se usa en el navegador. |
| ¿Es microservicios? | No: **monolito modular** (un API, muchos servicios/archivos). |
| ¿Dónde está la Raspberry / Tailscale? | Arquitectura anterior. Hoy el API está en **AWS Lightsail**. |
| ¿Por qué la BD no está en AWS? | Histórico/operativo: MariaDB sigue en GoDaddy; el API se conecta en remoto. |
| ¿Angular guarda los cursos? | No. Solo muestra; los datos están en MariaDB. |
| ¿Qué es PM2? | Supervisor: si Node se cae, lo vuelve a levantar. |
| ¿Qué es un SPA? | Una sola página HTML; Angular cambia de pantalla sin recargar todo el sitio. |

---

## 8. Orden sugerido de diapositivas

1. Qué problema resuelve Biznaga (capacitación + operación + cumplimiento).
2. Frase: cara GoDaddy / cerebro AWS / memoria MariaDB.
3. Diagrama de 3 capas.
4. Angular (lo que se ve).
5. Node + Express + PM2 + Nginx (lo que decide).
6. MariaDB y bases por dominio.
7. Docker solo en desarrollo.
8. Google Drive / correo / sensores.
9. Seguridad: HTTPS + JWT + roles.
10. Demo o recorrido de una petición.
