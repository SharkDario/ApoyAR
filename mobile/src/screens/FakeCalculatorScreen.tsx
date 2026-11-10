// src/screens/FakeCalculatorScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CU-03 / RF-1.3 — Pantalla Señuelo de Camuflaje Visual (Calculadora Básica)
//
// Oculta completamente la interfaz de ApoyAR ante terceros o posibles agresores.
// Provee operaciones aritméticas estándar 100% funcionales.
//
// Desbloqueo secreto:
// Ingresar el PIN secreto configurado (por defecto: "1973=") conmuta silenciosamente
// a la interfaz principal de ApoyAR.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

export const STORAGE_KEY_CAMOUFLAGE_PIN = '@apoyar_camuflaje_pin';
export const DEFAULT_CAMOUFLAGE_PIN = '1973';
export const STORAGE_KEY_CAMOUFLAGE_VISIBLE = '@apoyar_camuflaje_pantalla_visible';

let isCamouflageScreenActive = false;

export function isCamouflageVisible(): boolean {
  return isCamouflageScreenActive;
}

export function setCamouflageVisible(visible: boolean): void {
  isCamouflageScreenActive = visible;
  AsyncStorage.setItem(STORAGE_KEY_CAMOUFLAGE_VISIBLE, visible ? 'true' : 'false').catch(() => {});
}

type Props = Partial<NativeStackScreenProps<any, 'FakeCalculator'>> & {
  onUnlock?: () => void;
};

export function FakeCalculatorScreen({ navigation, onUnlock }: Props) {
  const [displayValue, setDisplayValue] = useState<string>('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState<boolean>(false);
  const [inputSequence, setInputSequence] = useState<string>('');

  // Notificar estado activo de la pantalla de camuflaje
  useFocusEffect(
    useCallback(() => {
      setCamouflageVisible(true);
      return () => {
        setCamouflageVisible(false);
      };
    }, [])
  );

  /**
   * Procesa la entrada de dígitos y evalúa la secuencia secreta de desbloqueo.
   */
  const handleDigit = useCallback((digit: string) => {
    // Acumular secuencia para verificación de PIN
    setInputSequence((prev) => {
      const next = prev + digit;
      return next.slice(-10); // Mantener últimos 10 caracteres
    });

    if (waitingForOperand) {
      setDisplayValue(digit);
      setWaitingForOperand(false);
    } else {
      setDisplayValue((prev) => (prev === '0' ? digit : prev + digit));
    }
  }, [waitingForOperand]);

  /**
   * Inserta un punto decimal.
   */
  const handleDecimal = useCallback(() => {
    setInputSequence((prev) => (prev + '.').slice(-10));

    if (waitingForOperand) {
      setDisplayValue('0.');
      setWaitingForOperand(false);
    } else if (!displayValue.includes('.')) {
      setDisplayValue((prev) => prev + '.');
    }
  }, [displayValue, waitingForOperand]);

  /**
   * Cambia el signo del valor visible (+/-).
   */
  const handleToggleSign = useCallback(() => {
    setDisplayValue((prev) => {
      const val = parseFloat(prev);
      if (isNaN(val)) return '0';
      return String(-val);
    });
  }, []);

  /**
   * Calcula porcentaje.
   */
  const handlePercentage = useCallback(() => {
    setDisplayValue((prev) => {
      const val = parseFloat(prev);
      if (isNaN(val)) return '0';
      return String(val / 100);
    });
  }, []);

  /**
   * Limpia la pantalla o reinicia el cálculo.
   */
  const handleClear = useCallback(() => {
    setDisplayValue('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setInputSequence('');
  }, []);

  /**
   * Asigna un operador aritmético (+, −, ×, ÷).
   */
  const handleOperator = useCallback((nextOperator: string) => {
    setInputSequence((prev) => (prev + nextOperator).slice(-10));

    const inputValue = parseFloat(displayValue);

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operator) {
      const current = previousValue || 0;
      let newValue = current;

      switch (operator) {
        case '+':
          newValue = current + inputValue;
          break;
        case '−':
          newValue = current - inputValue;
          break;
        case '×':
          newValue = current * inputValue;
          break;
        case '÷':
          newValue = inputValue !== 0 ? current / inputValue : 0;
          break;
      }

      setPreviousValue(newValue);
      setDisplayValue(String(newValue));
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
  }, [displayValue, operator, previousValue]);

  /**
   * Resuelve el cálculo (=) y valida si se ingresó el código de desbloqueo.
   */
  const handleEqual = useCallback(async () => {
    // 1. Evaluar si la secuencia coincide con el código secreto
    const storedPin = (await AsyncStorage.getItem(STORAGE_KEY_CAMOUFLAGE_PIN)) || DEFAULT_CAMOUFLAGE_PIN;
    const cleanSeq = inputSequence.replace(/[^0-9]/g, '');

    if (cleanSeq.endsWith(storedPin)) {
      // ── Solicitar huella o patrón / PIN del dispositivo antes de ingresar a la app real ──
      try {
        const [tieneHardware, tieneBiometria] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);

        if (tieneHardware && tieneBiometria) {
          const authRes = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Desbloquear ApoyAR',
            fallbackLabel: 'Ingresar PIN / Patrón',
            cancelLabel: 'Cancelar',
            disableDeviceFallback: false,
          });

          if (!authRes.success) {
            // Si el usuario cancela o no supera la huella/patrón, nos quedamos en la calculadora
            setDisplayValue('0');
            setInputSequence('');
            return;
          }
        }
      } catch (err) {
        console.warn('[FakeCalculator] Error en autenticación local al desbloquear:', err);
      }

      // Desbloqueo exitoso: conmuta a la interfaz de ApoyAR
      setCamouflageVisible(false);
      setDisplayValue('0');
      setInputSequence('');
      if (onUnlock) {
        onUnlock();
      } else if (navigation) {
        navigation.navigate('Home');
      }
      return;
    }

    // 2. Operación aritmética convencional
    if (!operator || previousValue === null) return;

    const inputValue = parseFloat(displayValue);
    let result = previousValue;

    switch (operator) {
      case '+':
        result = previousValue + inputValue;
        break;
      case '−':
        result = previousValue - inputValue;
        break;
      case '×':
        result = previousValue * inputValue;
        break;
      case '÷':
        result = inputValue !== 0 ? previousValue / inputValue : 0;
        break;
    }

    setDisplayValue(String(result));
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(true);
    setInputSequence('');
  }, [displayValue, inputSequence, navigation, operator, previousValue]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#17171C" />

      {/* Pantalla de visualización numérica */}
      <View style={styles.displayContainer}>
        <Text style={styles.displayText} numberOfLines={1} adjustsFontSizeToFit>
          {displayValue}
        </Text>
      </View>

      {/* Teclado numérico y de operaciones */}
      <View style={styles.keypadContainer}>
        {/* Fila 1 */}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.actionButton]} onPress={handleClear}>
            <Text style={[styles.buttonText, styles.actionText]}>C</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.actionButton]} onPress={handleToggleSign}>
            <Text style={[styles.buttonText, styles.actionText]}>+/−</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.actionButton]} onPress={handlePercentage}>
            <Text style={[styles.buttonText, styles.actionText]}>%</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.operatorButton]} onPress={() => handleOperator('÷')}>
            <Text style={[styles.buttonText, styles.operatorText]}>÷</Text>
          </TouchableOpacity>
        </View>

        {/* Fila 2 */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('7')}>
            <Text style={styles.buttonText}>7</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('8')}>
            <Text style={styles.buttonText}>8</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('9')}>
            <Text style={styles.buttonText}>9</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.operatorButton]} onPress={() => handleOperator('×')}>
            <Text style={[styles.buttonText, styles.operatorText]}>×</Text>
          </TouchableOpacity>
        </View>

        {/* Fila 3 */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('4')}>
            <Text style={styles.buttonText}>4</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('5')}>
            <Text style={styles.buttonText}>5</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('6')}>
            <Text style={styles.buttonText}>6</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.operatorButton]} onPress={() => handleOperator('−')}>
            <Text style={[styles.buttonText, styles.operatorText]}>−</Text>
          </TouchableOpacity>
        </View>

        {/* Fila 4 */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('1')}>
            <Text style={styles.buttonText}>1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('2')}>
            <Text style={styles.buttonText}>2</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => handleDigit('3')}>
            <Text style={styles.buttonText}>3</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.operatorButton]} onPress={() => handleOperator('+')}>
            <Text style={[styles.buttonText, styles.operatorText]}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Fila 5 */}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.zeroButton]} onPress={() => handleDigit('0')}>
            <Text style={styles.buttonText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleDecimal}>
            <Text style={styles.buttonText}>.</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.operatorButton]} onPress={handleEqual}>
            <Text style={[styles.buttonText, styles.operatorText]}>=</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#17171C',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  displayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  displayText: {
    color: '#FFFFFF',
    fontSize: 72,
    fontWeight: '300',
    letterSpacing: -1,
  },
  keypadContainer: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#2E2F3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zeroButton: {
    flex: 2.15,
    alignItems: 'flex-start',
    paddingLeft: 30,
  },
  actionButton: {
    backgroundColor: '#4E505F',
  },
  operatorButton: {
    backgroundColor: '#4B5EAA',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '400',
  },
  actionText: {
    color: '#E1E2EC',
  },
  operatorText: {
    color: '#FFFFFF',
    fontSize: 34,
  },
});
