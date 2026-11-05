import { createBtsSearch } from './bts-search.mjs';
import { createBtsDetail } from './bts-detail.mjs';

const operators = {
    o2: { name: 'O2', file: 'bts-data.json', color: '#dc2626', stroke: '#991b1b' },
    tmobile: { name: 'T-Mobile', file: 'bts-data-tmobile.json', color: '#e20074', stroke: '#99004d' }
};

let operatorSites = [];
let operatorSitesById = new Map();
let currentOperator = null;
let requestSequence = 0;
const operatorDownloads = new Map();
let search;
let popup;

const API_KEY = "QgTpsrlenL20brYpGs0q3EpgJxRp4AuoywAjGVd_6yw";
let map;
let geolocateControl = null;
let gpsRequested = false;
let gpsButtonPressed = false;
let gpsFixPending = false;
let gpsCoordinates = null;
let manualCoordinates = null;
let userLocationMarker = null;

function setStatus(id, message) {
    document.getElementById(id).textContent = message;
}

function installGeolocation() {
    const control = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 7000, maximumAge: 2000 },
        trackUserLocation: true,
        showUserHeading: true,
        fitBoundsOptions: { maxZoom: 15 }
    });
    geolocateControl = control;
    gpsRequested = false;
    gpsFixPending = false;

    control.on('trackuserlocationstart', () => {
        if (control !== geolocateControl) return;
        gpsRequested = true;
        if (!gpsCoordinates) {
            gpsFixPending = true;
            setStatus('position-status', 'Zjišťuji polohu…');
        }
    });
    control.on('trackuserlocationend', () => {
        // This also fires on map panning. Only a GPS button press ends our fix.
        if (control !== geolocateControl || !gpsButtonPressed) return;
        gpsFixPending = false;
        gpsCoordinates = null;
        if (!manualCoordinates) setNearestActive(false);
        setStatus('position-status', '');
    });
    control.on('geolocate', ({ coords }) => {
        if (control !== geolocateControl) return;
        gpsFixPending = false;
        gpsCoordinates = [coords.longitude, coords.latitude];
        manualCoordinates = null;
        userLocationMarker?.remove();
        userLocationMarker = null;
        setStatus('position-status', '');
        refreshNearest();
    });
    control.on('error', (event) => {
        if (control !== geolocateControl) return;
        gpsFixPending = false;
        const denied = event.code === 1;
        setStatus('position-status', denied
            ? 'Přístup k poloze je zamítnutý. Zadejte souřadnice do hledání.'
            : 'Polohu se nepodařilo získat. Zkuste GPS znovu nebo zadejte souřadnice.');
        if (!manualCoordinates) {
            gpsCoordinates = null;
            setNearestActive(false);
        }
    });
    map.addControl(control, 'top-left');
}

function initMap() {
    // Inicializace MapLibre GL mapy s Mapy.cz REST API stylem
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'mapy-basic': {
                    type: 'raster',
                    tiles: [
                        `https://api.mapy.com/v1/maptiles/basic/256/{z}/{x}/{y}?apikey=${API_KEY}`
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank">Seznam.cz a.s. a další</a>'
                }
            },
            layers: [
                {
                    id: 'mapy-basic-layer',
                    type: 'raster',
                    source: 'mapy-basic',
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        },
        center: [14.42076, 50.08804], // Praha
        zoom: 12
    });

    installGeolocation();
    map.getContainer().addEventListener('click', (event) => {
        if (!event.target.closest('.maplibregl-ctrl-geolocate')) return;
        gpsButtonPressed = true;
        queueMicrotask(() => { gpsButtonPressed = false; });
    }, true);

    // Hint "Začni zde" u GPS tlačítka
    map.on('load', () => {
        setTimeout(() => {
            const geoBtn = document.querySelector('.maplibregl-ctrl-geolocate');
            if (!geoBtn) return;

            const hint = document.createElement('div');
            hint.id = 'gps-hint';
            hint.innerHTML = '📍 Začni zde';
            document.body.appendChild(hint);

            // Pozice vedle GPS tlačítka
            function positionHint() {
                const rect = geoBtn.getBoundingClientRect();
                hint.style.top = rect.top + rect.height / 2 + 'px';
                hint.style.left = rect.right + 10 + 'px';
            }
            positionHint();

            // Zmizí po kliknutí na GPS
            geoBtn.addEventListener('click', () => {
                hint.classList.add('gps-hint-hide');
                setTimeout(() => { if (hint.parentNode) hint.remove(); }, 400);
            }, { once: true });

            // Nebo zmizí samo po 5 sekundách
            setTimeout(() => {
                if (hint.parentNode) {
                    hint.classList.add('gps-hint-hide');
                    setTimeout(() => { if (hint.parentNode) hint.remove(); }, 400);
                }
            }, 5000);
        }, 800); // malá pauza po načtení mapy
    });

    map.once('load', async () => {
        setupOperatorSwitcher();
        search = createBtsSearch({
            input: document.getElementById('search-input'),
            results: document.getElementById('search-results'),
            clearButton: document.getElementById('search-clear'),
            onSelectBts: focusBts,
            onSelectCoordinates: setManualCoordinates,
            onStats: showVisitStats
        });

        map.on('click', 'layer-bts-touch', (event) => {
            const site = operatorSitesById.get(event.features[0]?.properties.id);
            if (site) showBts(site);
        });
        map.on('click', (event) => {
            if (!map.getLayer('layer-bts-touch') ||
                map.queryRenderedFeatures(event.point, { layers: ['layer-bts-touch'] }).length === 0) {
                clearSectors();
            }
        });
        map.on('mouseenter', 'layer-bts-touch', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'layer-bts-touch', () => map.getCanvas().style.cursor = '');

        fetch('https://api.counterapi.dev/v1/sydloch-btsmapa/visits/up', { mode: 'no-cors' }).catch(() => {});

        const params = new URLSearchParams(location.search);
        const operator = params.get('operator') === 'tmobile' ? 'tmobile' : 'o2';
        if (await loadBtsData(operator) && params.has('bts')) {
            const site = operatorSitesById.get(params.get('bts'));
            if (site) {
                focusBts(site);
            } else {
                setStatus('data-status', 'BTS z odkazu se v této síti nenašla.');
            }
        }
    });
}

async function showVisitStats() {
    try {
        const response = await fetch('https://api.counterapi.dev/v1/sydloch-btsmapa/visits');
        if (!response.ok) throw new Error('Statistiky nejsou dostupné');
        const data = await response.json();
        setStatus('data-status', `Počet načtení mapy: ${data.count}`);
    } catch {
        setStatus('data-status', 'Statistiky návštěv se nepodařilo načíst.');
    }
}

function closeBtsPopup() {
    popup?.remove();
    popup = null;
}

function showBts(site, anchor) {
    closeBtsPopup();
    if (sectorMode) {
        drawSectors(site.coords, site.cells);
        return;
    }
    const shareUrl = new URL(location.pathname, location.origin);
    shareUrl.searchParams.set('operator', currentOperator);
    shareUrl.searchParams.set('bts', site.id);
    popup = new maplibregl.Popup({ anchor, maxWidth: 'none', className: 'modern-popup' })
        .setLngLat(site.coords)
        .setDOMContent(createBtsDetail(site, { operator: currentOperator, shareUrl: shareUrl.href }))
        .addTo(map);
}

function focusBts(site) {
    map.flyTo({ center: site.coords, zoom: 16 });
    showBts(site, 'top');
}

function getOperatorSites(operator) {
    if (!operatorDownloads.has(operator)) {
        const download = fetch(operators[operator].file, { cache: 'no-cache' })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((sites) => {
                if (!Array.isArray(sites)) throw new Error('Neplatný formát dat BTS');
                return sites;
            })
            .catch((error) => {
                operatorDownloads.delete(operator);
                throw error;
            });
        operatorDownloads.set(operator, download);
    }
    return operatorDownloads.get(operator);
}

async function loadBtsData(operator) {
    const request = ++requestSequence;
    const { name } = operators[operator];
    setStatus('data-status', `Načítám síť ${name}…`);
    let sites;
    try {
        sites = await getOperatorSites(operator);
    } catch (error) {
        if (request === requestSequence) {
            console.error('Načítání BTS selhalo', error);
            setStatus('data-status', `Síť ${name} se nepodařilo načíst. Zkuste ji vybrat znovu.`);
        }
        return false;
    }
    if (request !== requestSequence) return false;

    currentOperator = operator;
    operatorSites = sites;
    renderSites();
    document.querySelectorAll('.operator-btn').forEach((button) => {
        const selected = button.dataset.operator === operator;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    return true;
}

function setupOperatorSwitcher() {
    document.querySelectorAll('.operator-btn').forEach((button) => {
        button.addEventListener('click', () => loadBtsData(button.dataset.operator));
    });
}

function renderSites() {
    operatorSitesById = new Map(operatorSites.map((site) => [site.id, site]));
    search.setSites(operatorSites);

    const geojson = {
        type: 'FeatureCollection',
        features: operatorSites.map(({ id, coords }) => ({
            type: 'Feature',
            properties: { id },
            geometry: { type: 'Point', coordinates: coords }
        }))
    };
    const operator = operators[currentOperator];
    const source = map.getSource('bts-points');
    if (source) {
        source.setData(geojson);
        map.setPaintProperty('layer-bts-points', 'circle-color', operator.color);
        map.setPaintProperty('layer-bts-points', 'circle-stroke-color', operator.stroke);
    } else {
        map.addSource('bts-points', {
            type: 'geojson',
            data: geojson,
            tolerance: 0,
            attribution: 'Data BTS: <a href="https://gsmweb.cz/">GSMweb.cz</a>'
        });
        map.addLayer({
            id: 'layer-bts-points-bg', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-opacity': 0.8 }
        });
        map.addLayer({
            id: 'layer-bts-points', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 5, 'circle-color': operator.color, 'circle-stroke-width': 1, 'circle-stroke-color': operator.stroke }
        });
        map.addLayer({
            id: 'layer-bts-touch', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 18, 'circle-color': 'transparent', 'circle-opacity': 0 }
        });
    }

    closeBtsPopup();
    clearSectors();
    refreshNearest();
    const count = new Intl.NumberFormat('cs-CZ').format(operatorSites.length);
    setStatus('data-status', `${operator.name} · ${count} BTS`);
}

// ====== PŘEPÍNAČ MAPOVÝCH PODKLADŮ ======
function setupMapSwitcher() {
    const buttons = document.querySelectorAll('.map-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const style = btn.dataset.style;
            buttons.forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-pressed', String(b === btn));
            });
            switchMapStyle(style);
        });
    });
}

function switchMapStyle(style) {
    if (!map) return;

    // Odstraň staré zdroje a vrstvy pro podklad
    if (map.getLayer('mapy-basic-layer')) map.removeLayer('mapy-basic-layer');
    if (map.getLayer('mapy-labels-layer')) map.removeLayer('mapy-labels-layer');
    if (map.getSource('mapy-basic')) map.removeSource('mapy-basic');
    if (map.getSource('mapy-labels')) map.removeSource('mapy-labels');

    if (style === 'aerial-labels') {
        // Satelit + popisky = dvě vrstvy
        map.addSource('mapy-basic', {
            type: 'raster',
            tiles: [`https://api.mapy.com/v1/maptiles/aerial/256/{z}/{x}/{y}?apikey=${API_KEY}`],
            tileSize: 256,
            attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank">Seznam.cz a.s. a další</a>'
        });
        map.addSource('mapy-labels', {
            type: 'raster',
            tiles: [`https://api.mapy.com/v1/maptiles/names-overlay/256/{z}/{x}/{y}?apikey=${API_KEY}`],
            tileSize: 256
        });
        // Vloží pod BTS vrstvy
        const firstBtsLayer = map.getLayer('layer-bts-points-bg') ? 'layer-bts-points-bg' : undefined;
        map.addLayer({ id: 'mapy-basic-layer', type: 'raster', source: 'mapy-basic', minzoom: 0, maxzoom: 19 }, firstBtsLayer);
        map.addLayer({ id: 'mapy-labels-layer', type: 'raster', source: 'mapy-labels', minzoom: 0, maxzoom: 19 }, firstBtsLayer);
    } else {
        // Jeden podklad (basic, outdoor, aerial)
        map.addSource('mapy-basic', {
            type: 'raster',
            tiles: [`https://api.mapy.com/v1/maptiles/${style}/256/{z}/{x}/{y}?apikey=${API_KEY}`],
            tileSize: 256,
            attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank">Seznam.cz a.s. a další</a>'
        });
        const firstBtsLayer = map.getLayer('layer-bts-points-bg') ? 'layer-bts-points-bg' : undefined;
        map.addLayer({ id: 'mapy-basic-layer', type: 'raster', source: 'mapy-basic', minzoom: 0, maxzoom: 19 }, firstBtsLayer);
    }
}

// ====== KOMPASOVÁ ROTACE ======
// Vzor dle maplibre-gl-compass: jednoduchý, ověřený přístup
let compassActive = false;
let rafId = null;
let compassTimeout = null;

// Handlery
let compassAbsoluteHandler = null;
let compassFallbackHandler = null;

// Kruhový klouzavý průměr (100 vzorků – profesionální vyhlazení)
const HISTORY_SIZE = 100;
let headingHistory = [];
let currentHeading = null;

// Detekce nestability
let lastCalibHintTime = 0;

// Vypočítej heading z eventu (dle maplibre-gl-compass)
function calculateCompassHeading(event) {
    const heading = Number.isFinite(event.webkitCompassHeading) && event.webkitCompassHeading >= 0
        ? event.webkitCompassHeading
        : (event.absolute || event.type === 'deviceorientationabsolute') && Number.isFinite(event.alpha)
            ? 360 - event.alpha
            : null;
    if (heading === null) return null;
    const rotation = screen.orientation?.angle ?? window.orientation ?? 0;
    return ((heading + rotation) % 360 + 360) % 360;
}

// Kruhový klouzavý průměr (sin/cos – správně přes 0°/360°)
function calculateMovingAverage() {
    if (headingHistory.length === 0) return null;

    const sinSum = headingHistory.reduce((s, h) => s + Math.sin(h * Math.PI / 180), 0);
    const cosSum = headingHistory.reduce((s, h) => s + Math.cos(h * Math.PI / 180), 0);
    let avg = Math.atan2(sinSum / headingHistory.length, cosSum / headingHistory.length) * 180 / Math.PI;
    if (avg < 0) avg += 360;
    return avg;
}

// Detekce jitteru (rozptyl > 40° = nekalibrovaný kompas)
function checkStability() {
    if (headingHistory.length < 20) return;

    const sinSum = headingHistory.slice(-20).reduce((s, h) => s + Math.sin(h * Math.PI / 180), 0);
    const cosSum = headingHistory.slice(-20).reduce((s, h) => s + Math.cos(h * Math.PI / 180), 0);
    const mean = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;

    let maxDev = 0;
    headingHistory.slice(-20).forEach(h => {
        let diff = Math.abs(h - mean);
        if (diff > 180) diff = 360 - diff;
        if (diff > maxDev) maxDev = diff;
    });

    if (maxDev > 40 && Date.now() - lastCalibHintTime > 15000) {
        lastCalibHintTime = Date.now();
        showCalibrationHint(true);
    }
}

// Společný handler pro oba eventy
function onDeviceOrientation(event) {
    if (!compassActive) return;
    const heading = calculateCompassHeading(event);
    if (heading == null) return;

    // Pokud přijde absoluteorientation, odpoj relativní (a naopak pro iOS)
    if (event.type === 'deviceorientationabsolute' && event.alpha != null) {
        if (compassFallbackHandler) {
            window.removeEventListener('deviceorientation', compassFallbackHandler, true);
            compassFallbackHandler = null;
        }
    } else if (event.type === 'deviceorientation' && event.webkitCompassHeading != null) {
        if (compassAbsoluteHandler) {
            window.removeEventListener('deviceorientationabsolute', compassAbsoluteHandler, true);
            compassAbsoluteHandler = null;
        }
    }

    headingHistory.push(heading);
    if (headingHistory.length > HISTORY_SIZE) headingHistory.shift();

    currentHeading = calculateMovingAverage();
    checkStability();
}

let isUserInteracting = false;

// Render loop – 60fps, oddělený od senzorů
function compassRenderLoop() {
    if (!compassActive || !map) {
        rafId = null;
        return;
    }

    if (currentHeading !== null) {
        // setBearing přímo – MapLibre bearing = heading pro "heading-up" režim
        // Během interakce uživatele (zoom/panning) nevnucujeme bearing, aby se mapa netrhala
        const delta = (currentHeading - map.getBearing() + 540) % 360 - 180;
        if (!isUserInteracting && !map.isZooming() && !map.isMoving() && Math.abs(delta) >= 0.5) {
            map.setBearing(currentHeading);
        }

        // Otáčej ciferník kompasu (ring se otáčí opačně = N ukazuje kde je sever)
        const ring = document.getElementById('compass-ring');
        if (ring) {
            ring.style.transform = `rotate(${-currentHeading}deg)`;
        }

        // Zobraz azimut ve stupních
        const degEl = document.getElementById('compass-degree');
        if (degEl) {
            degEl.textContent = Math.round(currentHeading) % 360 + '°';
        }
    }

    rafId = requestAnimationFrame(compassRenderLoop);
}

// Zobrazení upozornění na kalibraci
function showCalibrationHint(show) {
    let hint = document.getElementById('calibration-hint');
    if (show && !hint) {
        hint = document.createElement('div');
        hint.id = 'calibration-hint';
        hint.className = 'ui-overlay';
        hint.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(30,58,95,0.92);backdrop-filter:blur(8px);color:white;padding:8px 16px;border-radius:10px;font-size:12px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:2000;max-width:80vw;';
        hint.innerHTML = '🔄 Kompas je nepřesný – zkuste s telefonem udělat osmičku ve vzduchu';
        document.body.appendChild(hint);
        setTimeout(() => { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 6000);
    } else if (!show && hint) {
        hint.parentNode.removeChild(hint);
    }
}

function stopCompass() {
    compassActive = false;
    currentHeading = null;
    headingHistory = [];

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    clearTimeout(compassTimeout);
    if (compassAbsoluteHandler) { window.removeEventListener('deviceorientationabsolute', compassAbsoluteHandler, true); compassAbsoluteHandler = null; }
    if (compassFallbackHandler) { window.removeEventListener('deviceorientation', compassFallbackHandler, true); compassFallbackHandler = null; }

    const btn = document.getElementById('compass-btn');
    if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    }
    const ring = document.getElementById('compass-ring');
    if (ring) ring.style.transform = '';
    const degEl = document.getElementById('compass-degree');
    if (degEl) degEl.textContent = '---';
    showCalibrationHint(false);

    if (map) map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
}

function startCompass() {
    compassActive = true;
    headingHistory = [];
    currentHeading = null;
    lastCalibHintTime = 0;

    const btn = document.getElementById('compass-btn');
    if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
    }

    // Spuštění render loop
    rafId = requestAnimationFrame(compassRenderLoop);

    // Připojit oba listenery – automaticky se vybere lepší zdroj
    compassAbsoluteHandler = onDeviceOrientation;
    compassFallbackHandler = onDeviceOrientation;

    window.addEventListener('deviceorientationabsolute', compassAbsoluteHandler, true);
    window.addEventListener('deviceorientation', compassFallbackHandler, true);

    // Timeout – žádná data
    compassTimeout = setTimeout(() => {
        if (compassActive && currentHeading === null) {
            stopCompass();
            setStatus('position-status', 'Prohlížeč neposkytl údaje o směru k severu. Zkontrolujte přístup k senzorům.');
        }
    }, 3500);
}

// Pozastavení při neaktivním okně (šetří baterii)
document.addEventListener('visibilitychange', () => {
    if (!compassActive) return;
    if (document.hidden) {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
        if (!rafId) rafId = requestAnimationFrame(compassRenderLoop);
    }
});

function setupCompass() {
    const btn = document.getElementById('compass-btn');
    if (!btn) return;

    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure) {
        btn.title = 'Kompas vyžaduje HTTPS';
        btn.style.opacity = '0.4';
        btn.addEventListener('click', () => setStatus('position-status', 'Kompas funguje přes HTTPS.'));
        return;
    }

    btn.addEventListener('click', async () => {
        if (compassActive) {
            stopCompass();
        } else {
            if (typeof DeviceOrientationEvent === 'undefined') {
                setStatus('position-status', 'Kompas není v tomto prohlížeči dostupný.');
                return;
            }
            // iOS povolení
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                btn.disabled = true;
                try {
                    const p = await DeviceOrientationEvent.requestPermission();
                    if (p !== 'granted') {
                        setStatus('position-status', 'Přístup ke kompasu je zamítnutý.');
                        return;
                    }
                } catch {
                    setStatus('position-status', 'Přístup ke kompasu selhal.');
                    return;
                } finally {
                    btn.disabled = false;
                }
            }
            setStatus('position-status', '');
            startCompass();
        }
    });

    // Detekce interakce uživatele (pan/zoom) pro pozastavení kompasu
    if (map) {
        map.on('touchstart', () => isUserInteracting = true);
        map.on('touchend', () => isUserInteracting = false);
        map.on('mousedown', () => isUserInteracting = true);
        map.on('mouseup', () => isUserInteracting = false);
    }
}

// ====== VIZUALIZACE SEKTORŮ ======
let sectorMode = false;
let sectorMarkers = [];
const SECTOR_COLORS = ['#ef4444', '#22c55e', '#3b82f6']; // červená, zelená, modrá
const SECTOR_LAYER_PREFIX = 'sector-wedge-';
const SECTOR_SOURCE = 'sector-source';

// Vytvoření výseče (wedge) jako GeoJSON polygon
function createWedge(centerLng, centerLat, radiusMeters, startDeg, endDeg) {
    const points = 24;
    const coords = [[centerLng, centerLat]];
    const latFactor = 1 / 111320;
    const lngFactor = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));

    for (let i = 0; i <= points; i++) {
        const angle = startDeg + (endDeg - startDeg) * (i / points);
        const rad = angle * Math.PI / 180;
        const dx = radiusMeters * Math.sin(rad) * lngFactor;
        const dy = radiusMeters * Math.cos(rad) * latFactor;
        coords.push([centerLng + dx, centerLat + dy]);
    }
    coords.push([centerLng, centerLat]); // uzavřít polygon
    return [coords];
}

// Smazání starých sektorů
function clearSectors() {
    for (let i = 0; i < 6; i++) {
        const layerId = SECTOR_LAYER_PREFIX + i;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getLayer(layerId + '-line')) map.removeLayer(layerId + '-line');
    }
    if (map.getSource(SECTOR_SOURCE)) map.removeSource(SECTOR_SOURCE);

    // Smazání popisků sektorů
    if (typeof sectorMarkers !== 'undefined') {
        sectorMarkers.forEach(m => m.remove());
        sectorMarkers = [];
    }
}

// Výpočet přibližného dosahu podle bandu (v metrech)
function getRadiusByBand(bandName) {
    const ranges = {
        'GSM': 600, 'LTE 800': 500, 'LTE 900': 450,
        'LTE 1800': 350, 'LTE 2100': 300, 'LTE 2600': 250,
        'NR 700': 400, 'NR 1800': 300, 'NR 2100': 250, 'NR 3500': 180
    };
    return ranges[bandName] || 300;
}

// Kreslení sektorů pro danou BTS
function drawSectors(coords, cells) {
    clearSectors();

    // Extrahuj unikátní sektory z CI (formát "eNodeBID:sectorID" nebo jen číslo)
    const sectorSet = new Map(); // sectorId → { bands: [], color }
    cells.forEach(cell => {
        let sectorId = 0;
        const ci = String(cell.ci);
        if (ci.includes(':')) {
            sectorId = parseInt(ci.split(':').pop()) || 0;
        }
        // Omez na 0-2 (3 sektory)
        sectorId = sectorId % 3;

        if (!sectorSet.has(sectorId)) {
            sectorSet.set(sectorId, { bands: [] });
        }
        // Zamezení duplicitám v jednom sektoru
        if (!sectorSet.get(sectorId).bands.includes(cell.band)) {
            sectorSet.get(sectorId).bands.push(cell.band);
        }
    });

    // Pokud máme jen 1 sektor nebo žádné, nakresli 3 výchozí
    if (sectorSet.size === 0) {
        sectorSet.set(0, { bands: ['LTE 1800'] });
        sectorSet.set(1, { bands: ['LTE 1800'] });
        sectorSet.set(2, { bands: ['LTE 1800'] });
    }

    // Adaptivní velikost dle zoomu
    const zoom = map.getZoom();
    const zoomScale = Math.pow(2, 15 - zoom); // při zoom 15 = scale 1

    const features = [];
    const sectorCount = Math.max(sectorSet.size, 1);
    const wedgeAngle = 360 / Math.max(sectorCount, 3) - 10; // 10° mezera mezi sektory

    let idx = 0;
    sectorSet.forEach((data, sectorId) => {
        // Střed sektoru: 0→0°, 1→120°, 2→240° (klasická konfigurace)
        const centerAngle = sectorId * 120;
        const halfAngle = wedgeAngle / 2;
        const startAngle = centerAngle - halfAngle;
        const endAngle = centerAngle + halfAngle;

        // Nejmenší band = nejkratší dosah (vizuálně nejzajímavější)
        const mainBand = data.bands[0] || 'LTE 1800';
        const radius = getRadiusByBand(mainBand) * zoomScale;

        const polygon = createWedge(coords[0], coords[1], radius, startAngle, endAngle);

        features.push({
            type: 'Feature',
            properties: {
                color: SECTOR_COLORS[sectorId % 3],
                sectorId: sectorId,
                idx: idx
            },
            geometry: {
                type: 'Polygon',
                coordinates: polygon
            }
        });

        // Výpočet pozice pro popisek (v 60% vzdálenosti od středu ve směru azimutu)
        const labelDist = radius * 0.6;
        const bisectorRad = centerAngle * Math.PI / 180;
        const latFactor = 1 / 111320;
        const lngFactor = 1 / (111320 * Math.cos(coords[1] * Math.PI / 180));
        const labelLng = coords[0] + labelDist * Math.sin(bisectorRad) * lngFactor;
        const labelLat = coords[1] + labelDist * Math.cos(bisectorRad) * latFactor;

        // Formátování pásem na malá písmena
        const labelText = data.bands.map(b => b.toLowerCase()).join(', ');

        // Vytvoření HTML markeru
        const el = document.createElement('div');
        el.className = 'sector-label';
        el.style.color = SECTOR_COLORS[sectorId % 3];
        el.style.background = 'rgba(255, 255, 255, 0.9)';
        el.style.padding = '2px 6px';
        el.style.borderRadius = '4px';
        el.style.fontSize = '10px';
        el.style.fontWeight = 'bold';
        el.style.border = `1px solid ${SECTOR_COLORS[sectorId % 3]}`;
        el.style.whiteSpace = 'nowrap';
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
        el.style.pointerEvents = 'none'; // Aby marker neblokoval kliknutí na mapu pod ním
        el.textContent = labelText;

        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([labelLng, labelLat])
            .addTo(map);

        sectorMarkers.push(marker);

        idx++;
    });

    // Přidej GeoJSON source
    map.addSource(SECTOR_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    // Přidej vrstvy pod BTS body
    const beforeLayer = map.getLayer('layer-bts-points-bg') ? 'layer-bts-points-bg' : undefined;

    features.forEach((f, i) => {
        // Vyplněná výseč
        map.addLayer({
            id: SECTOR_LAYER_PREFIX + i,
            type: 'fill',
            source: SECTOR_SOURCE,
            filter: ['==', ['get', 'idx'], i],
            paint: {
                'fill-color': f.properties.color,
                'fill-opacity': 0.2
            }
        }, beforeLayer);

        // Obrys výseče
        map.addLayer({
            id: SECTOR_LAYER_PREFIX + i + '-line',
            type: 'line',
            source: SECTOR_SOURCE,
            filter: ['==', ['get', 'idx'], i],
            paint: {
                'line-color': f.properties.color,
                'line-width': 2,
                'line-opacity': 0.6
            }
        }, beforeLayer);
    });
}

function setupSectors() {
    const btn = document.getElementById('sector-btn');
    if (!btn) return;
    const note = document.getElementById('sector-note');

    btn.addEventListener('click', () => {
        sectorMode = !sectorMode;
        btn.classList.toggle('active', sectorMode);
        btn.setAttribute('aria-pressed', String(sectorMode));
        if (note) note.hidden = !sectorMode;
        if (sectorMode) {
            closeBtsPopup();
        } else {
            clearSectors();
        }
    });
}
// ====== NEJBLIŽŠÍ BTS ======
const NEAREST_SOURCE = 'nearest-lines-source';
const NEAREST_LAYER_LINE = 'nearest-lines-layer';
const NEAREST_LAYER_LABEL = 'nearest-labels-layer';
let nearestMarkers = [];
let nearestActive = false;

// Haversine vzdálenost v metrech
function haversineDistance(lng1, lat1, lng2, lat2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clearNearestLines() {
    if (map.getLayer(NEAREST_LAYER_LABEL)) map.removeLayer(NEAREST_LAYER_LABEL);
    if (map.getLayer(NEAREST_LAYER_LINE)) map.removeLayer(NEAREST_LAYER_LINE);
    if (map.getSource(NEAREST_SOURCE)) map.removeSource(NEAREST_SOURCE);
    nearestMarkers.forEach(m => m.remove());
    nearestMarkers = [];
}

function showNearestBts(userLng, userLat) {
    clearNearestLines();

    if (!operatorSites.length) return;

    const nearest = [];
    for (const site of operatorSites) {
        const dist = haversineDistance(userLng, userLat, ...site.coords);
        if (nearest.length < 3 || dist < nearest[2].dist) {
            nearest.push({ coords: site.coords, dist });
            nearest.sort((a, b) => a.dist - b.dist);
            if (nearest.length > 3) nearest.pop();
        }
    }

    const colors = ['#ef4444', '#22c55e', '#f59e0b'];
    const features = [];

    nearest.forEach((bts, i) => {
        // Čára od uživatele k BTS
        features.push({
            type: 'Feature',
            properties: { color: colors[i], idx: i },
            geometry: {
                type: 'LineString',
                coordinates: [[userLng, userLat], bts.coords]
            }
        });

        // Štítek se vzdáleností – blízko pozice uživatele (15% délky čáry)
        const t = 0.15;
        const labelLng = userLng + (bts.coords[0] - userLng) * t;
        const labelLat = userLat + (bts.coords[1] - userLat) * t;
        const distText = bts.dist < 1000
            ? Math.round(bts.dist) + ' m'
            : (bts.dist / 1000).toFixed(1) + ' km';

        // HTML marker jako label
        const el = document.createElement('div');
        el.style.cssText = `
            background: ${colors[i]};
            color: white;
            font-size: 11px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 8px;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            pointer-events: none;
            line-height: 1.3;
            text-align: center;
        `;
        el.textContent = distText;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([labelLng, labelLat])
            .addTo(map);
        nearestMarkers.push(marker);
    });

    // Přidej GeoJSON source + vrstvy
    map.addSource(NEAREST_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    map.addLayer({
        id: NEAREST_LAYER_LINE,
        type: 'line',
        source: NEAREST_SOURCE,
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 2.5,
            'line-dasharray': [4, 3],
            'line-opacity': 0.85
        }
    });
}

function refreshNearest() {
    const position = manualCoordinates ?? gpsCoordinates;
    if (nearestActive && position) {
        showNearestBts(...position);
    } else {
        clearNearestLines();
    }
}

function setNearestActive(active) {
    nearestActive = active;
    const button = document.getElementById('nearest-btn');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    refreshNearest();
}

function setupNearest() {
    document.getElementById('nearest-btn').addEventListener('click', () => {
        setNearestActive(!nearestActive);
        if (!nearestActive || manualCoordinates || gpsCoordinates) return;
        if (gpsFixPending) return;
        if (!geolocateControl.trigger()) {
            setNearestActive(false);
            setStatus('position-status', 'GPS není k dispozici. Zadejte souřadnice do hledání.');
        }
    });
}

window.addEventListener('load', () => {
    try {
        initMap();
        setupMapSwitcher();
        setupCompass();
        setupSectors();
        setupNearest();
    } catch (error) {
        console.error('Spuštění mapy selhalo', error);
        setStatus('data-status', 'Mapu se nepodařilo spustit. Zkuste stránku obnovit.');
    }
}, { once: true });

function setManualCoordinates(lng, lat) {
    // Reset the control through its public lifecycle, including a GPS watch
    // that MapLibre placed in passive mode after the user panned the map.
    if (gpsRequested) {
        const previous = geolocateControl;
        geolocateControl = null;
        map.removeControl(previous);
        installGeolocation();
    }
    gpsCoordinates = null;
    manualCoordinates = [lng, lat];
    userLocationMarker?.remove();
    const element = document.createElement('div');
    element.className = 'manual-gps-dot';
    element.title = 'Ruční poloha';
    userLocationMarker = new maplibregl.Marker({ element }).setLngLat(manualCoordinates).addTo(map);
    closeBtsPopup();
    clearSectors();
    map.flyTo({ center: manualCoordinates, zoom: 16 });
    setStatus('position-status', 'Používám ručně zadanou polohu.');
    refreshNearest();
}
