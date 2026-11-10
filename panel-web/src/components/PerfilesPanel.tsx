// panel-web/src/components/PerfilesPanel.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Perfiles y permisos del panel (RBAC dinámico, migración 021).
// El Administrador crea perfiles personalizados con permisos institucionales y
// después los asigna a los usuarios del panel al darlos de alta o editarlos.
// Civil, Administrador y Autoridad son perfiles de sistema: se muestran, pero
// sus permisos no se cambian.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check, Lock, Pencil, Plus, Trash2, X, ArrowUp } from 'lucide-react';
import { palette, radii, spacing } from '../theme/tokens';

export interface PermisoCatalogo {
  id: string;
  nombre: string;
  descripcion: string | null;
  ambito: 'civil' | 'institucional';
  modulo: string;
  accion: string;
}

export interface PerfilItem {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  tipo: 'civil' | 'institucional';
  sistema: boolean;
  permisos: string[];
  usuarios: number;
}

type Colores = (typeof palette)['dark'] | (typeof palette)['light'];

interface Props {
  apiBaseUrl: string;
  token: string;
  colors: Colores;
  onToast: (titulo: string, mensaje: string, tipo: 'success' | 'error' | 'warning' | 'info') => void;
  onCambio?: () => void;
}

const ETIQUETA_MODULO: Record<string, string> = {
  incidente: 'Incidentes',
  evidencia: 'Evidencias',
  usuario: 'Usuarios del panel',
  perfil: 'Perfiles',
  alerta: 'Alertas',
  contacto: 'Contactos',
};

export function PerfilesPanel({ apiBaseUrl, token, colors, onToast, onCambio }: Props) {
  const [perfiles, setPerfiles] = useState<PerfilItem[]>([]);
  const [permisos, setPermisos] = useState<PermisoCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Formulario (alta o edición)
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [seleccion, setSeleccion] = useState<string[]>([]);

  const scrollRef = useRef<any>(null);
  const nombreInputRef = useRef<any>(null);

  const scrollHaciaArriba = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const node = (scrollRef.current as any)?.getScrollableNode?.() || (scrollRef.current as any);
        if (node?.scrollTo) {
          node.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      nombreInputRef.current?.focus();
    }, 60);
  };

  const cabeceras = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // El panel principal se vuelve a dibujar seguido (incidentes cada 30 s y en tiempo real).
  // Las props que cambian en cada dibujado se leen por referencia para no recargar los perfiles.
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const cargadoRef = useRef(false);

  const cargar = useCallback(async () => {
    // Solo la primera carga muestra el indicador; las siguientes actualizan sin vaciar la pantalla
    if (!cargadoRef.current) setCargando(true);
    const token = tokenRef.current;
    const onToast = onToastRef.current;
    try {
      const [rPerfiles, rPermisos] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/admin/perfiles`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBaseUrl}/api/v1/admin/permisos`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!rPerfiles.ok || !rPermisos.ok) throw new Error('No se pudieron leer los perfiles.');
      setPerfiles((await rPerfiles.json()).perfiles || []);
      setPermisos((await rPermisos.json()).permisos || []);
    } catch (err: any) {
      onToast('Perfiles', err.message || 'No se pudieron leer los perfiles.', 'error');
    } finally {
      cargadoRef.current = true;
      setCargando(false);
    }
  }, [apiBaseUrl]);

  // Una sola carga al abrir la pestaña; después se recarga solo tras guardar, eliminar o reactivar
  useEffect(() => {
    cargar();
  }, [cargar]);

  const institucionales = permisos.filter((p) => p.ambito === 'institucional');
  const descripcionDe = (clave: string) => permisos.find((p) => p.nombre === clave)?.descripcion || clave;

  const abrirAlta = () => {
    setEditandoId(null);
    setNombre('');
    setDescripcion('');
    setSeleccion([]);
    setMostrarForm(true);
    scrollHaciaArriba();
  };

  const abrirEdicion = (perfil: PerfilItem) => {
    setEditandoId(perfil.id);
    setNombre(perfil.nombre);
    setDescripcion(perfil.descripcion || '');
    setSeleccion(perfil.permisos);
    setMostrarForm(true);
    scrollHaciaArriba();
  };

  const alternarPermiso = (clave: string) => {
    setSeleccion((prev) => (prev.includes(clave) ? prev.filter((p) => p !== clave) : [...prev, clave]));
  };

  const guardar = async () => {
    if (nombre.trim().length < 3) {
      onToast('Perfil', 'El nombre debe tener al menos 3 caracteres.', 'warning');
      return;
    }
    if (seleccion.length === 0) {
      onToast('Perfil', 'Elegí al menos un permiso.', 'warning');
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch(
        editandoId ? `${apiBaseUrl}/api/v1/admin/perfiles/${editandoId}` : `${apiBaseUrl}/api/v1/admin/perfiles`,
        {
          method: editandoId ? 'PUT' : 'POST',
          headers: cabeceras,
          body: JSON.stringify({ nombre: nombre.trim(), descripcion: descripcion.trim() || null, permisos: seleccion }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || 'No se pudo guardar el perfil.');
      onToast('Perfil guardado', json.message || 'Listo.', 'success');
      setMostrarForm(false);
      await cargar();
      onCambio?.();
    } catch (err: any) {
      onToast('Perfil', err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (perfil: PerfilItem) => {
    setGuardando(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/admin/perfiles/${perfil.id}`, { method: 'DELETE', headers: cabeceras });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || 'No se pudo eliminar el perfil.');
      onToast('Perfil', json.message || 'Perfil eliminado.', json.desactivado ? 'warning' : 'success');
      await cargar();
      onCambio?.();
    } catch (err: any) {
      onToast('Perfil', err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const reactivar = async (perfil: PerfilItem) => {
    setGuardando(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/admin/perfiles/${perfil.id}`, {
        method: 'PUT',
        headers: cabeceras,
        body: JSON.stringify({ activo: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'No se pudo reactivar.');
      await cargar();
      onCambio?.();
    } catch (err: any) {
      onToast('Perfil', err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) {
    return (
      <View style={{ padding: spacing.xl, alignItems: 'center' }}>
        <ActivityIndicator color={colors.semantic.info} />
      </View>
    );
  }

  // Permisos agrupados por módulo para el formulario
  const porModulo = institucionales.reduce<Record<string, PermisoCatalogo[]>>((acc, p) => {
    (acc[p.modulo] = acc[p.modulo] || []).push(p);
    return acc;
  }, {});

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <View style={estilos.fila}>
        <Text style={[estilos.ayuda, { color: colors.text.secondary, flex: 1 }]}>
          Los perfiles personalizados dan acceso al panel con los permisos que elijas. Se asignan al dar de alta o editar un
          operador. Civil, Administrador y Autoridad son de sistema y no se modifican.
        </Text>
        {!mostrarForm && (
          <TouchableOpacity style={[estilos.boton, { backgroundColor: colors.semantic.info }]} onPress={abrirAlta}>
            <Plus size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={estilos.botonTexto}>Nuevo perfil</Text>
          </TouchableOpacity>
        )}
      </View>

      {mostrarForm && (
        <View style={[estilos.tarjeta, { backgroundColor: colors.bg.elevated, borderColor: colors.semantic.info, borderWidth: 1.5 }]}>
          <View style={[estilos.fila, { justifyContent: 'space-between', marginBottom: spacing.xs }]}>
            <View style={[estilos.fila, { gap: 8 }]}>
              {editandoId ? <Pencil size={18} color={colors.semantic.info} /> : <Plus size={18} color={colors.semantic.info} />}
              <Text style={[estilos.titulo, { color: colors.text.primary }]}>
                {editandoId ? `Editar perfil: ${nombre || 'personalizado'}` : 'Nuevo perfil personalizado'}
              </Text>
            </View>
            {editandoId && (
              <View style={{ backgroundColor: colors.semantic.infoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.full, borderWidth: 1, borderColor: colors.semantic.info }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.semantic.info }}>
                  Editando
                </Text>
              </View>
            )}
          </View>
          <TextInput
            ref={nombreInputRef}
            value={nombre}
            onChangeText={setNombre}
            placeholder="Nombre (ej.: Supervisión de guardia)"
            placeholderTextColor={colors.text.disabled}
            maxLength={50}
            style={[estilos.input, { color: colors.text.primary, borderColor: colors.border.default, backgroundColor: colors.bg.base }]}
          />
          <TextInput
            value={descripcion}
            onChangeText={setDescripcion}
            placeholder="Descripción (opcional)"
            placeholderTextColor={colors.text.disabled}
            maxLength={255}
            style={[estilos.input, { color: colors.text.primary, borderColor: colors.border.default, backgroundColor: colors.bg.base }]}
          />
          {Object.entries(porModulo).map(([modulo, lista]) => (
            <View key={modulo} style={{ marginTop: spacing.sm }}>
              <Text style={[estilos.modulo, { color: colors.text.secondary }]}>{ETIQUETA_MODULO[modulo] || modulo}</Text>
              {lista.map((p) => {
                const marcado = seleccion.includes(p.nombre);
                return (
                  <TouchableOpacity key={p.nombre} style={estilos.permiso} onPress={() => alternarPermiso(p.nombre)}>
                    <View
                      style={[
                        estilos.check,
                        { borderColor: marcado ? colors.semantic.info : colors.text.disabled, backgroundColor: marcado ? colors.semantic.info : 'transparent' },
                      ]}
                    >
                      {marcado && <Check size={12} color="#FFFFFF" />}
                    </View>
                    <Text style={{ color: colors.text.primary, fontSize: 13, flex: 1 }}>{p.descripcion || p.nombre}</Text>
                    <Text style={{ color: colors.text.disabled, fontSize: 11 }}>{p.nombre}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          {seleccion.includes('incidente.estadisticas') && !seleccion.includes('incidente.monitorear') && (
            <Text style={[estilos.ayuda, { color: colors.text.secondary, marginTop: spacing.sm }]}>
              Con estadísticas y sin monitoreo, este perfil entra al panel directo a la sección Estadísticas: ve totales
              anónimos y el mapa de calor, pero no los casos, la ubicación en vivo ni las pruebas.
            </Text>
          )}
          <View style={[estilos.fila, { marginTop: spacing.md, justifyContent: 'flex-end' }]}>
            <TouchableOpacity style={[estilos.boton, { backgroundColor: colors.bg.overlay }]} onPress={() => setMostrarForm(false)}>
              <X size={15} color={colors.text.primary} style={{ marginRight: 6 }} />
              <Text style={[estilos.botonTexto, { color: colors.text.primary }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[estilos.boton, { backgroundColor: colors.semantic.success, opacity: guardando ? 0.6 : 1 }]}
              onPress={guardar}
              disabled={guardando}
            >
              <Check size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={estilos.botonTexto}>{guardando ? 'Guardando…' : 'Guardar perfil'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {perfiles.map((perfil) => (
        <View
          key={perfil.id}
          style={[estilos.tarjeta, { backgroundColor: colors.bg.base, borderColor: colors.border.default, opacity: perfil.activo ? 1 : 0.6 }]}
        >
          <View style={estilos.fila}>
            <View style={{ flex: 1 }}>
              <Text style={[estilos.titulo, { color: colors.text.primary }]}>
                {perfil.nombre}
                {!perfil.activo ? '  (desactivado)' : ''}
              </Text>
              <Text style={{ color: colors.text.secondary, fontSize: 12 }}>
                {perfil.sistema ? 'Perfil de sistema' : 'Perfil personalizado'} · {perfil.tipo === 'civil' ? 'App móvil' : 'Panel web'} ·{' '}
                {perfil.usuarios} {perfil.usuarios === 1 ? 'usuario' : 'usuarios'}
              </Text>
              {perfil.descripcion ? (
                <Text style={{ color: colors.text.secondary, fontSize: 12, marginTop: 2 }}>{perfil.descripcion}</Text>
              ) : null}
            </View>
            {perfil.sistema ? (
              <Lock size={16} color={colors.text.disabled} />
            ) : (
              <View style={[estilos.fila, { gap: 6 }]}>
                {!perfil.activo && (
                  <TouchableOpacity style={[estilos.iconoBtn, { borderColor: colors.border.default }]} onPress={() => reactivar(perfil)}>
                    <Check size={15} color={colors.semantic.success} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[estilos.iconoBtn, { borderColor: colors.border.default }]} onPress={() => abrirEdicion(perfil)}>
                  <Pencil size={15} color={colors.semantic.info} />
                </TouchableOpacity>
                {perfil.activo && (
                  <TouchableOpacity
                    style={[estilos.iconoBtn, { borderColor: colors.border.default }]}
                    onPress={() => eliminar(perfil)}
                    disabled={guardando}
                  >
                    <Trash2 size={15} color={colors.semantic.danger} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          <View style={[estilos.fila, { flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }]}>
            {perfil.permisos.map((clave) => (
              <View key={clave} style={[estilos.chip, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}>
                <Text style={{ color: colors.text.primary, fontSize: 11 }}>{descripcionDe(clave)}</Text>
              </View>
            ))}
            {perfil.permisos.length === 0 && <Text style={{ color: colors.text.disabled, fontSize: 12 }}>Sin permisos</Text>}
          </View>
        </View>
      ))}

      {mostrarForm && (
        <TouchableOpacity
          style={[estilos.boton, { backgroundColor: colors.semantic.info, alignSelf: 'center', marginTop: spacing.md }]}
          onPress={scrollHaciaArriba}
        >
          <ArrowUp size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={estilos.botonTexto}>Subir al formulario de edición ↑</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ayuda: { fontSize: 13, lineHeight: 18 },
  tarjeta: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  titulo: { fontSize: 15, fontWeight: '700' },
  modulo: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: spacing.sm, fontSize: 14 },
  permiso: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  check: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  boton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.sm },
  botonTexto: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  iconoBtn: { borderWidth: 1, borderRadius: radii.sm, padding: 6 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
});
