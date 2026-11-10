// panel-web/src/components/MapaCalorComponent.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Mapa de calor de las emergencias (RF-4.4 / CU-11).
//
// Recibe celdas de unos 500 m con su cantidad (el backend ya agrupó las
// coordenadas), así que ningún punto marca un domicilio. Con poco zoom se ve
// la mancha de densidad; al acercarse, círculos con la cantidad de cada celda.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const MapConstructor = (maplibregl as any).Map || (maplibregl as any).default?.Map;
const NavControlConstructor = (maplibregl as any).NavigationControl || (maplibregl as any).default?.NavigationControl;
const PopupConstructor = (maplibregl as any).Popup || (maplibregl as any).default?.Popup;

export interface PuntoCalor {
  lat: number;
  lng: number;
  cantidad: number;
}

interface Props {
  puntos: PuntoCalor[];
  isDark?: boolean;
}

// Centro aproximado de la provincia de Formosa
const CENTRO_PROVINCIA: [number, number] = [-59.9, -24.9];

// Rampa secuencial de un solo tono (azul): en el mapa claro la densidad oscurece;
// en el oscuro, aclara, para que lo más denso siempre resalte sobre el fondo.
const RAMPA_CLARO = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const RAMPA_OSCURO = ['#184f95', '#256abf', '#3987e5', '#86b6ef', '#cde2fb'];

export const MapaCalorComponent: React.FC<Props> = ({ puntos, isDark = true }) => {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<any>(null);
  const listoRef = useRef(false);
  const puntosRef = useRef(puntos);
  puntosRef.current = puntos;

  const mapTilerKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY || 'HhZs7tN2CwC4JrhbLLTL';
  const estilo = isDark
    ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${mapTilerKey}`
    : `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapTilerKey}`;

  const geojson = (lista: PuntoCalor[]) => ({
    type: 'FeatureCollection',
    features: lista.map((p) => ({
      type: 'Feature',
      properties: { cantidad: p.cantidad },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  });

  const encuadrar = (mapa: any, lista: PuntoCalor[]) => {
    if (lista.length === 0) {
      mapa.jumpTo({ center: CENTRO_PROVINCIA, zoom: 5.8 });
      return;
    }
    const lngs = lista.map((p) => p.lng);
    const lats = lista.map((p) => p.lat);
    mapa.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 50, maxZoom: 12, duration: 600 }
    );
  };

  // Se crea una vez por tema (el padre cambia la key al alternar claro/oscuro)
  useEffect(() => {
    if (!contenedorRef.current || !MapConstructor) return;
    const rampa = isDark ? RAMPA_OSCURO : RAMPA_CLARO;
    const mapa = new MapConstructor({ container: contenedorRef.current, style: estilo, center: CENTRO_PROVINCIA, zoom: 5.8 });
    if (NavControlConstructor) mapa.addControl(new NavControlConstructor({ showCompass: false }), 'top-right');
    mapaRef.current = mapa;

    mapa.on('load', () => {
      const maximo = Math.max(1, ...puntosRef.current.map((p) => p.cantidad));
      mapa.addSource('emergencias', { type: 'geojson', data: geojson(puntosRef.current) });
      mapa.addLayer({
        id: 'emergencias-calor',
        type: 'heatmap',
        source: 'emergencias',
        maxzoom: 13,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'cantidad'], 0, 0, maximo, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 24, 12, 44],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.85, 13, 0],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.15, rampa[0], 0.35, rampa[1], 0.55, rampa[2], 0.8, rampa[3], 1, rampa[4],
          ],
        },
      });
      mapa.addLayer({
        id: 'emergencias-celdas',
        type: 'circle',
        source: 'emergencias',
        minzoom: 10,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'cantidad'], 1, 8, Math.max(2, maximo), 22],
          'circle-color': rampa[3],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11.5, 0.85],
          'circle-stroke-width': 2,
          'circle-stroke-color': isDark ? '#1C2A2E' : '#FFFFFF',
        },
      });

      if (PopupConstructor) {
        const popup = new PopupConstructor({ closeButton: false, closeOnClick: false, offset: 12 });
        mapa.on('mousemove', 'emergencias-celdas', (e: any) => {
          const cantidad = e.features?.[0]?.properties?.cantidad;
          mapa.getCanvas().style.cursor = 'pointer';
          popup
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-size:12px;color:#1A1F22;padding:2px 4px;"><strong>${cantidad}</strong> ${Number(cantidad) === 1 ? 'emergencia' : 'emergencias'} en esta zona (unos 500 m)</div>`
            )
            .addTo(mapa);
        });
        mapa.on('mouseleave', 'emergencias-celdas', () => {
          mapa.getCanvas().style.cursor = '';
          popup.remove();
        });
      }

      listoRef.current = true;
      encuadrar(mapa, puntosRef.current);
    });

    let observador: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observador = new ResizeObserver(() => mapa.resize());
      observador.observe(contenedorRef.current);
    }

    return () => {
      observador?.disconnect();
      listoRef.current = false;
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  // Nuevos filtros: se reemplazan los datos sin recrear el mapa
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !listoRef.current) return;
    const fuente = mapa.getSource('emergencias');
    if (!fuente) return;
    fuente.setData(geojson(puntos));
    const maximo = Math.max(1, ...puntos.map((p) => p.cantidad));
    mapa.setPaintProperty('emergencias-calor', 'heatmap-weight', ['interpolate', ['linear'], ['get', 'cantidad'], 0, 0, maximo, 1]);
    mapa.setPaintProperty('emergencias-celdas', 'circle-radius', ['interpolate', ['linear'], ['get', 'cantidad'], 1, 8, Math.max(2, maximo), 22]);
    encuadrar(mapa, puntos);
  }, [puntos]);

  return <div ref={contenedorRef} style={{ width: '100%', height: '100%', position: 'relative', borderRadius: 12, overflow: 'hidden' }} />;
};
