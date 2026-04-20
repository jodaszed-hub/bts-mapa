import urllib.request
import urllib.parse
import re
import json
import time

okresy = [
    'AB', 'BN', 'BE', 'KL', 'KO', 'KH', 'ME', 'MB', 'NB', 'PH', 'PZ', 'PB', 'RA',
    'CB', 'CK', 'JH', 'PI', 'PT', 'ST', 'TA', 'DO', 'KT', 'PM', 'PJ', 'PS', 'RO', 'TC',
    'CH', 'KV', 'SO', 'DC', 'CV', 'LN', 'MO', 'TP', 'UL', 'LT', 'CL', 'JN', 'LI', 'SM',
    'HK', 'JC', 'NA', 'RK', 'TU', 'CR', 'PU', 'SY', 'UO', 'HB', 'JI', 'PE', 'TR', 'ZR',
    'BK', 'BM', 'BO', 'BV', 'HO', 'VY', 'ZN', 'JE', 'OC', 'PV', 'PR', 'SU', 'KM', 'UH',
    'VS', 'ZL', 'BR', 'FM', 'KI', 'NJ', 'OP', 'OV'
]

url = "http://www.gsmweb.cz/search.php"
bts_dict = {}

print("Začínám stahovat data z GSMweb.cz pro O2 (Eurotel) s názvy a čísly BTS...")

for okres in okresy:
    for op in ['eurotel', 'o2lte']:
        data = urllib.parse.urlencode({'op': op, 'par': 'okres', 'udaj': okres}).encode('utf-8')
        req = urllib.request.Request(url, data=data)
        try:
            with urllib.request.urlopen(req) as response:
                html = response.read().decode('utf-8', errors='ignore')
                
                matches = re.finditer(r'<tr[^>]*>(.*?)</tr>', html, re.IGNORECASE | re.DOTALL)
                count = 0
                for match in matches:
                    row_html = match.group(1)
                    if 'mapy.com/turisticka' not in row_html:
                        continue
                    
                    map_m = re.search(r'x=([0-9\.]+)&amp;y=([0-9\.]+)', row_html)
                    if not map_m:
                        continue
                    lon, lat = float(map_m.group(1)), float(map_m.group(2))
                    
                    tds = re.findall(r'<td[^>]*>(.*?)</td>', row_html, re.IGNORECASE | re.DOTALL)
                    clean_tds = [re.sub(r'<[^>]+>', '', td).strip().replace('&nbsp;', '') for td in tds]
                    
                    name = clean_tds[-4] if len(clean_tds) >= 4 else "Neznámé umístění"
                    
                    cid_dec = ""
                    for td in clean_tds:
                        if td.isdigit() and len(td) > 2:
                            cid_dec = td
                            break
                            
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
                        if cell_ci and cell_ci not in bts_dict[key]["cells"]:
                            bts_dict[key]["cells"][cell_ci] = {
                                "ci": cell_ci,
                                "tac": clean_tds[-9],
                                "band": clean_tds[-8] if op == 'o2lte' else 'GSM',
                                "phys": clean_tds[-7] if op == 'o2lte' else f"{clean_tds[-8]}/{clean_tds[-7]}",
                                "datum": clean_tds[-6],
                                "autor": clean_tds[-1][:15]
                            }
                    count += 1
                    
                print(f"Okres {okres} ({op}): zpracováno {count} buněk")
                
        except Exception as e:
            print(f"Chyba při stahování okresu {okres} ({op}): {e}")
            
        time.sleep(0.5)

print(f"\nCelkem unikátních věží (lokalit): {len(bts_dict)}")

json_data = []
for i, (key, data) in enumerate(bts_dict.items()):
    # Převod slovníku buněk na list
    cells_list = list(data["cells"].values())
    
    # Sestavíme krásný název pro UI
    final_name = f"{data['name']}"
    
    json_data.append({
        "id": f"O2-GSMWEB-{i+1}",
        "name": final_name,
        "cells": cells_list,
        "coords": [data["lon"], data["lat"]]
    })

with open('bts-data.json', 'w') as f:
    json.dump(json_data, f, ensure_ascii=False, indent=2)
    
print("Data byla uložena do bts-data.json")
