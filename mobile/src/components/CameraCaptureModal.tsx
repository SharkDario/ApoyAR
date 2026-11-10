// src/components/CameraCaptureModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal de Captura Fotográfica y Visual Voluntaria de Evidencia (CU-05 / Iteración 3)
// 
// Principio Rector de Seguridad Física Personal:
// La obtención de evidencia NUNCA debe comprometer la integridad física de la víctima.
// La captura visual es voluntaria, complementaria y no condiciona la emisión del SOS.
//
// Pipeline de Preservación Probatoria Visual:
// 1. Abre la cámara nativa del dispositivo vía expo-image-picker.
// 2. Lee los bytes planos y computa el hash SHA-256 de origen.
// 3. Aplica Sobre Digital (Envelope Encryption) con AES-256-GCM y firma hardware Keystore.
// 4. Deja el paquete cifrado en la cola local, que funciona sin conexión.
// 5. La cola lo sube a Storage y registra el sellado forense RFC 3161 (TSA).
//
// Modo testigo: la evidencia queda aislada, sin incidente, hasta que una Autoridad
// la asocie a un expediente (RF-3.6).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { cifrarArchivoEnvelopeAsync } from '../lib/cryptoForense';
import { construirMetadataEvidenciaAsync } from '../lib/metadatosEvidencia';
import {
  DIRECCION_SIN_GPS,
  LATITUD_SIN_GPS,
  LONGITUD_SIN_GPS,
  obtenerUbicacionAsync,
} from '../lib/ubicacionEvidencia';
import { colaEvidencias } from '../services/colaEvidencias';
import { resguardoService } from '../services/resguardoService';

interface CameraCaptureModalProps {
  visible: boolean;
  onClose: () => void;
  onCapturaFinalizada?: (evidenciaUri: string, tipo: 'imagen' | 'video') => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  visible,
  onClose,
  onCapturaFinalizada,
}) => {
  const insets = useSafeAreaInsets();
  const { colors, typography, spacing, radii, isDark } = useTheme();
  const { user } = useAuth();
  const [capturando, setCapturando] = useState(false);
  const [estadoMensaje, setEstadoMensaje] = useState('');
  const [modoTestigo, setModoTestigo] = useState(false);
  const resguardoActivo = resguardoService.isResguardoActive();
  const esTestigo = modoTestigo && !resguardoActivo;

  const procesarElementoCapturadoAsync = async (
    fileUri: string,
    tipo: 'imagen' | 'video',
    extension: string
  ) => {
    if (!user?.id) {
      Alert.alert('Error', 'Debes haber iniciado sesión para registrar pruebas periciales.');
      return;
    }

    try {
      setCapturando(true);
      setEstadoMensaje(`Cifrando ${tipo} con AES-256-GCM y firma Keystore...`);

      const fechaCaptura = new Date().toISOString();
      const ubicacion = await obtenerUbicacionAsync();

      // 1. Como testigo no hay incidente; en otro caso se usa el activo o se crea uno
      let incidenteId: string | null = esTestigo ? null : resguardoService.getCurrentIncidenteId();
      if (!esTestigo && !incidenteId) {
        setEstadoMensaje('Registrando incidente de resguardo...');
        incidenteId = Crypto.randomUUID();
        await colaEvidencias.encolarAsync({
          tipo: 'incidente',
          datos: {
            inc_id_incidente: incidenteId,
            usu_id_victima: user.id,
            inc_fecha_hora: fechaCaptura,
            inc_latitud: ubicacion?.latitud ?? LATITUD_SIN_GPS,
            inc_longitud: ubicacion?.longitud ?? LONGITUD_SIN_GPS,
            inc_direccion: ubicacion
              ? `${ubicacion.latitud.toFixed(5)}, ${ubicacion.longitud.toFixed(5)}`
              : DIRECCION_SIN_GPS,
            inc_origen: 'manual',
            inc_estado: 'en_curso',
          },
        });
      }

      // 2. Cifrado en sobre AES-256-GCM + Firma Keystore
      const envelope = await cifrarArchivoEnvelopeAsync(fileUri, tipo, extension);
      const metadata = await construirMetadataEvidenciaAsync(
        { origen: esTestigo ? 'testigo' : 'manual', tipo_captura: `captura_voluntaria_${tipo}` },
        envelope,
        ubicacion
      );

      // 3. La cola sube el paquete cifrado y registra el sellado RFC 3161
      setEstadoMensaje('Resguardando evidencia cifrada...');
      const storagePath = `${user.id}/${incidenteId ?? 'testigo'}/${tipo}_${Date.now()}.${extension}`;
      await colaEvidencias.encolarEvidenciaAsync(
        envelope.paqueteCifradoBytes,
        storagePath,
        esTestigo ? 'sellar-comunitaria' : 'sellar-forense',
        {
          ...(incidenteId ? { incidente_id: incidenteId } : {}),
          usuario_id: user.id,
          tipo_archivo: tipo,
          url_almacenamiento: storagePath,
          hash_sha256: envelope.hashSha256Paquete,
          firma_hardware: envelope.firmaHardwareBase64,
          fecha_captura: fechaCaptura,
          metadata_dispositivo: metadata,
        }
      );
      FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});

      // 4. Cierre automático del incidente tras guardar la evidencia
      if (incidenteId) {
        await colaEvidencias.encolarAsync({
          tipo: 'estado_incidente',
          incidenteId,
          estado: 'cerrado',
          notas: 'Incidente cerrado tras la captura voluntaria de evidencia',
        });
      }

      try {
        if (!esTestigo && resguardoService.isResguardoActive()) {
          await resguardoService.desactivarModoResguardoAsync();
        }
      } catch (desactErr) {
        console.warn('[CameraCaptureModal] Error desactivando modo resguardo:', desactErr);
      }

      const pendientes = await colaEvidencias.procesarAsync();

      if (!esTestigo) onCapturaFinalizada?.(fileUri, tipo);

      Alert.alert(
        'Prueba Pericial Asegurada',
        pendientes > 0
          ? `El archivo de ${tipo} quedó cifrado y guardado en tu teléfono. Se enviará y sellará con RFC 3161 en cuanto haya conexión.`
          : `El archivo de ${tipo} ha sido cifrado con AES-256-GCM, firmado en el Keystore y sellado con RFC 3161.\n\nYa se encuentra disponible en tu módulo de "Mis Pruebas Periciales".`,
        [
          {
            text: 'Aceptar',
            onPress: () => {
              setCapturando(false);
              setEstadoMensaje('');
              onClose();
            },
          },
        ]
      );
    } catch (err: any) {
      console.error('[CameraCapture] Error en captura pericial:', err);
      Alert.alert('Error en Captura', err?.message || 'No se pudo completar el resguardo pericial.');
      setCapturando(false);
      setEstadoMensaje('');
    }
  };

  const handleTomarFoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso Requerido',
          'Se necesita acceso a la cámara para capturar fotografías de evidencia.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        await procesarElementoCapturadoAsync(asset.uri, 'imagen', 'jpg');
      }
    } catch (err: any) {
      console.error('[CameraCapture] Error abriendo cámara:', err);
      Alert.alert('Error', 'No se pudo iniciar la cámara del dispositivo.');
    }
  };

  const handleGrabarVideo = async () => {
    try {
      const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
      if (camStatus !== 'granted') {
        Alert.alert(
          'Permiso Requerido',
          'Se necesita acceso a la cámara para grabar videos de evidencia.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        videoMaxDuration: 15,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Low,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        await procesarElementoCapturadoAsync(asset.uri, 'video', 'mp4');
      }
    } catch (err: any) {
      console.error('[CameraCapture] Error grabando video:', err);
      Alert.alert('Error', 'No se pudo iniciar la grabación de video.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bg.surface,
              borderColor: colors.border.default,
              borderWidth: 1,
              borderRadius: radii.lg,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
            },
          ]}
        >
          {/* Modo testigo: la evidencia no abre un incidente propio (RF-3.6) */}
          {!resguardoActivo && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text.primary, fontWeight: '600' }}>Soy testigo</Text>
                <Text style={{ color: colors.text.secondary, fontSize: 12 }}>
                  Registra lo que viste sin activar una emergencia. Una autoridad podrá asociarlo a un caso.
                </Text>
              </View>
              <Switch value={modoTestigo} onValueChange={setModoTestigo} disabled={capturando} accessibilityLabel="Registrar como testigo" />
            </View>
          )}

          {/* Header con advertencia de seguridad física */}
          <View style={styles.header}>
            <MaterialCommunityIcons name="shield-alert" size={32} color={colors.semantic.danger} />
            <Text style={[styles.title, { color: colors.text.primary }]}>
              Captura Visual Voluntaria
            </Text>
          </View>

          <View
            style={[
              styles.warningBox,
              {
                backgroundColor: isDark ? 'rgba(248, 113, 113, 0.12)' : '#FFF3CD',
                borderLeftColor: colors.semantic.danger,
                borderRadius: radii.sm,
              },
            ]}
          >
            <Text
              style={[
                styles.warningTitle,
                { color: isDark ? '#FCA5A5' : '#7A1F1F' },
              ]}
            >
              ⚠️ Tu Seguridad es Prioridad Absoluta
            </Text>
            <Text
              style={[
                styles.warningText,
                { color: isDark ? '#F1F5F9' : '#1A1F22' },
              ]}
            >
              No tomes fotos ni videos si esto aumenta tu riesgo físico o alerta a una persona agresora.
              El auxilio SOS y la alerta a tus contactos funcionan de inmediato sin necesidad de imágenes.
            </Text>
          </View>

          {/* Opciones de captura */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                {
                  backgroundColor: colors.semantic.danger,
                  borderRadius: radii.md,
                },
              ]}
              onPress={handleTomarFoto}
              disabled={capturando}
            >
              <MaterialCommunityIcons
                name="camera"
                size={24}
                color={isDark ? '#121A1D' : '#FFFFFF'}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  { color: isDark ? '#121A1D' : '#FFFFFF', fontWeight: '700' },
                ]}
              >
                Tomar Fotografía Segura
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                {
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                  borderWidth: 1,
                  borderRadius: radii.md,
                },
              ]}
              onPress={handleGrabarVideo}
              disabled={capturando}
            >
              <MaterialCommunityIcons
                name="video"
                size={24}
                color={colors.text.primary}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  { color: colors.text.primary, fontWeight: '600' },
                ]}
              >
                Grabar Video Breve (hasta 15s)
              </Text>
            </TouchableOpacity>
          </View>

          {capturando && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.semantic.danger} />
              <Text style={[styles.loadingText, { color: colors.text.secondary }]}>
                {estadoMensaje || 'Procesando evidencia pericial...'}
              </Text>
            </View>
          )}

          {/* Botón cancelar */}
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={capturando}>
            <Text style={[styles.cancelButtonText, { color: colors.text.secondary }]}>
              Cerrar / Descartar
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  warningBox: {
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 20,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    lineHeight: 16,
  },
  actionsContainer: {
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  actionButtonText: {
    fontSize: 14,
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 12,
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    textAlign: 'center',
  },
  cancelButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
