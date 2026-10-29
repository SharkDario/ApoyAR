"""Cliente Supabase falso en memoria (PostgREST, Storage y Auth) para pruebas sin red."""
import copy
import re
from types import SimpleNamespace

UPSERT_KEYS = {
    "usuario": ("usu_id_usuario",),
    "usuario_tiene_perfil": ("usu_id_usuario", "prf_id_perfil"),
    "cargo_institucional": ("usu_id_usuario",),
}
ID_COLS = {
    "evidencia": "evi_id_evidencia",
    "persona": "per_id_persona",
    "incidente": "inc_id_incidente",
    "alerta_temprana": "aletem_id_alerta",
    "reporte_judicial": "repjud_id",
    "exportacion_evidencia": "expevi_id",
}


class FakeResponse:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


def _match(row, f):
    kind, col, val, neg = f
    rv = row.get(col)
    if kind == "eq":
        ok = rv == val or (rv is not None and str(rv) == str(val))
    elif kind == "neq":
        ok = not (rv == val or (rv is not None and str(rv) == str(val)))
    elif kind == "lt":
        ok = rv is not None and str(rv) < str(val)
    elif kind == "gte":
        ok = rv is not None and str(rv) >= str(val)
    elif kind == "lte":
        ok = rv is not None and str(rv) <= str(val)
    elif kind == "in":
        ok = rv in val or str(rv) in [str(v) for v in val]
    elif kind == "ilike":
        rx = "^" + re.escape(val).replace("%", ".*") + "$"
        ok = rv is not None and re.match(rx, str(rv), re.I | re.S) is not None
    elif kind == "is":
        ok = rv is None if val == "null" else rv == val
    elif kind == "or":
        ok = False
        for part in val.split(","):
            c, op, pat = part.split(".", 2)
            if _match(row, (op, c, pat, False)):
                ok = True
                break
    else:
        raise ValueError(kind)
    return (not ok) if neg else ok


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op, self.cols, self.payload, self.count = "select", "*", None, None
        self.filters, self.order_, self.limit_, self.range_ = [], None, None, None
        self._neg = False

    def _f(self, kind, col, val):
        self.filters.append((kind, col, val, self._neg))
        self._neg = False
        return self

    def select(self, cols="*", count=None):
        self.op, self.cols, self.count = "select", cols, count
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def upsert(self, payload):
        self.op, self.payload = "upsert", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, c, v): return self._f("eq", c, v)
    def neq(self, c, v): return self._f("neq", c, v)
    def lt(self, c, v): return self._f("lt", c, v)
    def gte(self, c, v): return self._f("gte", c, v)
    def lte(self, c, v): return self._f("lte", c, v)
    def in_(self, c, v): return self._f("in", c, list(v))
    def ilike(self, c, v): return self._f("ilike", c, v)
    def is_(self, c, v): return self._f("is", c, v)
    def or_(self, expr): return self._f("or", None, expr)

    @property
    def not_(self):
        self._neg = True
        return self

    def order(self, col, desc=False):
        self.order_ = (col, desc)
        return self

    def limit(self, n):
        self.limit_ = n
        return self

    def range(self, a, b):
        self.range_ = (a, b)
        return self

    def _rows(self):
        if self.table in self.db.fail_tables:
            raise RuntimeError(f"tabla {self.table} no disponible")
        return self.db.tables.setdefault(self.table, [])

    def _project(self, row):
        if self.cols.strip() == "*" or "(" in self.cols:
            return copy.deepcopy(row)
        return {c.strip(): copy.deepcopy(row.get(c.strip())) for c in self.cols.split(",")}

    def execute(self):
        rows = self._rows()
        matched = [r for r in rows if all(_match(r, f) for f in self.filters)]
        if self.op == "select":
            total = len(matched)
            if self.order_:
                col, desc = self.order_
                matched = sorted(matched, key=lambda r: (r.get(col) is None, str(r.get(col))), reverse=desc)
            if self.range_:
                matched = matched[self.range_[0]: self.range_[1] + 1]
            if self.limit_ is not None:
                matched = matched[: self.limit_]
            return FakeResponse([self._project(r) for r in matched], count=total if self.count else None)

        self.db.log.append({"table": self.table, "op": self.op, "payload": copy.deepcopy(self.payload),
                            "filters": [(k, c, v if not isinstance(v, list) else sorted(map(str, v)), n) for k, c, v, n in self.filters]})
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for it in items:
                row = dict(it)
                idc = ID_COLS.get(self.table)
                if idc and not row.get(idc):
                    row[idc] = self.db.next_id(self.table)
                if self.table == "evidencia":
                    row.setdefault("evi_sincronizado_en", "2026-03-03T00:00:00+00:00")
                rows.append(row)
                out.append(copy.deepcopy(row))
            return FakeResponse(out)
        if self.op == "update":
            for r in matched:
                r.update(copy.deepcopy(self.payload))
            return FakeResponse([copy.deepcopy(r) for r in matched])
        if self.op == "delete":
            for r in matched:
                rows.remove(r)
            return FakeResponse([copy.deepcopy(r) for r in matched])
        if self.op == "upsert":
            keys = UPSERT_KEYS.get(self.table, ())
            existing = [r for r in rows if keys and all(str(r.get(k)) == str(self.payload.get(k)) for k in keys)]
            if existing:
                existing[0].update(copy.deepcopy(self.payload))
                return FakeResponse([copy.deepcopy(existing[0])])
            rows.append(copy.deepcopy(self.payload))
            return FakeResponse([copy.deepcopy(self.payload)])
        raise ValueError(self.op)


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        if self.name == "obtener_ultimo_hash_evidencia":
            if self.db.rpc_hash_falla:
                raise RuntimeError("rpc no disponible")
            return FakeResponse(self.db.rpc_hash_valor)

        if self.name == "fn_consultar_estado_bloqueo":
            email = (self.params.get("p_email") or "").strip().lower()
            rows = self.db.tables.setdefault("seguridad_intento_login", [])
            row = next((r for r in rows if (r.get("seglog_email_normalizado") or r.get("email_normalizado")) == email), None)
            bloq_h = (row.get("bloqueado_hasta") or row.get("seglog_bloqueado_hasta")) if row else None
            intentos = (row.get("intentos_fallidos") or row.get("seglog_intentos_fallidos") or 0) if row else 0
            if not row or not bloq_h:
                return FakeResponse([{
                    "bloqueado": False,
                    "segundos_restantes": 0,
                    "intentos_fallidos": intentos,
                    "bloqueado_hasta": None,
                }])
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(bloq_h.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if dt > now:
                segs = max(0, int((dt - now).total_seconds()))
                return FakeResponse([{
                    "bloqueado": True,
                    "segundos_restantes": segs,
                    "intentos_fallidos": intentos or 3,
                    "bloqueado_hasta": bloq_h,
                }])
            row["seglog_bloqueado_hasta"] = None
            row["bloqueado_hasta"] = None
            row["seglog_intentos_fallidos"] = 0
            row["intentos_fallidos"] = 0
            return FakeResponse([{
                "bloqueado": False,
                "segundos_restantes": 0,
                "intentos_fallidos": 0,
                "bloqueado_hasta": None,
            }])

        if self.name == "fn_registrar_intento_login":
            email = (self.params.get("p_email") or "").strip().lower()
            exitoso = bool(self.params.get("p_exitoso"))
            rows = self.db.tables.setdefault("seguridad_intento_login", [])
            row = next((r for r in rows if (r.get("seglog_email_normalizado") or r.get("email_normalizado")) == email), None)
            if not row:
                row = {
                    "seglog_email_normalizado": email,
                    "email_normalizado": email,
                    "seglog_intentos_fallidos": 0,
                    "intentos_fallidos": 0,
                    "seglog_bloqueado_hasta": None,
                    "bloqueado_hasta": None,
                }
                rows.append(row)

            if exitoso:
                row["seglog_intentos_fallidos"] = 0
                row["intentos_fallidos"] = 0
                row["seglog_bloqueado_hasta"] = None
                row["bloqueado_hasta"] = None
                return FakeResponse([{
                    "bloqueado": False,
                    "segundos_restantes": 0,
                    "intentos_fallidos": 0,
                    "bloqueado_hasta": None,
                }])

            from datetime import datetime, timedelta, timezone
            now = datetime.now(timezone.utc)
            bloq_h = row.get("bloqueado_hasta") or row.get("seglog_bloqueado_hasta")
            if bloq_h:
                dt = datetime.fromisoformat(bloq_h.replace("Z", "+00:00"))
                if dt > now:
                    segs = max(0, int((dt - now).total_seconds()))
                    intentos = row.get("intentos_fallidos") or row.get("seglog_intentos_fallidos") or 3
                    return FakeResponse([{
                        "bloqueado": True,
                        "segundos_restantes": segs,
                        "intentos_fallidos": intentos,
                        "bloqueado_hasta": bloq_h,
                    }])

            nuevos_intentos = (row.get("intentos_fallidos") or row.get("seglog_intentos_fallidos") or 0) + 1
            row["seglog_intentos_fallidos"] = nuevos_intentos
            row["intentos_fallidos"] = nuevos_intentos
            if nuevos_intentos >= 3:
                bloq_hasta = (now + timedelta(minutes=15)).isoformat()
                row["seglog_bloqueado_hasta"] = bloq_hasta
                row["bloqueado_hasta"] = bloq_hasta
                return FakeResponse([{
                    "bloqueado": True,
                    "segundos_restantes": 900,
                    "intentos_fallidos": nuevos_intentos,
                    "bloqueado_hasta": bloq_hasta,
                }])
            return FakeResponse([{
                "bloqueado": False,
                "segundos_restantes": 0,
                "intentos_fallidos": nuevos_intentos,
                "bloqueado_hasta": None,
            }])

        self.db.log.append({"rpc": self.name, "params": self.params})
        return FakeResponse({"ok": True})


class _Bucket:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def download(self, path):
        if path not in self.db.storage:
            raise RuntimeError(f"objeto {path} no encontrado")
        return self.db.storage[path]

    def remove(self, paths):
        self.db.log.append({"storage_remove": sorted(paths)})
        return []


class _Storage:
    def __init__(self, db):
        self.db = db

    def from_(self, name):
        return _Bucket(self.db, name)


def _user(u):
    return SimpleNamespace(id=u["id"], email=u.get("email"), user_metadata=u.get("meta", {}), banned_until=u.get("banned_until"))


class _Admin:
    def __init__(self, db):
        self.db = db

    def get_user_by_id(self, uid):
        for u in self.db.auth_users:
            if u["id"] == uid:
                return SimpleNamespace(user=_user(u))
        raise RuntimeError("User not found")

    def list_users(self):
        return [_user(u) for u in self.db.auth_users]

    def create_user(self, attrs):
        if any(u.get("email") == attrs["email"] for u in self.db.auth_users):
            raise RuntimeError("email ya registrado")
        uid = self.db.next_id("auth")
        self.db.auth_users.append({"id": uid, "email": attrs["email"], "meta": attrs.get("user_metadata", {})})
        self.db.log.append({"auth": "create_user", "email": attrs["email"], "meta": attrs.get("user_metadata")})
        return SimpleNamespace(user=SimpleNamespace(id=uid))

    def update_user_by_id(self, uid, attrs):
        self.db.log.append({"auth": "update_user", "uid": uid, "keys": sorted(attrs)})

    def delete_user(self, uid):
        self.db.log.append({"auth": "delete_user", "uid": uid})


class _AnonAuth:
    def __init__(self, db):
        self.db = db

    def sign_in_with_password(self, creds):
        for u in self.db.auth_users:
            if u.get("email") == creds["email"] and u.get("password") == creds["password"]:
                return SimpleNamespace(
                    user=SimpleNamespace(id=u["id"], email=u["email"]),
                    session=SimpleNamespace(
                        access_token="fake_access_token_123",
                        refresh_token="fake_refresh_token_456",
                        token_type="bearer",
                        expires_in=3600,
                        expires_at=1800000000,
                    ),
                )
        raise RuntimeError("Invalid login credentials")

    def reset_password_for_email(self, email):
        self.db.log.append({"auth": "reset", "email": email})

    def verify_otp(self, params):
        for u in self.db.auth_users:
            if u.get("email") == params["email"] and params["token"] == "123456":
                return SimpleNamespace(user=SimpleNamespace(id=u["id"]))
        raise RuntimeError("Token has expired or is invalid")


class FakeDB:
    def __init__(self):
        self.tables, self.storage, self.auth_users, self.log = {}, {}, [], []
        self.fail_tables = set()
        self.rpc_hash_valor, self.rpc_hash_falla = None, False
        self._seq = 0

    def next_id(self, prefix):
        self._seq += 1
        return f"00000000-0000-4000-8000-{self._seq:012d}"


class FakeClient:
    def __init__(self, db):
        self.db = db
        self.storage = _Storage(db)
        self.auth = SimpleNamespace(admin=_Admin(db))

    def table(self, name):
        return Query(self.db, name)

    def rpc(self, name, params):
        return _Rpc(self.db, name, params)


class FakeAnonClient:
    def __init__(self, db):
        self.auth = _AnonAuth(db)
