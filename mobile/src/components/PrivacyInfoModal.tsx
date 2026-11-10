// src/components/PrivacyInfoModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal Informativo de Privacidad, Términos y Tratamiento de Datos (Ley 25.326)
//
// Principios Clave:
// 1. SOS NO BLOQUEANTE: El auxilio vital se activa sin requerir aceptación previa.
// 2. Transparencia: Información clara sobre permisos, ubicación y almacenamiento.
// 3. Gobernanza y Soberanía Probatoria: Cifrado AES-256-GCM y sello RFC 3161.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  Pressable,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

interface PrivacyInfoModalProps {
  visible: boolean;
  onClose: () => void;
  onAceptar?: () => void;
  title?: string;
}

export const PrivacyInfoModal: React.FC<PrivacyInfoModalProps> = ({
  visible,
  onClose,
  onAceptar,
  title = 'Privacidad y Seguridad de tus Datos',
}) => {
  const insets = useSafeAreaInsets();
  const { colors, typography, radii, isDark } = useTheme();

  const primaryActionColor = isDark ? colors.semantic.danger : '#7A1F1F';
  const primaryActionTextColor = isDark ? '#121A1D' : '#FFFFFF';

  const handleAceptar = () => {
    if (onAceptar) onAceptar();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bg.surface,
              borderColor: colors.border.default,
              borderRadius: radii.lg,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border.default }]}>
            <View style={[styles.iconContainer, { backgroundColor: colors.semantic.infoBg, borderRadius: radii.full }]}>
              <Feather name="shield" size={18} color={colors.semantic.info} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[typography.scale.bodyBold, { color: colors.text.primary, fontSize: 15 }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11 }]}>
                Garantías de Protección • Ley 25.326
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={[styles.closeIconBtn, { backgroundColor: colors.bg.base, borderRadius: radii.full }]}
              accessibilityLabel="Cerrar ventana de privacidad"
            >
              <Feather name="x" size={16} color={colors.text.secondary} />
            </Pressable>
          </View>

          {/* Área de Lectura Compacta */}
          <ScrollView
            style={styles.scrollArea}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 4 }}
          >
            {/* Punto 1 */}
            <View style={[styles.infoBlock, { backgroundColor: colors.bg.base, borderColor: colors.border.default, borderRadius: radii.sm }]}>
              <View style={styles.infoBlockHeader}>
                <Feather name="alert-circle" size={13} color={primaryActionColor} />
                <Text style={[styles.heading, { color: primaryActionColor }]}>
                  1. Auxilio Inmediato Sin Bloqueos
                </Text>
              </View>
              <Text style={[styles.paragraph, { color: colors.text.secondary }]}>
                Tu botón de auxilio (SOS) siempre está disponible. Bajo la Ley 25.326 (art. 5 inc. 2), las situaciones de riesgo vital o emergencia habilitan el auxilio de urgencia sin condicionarte a la aceptación previa de contratos extensos.
              </Text>
            </View>

            {/* Punto 2 */}
            <View style={[styles.infoBlock, { backgroundColor: colors.bg.base, borderColor: colors.border.default, borderRadius: radii.sm }]}>
              <View style={styles.infoBlockHeader}>
                <Feather name="navigation" size={13} color={colors.semantic.info} />
                <Text style={[styles.heading, { color: colors.text.primary }]}>
                  2. Ubicación y Telemetría en Vivo
                </Text>
              </View>
              <Text style={[styles.paragraph, { color: colors.text.secondary }]}>
                Tus coordenadas GPS únicamente se transmiten a tus contactos de confianza registrados y al centro de supervisión mientras exista una alerta activa "En Curso". Al finalizar la emergencia, el seguimiento se detiene de forma inmediata.
              </Text>
            </View>

            {/* Punto 3 */}
            <View style={[styles.infoBlock, { backgroundColor: colors.bg.base, borderColor: colors.border.default, borderRadius: radii.sm }]}>
              <View style={styles.infoBlockHeader}>
                <Feather name="lock" size={13} color={colors.semantic.success} />
                <Text style={[styles.heading, { color: colors.text.primary }]}>
                  3. Protección Criptográfica de Evidencias
                </Text>
              </View>
              <Text style={[styles.paragraph, { color: colors.text.secondary }]}>
                Tus grabaciones y fotografías se protegen con cifrado de sobre AES-256-GCM y sello RFC 3161 (TSA). Tus contactos reciben aviso y mapa, pero el contenido íntimo queda bajo tu consentimiento explícito antes de cualquier exportación judicial.
              </Text>
            </View>

            {/* Punto 4 */}
            <View style={[styles.infoBlock, { backgroundColor: colors.bg.base, borderColor: colors.border.default, borderRadius: radii.sm }]}>
              <View style={styles.infoBlockHeader}>
                <Feather name="file-text" size={13} color={colors.semantic.warning} />
                <Text style={[styles.heading, { color: colors.text.primary }]}>
                  4. Tratamiento de Datos Personales (Ley 25.326)
                </Text>
              </View>
              <Text style={[styles.paragraph, { color: colors.text.secondary }]}>
                Tus datos de registro se utilizan exclusivamente para tu resguardo y auxilio. Puedes ejercer en cualquier momento tus derechos de acceso, rectificación y supresión garantizados por la normativa nacional vigente.
              </Text>
            </View>
          </ScrollView>

          {/* Botón de Cierre / Aceptación */}
          <Pressable
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: primaryActionColor,
                borderRadius: radii.sm,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            onPress={handleAceptar}
          >
            <Text style={[styles.closeButtonText, { color: primaryActionTextColor }]}>
              {onAceptar ? 'Aceptar y Continuar' : 'Entendido'}
            </Text>
          </Pressable>
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
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    borderWidth: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  iconContainer: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIconBtn: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollArea: {
    maxHeight: 380,
    marginBottom: 8,
  },
  infoBlock: {
    padding: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  infoBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  heading: {
    fontSize: 12,
    fontWeight: '700',
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 16,
  },
  closeButton: {
    height: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  closeButtonText: {
    fontWeight: '700',
    fontSize: 13,
  },
});
