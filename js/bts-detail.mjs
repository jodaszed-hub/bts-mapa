import { cellIdentity, cellTechnology } from './bts-search.mjs';

const BAND_NAMES = {
    GSM: '2G',
    'LTE 800': 'B20',
    'LTE 900': 'B8',
    'LTE 1800': 'B3',
    'LTE 2100': 'B1',
    'LTE 2600': 'B7',
    'NR 700': 'N28',
    'NR 1800': 'N3',
    'NR 2100': 'N1',
    'NR 3500': 'N78'
};

const TECHNOLOGIES = [
    { key: 'gsm', name: 'GSM (2G)', area: 'LAC', radio: 'BCH / BSIC' },
    { key: 'lte', name: 'LTE (4G)', area: 'TAC', radio: 'PCI' },
    { key: 'nr', name: 'NR (5G)', area: 'TAC', radio: 'PCI' }
];

export function formatBand(band) {
    return Object.hasOwn(BAND_NAMES, band) ? BAND_NAMES[band] : band;
}

function element(tag, text, styles) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (styles) Object.assign(node.style, styles);
    return node;
}

function cellText(value) {
    return value === undefined || value === null || value === '' ? '—' : String(value);
}

function createCellTable(cells, technology) {
    const hasGsmCid = cells.some(cell => cellText(cell.gsmcid) !== '—');
    const table = element('table', undefined, {
        borderCollapse: 'collapse',
        minWidth: '100%',
        textAlign: 'left'
    });
    const caption = element('caption', technology.name, {
        background: '#eff6ff',
        color: '#1e40af',
        fontWeight: '700',
        textAlign: 'left',
        padding: '5px 8px'
    });
    const headings = ['Pásmo', 'Cell ID (DEC / HEX)', technology.area, technology.radio];
    if (hasGsmCid) headings.push('GSMCID');
    headings.push('Datum záznamu');
    const head = element('thead', undefined, { background: '#f3f4f6' });
    const headingRow = document.createElement('tr');
    for (const label of headings) {
        const th = element('th', label, {
            padding: '4px 6px',
            whiteSpace: 'nowrap',
            color: '#374151'
        });
        th.scope = 'col';
        headingRow.append(th);
    }
    head.append(headingRow);

    const body = document.createElement('tbody');
    const sortedCells = [...cells].sort((a, b) => (a.band || '').localeCompare(b.band || '', 'cs', { numeric: true }));
    for (const cell of sortedCells) {
        const row = element('tr', undefined, { borderBottom: '1px solid #e5e7eb' });
        const tdStyle = { padding: '4px 6px', whiteSpace: 'nowrap', verticalAlign: 'top' };
        const band = element('td', cellText(formatBand(cell.band)), { ...tdStyle, color: '#1e40af', fontWeight: '700' });
        if (cell.band) band.title = cell.band;

        const { dec, hex } = cellIdentity(cell);
        const identity = element('td', cellText(dec || cell.ci), { ...tdStyle, fontFamily: 'monospace' });
        if (hex) identity.append(element('small', hex, { display: 'block', color: '#4b5563', fontSize: '0.95em' }));
        if (dec && cell.ci && cell.ci !== dec && cell.ci.includes(':')) {
            identity.append(element('small', cell.ci, { display: 'block', color: '#4b5563', fontSize: '0.95em' }));
        }
        row.append(band, identity, element('td', cellText(cell.tac), tdStyle), element('td', cellText(cell.phys), tdStyle));
        if (hasGsmCid) row.append(element('td', cellText(cell.gsmcid), tdStyle));
        row.append(element('td', cellText(cell.datum), tdStyle));
        body.append(row);
    }
    table.append(caption, head, body);
    return table;
}

function addShareControls(footer, shareUrl) {
    if (!shareUrl) return;
    let url;
    try {
        url = new URL(shareUrl, document.baseURI);
    } catch {
        return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

    const actions = element('div', undefined, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 10px' });
    const copy = element('button', 'Kopírovat odkaz na BTS', {
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px',
        padding: '4px 7px', cursor: 'pointer', font: 'inherit', color: '#1e40af'
    });
    copy.type = 'button';
    const open = element('a', 'Otevřít odkaz', { color: '#1e40af', textDecoration: 'underline' });
    open.href = url.href;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    const status = element('span', '', { color: '#374151' });
    status.setAttribute('role', 'status');
    const fallback = element('input', undefined, { width: '100%', font: 'inherit', padding: '3px 5px' });
    fallback.type = 'url';
    fallback.readOnly = true;
    fallback.hidden = true;
    fallback.value = url.href;
    fallback.setAttribute('aria-label', 'Odkaz na BTS');

    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url.href);
            fallback.hidden = true;
            status.textContent = 'Odkaz zkopírován.';
        } catch {
            fallback.hidden = false;
            fallback.focus();
            fallback.select();
            status.textContent = 'Odkaz zkopírujte z pole.';
        }
    });
    actions.append(copy, open, status);
    footer.append(actions, fallback);
}

export function createBtsDetail(site, { operator, shareUrl } = {}) {
    const detail = element('section', undefined, {
        color: '#1f2937',
        fontSize: '12px',
        lineHeight: '1.35',
        width: 'max-content',
        maxWidth: 'min(440px, calc(100vw - 36px))',
        maxHeight: 'min(350px, 41vh)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto'
    });
    detail.className = 'bts-detail';
    const header = element('header', undefined, {
        background: '#eff6ff',
        borderBottom: '1px solid #dbeafe',
        padding: '7px 30px 6px 8px'
    });
    const title = element('h2', site.name || 'Neznámá BTS', {
        margin: '0', fontSize: '14px', lineHeight: '1.3', color: '#1e3a8a', overflowWrap: 'anywhere'
    });
    const [lng, lat] = site.coords;
    const operatorName = operator === 'tmobile' ? 'T-Mobile' : 'O2';
    const meta = element('p', `${operatorName} · ${lat.toFixed(5)}, ${lng.toFixed(5)}`, { margin: '3px 0 0', color: '#374151' });
    header.append(title, meta);

    const tables = element('div', undefined, {
        minHeight: '48px',
        flex: '1 1 auto',
        overflow: 'auto',
        overscrollBehavior: 'contain',
        touchAction: 'pan-x pan-y'
    });
    tables.tabIndex = 0;
    tables.setAttribute('role', 'region');
    tables.setAttribute('aria-label', 'Přehled buněk BTS');
    for (const technology of TECHNOLOGIES) {
        const cells = site.cells.filter(cell => cellTechnology(cell) === technology.key);
        if (cells.length) tables.append(createCellTable(cells, technology));
    }
    if (!tables.childElementCount) {
        tables.append(element('p', 'Pro tento bod nejsou dostupné údaje o buňkách.', { margin: '8px' }));
    }

    const footer = element('footer', undefined, { flexShrink: '0', padding: '6px 8px', borderTop: '1px solid #dbeafe' });
    const source = element('a', 'Zdroj údajů: GSMweb.cz', { color: '#1e40af', textDecoration: 'underline' });
    source.href = 'https://gsmweb.cz/';
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    footer.append(source);
    addShareControls(footer, shareUrl);
    detail.append(header, tables, footer);
    return detail;
}
