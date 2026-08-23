"""¿Cuántas configuraciones publicadas dicen «tendencia» y aplican reversión?

Uso: python -m trademe_quant.run_regimen_auditoria

Audita la config base y todas las que Optuna ha publicado en `artifacts/optimized/`. El método y el
porqué están en `regimen.py`; aquí solo se recorre lo que hay en disco.

No toca nada. La misma comprobación corre ya dentro del piloto automático tras cada promoción y
levanta una alerta, así que esto es para mirar el estado completo de una vez.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .ensemble import artifacts_dir
from .regimen import auditar

ANCHO = 92


def _cargar(p: Path) -> dict[str, Any]:
    try:
        with open(p, encoding="utf8") as fh:
            datos = yaml.safe_load(fh)
        return datos if isinstance(datos, dict) else {}
    except Exception:  # noqa: BLE001 - un artefacto ilegible se reporta, no tumba el informe
        return {}


def _fila(nombre: str, cfg: dict[str, Any]) -> bool:
    d = auditar(cfg)
    reg = (cfg.get("regime") or {}).get("trend") or {}
    tr = max(float(reg.get("trend", 0) or 0), float(reg.get("momentum", 0) or 0))
    rv = float(reg.get("reversion", 0) or 0)
    marca = "coherente" if d.coherente else f"INVERTIDA · {d.resumen()}"
    print(f"  {nombre:26s} trend/mom={tr:5.2f}  reversion={rv:5.2f}   {marca}")
    return d.coherente


def main() -> None:
    art = artifacts_dir()
    print("=" * ANCHO)
    print("COHERENCIA DEL RÉGIMEN · ¿significa lo que dice?")
    print("=" * ANCHO)
    print("  El diseño declara: en tendencia mandan tendencia y momentum; en rango, la reversión.")
    print("  Se muestran los pesos del bloque `trend`, que es donde aparece la inversión.")
    print("-" * ANCHO)

    base = _cargar(art / "ensemble.yaml")
    coherentes = total = 0
    if base:
        total += 1
        coherentes += 1 if _fila("(base) ensemble.yaml", base) else 0
        print("-" * ANCHO)

    for p in sorted((art / "optimized").glob("ensemble.*.yaml")):
        cfg = _cargar(p)
        if not cfg:
            print(f"  {p.name:26s} ilegible")
            continue
        total += 1
        coherentes += 1 if _fila(p.name.replace("ensemble.", "").replace(".yaml", ""), cfg) else 0

    print("-" * ANCHO)
    invertidas = total - coherentes
    print(f"  coherentes: {coherentes}/{total}   ·   INVERTIDAS: {invertidas}")
    if invertidas:
        print()
        print("  En esas claves, el `regime_label` guardado en cada decisión dice «tendencia»")
        print("  mientras el motor aplica pesos de reversión. La etiqueta no describe el")
        print("  mecanismo, y eso vale con independencia de si el rendimiento es bueno o malo.")
        print()
        print("  Corregirlo exige decidir qué se prefiere, y son cosas distintas:")
        print("    a) restringir el espacio de búsqueda de Optuna para que respete la semántica;")
        print("    b) aceptar que el optimizador mande y renombrar el régimen a lo que de verdad")
        print("       es — un par de juegos de pesos conmutados por ADX, sin promesa de sentido.")
        print("  Lo que no vale es dejarlo como está: el nombre promete algo que no se cumple.")
    print()


if __name__ == "__main__":
    main()
