#!/usr/bin/env python3
import urllib.request
import urllib.parse
import re
import json
import time
import math
import os

# Configuration
base_dir = os.path.dirname(os.path.abspath(__file__))
o2_path = os.path.join(base_dir, 'bts-data.json')
tm_path = os.path.join(base_dir, 'bts-data-tmobile.json')

okresy = [
    'AB', 'BN', 'BE', 'KL', 'KO', 'KH', 'ME', 'MB', 'NB', 'PH', 'PZ', 'PB', 'RA',
    'CB', 'CK', 'JH', 'PI', 'PT', 'ST', 'TA', 'DO', 'KT', 'PM', 'PJ', 'PS', 'RO', 'TC',
    'CH', 'KV', 'SO', 'DC', 'CV', 'LN', 'MO', 'TP', 'UL', 'LT', 'CL', 'JN', 'LI', 'SM',
    'HK', 'JC', 'NA', 'RK', 'TU', 'CR', 'PU', 'SY', 'UO', 'HB', 'JI', 'PE', 'TR', 'ZR',
    'BK', 'BM', 'BO', 'BV', 'HO', 'VY', 'ZN', 'JE', 'OC', 'PV', 'PR', 'SU', 'KM', 'UH',
    'VS', 'ZL', 'BR', 'FM', 'KI', 'NJ', 'OP', 'OV'
]

url = "http://www.gsmweb.cz/search.php"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def haversine_distance(coords1, coords2):
    R = 6371000  # Earth radius in meters
    lng1, lat1 = coords1
    lng2, lat2 = coords2
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    
    a = math.sin(delta_phi / 2)**2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2)**2
        
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def normalize_band(band):
    band_str = str(band).strip()
    if band_str == '3700':
        return 'NR 3500'
    elif band_str == '700':
        return 'NR 700'
    return band_str

def scrape_operator(operator_keys, label):
    bts_dict = {}
    total_okresy = len(okresy)
    
    print(f"\n--- Stahování dat pro {label} ---")
    for idx, okres in enumerate(okresy):
        print(f"[{idx+1}/{total_okresy}] Stahování okresu {okres}...", end="\r")
        for op in operator_keys:
            params = {'op': op, 'par': 'okres', 'udaj': okres}
            data_encoded = urllib.parse.urlencode(params).encode('utf-8')
            req = urllib.request.Request(url, data=data_encoded, headers=headers)
            
            # Retry mechanism
            html = ""
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=15) as response:
                        html = response.read().decode('utf-8', errors='ignore')
                        break
                except Exception as e:
                    if attempt == 2:
                        print(f"\nChyba při stahování okresu {okres} ({op}): {e}")
                    time.sleep(1)
            
            if not html:
                continue
                
            matches = re.finditer(r'<tr[^>]*>(.*?)</tr>', html, re.IGNORECASE | re.DOTALL)
            for match in matches:
                row_html = match.group(1)
                if 'mapy.com/turisticka' not in row_html:
                    continue
                
                # Match coordinate links
                map_m = re.search(r'x=([0-9\.]+)&(?:amp;)?y=([0-9\.]+)', row_html)
                if not map_m:
                    continue
                lon, lat = float(map_m.group(1)), float(map_m.group(2))
                
                tds = re.findall(r'<td[^>]*>(.*?)</td>', row_html, re.IGNORECASE | re.DOTALL)
                clean_tds = [re.sub(r'<[^>]+>', '', td).strip().replace('&nbsp;', '') for td in tds]
                
                name = clean_tds[-4] if len(clean_tds) >= 4 else "Neznámé umístění"
                
                key = (round(lon, 5), round(lat, 5))
                
                if key not in bts_dict:
                    bts_dict[key] = {
                        "lon": lon,
                        "lat": lat,
                        "cells": {},
                        "name": name
                    }
                    
                if len(clean_tds) >= 11:
                    cell_ci = clean_tds[-11]
                    if cell_ci:
                        is_lte_or_nr = (op in ['o2lte', 'Tlte'])
                        band = clean_tds[-8] if is_lte_or_nr else 'GSM'
                        band = normalize_band(band)
                        
                        phys = clean_tds[-7] if is_lte_or_nr else f"{clean_tds[-8]}/{clean_tds[-7]}"
                        
                        cell_info = {
                            "ci": cell_ci,
                            "tac": clean_tds[-9],
                            "band": band,
                            "phys": phys,
                            "datum": clean_tds[-6],
                            "autor": clean_tds[-1][:15]
                        }
                        
                        # Extra full_cid check if available
                        if is_lte_or_nr and len(clean_tds) >= 12:
                            # Let's search if there's a full_cid in the list
                            # Usually full_cid is stored in some format or can be computed,
                            # but we can preserve it if it was in the original cells.
                            pass
                            
                        bts_dict[key]["cells"][cell_ci] = cell_info
            time.sleep(0.1) # Be polite
    print(f"\nStaženo {len(bts_dict)} věží pro {label}.")
    return bts_dict

def main():
    # 1. Load current stats
    print("Načítám aktuální data pro porovnání...")
    current_o2_towers = 0
    current_o2_cells = 0
    if os.path.exists(o2_path):
        try:
            with open(o2_path, 'r', encoding='utf-8') as f:
                o2_old = json.load(f)
                current_o2_towers = len(o2_old)
                current_o2_cells = sum(len(b.get('cells', [])) for b in o2_old)
        except Exception:
            pass

    current_tm_towers = 0
    current_tm_cells = 0
    if os.path.exists(tm_path):
        try:
            with open(tm_path, 'r', encoding='utf-8') as f:
                tm_old = json.load(f)
                current_tm_towers = len(tm_old)
                current_tm_cells = sum(len(b.get('cells', [])) for b in tm_old)
        except Exception:
            pass

    # 2. Scrape O2 and T-Mobile
    o2_dict = scrape_operator(['eurotel', 'o2lte'], "O2")
    tm_dict = scrape_operator(['t-mobile', 'Tlte'], "T-Mobile")

    # 3. Format O2 JSON
    o2_data = []
    for i, (key, data) in enumerate(o2_dict.items()):
        o2_data.append({
            "id": f"O2-GSMWEB-{i+1}",
            "name": data["name"],
            "cells": list(data["cells"].values()),
            "coords": [data["lon"], data["lat"]]
        })

    # 4. Merge 5G data from O2 into T-Mobile (CETIN sharing)
    # Create spatial grid for O2
    grid = {}
    for bts in o2_data:
        gx = int(bts['coords'][0] / 0.005)
        gy = int(bts['coords'][1] / 0.005)
        grid_key = (gx, gy)
        if grid_key not in grid:
            grid[grid_key] = []
        grid[grid_key].append(bts)

    def get_candidate_o2_bts(tm_coords):
        tx, ty = int(tm_coords[0] / 0.005), int(tm_coords[1] / 0.005)
        candidates = []
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                k = (tx + dx, ty + dy)
                if k in grid:
                    candidates.extend(grid[k])
        return candidates

    print("\nProvádím párování sdílených CETIN 5G buněk...")
    shared_cells_added = 0
    shared_towers_updated = 0

    tm_data = []
    for i, (key, data) in enumerate(tm_dict.items()):
        tm_coords = [data["lon"], data["lat"]]
        tm_cells = list(data["cells"].values())
        
        # Find closest O2 tower within 25m
        candidates = get_candidate_o2_bts(tm_coords)
        closest_o2 = None
        min_dist = 25.0
        
        for o2_bts in candidates:
            dist = haversine_distance(tm_coords, o2_bts['coords'])
            if dist < min_dist:
                min_dist = dist
                closest_o2 = o2_bts
                
        if closest_o2:
            o2_5g_cells = [c for c in closest_o2.get('cells', []) if c.get('band', '').startswith('NR ')]
            if o2_5g_cells:
                tm_existing_bands = set(c.get('band', '') for c in tm_cells)
                tm_existing_cids = set(c.get('ci', '') for c in tm_cells)
                
                cells_to_add = []
                for o2_cell in o2_5g_cells:
                    if o2_cell['band'] not in tm_existing_bands and o2_cell.get('ci') not in tm_existing_cids:
                        copied_cell = o2_cell.copy()
                        copied_cell['shared'] = True
                        cells_to_add.append(copied_cell)
                        
                if cells_to_add:
                    tm_cells.extend(cells_to_add)
                    shared_cells_added += len(cells_to_add)
                    shared_towers_updated += 1

        tm_data.append({
            "id": f"TM-GSMWEB-{i+1}",
            "name": data["name"],
            "cells": tm_cells,
            "coords": tm_coords
        })

    # Save data
    with open(o2_path, 'w', encoding='utf-8') as f:
        json.dump(o2_data, f, ensure_ascii=False, indent=2)
        
    with open(tm_path, 'w', encoding='utf-8') as f:
        json.dump(tm_data, f, ensure_ascii=False, indent=2)

    # Stats comparison
    new_o2_towers = len(o2_data)
    new_o2_cells = sum(len(b['cells']) for b in o2_data)
    new_tm_towers = len(tm_data)
    new_tm_cells = sum(len(b['cells']) for b in tm_data)

    print("\n=== STATISTIKA AKTUALIZACE ===")
    print(f"O2 vysílače: {current_o2_towers} -> {new_o2_towers} (změna: {new_o2_towers - current_o2_towers:+})")
    print(f"O2 buňky: {current_o2_cells} -> {new_o2_cells} (změna: {new_o2_cells - current_o2_cells:+})")
    print(f"T-Mobile vysílače: {current_tm_towers} -> {new_tm_towers} (změna: {new_tm_towers - current_tm_towers:+})")
    print(f"T-Mobile buňky (vč. sdílených): {current_tm_cells} -> {new_tm_cells} (změna: {new_tm_cells - current_tm_cells:+})")
    print(f"Z toho sloučených O2 5G buněk do T-Mobile: {shared_cells_added} na {shared_towers_updated} vysílačích")
    print("Hotovo! Všechna data byla uložena a aktualizována.")

if __name__ == '__main__':
    main()
