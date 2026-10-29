# backend/app/repositories/cargo_institucional_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de la adscripción institucional de las Autoridades:
# `cargo_institucional` → `cargo`, `sede` → `dependencia` → `institucion`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository

COLUMNAS_ADSCRIPCION_COMPLETA = (
    "carins_legajo_o_matricula, carins_activo, cargo(car_nombre_cargo), "
    "sede(sed_nombre_sede, sed_direccion, sed_localidad, dependencia(dep_nombre, institucion(ins_nombre)))"
)
COLUMNAS_ADSCRIPCION_INFORME = "carins_legajo_o_matricula, cargo(car_nombre_cargo), sede(sed_nombre_sede, sed_direccion)"
COLUMNAS_ADSCRIPCION_INDIVIDUAL = "carins_legajo_o_matricula, carins_activo, cargo(car_nombre_cargo), sede(sed_nombre_sede, sed_direccion, sed_localidad)"


class CargoInstitucionalRepository(SupabaseRepository):
    tabla = "cargo_institucional"

    def obtener_estado(self, usuario_id: str) -> Optional[Dict[str, Any]]:
        """Fila con `carins_activo` del cargo del usuario, o None si no tiene cargo."""
        res = self._query().select("carins_activo").eq("usu_id_usuario", usuario_id).execute()
        return self._primera_fila(res)

    def obtener_adscripcion(self, usuario_id: str, columnas: str = COLUMNAS_ADSCRIPCION_COMPLETA) -> Optional[Dict[str, Any]]:
        res = self._query().select(columnas).eq("usu_id_usuario", usuario_id).execute()
        return self._primera_fila(res)

    def listar_adscripciones(self) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("carins_id_cargo_institucional, car_id_cargo, usu_id_usuario, sed_id_sede, carins_legajo_o_matricula, carins_activo, cargo(car_id_cargo, car_nombre_cargo), sede(sed_nombre_sede, sed_direccion, sed_localidad, dependencia(dep_nombre, dep_tipo_unidad, institucion(ins_nombre, ins_tipo_organismo)))")
            .execute()
        )
        return self._filas(res)

    def existe_legajo(self, legajo: str) -> bool:
        res = self._query().select("car_id_cargo").eq("carins_legajo_o_matricula", legajo).execute()
        return bool(res.data)

    def upsert(self, datos: Dict[str, Any]) -> None:
        self._query().upsert(datos).execute()

    def establecer_activo(self, usuario_id: str, activo: bool) -> None:
        self._query().update({"carins_activo": activo}).eq("usu_id_usuario", usuario_id).execute()
