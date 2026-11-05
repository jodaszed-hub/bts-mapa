import assert from 'node:assert/strict';
import test from 'node:test';
import { cellIdentity, createBtsSearch, parseCoordinates } from '../js/bts-search.mjs';

test('converts legacy LTE and NR IDs using the correct radio format', () => {
    assert.deepEqual(cellIdentity({ ci: '603791:100', band: 'LTE 1800' }), { dec: '154570596', hex: '9368F64' });
    assert.deepEqual(cellIdentity({ ci: '606531:400', band: 'NR 1800' }), { dec: '9937404304', hex: '25050C190' });
    assert.deepEqual(cellIdentity({ ci: '606531:400', band: 'NR 1800', full_cid: '123' }), { dec: '123', hex: '7B' });
    assert.deepEqual(cellIdentity({ ci: '15328r', band: 'GSM' }), { dec: '15328r', hex: '3BE0' });
});

test('parses decimal coordinates without mistaking the separator for a decimal comma', () => {
    assert.deepEqual(parseCoordinates('49.1951,16.6068'), { lat: 49.1951, lng: 16.6068 });
    for (const query of ['50,088;14,421', '50,088 14,421', '50,088,14,421', '(14.421, 50.088)']) {
        assert.deepEqual(parseCoordinates(query), { lat: 50.088, lng: 14.421 }, query);
    }
});

test('accepts Czech DDM and English DMS with leading or trailing hemisphere', () => {
    for (const query of [
        '50° 5,28′ s. š. 14° 25,26′ v. d.',
        '50° 5′ 16.8″ S, 14° 25′ 15.6″ V',
        'N 50 5 16.8 E 14 25 15.6',
        '14° 25′ 15.6″ E; 50° 5′ 16.8″ N',
    ]) assert.deepEqual(parseCoordinates(query), { lat: 50.088, lng: 14.421 }, query);
    assert.deepEqual(parseCoordinates('50° 30′ S, 14° 30′ W'), { lat: -50.5, lng: -14.5 });
    assert.deepEqual(parseCoordinates('−50° 30′; −14° 30′'), { lat: -50.5, lng: -14.5 });
});

test('address, station notation and invalid coordinates do not offer a GPS point', () => {
    for (const query of ['Praha 1, dům 123', 'Psohlavců 1499/55', '50:14', '12/34', '50° 65′ N, 14° 25′ E', '50 N, 14 S', '100 N, 14 E']) {
        assert.equal(parseCoordinates(query), null, query);
    }
});

function searchFixture() {
    class Element {
        attributes = new Map();
        listeners = new Map();
        children = [];
        dataset = {};
        value = '';

        addEventListener(type, fn) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(fn);
        }
        dispatch(type, fields = {}) {
            for (const fn of this.listeners.get(type) || []) fn({ target: this, preventDefault() {}, ...fields });
        }
        setAttribute(name, value) { this.attributes.set(name, value); }
        removeAttribute(name) { this.attributes.delete(name); }
        append(...children) { this.children.push(...children); }
        replaceChildren() { this.children = []; }
        contains(target) { return this === target || this.children.some(child => child.contains(target)); }
        focus() {}
        scrollIntoView() {}
    }
    const document = new Element();
    const status = new Element();
    document.getElementById = () => status;
    document.createElement = () => new Element();
    const input = new Element();
    input.ownerDocument = document;
    const results = new Element();
    results.id = 'search-results';
    const clearButton = new Element();
    const selections = [];
    const search = createBtsSearch({
        input, results, clearButton,
        onSelectBts: site => selections.push(site),
        onSelectCoordinates: (...point) => selections.push(point),
    });
    const query = text => {
        document.activeElement = input;
        input.value = text;
        input.dispatch('input');
    };
    return { search, query, input, results, status, selections };
}

test('exact IDs precede partial results and operator replacement keeps a single set of listeners', () => {
    const { search, query, input, results, status, selections } = searchFixture();
    const match = { id: 'exact', name: 'Vřesina (J) <test>', cells: [{ ci: '603791:100', band: 'LTE 1800' }] };
    const partials = Array.from({ length: 12 }, (_, id) => ({ id, name: 'Jiné BTS', cells: [{ ci: `154570596${id}`, band: 'LTE 1800' }] }));
    search.setSites([...partials, match]);
    query('154570596');
    assert.equal(results.children.length, 10);
    assert.equal(results.children[0].dataset.id, match.id);
    for (const text of ['0x09368f64', '603791 : 100', 'vresina', '(J']) {
        query(text);
        assert.equal(results.children[0].children[0].textContent, match.name);
    }
    input.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(input.attributes.get('aria-activedescendant'), results.children[0].id);
    input.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(selections, [match]);
    assert.equal(results.hidden, true);

    query('0x9368f64');
    search.setSites(partials);
    assert.equal(status.textContent, 'Nic nenalezeno');
    assert.equal(results.hidden, true);
    assert.equal(input.listeners.get('input').length, 1);
    assert.equal(input.listeners.get('keydown').length, 1);

    input.ownerDocument.activeElement = null;
    search.setSites([match]);
    assert.equal(results.hidden, true);
});

test('coordinate option shares keyboard navigation and supplies longitude before latitude', () => {
    const { query, input, results, selections } = searchFixture();
    query('49.1951,16.6068');
    assert.equal(results.children[0].attributes.get('role'), 'option');
    input.dispatch('keydown', { key: 'Escape' });
    assert.equal(results.hidden, true);
    input.dispatch('keydown', { key: 'ArrowUp' });
    input.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(selections, [[16.6068, 49.1951]]);
    assert.equal(input.attributes.get('aria-expanded'), 'false');
});
