// Klíč pro odemknutí technického režimu
const TECH_SECRET_KEY = "1:technik.pozn";

// Globální stav
let currentBtsId = null;
let isTechModeUnlocked = false;

// UI Elementy
const panel = document.getElementById('bts-panel');
const btnClosePanel = document.getElementById('close-panel');
const titleEl = document.getElementById('bts-title');
const idEl = document.getElementById('bts-id');
const publicNoteEl = document.getElementById('public-note');

const techAuthContainer = document.getElementById('tech-auth-container');
const techPasswordInput = document.getElementById('tech-password');
const btnUnlockTech = document.getElementById('btn-unlock-tech');

const techNoteContainer = document.getElementById('tech-note-container');
const techNoteEl = document.getElementById('tech-note');
const btnSave = document.getElementById('btn-save');
const techModeAlert = document.getElementById('tech-mode-alert');

// Funkce pro otevření panelu pro konkrétní BTS
window.openBtsPanel = function(id, name) {
    currentBtsId = id;
    titleEl.textContent = name || "Neznámá BTS";
    idEl.textContent = `ID: ${id}`;
    
    // Načtení dat
    loadBtsData(id);
    
    // Zobrazení panelu
    panel.classList.remove('hidden');
    // Malé zpoždění pro plynulou CSS animaci
    setTimeout(() => {
        panel.classList.add('active');
    }, 10);
};

// Funkce pro zavření panelu
function closePanel() {
    panel.classList.remove('active');
    setTimeout(() => {
        panel.classList.add('hidden');
        currentBtsId = null;
    }, 300); // odpovídá délce animace v CSS
}

btnClosePanel.addEventListener('click', closePanel);

// Načtení dat z localStorage
function loadBtsData(id) {
    const rawData = localStorage.getItem(`bts_${id}`);
    let data = { publicNote: "", techNote: "" };
    
    if (rawData) {
        try {
            data = JSON.parse(rawData);
        } catch (e) {
            console.error("Chyba parsování dat", e);
        }
    }
    
    publicNoteEl.value = data.publicNote || "";
    techNoteEl.value = data.techNote || "";
    
    // Reset zobrazení hesla při každém novém otevření
    techPasswordInput.value = "";
    if (isTechModeUnlocked) {
        showTechNote();
    } else {
        hideTechNote();
    }
}

// Uložení dat
btnSave.addEventListener('click', () => {
    if (!currentBtsId) return;
    
    const data = {
        publicNote: publicNoteEl.value,
        techNote: techNoteEl.value
    };
    
    localStorage.setItem(`bts_${currentBtsId}`, JSON.stringify(data));
    
    // Haptická odezva, pokud ji prohlížeč podporuje (50ms vibrace)
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // Vizuální potvrzení (krátké zbarvení tlačítka)
    const origText = btnSave.textContent;
    const origColor = btnSave.className;
    btnSave.textContent = "Uloženo!";
    btnSave.className = "w-full bg-green-600 text-white py-3 rounded-xl font-bold text-lg transition-colors shadow-md";
    
    setTimeout(() => {
        btnSave.textContent = origText;
        btnSave.className = origColor;
        closePanel();
    }, 1000);
});

// Odemknutí technického režimu
btnUnlockTech.addEventListener('click', () => {
    if (techPasswordInput.value === TECH_SECRET_KEY) {
        isTechModeUnlocked = true;
        showTechNote();
        
        // Zobrazit plovoucí upozornění
        techModeAlert.classList.remove('hidden');
        setTimeout(() => {
            techModeAlert.style.opacity = '1';
        }, 10);
    } else {
        alert("Nesprávný klíč!");
        techPasswordInput.value = "";
    }
});

function showTechNote() {
    techAuthContainer.classList.add('hidden');
    techNoteContainer.classList.remove('hidden');
}

function hideTechNote() {
    techAuthContainer.classList.remove('hidden');
    techNoteContainer.classList.add('hidden');
}
