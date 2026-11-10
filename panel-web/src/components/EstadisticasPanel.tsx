// panel-web/src/components/EstadisticasPanel.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Estadísticas anónimas de las emergencias en Modo Resguardo (RF-4.4 / CU-11).
// Requiere el permiso 'incidente.estadisticas'. Solo muestra totales que arma
// el backend: no hay nombres, documentos, direcciones exactas ni evidencias.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BarChart3, Clock, Download, FileText, MapPin, RefreshCw, Users, X, Zap } from 'lucide-react';
import { palette, radii, spacing } from '../theme/tokens';
import { MapaCalorComponent, type PuntoCalor } from './MapaCalorComponent';

type Colores = (typeof palette)['dark'] | (typeof palette)['light'];

interface Props {
  apiBaseUrl: string;
  token: string;
  colors: Colores;
  isDark: boolean;
  onToast: (titulo: string, mensaje: string, tipo: 'success' | 'error' | 'warning' | 'info') => void;
  onVolver?: () => void;
}

interface Resumen {
  generado_en: string;
  total_incidentes: number;
  incidentes_en_curso: number;
  incidentes_cerrados: number;
  victimas_distintas: number;
  duracion_promedio_min: number | null;
  duracion_mediana_min: number | null;
  duracion_p90_min: number | null;
  casos_con_duracion: number;
  distribucion_duracion: { tramo: string; cantidad: number; porcentaje: number }[];
  porcentaje_automatico: number;
  porcentaje_manual: number;
  por_origen: { origen: string; etiqueta: string; cantidad: number; porcentaje: number; porcentaje_nocturno: number; duracion_promedio_min: number | null }[];
  serie_mensual: { mes: string; etiqueta: string; cantidad: number }[];
  por_hora: { hora: number; cantidad: number }[];
  por_dia_semana: { dia: number; nombre: string; cantidad: number }[];
  matriz_horaria: { dia: number; hora: number; cantidad: number }[];
  por_departamento: { departamento: string; cantidad: number; porcentaje: number }[];
  por_localidad: { departamento: string; localidad: string; cantidad: number; porcentaje: number }[];
  por_barrio: { localidad: string; barrio: string; cantidad: number }[];
  sin_ubicacion: number;
  puntos_calor: PuntoCalor[];
  piramide_etaria: { rango: string; cantidad: number; porcentaje: number | null }[];
  por_genero: { nombre: string; cantidad: number; porcentaje: number }[];
  vinculos_red_apoyo: { nombre: string; cantidad: number; porcentaje: number }[];
  red_promedio_contactos: number | null;
}

const DEPARTAMENTOS = ['Formosa', 'Pilcomayo', 'Patiño', 'Pirané', 'Laishí', 'Pilagás', 'Matacos', 'Bermejo', 'Ramón Lista'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Paleta validada (dataviz): una sola serie azul y rampa secuencial azul
const SERIES = {
  light: { s1: '#2a78d6', rampa: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'] },
  dark: { s1: '#3987e5', rampa: ['#104281', '#184f95', '#1c5cab', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'] },
};

const fmt = (n: number | null | undefined, sufijo = '') =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}${sufijo}`;

// ── Piezas de gráfico ────────────────────────────────────────────────────────

function Tarjeta({ titulo, subtitulo, colors, children, ancho = 420 }: { titulo: string; subtitulo?: string; colors: Colores; children: React.ReactNode; ancho?: number }) {
  return (
    <View style={[estilos.tarjeta, { backgroundColor: colors.bg.surface, borderColor: colors.border.default, minWidth: ancho }]}>
      <Text style={[estilos.tarjetaTitulo, { color: colors.text.primary }]}>{titulo}</Text>
      {subtitulo ? <Text style={[estilos.tarjetaSubtitulo, { color: colors.text.secondary }]}>{subtitulo}</Text> : null}
      <View style={{ marginTop: spacing.sm }}>{children}</View>
    </View>
  );
}

function Indicador({ etiqueta, valor, detalle, icono, colors }: { etiqueta: string; valor: string; detalle?: string; icono: React.ReactNode; colors: Colores }) {
  return (
    <View style={[estilos.indicador, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icono}
        <Text style={{ fontSize: 12, color: colors.text.secondary, fontWeight: '600' }}>{etiqueta}</Text>
      </View>
      <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text.primary, marginTop: 4 }}>{valor}</Text>
      {detalle ? <Text style={{ fontSize: 11, color: colors.text.secondary, marginTop: 2 }}>{detalle}</Text> : null}
    </View>
  );
}

/** Columnas verticales de una sola serie, con el valor del elemento bajo el puntero. */
function Columnas({ datos, color, colors, alto = 150, cadaEtiqueta = 1 }: { datos: { etiqueta: string; valor: number }[]; color: string; colors: Colores; alto?: number; cadaEtiqueta?: number }) {
  const [activo, setActivo] = useState<number | null>(null);
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <View>
      <Text style={{ fontSize: 12, color: colors.text.secondary, height: 18 }}>
        {activo !== null ? `${datos[activo].etiqueta}: ${datos[activo].valor.toLocaleString('es-AR')}` : 'Pase el puntero sobre una barra para ver el valor'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: alto, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border.default }}>
        {datos.map((d, i) => (
          <Pressable
            key={d.etiqueta}
            onHoverIn={() => setActivo(i)}
            onHoverOut={() => setActivo(null)}
            onPress={() => setActivo(i)}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
          >
            <View
              style={{
                height: `${(d.valor / maximo) * 100}%`,
                minHeight: d.valor > 0 ? 2 : 0,
                backgroundColor: color,
                opacity: activo === null || activo === i ? 1 : 0.55,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
        {datos.map((d, i) => (
          <Text key={d.etiqueta} numberOfLines={1} style={{ flex: 1, fontSize: 10, color: colors.text.secondary, textAlign: 'center' }}>
            {i % cadaEtiqueta === 0 ? d.etiqueta : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Barras horizontales de una serie, con cantidad y porcentaje al final de cada fila. */
function Barras({ datos, color, colors, extra }: { datos: { etiqueta: string; valor: number; porcentaje?: number | null; nota?: string }[]; color: string; colors: Colores; extra?: string }) {
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  if (datos.length === 0) return <Text style={{ fontSize: 12, color: colors.text.secondary }}>Sin datos para los filtros elegidos.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {extra ? <Text style={{ fontSize: 11, color: colors.text.secondary, textAlign: 'right' }}>{extra}</Text> : null}
      {datos.map((d) => (
        <View key={d.etiqueta} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ width: 150, fontSize: 12, color: colors.text.primary }}>{d.etiqueta}</Text>
          <View style={{ flex: 1, height: 14, justifyContent: 'center' }}>
            <View style={{ width: `${(d.valor / maximo) * 100}%`, minWidth: d.valor > 0 ? 2 : 0, height: 12, backgroundColor: color, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
          </View>
          <Text style={{ width: 92, fontSize: 12, color: colors.text.secondary, textAlign: 'right' }}>
            {d.valor.toLocaleString('es-AR')}{d.porcentaje !== undefined && d.porcentaje !== null ? ` · ${fmt(d.porcentaje, '%')}` : ''}
          </Text>
          {d.nota !== undefined ? <Text style={{ width: 56, fontSize: 12, color: colors.text.secondary, textAlign: 'right' }}>{d.nota}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Día de la semana por hora: celdas con rampa secuencial de un solo tono. */
function MatrizHoraria({ datos, colors, rampa }: { datos: Resumen['matriz_horaria']; colors: Colores; rampa: string[] }) {
  const [activo, setActivo] = useState<string | null>(null);
  const valores = new Map(datos.map((d) => [`${d.dia}-${d.hora}`, d.cantidad]));
  const maximo = Math.max(1, ...datos.map((d) => d.cantidad));
  const color = (v: number) => (v === 0 ? colors.bg.elevated : rampa[Math.min(rampa.length - 1, Math.floor((v / maximo) * (rampa.length - 1) + 0.0001))]);
  return (
    <View>
      <Text style={{ fontSize: 12, color: colors.text.secondary, height: 18 }}>{activo ?? 'Pase el puntero sobre una celda para ver la cantidad'}</Text>
      {DIAS_CORTOS.map((dia, d) => (
        <View key={dia} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 }}>
          <Text style={{ width: 32, fontSize: 10, color: colors.text.secondary }}>{dia}</Text>
          {Array.from({ length: 24 }, (_, h) => {
            const v = valores.get(`${d}-${h}`) ?? 0;
            return (
              <Pressable
                key={h}
                onHoverIn={() => setActivo(`${dia} ${String(h).padStart(2, '0')}:00 a ${String(h).padStart(2, '0')}:59 · ${v} ${v === 1 ? 'emergencia' : 'emergencias'}`)}
                onHoverOut={() => setActivo(null)}
                style={{ flex: 1, height: 16, borderRadius: 3, backgroundColor: color(v) }}
              />
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 2, marginLeft: 34 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <Text key={h} style={{ flex: 1, fontSize: 9, color: colors.text.secondary, textAlign: 'center' }}>{h % 3 === 0 ? h : ''}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 10, color: colors.text.secondary }}>Menos</Text>
        {rampa.map((c) => <View key={c} style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: c }} />)}
        <Text style={{ fontSize: 10, color: colors.text.secondary }}>Más (máximo {maximo})</Text>
      </View>
    </View>
  );
}

function Tabla({ encabezados, filas, colors }: { encabezados: string[]; filas: (string | number)[][]; colors: Colores }) {
  if (filas.length === 0) return <Text style={{ fontSize: 12, color: colors.text.secondary }}>Sin datos para los filtros elegidos.</Text>;
  return (
    <View>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.default, paddingBottom: 4 }}>
        {encabezados.map((e, i) => (
          <Text key={e} style={{ flex: i === 0 ? 1.6 : i === encabezados.length - 1 ? 0.6 : 1, fontSize: 11, fontWeight: '700', color: colors.text.secondary, textAlign: i === encabezados.length - 1 ? 'right' : 'left' }}>{e}</Text>
        ))}
      </View>
      {filas.map((f, n) => (
        <View key={n} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border.default }}>
          {f.map((c, i) => (
            <Text key={i} numberOfLines={1} style={{ flex: i === 0 ? 1.6 : i === f.length - 1 ? 0.6 : 1, fontSize: 12, color: colors.text.primary, textAlign: i === f.length - 1 ? 'right' : 'left' }}>
              {typeof c === 'number' ? c.toLocaleString('es-AR') : c}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export function EstadisticasPanel({ apiBaseUrl, token, colors, isDark, onToast, onVolver }: Props) {
  const serie = SERIES[isDark ? 'dark' : 'light'];
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [localidad, setLocalidad] = useState('');
  const [origen, setOrigen] = useState('');
  // Localidades conocidas: se toman de la consulta sin filtro de zona
  const [localidades, setLocalidades] = useState<{ departamento: string; localidad: string }[]>([]);

  const parametros = useCallback(() => {
    const p = new URLSearchParams();
    if (desde) p.set('fecha_desde', desde);
    if (hasta) p.set('fecha_hasta', hasta);
    if (departamento) p.set('departamento', departamento);
    if (localidad) p.set('localidad', localidad);
    if (origen) p.set('origen', origen);
    return p;
  }, [desde, hasta, departamento, localidad, origen]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/admin/estadisticas/resumen?${parametros().toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.detail === 'string' ? json.detail : `HTTP ${res.status}`);
      setResumen(json as Resumen);
      if (!departamento && !localidad) {
        setLocalidades((json as Resumen).por_localidad.filter((l) => l.localidad !== 'Sin dato' && l.localidad !== 'Zona rural'));
      }
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar las estadísticas.');
    } finally {
      setCargando(false);
    }
  }, [apiBaseUrl, token, parametros, departamento, localidad]);

  // Se consulta al abrir y cada vez que cambia un filtro
  useEffect(() => {
    if (desde && hasta && desde > hasta) {
      setError("La fecha 'desde' no puede ser posterior a la fecha 'hasta'.");
      return;
    }
    cargar();
  }, [desde, hasta, departamento, localidad, origen]);

  const descargar = async (formato: 'xlsx' | 'pdf') => {
    setDescargando(formato);
    try {
      const p = parametros();
      p.set('formato', formato);
      const res = await fetch(`${apiBaseUrl}/api/v1/admin/estadisticas/exportar?${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(typeof json.detail === 'string' ? json.detail : `HTTP ${res.status}`);
      }
      const disposicion = res.headers.get('content-disposition') || '';
      const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] || `estadisticas_apoyar.${formato}`;
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const url = URL.createObjectURL(await res.blob());
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombre;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      onToast('Descarga lista', `Se descargó ${nombre} con los filtros aplicados.`, 'success');
    } catch (err: any) {
      onToast('Error al descargar', err.message || 'No se pudo generar el archivo.', 'error');
    } finally {
      setDescargando(null);
    }
  };

  const limpiar = () => {
    setDesde('');
    setHasta('');
    setDepartamento('');
    setLocalidad('');
    setOrigen('');
  };

  const opcionesLocalidad = useMemo(
    () => localidades.filter((l) => !departamento || l.departamento === departamento).map((l) => l.localidad),
    [localidades, departamento]
  );

  const estiloCampo = {
    backgroundColor: colors.bg.base,
    color: colors.text.primary,
    colorScheme: isDark ? 'dark' : 'light',
    border: `1px solid ${colors.border.default}`,
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 12,
    outline: 'none',
    height: 32,
    boxSizing: 'border-box' as const,
  };

  const campo = (etiqueta: string, control: React.ReactNode) => (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 10, color: colors.text.secondary, fontWeight: '600' }}>{etiqueta}</Text>
      {control}
    </View>
  );

  const hayFiltros = Boolean(desde || hasta || departamento || localidad || origen);
  const r = resumen;

  return (
    <View style={{ flex: 1, alignSelf: 'stretch', width: '100%', backgroundColor: colors.bg.base }}>
      {/* Encabezado y filtros sobre los gráficos */}
      <View style={[estilos.barraFiltros, { backgroundColor: colors.bg.surface, borderBottomColor: colors.border.default }]}>
        {/* Título y acciones */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: spacing.md }}>
            <BarChart3 size={22} color={colors.semantic.info} />
            <View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text.primary }}>Estadísticas de emergencias</Text>
              <Text style={{ fontSize: 11, color: colors.text.secondary }}>Totales anónimos del Modo Resguardo · sin datos personales ni evidencias</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={cargar} style={[estilos.boton, { borderColor: colors.border.default }]} accessibilityLabel="Actualizar estadísticas">
              <RefreshCw size={14} color={colors.text.primary} />
            </TouchableOpacity>
            {(['xlsx', 'pdf'] as const).map((f) => (
              <TouchableOpacity
                key={f}
                onPress={() => descargar(f)}
                disabled={Boolean(descargando) || !r}
                style={[estilos.boton, { borderColor: colors.semantic.info, backgroundColor: colors.semantic.infoBg, opacity: descargando && descargando !== f ? 0.5 : 1 }]}
              >
                {descargando === f ? <ActivityIndicator size="small" color={colors.semantic.info} /> : f === 'xlsx' ? <Download size={14} color={colors.semantic.info} /> : <FileText size={14} color={colors.semantic.info} />}
                <Text style={{ fontSize: 12, color: colors.semantic.info, fontWeight: '700' }}>{f === 'xlsx' ? 'Excel' : 'PDF'}</Text>
              </TouchableOpacity>
            ))}
            {onVolver && (
              <TouchableOpacity onPress={onVolver} style={[estilos.boton, { borderColor: colors.border.default }]}>
                <MapPin size={14} color={colors.text.primary} />
                <Text style={{ fontSize: 12, color: colors.text.primary, fontWeight: '600' }}>Volver al monitoreo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Filtros: una fila sobre los gráficos */}
        {Platform.OS === 'web' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
            {campo('Desde', <input type="date" value={desde} max={hasta || undefined} onChange={(e: any) => setDesde(e.target.value)} style={estiloCampo} />)}
            {campo('Hasta', <input type="date" value={hasta} min={desde || undefined} onChange={(e: any) => setHasta(e.target.value)} style={estiloCampo} />)}
            {campo(
              'Departamento',
              <select value={departamento} onChange={(e: any) => { setDepartamento(e.target.value); setLocalidad(''); }} style={estiloCampo}>
                <option value="">Todos</option>
                {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {campo(
              'Localidad',
              <select value={localidad} onChange={(e: any) => setLocalidad(e.target.value)} style={estiloCampo}>
                <option value="">Todas</option>
                {opcionesLocalidad.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            {campo(
              'Activación',
              <select value={origen} onChange={(e: any) => setOrigen(e.target.value)} style={estiloCampo}>
                <option value="">Todas</option>
                <option value="manual">Manual (botón)</option>
                <option value="automatico">Automática (voz o sonido)</option>
              </select>
            )}
            {hayFiltros && (
              <TouchableOpacity onPress={limpiar} style={[estilos.boton, { borderColor: colors.border.default }]}>
                <X size={14} color={colors.text.secondary} />
                <Text style={{ fontSize: 12, color: colors.text.secondary, fontWeight: '600' }}>Limpiar</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={[estilos.aviso, { backgroundColor: colors.semantic.dangerBg, borderColor: colors.semantic.danger }]}>
          <Text style={{ color: colors.semantic.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {!r && cargando ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.semantic.info} />
          <Text style={{ color: colors.text.secondary, marginTop: 8 }}>Calculando estadísticas...</Text>
        </View>
      ) : r ? (
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} style={{ opacity: cargando ? 0.6 : 1 }}>
          {r.total_incidentes === 0 && (
            <View style={[estilos.aviso, { backgroundColor: colors.semantic.warningBg, borderColor: colors.semantic.warning, margin: 0 }]}>
              <Text style={{ color: colors.text.primary, fontSize: 13 }}>No hay emergencias registradas para los filtros elegidos. Los contadores quedan en cero.</Text>
            </View>
          )}

          <View style={estilos.fila}>
            <Indicador colors={colors} icono={<BarChart3 size={15} color={colors.text.secondary} />} etiqueta="Emergencias registradas"
              valor={fmt(r.total_incidentes)} detalle={`${fmt(r.incidentes_cerrados)} cerradas · ${fmt(r.incidentes_en_curso)} en curso`} />
            <Indicador colors={colors} icono={<Clock size={15} color={colors.text.secondary} />} etiqueta="Duración mediana"
              valor={fmt(r.duracion_mediana_min, ' min')} detalle={`Hasta que la víctima finalizó el Modo Resguardo · promedio ${fmt(r.duracion_promedio_min, ' min')}`} />
            <Indicador colors={colors} icono={<Zap size={15} color={colors.text.secondary} />} etiqueta="Activación automática"
              valor={fmt(r.porcentaje_automatico, '%')} detalle={`Manual: ${fmt(r.porcentaje_manual, '%')}`} />
            <Indicador colors={colors} icono={<Users size={15} color={colors.text.secondary} />} etiqueta="Personas que lo activaron"
              valor={fmt(r.victimas_distintas)}
              detalle={r.red_promedio_contactos === null ? 'Una persona puede tener varias emergencias' : `Una persona puede tener varias emergencias · ${fmt(r.red_promedio_contactos)} ${r.red_promedio_contactos === 1 ? 'contacto de emergencia activo' : 'contactos de emergencia activos'} por persona en promedio`} />
          </View>

          <View style={estilos.fila}>
            <Tarjeta colors={colors} titulo="Mapa de calor" subtitulo={`Zonas de unos 500 m con más emergencias · ${fmt(r.sin_ubicacion)} sin ubicación`} ancho={520}>
              <View style={{ height: 380 }}>
                <MapaCalorComponent key={isDark ? 'oscuro' : 'claro'} puntos={r.puntos_calor} isDark={isDark} />
              </View>
            </Tarjeta>
            <Tarjeta colors={colors} titulo="Por departamento" subtitulo="Cantidad de emergencias y porcentaje del total">
              <Barras colors={colors} color={serie.s1} datos={r.por_departamento.map((d) => ({ etiqueta: d.departamento, valor: d.cantidad, porcentaje: d.porcentaje }))} />
            </Tarjeta>
          </View>

          <View style={estilos.fila}>
            <Tarjeta colors={colors} titulo="Emergencias por mes" subtitulo="Fecha de inicio, hora argentina">
              <Columnas colors={colors} color={serie.s1} cadaEtiqueta={Math.max(1, Math.ceil(r.serie_mensual.length / 12))}
                datos={r.serie_mensual.map((m) => ({ etiqueta: m.etiqueta, valor: m.cantidad }))} />
            </Tarjeta>
            <Tarjeta colors={colors} titulo="Emergencias por hora del día" subtitulo="Hora de inicio">
              <Columnas colors={colors} color={serie.s1} cadaEtiqueta={3}
                datos={r.por_hora.map((h) => ({ etiqueta: `${String(h.hora).padStart(2, '0')}:00`, valor: h.cantidad }))} />
            </Tarjeta>
          </View>

          <View style={estilos.fila}>
            <Tarjeta colors={colors} titulo="Día de la semana y hora" subtitulo="Franjas con más pedidos de ayuda" ancho={520}>
              <MatrizHoraria datos={r.matriz_horaria} colors={colors} rampa={serie.rampa} />
            </Tarjeta>
            <Tarjeta colors={colors} titulo="Duración del episodio" subtitulo="Minutos desde que se activó el Modo Resguardo hasta que la víctima lo finalizó">
              <Barras colors={colors} color={serie.s1} datos={r.distribucion_duracion.map((d) => ({ etiqueta: d.tramo, valor: d.cantidad, porcentaje: d.porcentaje }))} />
              <Text style={{ fontSize: 11, color: colors.text.secondary, marginTop: 8 }}>
                El 90 % de los casos terminó en menos de {fmt(r.duracion_p90_min, ' min')}. Las emergencias en curso no entran en la duración.
              </Text>
            </Tarjeta>
          </View>

          <View style={estilos.fila}>
            <Tarjeta colors={colors} titulo="Cómo se activó el Modo Resguardo" subtitulo="La activación automática no requiere tocar el teléfono">
              <Tabla
                colors={colors}
                encabezados={['Activación', '% del total', '% de noche (20 a 6 h)', 'Duración promedio', 'Cantidad']}
                filas={r.por_origen.map((o) => [o.etiqueta, fmt(o.porcentaje, '%'), fmt(o.porcentaje_nocturno, '%'), fmt(o.duracion_promedio_min, ' min'), o.cantidad])}
              />
            </Tarjeta>
            <Tarjeta colors={colors} titulo="Edad de la víctima al momento de la emergencia" subtitulo="Calculada con la fecha de nacimiento de la cuenta">
              <Barras colors={colors} color={serie.s1}
                datos={r.piramide_etaria.filter((e) => e.rango !== 'Sin dato').map((e) => ({ etiqueta: `${e.rango} años`, valor: e.cantidad, porcentaje: e.porcentaje }))} />
              <Text style={{ fontSize: 11, color: colors.text.secondary, marginTop: 8 }}>
                Sin fecha de nacimiento registrada: {r.piramide_etaria.find((e) => e.rango === 'Sin dato')?.cantidad ?? 0}.
              </Text>
            </Tarjeta>
          </View>

          <View style={estilos.fila}>
            <Tarjeta colors={colors} titulo="Localidades" subtitulo="Ordenadas por cantidad">
              <Tabla colors={colors} encabezados={['Localidad', 'Departamento', '%', 'Cantidad']}
                filas={r.por_localidad.slice(0, 12).map((l) => [l.localidad, l.departamento, fmt(l.porcentaje, '%'), l.cantidad])} />
            </Tarjeta>
            <Tarjeta colors={colors} titulo="Barrios" subtitulo="Solo cuando la dirección nombra el barrio">
              <Tabla colors={colors} encabezados={['Barrio', 'Localidad', 'Cantidad']}
                filas={r.por_barrio.slice(0, 12).map((b) => [b.barrio, b.localidad, b.cantidad])} />
            </Tarjeta>
          </View>

          <View style={estilos.fila}>
            <Tarjeta colors={colors} titulo="Género" subtitulo="Dato declarado al registrarse">
              <Barras colors={colors} color={serie.s1} datos={r.por_genero.map((g) => ({ etiqueta: g.nombre, valor: g.cantidad, porcentaje: g.porcentaje }))} />
            </Tarjeta>
            <Tarjeta colors={colors} titulo="Red de apoyo: parentesco" subtitulo="Contactos activos de las víctimas incluidas">
              <Barras colors={colors} color={serie.s1} datos={r.vinculos_red_apoyo.slice(0, 8).map((v) => ({ etiqueta: v.nombre, valor: v.cantidad, porcentaje: v.porcentaje }))} />
            </Tarjeta>
          </View>

          <Text style={{ fontSize: 11, color: colors.text.secondary, textAlign: 'center', marginBottom: spacing.md }}>
            Datos registrados en ApoyAR. Actualizado: {new Date(r.generado_en).toLocaleString('es-AR')}.
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  barraFiltros: {
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  boton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  aviso: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  fila: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  indicador: {
    flex: 1,
    minWidth: 200,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  tarjeta: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  tarjetaTitulo: {
    fontSize: 15,
    fontWeight: '700',
  },
  tarjetaSubtitulo: {
    fontSize: 11,
    marginTop: 2,
  },
});
