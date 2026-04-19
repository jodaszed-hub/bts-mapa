import json
import random

# Bounding box České republiky (přibližně)
# Lat: 48.55 - 51.05
# Lon: 12.09 - 18.85

def generate_mock_bts(count=20000, output_file="../bts-data.json"):
    print(f"Generuji {count} fiktivních BTS pro testování mapy...")
    bts_list = []
    
    # Přidáme i původních 10 reálných z Prahy
    real_prague_bts = [
        { "id": "O2-PRG-001", "name": "BTS Václavské náměstí", "coords": [14.4261, 50.0811] },
        { "id": "O2-PRG-002", "name": "BTS Pražský hrad", "coords": [14.4011, 50.0911] },
        { "id": "O2-PRG-003", "name": "BTS Žižkovská věž", "coords": [14.4514, 50.0810] },
        { "id": "O2-PRG-004", "name": "BTS Pankrác", "coords": [14.4395, 50.0505] },
        { "id": "O2-PRG-005", "name": "BTS Anděl", "coords": [14.4035, 50.0716] },
        { "id": "O2-PRG-006", "name": "BTS Dejvice", "coords": [14.3941, 50.1009] },
        { "id": "O2-PRG-007", "name": "BTS Letňany", "coords": [14.5165, 50.1340] },
        { "id": "O2-PRG-008", "name": "BTS Chodov", "coords": [14.4913, 50.0315] },
        { "id": "O2-PRG-009", "name": "BTS Černý Most", "coords": [14.5772, 50.1075] },
        { "id": "O2-PRG-010", "name": "BTS Zličín", "coords": [14.2885, 50.0543] }
    ]
    
    bts_list.extend(real_prague_bts)
    
    for i in range(count - len(real_prague_bts)):
        lat = random.uniform(48.55, 51.05)
        lon = random.uniform(12.09, 18.85)
        
        bts_list.append({
            "id": f"O2-CZ-MOCK-{i+1}",
            "name": f"BTS {lat:.4f}, {lon:.4f}",
            "coords": [lon, lat]
        })
        
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(bts_list, f, ensure_ascii=False)
        
    print(f"Uloženo do {output_file}")

if __name__ == "__main__":
    # Generujeme 15 000 bodů
    generate_mock_bts(15000, "/home/syd/AIPrace/BTSmapa/bts-data.json")
