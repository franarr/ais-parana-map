/* ══════════════════════════════════════════════════════════════════
   PRIHA · Tránsito AIS Paraná — app.js
   Rama: rediseño-ux-mobile

   LÓGICA PRESERVADA INTACTA (sin cambiar):
     - DATA_URL, ESCALA, TYPE_LABEL, colores, coordenadas
     - combinarPorMMSI(): deduplica por radar más fresco
     - cargarCapasReferencia(): puertos, ríos, límites, mar, ZEE
     - cargarDatos() + setInterval(60s)
     - escapeHtml(), decodeCoord(), edadTexto()

   LÓGICA NUEVA / MODIFICADA:
     - 3 tile layers precargados (satelital default)
     - iconoBuque(cog, s): SVG triángulo rotado por COG
     - iconoAton(): SVG diamante solo contorno
     - iconoBase(): SVG cuadrado con antena
     - filterState{}: reemplaza checkboxes para AIS (chips son la UI)
     - BottomSheet: estado collapsed/mid/expanded con drag + flick
     - Panel switching: showPanel(), showDetail()
     - Propuesta A: tooltip de velocidad en hover sobre buques
     - Propuesta B: color por velocidad (escala Paraná: 0-12 kn)
     - Propuesta C: cuenta regresiva al próximo fetch
     - Propuesta D: zoom-to-fit al activar un chip
     - Propuesta E: detalle en bottom sheet en vez de popup flotante
   ══════════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════
   1. CONFIGURACIÓN (sin cambios del original)
   ══════════════════════════════════════════ */
const DATA_URL = 'data/latest.json';
const ESCALA = 600000; // AIS: valor / 600000 = grados

const TYPE_LABEL = { 0: 'Buque', 1: 'Buque', 3: 'Estación base', 4: 'Baliza / AtoN' };

// Colores por tipo de objeto AIS
const COLOR_BUQUE = '#2fb6c9';
const COLOR_ATON  = '#eab308';
const COLOR_BASE  = '#8f2fc9';

// Colores de puertos por uso
const USO_COLOR = { 'Público': '#588157', 'Privado': '#ef4444', 'Mixto': '#eab308' };
const USO_COLOR_DEFAULT = '#94a3b8';

const DEFAULT_CENTER = [-32.75, -60.7];
const DEFAULT_ZOOM   = 10;


/* ══════════════════════════════════════════
   2. INICIALIZACIÓN DEL MAPA
   ══════════════════════════════════════════ */
const map = L.map('map', {
  zoomControl: false,        // lo reubicamos nosotros
  attributionControl: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

// Zoom control: topleft para no quedar tapado por FABs ni el sheet
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Atribución: mover a bottomleft (el sheet colapsado solo tapa 56px del borde inferior)
map.attributionControl.setPosition('bottomleft');


/* ══════════════════════════════════════════
   3. TILE LAYERS (mapas base)
   Los 3 se precargan; solo uno se agrega al mapa a la vez.
   selectBasemap() hace el switch con crossfade suave.
   ══════════════════════════════════════════ */
const basemaps = {
  // Satelital (Esri World Imagery) — DEFAULT según especificación
  satelital: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', minZoom: 1, maxZoom: 18 }
  ),

  // ArgenMap Oscuro IGN — era el mapa base original; pasa a ser opción
  // TMS con {-y} (no tms:true para evitar doble flip) — preservado del original
  oscuro: L.tileLayer(
    'https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/argenmap_oscuro@EPSG%3A3857@png/{z}/{x}/{-y}.png',
    { attribution: '&copy; IGN Argentina', minZoom: 1, maxZoom: 18 }
  ),

  // OpenStreetMap — opción diurna/callejera para contexto
  claro: L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', minZoom: 1, maxZoom: 19 }
  ),
};

let currentBasemap = 'satelital';
basemaps.satelital.addTo(map);

/**
 * Cambia el tile layer activo con un breve crossfade.
 * Agrega el nuevo primero (fade in natural de Leaflet),
 * luego remueve el anterior con un pequeño delay para suavizar la transición.
 */
function selectBasemap(id) {
  if (id === currentBasemap || !basemaps[id]) return;
  basemaps[id].addTo(map);
  const old = basemaps[currentBasemap];
  setTimeout(() => map.removeLayer(old), 350); // crossfade ~350ms
  currentBasemap = id;
  // Sincronizar todos los botones de basemap (panel + sidebar)
  document.querySelectorAll('.basemap-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.basemap === id);
  });
}

// Listeners de los chips de mapa base
document.querySelectorAll('.basemap-chip').forEach(btn => {
  btn.addEventListener('click', () => selectBasemap(btn.dataset.basemap));
});



/* ══════════════════════════════════════════
   5. ICONOS SVG PARA OBJETOS AIS
   Todos son L.divIcon con SVG inline, escalables y coloreables por CSS.
   ══════════════════════════════════════════ */

/**
 * Icono de BUQUE: triángulo apuntando al norte cuando angle=0,
 * rotado clockwise por COG (course over ground, campo "c" ÷ 10).
 * El ancla está en el centro geométrico del icono.
 *
 * @param {number|undefined} cog - campo AIS "c" (COG × 10)
 * @param {number|undefined} sRaw - campo AIS "s" (velocidad × 10)
 */
function iconoBuque(cog, sRaw) {
  const angle = (cog != null) ? (cog / 10) : 0;
  const color = COLOR_BUQUE;
  // SVG apunta hacia arriba (norte), transform-origin al centro.
  // .marker-inner recibe la animacion CSS; el div raiz lo usa Leaflet para translate3d.
  const html = `<div class="marker-inner"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 18 24"
    style="transform:rotate(${angle}deg);transform-origin:9px 12px;overflow:visible;display:block">
    <path d="M9,2 L17,22 L9,17 L1,22 Z"
      fill="${color}" stroke="#0a1628" stroke-width="1.4" stroke-linejoin="round"/>
  </svg></div>`;
  return L.divIcon({
    className: 'marker-buque',
    html,
    iconSize:   [18, 24],
    iconAnchor: [9, 12],
  });
}

/**
 * Icono de BALIZA / AtoN: diamante solo contorno (sin relleno).
 * Forma navtex estándar para balizas.
 */
function iconoAton() {
  const html = `<div class="marker-inner"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"
    style="display:block">
    <polygon points="7,1 13,7 7,13 1,7" fill="none" stroke="${COLOR_ATON}" stroke-width="1.8"/>
  </svg></div>`;
  return L.divIcon({
    className: 'marker-aton',
    html,
    iconSize:   [14, 14],
    iconAnchor: [7, 7],
  });
}

/**
 * Icono de ESTACIÓN BASE / Radar: cuadrado con símbolo de antena.
 */
function iconoBase() {
  const html = `<div class="marker-inner"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"
    style="display:block">
    <rect x="0.5" y="5" width="13" height="10.5"
      fill="${COLOR_BASE}" stroke="#0a1628" stroke-width="1.2" rx="1"/>
    <line x1="7" y1="1" x2="7" y2="5" stroke="${COLOR_BASE}" stroke-width="1.5"/>
    <line x1="4.5" y1="2.5" x2="7" y2="1" stroke="${COLOR_BASE}" stroke-width="1.1"/>
    <line x1="9.5" y1="2.5" x2="7" y2="1" stroke="${COLOR_BASE}" stroke-width="1.1"/>
  </svg></div>`;
  return L.divIcon({
    className: 'marker-base',
    html,
    iconSize:   [14, 16],
    iconAnchor: [7, 11],
  });
}

/**
 * Icono de PUERTO: círculo con ancla SVG interior.
 * Color según uso declarado (público/privado/mixto).
 * Preservado y refinado del original.
 */
function iconoPuerto(uso) {
  const color = USO_COLOR[uso] || USO_COLOR_DEFAULT;
  const html = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11" fill="${color}" stroke="#0a1628" stroke-width="1.5"/>
    <g stroke="#0a1628" stroke-width="1.5" fill="none" stroke-linecap="round">
      <circle cx="12" cy="7.5" r="1.6" fill="#0a1628" stroke="none"/>
      <line x1="12" y1="9" x2="12" y2="18"/>
      <path d="M7.5 14.5 a4.5 4.5 0 0 0 9 0"/>
      <line x1="9" y1="10.5" x2="15" y2="10.5"/>
    </g>
  </svg>`;
  return L.divIcon({
    className: '',
    html,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
  });
}


/* ══════════════════════════════════════════
   6. ESTADO DE FILTROS
   filterState reemplaza los checkboxes DOM para
   los tipos de objeto AIS (los chips son la UI).
   Las capas de referencia (puertos/ríos/etc) siguen
   usando checkboxes tradicionales en el panel.
   ══════════════════════════════════════════ */
const filterState = {
  buques:  true,
  atones:  true,
  bases:   true,
  puertos: true,
};


/* ══════════════════════════════════════════
   7. LAYER GROUPS (preservado del original)
   ══════════════════════════════════════════ */
const capaObjetivos   = L.layerGroup().addTo(map);
const capaPuertos     = L.layerGroup();
const capaRios        = L.layerGroup();
const capaLimitesProv = L.layerGroup();
const capaLimitesIntl = L.layerGroup();
const capaMarTerr     = L.layerGroup();
const capaZee         = L.layerGroup();

let markersMeta = []; // [{ marker, tipo, mmsi, tgt }]
let objectCounts = { buques: 0, atones: 0, bases: 0 };


/* ══════════════════════════════════════════
   8. FUNCIONES UTILITARIAS (preservadas del original)
   ══════════════════════════════════════════ */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function decodeCoord(v) { return v / ESCALA; }

function edadTexto(seg) {
  if (seg == null) return '';
  if (seg < 60)   return `hace ${seg}s`;
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  return `hace ${(seg / 3600).toFixed(1)} h`;
}


/* ══════════════════════════════════════════
   9. HTML DE DETALLE DE OBJETO AIS
   Genera el HTML para mostrar en el panel de detalle
   (Propuesta E: bottom sheet en vez de popup flotante).
   ══════════════════════════════════════════ */
function getCountryByMMSI(mmsi) {
  if (!mmsi) return 'Desconocido';
  const mid = String(mmsi).substring(0, 3);
  const flags = {
    '701': '🇦🇷 Argentina',
    '755': '🇵🇾 Paraguay',
    '720': '🇧🇴 Bolivia',
    '714': '🇧🇷 Brasil',
    '770': '🇺🇾 Uruguay',
    '370': '🇵🇦 Panamá', '371': '🇵🇦 Panamá', '372': '🇵🇦 Panamá',
    '351': '🇵🇦 Panamá', '352': '🇵🇦 Panamá', '353': '🇵🇦 Panamá',
    '354': '🇵🇦 Panamá', '355': '🇵🇦 Panamá', '356': '🇵🇦 Panamá',
    '357': '🇵🇦 Panamá', '636': '🇱🇷 Liberia', '538': '🇲🇭 Islas Marshall'
  };
  return flags[mid] || `MID: ${mid}`;
}

function detailHTML(mmsi, tgt) {
  const nombre = tgt.n?.trim() || `MMSI ${mmsi}`;
  const tipo   = TYPE_LABEL[tgt.t] || `Tipo ${tgt.t}`;
  const pais   = getCountryByMMSI(mmsi);
  
  // Endpoint de fotos (si falla, muestra un placeholder)
  const photoUrl = `https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=${mmsi}`;
  const vfLink = `https://www.vesselfinder.com/vessels/details/${mmsi}`;

  const html = `
    <div class="ficha-header">
      <h2 class="ficha-title">${escapeHtml(nombre)}</h2>
      <div class="ficha-subtitle">${escapeHtml(tipo)} &nbsp;&middot;&nbsp; ${pais}</div>
    </div>
    
    <div class="ficha-photo">
      <img src="${photoUrl}" alt="Foto de ${escapeHtml(nombre)}" onerror="this.src='https://via.placeholder.com/600x300/12140f/80a162?text=Sin+Foto+Disponible'">
    </div>

    <div class="ficha-grid">
      <div class="ficha-stat">
        <span class="stat-lbl">MMSI</span>
        <span class="stat-val">${escapeHtml(mmsi)}</span>
      </div>
      <div class="ficha-stat">
        <span class="stat-lbl">Velocidad</span>
        <span class="stat-val">${tgt.s !== undefined ? (tgt.s / 10).toFixed(1) + ' nds' : '-'}</span>
      </div>
      <div class="ficha-stat">
        <span class="stat-lbl">Rumbo</span>
        <span class="stat-val">${tgt.c !== undefined ? (tgt.c / 10).toFixed(1) + '&deg;' : '-'}</span>
      </div>
      <div class="ficha-stat">
        <span class="stat-lbl">Última Señal</span>
        <span class="stat-val">${tgt.a !== undefined ? edadTexto(tgt.a) : '-'}</span>
      </div>
    </div>

    <a href="${vfLink}" target="_blank" rel="noopener noreferrer" class="ficha-btn-external">
      Ver Ficha Completa &rarr;
    </a>
  `;
  return html;
}

/* ══════════════════════════════════════════
   10. CARGA DE CAPAS DE REFERENCIA (preservado del original)
   ══════════════════════════════════════════ */
async function cargarCapaGeoJSON(url) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function cargarCapasReferencia() {
  // Puertos
  try {
    const data = await cargarCapaGeoJSON('data/puertos.geojson');
    L.geoJSON(data, {
      pointToLayer: (f, ll) => L.marker(ll, { icon: iconoPuerto(f.properties.uso) }),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindPopup(
          `<div class="popup-title">${escapeHtml(p.nombre)}</div>` +
          `<div class="popup-row"><b>Tipo</b>: ${escapeHtml(p.tipo)}</div>` +
          `<div class="popup-row"><b>Uso</b>: ${escapeHtml(p.uso)}</div>`
        );
      },
    }).addTo(capaPuertos);
    const badgePuertos = document.getElementById('badge-puertos');
    if (badgePuertos && data.features) badgePuertos.textContent = data.features.length;
  } catch(e) { console.error('Puertos:', e); }

  // Cursos de agua (tono rojizo, preservado)
  try {
    const data = await cargarCapaGeoJSON('data/rios.geojson');
    L.geoJSON(data, {
      style: { color: '#ef4444', weight: 0.6, opacity: 0.4, fillColor: '#7f1d1d', fillOpacity: 0.4 },
      onEachFeature: (f, layer) => {
        const nombre = f.properties.fna || f.properties.objeto || 'Curso de agua';
        layer.bindPopup(`<div class="popup-title">${escapeHtml(nombre)}</div>`);
      },
    }).addTo(capaRios);
    capaRios.eachLayer(l => l.bringToBack && l.bringToBack());
  } catch(e) { console.error('Ríos:', e); }

  // Límites provinciales
  try {
    const data = await cargarCapaGeoJSON('data/limites_provinciales.geojson');
    L.geoJSON(data, {
      style: { color: '#f8fafc', weight: 1.8, opacity: 0.85, dashArray: '5,5' },
      onEachFeature: (f, layer) =>
        layer.bindPopup(`<div class="popup-title">${escapeHtml(f.properties.gna || f.properties.fna)}</div>`),
    }).addTo(capaLimitesProv);
  } catch(e) { console.error('Límites prov:', e); }

  // Límites internacionales
  try {
    const data = await cargarCapaGeoJSON('data/limites_internacionales.geojson');
    L.geoJSON(data, {
      style: { color: '#eab308', weight: 2.4, opacity: 0.9, dashArray: '8,4' },
      onEachFeature: (f, layer) =>
        layer.bindPopup(`<div class="popup-title">${escapeHtml(f.properties.gna || f.properties.fna)}</div>`),
    }).addTo(capaLimitesIntl);
  } catch(e) { console.error('Límites intl:', e); }

  // Mar territorial (OFF por default — preservado)
  try {
    const data = await cargarCapaGeoJSON('data/mar_territorial.geojson');
    L.geoJSON(data, {
      style: { color: '#38bdf8', weight: 1, opacity: 0.6, fillColor: '#0ea5e9', fillOpacity: 0.12 },
      onEachFeature: (f, layer) =>
        layer.bindPopup('<div class="popup-title">Mar territorial argentino</div>'),
    }).addTo(capaMarTerr);
  } catch(e) { console.error('Mar terr:', e); }

  // ZEE (OFF por default — preservado)
  try {
    const data = await cargarCapaGeoJSON('data/zona_economica_exclusiva.geojson');
    L.geoJSON(data, {
      style: { color: '#a855f7', weight: 1, opacity: 0.55, dashArray: '3,5', fillOpacity: 0 },
      onEachFeature: (f, layer) =>
        layer.bindPopup('<div class="popup-title">Zona económica exclusiva</div>'),
    }).addTo(capaZee);
  } catch(e) { console.error('ZEE:', e); }

  // Capas activas por default al cargar
  [capaRios, capaLimitesProv, capaLimitesIntl, capaPuertos].forEach(c => c.addTo(map));

  // Listeners de checkboxes de capas de referencia (preservados del original)
  document.getElementById('chk-puertos').addEventListener('change', e =>
    e.target.checked ? capaPuertos.addTo(map) : map.removeLayer(capaPuertos));
  document.getElementById('chk-rios').addEventListener('change', e =>
    e.target.checked ? capaRios.addTo(map) : map.removeLayer(capaRios));
  document.getElementById('chk-limprov').addEventListener('change', e =>
    e.target.checked ? capaLimitesProv.addTo(map) : map.removeLayer(capaLimitesProv));
  document.getElementById('chk-limintl').addEventListener('change', e =>
    e.target.checked ? capaLimitesIntl.addTo(map) : map.removeLayer(capaLimitesIntl));
  document.getElementById('chk-marterr').addEventListener('change', e =>
    e.target.checked ? capaMarTerr.addTo(map) : map.removeLayer(capaMarTerr));
  document.getElementById('chk-zee').addEventListener('change', e =>
    e.target.checked ? capaZee.addTo(map) : map.removeLayer(capaZee));
}

cargarCapasReferencia();


/* ══════════════════════════════════════════
   11. RENDERIZADO DE OBJETOS AIS
   ══════════════════════════════════════════ */

/**
 * Combina los targets de las 5 zonas en un solo dict por MMSI,
 * quedándose con el reporte más fresco (menor "a").
 * Lógica PRESERVADA INTACTA del original.
 */
function combinarPorMMSI(zonas) {
  const combinados = {};
  Object.entries(zonas || {}).forEach(([zona, dataZona]) => {
    const tgts = (dataZona?.tgts) || {};
    Object.entries(tgts).forEach(([mmsi, tgt]) => {
      if (typeof tgt.x !== 'number' || typeof tgt.y !== 'number') return;
      const edadNueva = tgt.a ?? Infinity;
      const existente = combinados[mmsi];
      if (!existente || edadNueva < (existente.a ?? Infinity)) {
        combinados[mmsi] = { ...tgt, _zona: zona };
      }
    });
  });
  return combinados;
}

/**
 * Renderiza todos los objetos AIS en el mapa.
 * Usa los nuevos iconos SVG; en vez de bindPopup, usa showDetail()
 * (Propuesta E). Tooltip de velocidad para buques (Propuesta A).
 */
function renderObjetivos(combinados) {
  capaObjetivos.clearLayers();
  markersMeta = [];
  objectCounts = { buques: 0, atones: 0, bases: 0 };

  Object.entries(combinados).forEach(([mmsi, tgt]) => {
    const lat = decodeCoord(tgt.y);
    const lon = decodeCoord(tgt.x);
    let marker;

    if (tgt.t === 4) {
      // Baliza / AtoN: diamante sin relleno
      marker = L.marker([lat, lon], { icon: iconoAton() });
      objectCounts.atones++;
    } else if (tgt.t === 3) {
      // Estación base / Radar: cuadrado con antena
      marker = L.marker([lat, lon], { icon: iconoBase() });
      objectCounts.bases++;
    } else {
      // Buques (tipo 0 y 1): triángulo rotado por COG
      marker = L.marker([lat, lon], { icon: iconoBuque(tgt.c, tgt.s) });
      objectCounts.buques++;

      // Propuesta A: tooltip de velocidad en hover (solo buques)
      if (tgt.s !== undefined) {
        marker.bindTooltip(`${(tgt.s / 10).toFixed(1)} kn`, {
          permanent: false,
          direction: 'right',
          className: 'speed-tooltip',
          offset: [8, 0],
        });
      }
    }

    // Propuesta E: click abre detalle en el bottom sheet en vez de popup flotante
    marker.on('click', () => showDetail(mmsi, tgt));

    capaObjetivos.addLayer(marker);
    markersMeta.push({ marker, tipo: tgt.t, mmsi, tgt });
  });

  updateBadges();
  return objectCounts.buques + objectCounts.atones + objectCounts.bases;
}

/** Actualiza los badge de conteo en los chips del header. */
function updateBadges() {
  document.getElementById('badge-buques').textContent = objectCounts.buques;
  document.getElementById('badge-atones').textContent = objectCounts.atones;
  document.getElementById('badge-bases').textContent  = objectCounts.bases;
}

/**
 * Aplica el filterState actual a los markers cargados.
 * Lee de filterState{} (no de checkboxes DOM).
 * Lógica ADAPTADA del original (que leía de checkboxes).
 */
function aplicarFiltros() {
  markersMeta.forEach(({ marker, tipo }) => {
    const visible =
      ((tipo === 0 || tipo === 1) && filterState.buques) ||
      (tipo === 4 && filterState.atones) ||
      (tipo === 3 && filterState.bases) ||
      ![0, 1, 3, 4].includes(tipo); // tipos desconocidos: siempre visibles
    const enMapa = capaObjetivos.hasLayer(marker);
    if (visible && !enMapa) capaObjetivos.addLayer(marker);
    if (!visible && enMapa) capaObjetivos.removeLayer(marker);
  });
}


/* ══════════════════════════════════════════
   12. CHIP FILTER HANDLERS
   Los chips reemplazan los checkboxes de tipos AIS.
   El chip "puertos" también controla la capa capaPuertos.
   ══════════════════════════════════════════ */
document.querySelectorAll('.chip[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    const filter = chip.dataset.filter;

    if (filter === 'puertos') {
      // Chip puertos: toggle de la capa de referencia
      filterState.puertos = !filterState.puertos;
      chip.classList.toggle('active', filterState.puertos);
      chip.setAttribute('aria-pressed', String(filterState.puertos));
      filterState.puertos ? capaPuertos.addTo(map) : map.removeLayer(capaPuertos);
      // También sincroniza el checkbox dentro del panel
      const chk = document.getElementById('chk-puertos');
      if (chk) chk.checked = filterState.puertos;
      return;
    }

    // Chips de tipos AIS: comportamiento "smart toggle" (radio button)
    const aisFilters = ['buques', 'atones', 'bases'];
    const activeCount = aisFilters.filter(f => filterState[f]).length;
    
    // Si cliquea el que ya es el único activo, resetea mostrando todos
    if (filterState[filter] && activeCount === 1) {
      aisFilters.forEach(f => filterState[f] = true);
    } else {
      // Sino, aisla el cliqueado
      aisFilters.forEach(f => filterState[f] = (f === filter));
    }

    aisFilters.forEach(f => {
      const c = document.getElementById(`chip-${f}`);
      if (c) {
        c.classList.toggle('active', filterState[f]);
        c.setAttribute('aria-pressed', String(filterState[f]));
      }
    });
    
    aplicarFiltros();

  });
});


/* ══════════════════════════════════════════
   13. BOTTOM SHEET — MÁQUINA DE ESTADOS
   3 estados: collapsed → mid → expanded
   En desktop (≥1024px) isDesktop() devuelve true:
     - no se aplican transforms (CSS posiciona como sidebar)
     - drag gesture no actúa
   ══════════════════════════════════════════ */
const sheet  = document.getElementById('bottom-sheet');
const handle = document.getElementById('sheet-handle');

let sheetState = 'collapsed'; // Estado actual del sheet

/** Devuelve true cuando el breakpoint desktop está activo. */
function isDesktop() {
  return window.matchMedia('(min-width: 1024px)').matches;
}

/**
 * Calcula la posición Y (translateY en px) correspondiente a cada estado.
 * El sheet tiene height: 88vh; los estados definen cuánto se ve.
 */
function getStateY(state) {
  const h = sheet.offsetHeight;
  if (state === 'collapsed') return h - 56;   // solo 56px visible
  if (state === 'mid')       return h * 0.55; // ~45% visible (≈40% del viewport)
  if (state === 'expanded')  return h * 0.04; // ~96% visible (≈85% del viewport)
  return h - 56;
}

/**
 * Transiciona el sheet al estado indicado.
 * No actúa en desktop (isDesktop() == true).
 * @param {string} state - 'collapsed' | 'mid' | 'expanded'
 */
function setSheetState(state) {
  if (isDesktop()) return;
  sheetState = state;
  sheet.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1)';
  sheet.style.transform  = `translateY(${getStateY(state)}px)`;
}

/** Inicializa la posición collapsed al cargar (en mobile). */
function initSheetPosition() {
  if (isDesktop()) {
    sheet.style.transform  = '';
    sheet.style.transition = '';
    return;
  }
  sheet.style.transition = 'none';
  sheet.style.transform  = `translateY(${getStateY('collapsed')}px)`;
}

// Ejecutar tras primer layout para que offsetHeight esté disponible
requestAnimationFrame(initSheetPosition);

// Re-calcular en resize (orientación de pantalla, etc.)
window.addEventListener('resize', () => {
  if (isDesktop()) {
    sheet.style.transform  = '';
    sheet.style.transition = '';
  } else {
    setSheetState(sheetState);
  }
});


/* ══════════════════════════════════════════
   14. DRAG GESTURE DEL BOTTOM SHEET
   Soporta flick/swipe y snap por posición:

   FLICK: si velocity > 0.5 px/ms → snap al próximo estado
   POSICIÓN: si no hay flick, snap al estado más cercano

   Umbral de velocidad: 0.5 px/ms
     Positivo (dedo baja) = collapse direction
     Negativo (dedo sube) = expand direction
   ══════════════════════════════════════════ */
(function initDrag() {
  let isDragging  = false;
  let startY      = 0;
  let startSheetY = 0; // translateY al inicio del drag
  let lastY       = 0;
  let lastTime    = 0;
  let velocity    = 0; // px/ms; positivo = baja, negativo = sube

  const VELOCITY_THRESHOLD = 0.5; // px/ms — umbral de flick

  /** Lee el translateY actual del inline style (seteado por JS). */
  function getCurrentY() {
    const m = (sheet.style.transform || '').match(/translateY\((-?[\d.]+)px\)/);
    return m ? parseFloat(m[1]) : getStateY('collapsed');
  }

  function onStart(y) {
    if (isDesktop()) return;
    isDragging  = true;
    startY      = y;
    startSheetY = getCurrentY();
    lastY       = y;
    lastTime    = performance.now();
    velocity    = 0;
    sheet.style.transition = 'none'; // sin transición durante el drag
  }

  function onMove(y) {
    if (!isDragging || isDesktop()) return;
    const now = performance.now();
    const dt  = now - lastTime;
    if (dt > 0) velocity = (y - lastY) / dt; // px/ms
    lastY    = y;
    lastTime = now;

    const delta    = y - startY;
    const minY     = getStateY('expanded');
    const maxY     = getStateY('collapsed');
    const newY     = Math.max(minY, Math.min(maxY, startSheetY + delta));
    sheet.style.transform = `translateY(${newY}px)`;
  }

  function onEnd() {
    if (!isDragging || isDesktop()) return;
    isDragging = false;

    // Leer posición actual ANTES de cambiar nada
    const currentY = getCurrentY();

    // Orden de estados: de más expandido a más colapsado
    const stateOrder = ['expanded', 'mid', 'collapsed'];
    const currentIdx = stateOrder.indexOf(sheetState);

    let targetState;

    // 1. FLICK: velocidad supera el umbral → snap al siguiente estado
    if (velocity > VELOCITY_THRESHOLD) {
      // Sube la velocidad positiva (dedo baja) → colapsar
      targetState = stateOrder[Math.min(currentIdx + 1, stateOrder.length - 1)];
    } else if (velocity < -VELOCITY_THRESHOLD) {
      // Velocidad negativa (dedo sube) → expandir
      targetState = stateOrder[Math.max(currentIdx - 1, 0)];
    } else {
      // 2. POSICIÓN: snap al estado más cercano en distancia Y
      const distances = stateOrder.map(s => ({
        state: s,
        dist: Math.abs(currentY - getStateY(s)),
      }));
      targetState = distances.sort((a, b) => a.dist - b.dist)[0].state;
    }

    // Aplicar estado con transición (re-habilitar antes de setear transform)
    requestAnimationFrame(() => {
      setSheetState(targetState);
    });
  }

  // ── Touch events (mobile) ──
  // Solo comenzar drag desde el handle
  handle.addEventListener('touchstart', e => {
    onStart(e.touches[0].clientY);
  }, { passive: true });

  // touchmove en document para capturar incluso si el dedo se sale del handle
  document.addEventListener('touchmove', e => {
    if (isDragging) {
      e.preventDefault(); // evita scroll nativo del documento mientras se arrastra
      onMove(e.touches[0].clientY);
    }
  }, { passive: false });

  document.addEventListener('touchend', () => onEnd());

  // ── Mouse events (fallback: testing en desktop DevTools) ──
  handle.addEventListener('mousedown', e => { onStart(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => { if (isDragging) onMove(e.clientY); });
  document.addEventListener('mouseup',   () => onEnd());

  // Click en el handle o en la barra de resumen: cicla entre estados (accesibilidad / tap)
  const toggleSheet = () => {
    if (isDesktop()) return;
    const order = ['collapsed', 'mid', 'expanded'];
    const next  = order[(order.indexOf(sheetState) + 1) % order.length];
    setSheetState(next);
  };
  
  handle.addEventListener('click', toggleSheet);
  const summaryEl = document.getElementById('sheet-summary');
  if (summaryEl) summaryEl.addEventListener('click', toggleSheet);

  // Enter/Space en el handle (accesibilidad teclado)
  handle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const order = ['collapsed', 'mid', 'expanded'];
      const next  = order[(order.indexOf(sheetState) + 1) % order.length];
      setSheetState(next);
    }
  });
})();


/* ══════════════════════════════════════════
   15. SWITCHING DE PANELES
   ══════════════════════════════════════════ */
let activePanel = 'layers';

/**
 * Muestra el panel indicado, oculta los demás.
 * @param {string} panelId - 'layers' | 'detail' | 'metodologia'
 */
function showPanel(panelId) {
  document.querySelectorAll('.sheet-panel').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById(`panel-${panelId}`);
  if (target) {
    target.classList.remove('hidden');
    activePanel = panelId;
  }
}

// Botones volver
document.getElementById('btn-back-detail').addEventListener('click', () => {
  showPanel('layers');
});
document.getElementById('btn-back-metodologia').addEventListener('click', () => {
  showPanel('layers');
});

// Botón "Metodología" dentro del panel de capas
document.getElementById('btn-show-metodologia').addEventListener('click', () => {
  showPanel('metodologia');
  if (!isDesktop()) setSheetState('expanded');
});


/* ══════════════════════════════════════════
   16. PANEL DE DETALLE (Propuesta E)
   Al clickear un marker AIS, en vez de abrir el popup
   flotante de Leaflet, se muestra la info en el sheet/sidebar.
   ══════════════════════════════════════════ */

/**
 * Muestra el detalle de un objeto AIS en el panel inferior/lateral.
 * @param {string} mmsi - MMSI del objeto
 * @param {Object} tgt  - datos del objeto AIS
 */
function showDetail(mmsi, tgt) {
  const detailEl = document.getElementById('detail-content');
  detailEl.innerHTML = detailHTML(mmsi, tgt);
  showPanel('detail');
  // En mobile: expandir a estado mid para que el detalle sea legible
  if (!isDesktop()) setSheetState('mid');
}

// Cerrar detalle al clickear en el mapa (área vacía)
map.on('click', () => {
  if (activePanel === 'detail') {
    showPanel('layers');
    if (!isDesktop()) setSheetState('collapsed');
  }
});


/* ══════════════════════════════════════════
   17. HANDLERS DE FABs (mobile/tablet)
   ══════════════════════════════════════════ */

// FAB Capas: toggle del sheet entre collapsed y mid
document.getElementById('fab-layers').addEventListener('click', () => {
  showPanel('layers');
  const next = sheetState === 'collapsed' ? 'mid' : 'collapsed';
  setSheetState(next);
  document.getElementById('fab-layers').classList.toggle('active', next !== 'collapsed');
});

// FAB Info: abre panel de metodología
document.getElementById('fab-info').addEventListener('click', () => {
  showPanel('metodologia');
  setSheetState('expanded');
  document.getElementById('fab-info').classList.add('active');
});

// FAB Reset: restablece la vista del mapa (preservado del original)
document.getElementById('fab-reset').addEventListener('click', () => {
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
});



/* ══════════════════════════════════════════
   19. CUENTA REGRESIVA HASTA PRÓXIMO FETCH (Propuesta C)
   Muestra en el chip "En vivo" el tiempo restante
   hasta la próxima actualización de datos AIS.
   ══════════════════════════════════════════ */
let countdownVal = 300;
const countdownEl = document.getElementById('live-countdown');

function formatCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

setInterval(() => {
  countdownVal = Math.max(0, countdownVal - 1);
  if (countdownEl) countdownEl.textContent = formatCountdown(countdownVal);
}, 1000);

function resetCountdown() {
  countdownVal = 300;
  if (countdownEl) countdownEl.textContent = formatCountdown(countdownVal);
}


/* ══════════════════════════════════════════
   20. CARGA Y ACTUALIZACIÓN DE DATOS AIS
   Preservada intacta del original.
   Añadidos: cache de combinados para re-render (Propuesta B),
   resetCountdown(), actualización de summary.
   ══════════════════════════════════════════ */
async function cargarDatos() {
  const summaryCount   = document.getElementById('summary-count');
  const summaryUpdated = document.getElementById('summary-updated');
  const summaryError   = document.getElementById('summary-error');

  try {
    const resp = await fetch(DATA_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    // Timestamp de actualización en el resumen
    if (data.actualizado) {
      const fecha = new Date(data.actualizado);
      summaryUpdated.textContent = 'Act. ' + fecha.toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit',
      });
    } else {
      summaryUpdated.textContent = 'Act. desconocida';
    }

    // Procesar y renderizar objetivos AIS
    const combinados = combinarPorMMSI(data.zonas || {});
    window.__lastCombinados = combinados; // cache para re-render de colores (Propuesta B)

    const total = renderObjetivos(combinados);
    aplicarFiltros();

    summaryCount.textContent = `${total} objetos`;
    summaryError.hidden = true;

    // Auto-centrar en el primer reporte válido (preservado del original)
    if (!window.__mapaCentrado) {
      const primerZona = Object.values(data.zonas || {}).find(z => typeof z.x === 'number');
      if (primerZona) {
        map.setView([decodeCoord(primerZona.y), decodeCoord(primerZona.x)], 11);
        window.__mapaCentrado = true;
      }
    }

    resetCountdown();

  } catch (err) {
    summaryCount.textContent = 'Error al cargar';
    summaryError.textContent = err.message;
    summaryError.hidden      = false;
    console.error('Error cargando datos AIS:', err);

  } finally {
    // Ocultar loading overlay con fade (solo al primer load)
    const overlay = document.getElementById('loading-overlay');
    if (overlay && !overlay.classList.contains('fade-out')) {
      overlay.classList.add('fade-out');
      setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }
  }
}

// Carga inicial y auto-refresco cada 5 minutos
cargarCapasReferencia();
cargarDatos();
setInterval(cargarDatos, 300_000);
