# -*- coding: utf-8 -*-
"""
Script de utilidad para crear o promover un usuario al rol de 'Administrador'
con estado de aprobación 'activo' en Supabase Auth y usuario_tiene_perfil.
"""

import argparse
import sys
from datetime import datetime, timezone
import uuid

from app.database import supabase_admin


def bootstrap_admin(email: str, password: str = None, nombre: str = "Admin", apellido: str = "Sistema"):
    print(f"=== Creando o Promoviendo Administrador: {email} ===")
    
    # 1. Obtener ID del perfil 'Administrador'
    res_perfil = supabase_admin.table("perfil").select("prf_id_perfil, prf_nombre").ilike("prf_nombre", "administrador").execute()
    if not res_perfil.data:
        print("ERROR: No se encontró el perfil 'Administrador' en la tabla 'perfil'.")
        sys.exit(1)
    
    admin_perfil_id = res_perfil.data[0]["prf_id_perfil"]
    print(f"✓ Perfil 'Administrador' localizado: {admin_perfil_id}")

    # 2. Buscar o crear usuario en Supabase Auth
    user_id = None
    try:
        # Intentar buscar entre usuarios existentes en Auth
        users_resp = supabase_admin.auth.admin.list_users()
        users_list = getattr(users_resp, "users", []) or (users_resp if isinstance(users_resp, list) else [])
        for u in users_list:
            if getattr(u, "email", "").lower() == email.lower():
                user_id = getattr(u, "id")
                print(f"✓ Usuario existente encontrado en Supabase Auth con ID: {user_id}")
                break
    except Exception as e:
        print(f"Aviso al listar usuarios de Auth: {e}")

    if not user_id:
        if not password:
            print("ERROR: El usuario no existe en Supabase Auth y no se proporcionó contraseña para crearlo.")
            print("Uso: python crear_admin.py --email admin@ejemplo.com --password MiPassword123")
            sys.exit(1)
        
        try:
            new_user = supabase_admin.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"nombre": nombre, "apellido": apellido}
            })
            user_id = str(new_user.user.id)
            print(f"✓ Usuario creado exitosamente en Supabase Auth con ID: {user_id}")
        except Exception as e:
            print(f"ERROR creando usuario en Supabase Auth: {e}")
            sys.exit(1)
    elif password:
        # Si ya existía pero se pasó contraseña, actualizarla
        try:
            supabase_admin.auth.admin.update_user_by_id(user_id, {"password": password})
            print(f"✓ Contraseña actualizada para el usuario existente.")
        except Exception as e:
            print(f"Aviso actualizando contraseña: {e}")

    # 3. Asegurar registro en 'persona' y vincular en 'usuario'
    try:
        u_row = supabase_admin.table("usuario").select("per_id_persona").eq("usu_id_usuario", user_id).execute()
        per_id = u_row.data[0].get("per_id_persona") if u_row.data else None
        if not per_id:
            ins_p = supabase_admin.table("persona").insert({
                "per_nombre": nombre,
                "per_apellido": apellido,
                "per_dni": "00000000",
                "per_telefono": "+5493704000000",
                "per_genero": "No especificado",
                "per_direccion": "Sede Administrativa",
            }).execute()
            if ins_p.data and len(ins_p.data) > 0:
                per_id = ins_p.data[0].get("per_id_persona")
                supabase_admin.table("usuario").update({"per_id_persona": per_id}).eq("usu_id_usuario", user_id).execute()
            print("✓ Registro de 'persona' creado y vinculado para el administrador.")
        else:
            print("✓ Registro de 'persona' ya existía.")
    except Exception as e:
        print(f"Aviso en tabla persona: {e}")

    # 4. Asignar perfil 'Administrador' con estado_aprobacion = 'activo'
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        datos_perfil = {
            "usu_id_usuario": user_id,
            "prf_id_perfil": admin_perfil_id,
            "usuprf_estado_aprobacion": "activo",
            "usu_id_aprobado_por": user_id,
            "usuprf_aprobado_en": now_iso,
            "usuprf_notas": "Usuario administrador inicial del sistema"
        }
        
        # Verificar si ya tiene el registro
        res_utp = supabase_admin.table("usuario_tiene_perfil").select("usu_id_usuario").eq("usu_id_usuario", user_id).eq("prf_id_perfil", admin_perfil_id).execute()
        if res_utp.data:
            supabase_admin.table("usuario_tiene_perfil").update({
                "usuprf_estado_aprobacion": "activo",
                "usuprf_aprobado_en": now_iso,
                "usuprf_notas": "Actualizado a Administrador activo"
            }).eq("usu_id_usuario", user_id).eq("prf_id_perfil", admin_perfil_id).execute()
            print("✓ Perfil en 'usuario_tiene_perfil' actualizado a estado 'activo'.")
        else:
            supabase_admin.table("usuario_tiene_perfil").insert(datos_perfil).execute()
            print("✓ Rol 'Administrador' asignado con estado 'activo' en 'usuario_tiene_perfil'.")
            
        print("\n🎉 ¡Administrador configurado con éxito!")
        print(f"   Email: {email}")
        print(f"   UUID:  {user_id}")
        print("   Ya puedes iniciar sesión en el panel web (http://localhost:8082).")
    except Exception as e:
        print(f"ERROR asignando perfil en base de datos: {e}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crear o promover un Administrador en ApoyAR")
    parser.add_argument("--email", required=True, help="Correo electrónico del administrador")
    parser.add_argument("--password", required=False, default=None, help="Contraseña (obligatoria si el usuario no existe)")
    parser.add_argument("--nombre", required=False, default="Admin", help="Nombre")
    parser.add_argument("--apellido", required=False, default="Principal", help="Apellido")
    
    args = parser.parse_args()
    bootstrap_admin(args.email, args.password, args.nombre, args.apellido)
