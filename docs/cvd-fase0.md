# CVD (flujo de agresores) — Fase 0

> **El CVD no aporta información sobre el desenlace** por encima de los seis votos actuales. Y por
> el camino quedó demostrado que el criterio con el que el proyecto juzgaba a estos candidatos no lo
> podía pasar ninguna variable real — ni los propios votos que ya están en producción.

## Lo que se preguntaba

Los seis votos valen **1,41 efectivos**: todos derivan del precio, así que son seis vistas de la
misma cosa. El diagnóstico del meta-modelo apunta al mismo sitio — AUC 0,4967, dentro de su nula: no
hay señal que extraer porque no hay información nueva que meter.

El *Cumulative Volume Delta* mide quién tiene la iniciativa: volumen ejecutado contra la oferta
(comprador agresivo) menos el ejecutado contra la demanda. Dos velas con el mismo cierre pueden
tener flujos opuestos, y ahí estaría la información que el OHLCV no contiene.

## El hallazgo que abarató el hito: no hacen falta `aggTrades`

Las klines de Binance ya traen el dato agregado en el campo 9, `taker buy base asset volume`:

```
delta = taker_buy − taker_sell = taker_buy − (volumen − taker_buy) = 2·taker_buy − volumen
```

**Corroborado contra los datos**, no solo por aritmética. Sumando los `aggTrades` de un minuto y
comparándolos con la kline de ese mismo minuto (BTCUSDT, 22 ago 2026, 21:58 UTC):

| | kline (campos 5 y 9) | suma de `aggTrades` |
|---|---|---|
| volumen | 1,64195000 | 1,64195000 |
| taker buy | 1,36118000 | 1,36118000 |
| **delta** | **1,08041000** | **1,08041000** |

Idénticos. La única diferencia es el conteo de operaciones (471 frente a 160), porque `aggTrades`
agrega las consecutivas al mismo precio y lado. **El CVD desde klines es el CVD, no una
aproximación.**

| | `aggTrades` | Campo 9 de klines |
|---|---|---|
| Peticiones (90 días × 4 activos) | ~250.000 | **~520** |
| ¿Backtesteable? | **No** | **Sí** |

Lo segundo importa más que lo primero. El *order book imbalance* se descartó precisamente porque el
backtest solo consume `fetch_klines`/OHLCV; el CVD llega por ese mismo camino. Por eso se invirtió
el orden del hito: **medir primero, y construir el proveedor solo si pasaba**.

## Las tres reglas

1. **Aportación de información sobre el desenlace** — global.
2. **Correlación con los seis votos < 0,50** — por temporalidad.
3. **Expectancy por tercil**, LONG y SHORT por separado, con Bonferroni.

Y dos métricas candidatas declaradas en `flow.py` antes de calcular nada: `cvd_z` (presión
acumulada, estandarizada) y `divergencia` (el z del CVD menos el z del retorno de precio).

## Por qué la regla 1 tuvo que cambiar a mitad del hito

La versión original de la regla 1 era la heredada del Analista de Niveles: **superar el percentil 95
de 200 columnas de ruido** en lift de votos efectivos. Falló en **32 de 32** casos, incluso donde la
correlación con los seis votos era 0,32. Eso no cuadraba, así que se le preguntó al listón por los
votos que la plataforma **ya usa**:

```
BTCUSDT:30m   n=254
  ema_cross    lift real = -0.014   listón ruido p95 = +0.610   -> NO PASA
  macd         lift real = +0.174   listón ruido p95 = +0.561   -> NO PASA
  supertrend   lift real = +0.279   listón ruido p95 = +0.532   -> NO PASA
  rsi14        lift real = -0.122   listón ruido p95 = +0.637   -> NO PASA
  bbands       lift real = -0.083   listón ruido p95 = +0.628   -> NO PASA
  stoch14      lift real = +0.002   listón ruido p95 = +0.606   -> NO PASA
```

**Ninguno de los seis.** 0/6 en las diez claves medidas.

### Cuánto de inalcanzable, exactamente

Se comprobó en el límite: construyendo por **Gram-Schmidt** una columna *perfectamente* ortogonal a
los seis votos —correlación residual del orden de 10⁻¹⁷— y midiendo su lift.

| Clave | n | lift ortogonal | ruido p95 |
|---|---|---|---|
| `BTCUSDT:30m` | 254 | 0,524 | 0,523 |
| `BTCUSDT:15m` | 541 | 0,551 | 0,550 |
| `BTCUSDT:4h` | 168 | 0,459 | 0,458 |
| `SOLUSDT:15m` | 163 | 0,508 | 0,508 |
| `ETHUSDT:30m` | 94 | 0,481 | 0,480 |

El máximo teórico supera al listón por **0,001**, un 0,2 %. Así que el ruido no es exactamente el
techo —matiz que conviene decir bien—, pero el listón deja una rendija del 0,2 % entre «imposible» y
«el máximo concebible». Ninguna variable informativa cabe ahí: describir el mismo mercado implica
correlacionar algo.

**Los votos efectivos miden diversificación, no aportación.** Una columna de ruido diversifica
perfectamente y no aporta nada. Siguen siendo la métrica correcta para descontar muestra —lo que
hace `independence.py`— y la equivocada para decidir si una fuente merece votar.

## La regla nueva, y su calibración

`informacion.aporta_informacion` pregunta lo que importa: **¿mejora el AUC fuera de muestra al
añadir la columna, por encima de su propia nula?** Regresión logística, validación por bloques
temporales contiguos, y una nula que permuta el orden de los bloques de la columna nueva —así
conserva su autocorrelación y rompe solo su relación con el desenlace.

Calibrada igual que se descubrió que la otra fallaba, preguntándole por los seis votos
(n = 994, 23 bloques de 24 h):

```
voto           AUC(5)   AUC(6)    delta  nula p95  veredicto
ema_cross      0.5670   0.5654  -0.0016   +0.0136  no aporta
macd           0.5701   0.5654  -0.0048   +0.0149  no aporta
supertrend     0.5401   0.5654  +0.0252   +0.0149  APORTA
rsi14          0.5801   0.5654  -0.0147   +0.0112  no aporta
bbands         0.5688   0.5654  -0.0035   +0.0099  no aporta
stoch14        0.5708   0.5654  -0.0054   +0.0077  no aporta
```

**El instrumento discrimina: 1 de 6** con este esquema de validación. Eso es lo que el anterior no
hacía —allí no pasaba nadie—.

> **Corrección del 22 de agosto por la noche.** Ese «1 de 6» dependía de haber fijado 5 bloques de
> validación. Variando el esquema, el delta de `supertrend` va de **−0,0312 con 3 bloques a +0,0173
> con 10**: cambia de signo. Promediado sobre seis esquemas queda en **+0,0014 ± 0,0174**, es decir
> indistinguible de cero.
>
> `informacion.py` promedia ahora sobre `ESQUEMAS_CV` en vez de fijar un número, para que ninguna
> constante elegida a ojo decida un veredicto. Y la lectura honesta del instrumento pasa a ser:
> **está demostrado para suspender, no para aprobar**. Distingue con solidez lo claramente negativo
> —`cvd_z` da −0,0205 ± 0,0047, negativo en los seis esquemas— de lo que ronda el cero, pero no hay
> referencia positiva estable con la que comprobar que detectaría un aporte real.
>
> **El veredicto sobre el CVD no cambia y sale reforzado**: era negativo con 5 bloques y lo es con
> los seis esquemas.

Que cinco de los seis votos no aporten incrementalmente no es un fallo del criterio: es coherente
con todo lo demás que sabe el proyecto. Los seis valen 1,41 efectivos y el meta-modelo no encuentra
señal en ellos. Son redundantes entre sí, así que casi ninguno aporta **por separado** aunque el
conjunto sí informe (AUC 0,565 fuera de muestra).

### Y por qué es una pregunta global, no por clave

Aplicada por temporalidad, con 40-285 decisiones, el AUC fuera de muestra oscila **entre 0,04 y
0,74** y las nulas llegan a ±0,50: a ese nivel el test no distingue nada. Con las claves juntas hay
~1.000 decisiones y 23 bloques, que sí dan potencia. Agregar es legítimo porque tanto los votos como
`cvd_z` están normalizados: un z de BTC en 4h y uno de SOL en 15m se miden con la misma vara.

## Veredicto

```
  n = 978 decisiones cerradas  ·  23 bloques de 24 h  ·  ganadoras 39.2%

  columna           AUC 6    AUC 7     delta   nula p95  veredicto
  cvd_z            0.5645   0.5522   -0.0122    +0.0088  no aporta
  divergencia      0.5645   0.5562   -0.0083    +0.0091  no aporta

  referencia del instrumento — el único voto en producción que sí aporta:
  supertrend       0.5443   0.5645   +0.0202    +0.0160  APORTA
```

**El CVD no aporta: empeora la predicción.** Y la referencia demuestra que, si aportara, el
instrumento lo habría visto.

Eso explica además los casos que sí acertaban por tercil —`BTCUSDT:4h` SHORT con |t| 3,74,
`ETHUSDT:30m` LONG con 5,88, `SOLUSDT:15m` LONG con 3,43, los tres en la misma dirección: más
presión compradora acumulada precede a peor resultado—. La relación existe, pero **el conjunto de
los seis votos ya la captura**, aunque la correlación lineal con cada uno por separado sea baja.

`flow.py` queda como biblioteca medida y probada, sin importarse desde ningún camino de decisión —
igual que `levels.py`. No se ha creado tabla, ni migración, ni proveedor en la DIL, ni backfill.

## Lo que deja el hito

**Un criterio de admisión que funciona.** `informacion.py` sustituye al listón de votos efectivos
para juzgar candidatos, y viene con su calibración incorporada: si el día de mañana no aprueba a
ningún voto en producción, es que hay que revisarlo a él, no al candidato.

**Una revisión pendiente del Analista de Niveles.** Se cerró en negativo apoyándose en el listón
roto. Con el instrumento nuevo habría que volver a mirarlo — ver
[analista-niveles-fase0.md](analista-niveles-fase0.md). No se reabre aquí porque hacerlo dentro del
mismo hito sería cambiar la regla después de ver el resultado.

**Un dato incómodo sobre la plataforma.** Con este instrumento, **cinco de los seis votos no aportan
información incremental sobre el desenlace**. No es materia de este hito, pero es la medición más
directa que hay hasta ahora de por qué el meta-modelo no encuentra nada.

## Cómo reproducirlo

```
docker exec trademe-prod-postgres-1 psql -U trademe -d trademe -At -F',' \
  -c "COPY (SELECT symbol, interval, captured_at, direction, ema_cross_score, macd_score,
      supertrend_score, rsi14_score, bbands_score, stoch14_score, outcome_return_r
      FROM snapshots WHERE ema_cross_score IS NOT NULL ORDER BY captured_at)
      TO STDOUT WITH CSV HEADER" > votos.csv

python -m trademe_quant.run_cvd_study votos.csv
```
