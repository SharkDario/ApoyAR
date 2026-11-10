// src/screens/ContactsScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CU-02 / RF-1.2 — Gestión de Red de Apoyo
//
// Diseño: Mantiene el lenguaje visual establecido (Asimetría, bloques Surface).
// LENGUAJE NEUTRO: "quien usa la app", "persona de confianza".
//
// TODO (Iter 2): Reemplazar el estado local `contacts` por un fetch real a la 
// tabla `Red_Apoyo` en Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@theme';
import { Button } from '@components/Button';
import { TextInput } from '@components/TextInput';
import { KeyboardAvoidingWrapper } from '@components/KeyboardAvoidingWrapper';

import { supabase } from '../lib/supabase';
import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import { observarPresencia } from '../lib/presencia';

// ── Tipos y Datos de Ejemplo ──────────────────────────────────────────────────

interface Contact {
  id: string; // ID de la fila en red_apoyo
  name: string;
  detail: string;
  contacto_id?: string;
  parentesco: string | null;
  avisosPausados: boolean;
}

// Vínculo con la persona de confianza (CU-02, paso 4)
const OPCIONES_PARENTESCO = ['Familiar', 'Pareja', 'Amistad', 'Vecina o vecino', 'Compañera o compañero de trabajo', 'Otro'];

// ── Componente Principal ─────────────────────────────────────────────────────

export function ContactsScreen() {
  const { colors, typography, spacing, radii } = useTheme();

  // ── Estado ─────────────────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [enLinea, setEnLinea] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [myCode, setMyCode] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Animación de rotación de dos flechas
  const rotateAnim = useRef(new Animated.Value(0)).current;
  
  // Estado del formulario de nuevo contacto
  const [newCodigo, setNewCodigo] = useState('');

  // Edición de un contacto: parentesco y pausa de avisos (CU-02, pasos 4 y 4a)
  const [editando, setEditando] = useState<Contact | null>(null);
  const [editParentesco, setEditParentesco] = useState<string | null>(null);
  const [editPausado, setEditPausado] = useState(false);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  // ── Carga de Datos ─────────────────────────────────────────────────────────
  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const savedCode = await AsyncStorage.getItem(`@apoyar_code_${user.id}`);
      setMyCode(savedCode || user.id.slice(0, 8).toUpperCase());

      const { data, error } = await supabase.rpc('obtener_red', {
        p_victima_id: user.id
      });

      if (error) throw error;

      if (data) {
        setContacts(data.map((item: any) => ({
          id: item.id,
          contacto_id: item.contacto_id,
          name: `${item.nombre} ${item.apellido}`,
          detail: item.telefono || 'Sin teléfono',
          parentesco: item.parentesco ?? null,
          avisosPausados: Boolean(item.avisos_pausados),
        })));
      }
    } catch (error: any) {
      console.error('Error al cargar contactos:', error.message);
      Alert.alert('Error', 'No se pudieron cargar tus contactos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Presencia en vivo de las personas de la red
  const contactoIds = contacts.map((c) => c.contacto_id).filter(Boolean).join(',');
  useEffect(() => {
    if (!contactoIds) return;
    return observarPresencia(contactoIds.split(','), (usuarioId, conectado) => {
      setEnLinea((prev) => ({ ...prev, [usuarioId]: conectado }));
    });
  }, [contactoIds]);

  // ── Regenerar Código Aleatorio con Flechas Giratorias ──────────────────────
  const handleRegenerateCode = async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);

    // Animación de giro completo (360 grados)
    rotateAnim.setValue(0);
    Animated.timing(rotateAnim, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      const headers: Record<string, string> = {
        'X-Api-Secret': getApiSecretKey(),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/v1/incidentes/red/regenerar-codigo/${user.id}`, {
        method: 'POST',
        headers,
      });

      if (res.ok) {
        const { codigo } = await res.json();
        setMyCode(codigo);
        await AsyncStorage.setItem(`@apoyar_code_${user.id}`, codigo);
        Alert.alert('Código Actualizado', `Tu nuevo código de vinculación para compartir es: ${codigo}`);
      } else {
        // Fallback alfanumérico único
        const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        setMyCode(randomCode);
        await AsyncStorage.setItem(`@apoyar_code_${user.id}`, randomCode);
        Alert.alert('Código Actualizado', `Tu nuevo código de vinculación para compartir es: ${randomCode}`);
      }
    } catch (e) {
      const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      setMyCode(randomCode);
    } finally {
      setIsRegenerating(false);
    }
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert(
      'Eliminar contacto',
      `¿Seguro que querés quitar a ${name} de tu red de apoyo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Eliminar', 
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('red_apoyo').delete().eq('redapo_id_red', id);
              if (error) throw error;
              setContacts((prev) => prev.filter(c => c.id !== id));
            } catch (err: any) {
              Alert.alert('Error', 'No se pudo eliminar el contacto.');
            }
          }
        },
      ],
      { cancelable: true }
    );
  }, []);

  const abrirEdicion = useCallback((contacto: Contact) => {
    setEditando(contacto);
    setEditParentesco(contacto.parentesco);
    setEditPausado(contacto.avisosPausados);
  }, []);

  const guardarEdicion = useCallback(async () => {
    if (!editando) return;
    setGuardandoEdicion(true);
    try {
      const { data, error } = await supabase.rpc('actualizar_contacto_red', {
        p_id_red: editando.id,
        p_parentesco: editParentesco,
        p_avisos_pausados: editPausado,
      });
      if (error) throw error;
      if (data === false) throw new Error('No se encontró el contacto.');
      setContacts((prev) =>
        prev.map((c) => (c.id === editando.id ? { ...c, parentesco: editParentesco, avisosPausados: editPausado } : c))
      );
      setEditando(null);
    } catch (err: any) {
      Alert.alert('Error', 'No se pudieron guardar los cambios del contacto.');
    } finally {
      setGuardandoEdicion(false);
    }
  }, [editando, editParentesco, editPausado]);

  const handleSaveContact = useCallback(async () => {
    if (!newCodigo.trim()) {
      Alert.alert('Datos incompletos', 'Por favor ingresá el código de invitación.');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (newCodigo.trim().toUpperCase() === myCode) {
        Alert.alert('Error', 'No podés agregarte a vos mismo.');
        return;
      }

      const { data: success, error } = await supabase.rpc('agregar_contacto_por_codigo', {
        p_victima_id: user.id,
        p_codigo: newCodigo.trim().toLowerCase()
      });

      if (error) throw error;

      if (!success) {
        Alert.alert('No encontrado', 'El código ingresado no existe.');
      } else {
        Alert.alert('¡Red vinculada!', 'Ahora están en la red de apoyo mutuamente.');
        setIsModalVisible(false);
        setNewCodigo('');
        fetchContacts(); // Recargar lista
      }
    } catch (err: any) {
      console.error('Error agregando contacto:', err.message);
      Alert.alert('Error', 'Hubo un problema al agregar el contacto.');
    }
  }, [newCodigo, myCode, fetchContacts]);

  // ── Render de Items ────────────────────────────────────────────────────────

  const renderContactItem = useCallback(({ item }: { item: Contact }) => {
    const isOnline = Boolean(item.contacto_id && enLinea[item.contacto_id]);

    return (
      <View style={[
        styles.contactCard, 
        { 
          backgroundColor: colors.bg.elevated,
          borderColor: colors.border.default,
          borderRadius: radii.md,
          padding: spacing.md,
          marginBottom: spacing.md
        }
      ]}>
        <View style={styles.contactInfo}>
          <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]} allowFontScaling>
            {item.name}
          </Text>
          
          <View style={styles.detailRow}>
            <Text style={[typography.scale.caption, { color: colors.text.secondary }]} allowFontScaling>
              {item.detail}
            </Text>
          </View>
          
          <View style={[styles.statusRow, { marginTop: spacing['2xs'] }]}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? colors.semantic.success : colors.text.disabled }]} />
            <Text style={[typography.scale.caption, { color: colors.text.secondary, marginLeft: 6 }]} allowFontScaling>
              {isOnline ? 'En línea' : 'Sin conexión'}
            </Text>
          </View>

          {(item.parentesco || item.avisosPausados) && (
            <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: spacing['2xs'] }]} allowFontScaling>
              {[item.parentesco, item.avisosPausados ? 'Avisos en pausa' : null].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>

        <Pressable
          onPress={() => abrirEdicion(item)}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Editar parentesco y avisos de ${item.name}`}
          style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name={item.avisosPausados ? 'bell-off' : 'edit-2'} size={22} color={colors.semantic.info} />
        </Pressable>

        <Pressable
          onPress={() => handleDelete(item.id, item.name)}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Eliminar a ${item.name}`}
          style={({ pressed }) => [
            styles.deleteButton,
            { opacity: pressed ? 0.5 : 1 }
          ]}
        >
          <Feather name="trash-2" size={24} color={colors.semantic.danger} />
        </Pressable>
      </View>
    );
  }, [colors, typography, spacing, radii, handleDelete, abrirEdicion, enLinea]);

  const renderEmptyState = useCallback(() => (
    <View style={[styles.emptyStateContainer, { paddingVertical: spacing['3xl'] }]}>
      <Feather name="users" size={48} color={colors.text.disabled} style={{ marginBottom: spacing.lg }} />
      <Text style={[typography.scale.h2, { color: colors.text.primary, textAlign: 'center', marginBottom: spacing.sm }]}>
        Tu red está vacía
      </Text>
      <Text style={[typography.scale.body, { color: colors.text.secondary, textAlign: 'center' }]}>
        Agregá a tus personas de confianza para que reciban tus alertas de emergencia.
      </Text>
    </View>
  ), [colors, typography, spacing]);

  // ── Render Principal ───────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.base }]} edges={['top', 'bottom']}>
      
      {/* ── HEADER ASIMÉTRICO ── */}
      <View style={[styles.headerBlock, { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg }]}>
        <Text style={[typography.scale.display, { color: colors.text.primary }]} allowFontScaling>
          Red de Apoyo
        </Text>
        <Text style={[typography.scale.bodyLg, { color: colors.text.secondary, marginTop: spacing.xs }]} allowFontScaling>
          Contactos vinculados ({contacts.length})
        </Text>
        {myCode ? (
          <View
            style={{
              marginTop: spacing.md,
              backgroundColor: colors.bg.surface,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border.default,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
              <Feather name="key" size={16} color={colors.semantic.info} style={{ marginRight: spacing.sm }} />
              <Text style={[typography.scale.body, { color: colors.text.primary, flexShrink: 1 }]}>
                Tu código para vincular: <Text style={{ fontWeight: 'bold', color: colors.semantic.info }}>{myCode}</Text>
              </Text>
            </View>
            <Pressable
              onPress={handleRegenerateCode}
              disabled={isRegenerating}
              style={({ pressed }) => [
                {
                  padding: 6,
                  borderRadius: radii.sm,
                  backgroundColor: colors.bg.elevated,
                  opacity: pressed ? 0.6 : 1,
                  marginLeft: spacing.sm,
                },
              ]}
              accessibilityLabel="Cambiar código de vinculación aleatoriamente"
              accessibilityHint="Genera un nuevo código único para compartir"
            >
              <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Feather name="refresh-cw" size={18} color={colors.semantic.info} />
              </Animated.View>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* ── SUPERFICIE PRINCIPAL (Lista) ── */}
      <View style={[
        styles.surfaceBlock,
        {
          backgroundColor: colors.bg.surface,
          borderTopLeftRadius: 36,
          borderTopRightRadius: 36,
          paddingTop: spacing['2xl'],
        }
      ]}>
        
        {/* Botón flotante superior para agregar */}
        <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
          <Button
            label="Agregar contacto"
            variant="primary"
            onPress={() => setIsModalVisible(true)}
            accessibilityHint="Abre un formulario para agregar una nueva persona a tu red."
          />
        </View>

        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          renderItem={renderContactItem}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing['3xl'] }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* ── MODAL AGREGAR CONTACTO ── */}
      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingWrapper
          mode="modal"
          style={styles.modalBackdrop}
          extraScrollHeight={16}
        >
          {/* Fondo oscuro que permite cerrar al tocar */}
          <Pressable 
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg.overlay, opacity: 0.8 }]} 
            onPress={() => setIsModalVisible(false)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Cerrar modal"
          />

          {/* Tarjeta del formulario */}
          <View style={[
            styles.modalCard,
            {
              backgroundColor: colors.bg.surface,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              padding: spacing.xl,
              paddingBottom: Platform.OS === 'ios' ? spacing['3xl'] : spacing.xl,
            }
          ]}>
            <View style={styles.modalHeader}>
              <Text style={[typography.scale.h2, { color: colors.text.primary }]}>
                Nuevo contacto
              </Text>
              <Pressable
                onPress={() => setIsModalVisible(false)}
                style={styles.closeButton}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Cerrar formulario"
              >
                <Feather name="x" size={24} color={colors.text.secondary} />
              </Pressable>
            </View>

            <View style={{ marginBottom: spacing.xl }}>
              <TextInput
                label="Código de invitación de la persona"
                leftIcon={<Feather name="hash" size={20} color={colors.text.secondary} />}
                value={newCodigo}
                onChangeText={setNewCodigo}
                placeholder="Ej. A1B2C3D4"
                autoCapitalize="characters"
              />
            </View>

            <Button
              label="Vincular mutuamente"
              variant="primary"
              onPress={handleSaveContact}
              disabled={!newCodigo.trim()}
            />
          </View>
        </KeyboardAvoidingWrapper>
      </Modal>

      {/* ── MODAL EDITAR CONTACTO (parentesco y pausa de avisos) ── */}
      <Modal
        visible={editando !== null}
        animationType="slide"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={() => setEditando(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg.overlay, opacity: 0.8 }]}
            onPress={() => setEditando(null)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Cerrar edición"
          />
          <View style={[
            styles.modalCard,
            {
              backgroundColor: colors.bg.surface,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              padding: spacing.xl,
              paddingBottom: Platform.OS === 'ios' ? spacing['3xl'] : spacing.xl,
            }
          ]}>
            <View style={styles.modalHeader}>
              <Text style={[typography.scale.h2, { color: colors.text.primary, flexShrink: 1 }]}>
                {editando?.name}
              </Text>
              <Pressable
                onPress={() => setEditando(null)}
                style={styles.closeButton}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Cerrar edición"
              >
                <Feather name="x" size={24} color={colors.text.secondary} />
              </Pressable>
            </View>

            <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginBottom: spacing.sm }]}>
              Parentesco o vínculo
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.xl }}>
              {OPCIONES_PARENTESCO.map((opcion) => {
                const marcado = editParentesco === opcion;
                return (
                  <Pressable
                    key={opcion}
                    onPress={() => setEditParentesco(marcado ? null : opcion)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: marcado }}
                    style={{
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      borderRadius: radii.full,
                      borderWidth: 1,
                      borderColor: marcado ? colors.semantic.info : colors.border.default,
                      backgroundColor: marcado ? colors.semantic.infoBg : colors.bg.elevated,
                    }}
                  >
                    <Text style={[typography.scale.caption, { color: marcado ? colors.semantic.info : colors.text.primary, fontWeight: '700' }]}>
                      {opcion}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <Text style={[typography.scale.bodyBold, { color: colors.text.primary, flex: 1, marginRight: spacing.sm }]}>
                Pausar avisos
              </Text>
              <Switch
                value={editPausado}
                onValueChange={setEditPausado}
                trackColor={{ false: colors.bg.overlay, true: colors.semantic.warning }}
              />
            </View>
            <Text style={[typography.scale.caption, { color: colors.text.secondary, marginBottom: spacing.xl }]}>
              Mientras esté en pausa, esta persona sigue en tu red pero no recibe tus alertas de emergencia.
            </Text>

            <Button
              label={guardandoEdicion ? 'Guardando…' : 'Guardar cambios'}
              variant="primary"
              onPress={guardarEdicion}
              disabled={guardandoEdicion}
            />
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
  headerBlock: {
    width: '100%',
    alignItems: 'flex-start',
  },
  surfaceBlock: {
    flex: 1,
    width: '100%',
    // Sombra para despegar del header
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 10,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  contactInfo: {
    flex: 1,
    paddingRight: 16,
  },
  detailRow: {
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deleteButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  closeButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'flex-end', // Alinear el ícono a la derecha del área táctil
  }
});
