"""Trae las series macro y las deja en `artifacts/`. Se ejecuta a mano, no en cada ciclo.

Uso: python -m trademe_quant.descargar_macro

Por qué a mano y no en el piloto
---------------------------------
El plan gratuito de Twelve Data da 800 créditos al día y la ingesta de producción ya compite por
ellos. Estas dos series son **diarias y de contexto**: descargarlas una vez cubre años de estudio, y
volver a pedirlas cada ciclo gastaría cupo para traer el mismo dato.

Si algún vector macro llegara a demostrar que aporta, entonces —y solo entonces— tendría sentido
meterlas en la ingesta periódica. Mientras sean candidatos, un fichero basta.
"""

from __future__ import annotations

from . import series_macro
from .ensemble import artifacts_dir


def main() -> None:
    series = series_macro.descargar()
    for simbolo, filas in series.items():
        papel = series_macro.PROXIES.get(simbolo, "?")
        print(f"  {simbolo:6} ({papel:12}) {len(filas):5} sesiones  {filas[0][0]} - {filas[-1][0]}")
    fichero = series_macro.guardar(series, artifacts_dir())
    print(f"\n  guardado en {fichero}")


if __name__ == "__main__":
    main()
