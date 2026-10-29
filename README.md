# Sistema Dual ApoyAR - Trabajo Integrador Final

### Universidad de la Cuenca del Plata - Licenciatura en Sistemas de Información
**Estudiante:** Miguel Dario Coronel

---

## 🎯 Objetivo del Sistema

**ApoyAR** es una solución tecnológica integral dual (aplicación móvil y consola web) orientada a la protección ciudadana, auxilio rápido y preservación probatoria con validez legal ante situaciones de violencia por motivos de género y emergencias de seguridad personal.

El sistema articula dos frentes operativos:
1. **Aplicación Móvil (Usuaria / Contactos de Emergencia):** Permite la activación deliberada de emergencia (Modo Resguardo SOS), detección autónoma por voz/sonido en segundo plano (Edge AI con Vosk y YAMNet), Modo Invisible encubierto como calculadora funcional, telemetría GPS continua hacia la red de apoyo y preservación forense de evidencia cifrada en hardware y sellada con estampado de tiempo oficial RFC 3161 (TSA).
2. **Panel Web (Autoridades / Supervisión Judicial / Administración):** Centro de monitoreo cartográfico en tiempo real de alertas activas, auditoría de la cadena de custodia de evidencias y administración descentralizada de operadores institucionales.

---

## 🏛️ Paradigma y Frameworks

### Backend (FastAPI + Python 3.11)
* **Paradigma:** Programación Orientada a Objetos (POO) estructurada estrictamente bajo una **Arquitectura en 3 Capas (Three-Tier Architecture)** con inversión de dependencias:
  1. **Capa de Presentación / API (Routers):** Controladores RESTful desarrollados con **FastAPI**, validación de esquemas con **Pydantic** y autenticación JWT con control de acceso Anti-IDOR.
  2. **Capa de Lógica de Negocio / Aplicación (Servicios):** Orquestación del pipeline probatorio forense, despacho asíncrono de alertas push, gobernanza de visibilidad y consentimiento informado (Ley 25.326).
  3. **Capa de Acceso a Datos (Repositorios):** Implementación del patrón *Repository* interactuando con **Supabase (PostgreSQL 15+)** mediante cliente administrativo (`service_role`), políticas RLS (Row Level Security) y modelo de datos relacional normalizado en Tercera Forma Normal (3FN Canónica).
* **Motor de Inferencia Acústica (Edge AI):** Modelos locales Vosk (ASR fonético en español) y YAMNet ONNX Runtime para clasificación ambiental de audio, apoyados por **FFmpeg** para conversión de flujos a 16kHz PCM mono.

### Frontend (Mobile & Panel Web)
* **Paradigma:** Arquitectura orientada a componentes modulares reactivos, hooks tipados y separación estricta entre capa de presentación y servicios de telemetría/comunicación.
* **Frameworks y Herramientas:**
  * **App Móvil:** **React Native** con **Expo** (TypeScript), gestión de servicios en primer/segundo plano (Foreground Services), motor cartográfico con MapLibre GL y WebSockets CDC bidireccionales vía Supabase Realtime.
  * **Panel Web:** **Expo Web / React Native for Web** (TypeScript) optimizado para navegadores de escritorio, con soporte de accesibilidad (WCAG AAA) y monitoreo geográfico en tiempo real.

---

## 📁 Estructura del Proyecto

```text
ApoyAR/
├── backend/                  # Servidor API FastAPI, Servicios y Repositorios
│   ├── app/
│   │   ├── models/           # Modelos de Machine Learning (Vosk y YAMNet ONNX)
│   │   ├── repositories/     # Capa de persistencia y consultas a base de datos
│   │   ├── routers/          # Endpoints REST (Incidentes, Evidencias, Admin, etc.)
│   │   ├── schemas/          # Esquemas Pydantic de entrada y salida
│   │   └── services/         # Capa de lógica de negocio y custodia pericial
│   ├── migrations/           # Scripts de migración SQL (3FN y políticas RLS)
│   ├── tests/                # Suite de pruebas unitarias y de integración
│   ├── Dockerfile            # Definición de contenedor Docker para Backend
│   └── requirements.txt      # Dependencias de Python
│
├── panel-web/                # Consola de Supervisión Web (Expo Web)
│   ├── src/
│   │   ├── components/       # Componentes de UI y mapa interactivo
│   │   ├── lib/              # Cliente de conexión y configuración
│   │   └── theme/            # Tokens visuales y diseño accesible
│   ├── App.tsx               # Interfaz principal de monitoreo y auditoría
│   ├── Dockerfile            # Definición de contenedor Docker para Panel Web
│   └── package.json          # Dependencias de Node.js
│
├── mobile/                   # Aplicación Móvil Android (React Native / Expo)
│   ├── android/              # Configuración nativa Android y AndroidManifest
│   ├── src/
│   │   ├── components/       # Modales de evidencia, permisos y componentes UI
│   │   ├── contexts/         # Contextos globales (Autenticación y SOS)
│   │   ├── navigation/       # Navegadores de Víctima y Contacto de Emergencia
│   │   ├── screens/          # Pantallas (Home, Alerta, Calculadora, etc.)
│   │   └── services/         # Resguardo autónomo, IA acústica y batería
│   ├── App.tsx               # Entrada de la aplicación móvil
│   └── package.json          # Dependencias de la app móvil
│
├── docker-compose.yml        # Orquestador multi-contenedor (Backend + Panel Web)
├── .gitignore                # Reglas de exclusión de Git
└── README.md                 # Documentación técnica del proyecto
```

---

## 🚀 Guía de Ejecución

### Requisitos Previos
* **Docker Desktop** instalado y en ejecución.
* **Node.js** (v20 o superior) y **npm** instalados en el host.
* Dispositivos físicos Android con **Depuración por USB** activada (o emulador Android).

---

### 1. Iniciar Backend y Panel Web con Docker

Tanto el servidor FastAPI como la consola de supervisión web se ejecutan en contenedores Docker aislados:

1. Asegúrate de tener los archivos `.env` configurados en `backend/` y `panel-web/` con las credenciales de Supabase.
2. Desde la raíz del proyecto, ejecuta:
   ```powershell
   docker compose up --build -d
   ```
3. Verifica los servicios disponibles:
   * **Backend API:** `http://localhost:8000` (Documentación interactiva Swagger en `http://localhost:8000/docs`).
   * **Panel Web:** `http://localhost:8082`.

4. *(Opcional)* Para crear el usuario **Administrador** inicial:
   ```powershell
   docker compose exec backend python crear_admin.py --email admin@apoyar.gob.ar --password TuPasswordSegura123 --nombre "Admin" --apellido "Principal"
   ```

---

### 2. Iniciar la Aplicación Móvil (Host Terminal)

La app móvil se ejecuta en la terminal de la computadora para permitir la comunicación nativa por cable USB (ADB) hacia múltiples teléfonos y la generación del código QR sobre la red Wi-Fi local:

1. **Configurar la IP local:**
   Averigua la IP de tu computadora en la red local (`ipconfig` en Windows) y configúrala en `mobile/.env`:
   ```env
   EXPO_PUBLIC_API_BASE_URL=http://[TU_IP_LOCAL]:8000
   ```

2. **Instalar dependencias de la app móvil:**
   ```powershell
   cd mobile
   npm install
   ```

3. **Compilar e instalar en dispositivos físicos Android vía USB:**
   ```powershell
   # Compilar y desplegar en el primer teléfono conectado:
   npx expo run:android

   # O para instalar el APK compilado directamente en un segundo celular:
   adb -s <ID_DEL_SEGUNDO_DISPOSITIVO> install -r "android\app\build\outputs\apk\debug\app-debug.apk"
   ```

4. **Iniciar el servidor Metro Bundler (Recarga en vivo y código QR):**
   ```powershell
   npx expo start --dev-client
   ```
   * Puedes escanear el código QR desde los teléfonos o presionar `a` para abrir en el dispositivo conectado.

