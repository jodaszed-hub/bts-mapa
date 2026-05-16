import re
import os

path = '/home/syd/AIPrace/BTSmapa/js/map-logic.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add currentOperator
content = content.replace('let btsData = [];', 'let btsData = [];\nlet currentOperator = "o2";')

# Define loadBtsData
load_func = """
async function loadBtsData(operator) {
    currentOperator = operator;
    const filename = operator === 'tmobile' ? 'bts-data-tmobile.json' : 'bts-data.json';
    try {
        const response = await fetch(filename + '?v=' + new Date().getTime());
        btsData = await response.json();
        console.log("Načteno " + btsData.length + " vysílačů z " + filename);
        if (typeof setupSearch === 'function') setupSearch();
    } catch(e) {
        console.error("Nepodařilo se načíst data vysílačů.", e);
        return;
    }

    const pointsData = [];
    btsData.forEach(bts => {
        pointsData.push({
            type: 'Feature',
            properties: { id: bts.id, name: bts.name, cells: JSON.stringify(bts.cells) },
            geometry: { type: 'Point', coordinates: bts.coords }
        });
    });

    const geojsonData = { type: 'FeatureCollection', features: pointsData };

    if (map.getSource('bts-points')) {
        map.getSource('bts-points').setData(geojsonData);
        map.setPaintProperty('layer-bts-points', 'circle-color', operator === 'tmobile' ? '#e20074' : '#dc2626');
        map.setPaintProperty('layer-bts-points', 'circle-stroke-color', operator === 'tmobile' ? '#99004d' : '#991b1b');
    } else {
        map.addSource('bts-points', { type: 'geojson', data: geojsonData, tolerance: 0 });
        map.addLayer({
            id: 'layer-bts-points-bg', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-opacity': 0.8 }
        });
        map.addLayer({
            id: 'layer-bts-points', type: 'circle', source: 'bts-points',
            paint: {
                'circle-radius': 5,
                'circle-color': operator === 'tmobile' ? '#e20074' : '#dc2626',
                'circle-stroke-width': 1,
                'circle-stroke-color': operator === 'tmobile' ? '#99004d' : '#991b1b'
            }
        });
        map.addLayer({
            id: 'layer-bts-touch', type: 'circle', source: 'bts-points',
            paint: { 'circle-radius': 18, 'circle-color': 'transparent', 'circle-opacity': 0 }
        });
    }

    if (typeof clearSectors === 'function') clearSectors();
    if (typeof clearNearestLines === 'function') clearNearestLines();
}

function setupOperatorSwitcher() {
    const buttons = document.querySelectorAll('.operator-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const op = btn.dataset.operator;
            buttons.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = '#4b5563';
            });
            btn.classList.add('active');
            btn.style.background = op === 'tmobile' ? '#e20074' : '#3b82f6';
            btn.style.color = 'white';
            loadBtsData(op);
        });
    });
}
"""

content = content.replace('// ====== PŘEPÍNAČ MAPOVÝCH PODKLADŮ ======', load_func + '\n// ====== PŘEPÍNAČ MAPOVÝCH PODKLADŮ ======')

# Replace map.on('load')
old_load = """    map.on('load', async () => {
        try {
            // Cache buster zaručí stažení čerstvého souboru místo staré verze z paměti prohlížeče
            const response = await fetch('bts-data.json?v=' + new Date().getTime());
            btsData = await response.json();
            console.log("Načteno " + btsData.length + " vysílačů z bts-data.json");
            setupSearch();
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
        });"""

new_load = """    map.on('load', async () => {
        await loadBtsData('o2');
        setupOperatorSwitcher();"""

content = content.replace(old_load, new_load)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("map-logic.js patched")
