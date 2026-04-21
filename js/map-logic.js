let btsData = [];

const API_KEY = "QgTpsrlenL20brYpGs0q3EpgJxRp4AuoywAjGVd_6yw";
let map;

// Vlaječky a markery

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

    // Přidání ovládacích prvků (navigace a kompas)
    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    // Přidání GPS geolokace (lokalizace zařízení a zoom)
    map.addControl(
        new maplibregl.GeolocateControl({
            positionOptions: {
                enableHighAccuracy: true
            },
            trackUserLocation: true,
            showUserHeading: true,
            fitBoundsOptions: {
                maxZoom: 15
            }
        }),
        'top-left'
    );

    map.on('load', async () => {
        try {
            // Cache buster zaručí stažení čerstvého souboru místo staré verze z paměti prohlížeče
            const response = await fetch('bts-data.json?v=' + new Date().getTime());
            btsData = await response.json();
            console.log("Načteno " + btsData.length + " vysílačů z bts-data.json");
        } catch(e) {
            console.error("Nepodařilo se načíst data vysílačů.", e);
        }

        // Pole pro body vysílačů
        const pointsData = [];

        btsData.forEach(bts => {
            // Přidání bodu pro WebGL vrstvu
            pointsData.push({
                type: 'Feature',
                properties: {
                    id: bts.id,
                    name: bts.name,
                    cells: JSON.stringify(bts.cells)
                },
                geometry: {
                    type: 'Point',
                    coordinates: bts.coords
                }
            });
        });

        // Přidání WebGL vrstvy pro BTS body (nahrazuje HTML markery)
        map.addSource('bts-points', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: pointsData },
            tolerance: 0 // Pro přesné klikání
        });
        
        // Stíny / podklady bodů
        map.addLayer({
            id: 'layer-bts-points-bg',
            type: 'circle',
            source: 'bts-points',
            paint: {
                'circle-radius': 7,
                'circle-color': '#ffffff',
                'circle-opacity': 0.8
            }
        });

        // Samotné body
        map.addLayer({
            id: 'layer-bts-points',
            type: 'circle',
            source: 'bts-points',
            paint: {
                'circle-radius': 5,
                'circle-color': '#dc2626',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#991b1b'
            }
        });

        // Neviditelná dotyková vrstva (větší oblast pro prsty na mobilu)
        map.addLayer({
            id: 'layer-bts-touch',
            type: 'circle',
            source: 'bts-points',
            paint: {
                'circle-radius': 18,
                'circle-color': 'transparent',
                'circle-opacity': 0
            }
        });

        // Kliknutí na bod (viditelná i dotyková vrstva)
        const handleBtsClick = (e) => {
            if (e.features.length > 0) {
                const feature = e.features[0];
                const coords = feature.geometry.coordinates.slice();
                const props = feature.properties;
                
                // Zajistí správné souřadnice při odzoomování
                while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
                    coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
                }

                // Získání a parsování dat o buňkách
                let cells = [];
                try {
                    cells = JSON.parse(props.cells);
                } catch(e) {}
                
                // Seskupení a seřazení buněk (např. podle pásma)
                cells.sort((a, b) => a.band.localeCompare(b.band));
                
                let tableRows = '';
                // Mapování frekvence → reálné číslo bandu (3GPP standard, O2 CZ)
                const bandMap = {
                    'LTE 800': 'B20', 'LTE 900': 'B8', 'LTE 1800': 'B3',
                    'LTE 2100': 'B1', 'LTE 2600': 'B7',
                    'NR 700': 'N28', 'NR 1800': 'N3', 'NR 2100': 'N1', 'NR 3500': 'N78',
                    'GSM': '2G'
                };
                cells.forEach(cell => {
                    const band = bandMap[cell.band] || cell.band;

                    tableRows += `
                        <tr style="border-bottom:1px solid #f3f4f6;">
                            <td style="padding:2px 3px;white-space:nowrap;color:#2563eb;font-weight:700;font-size:10px;">${band}</td>
                            <td style="padding:2px 3px;white-space:nowrap;font-family:monospace;font-size:9px;">${cell.ci}</td>
                            <td style="padding:2px 3px;white-space:nowrap;color:#6b7280;font-size:9px;">${cell.tac}</td>
                            <td style="padding:2px 3px;white-space:nowrap;color:#6b7280;font-size:9px;">${cell.phys}</td>
                            <td style="padding:2px 3px;white-space:nowrap;color:#9ca3af;font-size:8px;">${cell.datum}</td>
                        </tr>
                    `;
                });

                // Sestavení kompaktního HTML pro mobil
                const htmlContent = `
                    <div style="padding:0;color:#1f2937;max-width:260px;">
                        <div style="background:#eff6ff;padding:5px 8px;border-bottom:1px solid #dbeafe;">
                            <div style="font-weight:700;font-size:11px;color:#1e40af;line-height:1.3;padding-right:16px;">${props.name}</div>
                        </div>
                        <div style="max-height:160px;overflow-y:auto;overflow-x:hidden;">
                            <table style="width:100%;text-align:left;border-collapse:collapse;">
                                <thead>
                                    <tr style="background:#f3f4f6;position:sticky;top:0;">
                                        <th style="padding:2px 3px;font-size:9px;color:#6b7280;font-weight:600;">Band</th>
                                        <th style="padding:2px 3px;font-size:9px;color:#6b7280;font-weight:600;">CI</th>
                                        <th style="padding:2px 3px;font-size:9px;color:#6b7280;font-weight:600;">TAC</th>
                                        <th style="padding:2px 3px;font-size:9px;color:#6b7280;font-weight:600;">Phys</th>
                                        <th style="padding:2px 3px;font-size:9px;color:#6b7280;font-weight:600;">Datum</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableRows}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                const popup = new maplibregl.Popup({
                    closeButton: true,
                    closeOnClick: true,
                    maxWidth: '72vw',
                    className: 'modern-popup'
                })
                .setLngLat(coords)
                .setHTML(htmlContent)
                .addTo(map);

                // Kresli sektory pokud je režim aktivní
                if (sectorMode) {
                    drawSectors(coords, cells);
                    popup.on('close', () => clearSectors());
                }
            }
        };

        map.on('click', 'layer-bts-touch', handleBtsClick);
        map.on('click', 'layer-bts-points', handleBtsClick);

        // Změna kurzoru při najetí na bod
        map.on('mouseenter', 'layer-bts-touch', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'layer-bts-touch', () => {
            map.getCanvas().style.cursor = '';
        });

    });
}

// ====== PŘEPÍNAČ MAPOVÝCH PODKLADŮ ======
function setupMapSwitcher() {
    const buttons = document.querySelectorAll('.map-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const style = btn.dataset.style;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
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

// ====== KOMPASOVÁ ROTACE (Hybridní systém) ======
// Priorita zdrojů: 1) GPS heading (pohyb) → 2) deviceorientationabsolute → 3) webkitCompassHeading
let compassActive = false;
let smoothedHeading = null;
let targetHeading = null;
let headingSource = 'none'; // 'gps' | 'absolute' | 'webkit' | 'none'
let rafId = null;

// GPS stav
let gpsWatchId = null;
let lastGpsTime = 0;
const GPS_HEADING_TIMEOUT = 3000;
const GPS_MIN_SPEED = 0.3;

// DeviceOrientation handlery
let compassAbsoluteHandler = null;
let compassFallbackHandler = null;

// Detekce nestability (automatická kalibrace)
let headingHistory = [];
const JITTER_WINDOW = 15;
const JITTER_THRESHOLD = 40;

// Vyhlazení s ošetřením přechodu 359°→1°
function smoothAngle(current, target, factor) {
    if (current === null) return target;
    let diff = target - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return (current + diff * factor + 360) % 360;
}

// Detekce, zda jsou data stabilní
function isHeadingStable(heading) {
    headingHistory.push(heading);
    if (headingHistory.length > JITTER_WINDOW) headingHistory.shift();
    if (headingHistory.length < 5) return true;

    const sinSum = headingHistory.reduce((s, h) => s + Math.sin(h * Math.PI / 180), 0);
    const cosSum = headingHistory.reduce((s, h) => s + Math.cos(h * Math.PI / 180), 0);
    const mean = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;

    let maxDev = 0;
    headingHistory.forEach(h => {
        let diff = Math.abs(h - mean);
        if (diff > 180) diff = 360 - diff;
        if (diff > maxDev) maxDev = diff;
    });

    return maxDev < JITTER_THRESHOLD;
}

// Přijetí nového headingu z libovolného zdroje
function setHeading(heading, source) {
    if (heading === null || isNaN(heading) || !compassActive) return;

    const priority = { gps: 3, absolute: 2, webkit: 1 };

    if (source === 'gps') {
        lastGpsTime = Date.now();
    } else {
        if (Date.now() - lastGpsTime < GPS_HEADING_TIMEOUT) return;
    }

    if ((priority[source] || 0) >= (priority[headingSource] || 0) || headingSource === 'none') {
        headingSource = source;
    } else if (source !== headingSource) {
        return;
    }

    targetHeading = heading;
}

// Render loop – oddělený od senzorů (šetří baterii, plynulý pohyb)
function compassRenderLoop() {
    if (!compassActive || !map) {
        rafId = null;
        return;
    }

    if (targetHeading !== null) {
        smoothedHeading = smoothAngle(smoothedHeading, targetHeading, 0.2);
        map.setBearing(smoothedHeading);

        const icon = document.getElementById('compass-icon');
        if (icon) {
            icon.style.transform = `rotate(${-smoothedHeading}deg)`;
        }
    }

    rafId = requestAnimationFrame(compassRenderLoop);
}

// Zobrazení/skrytí upozornění na kalibraci
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
    headingSource = 'none';
    smoothedHeading = null;
    targetHeading = null;
    lastGpsTime = 0;
    headingHistory = [];

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    if (compassAbsoluteHandler) { window.removeEventListener('deviceorientationabsolute', compassAbsoluteHandler); compassAbsoluteHandler = null; }
    if (compassFallbackHandler) { window.removeEventListener('deviceorientation', compassFallbackHandler); compassFallbackHandler = null; }

    const btn = document.getElementById('compass-btn');
    if (btn) btn.classList.remove('active');
    const icon = document.getElementById('compass-icon');
    if (icon) icon.style.transform = '';
    showCalibrationHint(false);

    if (map) map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
}

function startCompass() {
    compassActive = true;
    headingSource = 'none';
    headingHistory = [];

    const btn = document.getElementById('compass-btn');
    if (btn) btn.classList.add('active');

    // Spuštění render loop
    rafId = requestAnimationFrame(compassRenderLoop);

    // ===== 1) GPS HEADING =====
    if ('geolocation' in navigator) {
        gpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!compassActive) return;
                const h = pos.coords.heading;
                const s = pos.coords.speed;
                if (h !== null && !isNaN(h) && s !== null && s >= GPS_MIN_SPEED) {
                    setHeading(h, 'gps');
                }
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
        );
    }

    // ===== 2) deviceorientationabsolute (Chrome + Firefox Android) =====
    compassAbsoluteHandler = (event) => {
        if (!compassActive) return;
        if (event.alpha !== null) {
            const h = (360 - event.alpha) % 360;
            if (!isHeadingStable(h)) showCalibrationHint(true);
            setHeading(h, 'absolute');
        }
    };
    window.addEventListener('deviceorientationabsolute', compassAbsoluteHandler, true);

    // ===== 3) deviceorientation fallback (iOS Safari) =====
    compassFallbackHandler = (event) => {
        if (!compassActive) return;
        if (headingSource === 'absolute') return;

        let heading = null;
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            heading = event.webkitCompassHeading;
        } else if (event.absolute === true && event.alpha !== null) {
            heading = (360 - event.alpha) % 360;
        }

        if (heading !== null) {
            if (!isHeadingStable(heading)) showCalibrationHint(true);
            setHeading(heading, 'webkit');
        }
    };
    window.addEventListener('deviceorientation', compassFallbackHandler, true);

    // Timeout – žádná data
    setTimeout(() => {
        if (compassActive && targetHeading === null) {
            alert('Telefon neposkytl kompasová data. Zkuste povolit senzory a GPS v nastavení prohlížeče.');
            stopCompass();
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
        btn.addEventListener('click', () => alert('Kompas funguje pouze přes HTTPS.'));
        return;
    }

    btn.addEventListener('click', async () => {
        if (compassActive) {
            stopCompass();
        } else {
            // iOS povolení
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const p = await DeviceOrientationEvent.requestPermission();
                    if (p !== 'granted') { alert('Povolte přístup ke kompasu v nastavení.'); return; }
                } catch (e) { alert('Přístup ke kompasu selhal.'); return; }
            }
            startCompass();
        }
    });
}

// ====== VIZUALIZACE SEKTORŮ ======
let sectorMode = false;
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
        sectorSet.get(sectorId).bands.push(cell.band);
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

    btn.addEventListener('click', () => {
        sectorMode = !sectorMode;
        btn.classList.toggle('active', sectorMode);
        if (!sectorMode) {
            clearSectors();
        }
    });
}

// Spuštění mapy
window.onload = () => {
    initMap();
    setupMapSwitcher();
    setupCompass();
    setupSectors();
};
