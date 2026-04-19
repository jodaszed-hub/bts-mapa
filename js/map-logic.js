let btsData = [];

const API_KEY = "QgTpsrlenL20brYpGs0q3EpgJxRp4AuoywAjGVd_6yw";
let map;

// Funkce pro generování polygonu představujícího kružnici (pro MapLibre GeoJSON)
function createCirclePolygon(center, radiusInMeters, points = 64) {
    const coords = { latitude: center[1], longitude: center[0] };
    const km = radiusInMeters / 1000;
    const ret = [];
    const distanceX = km / (111.32 * Math.cos(coords.latitude * Math.PI / 180));
    const distanceY = km / 110.574;

    for (let i = 0; i < points; i++) {
        const theta = (i / points) * (2 * Math.PI);
        const x = distanceX * Math.cos(theta);
        const y = distanceY * Math.sin(theta);
        ret.push([coords.longitude + x, coords.latitude + y]);
    }
    ret.push(ret[0]); // Uzavření polygonu
    return ret;
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

        // Přidání markerů pro každou BTS a generování GeoJSON dat pro kružnice
        const circlesData = {
            300: []
        };
        
        // Pole pro body vysílačů
        const pointsData = [];

        btsData.forEach(bts => {
            // Přidání bodu pro WebGL vrstvu
            pointsData.push({
                type: 'Feature',
                properties: {
                    id: bts.id,
                    name: bts.name
                },
                geometry: {
                    type: 'Point',
                    coordinates: bts.coords
                }
            });

            // Vygenerování kružnic pro tento bod
            circlesData[300].push([createCirclePolygon(bts.coords, 300, 32)]); // méně bodů pro optimalizaci
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
                'circle-radius': 6,
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
                'circle-radius': 4,
                'circle-color': '#dc2626', // červená Tailwind
                'circle-stroke-width': 1,
                'circle-stroke-color': '#991b1b'
            }
        });

        // Kliknutí na bod ve WebGL vrstvě
        map.on('click', 'layer-bts-points', (e) => {
            if (e.features.length > 0) {
                const feature = e.features[0];
                window.openBtsPanel(feature.properties.id, feature.properties.name);
            }
        });

        // Změna kurzoru při najetí na bod
        map.on('mouseenter', 'layer-bts-points', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'layer-bts-points', () => {
            map.getCanvas().style.cursor = '';
        });

        // Přidání zdroje a vrstvy pro 300m (červená)
        map.addSource('circles-300', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: circlesData[300] } }
        });
        map.addLayer({
            id: 'layer-circles-300',
            type: 'fill',
            source: 'circles-300',
            layout: {},
            paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.15 }
        });
    });
}

// Spuštění mapy
window.onload = initMap;

// Přepínač zobrazení kružnic
const toggleCircles = document.getElementById('toggle-circles');
toggleCircles.addEventListener('change', (e) => {
    const visibility = e.target.checked ? 'visible' : 'none';
    if(map.getLayer('layer-circles-300')) map.setLayoutProperty('layer-circles-300', 'visibility', visibility);
});
