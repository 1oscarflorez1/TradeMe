"""Escritura atómica de los artefactos que lee la api.

Desde 0.73.0 la api recarga los artefactos sola: cada pocos segundos mira si han cambiado en disco
(`apps/api/src/artifacts/vigilancia.ts`). Eso abre una ventana que antes no existía, porque antes
nadie los leía mientras el piloto los escribía: `Path.write_text` trunca el fichero y lo va
llenando, y una lectura en ese intervalo ve un JSON a medias.

La api se protege por su lado —si no puede leer el fichero, conserva el estado anterior y reintenta—
pero la garantía de verdad está aquí: se escribe en un temporal del mismo directorio y se sustituye
de golpe con `os.replace`, que es atómico dentro de un mismo sistema de ficheros. Quien lea ve el
fichero entero anterior o el entero nuevo, nunca una mezcla.

El temporal empieza por punto y no acaba en `.json`: así ningún lector que liste un directorio de
artefactos —el de `fundamental/`, por ejemplo— lo confunde con uno publicado.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def escribir_atomico(ruta: str | Path, texto: str) -> Path:
    """Sustituye `ruta` por `texto` de una sola vez. Devuelve la ruta escrita."""
    destino = Path(ruta)
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporal = destino.with_name(f".{destino.name}.{os.getpid()}.tmp")
    try:
        with open(temporal, "w", encoding="utf8") as fh:
            fh.write(texto)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporal, destino)
    finally:
        if temporal.exists():
            temporal.unlink()
    return destino


def publicar_json(ruta: str | Path, datos: Any, **opciones_json: Any) -> Path:
    """`json.dumps` + `escribir_atomico`, con salto de línea final."""
    return escribir_atomico(ruta, json.dumps(datos, **opciones_json) + "\n")
