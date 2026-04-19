import json

with open("bts-data.json", "r") as f:
    data = json.load(f)

new_data = []
for i, bts in enumerate(data):
    if "coords" in bts:
        continue # Already correct
    new_data.append({
        "id": f"O2-GSMWEB-{i+1}",
        "name": f"O2 BTS {bts['lat']:.4f}, {bts['lon']:.4f}",
        "coords": [bts["lon"], bts["lat"]]
    })

if new_data:
    with open("bts-data.json", "w") as f:
        json.dump(new_data, f)
    print("Data fixed.")
else:
    print("Data already in correct format.")
