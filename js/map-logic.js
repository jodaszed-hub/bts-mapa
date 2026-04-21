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
                cells.forEach(cell => {
                    tableRows += `
                        <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                            <td class="py-1 px-1.5 whitespace-nowrap text-blue-700 font-bold text-[11px]">${cell.band}</td>
                            <td class="py-1 px-1.5 whitespace-nowrap font-mono text-[10px]">${cell.ci}</td>
                            <td class="py-1 px-1.5 whitespace-nowrap text-gray-500 text-[10px]">${cell.tac}</td>
                            <td class="py-1 px-1.5 whitespace-nowrap text-gray-500 text-[10px]">${cell.phys}</td>
                            <td class="py-1 px-1.5 whitespace-nowrap text-gray-400 text-[9px]">${cell.datum}</td>
                        </tr>
                    `;
                });

                // Sestavení moderního HTML obsahu vlaječky
                const htmlContent = `
                    <div class="p-0 text-gray-800 w-full max-w-[280px] sm:max-w-[360px]">
                        <div class="bg-blue-50 px-2.5 py-2 border-b border-blue-100">
                            <h3 class="font-bold text-[13px] text-blue-800 leading-snug pr-4">${props.name}</h3>
                        </div>
                        <div class="max-h-[220px] overflow-x-auto overflow-y-auto">
                            <table class="w-full text-left">
                                <thead class="bg-gray-100/80 sticky top-0 text-gray-600 font-semibold shadow-sm text-[10px]">
                                    <tr>
                                        <th class="py-1 px-1.5">Pásmo</th>
                                        <th class="py-1 px-1.5">CI</th>
                                        <th class="py-1 px-1.5">TAC</th>
                                        <th class="py-1 px-1.5">Phys</th>
                                        <th class="py-1 px-1.5">Datum</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableRows}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                new maplibregl.Popup({
                    closeButton: true,
                    closeOnClick: true,
                    maxWidth: '85vw',
                    className: 'modern-popup'
                })
                .setLngLat(coords)
                .setHTML(htmlContent)
                .addTo(map);
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

// ====== KOMPASOVÁ ROTACE ======
let compassActive = false;
let compassAbsoluteHandler = null;
let compassFallbackHandler = null;
let smoothedHeading = null;
let hasAbsoluteData = false;
let gpsWatchId = null;
let lastGpsHeading = null;
let lastGpsTime = 0;

// GPS heading je platný max 3 sekundy (pak přepneme na magnetometr)
const GPS_HEADING_TIMEOUT = 3000;
// Minimální rychlost pro GPS heading (m/s) – cca 1 km/h
const GPS_MIN_SPEED = 0.3;

// Vyhlazovací funkce pro plynulou rotaci (low-pass filtr)
function smoothAngle(current, target, factor) {
    if (current === null) return target;
    let diff = target - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return (current + diff * factor + 360) % 360;
}

function applyHeading(heading, source) {
    if (heading === null || isNaN(heading) || !compassActive || !map) return;

    // GPS heading má VŽDY přednost (je přesnější při pohybu)
    if (source === 'magnetometer') {
        const now = Date.now();
        // Pokud máme čerstvý GPS heading, ignoruj magnetometr
        if (lastGpsHeading !== null && (now - lastGpsTime) < GPS_HEADING_TIMEOUT) {
            return;
        }
    }

    if (source === 'gps') {
        lastGpsHeading = heading;
        lastGpsTime = Date.now();
    }

    smoothedHeading = smoothAngle(smoothedHeading, heading, 0.25);
    map.setBearing(smoothedHeading);

    const icon = document.getElementById('compass-icon');
    if (icon) {
        icon.style.transform = `rotate(${-smoothedHeading}deg)`;
        icon.style.transition = 'transform 0.1s linear';
    }
}

function stopCompass() {
    compassActive = false;
    hasAbsoluteData = false;
    smoothedHeading = null;
    lastGpsHeading = null;
    lastGpsTime = 0;

    if (compassAbsoluteHandler) {
        window.removeEventListener('deviceorientationabsolute', compassAbsoluteHandler);
        compassAbsoluteHandler = null;
    }
    if (compassFallbackHandler) {
        window.removeEventListener('deviceorientation', compassFallbackHandler);
        compassFallbackHandler = null;
    }
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }

    const btn = document.getElementById('compass-btn');
    if (btn) btn.classList.remove('active');

    const icon = document.getElementById('compass-icon');
    if (icon) icon.style.transform = '';

    if (map) map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
}

function startCompass() {
    compassActive = true;
    hasAbsoluteData = false;

    const btn = document.getElementById('compass-btn');
    if (btn) btn.classList.add('active');

    // ===== 1) GPS HEADING (nejpřesnější při pohybu) =====
    if ('geolocation' in navigator) {
        gpsWatchId = navigator.geolocation.watchPosition(
            (position) => {
                if (!compassActive) return;
                const heading = position.coords.heading;
                const speed = position.coords.speed;

                // GPS heading je spolehlivý jen při pohybu
                if (heading !== null && !isNaN(heading) && speed !== null && speed >= GPS_MIN_SPEED) {
                    applyHeading(heading, 'gps');
                }
            },
            (err) => {
                console.log('GPS heading nedostupný:', err.message);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 5000
            }
        );
    }

    // ===== 2) MAGNETOMETR (absolutní orientace – záloha) =====
    compassAbsoluteHandler = (event) => {
        if (!compassActive) return;
        hasAbsoluteData = true;
        if (event.alpha !== null) {
            applyHeading((360 - event.alpha) % 360, 'magnetometer');
        }
    };

    // ===== 3) FALLBACK (iOS webkit + Android absolute) =====
    compassFallbackHandler = (event) => {
        if (!compassActive) return;
        if (hasAbsoluteData) return;

        let heading = null;

        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            heading = event.webkitCompassHeading;
        }
        else if (event.absolute === true && event.alpha !== null) {
            heading = (360 - event.alpha) % 360;
        }

        if (heading !== null) {
            applyHeading(heading, 'magnetometer');
        }
    };

    window.addEventListener('deviceorientationabsolute', compassAbsoluteHandler, true);
    window.addEventListener('deviceorientation', compassFallbackHandler, true);

    // Timeout – pokud po 3s nemáme nic
    setTimeout(() => {
        if (compassActive && smoothedHeading === null) {
            alert('Telefon neposkytl data z kompasu ani GPS. Zkuste zkalibrovat kompas (osmička ve vzduchu) a povolit GPS.');
            stopCompass();
        }
    }, 3000);
}

function setupCompass() {
    const btn = document.getElementById('compass-btn');
    if (!btn) return;

    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure) {
        btn.title = 'Kompas vyžaduje HTTPS';
        btn.style.opacity = '0.4';
        btn.addEventListener('click', () => {
            alert('Kompas funguje pouze přes HTTPS.');
        });
        return;
    }

    btn.addEventListener('click', async () => {
        if (compassActive) {
            stopCompass();
        } else {
            // Na iOS je nutné požádat o povolení
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permission = await DeviceOrientationEvent.requestPermission();
                    if (permission !== 'granted') {
                        alert('Pro orientaci mapy je třeba povolit přístup ke kompasu v nastavení.');
                        return;
                    }
                } catch (e) {
                    alert('Nepodařilo se získat přístup ke kompasu.');
                    return;
                }
            }
            startCompass();
        }
    });
}

// Spuštění mapy
window.onload = () => {
    initMap();
    setupMapSwitcher();
    setupCompass();
};
