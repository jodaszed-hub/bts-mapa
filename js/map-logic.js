// Hlavní logika mapy a vyhledávání pro btsmapa-new

let btsData = [];
let currentOperator = "o2";
const API_KEY = "QgTpsrlenL20brYpGs0q3EpgJxRp4AuoywAjGVd_6yw";
let map;
let geolocateControl = null;
let gpsTrackingActive = false;
let userCoordinates = null;

// Globální filtry pásem (výchozí: vše zatrženo)
let activeBands = new Set([
    "NR 3500", "NR 2100", "NR 1800", "NR 700",
    "LTE 2600", "LTE 2100", "LTE 1800", "LTE 900", "LTE 800", "GSM"
]);
let activeDss5g = true; // Zda je aktivní DSS 5G filtr

// Mapování frekvence na 3GPP Band
const bandMap = {
    'LTE 800': 'B20', 'LTE 900': 'B8', 'LTE 1800': 'B3',
    'LTE 2100': 'B1', 'LTE 2600': 'B7',
    'NR 700': 'N28', 'NR 1800': 'N3', 'NR 2100': 'N1', 'NR 3500': 'N78',
    'GSM': '2G'
};

// Spuštění mapy a inicializace UI
window.onload = () => {
    initMap();
    setupOperatorSwitcher();
    setupMapSwitcher();
    setupSearch();
    setupFilterPanel();
    setupControls();
    
    // Propojení s technickou logikou
    if (typeof initTechLogic === 'function') {
        initTechLogic();
    }
};

// Zprovoznění GPS sledování
function ensureGpsActive() {
    if (!geolocateControl) return;
    if (!gpsTrackingActive) {
        geolocateControl.trigger();
    }
}

// Inicializace MapLibre GL
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'mapy-basic': {
                    type: 'raster',
                    tiles: [`https://api.mapy.com/v1/maptiles/basic/256/{z}/{x}/{y}?apikey=${API_KEY}`],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank">Seznam.cz a.s.</a>'
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

    // Geolokační ovládací prvek
    geolocateControl = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
        fitBoundsOptions: { maxZoom: 15 }
    });
    map.addControl(geolocateControl, 'top-left');

    geolocateControl.on('trackuserlocationstart', () => { gpsTrackingActive = true; });
    geolocateControl.on('trackuserlocationend', () => { gpsTrackingActive = false; });
    
    geolocateControl.on('geolocate', (position) => {
        userCoordinates = [position.coords.longitude, position.coords.latitude];
        // Aktualizovat výpočty směrování, pokud je otevřen panel a jsme na záložce směrování
        if (window.currentBts && typeof window.updateAlignmentInfo === 'function') {
            window.updateAlignmentInfo(window.currentBts);
        }
    });

    map.on('load', async () => {
        await loadBtsData('o2');
        
        // Zpracování kliknutí na body na mapě
        const handleBtsClick = (e) => {
            if (e.features.length > 0) {
                const feature = e.features[0];
                const coords = feature.geometry.coordinates.slice();
                const props = feature.properties;

                // Vyhledání kompletního objektu BTS v datech
                const bts = btsData.find(b => b.id === props.id);
                if (bts) {
                    window.openBtsPanel(bts);
                    if (sectorMode) {
                        drawSectors(coords, bts.cells);
                    }
                }
            }
        };

        map.on('click', 'layer-bts-touch', handleBtsClick);
        map.on('click', 'layer-bts-points', handleBtsClick);

        // Zavření pop-upů / sektorů kliknutím do mapy
        map.on('click', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['layer-bts-points', 'layer-bts-touch'] });
            if (features.length === 0) {
                clearSectors();
                // Nezavírat panel hned, pouze vyčistit čáry k nejbližším, pokud nejsou aktivní
            }
        });

        // Kurzor na bodech
        map.on('mouseenter', 'layer-bts-touch', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'layer-bts-touch', () => { map.getCanvas().style.cursor = ''; });
    });
}

// Načtení dat podle vybraného operátora
async function loadBtsData(operator) {
    currentOperator = operator;
    const filename = operator === 'tmobile' ? 'bts-data-tmobile.json' : 'bts-data.json';
    try {
        const response = await fetch(filename + '?v=' + new Date().getTime());
        btsData = await response.json();
        console.log(`Načteno ${btsData.length} vysílačů z ${filename}`);
        
        // Aktualizace vyhledávacího indexu
        buildSearchIndex();
        
        // Vykreslení dat
        renderBtsOnMap();
    } catch(e) {
        console.error("Chyba při načítání dat vysílačů:", e);
    }
}

// Vykreslení BTS bodů na mapě s ohledem na filtry pásem
function renderBtsOnMap() {
    if (!map) return;

    // Filtrování vysílačů podle aktivních pásem a DSS 5G
    const filteredFeatures = [];
    const any5gChecked = Array.from(activeBands).some(b => b.startsWith("NR "));

    btsData.forEach(bts => {
        const hasActiveBand = bts.cells.some(cell => activeBands.has(cell.band));
        
        // Zda má vysílač 5G vlastnosti
        const hasN78 = bts.cells.some(c => c.band === 'NR 3500');
        const hasExplicit5G = bts.cells.some(c => c.band.startsWith('NR '));
        const hasLte2100 = bts.cells.some(c => c.band === 'LTE 2100');
        const hasLte1800 = bts.cells.some(c => c.band === 'LTE 1800');
        const hasDss5G = hasLte2100 || hasLte1800;

        // Rozhodnutí o viditelnosti
        let isVisible = hasActiveBand;
        
        // Pokud je povolen DSS 5G filtr a je zaškrtnuté příslušné NR pásmo,
        // a vysílač má odpovídající LTE pásmo, zobrazíme jej i bez explicitní NR buňky.
        if (activeDss5g && hasDss5G && any5gChecked) {
            const nr2100Active = activeBands.has("NR 2100");
            const nr1800Active = activeBands.has("NR 1800");
            if ((nr2100Active && hasLte2100) || (nr1800Active && hasLte1800)) {
                isVisible = true;
            }
        }
        
        if (isVisible) {
            filteredFeatures.push({
                type: 'Feature',
                properties: { 
                    id: bts.id, 
                    name: bts.name,
                    has5G_n78: hasN78,
                    has5G_explicit: hasExplicit5G && !hasN78,
                    has5G_dss: hasDss5G && !hasExplicit5G && !hasN78
                },
                geometry: { type: 'Point', coordinates: bts.coords }
            });
        }
    });

    const geojsonData = { type: 'FeatureCollection', features: filteredFeatures };
    const opColor = currentOperator === 'tmobile' ? '#e20074' : '#2563eb';
    const opColorStroke = currentOperator === 'tmobile' ? '#99004d' : '#1e3a8a';

    const circleColorExpression = [
        'case',
        ['get', 'has5G_n78'], '#d97706',      // Zlatá pro n78
        ['get', 'has5G_explicit'], '#0891b2', // Tyrkysová pro explicitní 5G
        ['get', 'has5G_dss'], '#7c3aed',      // Fialová pro DSS 5G
        opColor
    ];

    const circleStrokeColorExpression = [
        'case',
        ['get', 'has5G_n78'], '#92400e',
        ['get', 'has5G_explicit'], '#155e75',
        ['get', 'has5G_dss'], '#5b21b6',
        opColorStroke
    ];

    if (map.getSource('bts-points')) {
        map.getSource('bts-points').setData(geojsonData);
        map.setPaintProperty('layer-bts-points', 'circle-color', circleColorExpression);
        map.setPaintProperty('layer-bts-points', 'circle-stroke-color', circleStrokeColorExpression);
    } else {
        map.addSource('bts-points', { type: 'geojson', data: geojsonData, tolerance: 0 });
        
        // Podkladové bílé kolečko pro zvýraznění
        map.addLayer({
            id: 'layer-bts-points-bg', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-opacity': 0.9 }
        });
        
        // Hlavní barevné kolečko
        map.addLayer({
            id: 'layer-bts-points', type: 'circle', source: 'bts-points',
            paint: {
                'circle-radius': 5,
                'circle-color': circleColorExpression,
                'circle-stroke-width': 1,
                'circle-stroke-color': circleStrokeColorExpression
            }
        });
        
        // Neviditelná dotyková vrstva (větší klikací plocha)
        map.addLayer({
            id: 'layer-bts-touch', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 20, 'circle-color': 'transparent', 'circle-opacity': 0 }
        });
    }

    // Vyčistit případné zobrazené sektory
    clearSectors();
    if (nearestActive) {
        showNearestBts();
    }
}

// Nastavení přepínače operátora
function setupOperatorSwitcher() {
    const buttons = document.querySelectorAll('.operator-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const op = btn.dataset.operator;
            loadBtsData(op);
            
            // Zavřít panel
            if (typeof closePanel === 'function') {
                closePanel();
            }
        });
    });
}

// Přepínání mapových podkladů
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

    if (map.getLayer('mapy-basic-layer')) map.removeLayer('mapy-basic-layer');
    if (map.getLayer('mapy-labels-layer')) map.removeLayer('mapy-labels-layer');
    if (map.getSource('mapy-basic')) map.removeSource('mapy-basic');
    if (map.getSource('mapy-labels')) map.removeSource('mapy-labels');

    const beforeLayer = map.getLayer('layer-bts-points-bg') ? 'layer-bts-points-bg' : undefined;

    if (style === 'aerial-labels') {
        map.addSource('mapy-basic', {
            type: 'raster',
            tiles: [`https://api.mapy.com/v1/maptiles/aerial/256/{z}/{x}/{y}?apikey=${API_KEY}`],
            tileSize: 256,
            attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank">Seznam.cz a.s.</a>'
        });
        map.addSource('mapy-labels', {
            type: 'raster',
            tiles: [`https://api.mapy.com/v1/maptiles/names-overlay/256/{z}/{x}/{y}?apikey=${API_KEY}`],
            tileSize: 256
        });
        map.addLayer({ id: 'mapy-basic-layer', type: 'raster', source: 'mapy-basic', minzoom: 0, maxzoom: 19 }, beforeLayer);
        map.addLayer({ id: 'mapy-labels-layer', type: 'raster', source: 'mapy-labels', minzoom: 0, maxzoom: 19 }, beforeLayer);
    } else {
        map.addSource('mapy-basic', {
            type: 'raster',
            tiles: [`https://api.mapy.com/v1/maptiles/${style}/256/{z}/{x}/{y}?apikey=${API_KEY}`],
            tileSize: 256,
            attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank">Seznam.cz a.s.</a>'
        });
        map.addLayer({ id: 'mapy-basic-layer', type: 'raster', source: 'mapy-basic', minzoom: 0, maxzoom: 19 }, beforeLayer);
    }
}

// Nastavení panelu pro filtrování pásem
function setupFilterPanel() {
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    const filterPanel = document.getElementById('band-filter-panel');
    const filterCloseBtn = document.getElementById('filter-close-btn');
    const btnFilterAll = document.getElementById('btn-filter-all');
    const btnFilter5g = document.getElementById('btn-filter-5g-only');
    const checkboxes = document.querySelectorAll('.band-checkbox');
    const dssCheckbox = document.getElementById('filter-dss-5g');

    filterToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterPanel.classList.toggle('hidden');
        filterToggleBtn.classList.toggle('active', !filterPanel.classList.contains('hidden'));
    });

    filterCloseBtn.addEventListener('click', () => {
        filterPanel.classList.add('hidden');
        filterToggleBtn.classList.remove('active');
    });

    // Kliknutí mimo panel ho zavře
    document.addEventListener('click', (e) => {
        if (!filterPanel.contains(e.target) && e.target !== filterToggleBtn && !filterToggleBtn.contains(e.target)) {
            filterPanel.classList.add('hidden');
            filterToggleBtn.classList.remove('active');
        }
    });

    // Změna checkboxů pásem
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) {
                activeBands.add(cb.value);
            } else {
                activeBands.delete(cb.value);
            }
            renderBtsOnMap();
        });
    });

    // Změna DSS checkboxu
    if (dssCheckbox) {
        dssCheckbox.addEventListener('change', () => {
            activeDss5g = dssCheckbox.checked;
            renderBtsOnMap();
        });
    }

    // Všechna pásma
    btnFilterAll.addEventListener('click', () => {
        checkboxes.forEach(cb => {
            cb.checked = true;
            activeBands.add(cb.value);
        });
        if (dssCheckbox) {
            dssCheckbox.checked = true;
            activeDss5g = true;
        }
        renderBtsOnMap();
    });

    // Pouze 5G
    btnFilter5g.addEventListener('click', () => {
        checkboxes.forEach(cb => {
            const is5g = cb.value.startsWith("NR ");
            cb.checked = is5g;
            if (is5g) {
                activeBands.add(cb.value);
            } else {
                activeBands.delete(cb.value);
            }
        });
        if (dssCheckbox) {
            dssCheckbox.checked = true;
            activeDss5g = true;
        }
        renderBtsOnMap();
    });
}

// ====== UNIVERZÁLNÍ VYHLEDÁVÁNÍ (Název, DEC, HEX, PCI) ======
let searchIndex = [];

function buildSearchIndex() {
    console.log("Buduji vyhledávací index...");
    searchIndex = btsData.map(bts => {
        const ids = bts.cells.map(c => {
            const dec = c.full_cid || (c.ci.includes(':') ? null : c.ci);
            const hex = dec ? parseInt(dec).toString(16).toUpperCase() : '';
            const pci = c.phys || '';
            return { dec, hex, pci, band: c.band };
        });
        
        return {
            bts: bts,
            searchText: bts.name.toLowerCase(),
            ids: ids
        };
    });
}

function setupSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    const clearBtn = document.getElementById('search-clear');
    if (!input || !results) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            results.style.display = 'none';
            clearBtn.style.display = 'none';
            return;
        }

        clearBtn.style.display = 'block';
        const filtered = [];

        // Hledáme shody
        for (const item of searchIndex) {
            let matchType = null;
            let matchValue = '';

            // 1. Shoda v názvu
            if (item.searchText.includes(query)) {
                matchType = 'name';
            } 
            // 2. Shoda v ID (DEC, HEX) nebo PCI
            else {
                const idMatch = item.ids.find(id => 
                    (id.dec && id.dec.toString().includes(query)) || 
                    (id.hex && id.hex.toLowerCase().includes(query)) ||
                    (id.pci && id.pci.toString() === query) // Přesná shoda s PCI
                );
                
                if (idMatch) {
                    if (idMatch.pci.toString() === query) {
                        matchType = 'pci';
                        matchValue = `${idMatch.pci} (Band ${bandMap[idMatch.band] || idMatch.band})`;
                    } else {
                        matchType = 'id';
                        matchValue = idMatch.dec;
                    }
                }
            }

            if (matchType) {
                filtered.push({ ...item, matchType, matchValue });
                if (filtered.length >= 12) break; // Omezit počet zobrazených výsledků
            }
        }

        renderResults(filtered, query);
    });

    function renderResults(items, query) {
        if (items.length === 0) {
            results.innerHTML = '<div class="search-item"><span class="name">Nebylo nic nalezeno</span></div>';
        } else {
            results.innerHTML = items.map(item => {
                const bts = item.bts;
                const nameHighlighted = bts.name.replace(new RegExp(query, 'gi'), m => `<b>${m}</b>`);
                const decId = bts.cells[0].full_cid || bts.cells[0].ci;
                const hexId = parseInt(decId).toString(16).toUpperCase();
                
                let detailsStr = `ID: ${decId} | HEX: ${hexId}`;
                if (item.matchType === 'pci') {
                    detailsStr = `Nalezeno PCI: ${item.matchValue} | ${detailsStr}`;
                }
                
                return `
                    <div class="search-item" data-id="${bts.id}">
                        <span class="name">${nameHighlighted}</span>
                        <span class="details">${detailsStr}</span>
                    </div>
                `;
            }).join('');
        }
        results.style.display = 'block';

        // Výběr položky z vyhledávání
        document.querySelectorAll('.search-item').forEach(el => {
            el.addEventListener('click', () => {
                const btsId = el.dataset.id;
                const targetBts = btsData.find(b => b.id === btsId);
                if (targetBts) {
                    goToBts(targetBts);
                    results.style.display = 'none';
                    input.value = targetBts.name;
                }
            });
        });
    }

    // Odcentrování mapy na vybranou BTS a otevření panelu
    function goToBts(bts) {
        map.flyTo({
            center: bts.coords,
            zoom: 16,
            essential: true
        });

        setTimeout(() => {
            window.openBtsPanel(bts);
            if (sectorMode) {
                drawSectors(bts.coords, bts.cells);
            }
        }, 500);
    }

    clearBtn.addEventListener('click', () => {
        input.value = '';
        results.style.display = 'none';
        clearBtn.style.display = 'none';
        input.focus();
    });

    // Zavření vyhledávání při kliku mimo
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !results.contains(e.target)) {
            results.style.display = 'none';
        }
    });
}

// ====== VIZUALIZACE SEKTORŮ S REÁLNÝM DOSAHEM PÁSEM ======
let sectorMode = false;
let sectorMarkers = [];
const SECTOR_COLORS = ['#ef4444', '#10b981', '#3b82f6']; // Červená, zelená, modrá
const SECTOR_LAYER_PREFIX = 'sector-wedge-';
const SECTOR_SOURCE = 'sector-source';

// Odhad reálného poloměru šíření podle pásma (v metrech)
function getRadiusByBand(bandName) {
    const ranges = {
        'GSM': 600, 'LTE 800': 500, 'LTE 900': 450,
        'LTE 1800': 320, 'LTE 2100': 280, 'LTE 2600': 220,
        'NR 700': 420, 'NR 1800': 300, 'NR 2100': 250, 'NR 3500': 150 // n78 má nejkratší dosah
    };
    return ranges[bandName] || 250;
}

// Výpočet GeoJSON výseče
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
    coords.push([centerLng, centerLat]);
    return [coords];
}

function clearSectors() {
    for (let i = 0; i < 6; i++) {
        const layerId = SECTOR_LAYER_PREFIX + i;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getLayer(layerId + '-line')) map.removeLayer(layerId + '-line');
    }
    if (map.getSource(SECTOR_SOURCE)) map.removeSource(SECTOR_SOURCE);

    sectorMarkers.forEach(m => m.remove());
    sectorMarkers = [];
}

function drawSectors(coords, cells) {
    clearSectors();

    // Seskupení pásem do 3 sektorů podle ID buňky
    const sectorSet = new Map();
    cells.forEach(cell => {
        if (!activeBands.has(cell.band)) return; // Nezobrazovat vypnutá pásma
        
        let sectorId = 0;
        const ci = String(cell.ci);
        if (ci.includes(':')) {
            sectorId = parseInt(ci.split(':').pop()) || 0;
        }
        sectorId = sectorId % 3;

        if (!sectorSet.has(sectorId)) {
            sectorSet.set(sectorId, { bands: [] });
        }
        if (!sectorSet.get(sectorId).bands.includes(cell.band)) {
            sectorSet.get(sectorId).bands.push(cell.band);
        }
    });

    if (sectorSet.size === 0) return;

    const zoom = map.getZoom();
    const zoomScale = Math.pow(2, 15 - zoom);

    const features = [];
    const wedgeAngle = 360 / Math.max(sectorSet.size, 3) - 12; // mezera 12 stupňů

    let idx = 0;
    sectorSet.forEach((data, sectorId) => {
        const centerAngle = sectorId * 120;
        const startAngle = centerAngle - wedgeAngle / 2;
        const endAngle = centerAngle + wedgeAngle / 2;

        // Dosah určíme podle nejvyššího pásma v sektoru (tj. nejkratšího dosahu, vizuálně nejdůležitější)
        let minRadius = 10000;
        data.bands.forEach(b => {
            const rad = getRadiusByBand(b);
            if (rad < minRadius) minRadius = rad;
        });
        if (minRadius === 10000) minRadius = 300;

        const radius = minRadius * zoomScale;
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

        // Popisek sektoru
        const labelDist = radius * 0.65;
        const bisectorRad = centerAngle * Math.PI / 180;
        const latFactor = 1 / 111320;
        const lngFactor = 1 / (111320 * Math.cos(coords[1] * Math.PI / 180));
        const labelLng = coords[0] + labelDist * Math.sin(bisectorRad) * lngFactor;
        const labelLat = coords[1] + labelDist * Math.cos(bisectorRad) * latFactor;

        const el = document.createElement('div');
        el.className = 'sector-label badge';
        el.style.background = 'rgba(255, 255, 255, 0.95)';
        el.style.color = SECTOR_COLORS[sectorId % 3];
        el.style.border = `1.5px solid ${SECTOR_COLORS[sectorId % 3]}`;
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        el.style.pointerEvents = 'none';
        
        // Zkratky pásem, např. B3, N78
        el.textContent = data.bands.map(b => bandMap[b] || b).join(', ');

        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([labelLng, labelLat])
            .addTo(map);

        sectorMarkers.push(marker);
        idx++;
    });

    map.addSource(SECTOR_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    const beforeLayer = map.getLayer('layer-bts-points-bg') ? 'layer-bts-points-bg' : undefined;

    features.forEach((f, i) => {
        map.addLayer({
            id: SECTOR_LAYER_PREFIX + i,
            type: 'fill',
            source: SECTOR_SOURCE,
            filter: ['==', ['get', 'idx'], i],
            paint: {
                'fill-color': f.properties.color,
                'fill-opacity': 0.18
            }
        }, beforeLayer);

        map.addLayer({
            id: SECTOR_LAYER_PREFIX + i + '-line',
            type: 'line',
            source: SECTOR_SOURCE,
            filter: ['==', ['get', 'idx'], i],
            paint: {
                'line-color': f.properties.color,
                'line-width': 2,
                'line-opacity': 0.5
            }
        }, beforeLayer);
    });
}

// ====== NEJBLIŽŠÍ VYSÍLAČE ======
let nearestActive = false;
const NEAREST_SOURCE = 'nearest-lines-source';
const NEAREST_LAYER_LINE = 'nearest-lines-layer';
let nearestMarkers = [];

// Haversine formule pro vzdálenost
function haversineDistance(lng1, lat1, lng2, lat2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clearNearestLines() {
    if (map.getLayer(NEAREST_LAYER_LINE)) map.removeLayer(NEAREST_LAYER_LINE);
    if (map.getSource(NEAREST_SOURCE)) map.removeSource(NEAREST_SOURCE);
    nearestMarkers.forEach(m => m.remove());
    nearestMarkers = [];
}

async function showNearestBts() {
    clearNearestLines();

    if (!btsData || btsData.length === 0) return;

    let targetCoords = userCoordinates;
    if (!targetCoords) {
        // Zkusit získat GPS narychlo
        try {
            targetCoords = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    pos => resolve([pos.coords.longitude, pos.coords.latitude]),
                    err => reject(err),
                    { enableHighAccuracy: true, timeout: 4000 }
                );
            });
            userCoordinates = targetCoords;
        } catch (e) {
            alert('Nelze zjistit GPS pozici pro nalezení nejbližších vysílačů.');
            nearestActive = false;
            document.getElementById('nearest-btn').classList.remove('active');
            return;
        }
    }

    const [userLng, userLat] = targetCoords;

    // Vzdálenosti k vysílačům splňujícím filtr
    const withDist = [];
    btsData.forEach(bts => {
        const hasActiveBand = bts.cells.some(cell => activeBands.has(cell.band));
        if (hasActiveBand) {
            withDist.push({
                ...bts,
                dist: haversineDistance(userLng, userLat, bts.coords[0], bts.coords[1])
            });
        }
    });

    withDist.sort((a, b) => a.dist - b.dist);
    const nearest = withDist.slice(0, 3); // top 3

    const colors = ['#ef4444', '#10b981', '#d97706'];
    const features = [];

    nearest.forEach((bts, i) => {
        features.push({
            type: 'Feature',
            properties: { color: colors[i], idx: i },
            geometry: {
                type: 'LineString',
                coordinates: [[userLng, userLat], bts.coords]
            }
        });

        // Vykreslení popup popisku se vzdáleností (ve 20% cesty k vysílači)
        const t = 0.20;
        const labelLng = userLng + (bts.coords[0] - userLng) * t;
        const labelLat = userLat + (bts.coords[1] - userLat) * t;
        const distText = bts.dist < 1000
            ? Math.round(bts.dist) + ' m'
            : (bts.dist / 1000).toFixed(2) + ' km';

        const el = document.createElement('div');
        el.className = 'nearest-marker';
        el.style.borderColor = colors[i];
        el.style.color = colors[i];
        el.textContent = distText;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([labelLng, labelLat])
            .addTo(map);
        nearestMarkers.push(marker);
    });

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
            'line-dasharray': [3, 2.5],
            'line-opacity': 0.85
        }
    });
}

// ====== PŘIPOJENÍ TLAČÍTEK ======
function setupControls() {
    // Sektory
    const sectorBtn = document.getElementById('sector-btn');
    sectorBtn.addEventListener('click', () => {
        sectorMode = !sectorMode;
        sectorBtn.classList.toggle('active', sectorMode);
        
        if (sectorMode) {
            ensureGpsActive();
            if (window.currentBts) {
                drawSectors(window.currentBts.coords, window.currentBts.cells);
            }
        } else {
            clearSectors();
        }
    });

    // Nejbližší BTS
    const nearestBtn = document.getElementById('nearest-btn');
    nearestBtn.addEventListener('click', async () => {
        nearestActive = !nearestActive;
        nearestBtn.classList.toggle('active', nearestActive);
        
        if (nearestActive) {
            ensureGpsActive();
            await showNearestBts();
        } else {
            clearNearestLines();
        }
    });
}
