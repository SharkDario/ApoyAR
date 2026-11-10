// src/screens/AlertReceivedScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CU-06 / RF-4.2 — Visualización de Alerta (Vista del Contacto de Emergencia)
//
// Diseño: docs/08-diseño.md §2.5
// Tokens: src/theme/tokens.ts
//
// LENGUAJE NEUTRO: "quien envía la alerta", "la víctima".
//
// TODO (Iter 2): Reemplazar los datos de ejemplo (nombre, ubicación, hora)
// por los datos reales recibidos en el payload de la Notificación Push.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  Animated,
  Alert,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Map, Camera, UserLocation, Marker, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useTheme } from '@theme';
import { supabase } from '../lib/supabase';
import { resolverDireccionAsync, esSoloCoordenadas } from '../lib/geoUtils';

const NOTIFICACION_ICON = require('../../assets/notificacion.png');
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

// Estilo MapLibre con tiles válidos explícitos en cada source (elimina el warning Mbgl ParseStyle)
const CLEAN_MAP_STYLE = {
  version: 8,
  name: 'ApoyAR Map',
  sources: {
    base_map: {
      type: 'raster',
      tiles: MAPTILER_KEY
        ? [`https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`]
        : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© MapTiler © OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'base-map-tiles',
      type: 'raster',
      source: 'base_map',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

type Props = NativeStackScreenProps<any, 'AlertReceived'>;

export function AlertReceivedScreen({ route, navigation }: Props) {
  const { colors, typography, spacing, radii } = useTheme();

  // ── Datos de la Alerta (Recibidos por Navegación) ─────────────────────────
  const rawParams: any = route.params || {};
  const alertData = {
    incidenteId: rawParams.incidenteId || rawParams.id || rawParams.incidentId || null,
    victimName: rawParams.victimName || rawParams.victimaNombre || 'Tu contacto',
    victimPhone: rawParams.victimPhone || 'Emergencia',
    address: rawParams.address || rawParams.direccion || null,
    timestamp: rawParams.timestamp || rawParams.fechaHora || 'Hace unos instantes',
    latitude:
      typeof (rawParams.latitude ?? rawParams.latitud) === 'number' &&
      !isNaN(rawParams.latitude ?? rawParams.latitud)
        ? (rawParams.latitude ?? rawParams.latitud)
        : -34.603722,
    longitude:
      typeof (rawParams.longitude ?? rawParams.longitud) === 'number' &&
      !isNaN(rawParams.longitude ?? rawParams.longitud)
        ? (rawParams.longitude ?? rawParams.longitud)
        : -58.381592,
  };

  const initialLat = alertData.latitude;
  const initialLng = alertData.longitude;

  const [victimLocation, setVictimLocation] = useState({
    latitude: initialLat,
    longitude: initialLng,
  });

  const [displayAddress, setDisplayAddress] = useState<string>(
    alertData.address && !esSoloCoordenadas(alertData.address)
      ? alertData.address
      : `${initialLat.toFixed(5)}, ${initialLng.toFixed(5)}`
  );

  const [victimNameState, setVictimNameState] = useState(alertData.victimName || 'Tu contacto');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState<string>('Recién actualizado');

  const initialEstado = rawParams.estado || 'en_curso';
  const [isResguardoFinalizado, setIsResguardoFinalizado] = useState<boolean>(
    initialEstado !== 'en_curso'
  );
  const [showDeactivatedModal, setShowDeactivatedModal] = useState<boolean>(false);
  const hasNotifiedDeactivationRef = useRef<boolean>(initialEstado !== 'en_curso');
  const lastCoordsRef = useRef<{ lat: number; lng: number }>({
    lat: initialLat,
    lng: initialLng,
  });

  const procesarActualizacionIncidente = useCallback((raw: any) => {
    if (!raw) return;
    const latitud = Number(raw.inc_latitud ?? raw.latitud);
    const longitud = Number(raw.inc_longitud ?? raw.longitud);
    const victima_nombre = raw.inc_victima_nombre ?? raw.victima_nombre;
    const direccion = raw.inc_direccion ?? raw.direccion;
    const estadoActual = raw.inc_estado ?? raw.estado;

    if (
      typeof latitud === 'number' &&
      typeof longitud === 'number' &&
      !isNaN(latitud) &&
      !isNaN(longitud)
    ) {
      const cambioPosicion =
        Math.abs(latitud - lastCoordsRef.current.lat) > 0.000001 ||
        Math.abs(longitud - lastCoordsRef.current.lng) > 0.000001;

      lastCoordsRef.current = { lat: latitud, lng: longitud };
      setVictimLocation({
        latitude: latitud,
        longitude: longitud,
      });
      if (cambioPosicion || raw.inc_ultima_ubicacion_en) {
        setLastUpdated(new Date());
      }
    }
    if (victima_nombre && victima_nombre !== 'Tu contacto') {
      setVictimNameState(victima_nombre);
    }
    if (direccion && !esSoloCoordenadas(direccion)) {
      setDisplayAddress(direccion);
    }

    if (estadoActual && estadoActual !== 'en_curso') {
      setIsResguardoFinalizado(true);
      setTimeAgo('Modo Resguardo finalizado');
      if (!hasNotifiedDeactivationRef.current) {
        hasNotifiedDeactivationRef.current = true;
        setShowDeactivatedModal(true);
      }
    }
  }, []);

  const handleCopyLocation = async () => {
    const textToCopy = `Dirección: ${displayAddress}\nCoordenadas: ${victimLocation.latitude.toFixed(5)}, ${victimLocation.longitude.toFixed(5)}`;
    await Clipboard.setStringAsync(textToCopy);
  };

  // Resolver nombre de calle real en primer plano para el contacto receptor
  useEffect(() => {
    let cancelado = false;

    const actualizarDireccion = async () => {
      if (esSoloCoordenadas(displayAddress) || esSoloCoordenadas(alertData.address)) {
        const dir = await resolverDireccionAsync(victimLocation.latitude, victimLocation.longitude);
        if (!cancelado && dir && !esSoloCoordenadas(dir)) {
          setDisplayAddress(dir);

          // Si el incidente tenía solo coordenadas, actualizamos en base de datos para toda la red
          if (alertData.incidenteId) {
            try {
              await supabase
                .from('incidente')
                .update({ inc_direccion: dir })
                .eq('inc_id_incidente', alertData.incidenteId);
            } catch (_) {}
          }
        }
      }
    };

    actualizarDireccion();
    return () => {
      cancelado = true;
    };
  }, [victimLocation.latitude, victimLocation.longitude, alertData.incidenteId]);

  // Suscripción unificada en tiempo real a la ubicación y estado de la víctima + polling de respaldo
  useEffect(() => {
    if (!alertData.incidenteId) return;
    let desmontado = false;

    const channelName = `incidente_tracking_${alertData.incidenteId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'incidente',
          filter: `inc_id_incidente=eq.${alertData.incidenteId}`,
        },
        (payload) => {
          if (!desmontado) {
            procesarActualizacionIncidente(payload.new);
          }
        }
      )
      .subscribe();

    const verificarEstadoIncidente = async () => {
      if (desmontado || hasNotifiedDeactivationRef.current) return;
      try {
        const { data, error } = await supabase
          .from('incidente')
          .select(
            'inc_id_incidente, inc_estado, inc_latitud, inc_longitud, inc_direccion, inc_victima_nombre, inc_ultima_ubicacion_en'
          )
          .eq('inc_id_incidente', alertData.incidenteId)
          .single();

        if (!desmontado && !error && data) {
          procesarActualizacionIncidente(data);
        }
      } catch (_) {}
    };

    const pollInterval = setInterval(verificarEstadoIncidente, 3500);

    return () => {
      desmontado = true;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [alertData.incidenteId, procesarActualizacionIncidente]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  // Animación del marcador (FASE 2) con GeoJSON/CircleLayer para evitar recorte de MapLibre
  const [pulseRadius, setPulseRadius] = useState(10);
  const [pulseOpac, setPulseOpac] = useState(0.7);

  useEffect(() => {
    if (isResguardoFinalizado) {
      setPulseOpac(0);
      return;
    }

    let progress = 0;
    const interval = setInterval(() => {
      progress += 0.05;
      if (progress > 1) progress = 0;

      // Radio va de 10 a 40
      setPulseRadius(10 + progress * 30);
      // Opacidad va de 0.7 a 0
      setPulseOpac(0.7 * (1 - progress));
    }, 50);

    return () => clearInterval(interval);
  }, [isResguardoFinalizado]);

  // Actualizador del texto "Actualizado hace X s"
  useEffect(() => {
    if (isResguardoFinalizado) {
      setTimeAgo('Modo Resguardo finalizado');
      return;
    }

    const interval = setInterval(() => {
      const seconds = Math.floor((new Date().getTime() - lastUpdated.getTime()) / 1000);
      if (seconds < 5) setTimeAgo('Recién actualizado');
      else if (seconds < 60) setTimeAgo(`Hace ${seconds}s`);
      else setTimeAgo(`Hace ${Math.floor(seconds / 60)}m`);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated, isResguardoFinalizado]);

  let rawLng =
    typeof victimLocation.longitude === 'number' && !isNaN(victimLocation.longitude)
      ? victimLocation.longitude
      : -58.1756;
  let rawLat =
    typeof victimLocation.latitude === 'number' && !isNaN(victimLocation.latitude)
      ? victimLocation.latitude
      : -26.1852;

  // Detección y corrección de inversión latitud/longitud
  if (Math.abs(rawLat) > 50 && Math.abs(rawLng) < 40) {
    const tmp = rawLat;
    rawLat = rawLng;
    rawLng = tmp;
  }
  if (rawLat > 0 && rawLat <= 60) rawLat = -rawLat;
  if (rawLng > 0 && rawLng <= 90) rawLng = -rawLng;

  const safeLng = rawLng;
  const safeLat = rawLat;

  const victimPointGeoJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [safeLng, safeLat],
        },
        properties: {},
      },
    ],
  };

  const handleCallVictim = useCallback(() => {
    if (alertData.victimPhone && alertData.victimPhone !== 'Desconocido') {
      Linking.openURL(`tel:${alertData.victimPhone}`);
    } else {
      Alert.alert(
        'Número no disponible',
        'No pudimos obtener el número de teléfono de la víctima (posible fallo de conexión o perfil incompleto).'
      );
    }
  }, [alertData.victimPhone]);

  const handleCallEmergency = useCallback(() => {
    Linking.openURL('tel:911');
  }, []);

  const handleDismiss = useCallback(() => {
    // Como es un fullScreenModal, goBack() cierra la alerta
    navigation.goBack();
  }, [navigation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const addressToDisplay = displayAddress || `${safeLat.toFixed(5)}, ${safeLng.toFixed(5)}`;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.base }]} edges={['top', 'bottom']}>

      {/* ── HEADER DE URGENCIA / ESTADO DE RESGUARDO ── */}
      <View
        style={[
          styles.urgentHeader,
          {
            backgroundColor: isResguardoFinalizado ? colors.semantic.info : colors.semantic.danger,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          },
        ]}
      >
        <View style={styles.headerTitleRow}>
          <Feather
            name={isResguardoFinalizado ? 'shield' : 'alert-triangle'}
            size={28}
            color={colors.text.inverse}
            style={{ marginTop: 2 }}
          />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[typography.scale.h3, { color: colors.text.inverse }]} allowFontScaling numberOfLines={1}>
              {isResguardoFinalizado ? 'MODO RESGUARDO DESACTIVADO' : 'ALERTA DE EMERGENCIA'}
            </Text>
            <Text style={[typography.scale.body, { color: colors.text.inverse, opacity: 0.9, marginTop: 2 }]} allowFontScaling numberOfLines={2}>
              {addressToDisplay}
            </Text>
          </View>
        </View>
        <View style={styles.headerSubtitleRow}>
          <Feather name={isResguardoFinalizado ? 'check-circle' : 'clock'} size={14} color={colors.text.inverse} />
          <Text style={[typography.scale.body, { color: colors.text.inverse, marginLeft: 6 }]} allowFontScaling>
            {isResguardoFinalizado ? 'Transmisión finalizada · Última ubicación' : timeAgo}
          </Text>
        </View>
      </View>

      <View style={styles.scrollContent}>

        {/* ── MAPA REAL CON MAPLIBRE ── */}
        <View style={styles.mapContainer}>
          <Map
            style={styles.map}
            mapStyle={JSON.stringify(CLEAN_MAP_STYLE)}
            touchPitch={false}
            touchRotate={false}
            logo={false}
            attribution={false}
          >
            {/* Centrar la cámara en la posición de la víctima */}
            <Camera
              center={[safeLng, safeLat] as [number, number]}
              zoom={15}
              duration={800}
            />
            {/* Mostrar la propia ubicación del contacto */}
            <UserLocation />

            {/* Capa de animación del destello (fuera del Marker para evitar recortes) */}
            <GeoJSONSource id="pulse-source" data={victimPointGeoJSON as any}>
              <Layer
                id="pulse-layer"
                type="circle"
                paint={{
                  'circle-radius': pulseRadius,
                  'circle-color': colors.semantic.danger,
                  'circle-opacity': pulseOpac,
                  'circle-stroke-width': 0,
                }}
              />
            </GeoJSONSource>

            {/* Marcador de la víctima en tiempo real con icono oficial notificacion.png */}
            <Marker 
              id="victim-marker"
              lngLat={[safeLng, safeLat]}
            >
              <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Image
                  source={NOTIFICACION_ICON}
                  style={{ width: 44, height: 44 }}
                  resizeMode="contain"
                />
              </View>
            </Marker>
          </Map>
        </View>

        {/* ── TARJETA DE INFORMACIÓN ── */}
        <ScrollView
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.bg.surface,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              marginTop: -32, // Para superponer sobre el mapa
            }
          ]}
          contentContainerStyle={{
            paddingHorizontal: spacing.xl,
            paddingTop: spacing['2xl'],
            paddingBottom: spacing.xl,
          }}
          bounces={false}
        >

          {/* Banner de Aviso si la Víctima desactivó el Modo Resguardo */}
          {isResguardoFinalizado && (
            <View
              style={[
                styles.deactivatedBanner,
                {
                  backgroundColor: colors.semantic.infoBg,
                  borderColor: colors.semantic.info,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                },
              ]}
              accessible
              accessibilityRole="alert"
            >
              <Feather name="info" size={20} color={colors.semantic.info} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>
                  {victimNameState} desactivó el Modo Resguardo
                </Text>
                <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  El seguimiento GPS en vivo se detuvo. El mapa muestra su última ubicación registrada.
                </Text>
              </View>
            </View>
          )}

          {/* Datos Personales y Ubicación */}
          <Text style={[typography.scale.display, { color: colors.text.primary, marginBottom: spacing.xs }]} allowFontScaling>
            {isResguardoFinalizado
              ? `Resguardo finalizado por ${victimNameState}`
              : `${victimNameState} necesita ayuda`}
          </Text>

          <View style={[styles.locationRow, { marginBottom: spacing.md }]}>
            <Feather name="navigation" size={18} color={colors.text.secondary} />
            <Text style={[typography.scale.bodyLg, { color: colors.text.secondary, marginLeft: spacing.sm, flex: 1 }]} allowFontScaling>
              {addressToDisplay}
            </Text>
          </View>

          <Pressable
            onPress={handleCopyLocation}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Copiar dirección y coordenadas"
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.bg.elevated,
                borderColor: colors.border.default,
                borderWidth: 1,
                borderRadius: radii.md,
                height: 48,
                marginBottom: spacing.xl,
                opacity: pressed ? 0.7 : 1,
              }
            ]}
          >
            <Feather name="copy" size={20} color={colors.text.primary} />
            <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm }]}>
              Copiar dirección y coordenadas
            </Text>
          </Pressable>

          {/* Estado de la Evidencia */}
          <View
            style={[styles.evidenceBox, { backgroundColor: colors.bg.elevated, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing['2xl'] }]}
            accessible
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
          >
            <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginBottom: spacing.sm }]}>
              Estado del sistema de protección:
            </Text>

            <View style={styles.evidenceRow}>
              <Feather name="check-circle" size={16} color={colors.semantic.success} />
              <Text style={[typography.scale.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>Audio capturado y encriptado</Text>
            </View>

            <View style={styles.evidenceRow}>
              <Feather
                name={isResguardoFinalizado ? 'check-circle' : 'loader'}
                size={16}
                color={isResguardoFinalizado ? colors.semantic.info : colors.semantic.warning}
              />
              <Text style={[typography.scale.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                {isResguardoFinalizado
                  ? 'Modo Resguardo desactivado · Evidencia resguardada'
                  : 'Sincronizando a la nube...'}
              </Text>
            </View>
          </View>

          {/* ── BOTONES DE ACCIÓN ── */}

          <Pressable
            onPress={handleCallEmergency}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Llamar a emergencias locales"
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.semantic.danger,
                borderRadius: radii.md,
                marginBottom: spacing.md,
                opacity: pressed ? 0.7 : 1,
              }
            ]}
          >
            <Feather name="phone-call" size={24} color={colors.text.inverse} />
            <Text style={[typography.scale.bodyBold, { color: colors.text.inverse, marginLeft: spacing.sm }]}>
              LLAMAR AL 911
            </Text>
          </Pressable>

          <Pressable
            onPress={handleCallVictim}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Llamar a ${victimNameState}`}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.bg.elevated,
                borderColor: colors.border.default,
                borderWidth: 1,
                borderRadius: radii.md,
                marginBottom: spacing.xl,
                opacity: pressed ? 0.7 : 1,
              }
            ]}
          >
            <Feather name="phone" size={24} color={colors.text.primary} />
            <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm }]}>
              {victimNameState === 'Tu contacto' || victimNameState === 'Víctima (Prueba)' ? 'LLAMAR AL CONTACTO' : `LLAMAR A ${victimNameState.split(' ')[0].toUpperCase()}`}
            </Text>
          </Pressable>

          {/* Botón secundario para descartar la alerta */}
          <Pressable
            onPress={handleDismiss}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Cerrar esta alerta"
            style={({ pressed }) => [
              styles.dismissButton,
              { opacity: pressed ? 0.5 : 1 }
            ]}
          >
            <Text style={[typography.scale.bodyBold, { color: colors.text.secondary }]}>
              Ya vi esta alerta (Descartar)
            </Text>
          </Pressable>

        </ScrollView>
      </View>

      {/* ── MODAL EMERGENTE: AVISO DE DESACTIVACIÓN DE MODO RESGUARDO ── */}
      <Modal
        visible={showDeactivatedModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowDeactivatedModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.bg.surface,
                borderColor: colors.border.default,
                borderRadius: radii.lg,
                padding: spacing.xl,
              },
            ]}
          >
            <View
              style={[
                styles.modalIconCircle,
                {
                  backgroundColor: colors.semantic.infoBg,
                  borderRadius: radii.full,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Feather name="shield" size={34} color={colors.semantic.info} />
            </View>

            <Text
              style={[typography.scale.h2, { color: colors.text.primary, textAlign: 'center' }]}
              allowFontScaling
            >
              Modo Resguardo Desactivado
            </Text>

            <Text
              style={[
                typography.scale.body,
                {
                  color: colors.text.secondary,
                  textAlign: 'center',
                  marginTop: spacing.xs,
                  marginBottom: spacing.md,
                },
              ]}
              allowFontScaling
            >
              <Text style={{ fontWeight: '700', color: colors.text.primary }}>{victimNameState}</Text>{' '}
              desactivó el Modo Resguardo. La transmisión de ubicación en tiempo real ha finalizado.
            </Text>

            <View
              style={[
                styles.modalInfoBox,
                {
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  marginBottom: spacing.lg,
                },
              ]}
            >
              <Feather name="info" size={18} color={colors.semantic.info} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={[typography.scale.caption, { color: colors.text.primary, flex: 1 }]}>
                En el mapa podés seguir consultando su última ubicación registrada. Por precaución, te sugerimos comunicarte con{' '}
                <Text style={{ fontWeight: '700' }}>{victimNameState}</Text> para confirmar que se encuentra bien.
              </Text>
            </View>

            <Pressable
              onPress={() => setShowDeactivatedModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Entendido, permanecer en el mapa"
              style={({ pressed }) => [
                styles.modalPrimaryBtn,
                {
                  backgroundColor: colors.semantic.info,
                  borderRadius: radii.md,
                  marginBottom: spacing.sm,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[typography.scale.bodyBold, { color: '#FFFFFF' }]}>
                Entendido (Ver última ubicación)
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setShowDeactivatedModal(false);
                navigation.goBack();
              }}
              accessibilityRole="button"
              accessibilityLabel="Volver al inicio"
              style={({ pressed }) => [
                styles.modalSecondaryBtn,
                {
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                  borderRadius: radii.md,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[typography.scale.bodyBold, { color: colors.text.secondary }]}>
                Volver al inicio
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Estilos estáticos ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  urgentHeader: {
    width: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    // Sombra fuerte para darle profundidad
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 10, // Para que la sombra pise al mapa
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginLeft: 36, // Alinear visualmente con el texto, saltando el ícono
  },
  mapContainer: {
    width: '100%',
    height: 350, // Ocupa un buen espacio vertical (aprox 40-50% de la pantalla)
    overflow: 'hidden',
    backgroundColor: '#e0e0e0', // Mostrar algo de fondo mientras carga
  },
  map: {
    flex: 1,
  },
  mapPin: {
    // Sombra del pin
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  infoCard: {
    flex: 1,
    width: '100%',
    // Sombra superior para despegarse del mapa
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  evidenceBox: {
    width: '100%',
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    width: '100%',
    height: 56, // Touch target holgado > 48dp
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissButton: {
    width: '100%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deactivatedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    width: '100%',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  modalIconCircle: {
    width: 68,
    height: 68,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    width: '100%',
  },
  modalPrimaryBtn: {
    width: '100%',
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSecondaryBtn: {
    width: '100%',
    height: 46,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
