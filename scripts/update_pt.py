#!/usr/bin/env python3
"""Atualiza data/pt-stations.json com os postos rápidos DC (CCS) de Portugal.

Fonte: dados oficiais NAP MOBI.E, tal como publicados semanalmente pelo projeto
nap-dashboard (https://github.com/CarregaErvilhas/nap-dashboard,
https://nap.ocarroeletrico.com/), que os embute no seu dashboard.html.

Uso:  python3 scripts/update_pt.py [ficheiro_dashboard.html]
Sem argumento, descarrega o dashboard.html mais recente do GitHub.
Se algo falhar, o ficheiro existente fica intacto (sai com erro).
"""
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

SOURCES = [
    "https://raw.githubusercontent.com/CarregaErvilhas/nap-dashboard/main/dashboard.html",
    "https://nap.ocarroeletrico.com/",
]
OUT = Path(__file__).resolve().parent.parent / "data" / "pt-stations.json"
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


def main():
    if len(sys.argv) > 1:
        html, src = Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1]
    else:
        html, src = fetch_html()
    sites = extract_sites(html)
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
        ])
    if len(rows) < 500:
        raise SystemExit(f"Só {len(rows)} postos; algo está errado na fonte, ficheiro mantido")
    rows.sort(key=lambda r: r[0])
    out = {
        "updated": date.today().isoformat(),
        "source": "NAP MOBI.E via nap-dashboard (nap.ocarroeletrico.com)",
        "fields": ["id", "name", "city", "operator", "atlante", "kw", "points", "status", "lat", "lon"],
        "sites": rows,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} postos DC escritos em {OUT} (fonte: {src})")


if __name__ == "__main__":
    main()
