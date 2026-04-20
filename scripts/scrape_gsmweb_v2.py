import urllib.request
import urllib.parse
import re
import json
import time

okresy = [
    "AB", "BN", "BE", "KD", "KL", "KO", "KH", "ME", "MB", "NB", "PB", "PZ", "PY", "RA", "RK",
    "CB", "CK", "JH", "PI", "PT", "ST", "TA", "DO", "KT", "PM", "PS", "PJ", "RO", "TC", "CH",
    "KV", "SO", "DC", "CV", "LN", "MO", "TP", "UL", "CL", "JN", "LI", "SM", "HK", "JC", "NA",
    "TU", "CR", "PU", "SY", "UO", "HB", "JI", "PE", "TR", "ZR", "BK", "BM", "BO", "BV", "HO",
    "VY", "ZN", "KM", "UH", "VS", "ZL", "BR", "FM", "KI", "NJ", "OP", "OV", "PR", "SU", "JE"
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
                    
                    name_m = re.search(r'<td[^>]*>(.*?)</td>\s*<td[^>]*>\s*<a href="https://www\.mapy\.com/turisticka', row_html, re.IGNORECASE)
                    name = re.sub(r'<[^>]+>', '', name_m.group(1)).strip() if name_m else ""
                    
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
                            "cids": [cid_dec] if cid_dec else [],
                            "name": name
                        }
                    else:
                        if cid_dec and cid_dec not in bts_dict[key]["cids"]:
                            bts_dict[key]["cids"].append(cid_dec)
                            
                    count += 1
                    
                print(f"Okres {okres} ({op}): zpracováno {count} buněk")
                
        except Exception as e:
            print(f"Chyba při stahování okresu {okres} ({op}): {e}")
            
        time.sleep(0.5)

print(f"\nCelkem unikátních věží (lokalit): {len(bts_dict)}")

json_data = []
for i, (key, data) in enumerate(bts_dict.items()):
    cids_str = ", ".join(data["cids"]) if data["cids"] else "Neznámé"
    
    # Sestavíme krásný název pro UI
    final_name = f"{data['name']} (CID: {cids_str})"
    
    json_data.append({
        "id": f"O2-GSMWEB-{i+1}",
        "name": final_name,
        "coords": [data["lon"], data["lat"]]
    })

with open('bts-data.json', 'w') as f:
    json.dump(json_data, f, ensure_ascii=False, indent=2)
    
print("Data byla uložena do bts-data.json")
