"""Small source fixtures exercise identity, GPS corrections and import safeguards."""
import copy
import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync_gsmweb.py"
SPEC = importlib.util.spec_from_file_location("sync_gsmweb", SCRIPT)
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def cell(cid="123", band="GSM", tac="100", **extra):
    return {"ci": cid, "band": band, "tac": tac, "datum": "5.11.2026",
            "phys": "1", "autor": "Tester", **extra}


def record(cid="123", xy=(14.5, 50.1), name="Praha, zkušební stanoviště", **kw):
    return {"coords": list(xy), "name": name, "cell": cell(cid, **kw)}


def site(number=1, xy=(14.5, 50.1), cells=None, **extra):
    return {"id": f"O2-GSMWEB-{number}", "coords": list(xy), "name": "Původní název",
            "cells": cells if cells is not None else [cell()], **extra}


def gps_html(gsm=True, numbered=False, cid="123", date="5.11.2026",
             name="Praha, zkušební stanoviště", xy=(14.5, 50.1)):
    values = (["123", "7b", "100", "65", "1"] if gsm else
              ["1:1", cid, "100", "LTE 800", "1"])
    if gsm:
        values[0] = cid
    values += [date, "AB", name,
               f'<a href="https://mapy.com/?x={xy[0]}&amp;y={xy[1]}">MAPA</a>',
               "", "Tester"]
    if numbered:
        values.insert(0, "10")
    # The second table is the search form; it must never become a BTS record.
    return ("<table><tr>" + "".join(f"<td>{v}</td>" for v in values) +
            "</tr></table><table><tr><td>Search form</td></tr></table>")


class IdentityTests(unittest.TestCase):
    def test_gsm_repeater_keeps_its_separate_identity(self):
        self.assertNotEqual(sync.cell_key(cell("15328r")), sync.cell_key(cell("15328")))

    def test_invalid_coordinates_are_rejected(self):
        for coords in [(50.1, 14.5), (0, 0), (14.5, float("nan"))]:
            with self.subTest(coords=coords), self.assertRaises(ValueError):
                sync.coordinate_key(coords)

    def test_radio_technologies_do_not_collide_for_equal_numeric_ids(self):
        lte = cell("256", "LTE 800")
        nr = cell("256", "NR 700")
        self.assertNotEqual(sync.cell_key(lte), sync.cell_key(nr))
        self.assertEqual(sync.cell_key(cell("1:0", "LTE 800")), sync.cell_key(lte))
        self.assertEqual(sync.cell_key(cell("0:256", "NR 700")), sync.cell_key(nr))


class SynchronizeTests(unittest.TestCase):
    def run_sync(self, old, rows):
        return sync.synchronize(old, rows, "O2-GSMWEB-")

    def test_same_coordinates_preserve_id_and_custom_fields(self):
        old = [site(7, cells=[cell("111")], note="Local note")]
        before = copy.deepcopy(old)
        result, report = self.run_sync(old, [record("222")])
        self.assertEqual(result[0]["id"], "O2-GSMWEB-7")
        self.assertEqual(result[0]["note"], "Local note")
        self.assertEqual({c["ci"] for c in result[0]["cells"]}, {"111", "222"})
        self.assertEqual(report["added_sites"], [])
        self.assertEqual(old, before, "The baseline must remain reusable for review")

    def test_lte_and_nr_same_numeric_id_remain_separate_cells(self):
        rows = [record("256", band="LTE 800"), record("256", band="NR 700")]
        result, _ = self.run_sync([], rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0]["cells"]), 2)

    def test_unambiguous_gsm_lac_change_keeps_identity(self):
        result, report = self.run_sync([site(4)], [record(tac="200")])
        self.assertEqual(result[0]["id"], "O2-GSMWEB-4")
        self.assertEqual([c["tac"] for c in result[0]["cells"]], ["200"])
        self.assertEqual(report["retained_unverified"], [])

    def test_ambiguous_gsm_cid_does_not_reassign_legacy_cell(self):
        old = [site(4, xy=(14.4, 50.0))]
        rows = [record(tac="200"), record(xy=(14.6, 50.2), tac="300")]
        result, report = self.run_sync(old, rows)
        self.assertEqual(len(result), 3)
        legacy = next(s for s in result if s["id"] == "O2-GSMWEB-4")
        self.assertEqual(legacy["coords"], [14.4, 50.0])
        self.assertEqual(legacy["cells"][0]["tac"], "100")
        self.assertEqual(len(report["retained_unverified"]), 1)

    def test_known_cells_moving_together_correct_gps_and_keep_id(self):
        old = [site(8, cells=[cell("123"), cell("124")])]
        rows = [record("123", xy=(14.6, 50.2)), record("124", xy=(14.6, 50.2))]
        result, report = self.run_sync(old, rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "O2-GSMWEB-8")
        self.assertEqual(result[0]["coords"], [14.6, 50.2])
        self.assertEqual(len(report["corrected_coordinates"]), 1)
        self.assertGreater(report["corrected_coordinates"][0]["distance_m"], 1000)

    def test_adjacent_independent_sites_are_not_merged_by_distance(self):
        # Roughly seven metres apart: proximity alone is not station identity.
        rows = [record("123"), record("124", xy=(14.5001, 50.1))]
        result, _ = self.run_sync([], rows)
        self.assertEqual(len(result), 2)
        self.assertEqual(len({s["id"] for s in result}), 2)

    def test_repeated_source_row_is_removed_once(self):
        row = record()
        result, report = self.run_sync([], [row, copy.deepcopy(row)])
        self.assertEqual(len(result[0]["cells"]), 1)
        self.assertEqual(report["duplicate_source_rows_removed"], 1)

    def test_same_source_cell_at_conflicting_coordinates_fails(self):
        with self.assertRaisesRegex(ValueError, "multiple GPS"):
            self.run_sync([], [record(), record(xy=(14.6, 50.2))])

    def test_unverified_legacy_site_and_metadata_are_retained(self):
        old = [site(5, xy=(14.2, 50.0), note="Keep this")]
        result, report = self.run_sync(old, [record("999")])
        legacy = next(s for s in result if s["id"] == "O2-GSMWEB-5")
        self.assertEqual(legacy, old[0])
        self.assertEqual(report["retained_unverified"][0]["cells_without_current_gps"], 1)

    def test_repeat_import_is_idempotent_including_retained_cells(self):
        old = [site(2, cells=[cell("123"), cell("legacy", full_cid="456")])]
        rows = [record("123"), record("999", xy=(14.6, 50.2))]
        first, _ = self.run_sync(old, rows)
        second, report = self.run_sync(first, rows)
        self.assertEqual(second, first)
        self.assertEqual(report["added_sites"], [])
        self.assertEqual(report["corrected_coordinates"], [])


class SourceTests(unittest.TestCase):
    def test_truncated_gps_table_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path, html_path = self.source_files(directory)
            html_path.write_text(gps_html().split("</table>", 1)[0], encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Incomplete GPS result table"):
                sync.read_source(csv_path, html_path, gsm=True)

    def test_parser_accepts_both_numbered_and_unnumbered_rows(self):
        for gsm in [True, False]:
            parsed = []
            for numbered in [False, True]:
                parser = sync.GpsTableParser(gsm)
                parser.feed(gps_html(gsm=gsm, numbered=numbered))
                parser.close()
                self.assertEqual(len(parser.rows), 1)
                parsed.append(parser.rows)
            self.assertEqual(*parsed)
            self.assertEqual(parsed[0][0]["coords"], [14.5, 50.1])

    def source_files(self, directory, *, gsm=True, date="5.11.2026", name="Praha, zkušební stanoviště", cid="123"):
        csv_path, html_path = Path(directory) / "source.csv", Path(directory) / "gps.html"
        fields = (["CID", "Datum", "Umisteni"] if gsm else
                  ["CellID", "Datum", "Umisteni", "GSMCID"])
        row = {fields[0]: cid, "Datum": date, "Umisteni": name}
        if not gsm:
            row["GSMCID"] = "4321"
        with csv_path.open("w", encoding="cp1250", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, delimiter=";")
            writer.writeheader()
            writer.writerow(row)
        html_path.write_text(gps_html(gsm=gsm), encoding="utf-8")
        return csv_path, html_path

    def test_csv_cp1250_and_html_utf8_are_joined_by_cell_id(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.source_files(directory, gsm=False)
            rows, stats = sync.read_source(*paths, gsm=False)
        self.assertEqual(rows[0]["cell"]["gsmcid"], "4321")
        self.assertEqual(rows[0]["name"], "Praha, zkušební stanoviště")
        self.assertEqual(stats, {"csv_rows": 1, "gps_rows": 1, "csv_without_gps": []})

    def test_csv_html_date_or_name_mismatch_fails(self):
        for changes in [{"date": "4.11.2026"}, {"name": "Jiná lokalita"}]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                paths = self.source_files(directory, **changes)
                with self.assertRaisesRegex(ValueError, "snapshot mismatch"):
                    sync.read_source(*paths, gsm=True)

    def test_html_cell_missing_from_csv_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.source_files(directory, cid="999")
            with self.assertRaisesRegex(ValueError, "missing from CSV"):
                sync.read_source(*paths, gsm=True)


if __name__ == "__main__":
    unittest.main()
