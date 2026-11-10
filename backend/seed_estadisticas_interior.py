# -*- coding: utf-8 -*-
"""
Script reversible de poblamiento estadístico para el interior de la Provincia de Formosa
(Homologado con la distribución territorial y demográfica del Informe Hestia 2025).

Características para Supabase Free Tier:
  - CERO archivos en Supabase Storage y CERO filas en la tabla `evidencia`.
  - No envía correos electrónicos (usa Admin API con email_confirm=True).
  - Crea 16 usuarias ficticias y 61 incidentes cerrados distribuidos exclusivamente
    en los 8 departamentos del interior provincial (fuera de Formosa Capital),
    con fecha de inicio (`inc_fecha_hora`) y fecha de fin (`hisinc_creado_en` en
    `historial_incidente`) para nutrir mapas de calor, curvas horarias y duraciones.
  - 100 % REVERSIBLE: Todo registro lleva la etiqueta `[SIM-HESTIA-INTERIOR]` y el
    dominio `@sim-hestia.apoyar.local`, permitiendo borrar todo con `--limpiar`.

Uso (desde la carpeta `backend/`):
  1) Ver estado actual:   python seed_estadisticas_interior.py --estado
  2) Simular sin guardar: python seed_estadisticas_interior.py --cargar --dry-run
  3) Cargar datos:        python seed_estadisticas_interior.py --cargar
  4) Borrar datos:        python seed_estadisticas_interior.py --limpiar
"""

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from app.database import supabase_admin

# ─────────────────────────────────────────────────────────────────────────────
# MARCADORES DE IDENTIFICACIÓN PARA BORRADO SEGURO (REVERSIBILIDAD)
# ─────────────────────────────────────────────────────────────────────────────
DOMINIO_SIMULACION = "@sim-hestia.apoyar.local"
TAG_SIMULACION = "[SIM-HESTIA-INTERIOR]"
PREFIJO_DNI_SIM = "9988"

# ─────────────────────────────────────────────────────────────────────────────
# CATÁLOGO GEORREFERENCIADO DEL INTERIOR DE FORMOSA (8 DEPARTAMENTOS, SIN CAPITAL)
# Proporciones inspiradas en el Informe Hestia 2025 (Pilcomayo, Patiño, Pirané,
# Laishí, Pilagás, Matacos, Bermejo y Ramón Lista).
# ─────────────────────────────────────────────────────────────────────────────
LOCALIDADES_INTERIOR: List[Dict[str, Any]] = [
    # 1. DEPARTAMENTO PILCOMAYO (Alta densidad en Hestia: Clorinda Zonas 1 a 4, Laguna Blanca, Riacho He-Hé)
    {
        "departamento": "Pilcomayo",
        "localidad": "Clorinda",
        "barrio": "B° 1ro de Mayo (Zona 3)",
        "lat": -25.2842,
        "lon": -57.7285,
        "peso": 6,
    },
    {
        "departamento": "Pilcomayo",
        "localidad": "Clorinda",
        "barrio": "B° Porteño Norte (Zona 4)",
        "lat": -25.2768,
        "lon": -57.7112,
        "peso": 5,
    },
    {
        "departamento": "Pilcomayo",
        "localidad": "Clorinda",
        "barrio": "B° 25 de Mayo (Zona 1)",
        "lat": -25.2915,
        "lon": -57.7210,
        "peso": 4,
    },
    {
        "departamento": "Pilcomayo",
        "localidad": "Clorinda",
        "barrio": "B° Juan Domingo Perón - 742 Viviendas (Zona 2)",
        "lat": -25.2980,
        "lon": -57.7340,
        "peso": 3,
    },
    {
        "departamento": "Pilcomayo",
        "localidad": "Laguna Blanca",
        "barrio": "B° Centro",
        "lat": -25.1264,
        "lon": -58.2458,
        "peso": 3,
    },
    {
        "departamento": "Pilcomayo",
        "localidad": "Riacho He-Hé",
        "barrio": "Zona Urbana",
        "lat": -25.3619,
        "lon": -58.2775,
        "peso": 2,
    },
    # 2. DEPARTAMENTO PATIÑO (Las Lomitas Zonas 1 a 6, Gral. Belgrano, Ibarreta, Pozo del Tigre, Estanislao del Campo, Cte. Fontana)
    {
        "departamento": "Patiño",
        "localidad": "Las Lomitas",
        "barrio": "B° Eva Perón (Zona 3)",
        "lat": -24.7065,
        "lon": -60.5912,
        "peso": 4,
    },
    {
        "departamento": "Patiño",
        "localidad": "Las Lomitas",
        "barrio": "B° Nueva Esperanza (Zona 4)",
        "lat": -24.7128,
        "lon": -60.5985,
        "peso": 3,
    },
    {
        "departamento": "Patiño",
        "localidad": "General Manuel Belgrano",
        "barrio": "Zona Centro",
        "lat": -24.9189,
        "lon": -58.9992,
        "peso": 3,
    },
    {
        "departamento": "Patiño",
        "localidad": "Ibarreta",
        "barrio": "B° Obrero",
        "lat": -25.2144,
        "lon": -59.8586,
        "peso": 2,
    },
    {
        "departamento": "Patiño",
        "localidad": "Pozo del Tigre",
        "barrio": "Zona Urbana",
        "lat": -24.8967,
        "lon": -60.3236,
        "peso": 2,
    },
    {
        "departamento": "Patiño",
        "localidad": "Comandante Fontana",
        "barrio": "B° San Antonio",
        "lat": -25.3347,
        "lon": -59.6822,
        "peso": 2,
    },
    # 3. DEPARTAMENTO PIRANÉ (El Colorado, Pirané, Palo Santo)
    {
        "departamento": "Pirané",
        "localidad": "El Colorado",
        "barrio": "B° San Miguel",
        "lat": -26.3083,
        "lon": -59.3728,
        "peso": 4,
    },
    {
        "departamento": "Pirané",
        "localidad": "Pirané",
        "barrio": "B° Centro",
        "lat": -25.7328,
        "lon": -59.1089,
        "peso": 3,
    },
    {
        "departamento": "Pirané",
        "localidad": "Palo Santo",
        "barrio": "Zona Urbana",
        "lat": -25.5633,
        "lon": -59.3375,
        "peso": 2,
    },
    # 4. DEPARTAMENTO LAISHÍ (San Francisco de Laishí, Villa Escolar)
    {
        "departamento": "Laishí",
        "localidad": "San Francisco de Laishí",
        "barrio": "B° Centro",
        "lat": -26.2425,
        "lon": -58.6294,
        "peso": 2,
    },
    {
        "departamento": "Laishí",
        "localidad": "Villa Escolar",
        "barrio": "Zona Urbana",
        "lat": -26.6119,
        "lon": -58.6714,
        "peso": 1,
    },
    # 5. DEPARTAMENTO PILAGÁS (El Espinillo, Misión Tacaaglé, Tres Lagunas)
    {
        "departamento": "Pilagás",
        "localidad": "El Espinillo",
        "barrio": "Zona Urbana",
        "lat": -24.9694,
        "lon": -58.5508,
        "peso": 2,
    },
    {
        "departamento": "Pilagás",
        "localidad": "Tres Lagunas",
        "barrio": "Zona Urbana",
        "lat": -25.2056,
        "lon": -58.7161,
        "peso": 1,
    },
    # 6. DEPARTAMENTO MATACOS (Ingeniero Guillermo N. Juárez)
    {
        "departamento": "Matacos",
        "localidad": "Ingeniero Guillermo N. Juárez",
        "barrio": "B° Obrero",
        "lat": -23.9006,
        "lon": -61.8544,
        "peso": 3,
    },
    # 7. DEPARTAMENTO BERMEJO (Laguna Yema, Los Chiriguanos)
    {
        "departamento": "Bermejo",
        "localidad": "Laguna Yema",
        "barrio": "Zona Centro",
        "lat": -24.2539,
        "lon": -61.2450,
        "peso": 2,
    },
    # 8. DEPARTAMENTO RAMÓN LISTA (El Chorro / Gral. Mosconi, El Potrillo)
    {
        "departamento": "Ramón Lista",
        "localidad": "El Chorro (Gral. Enrique Mosconi)",
        "barrio": "Zona Urbana",
        "lat": -23.1681,
        "lon": -62.0883,
        "peso": 2,
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# PERFILES DEMOGRÁFICOS DE VÍCTIMAS FICTICIAS (16 USUARIAS EN EL INTERIOR)
# Rangos etarios alineados a Hestia 2025: predominio 30-39 (29,5 %), 22-29 (24,3 %),
# 40-49 (17,9 %), 18-21, 50-59 y 60-74.
# ─────────────────────────────────────────────────────────────────────────────
VICTIMAS_FICTICIAS: List[Dict[str, Any]] = [
    {"slug": "clorinda.01", "nombre": "Valeria", "apellido": "Gómez", "fecha_nac": "1992-04-14", "genero": "Femenino", "loc_idx": 0},
    {"slug": "clorinda.02", "nombre": "Romina", "apellido": "Benítez", "fecha_nac": "1998-09-21", "genero": "Femenino", "loc_idx": 1},
    {"slug": "clorinda.03", "nombre": "Natalia", "apellido": "Villalba", "fecha_nac": "1983-11-05", "genero": "Femenino", "loc_idx": 2},
    {"slug": "clorinda.04", "nombre": "Camila", "apellido": "Báez", "fecha_nac": "2005-02-18", "genero": "Femenino", "loc_idx": 3},
    {"slug": "lagunablanca.01", "nombre": "Miriam", "apellido": "Acosta", "fecha_nac": "1972-07-30", "genero": "Femenino", "loc_idx": 4},
    {"slug": "lomitas.01", "nombre": "Soledad", "apellido": "Rojas", "fecha_nac": "1990-01-12", "genero": "Femenino", "loc_idx": 6},
    {"slug": "lomitas.02", "nombre": "Andrea", "apellido": "Ledesma", "fecha_nac": "1996-06-25", "genero": "Femenino", "loc_idx": 7},
    {"slug": "belgrano.01", "nombre": "Cintia", "apellido": "Mendoza", "fecha_nac": "1988-03-09", "genero": "Femenino", "loc_idx": 8},
    {"slug": "ibarreta.01", "nombre": "Lorena", "apellido": "Cabrera", "fecha_nac": "1980-12-03", "genero": "Femenino", "loc_idx": 9},
    {"slug": "elcolorado.01", "nombre": "Florencia", "apellido": "giménez", "fecha_nac": "1999-08-17", "genero": "Femenino", "loc_idx": 12},
    {"slug": "pirane.01", "nombre": "Silvina", "apellido": "Duarte", "fecha_nac": "1993-05-29", "genero": "Femenino", "loc_idx": 13},
    {"slug": "laishi.01", "nombre": "Marta", "apellido": "Cardozo", "fecha_nac": "1961-10-11", "genero": "Femenino", "loc_idx": 15},
    {"slug": "espinillo.01", "nombre": "Yesica", "apellido": "Peralta", "fecha_nac": "2001-04-02", "genero": "Femenino", "loc_idx": 17},
    {"slug": "juarez.01", "nombre": "Patricia", "apellido": "Ramírez", "fecha_nac": "1986-07-19", "genero": "Femenino", "loc_idx": 19},
    {"slug": "yema.01", "nombre": "Gabriela", "apellido": "Torres", "fecha_nac": "1994-11-23", "genero": "Femenino", "loc_idx": 20},
    {"slug": "elchorro.01", "nombre": "Norma", "apellido": "Medina", "fecha_nac": "1975-09-08", "genero": "Femenino", "loc_idx": 21},
]

PARENTESCOS_SIM = ["Familiar", "Hermano/a", "Madre/Padre", "Vecino/a", "Amistad"]


def consultar_estado() -> None:
    """Muestra cuántos usuarios e incidentes simulados existen actualmente en Supabase."""
    print("=== Estado actual de datos simulados ([SIM-HESTIA-INTERIOR]) ===")
    res_usu = (
        supabase_admin.table("usuario")
        .select("usu_id_usuario, usu_email, per_id_persona")
        .ilike("usu_email", f"%{DOMINIO_SIMULACION}")
        .execute()
    )
    usuarios = res_usu.data or []

    res_inc = (
        supabase_admin.table("incidente")
        .select("inc_id_incidente, inc_origen, inc_estado, inc_direccion_aprox")
        .ilike("inc_notas", f"%{TAG_SIMULACION}%")
        .execute()
    )
    incidentes = res_inc.data or []

    print(f"  • Usuarias ficticias registradas ({DOMINIO_SIMULACION}): {len(usuarios)}")
    print(f"  • Incidentes del interior registrados ({TAG_SIMULACION}): {len(incidentes)}")
    if incidentes:
        por_origen: Dict[str, int] = {}
        for inc in incidentes:
            orig = inc.get("inc_origen", "desconocido")
            por_origen[orig] = por_origen.get(orig, 0) + 1
        print(f"  • Desglose por origen de disparo: {por_origen}")


def limpiar_datos_simulados() -> None:
    """Elimina de forma íntegra y exclusiva los usuarios e incidentes creados por este script."""
    print("=== Iniciando limpieza de datos simulados ([SIM-HESTIA-INTERIOR]) ===")

    # 1. Localizar usuarios simulados
    res_usu = (
        supabase_admin.table("usuario")
        .select("usu_id_usuario, per_id_persona, usu_email")
        .ilike("usu_email", f"%{DOMINIO_SIMULACION}")
        .execute()
    )
    usuarios_sim = res_usu.data or []
    usu_ids = [u["usu_id_usuario"] for u in usuarios_sim if u.get("usu_id_usuario")]
    per_ids = [u["per_id_persona"] for u in usuarios_sim if u.get("per_id_persona")]

    # 2. Localizar incidentes simulados por etiqueta en inc_notas o por usu_id_victima
    res_inc = (
        supabase_admin.table("incidente")
        .select("inc_id_incidente")
        .ilike("inc_notas", f"%{TAG_SIMULACION}%")
        .execute()
    )
    inc_ids = [i["inc_id_incidente"] for i in (res_inc.data or []) if i.get("inc_id_incidente")]

    if usu_ids:
        res_inc_usu = (
            supabase_admin.table("incidente")
            .select("inc_id_incidente")
            .in_("usu_id_victima", usu_ids)
            .execute()
        )
        for fila in res_inc_usu.data or []:
            if fila["inc_id_incidente"] not in inc_ids:
                inc_ids.append(fila["inc_id_incidente"])

    if not usu_ids and not inc_ids:
        print("✓ No se encontraron datos simulados para borrar. La base está limpia.")
        return

    # 3. Borrar historial_incidente e incidente en orden de clave foránea
    if inc_ids:
        supabase_admin.table("historial_incidente").delete().in_("inc_id_incidente", inc_ids).execute()
        print(f"✓ Historial de {len(inc_ids)} incidentes simulados eliminado.")
        supabase_admin.table("incidente").delete().in_("inc_id_incidente", inc_ids).execute()
        print(f"✓ {len(inc_ids)} incidentes simulados eliminados de `incidente`.")

    # 4. Borrar vínculos de red_apoyo, usuario_tiene_perfil, usuario, persona y auth.users
    if usu_ids:
        supabase_admin.table("red_apoyo").delete().in_("usu_id_victima", usu_ids).execute()
        supabase_admin.table("red_apoyo").delete().in_("usu_id_contacto", usu_ids).execute()
        supabase_admin.table("usuario_tiene_perfil").delete().in_("usu_id_usuario", usu_ids).execute()
        supabase_admin.table("usuario").delete().in_("usu_id_usuario", usu_ids).execute()

    if per_ids:
        supabase_admin.table("persona").delete().in_("per_id_persona", per_ids).execute()

    # También limpiar cualquier persona remanente con DNI prefijo 9988
    supabase_admin.table("persona").delete().ilike("per_dni", f"{PREFIJO_DNI_SIM}%").execute()

    eliminados_auth = 0
    for uid in usu_ids:
        try:
            supabase_admin.auth.admin.delete_user(uid)
            eliminados_auth += 1
        except Exception as exc:
            print(f"  Aviso al eliminar usuario {uid} en Auth: {exc}")

    print(f"✓ {eliminados_auth} cuentas ficticias eliminadas de Supabase Auth y tablas públicas.")
    print("🎉 Limpieza completada con éxito.")


def cargar_datos_simulados(dry_run: bool = False) -> None:
    """Crea las usuarias ficticias y los incidentes cerrados con su historial de cierre."""
    rng = random.Random(20250511)  # Semilla fija reproducible
    ahora = datetime.now(timezone.utc)

    # Construir bolsa ponderada de localidades del interior (48 incidentes en total)
    bolsa_localidades: List[Dict[str, Any]] = []
    for loc in LOCALIDADES_INTERIOR:
        bolsa_localidades.extend([loc] * loc["peso"])
    rng.shuffle(bolsa_localidades)
    total_incidentes = len(bolsa_localidades)

    print(f"=== Preparando carga de {len(VICTIMAS_FICTICIAS)} usuarias y {total_incidentes} incidentes en el interior ===")
    if dry_run:
        print("  [MODO DRY-RUN: No se escribirá nada en Supabase]")
        resumen_dptos: Dict[str, int] = {}
        for loc in bolsa_localidades:
            dpto = loc["departamento"]
            resumen_dptos[dpto] = resumen_dptos.get(dpto, 0) + 1
        print("  • Distribución prevista por Departamento del interior:")
        for dpto, cant in sorted(resumen_dptos.items(), key=lambda x: x[1], reverse=True):
            print(f"      - {dpto}: {cant} incidentes")
        return

    # Verificar que no estén ya cargados para evitar duplicados accidentales
    existentes = (
        supabase_admin.table("incidente")
        .select("inc_id_incidente", count="exact")
        .ilike("inc_notas", f"%{TAG_SIMULACION}%")
        .execute()
    )
    if existentes.count and existentes.count > 0:
        print(f"AVISO: Ya existen {existentes.count} incidentes simulados en la base de datos.")
        print("Ejecuta primero `python seed_estadisticas_interior.py --limpiar` si deseas regenerarlos.")
        sys.exit(0)

    # 1. Crear o recuperar las 16 usuarias ficticias en Supabase Auth + persona + usuario
    usu_ids_creados: List[str] = []
    mapa_victima_nombre: Dict[str, str] = {}

    for idx, vic in enumerate(VICTIMAS_FICTICIAS, start=1):
        email = f"victima.{vic['slug']}{DOMINIO_SIMULACION}"
        dni = f"{PREFIJO_DNI_SIM}{idx:04d}"
        telefono = f"+5493718{idx:06d}"
        loc_base = LOCALIDADES_INTERIOR[vic["loc_idx"]]
        direccion_domicilio = f"{loc_base['barrio']}, {loc_base['localidad']}, Dpto. {loc_base['departamento']}, Formosa"
        apellido_cap = vic["apellido"].capitalize()
        nombre_completo = f"{vic['nombre']} {apellido_cap}"

        try:
            nuevo = supabase_admin.auth.admin.create_user({
                "email": email,
                "password": f"SimHestia#{dni}!",
                "email_confirm": True,
                "user_metadata": {
                    "nombre": vic["nombre"],
                    "apellido": apellido_cap,
                    "dni": dni,
                    "telefono": telefono,
                    "genero": vic["genero"],
                    "fecha_nacimiento": vic["fecha_nac"],
                    "direccion": direccion_domicilio,
                },
            })
            uid = str(nuevo.user.id)
        except Exception as exc:
            print(f"ERROR creando usuaria ficticia {email}: {exc}")
            sys.exit(1)

        # Garantizar que los datos demográficos en `persona` queden completos para estadísticas de edad/género
        u_row = supabase_admin.table("usuario").select("per_id_persona").eq("usu_id_usuario", uid).execute()
        per_id = u_row.data[0].get("per_id_persona") if u_row.data else None
        datos_persona = {
            "per_nombre": vic["nombre"],
            "per_apellido": apellido_cap,
            "per_dni": dni,
            "per_telefono": telefono,
            "per_genero": vic["genero"],
            "per_fecha_nacimiento": vic["fecha_nac"],
            "per_direccion": direccion_domicilio,
        }
        if per_id:
            supabase_admin.table("persona").update(datos_persona).eq("per_id_persona", per_id).execute()
        else:
            ins_p = supabase_admin.table("persona").insert(datos_persona).execute()
            if ins_p.data:
                per_id = ins_p.data[0]["per_id_persona"]
                supabase_admin.table("usuario").update({"per_id_persona": per_id}).eq("usu_id_usuario", uid).execute()

        usu_ids_creados.append(uid)
        mapa_victima_nombre[uid] = nombre_completo
        print(f"  ✓ Usuaria [{idx:02d}/{len(VICTIMAS_FICTICIAS)}] creada: {nombre_completo} ({loc_base['localidad']} - Dpto. {loc_base['departamento']})")

    # 2. Vincular una red de apoyo básica entre las usuarias simuladas (para estadística de vínculos)
    for i, uid_v in enumerate(usu_ids_creados):
        uid_c = usu_ids_creados[(i + 1) % len(usu_ids_creados)]
        parentesco = PARENTESCOS_SIM[i % len(PARENTESCOS_SIM)]
        try:
            supabase_admin.table("red_apoyo").insert({
                "usu_id_victima": uid_v,
                "usu_id_contacto": uid_c,
                "redapo_parentesco": parentesco,
                "redapo_estado": "activo",
            }).execute()
        except Exception:
            pass

    # 3. Insertar los 48 incidentes cerrados y sus respectivos cierres en `historial_incidente`
    # Horas con mayor peso nocturno y de fin de semana (espejo de patrones reales de emergencia)
    horas_ponderadas = [0, 1, 2, 3, 13, 14, 18, 19, 20, 21, 22, 22, 23, 23]
    incidentes_creados = 0

    for idx_inc, loc in enumerate(bolsa_localidades):
        uid_victima = usu_ids_creados[idx_inc % len(usu_ids_creados)]
        nombre_victima = mapa_victima_nombre[uid_victima]

        # Dispersión geográfica realista dentro del barrio/localidad (~300 a 800 metros)
        lat = round(loc["lat"] + rng.uniform(-0.0045, 0.0045), 6)
        lon = round(loc["lon"] + rng.uniform(-0.0045, 0.0045), 6)

        # Fecha de inicio distribuida en los últimos 180 días (con picos en verano/fines de semana)
        dias_atras = rng.randint(2, 180)
        hora = rng.choice(horas_ponderadas)
        minuto = rng.randint(0, 59)
        fecha_inicio = (ahora - timedelta(days=dias_atras)).replace(
            hour=hora, minute=minuto, second=rng.randint(0, 59), microsecond=0
        )

        # Duración del episodio entre 8 y 55 minutos (diferencia entre inicio y fin)
        duracion_minutos = rng.randint(8, 55)
        fecha_fin = fecha_inicio + timedelta(minutes=duracion_minutos, seconds=rng.randint(5, 50))

        # Origen permitido por el CHECK constraint de la tabla `incidente` ('manual' | 'automatico')
        # ~58% disparo automático (inmovilidad tónica / inferencia acústica), ~42% manual SOS
        origen = "automatico" if rng.random() < 0.58 else "manual"
        subtipo_nota = (
            "Detección acústica pasiva (YAMNet/Vosk)"
            if origen == "automatico"
            else "Activación manual botón SOS"
        )

        direccion_texto = f"{loc['barrio']}, {loc['localidad']}, Departamento {loc['departamento']}, Formosa"
        nota_incidente = f"{TAG_SIMULACION} | Dpto: {loc['departamento']} | Localidad: {loc['localidad']} | {subtipo_nota}"

        ins_inc = (
            supabase_admin.table("incidente")
            .insert({
                "usu_id_victima": uid_victima,
                "inc_victima_nombre": nombre_victima,
                "inc_latitud": lat,
                "inc_longitud": lon,
                "inc_direccion": direccion_texto,
                "inc_direccion_aprox": direccion_texto,
                "inc_origen": origen,
                "inc_estado": "cerrado",
                "inc_notas": nota_incidente,
                "inc_fecha_hora": fecha_inicio.isoformat(),
                "inc_ultima_ubicacion_en": fecha_fin.isoformat(),
                "inc_consentimiento_exportacion": rng.random() < 0.65,
            })
            .execute()
        )

        if ins_inc.data:
            inc_id = ins_inc.data[0]["inc_id_incidente"]
            # Insertar el registro de cierre en `historial_incidente` con la fecha_fin exacta
            supabase_admin.table("historial_incidente").insert({
                "inc_id_incidente": inc_id,
                "usu_id_cambiado_por": uid_victima,
                "hisinc_estado_anterior": "en_curso",
                "hisinc_estado_nuevo": "cerrado",
                "hisinc_notas": f"{TAG_SIMULACION} Fin de emergencia tras {duracion_minutos} min.",
                "hisinc_creado_en": fecha_fin.isoformat(),
            }).execute()
            incidentes_creados += 1

    print(f"\n🎉 ¡Carga finalizada con éxito!")
    print(f"   • Usuarias creadas:   {len(usu_ids_creados)}")
    print(f"   • Incidentes creados: {incidentes_creados} (con inicio y fin en `historial_incidente`)")
    print(f"   • Archivos subidos:   0 (0 bytes en Supabase Storage)")
    print(f"   • Para revertir todo: python seed_estadisticas_interior.py --limpiar")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Carga o limpia usuarios e incidentes ficticios del interior de Formosa para estadísticas."
    )
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--cargar", action="store_true", help="Inserta las usuarias e incidentes ficticios del interior.")
    grupo.add_argument("--limpiar", action="store_true", help="Elimina todos los usuarios e incidentes ficticios creados.")
    grupo.add_argument("--estado", action="store_true", help="Muestra cuántos registros simulados hay actualmente.")
    parser.add_argument("--dry-run", action="store_true", help="Simula la distribución por consola sin tocar la base de datos.")

    args = parser.parse_args()
    if args.estado:
        consultar_estado()
    elif args.limpiar:
        limpiar_datos_simulados()
    elif args.cargar:
        cargar_datos_simulados(dry_run=args.dry_run)
