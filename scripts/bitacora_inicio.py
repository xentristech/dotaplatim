"""Briefing de arranque de sesion (hook SessionStart) — proyecto dotaplatim.

Lo llama Claude Code solo al abrir la ventana. Arma el contexto (donde quedamos, quien
estuvo antes, procedencia de la conexion) y se lo inyecta al modelo junto con la
instruccion de presentarse y pedir identificacion antes de trabajar. El procedimiento
completo vive en el skill `xentris-bitacora`.

Imprime JSON en stdout con hookSpecificOutput.additionalContext. Si algo falla imprime un
objeto vacio: un hook roto no debe impedir que arranque la sesion.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# La salida del hook va a una consola de Windows en cp1252. La nota de continuidad trae
# flechas y comillas tipograficas, y sin esto el print revienta con UnicodeEncodeError: el
# hook imprime "{}" y parece que funciono. Se arregla en las dos puntas: stdout en UTF-8 y
# el JSON escapado a ASCII puro (ensure_ascii=True), que cualquier lector reconstruye bien.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001 - en un stdout raro seguimos con lo que haya
    pass

RAIZ = Path(__file__).resolve().parents[1]
TAILSCALE = Path(r"C:\Program Files\Tailscale\tailscale.exe")
BITACORA = RAIZ / "docs" / "bitacora"
SESIONES = BITACORA / "sesiones.jsonl"
ORDENES = BITACORA / "ordenes.jsonl"
NOTA = (
    Path.home() / ".claude" / "projects"
    / "C--Users-xentr-proyectos-dotaplatim" / "memory"
    / "sesion-donde-quedamos.md"
)


def leer_jsonl(ruta: Path, n: int) -> list:
    if not ruta.exists():
        return []
    lineas = ruta.read_text(encoding="utf-8", errors="replace").strip().splitlines()
    salida = []
    for linea in lineas[-n:]:
        try:
            salida.append(json.loads(linea))
        except Exception:  # noqa: BLE001 - una linea corrupta no tumba el briefing
            continue
    return list(reversed(salida))


def donde_quedamos() -> str:
    if not NOTA.exists():
        return "(no hay nota de continuidad todavia)"
    texto = NOTA.read_text(encoding="utf-8", errors="replace")
    cuerpo = texto.split("---", 2)[-1].strip()  # saltar el frontmatter
    return cuerpo[:1800]


def ultima_conexion() -> str:
    conexiones = leer_jsonl(SESIONES, 1)
    if not conexiones:
        return "Es la primera conexion registrada."
    ult = conexiones[0]
    return (f"Ultima conexion: {ult.get('quien', '?')} el {ult.get('ts', '?')}"
            f" — {ult.get('proposito', 'sin proposito anotado')}")


def ultimas_ordenes() -> str:
    ordenes = leer_jsonl(ORDENES, 3)
    if not ordenes:
        return "   (sin ordenes registradas todavia)"
    return "\n".join(f"   [{o.get('ts', '?')[:16]}] {o.get('texto', '')[:110]}" for o in ordenes)


def procedencia() -> dict:
    """De donde entra quien esta usando el agente.

    Identifica el EQUIPO, no a la persona: si los nodos de la tailnet pertenecen a una sola
    cuenta de Tailscale, el nodo dice desde que maquina se conectan, no quien es.
    """
    d = {
        "usuario_windows": os.environ.get("USERNAME", "?"),
        "equipo": os.environ.get("COMPUTERNAME", "?"),
        "sesion_windows": os.environ.get("SESSIONNAME", "?"),
        "cliente_rdp": os.environ.get("CLIENTNAME") or None,
    }
    d["remota"] = bool(d["cliente_rdp"]) or d["sesion_windows"].upper().startswith("RDP")

    if TAILSCALE.exists():
        try:
            salida = subprocess.run(
                [str(TAILSCALE), "status"], capture_output=True, text=True, timeout=8
            ).stdout
            cliente = (d["cliente_rdp"] or "").lower()
            for linea in salida.splitlines():
                campos = linea.split()
                if len(campos) < 4 or "active" not in linea:
                    continue
                if cliente and campos[1].lower() != cliente:
                    continue
                d["nodo_tailscale"] = campos[1]
                d["cuenta_tailscale"] = campos[2]
                ip = re.search(r"direct (\d+\.\d+\.\d+\.\d+):", linea)
                if ip:
                    d["ip_publica"] = ip.group(1)
                break
        except Exception:  # noqa: BLE001 - sin Tailscale seguimos con lo local
            pass
    return d


def describir(p: dict) -> str:
    if not p["remota"]:
        return f"Conexion LOCAL en el equipo {p['equipo']} (usuario Windows: {p['usuario_windows']})."
    partes = [f"Conexion REMOTA por Escritorio Remoto hacia {p['equipo']}",
              f"desde la maquina '{p['cliente_rdp'] or '?'}'"]
    if p.get("ip_publica"):
        partes.append(f"con IP publica {p['ip_publica']}")
    if p.get("cuenta_tailscale"):
        partes.append(f"por Tailscale, cuenta {p['cuenta_tailscale']}")
    return " ".join(partes) + "."


def main() -> None:
    proc = procedencia()
    contexto = f"""
=== ARRANQUE DE SESION — DOTAPLATIM (PLATIM / Dotaindustria Platim) ===
Fecha y hora local: {datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')}

--- Quien estuvo antes ---
Procedencia de esta conexion: {describir(proc)}
{ultima_conexion()}
Ultimas ordenes registradas:
{ultimas_ordenes()}

--- Donde quedamos (nota de continuidad) ---
{donde_quedamos()}

--- QUE DEBES HACER AHORA, ANTES DE CUALQUIER OTRA COSA ---
Sigue el skill `xentris-bitacora` (invocalo con la herramienta Skill). En resumen:
1. Presentate en una linea: quien eres, sobre que proyecto trabajas y con que modelo.
2. Da el estado en 3-5 lineas a partir de la nota de continuidad de arriba y cierra con el
   proximo paso concreto, no con una lista.
3. Pregunta con AskUserQuestion quien se esta conectando (socios Xentris: Orlando Polanco,
   Natalia Turizo, Maykol Osorio, Leidy Quiroga; o "otro") y para que entra hoy. Menciona de
   donde detectaste la conexion (linea "Procedencia") — si el equipo no cuadra con la
   persona que dice ser, dilo.
4. Registra la respuesta en docs/bitacora/sesiones.jsonl, incluyendo el bloque de
   procedencia que va abajo tal cual, y confirma en una linea que quedo anotada.
5. Antes de cerrar el turno, si el estado cambio, actualiza la nota de continuidad
   (sesion-donde-quedamos.md en la memoria del proyecto).

--- PROCEDENCIA (copiar tal cual en la entrada del log) ---
{json.dumps(proc, ensure_ascii=False)}
No empieces trabajo tecnico hasta que la persona se identifique, salvo que ella pida algo
concreto de entrada — en ese caso atiendelo y pide la identificacion despues, sin bloquear.
""".strip()

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": contexto,
        }
    }, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        print("{}")
    sys.exit(0)
