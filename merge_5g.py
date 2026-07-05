#!/usr/bin/env python3
import json
import math
import os

# Cesty k souborům
base_dir = os.path.dirname(os.path.abspath(__file__))
o2_path = os.path.join(base_dir, 'bts-data.json')
tm_path = os.path.join(base_dir, 'bts-data-tmobile.json')

def haversine_distance(coords1, coords2):
    # Rychlý výpočet vzdálenosti v metrech
    R = 6371000  # poloměr Země v metrech
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

def main():
    print("Načítám datové soubory...")
    with open(o2_path, 'r', encoding='utf-8') as f:
        o2_data = json.load(f)
    with open(tm_path, 'r', encoding='utf-8') as f:
        tm_data = json.load(f)
        
    print(f"Načteno {len(o2_data)} vysílačů O2 a {len(tm_data)} vysílačů T-Mobile.")

    # Nejprve normalizujeme pásma v obou databázích
    for bts in o2_data:
        for cell in bts.get('cells', []):
            if 'band' in cell:
                cell['band'] = normalize_band(cell['band'])
                
    for bts in tm_data:
        for cell in bts.get('cells', []):
            if 'band' in cell:
                cell['band'] = normalize_band(cell['band'])

    # Vytvoříme prostorový index (mřížku) pro zrychlení hledání
    # Mřížka s krokem cca 0.005 stupně (~500m)
    grid = {}
    for bts in o2_data:
        gx = int(bts['coords'][0] / 0.005)
        gy = int(bts['coords'][1] / 0.005)
        key = (gx, gy)
        if key not in grid:
            grid[key] = []
        grid[key].append(bts)

    def get_candidate_o2_bts(tm_coords):
        tx, ty = int(tm_coords[0] / 0.005), int(tm_coords[1] / 0.005)
        candidates = []
        # Prohledáme 9 sousedních buněk mřížky
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                key = (tx + dx, ty + dy)
                if key in grid:
                    candidates.extend(grid[key])
        return candidates

    added_cells_count = 0
    updated_towers_count = 0
    
    print("Hledám sdílené vysílače a slučuji 5G buňky...")
    
    for tm_bts in tm_data:
        tm_coords = tm_bts['coords']
        candidates = get_candidate_o2_bts(tm_coords)
        
        # Najdeme nejbližší O2 věž v okruhu 25 metrů
        closest_o2 = None
        min_dist = 25.0  # limit 25 metrů
        
        for o2_bts in candidates:
            d = haversine_distance(tm_coords, o2_bts['coords'])
            if d < min_dist:
                min_dist = d
                closest_o2 = o2_bts
                
        if closest_o2:
            # Získáme 5G buňky z O2 věže
            o2_5g_cells = [
                c for c in closest_o2.get('cells', [])
                if c.get('band', '').startswith('NR ')
            ]
            
            if o2_5g_cells:
                # Zkontrolujeme, jaké bands už T-Mobile má
                tm_existing_bands = set(c.get('band', '') for c in tm_bts.get('cells', []))
                tm_existing_cids = set(c.get('ci', '') for c in tm_bts.get('cells', []))
                
                cells_to_add = []
                for o2_cell in o2_5g_cells:
                    # Nechceme duplikovat stejné pásmo nebo stejné CI
                    # (pokud by ho náhodou T-Mobile už měl zapsané)
                    if o2_cell['band'] not in tm_existing_bands and o2_cell.get('ci') not in tm_existing_cids:
                        # Vytvoříme kopii a označíme ji jako sdílenou
                        copied_cell = o2_cell.copy()
                        copied_cell['shared'] = True
                        cells_to_add.append(copied_cell)
                        
                if cells_to_add:
                    tm_bts['cells'].extend(cells_to_add)
                    added_cells_count += len(cells_to_add)
                    updated_towers_count += 1

    print(f"Aktualizováno vysílačů T-Mobile: {updated_towers_count}")
    print(f"Přidáno 5G buněk do T-Mobile: {added_cells_count}")

    # Uložíme sloučený T-Mobile soubor
    with open(tm_path, 'w', encoding='utf-8') as f:
        json.dump(tm_data, f, ensure_ascii=False, indent=2)
    print("Sloučená data byla uložena do bts-data-tmobile.json.")

    # Pro jistotu uložíme i normalizovaný O2 soubor
    with open(o2_path, 'w', encoding='utf-8') as f:
        json.dump(o2_data, f, ensure_ascii=False, indent=2)
    print("Normalizovaná data O2 byla uložena do bts-data.json.")

if __name__ == '__main__':
    main()
