// src/components/KeyboardAvoidingWrapper.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Componente centralizado y reutilizable para el manejo del teclado en toda la app.
//
// Resuelve el problema donde el teclado tapa los campos de texto en:
// 1. Pantallas estándar (mode="screen"): Login, Registro, Formularios largos.
// 2. Modales nativos (mode="modal"): Bottom sheets, tarjetas centradas en Android Dialogs.
//
// Características:
// - Adaptación universal a Android 14+ (Edge-to-edge / safe area insets).
// - Detección dinámica de la altura del teclado en tiempo real.
// - ScrollView integrado con flexGrow y keyboardShouldPersistTaps="handled".
// - Margen de seguridad sobre el campo enfocado (extraScrollHeight).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useRef, ReactNode } from 'react';
import {
  Keyboard,
  KeyboardEvent,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface KeyboardAvoidingWrapperProps {
  children: ReactNode;
  /**
   * 'screen': Para pantallas completas (Login, Registro).
   * 'modal': Para dentro de <Modal>, donde windowSoftInputMode no redimensiona el Dialog nativo de Android.
   */
  mode?: 'screen' | 'modal';
  /** Estilo del contenedor exterior */
  style?: StyleProp<ViewStyle>;
  /** Estilo del contentContainer del ScrollView interno */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Espacio adicional de seguridad sobre el teclado (en dp, default: 24) */
  extraScrollHeight?: number;
  /** Comportamiento de taps sobre el teclado (default: 'handled') */
  keyboardShouldPersistTaps?: 'handled' | 'always' | 'never';
  /** Permite deshabilitar el scroll si sólo se requiere evasión de teclado (default: true en 'screen', false en 'modal') */
  scrollEnabled?: boolean;
  /** Muestra u oculta la barra de scroll vertical */
  showsVerticalScrollIndicator?: boolean;
  /** Ref opcional al ScrollView interno */
  scrollViewRef?: React.RefObject<ScrollView | null>;
}

export function KeyboardAvoidingWrapper({
  children,
  mode = 'screen',
  style,
  contentContainerStyle,
  extraScrollHeight = 24,
  keyboardShouldPersistTaps = 'handled',
  scrollEnabled,
  showsVerticalScrollIndicator = false,
  scrollViewRef: externalScrollViewRef,
}: KeyboardAvoidingWrapperProps) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const internalScrollViewRef = useRef<ScrollView>(null);
  const activeScrollViewRef = externalScrollViewRef || internalScrollViewRef;

  // En 'screen', habilitamos el ScrollView por defecto para formularios de pantalla completa.
  // En 'modal', NO usamos ScrollView por defecto para evitar anidar ScrollViews o romper VirtualizedLists (FlatList en modales).
  const isScrollEnabled = scrollEnabled !== undefined ? scrollEnabled : mode === 'screen';

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      setKeyboardHeight(e.endCoordinates.height);
      setIsKeyboardVisible(true);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      setIsKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ── MODO MODAL (Dentro de <Modal>) ─────────────────────────────────────────
  // En Android, un <Modal> es un Dialog nativo independiente de la Activity principal,
  // por lo que windowSoftInputMode="adjustResize" no redimensiona su layout automáticamente.
  // En modo 'modal', añadimos paddingBottom dinámico según keyboardHeight.
  if (mode === 'modal') {
    const modalBottomPadding = Math.max(
      0,
      keyboardHeight > 0
        ? keyboardHeight - (Platform.OS === 'android' ? 0 : insets.bottom) + extraScrollHeight
        : insets.bottom
    );

    return (
      <View style={[styles.modalRoot, style, { paddingBottom: modalBottomPadding }]}>
        {isScrollEnabled ? (
          <ScrollView
            ref={activeScrollViewRef as any}
            style={styles.modalScrollView}
            contentContainerStyle={[styles.modalContentContainer, contentContainerStyle]}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
            bounces={false}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    );
  }

  // ── MODO PANTALLA (mode="screen") ──────────────────────────────────────────
  // En pantallas estándar, combinamos KeyboardAvoidingView con ScrollView inteligente
  // y compensación de insets de Android 14+ (Edge-to-edge / barra de gestos).
  const bottomPadding =
    keyboardHeight > 0
      ? (Platform.OS === 'android' ? extraScrollHeight : extraScrollHeight)
      : Math.max(insets.bottom, 16);

  return (
    <KeyboardAvoidingView
      style={[styles.screenRoot, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {isScrollEnabled ? (
        <ScrollView
          ref={activeScrollViewRef as any}
          style={styles.screenScrollView}
          contentContainerStyle={[
            styles.screenContentContainer,
            { paddingBottom: bottomPadding },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          bounces={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, paddingBottom: bottomPadding }, contentContainerStyle]}>
          {children}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    width: '100%',
  },
  screenScrollView: {
    flex: 1,
    width: '100%',
  },
  screenContentContainer: {
    flexGrow: 1,
  },
  modalRoot: {
    flex: 1,
    width: '100%',
  },
  modalScrollView: {
    width: '100%',
  },
  modalContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
