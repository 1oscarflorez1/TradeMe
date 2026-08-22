# Gestor de Correlaciones — cuántas observaciones hay de verdad

> Fase de medición. **No toca ninguna decisión de trading**: solo corrige cuánta evidencia cree
> tener el sistema cuando juzga a sus propios componentes.

## El número que lo justifica

Medido el 21 de agosto de 2026 sobre 500 velas de 1h:

```
              BTC     ETH     SOL     BNB
BTCUSDT      1.00    0.81    0.75    0.71
ETHUSDT      0.81    1.00    0.76    0.69
SOLUSDT      0.75    0.76    1.00    0.70
BNBUSDT      0.71    0.69    0.70    1.00

  4 activos nominales  ->  1,52 efectivos
```

**Cuatro activos cripto son, en información, poco más de uno y medio.** Es el mismo hallazgo que el
de los seis votos que valían 1,41 ([independencia](independencia.md)), en otro eje.

Y corrige una afirmación optimista: al entregar el multiactivo se dijo que multiplicaba la muestra
«por cuatro». La multiplicó por **~1,5** en evidencia real. Sigue mereciendo la pena —más regímenes,
replicación entre activos, más decisiones por hora— pero el número era ingenuo.

## Por qué hacía falta antes de juzgar nada

El gobierno del [Fundamental Score](fundamental.md) exige 100 decisiones LONG cerradas antes de
promocionarlo. Su primera medición real tenía 75, y **74 eran de ETH y SOL dentro de las mismas 14
horas**. Un `n` de aspecto respetable que, en información, era poco más que una apuesta observada
muchas veces.

Sin corregirlo, el veredicto habría sido ruido con apariencia de rigor — y esta vez con poder para
promocionar un componente que cambia decisiones reales.

## Cómo se descuenta

**No** multiplicando `n` por el factor global. Eso sería excesivo: dos decisiones de ETH separadas
por una semana sí son bastante independientes, aunque ETH y BTC se muevan juntos. La correlación
entre activos solo resta cuando las decisiones son **simultáneas**.

Se agrupa por ventanas de **24 horas** —mayor que el horizonte de las temporalidades que más
disparan— y dentro de cada ventana los activos presentes cuentan como sus efectivos:

```
n_efectivo = Σ_ventana ( decisiones_en_la_ventana × k_ef(activos presentes) / k(presentes) )
```

Así el descuento castiga la **concentración**, que es el problema real, y no la diversidad temporal,
que es justo lo que se quiere premiar.

Sobre los datos reales de hoy: **75 decisiones → 38,2 observaciones efectivas**.

Se correlacionan **retornos logarítmicos**, no precios: dos series con tendencia siempre parecen ir
juntas aunque suban por motivos distintos.

## Salvaguardas

- **Suelo de 0,35**, como en `independence.py`: por muy correlacionados que estén, la muestra no se
  anula.
- **Sin medición, factor 1.** Menos de 100 velas por activo, un solo activo, o una serie plana: no
  se descuenta nada. Inventar un ajuste sin datos sería peor que no ajustar.
- **Solo endurece.** El descuento nunca puede provocar una promoción que sin él no ocurriría.
- Se publican **los dos números** (`n` y `n_efectivo`) en la evidencia del artefacto: la diferencia
  tiene que verse, no esconderse detrás de un solo valor.

## Verificado contra extremos conocidos

La lección de [analista-niveles-fase0](analista-niveles-fase0.md) fue que una métrica puede parecer
rigurosa y no medir lo que se cree. Así que hay tests contra los dos casos cuya respuesta se conoce
de antemano:

| Caso | Esperado | Comprobado |
|---|---|---|
| 4 series aleatorias independientes | ≈ 4 efectivos | > 3,3 ✔ |
| 4 copias de la misma serie | ≈ 1 efectivo | < 1,2 ✔ |
| 4 series con factor común | entre medias | 1,2–3,5 ✔ |

## Lo que NO captura

La correlación **entre temporalidades del mismo activo**. Una decisión de ETH en 15m y otra de ETH
en 1h a la misma hora son casi la misma observación, y aquí cuentan como dos. Ese solapamiento
probablemente también sea grande y queda pendiente.

Tampoco es todavía la parte «clásica» del Gestor: evitar abrir cuatro largos que en realidad son el
mismo largo. Esta medición es su cimiento.

## Operación

```bash
python -m trademe_quant.scheduler   # el piloto lo publica en cada ciclo
```

Produce `artifacts/correlaciones.json`, que consume `fundamental_policy.py`. La api no lo necesita:
esto no toca el camino de la vela.
