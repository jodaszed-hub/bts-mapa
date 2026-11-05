"""Synchronize map coordinates against complete GSMweb CSV + GPS HTML snapshots.

No proximity-based merging: two indoor sites may be just metres apart. Preserve
existing IDs at matching coordinates, and follow unambiguous cell relocations.
Unknown old cells are retained and explicitly listed for review, never geocoded.
"""
import argparse
import copy
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse


OPERATORS = {
    "o2": ("bts-data.json", "O2-GSMWEB-", [
        ("eurotel.csv", "gsm-search-name.html", True),
        ("o2lte.csv", "o2lte-all-gps.html", False)]),
    "tmobile": ("bts-data-tmobile.json", "TM-GSMWEB-", [
        ("paegas.csv", "t-mobile-all-gps.html", True),
        ("Tlte.csv", "Tlte-all-gps.html", False)]),
}


def coordinate_key(coords):
    lon, lat = coords
    if not all(math.isfinite(v) for v in coords) or not (11 < lon < 20 and 48 < lat < 52):
        raise ValueError(f"Invalid Czech coordinates: {coords}")
    return round(lon, 5), round(lat, 5)


def cell_key(cell):
    band = cell["band"]
    tech = "GSM" if band == "GSM" else "NR" if band.startswith("NR") else "LTE"
    value = str(cell.get("full_cid") or cell["ci"])
    if ":" in value:
        base, sector = map(int, value.split(":"))
        value = str(base * (16384 if tech == "NR" else 256) + sector)
    # GSMweb suffixes repeater IDs with 'r'; keep them distinct from the donor cell.
    value = str(int(value)) if value.isdecimal() else value.lower()
    return tech, value, str(cell.get("tac", "")) if tech == "GSM" else ""


class GpsTableParser(HTMLParser):
    """Read only the result table, with constant memory apart from parsed rows."""
    def __init__(self, gsm):
        super().__init__(convert_charrefs=True)
        self.gsm = gsm
        self.table_depth = 0
        self.finished = False
        self.declared_rows = None
        self.rows = []
        self.columns = None
        self.text = None
        self.coords = None

    def handle_starttag(self, tag, attrs):
        if self.finished:
            return
        attrs = dict(attrs)
        if tag == "table":
            self.table_depth += 1
        if self.table_depth != 1:
            return
        count = re.fullmatch(r"\d+ lokalit / (\d+) sektorů", attrs.get("title", ""))
        if count:
            self.declared_rows = int(count.group(1))
        if tag == "tr":
            self.columns, self.coords = [], None
        elif tag in ("td", "th") and self.columns is not None:
            self.text = []
        elif tag == "a" and self.columns is not None:
            query = parse_qs(urlparse(attrs.get("href", "")).query)
            if "x" in query and "y" in query:
                self.coords = [float(query["x"][0]), float(query["y"][0])]

    def handle_data(self, data):
        if self.text is not None:
            self.text.append(data)

    def handle_endtag(self, tag):
        if self.finished:
            return
        if self.table_depth == 1:
            if tag in ("td", "th") and self.text is not None:
                self.columns.append(" ".join("".join(self.text).split()))
                self.text = None
            elif tag == "tr" and self.columns is not None:
                if self.coords:
                    values = self.columns[-11:]
                    if len(values) != 11 or not values[0] or not values[1]:
                        raise ValueError(f"Unexpected GPS table row: {values}")
                    ci, decimal, tac, band, phys, date, district, name, _, _, author = values
                    cell = {"ci": ci, "tac": tac, "band": "GSM" if self.gsm else band,
                            "phys": f"{band}/{phys}" if self.gsm else phys,
                            "datum": date, "autor": author, "okr": district}
                    if not self.gsm:
                        cell["full_cid"] = decimal
                    coordinate_key(self.coords)
                    self.rows.append({"coords": self.coords, "name": name, "cell": cell})
                self.columns = None
        if tag == "table":
            self.table_depth -= 1
            if self.table_depth == 0:
                self.finished = True


def read_source(csv_path, html_path, gsm):
    parser = GpsTableParser(gsm)
    with html_path.open(encoding="utf-8") as handle:
        while chunk := handle.read(65536):
            parser.feed(chunk)
    parser.close()
    if not parser.finished or not parser.rows:
        raise ValueError(f"Incomplete GPS result table: {html_path.name}")
    if parser.declared_rows is not None and len(parser.rows) != parser.declared_rows:
        raise ValueError(f"Incomplete GPS rows: {html_path.name}: "
                         f"{len(parser.rows)} of {parser.declared_rows}")
    with csv_path.open(encoding="cp1250", newline="") as handle:
        csv_rows = list(csv.DictReader(handle, delimiter=";"))
    index = {}
    for row in csv_rows:
        cid = row["CID" if gsm else "CellID"]
        if cid in index:
            raise ValueError(f"Ambiguous CSV CID in {csv_path.name}: {cid}")
        index[cid] = row
    for record in parser.rows:
        cell = record["cell"]
        cid = cell["ci"] if gsm else cell["full_cid"]
        row = index.get(cid)
        if row is None:
            raise ValueError(f"GPS cell missing from CSV: {cid}")
        # Different snapshots must not silently be combined.
        if " ".join(row["Umisteni"].split()) != record["name"] or row["Datum"] != cell["datum"]:
            raise ValueError(f"CSV/GPS snapshot mismatch: {csv_path.name} CID {cid}")
        if not gsm:
            cell["gsmcid"] = row["GSMCID"]
    seen = {r["cell"]["ci"] if gsm else r["cell"]["full_cid"] for r in parser.rows}
    return parser.rows, {"csv_rows": len(csv_rows), "gps_rows": len(parser.rows),
                         "csv_without_gps": sorted(set(index) - seen)}


def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def synchronize(old, records, prefix):
    source = {}
    source_keys = {}
    duplicate_source_rows = 0
    for row in records:
        xy = coordinate_key(row["coords"])
        key = cell_key(row["cell"])
        if key in source_keys:
            if source_keys[key] != xy:
                raise ValueError(f"Cell appears at multiple GPS coordinates: {key}")
            duplicate_source_rows += 1
            continue
        source_keys[key] = xy
        site = source.setdefault(xy, {"name": row["name"], "coords": row["coords"], "cells": []})
        site["cells"].append(copy.deepcopy(row["cell"]))

    by_cid = defaultdict(list)
    for key in source_keys:
        by_cid[key[:2]].append(key)

    def resolved_key(cell):
        key = cell_key(cell)
        # GSM LAC may have changed; accept CID-only matching only if unambiguous.
        if key not in source_keys and len(by_cid[key[:2]]) == 1:
            return by_cid[key[:2]][0]
        return key

    old_by_xy = {}
    old_by_id = {}
    old_cells = {}
    for site in old:
        xy = coordinate_key(site["coords"])
        if xy in old_by_xy or site["id"] in old_by_id:
            raise ValueError("Baseline has duplicate coordinates or IDs; manual review required")
        old_by_xy[xy], old_by_id[site["id"]] = site, site
        for cell in site["cells"]:
            old_cells.setdefault(resolved_key(cell), cell)

    chosen = {}
    assigned_old = {}
    # Coordinate identity wins, keeping stable IDs even when cell inventory changes.
    for xy in source:
        if xy in old_by_xy:
            chosen[xy] = old_by_xy[xy]
            assigned_old[old_by_xy[xy]["id"]] = xy
    # A whole site's known cells relocating together is evidence of a GPS correction.
    relocation_candidates = defaultdict(list)
    for site in old:
        if site["id"] in assigned_old:
            continue
        keys = [resolved_key(c) for c in site["cells"]]
        targets = {source_keys[k] for k in keys if k in source_keys}
        if len(targets) == 1 and all(k in source_keys for k in keys):
            xy = next(iter(targets))
            relocation_candidates[xy].append(site)
    aliases = {}
    for xy, candidates in relocation_candidates.items():
        if xy not in chosen:
            candidates.sort(key=lambda s: (-len(s["cells"]), s["id"]))
            chosen[xy] = candidates[0]
            assigned_old[candidates[0]["id"]] = xy
        for site in candidates:
            if site["id"] != chosen[xy]["id"]:
                aliases[site["id"]] = chosen[xy]["id"]

    next_id = max((int(s["id"][len(prefix):]) for s in old if s["id"].startswith(prefix)), default=0) + 1
    result_by_xy = {}
    additions, corrections, retained = [], [], []
    for xy, site in source.items():
        previous = chosen.get(xy)
        result = copy.deepcopy(previous) if previous else {}
        if previous:
            if coordinate_key(previous["coords"]) != xy:
                corrections.append({"id": previous["id"], "name": site["name"],
                                    "old_coords": previous["coords"], "coords": site["coords"],
                                    "distance_m": round(distance(previous["coords"], site["coords"]), 2)})
        else:
            result["id"] = f"{prefix}{next_id}"
            next_id += 1
            additions.append({"id": result["id"], "name": site["name"], "coords": site["coords"]})
        result.update({"name": site["name"], "coords": site["coords"], "cells": []})
        for fresh in site["cells"]:
            previous_cell = old_cells.get(cell_key(fresh))
            if previous_cell is None:
                result["cells"].append(fresh)
                continue
            cell = {**previous_cell, **fresh}
            # Keep the existing schema for matched cells. New cells get the CSV
            # identifiers for search; a full ID is also retained when needed to
            # disambiguate the decimal ID encoded in a source CI.
            for field in ("full_cid", "gsmcid", "okr"):
                if field not in previous_cell:
                    cell.pop(field, None)
            if cell_key(cell) != cell_key(fresh):
                cell["full_cid"] = fresh["full_cid"]
            if previous_cell.get("autor") == fresh["autor"][:15]:
                cell["autor"] = previous_cell["autor"]
            result["cells"].append(cell)
        result_by_xy[xy] = result

    # Keep old cells without a current GPS entry, and explicitly report the limit.
    for site in old:
        remaining = [copy.deepcopy(c) for c in site["cells"] if resolved_key(c) not in source_keys]
        if not remaining:
            continue
        xy = assigned_old.get(site["id"], coordinate_key(site["coords"]))
        if xy not in result_by_xy:
            result_by_xy[xy] = copy.deepcopy(site)
            result_by_xy[xy]["cells"] = []
        result_by_xy[xy]["cells"].extend(remaining)
        retained.append({"id": site["id"], "name": site["name"], "coords": site["coords"],
                         "cells_without_current_gps": len(remaining)})

    # Preserve baseline order; deterministic new IDs make a second run a no-op.
    result = list(result_by_xy.values())
    old_order = {s["id"]: i for i, s in enumerate(old)}
    result.sort(key=lambda s: (old_order.get(s["id"], len(old)), int(s["id"][len(prefix):])))
    for site in result:
        previous = old_by_id.get(site["id"], {})
        order = {resolved_key(c): i for i, c in enumerate(previous.get("cells", []))}
        site["cells"].sort(key=lambda c: order.get(cell_key(c), len(order)))
    keys = [cell_key(c) for s in result for c in s["cells"]]
    duplicates = [key for key, count in Counter(keys).items() if count > 1]
    if duplicates or len({coordinate_key(s["coords"]) for s in result}) != len(result):
        raise ValueError(f"Output contains duplicates: {duplicates[:5]}")
    if len({s["id"] for s in result}) != len(result):
        raise ValueError("Output contains duplicate IDs")
    output_keys = set(keys)
    if not set(source_keys).issubset(output_keys):
        raise ValueError("Some source cells were lost")
    for xy, site in result_by_xy.items():
        if any(source_keys.get(cell_key(cell), xy) != xy for cell in site["cells"]):
            raise ValueError(f"Source cell was assigned to incorrect coordinates: {site['id']}")
    if not {resolved_key(c) for s in old for c in s["cells"]}.issubset(output_keys):
        raise ValueError("Some baseline cells were lost")
    output_ids = {s["id"] for s in result}
    replaced = []
    for site in old:
        if site["id"] in output_ids:
            continue
        targets = {source_keys[resolved_key(c)] for c in site["cells"]}
        replaced.append({"id": site["id"], "name": site["name"], "coords": site["coords"],
                         "replacement_ids": sorted(result_by_xy[xy]["id"] for xy in targets)})
    return result, {"before_sites": len(old), "after_sites": len(result),
                    "before_cells": sum(len(s["cells"]) for s in old), "after_cells": len(keys),
                    "source_sites": len(source), "source_cells": len(source_keys),
                    "added_sites": additions, "corrected_coordinates": corrections,
                    "retained_unverified": retained, "merged_id_aliases": aliases,
                    "replaced_old_sites": replaced,
                    "duplicate_source_rows_removed": duplicate_source_rows,
                    "duplicate_output_cells": len(duplicates)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = {"source": "GSMweb.cz", "operators": {}}
    pending = {}
    for operator, (filename, prefix, inputs) in OPERATORS.items():
        records, input_stats = [], []
        for csv_name, html_name, gsm in inputs:
            rows, stats = read_source(args.sources / csv_name, args.sources / html_name, gsm)
            stats.update({"csv_file": csv_name, "gps_file": html_name,
                          "csv_sha256": digest(args.sources / csv_name),
                          "gps_sha256": digest(args.sources / html_name)})
            records.extend(rows)
            input_stats.append(stats)
        baseline_path = args.baseline / filename
        old = json.loads(baseline_path.read_text())
        result, stats = synchronize(old, records, prefix)
        # Idempotence is an important guard against accidental duplication.
        second, _ = synchronize(result, records, prefix)
        if second != result:
            raise ValueError(f"Non-idempotent synchronization for {operator}")
        contents = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        pending[filename] = contents
        stats.update({"inputs": input_stats, "baseline_sha256": digest(baseline_path),
                      "output_sha256": hashlib.sha256(contents).hexdigest(), "idempotent": True})
        report["operators"][operator] = stats
        print(f"{operator}: {len(old)} → {len(result)} sites; "
              f"{len(stats['added_sites'])} added; {len(stats['corrected_coordinates'])} GPS corrections; "
              f"{len(stats['retained_unverified'])} sites with old unverified cells")
    args.output.mkdir(parents=True, exist_ok=True)
    for filename, contents in pending.items():
        target = args.output / filename
        staged = target.with_suffix(".json.tmp")
        staged.write_bytes(contents)
        staged.replace(target)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
