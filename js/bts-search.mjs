export function cellTechnology(cell) {
    const band = String(cell.band ?? '').trim().toUpperCase();
    if (band === 'GSM' || band.startsWith('GSM ') || band === '2G') return 'gsm';
    if (band.startsWith('NR') || band === '5G') return 'nr';
    return 'lte';
}

export function cellIdentity(cell) {
    const technology = cellTechnology(cell);
    const raw = String(cell.ci ?? '').trim();
    const full = String(cell.full_cid ?? '').trim();
    const value = /^\d+$/.test(full) ? full : raw;
    const repeater = technology === 'gsm' && /^\d+r$/i.test(raw);
    let number;
    if (/^\d+$/.test(value)) {
        number = BigInt(value);
    } else if (repeater) {
        number = BigInt(raw.slice(0, -1));
    } else if (technology !== 'gsm' && /^\d+:\d+$/.test(value)) {
        const [base, sector] = value.split(':').map(BigInt);
        number = base * (technology === 'nr' ? 16384n : 256n) + sector;
    } else {
        return { dec: raw, hex: '' };
    }
    return { dec: number.toString() + (repeater ? 'r' : ''), hex: number.toString(16).toUpperCase() };
}

const degrees = '[+-]?\\d{1,3}';
const fraction = '\\d{1,2}(?:[.,]\\d+)?';
const hemisphere = '[NSEWVZJ]';
const coordinatePair = (angle) => {
    const component = `(?:(${hemisphere})\\s*)?${angle}(?:\\s*(${hemisphere}))?`;
    return new RegExp(`^${component}(?:\\s*[,;]\\s*|\\s+)${component}$`, 'i');
};

const coordinateFormats = [
    { pattern: coordinatePair(`(${degrees}(?:[.,]\\d+)?)\\s*°?`), groupSize: 3 },
    { pattern: coordinatePair(`(${degrees})\\s*°\\s*(\\d{1,2})\\s*'\\s*(${fraction})\\s*"?`), groupSize: 5 },
    { pattern: coordinatePair(`(${degrees})\\s*°\\s*(${fraction})\\s*'?`), groupSize: 4 },
    { pattern: coordinatePair(`(${degrees})\\s+(\\d{1,2})\\s+(${fraction})`), groupSize: 5 },
    { pattern: coordinatePair(`(${degrees})\\s+(${fraction})`), groupSize: 4 },
];

function readAngle(parts, czech) {
    const [before, degreeText, ...rest] = parts;
    const after = rest.pop();
    if (before && after) return null;
    const direction = (before || after || '').toUpperCase();
    const axis = !direction ? null : /[NSJ]/.test(direction) ? 'lat' : 'lng';
    const negativeDirection = /[WZJ]/.test(direction) || (direction === 'S' && !czech);
    const asNumber = (text) => Number(text.replace(',', '.'));
    const degree = asNumber(degreeText);
    const minutes = rest.length ? asNumber(rest[0]) : 0;
    const seconds = rest.length > 1 ? asNumber(rest[1]) : 0;
    if (minutes >= 60 || seconds >= 60 || (direction && !negativeDirection && degreeText.startsWith('-'))) return null;
    const magnitude = Math.abs(degree) + minutes / 60 + seconds / 3600;
    return { axis, value: negativeDirection || degreeText.startsWith('-') ? -magnitude : magnitude };
}

export function parseCoordinates(query) {
    const value = String(query ?? '').trim()
        .replace(/^\((.*)\)$/s, '$1').trim()
        .replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/−/g, '-').replace(/º/g, '°')
        .replace(/\b([sj])\.?\s*š\.?/giu, (_, letter) => letter.toLowerCase() === 's' ? 'N' : 'J')
        .replace(/\b([vz])\.?\s*d\.?/giu, (_, letter) => letter.toUpperCase());

    for (const { pattern, groupSize } of coordinateFormats) {
        const match = value.match(pattern);
        if (!match) continue;
        const first = match.slice(1, groupSize + 1);
        const second = match.slice(groupSize + 1);
        // A direction between two angles belongs to the second one if the first
        // already has a prefix, as in "N 50 5 16.8 E 14 25 15.6".
        if (first[0] && first.at(-1) && !second[0] && !second.at(-1)) {
            second[0] = first.at(-1);
            first[first.length - 1] = undefined;
        }
        const directions = [first[0], first.at(-1), second[0], second.at(-1)].join('');
        const czech = /[VZJ]/i.test(directions);
        const a = readAngle(first, czech);
        const b = readAngle(second, czech);
        if (!a || !b || (a.axis && a.axis === b.axis)) continue;

        // Accept longitude-first when the compass directions or Czech bounds make that order clear.
        const czechLatitude = (number) => number >= 48 && number <= 52;
        const czechLongitude = (number) => number >= 11 && number <= 22;
        const reversed = a.axis === 'lng' || b.axis === 'lat' || (!a.axis && !b.axis && (
            (czechLongitude(a.value) && czechLatitude(b.value)) || Math.abs(a.value) > 90
        ));
        const lat = reversed ? b.value : a.value;
        const lng = reversed ? a.value : b.value;
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
    return null;
}

function normalize(text) {
    return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function indexSite(site) {
    const cells = site.cells.map(cell => {
        const identity = cellIdentity(cell);
        return { identity, raw: String(cell.ci ?? '').trim().toLowerCase(), hex: identity.hex.toLowerCase() };
    });
    return { site, name: normalize(site.name), cells };
}

function searchSites(index, query) {
    const normalized = normalize(query).replace(/\s*:\s*/g, ':');
    const hexOnly = normalized.startsWith('0x');
    const token = hexOnly ? normalized.slice(2) : normalized;
    if (!token || (hexOnly && !/^[0-9a-f]+$/.test(token))) return [];
    const exactNumber = token.replace(/^0+(?=[0-9a-f])/i, '');
    const allowPartial = token.length >= 2;
    const found = [];

    for (const { site, name, cells } of index) {
        let rank = Infinity;
        let identity = cells[0]?.identity;
        if (!hexOnly) {
            if (name === token) rank = 2;
            else if (allowPartial && name.startsWith(token)) rank = 4;
            else if (allowPartial && name.includes(token)) rank = 6;
        }
        for (const cell of cells) {
            const { dec } = cell.identity;
            const { raw, hex } = cell;
            let cellRank = Infinity;
            if (!hexOnly && (raw === token || dec === exactNumber)) cellRank = 0;
            else if (hex && hex === exactNumber) cellRank = 1;
            else if (allowPartial && (hex.startsWith(token) || (!hexOnly && (dec.startsWith(token) || raw.startsWith(token))))) cellRank = 3;
            else if (allowPartial && (hex.includes(token) || (!hexOnly && (dec.includes(token) || raw.includes(token))))) cellRank = 5;
            if (cellRank < rank) {
                rank = cellRank;
                identity = cell.identity;
            }
            if (rank === 0) break;
        }
        if (rank < Infinity) found.push({ site, identity, rank });
    }

    return found.sort((a, b) => a.rank - b.rank).slice(0, 10);
}

export function createBtsSearch({ input, results, clearButton, onSelectBts, onSelectCoordinates, onStats }) {
    const document = input.ownerDocument;
    const status = document.getElementById('search-status');
    let index = [];
    let options = [];
    let active = -1;

    function setActive(next) {
        if (active >= 0) options[active]?.element.setAttribute('aria-selected', 'false');
        active = next;
        if (active < 0) {
            input.removeAttribute('aria-activedescendant');
            return;
        }
        const { element } = options[active];
        element.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', element.id);
        element.scrollIntoView({ block: 'nearest' });
    }

    function setStatus(message) {
        if (!status) return;
        status.hidden = !message;
        status.textContent = message;
    }

    function hide() {
        setActive(-1);
        results.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        setStatus('');
    }

    function clear() {
        input.value = '';
        clearButton.hidden = true;
        hide();
        results.replaceChildren();
        options = [];
    }

    function addOption(name, details, selection) {
        const element = document.createElement('div');
        const position = options.length;
        element.id = `${results.id}-option-${position}`;
        element.className = selection.coords ? 'search-item coordinate-item' : 'search-item';
        element.setAttribute('role', 'option');
        element.setAttribute('aria-selected', 'false');
        element.dataset.option = position;
        if (selection.coords) {
            element.dataset.lat = selection.coords.lat;
            element.dataset.lng = selection.coords.lng;
        } else {
            element.dataset.id = selection.site.id;
        }
        const title = document.createElement('span');
        title.className = 'name';
        title.textContent = name;
        const description = document.createElement('span');
        description.className = 'details';
        description.textContent = details;
        element.append(title, description);
        results.append(element);
        options.push({ element, ...selection });
    }

    function update() {
        hide();
        results.replaceChildren();
        options = [];
        const query = input.value.trim();
        clearButton.hidden = !input.value;
        if (!query) return;

        const coords = parseCoordinates(query);
        if (coords) addOption('Přejít na souřadnice', `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, { coords });
        for (const { site, identity } of searchSites(index, query)) {
            if (options.length >= 10) break;
            const details = identity?.dec ? `ID: ${identity.dec}${identity.hex ? ` | HEX: ${identity.hex}` : ''}` : '';
            addOption(site.name, details, { site });
        }

        if (!options.length) {
            if (query.length >= 2) setStatus('Nic nenalezeno');
            return;
        }
        results.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function select(position) {
        const option = options[position];
        if (!option) return;
        hide();
        if (option.coords) {
            const { lat, lng } = option.coords;
            input.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            onSelectCoordinates(lng, lat);
        } else {
            input.value = option.site.name;
            onSelectBts(option.site);
        }
    }

    input.addEventListener('input', () => {
        if (onStats && normalize(input.value) === 'adminstats') {
            clear();
            onStats();
        } else update();
    });
    input.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape') {
            hide();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (results.hidden) update();
            if (!options.length) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const next = active < 0 && step < 0 ? options.length - 1 : (active + step + options.length) % options.length;
            setActive(next);
        } else if (event.key === 'Enter' && !results.hidden && options.length) {
            event.preventDefault();
            select(active < 0 ? 0 : active);
        }
    });
    results.addEventListener('click', event => {
        const option = event.target.closest('[role="option"]');
        if (option && results.contains(option)) select(Number(option.dataset.option));
    });
    results.addEventListener('mousedown', event => {
        if (event.target.closest('[role="option"]')) event.preventDefault();
    });
    clearButton.addEventListener('click', () => {
        clear();
        input.focus();
    });
    const isInside = target => input === target || clearButton.contains(target) || results.contains(target);
    document.addEventListener('pointerdown', event => { if (!isInside(event.target)) hide(); });
    document.addEventListener('focusin', event => { if (!isInside(event.target)) hide(); });

    hide();
    clearButton.hidden = !input.value;
    return {
        setSites(sites) {
            index = sites.map(indexSite);
            if (document.activeElement === input) update();
            else hide();
        },
        clear,
    };
}
