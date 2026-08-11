"""Convierte el volcado del Google Sheet del catalogo en data/productos.json y .csv.

Uso: python scripts/importar_catalogo.py <ruta-al-dump-json>
El dump es el JSON {fileContent: "<tabla markdown>"} que devuelve el MCP de Google Drive
al leer la hoja (ID 1_MWGg2QeTvD4UoT9pTX5MmGqWXU2T84QC_Pj-Z95o9U). Para refrescar el
catalogo: volver a leer la hoja por MCP y re-ejecutar este script con el archivo nuevo.
"""
import csv
import html
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "data"

COLUMNAS = ["sku", "nombre", "descripcion_corta", "descripcion",
            "slug", "meta_descripcion", "precio", "precio_regular"]

MARCAS = [
    "DEWALT", "STANLEY", "BLACK+DECKER", "BLACK&DECKER", "BOSCH", "MAKITA", "HUSQVARNA",
    "STIHL", "HONDA", "DUCATI", "ROYAL CONDOR", "KARCHER", "TRUPER", "IRWIN", "3M",
    "LINCOLN", "FORTE", "MASTER", "TOTAL", "INGCO", "EVANS", "BARNES", "PEDROLLO",
    "HIDEA", "TECHTOP", "DREMEL", "TRAPP", "ESYBOX", "KAMA", "WOLFOX", "ALTERMAN",
    "KTC", "ECOMAX", "TOYAMA", "CIFARELLI", "MARUYAMA", "SOLO", "JACTO", "GOLDEX",
    "YORKING", "ECOHORSE", "ATLAS COPCO", "POWERIN", "ECOFLOW", "PENAGOS", "FARETTY",
    "PEARL", "CALPEDA", "MASALTA", "HYUNDAI",
]


def limpiar_celda(texto: str) -> str:
    """Quita los escapes del volcado markdown y reconstruye el HTML/texto original."""
    texto = texto.replace("\\|", "|")
    texto = re.sub(r"\\(.)", r"\1", texto)  # \< \> \& \# etc.
    texto = html.unescape(texto)
    return texto.strip()


def precio(texto: str):
    digitos = re.sub(r"[^\d]", "", texto)
    return int(digitos) if digitos else None


def marca_de(nombre: str) -> str:
    plano = nombre.upper().replace("\\", "").replace("&DECKER", "+DECKER")
    for m in MARCAS:
        if m.replace("&", "+") in plano or m in plano:
            return "BLACK+DECKER" if m.startswith("BLACK") else m
    return ""


def filas_de(dump: Path):
    contenido = json.loads(dump.read_text(encoding="utf-8"))["fileContent"]
    for linea in contenido.split("\n"):
        if not linea.startswith("|"):
            continue
        # separar por pipes no escapados
        celdas = re.split(r"(?<!\\)\|", linea)[1:-1]
        celdas = [limpiar_celda(c) for c in celdas]
        if len(celdas) < 8 or celdas[0] in ("", "SKU") or set(celdas[:8]) <= {":-:", ""}:
            continue
        yield celdas


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("uso: python scripts/importar_catalogo.py <ruta-al-dump-json>")
    dump = Path(sys.argv[1])

    productos, sin_precio, skus = [], [], set()
    for celdas in filas_de(dump):
        p = dict(zip(COLUMNAS, celdas[:8]))
        p["precio"] = precio(p["precio"])
        p["precio_regular"] = precio(p["precio_regular"])
        p["marca"] = marca_de(p["nombre"])
        if p["sku"] in skus:
            print(f"AVISO sku duplicado, se omite: {p['sku']}")
            continue
        skus.add(p["sku"])
        if p["precio"] is None:
            sin_precio.append(p["sku"])
        productos.append(p)

    SALIDA.mkdir(exist_ok=True)
    (SALIDA / "productos.json").write_text(
        json.dumps(productos, ensure_ascii=False, indent=2), encoding="utf-8")

    with (SALIDA / "productos.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNAS + ["marca"])
        w.writeheader()
        w.writerows(productos)

    marcas = {}
    for p in productos:
        marcas[p["marca"] or "(sin marca detectada)"] = marcas.get(p["marca"] or "(sin marca detectada)", 0) + 1
    print(f"{len(productos)} productos -> data/productos.json y data/productos.csv")
    print("marcas:", dict(sorted(marcas.items(), key=lambda kv: -kv[1])))
    if sin_precio:
        print(f"sin precio ({len(sin_precio)}):", ", ".join(sin_precio))


if __name__ == "__main__":
    main()
