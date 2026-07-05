// Logika technických nástrojů (Azimut, Výškový profil, Poznámky, Reporty)

let currentBts = null;
let isTechModeUnlocked = false;
const TECH_PASSWORD_KEY = "1:technik.pozn";

// Inicializace technické logiky
function initTechLogic() {
    setupPanelTabs();
    setupAuthNote();
    setupCompassDevice();
    setupNotesActions();
    setupReportForm();

    // Drag handle zavírání panelu tažením dolů (jednoduché swipe-down)
    const dragHandle = document.querySelector('.panel-drag-handle');
    const panel = document.getElementById('bts-panel');
    let startY = 0;
    
    dragHandle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
    });

    dragHandle.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        if (diff > 80) {
            closePanel();
        }
    });

    document.getElementById('close-panel').addEventListener('click', closePanel);
}

// Přepínání záložek v BottomSheetu
function setupPanelTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTabId = btn.dataset.tab;
            
            tabButtons.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(targetTabId).classList.add('active');

            // Pokud přepneme na záložku směrování, překreslíme canvas terénu (pro jistotu responzivity)
            if (targetTabId === 'tab-alignment' && currentBts) {
                calculateTerrainProfile(currentBts);
            }
        });
    });
}

// Otevření panelu pro konkrétní BTS
window.openBtsPanel = function(bts) {
    currentBts = bts;
    window.currentBts = bts; // globální propojení
    
    // Nastavení hlavičky panelu
    document.getElementById('bts-title').textContent = bts.name || "Neznámý vysílač";
    document.getElementById('bts-id').textContent = `ID: ${bts.id}`;
    document.getElementById('bts-coords').textContent = `GPS: ${bts.coords[1].toFixed(5)}, ${bts.coords[0].toFixed(5)}`;

    // Aktualizace 5G karty v přehledu
    const bts5gCard = document.getElementById('bts-5g-card');
    if (bts5gCard) {
        const hasN78 = bts.cells.some(c => c.band === 'NR 3500');
        const hasExplicit5G = bts.cells.some(c => c.band.startsWith('NR '));
        const hasLte2100 = bts.cells.some(c => c.band === 'LTE 2100');
        const hasLte1800 = bts.cells.some(c => c.band === 'LTE 1800');
        const hasDss5G = hasLte2100 || hasLte1800;

        bts5gCard.className = 'bts-5g-card'; // Reset classes
        const iconEl = document.getElementById('bts-5g-icon');
        const textEl = document.getElementById('bts-5g-info-text');

        if (hasN78) {
            bts5gCard.classList.add('n78');
            if (iconEl) iconEl.textContent = '🚀';
            if (textEl) textEl.textContent = 'Vysokorychlostní 5G (n78) k dispozici.';
        } else if (hasExplicit5G) {
            bts5gCard.classList.add('explicit');
            if (iconEl) iconEl.textContent = '📡';
            if (textEl) textEl.textContent = '5G pokrytí zapsané v databázi.';
        } else if (hasDss5G) {
            bts5gCard.classList.add('dss');
            if (iconEl) iconEl.textContent = '⚡';
            if (textEl) textEl.textContent = '5G k dispozici přes DSS (sdílení LTE 1800/2100 pásma).';
        } else {
            bts5gCard.classList.add('hidden');
        }
    }

    // Naplnění tabulky buněk (Overview)
    fillCellsTable(bts.cells);

    // Výpočet azimutu, vzdálenosti a elevace (pokud máme GPS)
    window.updateAlignmentInfo(bts);

    // Zobrazení panelu s animací
    const panel = document.getElementById('bts-panel');
    panel.classList.remove('hidden');

    // Načtení poznámek k dané BTS
    loadBtsNotes(bts.id);

    // Reset na první záložku (Přehled)
    const firstTabBtn = document.querySelector('.tab-btn[data-tab="tab-overview"]');
    if (firstTabBtn) firstTabBtn.click();
};

function closePanel() {
    const panel = document.getElementById('bts-panel');
    panel.classList.add('hidden');
    currentBts = null;
    window.currentBts = null;
    
    // Vyčistit kreslení profilu
    const canvas = document.getElementById('terrain-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Naplnění tabulky buněk
function fillCellsTable(cells) {
    const tbody = document.getElementById('cells-table-body');
    tbody.innerHTML = '';

    // Seřadit buňky podle pásma (5G n78 nahoře)
    const sortedCells = [...cells].sort((a, b) => {
        if (a.band === 'NR 3500') return -1;
        if (b.band === 'NR 3500') return 1;
        return a.band.localeCompare(b.band);
    });

    sortedCells.forEach(cell => {
        const isSelected = activeBands.has(cell.band);
        const tr = document.createElement('tr');
        if (!isSelected) tr.style.opacity = '0.4'; // Šedě nepoužitá pásma

        const displayCi = cell.full_cid || cell.ci;
        let hexStr = '';
        if (displayCi && !displayCi.includes(':')) {
            const decVal = parseInt(displayCi);
            if (!isNaN(decVal)) {
                hexStr = `<span class="hex-label">(${decVal.toString(16).toUpperCase()})</span>`;
            }
        }

        // Zobrazení badge pro sdílenou CETIN 5G buňku
        const sharedBadge = cell.shared ? '<span class="badge shared-5g">CETIN sdílená</span>' : '';

        tr.innerHTML = `
            <td class="band">${cell.band}${sharedBadge}</td>
            <td class="cid">${displayCi} ${hexStr}</td>
            <td>${cell.tac || '-'}</td>
            <td>${cell.phys || '-'}</td>
            <td style="font-weight:600; color:#1e3a8a;">${cell.gsmcid || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ====== SMĚROVÁNÍ (VZDÁLENOST, AZIMUT, ELEVACE) ======
window.updateAlignmentInfo = function(bts) {
    const alignDistEl = document.getElementById('align-distance');
    const alignAzimuthEl = document.getElementById('align-azimuth');
    const alignElevationEl = document.getElementById('align-elevation');

    // Pokud nemáme souřadnice uživatele, nemůžeme počítat směrování
    if (!userCoordinates) {
        alignDistEl.textContent = "Zapněte GPS 📍";
        alignAzimuthEl.textContent = "--";
        alignElevationEl.textContent = "--";
        return;
    }

    const [userLng, userLat] = userCoordinates;
    const [btsLng, btsLat] = bts.coords;

    // 1. Plochá vzdálenost (Haversine v metrech)
    const distM = haversineDistance(userLng, userLat, btsLng, btsLat);
    alignDistEl.textContent = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(2)} km`;

    // 2. Azimut (Bearing)
    const azimuthDeg = calculateBearing(userLat, userLng, btsLat, btsLng);
    alignAzimuthEl.textContent = `${Math.round(azimuthDeg)}°`;

    // 3. Elevace (vyžaduje nadmořské výšky - stáhneme asynchronně přes API)
    fetchElevations(userLat, userLng, btsLat, btsLng).then(elevations => {
        if (elevations) {
            const [userElev, btsElev] = elevations;
            const deltaH = btsElev - userElev;
            // Výpočet úhlu sklonu: arctan(výškový_rozdíl / vzdálenost)
            const elevAngleRad = Math.atan2(deltaH, distM);
            const elevAngleDeg = elevAngleRad * 180 / Math.PI;
            
            const sign = elevAngleDeg >= 0 ? "+" : "";
            const direction = elevAngleDeg >= 0 ? "nahoru ↗" : "dolů ↘";
            alignElevationEl.textContent = `${sign}${elevAngleDeg.toFixed(1)}° (${direction})`;
        } else {
            alignElevationEl.textContent = "Chyba API";
        }
    });
}

// Výpočet azimutu (Bearing) mezi dvěma GPS body
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// Asynchronní načtení nadmořských výšek z Open-Meteo
async function fetchElevations(lat1, lon1, lat2, lon2) {
    try {
        const response = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat1},${lat2}&longitude=${lon1},${lon2}`);
        const data = await response.json();
        if (data && data.elevation) {
            return data.elevation; // Vrací [výška1, výška2]
        }
    } catch (e) {
        console.error("Selhalo stahování nadmořských výšek:", e);
    }
    return null;
}

// ====== VÝŠKOVÝ PROFIL TERÉNU (Line-of-Sight) ======
let terrainCache = new Map(); // Rychlá mezipaměť výškových profilů

async function calculateTerrainProfile(bts) {
    const canvas = document.getElementById('terrain-canvas');
    const ctx = canvas.getContext('2d');
    const loadingEl = document.getElementById('terrain-loading');
    const errorEl = document.getElementById('terrain-error');
    const losBadge = document.getElementById('los-status');

    // Vyčistit
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!userCoordinates) {
        losBadge.textContent = "Pro výpočet terénního profilu je vyžadována GPS pozice technika.";
        losBadge.className = "los-status-badge blocked";
        return;
    }

    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    losBadge.textContent = "Vyhodnocování přímé viditelnosti...";
    losBadge.className = "los-status-badge";

    const [userLng, userLat] = userCoordinates;
    const [btsLng, btsLat] = bts.coords;

    // Vygenerujeme 16 bodů na trase mezi technikem a BTS (pro plynulý terénní řez)
    const numPoints = 16;
    const lats = [];
    const lngs = [];
    
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        lats.push(userLat + (btsLat - userLat) * t);
        lngs.push(userLng + (btsLng - userLng) * t);
    }

    const cacheKey = `${bts.id}-${userLat.toFixed(4)}-${userLng.toFixed(4)}`;
    let elevations = terrainCache.get(cacheKey);

    if (!elevations) {
        try {
            const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lngs.join(',')}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.elevation) {
                elevations = data.elevation;
                terrainCache.set(cacheKey, elevations);
            }
        } catch (e) {
            console.error("Chyba při stahování výškového profilu:", e);
            loadingEl.classList.add('hidden');
            errorEl.classList.remove('hidden');
            losBadge.textContent = "Nelze vyhodnotit přímou viditelnost (chyba připojení).";
            losBadge.className = "los-status-badge blocked";
            return;
        }
    }

    loadingEl.classList.add('hidden');
    if (!elevations || elevations.length === 0) {
        errorEl.classList.remove('hidden');
        return;
    }

    // Vykreslení grafu na canvas
    drawTerrainCanvas(canvas, ctx, elevations, bts);
}

function drawTerrainCanvas(canvas, ctx, heights, bts) {
    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 25, right: 35, bottom: 25, left: 35 };

    const minHeight = Math.min(...heights) - 15;
    const maxHeight = Math.max(...heights) + 25;
    const heightRange = maxHeight - minHeight;

    const numPoints = heights.length;
    const stepX = (width - padding.left - padding.right) / (numPoints - 1);

    // Helper pro převod GPS indexu a výšky na Canvas souřadnice
    function getCanvasCoords(index, val) {
        const x = padding.left + index * stepX;
        const y = height - padding.bottom - ((val - minHeight) / heightRange) * (height - padding.top - padding.bottom);
        return { x, y };
    }

    // 1. Zjistit, zda terén blokuje přímou viditelnost (LoS)
    const userH = heights[0];
    const btsH = heights[numPoints - 1];
    
    let isBlocked = false;
    let maxBlockIndex = -1;
    let maxBlockDiff = 0;

    for (let i = 1; i < numPoints - 1; i++) {
        // Lineární výška přímého paprsku (LoS) v bodě i
        const t = i / (numPoints - 1);
        const losHeightAtI = userH + (btsH - userH) * t;
        const terrainHeightAtI = heights[i];

        if (terrainHeightAtI > losHeightAtI) {
            isBlocked = true;
            const diff = terrainHeightAtI - losHeightAtI;
            if (diff > maxBlockDiff) {
                maxBlockDiff = diff;
                maxBlockIndex = i;
            }
        }
    }

    // Nastavit status badge
    const losBadge = document.getElementById('los-status');
    if (isBlocked) {
        losBadge.textContent = `⚠️ Přímá viditelnost (LoS) je zablokována terénní překážkou! (cca v ${Math.round((maxBlockIndex/(numPoints-1))*100)}% trasy)`;
        losBadge.className = "los-status-badge blocked";
    } else {
        losBadge.textContent = "✅ Přímá viditelnost (Line-of-Sight) na vysílač je zajištěna.";
        losBadge.className = "los-status-badge ok";
    }

    // 2. Kreslení pozadí gridu
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 1;
    for (let hVal = minHeight; hVal < maxHeight; hVal += 10) {
        const p1 = getCanvasCoords(0, hVal);
        const p2 = getCanvasCoords(numPoints - 1, hVal);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }

    // 3. Vykreslení vyplněného terénu (hnědý masiv)
    ctx.beginPath();
    const startPoint = getCanvasCoords(0, heights[0]);
    ctx.moveTo(startPoint.x, startPoint.y);

    for (let i = 1; i < numPoints; i++) {
        const pt = getCanvasCoords(i, heights[i]);
        ctx.lineTo(pt.x, pt.y);
    }
    
    // Uzavření polygonu na spodní hranici canvasu
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.closePath();

    // Hnědý zemitý gradient terénu
    const terrainGrad = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    terrainGrad.addColorStop(0, "#78350f");
    terrainGrad.addColorStop(1, "#451a03");
    ctx.fillStyle = terrainGrad;
    ctx.fill();

    // Vykreslení obrysu terénu (tmavší linka)
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    for (let i = 1; i < numPoints; i++) {
        const pt = getCanvasCoords(i, heights[i]);
        ctx.lineTo(pt.x, pt.y);
    }
    ctx.strokeStyle = "#451a03";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Vykreslení přímé spojnice (Line of Sight paprsek)
    const ptUser = getCanvasCoords(0, userH);
    const ptBts = getCanvasCoords(numPoints - 1, btsH);
    
    ctx.beginPath();
    ctx.moveTo(ptUser.x, ptUser.y);
    ctx.lineTo(ptBts.x, ptBts.y);
    ctx.strokeStyle = isBlocked ? "#ef4444" : "#10b981"; // Červená pro blok, zelená pro čistý směr
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]); // Čárkovaná čára
    ctx.stroke();
    ctx.setLineDash([]); // Reset čárkování

    // 5. Vyznačení bodů (Zákazník a Vysílač)
    // Bod uživatele
    ctx.beginPath();
    ctx.arc(ptUser.x, ptUser.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bod vysílače
    ctx.beginPath();
    ctx.arc(ptBts.x, ptBts.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.stroke();

    // 6. Textové popisky výšek na okrajích
    ctx.fillStyle = "#4b5563";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(userH)}m`, ptUser.x, ptUser.y - 10);
    ctx.fillText(`${Math.round(btsH)}m`, ptBts.x, ptBts.y - 10);
}

// ====== MINI KOMPAS A ROTACE MAPY DLE SMĚRU TELEFONU ======
let compassActive = false;
let rafId = null;
let currentHeading = null;
let headingHistory = [];
const HISTORY_SIZE = 40;

function setupCompassDevice() {
    const btn = document.getElementById('compass-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (compassActive) {
            stopCompass();
        } else {
            ensureGpsActive();
            // iOS oprávnění
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceOrientationEvent.requestPermission();
                    if (permissionState !== 'granted') {
                        alert('Prosím, povolte přístup ke kompasu v nastavení mobilního prohlížeče.');
                        return;
                    }
                } catch (e) {
                    alert('Přístup ke kompasu selhal.');
                    return;
                }
            }
            startCompass();
        }
    });
}

function startCompass() {
    compassActive = true;
    headingHistory = [];
    currentHeading = null;

    document.getElementById('compass-btn').classList.add('active');
    
    // Registrace senzorů
    window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true);
    window.addEventListener('deviceorientation', onDeviceOrientation, true);

    rafId = requestAnimationFrame(compassRenderLoop);
}

function stopCompass() {
    compassActive = false;
    currentHeading = null;
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    
    window.removeEventListener('deviceorientationabsolute', onDeviceOrientation, true);
    window.removeEventListener('deviceorientation', onDeviceOrientation, true);

    document.getElementById('compass-btn').classList.remove('active');
    document.getElementById('compass-ring').style.transform = '';
    document.getElementById('compass-degree').textContent = '---';

    // Ease mapy zpět na sever
    if (map) {
        map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    }
}

function onDeviceOrientation(event) {
    if (!compassActive) return;

    let heading = null;
    if (event.webkitCompassHeading != null) {
        heading = event.webkitCompassHeading;
    } else if (event.alpha != null) {
        heading = 360 - event.alpha;
    }

    if (heading == null) return;

    // Kruhové vyhlazení (klouzavý průměr)
    headingHistory.push(heading);
    if (headingHistory.length > HISTORY_SIZE) {
        headingHistory.shift();
    }

    const sinSum = headingHistory.reduce((s, h) => s + Math.sin(h * Math.PI / 180), 0);
    const cosSum = headingHistory.reduce((s, h) => s + Math.cos(h * Math.PI / 180), 0);
    
    let avg = Math.atan2(sinSum / headingHistory.length, cosSum / headingHistory.length) * 180 / Math.PI;
    if (avg < 0) avg += 360;

    currentHeading = avg;
}

function compassRenderLoop() {
    if (!compassActive || !map) {
        rafId = null;
        return;
    }

    if (currentHeading !== null) {
        // Rotovat mapu podle azimutu kompasu
        if (!map.isZooming() && !map.isMoving()) {
            map.setBearing(currentHeading);
        }

        // Rotovat widget kompasu (opačně, aby N ukazovalo k reálnému severu)
        document.getElementById('compass-ring').style.transform = `rotate(${-currentHeading}deg)`;
        document.getElementById('compass-degree').textContent = `${Math.round(currentHeading)}°`;
    }

    rafId = requestAnimationFrame(compassRenderLoop);
}

// ====== TECHNICKÉ POZNÁMKY (HESLO A LOKÁLNÍ DATABÁZE) ======
function setupAuthNote() {
    const btnUnlock = document.getElementById('btn-unlock-tech');
    const pwdInput = document.getElementById('tech-password');
    const authBox = document.getElementById('tech-auth-container');
    const noteBox = document.getElementById('tech-note-container');
    const alertBanner = document.getElementById('tech-mode-alert');

    // Kontrola, zda již není odemčeno v této relaci
    if (isTechModeUnlocked) {
        authBox.classList.add('hidden');
        noteBox.classList.remove('hidden');
        alertBanner.classList.remove('hidden');
    }

    btnUnlock.addEventListener('click', () => {
        if (pwdInput.value === TECH_PASSWORD_KEY) {
            isTechModeUnlocked = true;
            authBox.classList.add('hidden');
            noteBox.classList.remove('hidden');
            alertBanner.classList.remove('hidden');
            
            // Haptická odezva
            if (navigator.vibrate) navigator.vibrate(60);

            if (currentBts) {
                loadBtsNotes(currentBts.id);
            }
        } else {
            alert("Nesprávný technický klíč!");
            pwdInput.value = "";
        }
    });

    pwdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            btnUnlock.click();
        }
    });
}

function loadBtsNotes(btsId) {
    const techText = document.getElementById('tech-note');
    const publicText = document.getElementById('public-note');
    
    // Obnovit texty
    techText.value = "";
    publicText.value = "";

    const rawData = localStorage.getItem(`bts_notes_${btsId}`);
    if (rawData) {
        try {
            const data = JSON.parse(rawData);
            techText.value = data.techNote || "";
            publicText.value = data.publicNote || "";
        } catch (e) {
            console.error("Chyba při čtení lokálních poznámek:", e);
        }
    }
}

function setupNotesActions() {
    const btnSave = document.getElementById('btn-save-notes');
    const btnExport = document.getElementById('btn-export-notes');
    const btnImport = document.getElementById('btn-import-notes');
    const fileInput = document.getElementById('notes-file-input');

    // Uložit poznámky
    btnSave.addEventListener('click', () => {
        if (!currentBts) return;

        const data = {
            techNote: document.getElementById('tech-note').value,
            publicNote: document.getElementById('public-note').value
        };

        localStorage.setItem(`bts_notes_${currentBts.id}`, JSON.stringify(data));
        
        if (navigator.vibrate) navigator.vibrate(40);

        // Vizuální potvrzení uložení
        const originalText = btnSave.textContent;
        btnSave.textContent = "Poznámky uloženy! ✓";
        btnSave.style.background = "#10b981";
        
        setTimeout(() => {
            btnSave.textContent = originalText;
            btnSave.style.background = "";
        }, 1200);
    });

    // Export všech poznámek do JSON souboru
    btnExport.addEventListener('click', () => {
        const allNotes = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('bts_notes_')) {
                allNotes[key] = localStorage.getItem(key);
            }
        }

        const dataStr = JSON.stringify(allNotes, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = 'bts_mapa_poznamky.json';
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    });

    // Import poznámek
    btnImport.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                let count = 0;
                
                Object.keys(importedData).forEach(key => {
                    if (key.startsWith('bts_notes_')) {
                        localStorage.setItem(key, importedData[key]);
                        count++;
                    }
                });

                alert(`Úspěšně naimportováno ${count} poznámek k vysílačům.`);
                
                if (currentBts) {
                    loadBtsNotes(currentBts.id);
                }
            } catch (err) {
                alert("Import selhal - neplatný formát souboru.");
            }
        };
        reader.readAsText(file);
    });
}

// ====== GENEROVÁNÍ A TISK INSTALAČNÍHO REPORTU ======
function setupReportForm() {
    const form = document.getElementById('report-form');
    
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        if (!currentBts) {
            alert("Prosím vyberte vysílač na mapě.");
            return;
        }

        // Vyplnit data do tiskové šablony
        document.getElementById('print-date').textContent = `Datum: ${new Date().toLocaleDateString('cs-CZ')} v ${new Date().toLocaleTimeString('cs-CZ', {hour: '2-digit', minute:'2-digit'})}`;
        
        // Zákazník
        document.getElementById('print-cust-name').textContent = document.getElementById('rep-cust-name').value;
        document.getElementById('print-cust-addr').textContent = document.getElementById('rep-cust-addr').value;
        document.getElementById('print-cust-sn').textContent = document.getElementById('rep-sn').value;

        // Vysílač
        document.getElementById('print-bts-name').textContent = currentBts.name;
        document.getElementById('print-bts-id').textContent = currentBts.id;
        document.getElementById('print-operator').textContent = currentOperator === 'tmobile' ? 'T-Mobile CZ' : 'O2 CZ';
        
        if (userCoordinates) {
            const [userLng, userLat] = userCoordinates;
            const distM = haversineDistance(userLng, userLat, currentBts.coords[0], currentBts.coords[1]);
            const distStr = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(2)} km`;
            document.getElementById('print-distance').textContent = distStr;
            
            const azimuthDeg = calculateBearing(userLat, userLng, currentBts.coords[1], currentBts.coords[0]);
            document.getElementById('print-azimuth').textContent = `${Math.round(azimuthDeg)}°`;
        } else {
            document.getElementById('print-distance').textContent = "Neuvedeno";
            document.getElementById('print-azimuth').textContent = "Neuvedeno";
        }

        // Signál
        document.getElementById('print-rsrp').textContent = `${document.getElementById('rep-rsrp').value} dBm`;
        document.getElementById('print-rsrq').textContent = `${document.getElementById('rep-rsrq').value} dB`;
        document.getElementById('print-sinr').textContent = `${document.getElementById('rep-sinr').value} dB`;

        // Test
        document.getElementById('print-dl').textContent = `${document.getElementById('rep-dl').value} Mbps`;
        document.getElementById('print-ul').textContent = `${document.getElementById('rep-ul').value} Mbps`;
        document.getElementById('print-ping').textContent = `${document.getElementById('rep-ping').value} ms`;

        // Spustit tisk prohlížeče (umožní uložit jako PDF)
        window.print();
    });
}
