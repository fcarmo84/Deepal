#!/usr/bin/env python3
"""Atualiza data/pt-stations.json com os postos rápidos DC (CCS) de Portugal.

Fonte: dados oficiais NAP MOBI.E, tal como publicados semanalmente pelo projeto
nap-dashboard (https://github.com/CarregaErvilhas/nap-dashboard,
https://nap.ocarroeletrico.com/), que os embute no seu dashboard.html.

Uso:  python3 scripts/update_pt.py [ficheiro_dashboard.html [ficheiro_tarifas.csv]]
Sem argumento, descarrega o dashboard.html mais recente do GitHub.
Se algo falhar, o ficheiro existente fica intacto (sai com erro).
"""
import csv
import io
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

SOURCES = [
    "https://raw.githubusercontent.com/CarregaErvilhas/nap-dashboard/main/dashboard.html",
    "https://nap.ocarroeletrico.com/",
]
OUT = Path(__file__).resolve().parent.parent / "data" / "pt-stations.json"
# Tarifário oficial dos operadores (OPC), publicado pela MOBI.E. URL que aponta sempre para a versão atual.
TARIFFS_URL = "https://www.mobie.pt/documents/42032/106470/Tarifas"
DROP_STATUS = {"planned", "blocked", "inoperative"}


def fetch_html():
    last = None
    for url in SOURCES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "deepal-carga/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                html = r.read().decode("utf-8")
            if '"sites": [' in html:
                return html, url
            last = f"{url}: sem dados de postos"
        except Exception as e:  # noqa: BLE001
            last = f"{url}: {e}"
    raise SystemExit(f"Não consegui obter os dados: {last}")


def extract_sites(html):
    i = html.find('"sites": [{')
    if i < 0:
        raise SystemExit("Formato inesperado: lista de postos não encontrada")
    j = i + len('"sites": ')
    depth = 0
    in_str = False
    esc = False
    for k in range(j, len(html)):
        ch = html[k]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return json.loads(html[j:k + 1])
    raise SystemExit("Formato inesperado: lista de postos incompleta")


def parse_num(s):
    m = re.search(r"[\d]+(?:[.,]\d+)?", str(s or ""))
    return float(m.group(0).replace(",", ".")) if m else None


def load_tariffs(path=None):
    """Lê o tarifário OPC da MOBI.E e devolve {id_do_posto: [€/kWh, €/min, €/carregamento]}.

    Para cada posto escolhe a tomada de maior potência (a rápida) e, se houver vários
    tarifários, o REGULAR. Valores sem IVA, como publicados. Devolve {} se falhar.
    """
    try:
        if path:
            raw = Path(path).read_bytes()
        else:
            req = urllib.request.Request(TARIFFS_URL, headers={"User-Agent": "deepal-carga/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
        text = raw.decode("utf-8-sig", errors="replace")
        if "UID_TOMADA" not in text.splitlines()[0]:
            print("Aviso: o tarifário MOBI.E não tem o formato esperado; mantenho os preços anteriores")
            return {}
        rows = list(csv.DictReader(io.StringIO(text), delimiter=";"))
    except Exception as e:  # noqa: BLE001
        print(f"Aviso: não consegui ler o tarifário MOBI.E ({e}); mantenho os preços anteriores")
        return {}
    # agrupar por (posto, tomada, tarifário)
    sockets = {}
    for r in rows:
        site = (r.get("ID") or "").strip()
        uid = (r.get("UID_TOMADA") or "").strip()
        if not site or not uid:
            continue
        key = (site, uid, (r.get("TIPO_TARIFARIO") or "").strip().upper())
        s = sockets.setdefault(key, {"kw": parse_num(r.get("POTENCIA_TOMADA")) or 0, "ENERGY": 0.0, "TIME": 0.0, "FLAT": 0.0})
        kind = (r.get("TIPO_TARIFA") or "").strip().upper()
        val = parse_num(r.get("TARIFA"))
        if val is None or kind not in ("ENERGY", "TIME", "FLAT"):
            continue
        unit = str(r.get("TARIFA") or "").lower()
        if kind == "TIME" and ("/h" in unit and "min" not in unit):
            val = val / 60  # €/h -> €/min
        # se houver vários períodos, fica o mais caro (estimativa prudente)
        s[kind] = max(s[kind], val)
    best = {}
    for (site, uid, plan), s in sockets.items():
        score = (s["kw"], plan == "REGULAR")
        cur = best.get(site)
        if cur is None or score > cur[0]:
            best[site] = (score, [round(s["ENERGY"], 4), round(s["TIME"], 4), round(s["FLAT"], 4)])
    out = {k: v[1] for k, v in best.items()}
    print(f"Tarifário MOBI.E: {len(rows)} linhas, {len(out)} postos com preço")
    return out


def main():
    if len(sys.argv) > 1:
        html, src = Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1]
    else:
        html, src = fetch_html()
    sites = extract_sites(html)
    tariffs = load_tariffs(sys.argv[2] if len(sys.argv) > 2 else None)
    if len(tariffs) < 500 and OUT.exists():
        # mantém os preços da última atualização boa
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
            tariffs = {r[0]: r[10] for r in old.get("sites", []) if len(r) > 10 and r[10]}
            print(f"Uso os preços anteriores ({len(tariffs)} postos, de {old.get('tariffs_updated', '?')})")
            tariffs_date = old.get("tariffs_updated")
        except Exception:  # noqa: BLE001
            tariffs, tariffs_date = {}, None
    else:
        tariffs_date = date.today().isoformat()
    rows = []
    for s in sites:
        pw = s.get("pw") or ""
        conns = s.get("conns") or []
        if "DC" not in pw or not any("CCS" in c for c in conns):
            continue
        if s.get("status") in DROP_STATUS:
            continue
        if s.get("lat") is None or s.get("lon") is None:
            continue
        lat, lon = float(s["lat"]), float(s["lon"])
        if not (32.0 <= lat <= 42.3 and -31.5 <= lon <= -6.1):
            continue  # coordenadas fora de Portugal (erro na fonte)
        kw = float(s.get("kw") or 0)
        if kw < 30:
            continue
        op = s.get("op") or ""
        rows.append([
            s.get("ext") or "",
            (s.get("name") or "").replace("Atlante - ", ""),
            s.get("city") or "",
            op,
            1 if "tlante" in op else 0,
            kw,
            int(s.get("npts") or 1),
            s.get("status") or "unknown",
            round(float(s["lat"]), 5),
            round(float(s["lon"]), 5),
            tariffs.get(s.get("ext") or ""),
        ])
    if len(rows) < 500:
        raise SystemExit(f"Só {len(rows)} postos; algo está errado na fonte, ficheiro mantido")
    rows.sort(key=lambda r: r[0])
    out = {
        "updated": date.today().isoformat(),
        "source": "NAP MOBI.E via nap-dashboard (nap.ocarroeletrico.com)",
        "tariffs_updated": tariffs_date,
        "tariffs_source": "Tarifário OPC MOBI.E (€ sem IVA): [€/kWh, €/min, €/carregamento]",
        "fields": ["id", "name", "city", "operator", "atlante", "kw", "points", "status", "lat", "lon", "opc"],
        "sites": rows,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} postos DC escritos em {OUT} (fonte: {src})")


if __name__ == "__main__":
    main()
