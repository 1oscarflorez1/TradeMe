"""Series macro externas: descarga, persistencia y **alineación sin mirar al futuro**.

No confundir con `macro.py`, que es el espejo de paridad del sesgo macro por funding. Esto es otra
cosa: traer el dólar y la volatilidad implícita de fuera y emparejarlos con las velas de cripto.

Lo que hay y lo que no
-----------------------
Los índices `DXY` y `VIX` **no existen en el plan gratuito de Twelve Data**: devuelven 404 y no
aparecen en su búsqueda de símbolos. Lo que sí hay son sus réplicas cotizadas:

- ``UUP`` — Invesco DB US Dollar Index (NYSE). 4.911 sesiones desde 2007, sin saltos anómalos.
  Réplica fiel del DXY salvo comisión y roll.
- ``VXX`` — futuros del VIX a corto plazo (CBOE). 2.165 sesiones desde 2018.

La reserva de VXX no es menor: su cierre pasa de 1.770 a 17,72 entre 2018 y 2026 —un 99 % de
decaimiento— porque mantener futuros de volatilidad cuesta dinero. **El nivel de VXX no es el nivel
del VIX.** Sus *variaciones* sí siguen a las del VIX: sus cinco saltos de más del 25 % en un día son
Volmageddon, el COVID, junio de 2020, Ómicron y el desarme del carry del yen. Por eso el vector de
estrés mide cambios y nunca niveles — si midiera niveles, estaría midiendo el paso del tiempo.

El problema de verdad: dos mercados con horarios distintos
-----------------------------------------------------------
UUP y VXX cotizan unas seis horas y media, de lunes a viernes. El cripto opera 24/7. Emparejarlos
exige decidir **qué sabía uno del otro en cada momento**, y ahí se cuela el look-ahead más fácil de
cometer: usar el cierre del día D en una vela que empezó ese mismo día.

La regla es deliberadamente conservadora: **la sesión del día D está disponible a partir de las
00:00 UTC del día D+1**. El cierre real es a las 16:00 de Nueva York —20:00 o 21:00 UTC según el
horario de verano—, así que esperar al cambio de día sobra de margen y ahorra razonar sobre husos,
que es justo donde se cometen estos errores.

Sin dato fresco se **arrastra el último conocido**, que es literalmente lo que tiene delante quien
opera un domingo. No se interpola: interpolar inventaría sesiones que no existieron, el mismo motivo
por el que el relleno de huecos solo toca símbolos de Binance.

Medido sobre el calendario real de UUP, la antigüedad del dato macro en una vela de 1d es de 1 día
el 68,9 % de las veces, 2 días el 15,0 %, 3 días el 14,3 % y 4–5 días el 1,8 %. Media de **1,49
días**. Sobre una ventana de veinte sesiones el desfase es ruido; conviene saberlo igualmente,
porque es la diferencia entre un vector macro y uno de precio.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

#: Réplicas cotizadas de los dos índices que no publica el plan gratuito.
PROXIES: dict[str, str] = {"UUP": "dolar", "VXX": "volatilidad"}

#: Un día natural en milisegundos. La sesión de D se declara disponible en D+1 a las 00:00 UTC.
DIA_MS = 86_400_000

#: Twelve Data reparte 8 créditos por minuto en el plan gratuito. Con dos símbolos sobra esperar.
ESPERA_ENTRE_PETICIONES_S = 9.0

#: Nombre del fichero en `artifacts/`. Se descarga una vez y el estudio lo relee.
FICHERO = "macro_series.json"

Serie = list[tuple[str, float]]


def _clave() -> str:
    clave = os.environ.get("TWELVEDATA_API_KEY", "").strip()
    if not clave:
        raise RuntimeError(
            "falta TWELVEDATA_API_KEY: las series macro vienen de Twelve Data y sin clave "
            "no hay forma de traerlas"
        )
    return clave


def descargar(simbolos: list[str] | None = None, interval: str = "1day") -> dict[str, Serie]:
    """Trae los cierres diarios de cada proxy. Una petición por símbolo, un crédito cada una.

    Devuelve `{simbolo: [(fecha ISO, cierre), ...]}` en orden ascendente. Los errores del proveedor
    se propagan **sin el cuerpo de la respuesta**: Twelve Data repite la URL completa en sus
    mensajes de error, y ahí viaja la clave.
    """
    clave = _clave()
    fuera: dict[str, Serie] = {}
    for i, simbolo in enumerate(simbolos or list(PROXIES)):
        if i:
            time.sleep(ESPERA_ENTRE_PETICIONES_S)
        url = "https://api.twelvedata.com/time_series?" + urllib.parse.urlencode(
            {
                "symbol": simbolo,
                "interval": interval,
                "outputsize": 5000,
                "order": "ASC",
                "apikey": clave,
            }
        )
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                datos: dict[str, Any] = json.loads(resp.read().decode())
        except Exception as err:  # noqa: BLE001 - se enmascara antes de dejarlo salir
            raise RuntimeError(f"Twelve Data falló con {simbolo}: {type(err).__name__}") from None
        valores = datos.get("values")
        if not valores:
            raise RuntimeError(f"Twelve Data no devolvió velas de {simbolo}")
        fuera[simbolo] = [(str(v["datetime"]), float(v["close"])) for v in valores]
    return fuera


def guardar(series: dict[str, Serie], destino: Path) -> Path:
    """Escribe las series en `artifacts/` para que el estudio no dependa de la red ni del cupo."""
    fichero = destino / FICHERO
    fichero.write_text(
        json.dumps(
            {"descargado": dt.datetime.now(dt.UTC).isoformat(), "series": series},
            indent=1,
        ),
        encoding="utf8",
    )
    return fichero


def cargar(origen: Path) -> dict[str, Serie]:
    """Relee lo guardado. Falla claro si no está: no hay valor por defecto que valga aquí."""
    fichero = origen / FICHERO
    if not fichero.exists():
        raise FileNotFoundError(
            f"no está {fichero}. Ejecuta antes `python -m trademe_quant.descargar_macro`"
        )
    crudo = json.loads(fichero.read_text(encoding="utf8"))
    return {k: [(str(f), float(c)) for f, c in v] for k, v in crudo["series"].items()}


def disponible_desde(fecha_iso: str) -> int:
    """Milisegundos UTC desde los que la sesión de esa fecha se considera conocida.

    Es el 00:00 UTC del día **siguiente**. El porqué está en la cabecera del módulo: el cierre real
    ocurre horas antes, y regalar ese margen sale más barato que equivocarse de huso horario.
    """
    dia = dt.date.fromisoformat(fecha_iso[:10])
    inicio = dt.datetime.combine(dia, dt.time.min, tzinfo=dt.UTC)
    return int(inicio.timestamp() * 1000) + DIA_MS


def alinear(aperturas: list[int], valores: dict[str, float]) -> dict[int, float]:
    """Empareja cada vela con el último valor macro **ya conocido** cuando esa vela empezó.

    `aperturas` son los instantes de apertura de las velas (ms UTC) en orden; `valores` mapea fecha
    ISO de sesión a valor del vector en esa sesión. Devuelve `índice de vela → valor`, que es lo que
    `alfa.evaluar_vector` espera.

    Las velas anteriores al primer dato macro **se omiten**, no valen cero: no tener dato no es
    tener un dato neutro. Es la misma decisión que toman los vectores de precio con sus ventanas
    incompletas.
    """
    calendario = sorted((disponible_desde(f), v) for f, v in valores.items())
    if not calendario:
        return {}

    fuera: dict[int, float] = {}
    j = 0
    ultimo: float | None = None
    for i, t in enumerate(aperturas):
        while j < len(calendario) and calendario[j][0] <= t:
            ultimo = calendario[j][1]
            j += 1
        if ultimo is not None:
            fuera[i] = ultimo
    return fuera
