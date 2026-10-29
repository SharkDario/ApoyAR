-- =============================================================================
-- ApoyAR — Migración 001: Esquema Completo para Iteración 1
-- Compatibilidad: Supabase (PostgreSQL 15+)
-- Orden: Las tablas se crean en orden de dependencias (sin FKs rotas).
--
-- DECISIONES DE ALCANCE (Iter 1):
--   INCLUIDAS: Persona, Usuario, Dispositivo_Usuario, Perfil, Modulo, Accion,
--              Permiso, Perfil_tiene_Permiso, Usuario_tiene_Perfil,
--              Red_Apoyo, Incidente, Evidencia, Alerta_Temprana.
--   INCLUIDAS (sin lógica activa todavía):
--              Historial_Incidente (tabla creada, triggers en Iter 2).
--   OMITIDAS:  Reporte_Judicial (solo en Iter 3+, requiere pipeline completo
--              de cadena de custodia).
--              Preservación Forense Multicapa (campos firma_hardware,
--              token_rfc3161 y prev_hash en Evidencia; arquitectura forense de costo cero).
-- =============================================================================

-- Habilitar la extensión para UUID si no está activa
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- SECCIÓN 1: IDENTIDAD Y AUTENTICACIÓN
-- =============================================================================

-- NOTA: Supabase crea automáticamente el esquema `auth` con la tabla `auth.users`.
-- La tabla `persona` y `usuario` del modelo se mapean así:
--   auth.users.id  ←→  usuario.id  (el UUID de Supabase Auth ES el id de usuario)
-- Por lo tanto, NO hay una tabla `usuario` separada en el esquema `public`;
-- los campos de credenciales (email, password_hash) los gestiona Supabase Auth.
-- La tabla `persona` almacena los datos biográficos adicionales 1:1 con auth.users.

CREATE TABLE IF NOT EXISTS public.persona (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK al usuario de Supabase Auth (1:1)
    usuario_id              UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre                  VARCHAR(100) NOT NULL,
    apellido                VARCHAR(100) NOT NULL,
    dni                     VARCHAR(20) NOT NULL UNIQUE,
    genero                  VARCHAR(30) NULL,
    fecha_nacimiento        DATE NULL,
    telefono                VARCHAR(20) NULL,
    direccion               VARCHAR(255) NULL,
    -- palabraClave_encriptada: solo para rol Víctima.
    -- Se completa en el onboarding post-registro, no en el registro inicial.
    -- Cifrado simétrico con clave derivada de la contraseña del usuario (Zero-Knowledge).
    palabraClave_encriptada VARCHAR(500) NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dispositivo_usuario (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Token de Expo Push Notifications (formato: ExponentPushToken[...])
    -- o FCM token directo. En Iter 1 se usa Expo Push API.
    expo_push_token VARCHAR(255) NULL UNIQUE,
    fcm_token       VARCHAR(255) NULL,
    plataforma      VARCHAR(20) NOT NULL CHECK (plataforma IN ('ios', 'android', 'web')),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    registrado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SECCIÓN 2: RBAC (Roles y Permisos)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.perfil (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(255) NULL,
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.modulo (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.accion (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.permiso (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion VARCHAR(255) NULL,
    modulo_id   UUID NOT NULL REFERENCES public.modulo(id) ON DELETE RESTRICT,
    accion_id   UUID NOT NULL REFERENCES public.accion(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.perfil_tiene_permiso (
    perfil_id  UUID NOT NULL REFERENCES public.perfil(id) ON DELETE CASCADE,
    permiso_id UUID NOT NULL REFERENCES public.permiso(id) ON DELETE CASCADE,
    PRIMARY KEY (perfil_id, permiso_id)
);

CREATE TABLE IF NOT EXISTS public.usuario_tiene_perfil (
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    perfil_id  UUID NOT NULL REFERENCES public.perfil(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, perfil_id)
);

-- =============================================================================
-- SECCIÓN 3: DOMINIO CORE — EMERGENCIAS, RED Y EVIDENCIA
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.red_apoyo (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    victima_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contacto_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parentesco  VARCHAR(50) NULL,
    estado      VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Restricción: un par (víctima, contacto) solo puede tener un vínculo
    UNIQUE (victima_id, contacto_id),
    -- Restricción: una persona no puede ser contacto de sí misma
    CHECK (victima_id <> contacto_id)
);

CREATE TABLE IF NOT EXISTS public.incidente (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    victima_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    latitud         DECIMAL(10, 8) NOT NULL,
    longitud        DECIMAL(11, 8) NOT NULL,
    direccion_aprox VARCHAR(255) NULL,
    -- origen: 'manual' = botón SOS. 'automatico' = Vosk/YAMNet (Iter 2+).
    origen          VARCHAR(50) NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'automatico')),
    estado          VARCHAR(20) NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'cerrado', 'falso_positivo', 'cancelado')),
    notas           TEXT NULL,
    fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log inmutable de cambios de estado del incidente.
-- Tabla creada en Iter 1; triggers y lógica activa en Iter 2.
CREATE TABLE IF NOT EXISTS public.historial_incidente (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incidente_id    UUID NOT NULL REFERENCES public.incidente(id) ON DELETE RESTRICT,
    cambiado_por_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    estado_anterior VARCHAR(20) NOT NULL,
    estado_nuevo    VARCHAR(20) NOT NULL,
    notas           TEXT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.evidencia (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incidente_id         UUID NOT NULL REFERENCES public.incidente(id) ON DELETE RESTRICT,
    usuario_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    tipo_archivo         VARCHAR(50) NOT NULL CHECK (tipo_archivo IN ('audio', 'video', 'imagen')),
    -- Ruta en Supabase Storage: ej. "evidencias/{incidente_id}/{uuid}.m4a"
    url_almacenamiento   VARCHAR(500) NOT NULL,
    -- Hash SHA-256 generado localmente en el dispositivo antes de subir.
    -- Implementa sellarCriptograficamente() del diagrama de clases.
    -- Capa 1: Firma asimétrica generada en hardware seguro (Android Keystore / TEE)
    firma_hardware       TEXT NOT NULL,
    -- Capa 2: TimeStampToken oficial emitido por TSA externa bajo IETF RFC 3161 (Base64)
    token_rfc3161        TEXT NULL,
    -- Capa 3: Puntero de encadenamiento criptográfico con el registro previo (Append-Only Log)
    prev_hash            VARCHAR(64) NULL,
    -- metadata_dispositivo: JSON libre con info del dispositivo captor (modelo, SO).
    metadata_dispositivo JSONB NULL,
    fecha_captura        TIMESTAMPTZ NOT NULL,
    sincronizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.alerta_temprana (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incidente_id UUID NOT NULL REFERENCES public.incidente(id) ON DELETE RESTRICT,
    -- contacto_id: usuario receptor de la alerta
    contacto_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    tipo_alerta VARCHAR(30) NOT NULL DEFAULT 'push' CHECK (tipo_alerta IN ('push', 'sms', 'in_app')),
    enviada_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leida_en    TIMESTAMPTZ NULL
);

-- =============================================================================
-- SECCIÓN 4: DATOS SEMILLA (Seed Data)
-- Perfiles y permisos básicos para el arranque del sistema.
-- =============================================================================

-- Perfiles base
INSERT INTO public.perfil (nombre, descripcion) VALUES
    ('Victima', 'Persona que registra incidentes y gestiona su red de apoyo.'),
    ('Contacto', 'Persona de confianza que recibe alertas de una víctima vinculada.'),
    ('Administrativo', 'Operador con acceso a gestión y reportes. Sin datos sensibles.')
ON CONFLICT (nombre) DO NOTHING;

-- Módulos del sistema
INSERT INTO public.modulo (nombre) VALUES
    ('alerta'), ('evidencia'), ('incidente'), ('contacto'), ('perfil')
ON CONFLICT (nombre) DO NOTHING;

-- Acciones elementales
INSERT INTO public.accion (nombre) VALUES
    ('crear'), ('leer'), ('actualizar'), ('eliminar'), ('emitir'), ('exportar')
ON CONFLICT (nombre) DO NOTHING;
