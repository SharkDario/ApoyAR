// panel-web/src/components/MapViewComponent.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Componente de Mapa Cartográfico en Tiempo Real (CU-06 / RF-4.3 / RNF-01)
// 
// Integra MapLibre GL con soporte dual de temas (Dark Matter / Positron),
// marcadores reactivos con animación de pulso para emergencias en curso,
// popups informativos y centrado automático en incidentes seleccionados.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Resuelve constructores de MapLibre tanto para ESM nativo como empaquetadores CJS
const MapConstructor = (maplibregl as any).Map || (maplibregl as any).default?.Map;
const NavControlConstructor = (maplibregl as any).NavigationControl || (maplibregl as any).default?.NavigationControl;
const MarkerConstructor = (maplibregl as any).Marker || (maplibregl as any).default?.Marker;
const PopupConstructor = (maplibregl as any).Popup || (maplibregl as any).default?.Popup;

// Configurar URL explícita del Web Worker de MapLibre para empaquetadores Metro/Expo Web (soluciona Worker failed to load)
const setWorker = (maplibregl as any).setWorkerUrl || (maplibregl as any).default?.setWorkerUrl;
if (typeof setWorker === 'function') {
  try {
    const workerUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/maplibre-gl-worker.mjs`
      : 'https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl-worker.mjs';
    setWorker(workerUrl);
  } catch (err) {
    console.warn('[MapView] Error configurando setWorkerUrl:', err);
  }
}

export interface IncidentMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  estado: string;
  direccion?: string;
  origen?: string;
  victimaNombre?: string;
}

interface MapProps {
  markers: IncidentMarker[];
  selectedId?: string | null;
  onSelectIncident?: (id: string) => void;
  isDark?: boolean;
}

export function formatEstado(estado?: string): string {
  if (!estado) return 'CERRADO';
  const clean = estado.trim().toLowerCase();
  if (clean === 'en_curso') return 'EN CURSO';
  if (clean === 'cerrado') return 'CERRADO';
  return estado.replace(/_/g, ' ').toUpperCase();
}

export function formatOrigen(origen?: string): string {
  if (!origen) return 'Manual';
  const clean = origen.trim().toLowerCase();
  if (clean === 'automatico' || clean === 'acustico') return 'Acústico';
  if (clean === 'manual') return 'Manual';
  return origen.charAt(0).toUpperCase() + origen.slice(1);
}

export function sanitizeCoords(rawLat: any, rawLng: any): { lat: number; lng: number } {
  let lat = typeof rawLat === 'number' ? rawLat : parseFloat(rawLat);
  let lng = typeof rawLng === 'number' ? rawLng : parseFloat(rawLng);

  if (isNaN(lat) || isNaN(lng)) {
    return { lat: -26.1852, lng: -58.1756 }; // Formosa Capital por defecto
  }

  // Si vinieron invertidas (ej: latitud positiva o fuera de rango)
  if (lat < -90 || lat > 90) {
    if (lng >= -90 && lng <= 90) {
      const temp = lat;
      lat = lng;
      lng = temp;
    }
  }

  return { lat, lng };
}

interface CachedMarker {
  marker: any;
  popup: any;
  isEnCurso: boolean;
  isSelected: boolean;
  el: HTMLDivElement;
}

export const MapViewComponent: React.FC<MapProps> = ({
  markers,
  selectedId,
  onSelectIncident,
  isDark = true,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersMapRef = useRef<Map<string, CachedMarker>>(new Map());

  // Ubicación en tiempo real de la computadora (Puesto de Mando / Operador)
  const [computerPos, setComputerPos] = React.useState<{ lat: number; lng: number } | null>(null);

  // Estilos vectoriales de MapTiler / CartoDB con calles completas
  const mapTilerKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY || 'HhZs7tN2CwC4JrhbLLTL';
  const darkStyle = mapTilerKey
    ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${mapTilerKey}`
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const lightStyle = mapTilerKey
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapTilerKey}`
    : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

  const currentStyle = isDark ? darkStyle : lightStyle;

  // 1. Geolocalización de la computadora física del operador
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const cLat = pos.coords.latitude;
        const cLng = pos.coords.longitude;
        const sanitized = sanitizeCoords(cLat, cLng);
        setComputerPos(sanitized);

        // Si no hay incidente seleccionado y no hay emergencias activas, centrar en la computadora
        if (mapRef.current && !selectedId) {
          const hasActive = markers.some((m) => m.estado === 'en_curso');
          if (!hasActive) {
            mapRef.current.flyTo({
              center: [sanitized.lng, sanitized.lat],
              zoom: 14,
              duration: 1200,
              essential: true,
            });
          }
        }
      },
      (err) => {
        console.warn('[MapViewComponent] Aviso de geolocalización de computadora:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, [markers, selectedId]);

  // 2. Inyección de CSS (desacopla MapLibre translate de la animación y elimina bordes blancos en popups)
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const linkId = 'maplibre-gl-cdn-css';
    if (!document.getElementById(linkId)) {
      const linkTag = document.createElement('link');
      linkTag.id = linkId;
      linkTag.rel = 'stylesheet';
      linkTag.href = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css';
      document.head.appendChild(linkTag);
    }

    const styleId = 'maplibre-custom-styles';
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }

    styleTag.innerHTML = `
      /* Animación aplicada exclusivamente al contenedor INTERNO para no sobrescribir el transform: translate nativo de MapLibre */
      @keyframes radar-pulse {
        0% {
          transform: scale(0.95);
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.8);
        }
        70% {
          transform: scale(1.12);
          box-shadow: 0 0 0 16px rgba(239, 68, 68, 0);
        }
        100% {
          transform: scale(0.95);
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
        }
      }
      .marker-radar-wrapper {
        animation: radar-pulse 1.8s infinite;
        border-radius: 50%;
        box-sizing: border-box;
      }

      /* Rediseño limpio del contenedor nativo de popups en Modo Oscuro y Claro (sin bordes blancos) */
      .incident-popup .maplibregl-popup-content {
        background: transparent !important;
        padding: 0 !important;
        border-radius: 10px !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5) !important;
        overflow: hidden !important;
        border: none !important;
      }
      .incident-popup.dark-popup .maplibregl-popup-content {
        background: #0f172a !important;
        border: 1px solid #334155 !important;
      }
      .incident-popup.light-popup .maplibregl-popup-content {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
      }
      .incident-popup.dark-popup .maplibregl-popup-tip {
        border-top-color: #0f172a !important;
        border-bottom-color: #0f172a !important;
        border-left-color: #0f172a !important;
        border-right-color: #0f172a !important;
      }
      .incident-popup.light-popup .maplibregl-popup-tip {
        border-top-color: #ffffff !important;
        border-bottom-color: #ffffff !important;
        border-left-color: #ffffff !important;
        border-right-color: #ffffff !important;
      }
      .incident-popup .maplibregl-popup-close-button {
        display: none !important;
      }
    `;
  }, []);

  // 3. Inicialización del Mapa
  useEffect(() => {
    if (!mapContainerRef.current || !MapConstructor) return;

    let initialCenter: [number, number] = [-58.1756, -26.1852]; // Formosa Capital por defecto
    if (computerPos) {
      initialCenter = [computerPos.lng, computerPos.lat];
    } else if (markers.length > 0 && markers[0].lng && markers[0].lat) {
      const s = sanitizeCoords(markers[0].lat, markers[0].lng);
      initialCenter = [s.lng, s.lat];
    }

    if (typeof setWorker === 'function' && typeof window !== 'undefined') {
      try {
        setWorker(`${window.location.origin}/maplibre-gl-worker.mjs`);
      } catch (_) {}
    }

    const map = new MapConstructor({
      container: mapContainerRef.current,
      style: currentStyle,
      center: initialCenter,
      zoom: markers.length > 0 || computerPos ? 13 : 11,
    });

    if (NavControlConstructor) {
      map.addControl(new NavControlConstructor({ showCompass: true }), 'top-right');
    }

    map.on('load', () => {
      map.resize();
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    mapRef.current = map;

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 4. Cambiar estilo dinámicamente cuando se alterna Dark/Light mode
  useEffect(() => {
    if (!mapRef.current) return;
    try {
      mapRef.current.setStyle(currentStyle);
      setTimeout(() => {
        if (mapRef.current) mapRef.current.resize();
      }, 200);
    } catch (e) {
      console.warn('[MapView] Error al alternar estilo de mapa:', e);
    }
  }, [currentStyle]);



  // Generador de HTML para el Popup
  const generatePopupHtml = (inc: IncidentMarker, safeLat: number, safeLng: number, isEnCurso: boolean) => {
    return `
      <div style="font-family: inherit; min-width: 210px; padding: 12px 14px; background: ${isDark ? '#0f172a' : '#ffffff'}; color: ${isDark ? '#f8fafc' : '#0f172a'}; border-radius: 10px;">
        <div style="display: flex; align-items: center; gap: 7px; margin-bottom: 6px;">
          <span style="display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: ${isEnCurso ? '#ef4444' : '#10b981'}; box-shadow: ${isEnCurso ? '0 0 8px #ef4444' : 'none'}; flex-shrink: 0;"></span>
          <strong style="font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${inc.victimaNombre || 'Víctima Protegida'}
          </strong>
        </div>
        <p style="margin: 0 0 8px 0; font-size: 12px; line-height: 1.4; color: ${isDark ? '#94a3b8' : '#64748b'};">
          ${inc.direccion || `${safeLat.toFixed(5)}, ${safeLng.toFixed(5)}`}
        </p>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; padding-top: 8px; border-top: 1px solid ${isDark ? '#334155' : '#e2e8f0'};">
          <span style="display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; background: ${isEnCurso ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${isEnCurso ? '#f87171' : '#34d399'}; border: 1px solid ${isEnCurso ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'};">
            ${formatEstado(inc.estado)}
          </span>
          <span style="font-size: 11px; color: ${isDark ? '#cbd5e1' : '#475569'}; font-weight: 600;">
            Origen: <strong style="color: ${isDark ? '#f1f5f9' : '#0f172a'};">${formatOrigen(inc.origen)}</strong>
          </span>
        </div>
      </div>
    `;
  };

  // Renderizar contenido interno del marcador
  const renderMarkerContent = (el: HTMLDivElement, isEnCurso: boolean, isSelected: boolean) => {
    if (isEnCurso) {
      el.style.width = isSelected ? '46px' : '38px';
      el.style.height = isSelected ? '46px' : '38px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.cursor = 'pointer';

      el.innerHTML = `
        <div class="marker-radar-wrapper" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; filter: ${isSelected ? 'drop-shadow(0 0 14px rgba(239, 68, 68, 0.95))' : 'drop-shadow(0 4px 8px rgba(239, 68, 68, 0.7))'};">
          <img 
            src="/notificacion.png" 
            alt="Alerta SOS" 
            style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;"
          />
        </div>
      `;
    } else {
      el.style.width = isSelected ? '30px' : '24px';
      el.style.height = isSelected ? '30px' : '24px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = '#10B981';
      el.style.border = isSelected ? '3px solid #60A5FA' : '2px solid #FFFFFF';
      el.style.boxShadow = isSelected ? '0 0 14px rgba(96, 165, 250, 0.9)' : '0 3px 8px rgba(0,0,0,0.35)';
      el.style.cursor = 'pointer';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.color = '#FFFFFF';
      el.style.fontSize = '12px';
      el.style.fontWeight = 'bold';
      el.innerHTML = '✓';
    }
  };

  // 6. Actualización Reactiva de Marcadores sin destruir el DOM (Mantiene popups y animaciones)
  useEffect(() => {
    if (!mapRef.current || !MarkerConstructor || !PopupConstructor) return;

    const incomingIds = new Set(markers.map((m) => m.id));

    // A. Eliminar marcadores que ya no están en la lista
    for (const [id, cached] of markersMapRef.current.entries()) {
      if (!incomingIds.has(id)) {
        cached.marker.remove();
        markersMapRef.current.delete(id);
      }
    }

    // B. Crear o actualizar marcadores existentes
    markers.forEach((inc) => {
      const { lat: safeLat, lng: safeLng } = sanitizeCoords(inc.lat, inc.lng);
      const isSelected = selectedId === inc.id;
      const isEnCurso = inc.estado === 'en_curso';
      const cached = markersMapRef.current.get(inc.id);

      if (cached) {
        // Marcador existente: Actualizar posición exacta sin recargar
        cached.marker.setLngLat([safeLng, safeLat]);

        // Si cambió el estado o la selección, actualizar visualmente
        if (cached.isEnCurso !== isEnCurso || cached.isSelected !== isSelected) {
          cached.isEnCurso = isEnCurso;
          cached.isSelected = isSelected;
          renderMarkerContent(cached.el, isEnCurso, isSelected);
        }

        // Actualizar el contenido del popup
        const updatedPopupHtml = generatePopupHtml(inc, safeLat, safeLng, isEnCurso);
        cached.popup.setHTML(updatedPopupHtml);
      } else {
        // Nuevo marcador: Crear elemento contenedor neutro (sin animation ni transform)
        const el = document.createElement('div');
        el.className = 'custom-incident-marker';
        renderMarkerContent(el, isEnCurso, isSelected);

        const popupHtml = generatePopupHtml(inc, safeLat, safeLng, isEnCurso);
        const popup = new PopupConstructor({
          offset: isEnCurso ? 26 : 16,
          closeButton: false,
          className: `incident-popup ${isDark ? 'dark-popup' : 'light-popup'}`,
        }).setHTML(popupHtml);

        const marker = new MarkerConstructor({ element: el })
          .setLngLat([safeLng, safeLat])
          .setPopup(popup)
          .addTo(mapRef.current);

        el.addEventListener('click', () => {
          onSelectIncident?.(inc.id);
        });

        markersMapRef.current.set(inc.id, {
          marker,
          popup,
          isEnCurso,
          isSelected,
          el,
        });
      }
    });
  }, [markers, selectedId, isDark]);

  // 7. Centrar suavemente en el incidente seleccionado, en la emergencia activa o en la computadora
  useEffect(() => {
    if (!mapRef.current) return;

    if (selectedId) {
      const selectedMarker = markers.find((m) => m.id === selectedId);
      if (selectedMarker && selectedMarker.lng && selectedMarker.lat) {
        const { lat, lng } = sanitizeCoords(selectedMarker.lat, selectedMarker.lng);
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: 15,
          duration: 1200,
          essential: true,
        });
      }
    } else {
      const activeMarker = markers.find((m) => m.estado === 'en_curso');
      if (activeMarker && activeMarker.lng && activeMarker.lat) {
        const { lat, lng } = sanitizeCoords(activeMarker.lat, activeMarker.lng);
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: 14,
          duration: 1000,
          essential: true,
        });
      } else if (computerPos) {
        mapRef.current.flyTo({
          center: [computerPos.lng, computerPos.lat],
          zoom: 13,
          duration: 1000,
          essential: true,
        });
      }
    }
  }, [selectedId, markers, computerPos]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    />
  );
};
