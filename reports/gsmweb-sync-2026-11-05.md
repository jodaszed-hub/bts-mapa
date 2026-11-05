# BTSmapa: kontrola souřadnic k 5. 11. 2026

Výchozí data: produkční větev `gh-pages`, commit `f1498d0e4318569beae045d80e7bc305864548db`.

| Vrstva | Původní body | Doplněné body | Opravené polohy | Body po importu |
| --- | ---: | ---: | ---: | ---: |
| O2 | 8 169 | 88 | 3 | 8 257 |
| T-Mobile | 7 063 | 75 | 2 | 7 138 |

Ze 163 doplněných bodů má 45 stejnou polohu v obou vrstvách. Jde tedy o 118 různých poloh, z nichž 15 už bylo zakresleno u druhého operátora. **103 poloh dříve nebylo v žádné vrstvě.** Poloha je porovnávána po zaokrouhlení na pět desetinných míst; výsledek je počet mapových poloh, ne počet nově postavených stožárů.

Všechny původní identifikátory lokalit zůstaly zachovány. U 26 bodů O2 a 16 bodů T-Mobile se jejich původní souřadnice v aktuálním GPS výpisu nepotvrdily. Tyto body a starší buňky bez aktuálního GPS záznamu zůstaly v mapě. Podrobné seznamy, změny poloh a otisky vstupů obsahuje [strojový report](gsmweb-sync-2026-11-05.json).

## Zdrojové soubory

CSV exporty GSMwebu mají technické údaje a názvy lokalit, souřadnice jsou v odkazech v tabulce výsledků. Import spároval řádky podle identifikátorů, zkontroloval soulad data a názvu a seskupil buňky podle souřadnic zvlášť pro každého operátora. Získal platné GPS souřadnice pro všech 195 513 buněk ze čtyř exportů.

| Síť | CSV (Windows-1250) | GPS HTML (UTF-8) |
| --- | --- | --- |
| O2 GSM | [eurotel.csv](https://gsmweb.cz/stat/eurotel.csv) | [výpis](https://gsmweb.cz/search.php?op=eurotel&par=um2&udaj=&gps=only) → `gsm-search-name.html` |
| O2 LTE/NR | [o2lte.csv](https://gsmweb.cz/stat/o2lte.csv) | [výpis](https://gsmweb.cz/search.php?op=o2lte&par=um2&udaj=&gps=only) → `o2lte-all-gps.html` |
| T-Mobile GSM | [paegas.csv](https://gsmweb.cz/stat/paegas.csv) | [výpis](https://gsmweb.cz/search.php?op=t-mobile&par=um2&udaj=&gps=only) → `t-mobile-all-gps.html` |
| T-Mobile LTE/NR | [Tlte.csv](https://gsmweb.cz/stat/Tlte.csv) | [výpis](https://gsmweb.cz/search.php?op=Tlte&par=um2&udaj=&gps=only) → `Tlte-all-gps.html` |

Oba JSON soubory z výchozí verze uložte do složky `baseline` a čtyři dvojice exportů do `sources`. Skript nejprve zkontroluje oba operátory a ověří, že opakovaný import vytvoří stejná data. Výsledek zapisuje do samostatné výstupní složky:

```sh
python3 scripts/sync_gsmweb.py --sources sources --baseline baseline --output preview --report preview/sync-report.json
python3 -m unittest discover -s tests
```
