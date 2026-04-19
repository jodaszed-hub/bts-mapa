import urllib.request
import urllib.parse
import re
import json
import time
import sys

# Seznam všech SPZ okresů v ČR
okresy = [
    "AB", "BN", "BE", "KD", "KL", "KO", "KH", "ME", "MB", "NB", "PB", "PZ", "PY", "RA", "RK",
    "CB", "CK", "JH", "PI", "PT", "ST", "TA", "DO", "KT", "PM", "PS", "PJ", "RO", "TC", "CH",
    "KV", "SO", "DC", "CV", "LN", "MO", "TP", "UL", "CL", "JN", "LI", "SM", "HK", "JC", "NA",
    "TU", "CR", "PU", "SY", "UO", "HB", "JI", "PE", "TR", "ZR", "BK", "BM", "BO", "BV", "HO",
    "VY", "ZN", "KM", "UH", "VS", "ZL", "BR", "FM", "KI", "NJ", "OP", "OV", "PR", "SU", "JE"
]

url = "http://www.gsmweb.cz/search.php"
all_bts = []

print("Začínám stahovat data z GSMweb.cz pro O2 (Eurotel)...")

for okres in okresy:
    data = urllib.parse.urlencode({'op': 'eurotel', 'par': 'okres', 'udaj': okres}).encode('utf-8')
    req = urllib.request.Request(url, data=data)
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
            # Hledáme všechny řádky tabulky s výsledky
            # Řádky obsahují odkaz na mapu "x=...&y=..."
            # Budeme to parsovat pomocí regexu
            
            matches = re.finditer(r'<a href="https://www\.mapy\.com/turisticka\?x=([0-9\.]+)&amp;y=([0-9\.]+).*?".*?>MAPA</a>', html)
            
            count = 0
            for match in matches:
                lon = float(match.group(1))
                lat = float(match.group(2))
                
                # Uložíme do seznamu, zaokrouhlíme na 5 desetinných míst pro odstranění malých odchylek sektorů na stejné věži
                key = (round(lon, 5), round(lat, 5))
                all_bts.append(key)
                count += 1
                
            print(f"Okres {okres}: nalezeno {count} záznamů")
            
    except Exception as e:
        print(f"Chyba při stahování okresu {okres}: {e}")
        
    # Slušnostní pauza, abychom nepřetěžovali server
    time.sleep(0.5)

# Odstranění duplicit (více sektorů na jedné věži)
unique_bts = list(set(all_bts))

print(f"\nCelkem staženo sektorů: {len(all_bts)}")
print(f"Celkem unikátních věží (lokalit): {len(unique_bts)}")

# Uložení do JSON
json_data = [{"lon": lon, "lat": lat} for lon, lat in unique_bts]

with open('bts-data.json', 'w') as f:
    json.dump(json_data, f)
    
print("Data byla uložena do bts-data.json")
