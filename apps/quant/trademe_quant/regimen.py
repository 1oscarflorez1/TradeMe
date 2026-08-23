"""¿Significa el régimen lo que dice significar? Auditoría de coherencia.

Lo que el diseño declara
-------------------------
`ensemble.yaml` documenta la conmutación por régimen así: *«En tendencia sube tendencia/momentum;
en rango, reversión»*. Y la config base lo cumple — en régimen de tendencia, `trend: 1.5,
momentum: 1.5, reversion: 0.6`.

Lo que Optuna publica
----------------------
El espacio de búsqueda del optimizador propone cada peso de régimen con
`trial.suggest_float(..., 0.0, 2.0)`, **sin restricción de orden ninguna**. Nada impide que la
reversión pese más que la tendencia en régimen de tendencia, y es exactamente lo que pasa.

Medido el 23 de agosto de 2026 sobre las quince configuraciones publicadas en
`artifacts/optimized/`: **once tienen la conmutación invertida** en uno de los dos regímenes o en
los dos. Solo la config base y cuatro optimizadas la respetan.

    en régimen TENDENCIA, con la reversión por encima de tendencia y momentum:
      SOLUSDT:15m   dominante 0.50  ·  reversion 1.99   ->  3,98x
      SOLUSDT:1d    dominante 0.58  ·  reversion 1.23   ->  2,12x
      BTCUSDT:30m   dominante 0.68  ·  reversion 1.32   ->  1,95x

    en régimen RANGO, con la tendencia por encima de la reversión:
      SOLUSDT:1d    reversion 0.05  ·  tendencia 1.23   ->  26,2x
      ETHUSDT:15m   reversion 0.61  ·  tendencia 1.53   ->  2,51x

**Ojo con cómo se cuenta**, porque es fácil equivocarse: en régimen de tendencia dominan DOS
familias, tendencia y momentum, y basta con que una mande. Mirar solo `trend` e ignorar `momentum`
infla el recuento — `BNBUSDT:1h` tiene `trend 0.15` pero `momentum 1.69`, así que su bloque de
tendencia es coherente; su inversión está en el de rango.

Por qué importa, más allá del rendimiento
------------------------------------------
**La etiqueta miente.** Cada decisión guarda `regime_label`, que se muestra en el panel y en los
registros. Cuando dice «tendencia» y los pesos aplicados son de reversión, ese registro está
describiendo algo que no ocurrió. Es el mismo problema que los umbrales decorativos: un nombre que
dejó de corresponderse con el mecanismo, sin que nadie lo vigilara.

Y encaja con lo medido en `docs/habilidad-direccional.md`: en régimen de tendencia, los cortos de la
plataforma dan **−0,563 R** y se emiten con `supertrend` en **+0,661** — es decir, contra la
tendencia que sus propios indicadores de tendencia están señalando.

Lo que este módulo NO hace
---------------------------
No corrige nada ni bloquea promociones. Restringir el espacio de búsqueda de Optuna cambiaría lo que
la plataforma opera, y esa es una decisión de diseño con consecuencias en producción. Aquí solo se
detecta y se avisa, que es lo que faltaba: el optimizador llevaba semanas invirtiendo la semántica
del régimen sin que nada lo señalara.

Una salvedad honesta sobre la interpretación
---------------------------------------------
Que 12 de 15 configuraciones estén invertidas es un **hecho**. Que eso *cause* los cortos malos es
una hipótesis razonable pero **no demostrada**: solo cinco claves tienen suficientes cortos en
régimen de tendencia para medirlo, y con esa muestra la correlación (r = −0,405) no dice nada. El
argumento que sí se sostiene sin estadística es el de la etiqueta: diga lo que diga el rendimiento,
`regime_label` debería describir el mecanismo que se aplicó.
"""

from __future__ import annotations

from typing import Any, NamedTuple

#: Qué familia debe dominar en cada régimen, según lo que el propio `ensemble.yaml` declara.
DOMINANTES = {"trend": ("trend", "momentum"), "range": ("reversion",)}
#: La otra familia, la que debe quedar por debajo.
SUBORDINADAS = {"trend": ("reversion",), "range": ("trend",)}


class Hallazgo(NamedTuple):
    regimen: str
    dominante: float
    subordinada: float

    @property
    def ratio(self) -> float:
        """Cuántas veces pesa más la subordinada que la dominante. > 1 es una inversión."""
        return self.subordinada / self.dominante if self.dominante > 0 else float("inf")


class Diagnostico(NamedTuple):
    coherente: bool
    hallazgos: list[Hallazgo]

    def resumen(self) -> str:
        if self.coherente:
            return "coherente"
        # Dos decimales y no uno: hay inversiones de 1,04x, y «pesa 1.0x» junto a «INVERTIDA»
        # se lee como una contradicción en vez de como lo que es, un caso al límite.
        return " · ".join(
            f"{h.regimen}: la subordinada pesa {h.ratio:.2f}x" for h in self.hallazgos
        )


def _peso(bloque: dict[str, Any], claves: tuple[str, ...]) -> float:
    """El mayor de los pesos de una familia. El mayor y no la media: basta con que uno domine."""
    valores = [float(bloque.get(k, 0.0) or 0.0) for k in claves]
    return max(valores) if valores else 0.0


def auditar(cfg: dict[str, Any]) -> Diagnostico:
    """¿Respeta esta configuración la semántica que el régimen declara?

    En `trend` deben dominar tendencia y momentum; en `range`, la reversión. Se compara el mayor
    peso de la familia que debe dominar contra el mayor de la que debe quedar por debajo: basta con
    que una de las dominantes mande para que la conmutación tenga el sentido declarado.

    Sin bloque `regime` no hay nada que auditar y se devuelve coherente — un artefacto incompleto no
    es una inversión, y fabricar una alarma con eso sería ruido.
    """
    regime = cfg.get("regime") or {}
    hallazgos: list[Hallazgo] = []
    for reg, dominantes in DOMINANTES.items():
        bloque = regime.get(reg)
        if not isinstance(bloque, dict):
            continue
        dom = _peso(bloque, dominantes)
        sub = _peso(bloque, SUBORDINADAS[reg])
        if sub > dom:
            hallazgos.append(Hallazgo(regimen=reg, dominante=dom, subordinada=sub))
    return Diagnostico(coherente=not hallazgos, hallazgos=hallazgos)
