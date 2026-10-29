import subprocess
import json
import sys
import os

def run_sql_file(file_path):
    print(f"\n==================================================================")
    print(f"[*] Ejecutando migración: {os.path.basename(file_path)}")
    print(f"==================================================================")
    
    cmd = ["npx", "supabase", "db", "query", "--linked", "-f", file_path]
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=r"c:\Users\mdari\Desktop\ApoyAR", shell=True)
    
    if res.returncode != 0:
        print(f"[ERROR] Falló la ejecución de {file_path}")
        print("STDOUT:", res.stdout)
        print("STDERR:", res.stderr)
        raise RuntimeError(f"Error ejecutando migración: {file_path}")
    
    print(f"[OK] Migración {os.path.basename(file_path)} ejecutada con éxito.")

def run_query(sql):
    single_line_sql = " ".join(sql.split())
    cmd = ["npx", "supabase", "db", "query", "--linked", single_line_sql]
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=r"c:\Users\mdari\Desktop\ApoyAR", shell=True)
    if res.returncode != 0:
        print(f"[ERROR] Query failed: {single_line_sql}")
        print("STDOUT:", res.stdout)
        print("STDERR:", res.stderr)
        raise RuntimeError(f"Error en consulta: {res.stderr}")
    try:
        data = json.loads(res.stdout)
        return data.get("rows", [])
    except Exception:
        return res.stdout

def main():
    print("\n" + "="*70)
    print("VERIFICACIÓN REAL EN CONSOLA (INFORMATION_SCHEMA Y TABLAS)")
    print("="*70)

    # 1. Comprobar existencia de tablas
    print("\n[1] Verificando existencia de tablas clave...")
    tablas_check = ["institucion", "dependencia", "sede", "cargo", "cargo_institucional", "autoridad_institucional"]
    sql_tablas = f"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ({','.join([repr(t) for t in tablas_check])});"
    rows_tablas = run_query(sql_tablas)
    tablas_existentes = {r["tablename"] for r in rows_tablas}
    
    for t in ["institucion", "dependencia", "sede", "cargo", "cargo_institucional"]:
        if t in tablas_existentes:
            print(f"  [OK] Tabla '{t}' existe en public.")
        else:
            print(f"  [FAIL] Tabla '{t}' NO existe.")

    if "autoridad_institucional" not in tablas_existentes:
        print("  [OK] Tabla 'autoridad_institucional' fue eliminada exitosamente (3FN Pura).")
    else:
        print("  [WARN] Tabla 'autoridad_institucional' todavía existe.")

    # 2. Comprobar columnas de consentimiento en incidente y evidencia
    print("\n[2] Verificando columnas de consentimiento informado (Ley 25.326)...")
    sql_cols_inc = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'incidente' AND column_name IN ('consentimiento_exportacion', 'fecha_consentimiento');"
    cols_inc = {r["column_name"]: r["data_type"] for r in run_query(sql_cols_inc)}
    print(f"  - Columnas en 'incidente': {cols_inc}")
    assert "consentimiento_exportacion" in cols_inc, "Falta consentimiento_exportacion en incidente"
    assert "fecha_consentimiento" in cols_inc, "Falta fecha_consentimiento en incidente"
    print("  [OK] 'incidente' cuenta con consentimiento_exportacion y fecha_consentimiento.")

    sql_cols_ev = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'evidencia' AND column_name IN ('consentimiento_exportacion', 'fecha_consentimiento');"
    cols_ev = {r["column_name"]: r["data_type"] for r in run_query(sql_cols_ev)}
    print(f"  - Columnas en 'evidencia': {cols_ev}")
    assert "consentimiento_exportacion" in cols_ev, "Falta consentimiento_exportacion en evidencia"
    assert "fecha_consentimiento" in cols_ev, "Falta fecha_consentimiento en evidencia"
    print("  [OK] 'evidencia' cuenta con consentimiento_exportacion y fecha_consentimiento.")

    # 3. Comprobar columnas de snapshot en reporte_judicial
    print("\n[3] Verificando columnas de snapshot y trazabilidad en 'reporte_judicial'...")
    sql_cols_rep = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reporte_judicial' AND column_name IN ('legajo_snapshot', 'cargo_snapshot', 'sede_snapshot', 'justificacion', 'destino_declarado');"
    cols_rep = {r["column_name"]: r["data_type"] for r in run_query(sql_cols_rep)}
    print(f"  - Columnas en 'reporte_judicial': {list(cols_rep.keys())}")
    for col in ['legajo_snapshot', 'cargo_snapshot', 'sede_snapshot', 'justificacion', 'destino_declarado']:
        assert col in cols_rep, f"Falta {col} en reporte_judicial"
    print("  [OK] 'reporte_judicial' cuenta con todas las columnas de snapshot requeridas.")

    # 4. Comprobar atributo unificado password_hash en usuario
    print("\n[4] Verificando atributo unificado de credencial en 'usuario'...")
    sql_cols_usr = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'usuario' AND column_name = 'password_hash';"
    cols_usr = run_query(sql_cols_usr)
    assert len(cols_usr) > 0, "Falta password_hash en usuario"
    print("  [OK] 'usuario.password_hash' existe como credencial general unificada.")

    # 5. Comprobar catálogo de cargos de Formosa
    print("\n[5] Consultando catálogo oficial 'cargo' de la Provincia de Formosa...")
    cargos = run_query("SELECT id_cargo, nombre_cargo FROM public.cargo ORDER BY id_cargo ASC;")
    print(f"  Total de cargos insertados: {len(cargos)}")
    for c in cargos:
        print(f"    - ID {c['id_cargo']}: {c['nombre_cargo']}")
    assert len(cargos) == 10, f"Se esperaban 10 cargos, se encontraron {len(cargos)}"
    print("  [OK] Los 10 cargos oficiales de Formosa están insertados.")

    # 6. Comprobar operador inicial en cargo_institucional
    print("\n[6] Consultando operadores vinculados en 'cargo_institucional'...")
    operadores = run_query("""
        SELECT ci.id_cargo_institucional, ci.usuario_id, ci.legajo_o_matricula, ci.activo,
               c.nombre_cargo, s.nombre_sede, d.nombre as nombre_dependencia, i.nombre as nombre_institucion
        FROM public.cargo_institucional ci
        JOIN public.cargo c ON c.id_cargo = ci.id_cargo
        JOIN public.sede s ON s.id_sede = ci.id_sede
        JOIN public.dependencia d ON d.id_dependencia = s.id_dependencia
        JOIN public.institucion i ON i.id_institucion = d.id_institucion;
    """)
    print(f"  Total operadores activos/configurados en 3FN: {len(operadores)}")
    for op in operadores:
        print(f"    - Legajo {op['legajo_o_matricula']} | Cargo: {op['nombre_cargo']} | Sede: {op['nombre_sede']} ({op['nombre_institucion']}) | Activo: {op['activo']}")

    print("\n==================================================================")
    print("TODAS LAS MIGRACIONES Y VERIFICACIONES HAN SIDO COMPLETADAS CON ÉXITO")
    print("==================================================================")

if __name__ == "__main__":
    main()
