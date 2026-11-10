import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { resguardoService, ResguardoOrigin } from '../services/resguardoService';

interface SosContextValue {
  enModoResguardo: boolean;
  setModoResguardo: (activo: boolean) => void;
  activarModoResguardo: (origen: ResguardoOrigin) => Promise<string>;
  desactivarModoResguardo: () => Promise<void>;
  // Lista de alertas pendientes silenciadas durante el resguardo
  alertasPendientes: any[];
  agregarAlertaPendiente: (alerta: any) => void;
  limpiarAlertasPendientes: () => void;
}

export const SosContext = createContext<SosContextValue>({
  enModoResguardo: false,
  setModoResguardo: () => {},
  activarModoResguardo: async () => '',
  desactivarModoResguardo: async () => {},
  alertasPendientes: [],
  agregarAlertaPendiente: () => {},
  limpiarAlertasPendientes: () => {},
});

export const useSos = () => useContext(SosContext);

export function SosProvider({ children }: { children: ReactNode }) {
  const [enModoResguardo, setModoResguardoState] = useState(resguardoService.isResguardoActive());
  const [alertasPendientes, setAlertasPendientes] = useState<any[]>([]);

  // Sincronización bidireccional con resguardoService singleton
  useEffect(() => {
    // Suscribirse a cambios del motor de resguardo
    const unsubscribe = resguardoService.subscribe((state) => {
      setModoResguardoState(state.isActive);
    });

    // Rehidratar estado guardado en AsyncStorage o verificar con backend
    resguardoService.initAsync().then((isActive) => {
      setModoResguardoState(isActive);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const setModoResguardo = useCallback((activo: boolean) => {
    if (!activo && resguardoService.isResguardoActive()) {
      resguardoService.desactivarModoResguardoAsync().catch((err) => {
        console.warn('[SosContext] Error al desactivar resguardo:', err);
      });
    }
    setModoResguardoState(activo);
  }, []);

  const activarModoResguardo = useCallback(async (origen: ResguardoOrigin) => {
    return await resguardoService.activarModoResguardoAsync(origen);
  }, []);

  const desactivarModoResguardo = useCallback(async () => {
    await resguardoService.desactivarModoResguardoAsync();
  }, []);

  const agregarAlertaPendiente = (alerta: any) => {
    setAlertasPendientes((prev) => {
      if (prev.find((a) => a.incidenteId === alerta.incidenteId)) {
        return prev;
      }
      return [...prev, alerta];
    });
  };

  const limpiarAlertasPendientes = () => {
    setAlertasPendientes([]);
  };

  return (
    <SosContext.Provider
      value={{
        enModoResguardo,
        setModoResguardo,
        activarModoResguardo,
        desactivarModoResguardo,
        alertasPendientes,
        agregarAlertaPendiente,
        limpiarAlertasPendientes,
      }}
    >
      {children}
    </SosContext.Provider>
  );
}
