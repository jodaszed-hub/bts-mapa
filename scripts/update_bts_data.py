import json
import csv
import os
import re

# Cesty k souborům
json_path = '/home/syd/AIPrace/BTSmapa/bts-data.json'
csv_path = '/home/syd/Stažené/o2lte.csv'

def parse_ci_with_band(ci_str, band_name):
    """Převede CI na integer s přihlédnutím k technologii (LTE vs NR)."""
    if ':' in ci_str:
        try:
            base, index = map(int, ci_str.split(':'))
            # NR (5G) používá násobič 16384, LTE (4G) používá 256
            multiplier = 16384 if 'NR' in str(band_name) else 256
            return base * multiplier + index
        except ValueError:
            return None
    try:
        return int(ci_str)
    except ValueError:
        return None

def update_data():
    print("Načítám JSON...")
    with open(json_path, 'r', encoding='utf-8') as f:
        bts_list = json.load(f)

    # 1. Mapování: CellID -> Cell Objekt (pro přímé aktualizace stávajících)
    cell_lookup = {}
    for bts in bts_list:
        for cell in bts.get('cells', []):
            cid = parse_ci_with_band(cell.get('ci', ''), cell.get('band', ''))
            if cid:
                cell_lookup[cid] = (bts, cell)

    print("Načítám CSV a buduji mapu kotev (GSMCID)...")
    gsmcid_to_bts = {}
    csv_data = []
    
    with open(csv_path, 'r', encoding='cp1250') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            cid = int(row.get('CellID', 0))
            gsmcid = row.get('GSMCID')
            csv_data.append(row)
            
            # Pokud tuhle buňku už máme v mapě, víme, že tohle GSMCID patří k této BTS
            if cid in cell_lookup and gsmcid:
                bts, _ = cell_lookup[cid]
                gsmcid_to_bts[gsmcid] = bts

    print(f"Identifikováno {len(gsmcid_to_bts)} stožárů pomocí kotev GSMCID.")

    print("Doplňování dat k existujícím a přidávání nových buněk...")
    updated_count = 0
    added_count = 0

    for row in csv_data:
        cid = int(row.get('CellID', 0))
        gsmcid = row.get('GSMCID')
        band_raw = row.get('Band', '')
        
        # Převedeme pásmo na čitelný formát
        band_name = band_raw
        if band_raw == '500700': band_name = 'NR 700'
        elif band_raw == '501800': band_name = 'NR 1800'
        elif band_raw == '502100': band_name = 'NR 2100'
        elif band_raw == '503500': band_name = 'NR 3500'
        elif band_raw == '800': band_name = 'LTE 800'
        elif band_raw == '900': band_name = 'LTE 900'
        elif band_raw == '1800': band_name = 'LTE 1800'
        elif band_raw == '2100': band_name = 'LTE 2100'
        elif band_raw == '2600': band_name = 'LTE 2600'
        elif band_raw == '2600T': band_name = 'LTE 2600 TDD'

        # Pokud buňku v mapě už máme (přesné ID)
        if cid in cell_lookup:
            bts, cell = cell_lookup[cid]
            cell['gsmcid'] = gsmcid
            cell['okr'] = row.get('Okr')
            cell['full_cid'] = str(cid)
            cell['phys'] = row.get('PhysCID')
            cell['tac'] = row.get('TAC')
            cell['band'] = band_name
            updated_count += 1
        
        # Pokud buňku nemáme, ale známe GSMCID (patří k existujícímu stožáru)
        elif gsmcid in gsmcid_to_bts:
            bts = gsmcid_to_bts[gsmcid]
            # Zkontrolujeme zda už jsme ji náhodou nepřidali
            if not any(c.get('full_cid') == str(cid) for c in bts['cells']):
                new_cell = {
                    "ci": str(cid),
                    "full_cid": str(cid),
                    "tac": row.get('TAC'),
                    "band": band_name,
                    "phys": row.get('PhysCID'),
                    "gsmcid": gsmcid,
                    "okr": row.get('Okr')
                }
                bts['cells'].append(new_cell)
                added_count += 1

    print(f"Hotovo. Aktualizováno: {updated_count}, Přidáno nových: {added_count}")

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(bts_list, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    update_data()
