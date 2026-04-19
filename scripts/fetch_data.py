#!/usr/bin/env python3
import csv
import json
import sys
import os

# OpenCelliD format: radio,mcc,net,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal

def process_opencellid_data(input_csv, output_json):
    if not os.path.exists(input_csv):
        print(f"Error: Vstupní soubor {input_csv} neexistuje.")
        print("Stáhněte si prosím databázi z opencellid.org a přejmenujte/umístěte ji správně.")
        sys.exit(1)

    print(f"Čtu soubor {input_csv}...")
    bts_towers = {}
    
    with open(input_csv, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        try:
            first_row = next(reader)
            # Pokud první řádek nevypadá jako hlavička (např. začíná 'GSM' nebo 'UMTS' nebo 'LTE'), vrátíme ho do zpracování
            if first_row and first_row[0] not in ('radio', 'mcc', 'net', 'cell'):
                process_row(first_row, bts_towers)
        except StopIteration:
            print("Soubor je prázdný.")
            sys.exit(1)

        for row in reader:
            process_row(row, bts_towers)

    # Výstup do JSON
    output_data = list(bts_towers.values())
    
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    print(f"Úspěšně zpracováno. Nalezeno {len(output_data)} unikátních fyzických BTS věží O2.")
    print(f"Data uložena do: {output_json}")

def process_row(row, bts_towers):
    if len(row) < 8:
        return
    
    mcc = row[1]
    mnc = row[2]
    
    # 230 = CZ, 2 = O2 (Původně Eurotel)
    if mcc == '230' and mnc == '2':
        lon_str = row[6]
        lat_str = row[7]
        
        try:
            lon = float(lon_str)
            lat = float(lat_str)
        except ValueError:
            return
        
        coord_key = f"{round(lat, 5)}_{round(lon, 5)}"
        
        if coord_key not in bts_towers:
            bts_towers[coord_key] = {
                "id": f"O2-CZ-{len(bts_towers) + 1}",
                "name": f"O2 BTS {lat:.4f}, {lon:.4f}",
                "coords": [lon, lat],
                "cells": 1
            }
        else:
            bts_towers[coord_key]["cells"] += 1

if __name__ == "__main__":
    # Výchozí cesty
    input_file = "230.csv"
    output_file = "../bts-data.json"
    
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    if len(sys.argv) > 2:
        output_file = sys.argv[2]
        
    process_opencellid_data(input_file, output_file)
