# CVD (flujo de agresores) — Fase 0

> Medición previa a dar voto, según el método del proyecto. **El CVD no se ha ganado el voto**, y de
> paso el estudio dejó claro que una de las tres reglas con las que se juzgaba era inalcanzable para
> cualquier variable real.

## Lo que se preguntaba

Los seis votos de la plataforma valen **1,41 efectivos**: todos derivan del precio, así que son seis
vistas de la misma cosa. El diagnóstico del meta-modelo apunta al mismo sitio — AUC 0,4967, dentro
de su distribución nula: no hay señal que extraer porque no hay información nueva que meter.

El *Cumulative Volume Delta* mide quién tiene la iniciativa: volumen ejecutado contra la oferta
(comprador agresivo) menos el ejecutado contra la demanda. Dos velas con el mismo cierre pueden
tener flujos opuestos, y ahí estaría la información que el OHLCV no contiene.

## El hallazgo que abarató el hito: no hacen falta `aggTrades`

El plan era reconstruir el flujo operación a operación desde `aggTrades`: unos 63 millones de
registros por activo para 90 días, ~250.000 peticiones. Innecesario. **Las klines de Binance ya
traen el dato agregado** en el campo 9, `taker buy base asset volume`:

```
delta = taker_buy − taker_sell = taker_buy − (volumen − taker_buy) = 2·taker_buy − volumen
```

| | `aggTrades` | Campo 9 de klines |
|---|---|---|
| Peticiones (90 días × 4 activos) | ~250.000 | **~520** |
| ¿Backtesteable? | **No** | **Sí** |

Lo segundo importa más que lo primero. El *order book imbalance* se descartó precisamente porque el
backtest solo consume `fetch_klines`/OHLCV; el CVD llega por ese mismo camino. Verificado que el
campo está presente en el histórico a 90 días vista.

Lo que se pierde es la distribución dentro de la vela —tamaño de órdenes, ráfagas—. Para la pregunta
de la Fase 0 no hace falta: el delta agregado por vela **es** la definición canónica del CVD.

## Las tres reglas, fijadas antes de medir

1. **Independencia con control de ruido.** Superar el percentil 95 de 200 columnas de ruido.
2. **Correlación con los seis votos < 0,50**, por temporalidad.
3. **Expectancy por tercil**, LONG y SHORT por separado, con Bonferroni.

Y dos métricas candidatas declaradas en `flow.py` antes de calcular nada: `cvd_z` (presión
acumulada, estandarizada) y `divergencia` (el z del CVD menos el z del retorno de precio).

## Resultado formal

**0 de 32 casos pasan las tres reglas.** 2.204 snapshots, 10 claves con muestra suficiente,
|t| crítico de Bonferroni 3,30.

Desglose: la **regla 1 falla en 32 de 32**. La regla 2 pasa en 10 de 32. La regla 3, en 6 de 32.

## El instrumento estaba roto, y se puede demostrar

Que la regla 1 fallara **siempre**, incluso donde la correlación con los seis votos era baja (0,32),
no cuadraba. La comprobación que lo resuelve es preguntarle al listón por los votos que la
plataforma **ya usa**: se quita uno de los seis, se mide cuánto lift aporta al volver a añadirlo y
se compara con el ruido.

```
BTCUSDT:30m   n=254
  ema_cross    lift real = -0.014   listón ruido p95 = +0.610   -> NO PASA
  macd         lift real = +0.174   listón ruido p95 = +0.561   -> NO PASA
  supertrend   lift real = +0.279   listón ruido p95 = +0.532   -> NO PASA
  rsi14        lift real = -0.122   listón ruido p95 = +0.637   -> NO PASA
  bbands       lift real = -0.083   listón ruido p95 = +0.628   -> NO PASA
  stoch14      lift real = +0.002   listón ruido p95 = +0.606   -> NO PASA
```

**Ninguno de los seis votos en producción superaría el listón que le estábamos exigiendo al CVD.**
Reproducido en las diez claves medidas: 0/6 en todas.

Y la razón es matemática, no un accidente de esta muestra: **el ruido gaussiano está
descorrelacionado con todo por construcción**, así que es el *máximo teórico* de «añadir votos
efectivos». Cualquier variable informativa correlaciona algo con las demás —si no, no estaría
describiendo el mismo mercado— y por tanto añade menos que el ruido. Exigir «supera al ruido» es
exigir «sé más independiente que el azar puro».

Los votos efectivos miden **diversificación**, no aportación. Son la métrica correcta para descontar
muestra —para eso los usa `independence.py`— y la equivocada para decidir si una fuente nueva aporta
información.

## Qué queda cuando se aparta la regla rota

Con las dos reglas que sí son cruzables, **tres casos pasan las dos**, los tres con `cvd_z`:

| Clave | \|r\| máx | \|t\| | tercil bajo → alto | dirección |
|---|---|---|---|---|
| `BTCUSDT:4h` (SHORT) | 0,38 | 3,74 | +0,100 → −0,916 R | alto = peor |
| `ETHUSDT:30m` (LONG) | 0,35 | 5,88 | +1,700 → −0,318 R | alto = peor |
| `SOLUSDT:15m` (LONG) | 0,32 | 3,43 | +2,000 → −0,078 R | alto = peor |

Los tres apuntan en la **misma dirección**: mucha presión compradora acumulada precede a peores
resultados, se compre o se venda. Es coherente con un efecto de agotamiento, y la consistencia de
signo es justo lo que distingue una señal de una casualidad múltiple.

**No basta para dar el voto.** Son tres casos de dieciséis claves, con veinte a treinta decisiones
por tercil, y el criterio de independencia —que es el que decide si esto añade algo o solo repite lo
que ya dicen los seis— está sin reemplazar. Dar voto ahora sería exactamente lo que este proyecto
evita: construir sobre un aprobado parcial.

## Veredicto

**El CVD no se gana el voto.** `flow.py` queda como biblioteca medida y probada, sin importarse
desde ningún camino de decisión — igual que `levels.py`.

No se ha creado tabla, ni migración, ni proveedor en la DIL, ni se ha ejecutado backfill. Ese era el
motivo de invertir el orden y medir antes de construir: el coste del hito es un módulo, un script,
unos tests y este documento.

## Lo que sí deja el hito

**Una regla de juicio invalidada, con la prueba hecha.** El «control de ruido sobre votos efectivos»
quedó escrito como criterio general tras el Analista de Niveles. No sirve, y ahora se sabe por qué.
Antes de juzgar al siguiente candidato hay que sustituirla por una medida de **información
incremental sobre el desenlace** —por ejemplo, si el AUC de un modelo con los seis votos mejora al
añadir el séptimo, contra su propia nula— en vez de una medida de diversificación.

**Una revisión pendiente del Analista de Niveles.** Se cerró en negativo apoyándose en esta misma
regla. Con el instrumento corregido, su veredicto habría que volver a mirarlo — ver
[analista-niveles-fase0.md](analista-niveles-fase0.md).

**El CVD, medido y barato de retomar.** Si se rediseña la regla de independencia, el estudio se
reproduce con un comando y ya se sabe dónde mirar: `cvd_z`, y las tres claves de la tabla.

## Cómo reproducirlo

```
docker exec trademe-prod-postgres-1 psql -U trademe -d trademe -At -F',' \
  -c "COPY (SELECT symbol, interval, captured_at, direction, ema_cross_score, macd_score,
      supertrend_score, rsi14_score, bbands_score, stoch14_score, outcome_return_r
      FROM snapshots WHERE ema_cross_score IS NOT NULL ORDER BY captured_at)
      TO STDOUT WITH CSV HEADER" > votos.csv

python -m trademe_quant.run_cvd_study votos.csv
```
