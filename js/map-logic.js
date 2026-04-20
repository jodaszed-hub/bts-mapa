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
        });

        // Změna kurzoru při najetí na bod
        map.on('mouseenter', 'layer-bts-points', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'layer-bts-points', () => {
            map.getCanvas().style.cursor = '';
        });

    });
}

// Spuštění mapy
window.onload = initMap;
