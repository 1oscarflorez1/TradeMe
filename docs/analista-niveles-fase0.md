# Analista de Niveles — Fase 0: resultado **negativo**

> Medido el 19 de agosto de 2026 sobre 1074 snapshots de BTCUSDT y velas públicas de Binance.
> **Conclusión: no se le da voto.** El hito se cierra aquí sin haber tocado ninguna decisión.

## Lo que se preguntaba

El traspaso señalaba el Analista de Niveles como «el único candidato a aportar un eje
independiente». Se acordaron dos listones **antes** de calcular nada:

1. **Independencia**: añadir **≥ +0,5 votos efectivos** (de 1,41 a ≥1,91 en 4h).
2. **Poder predictivo**: expectancy por tercil con corrección de Bonferroni sobre 24 comparaciones
   declaradas de antemano → |t| crítico = **3,124**.

Interpretación en Fase 0: reversión pura. Cerca de soporte `+`, cerca de resistencia `−`.

## Resultados

| TF | 6 votos | 7 votos | lift | **ruido (p95)** | \|t\| máx |
|---|---|---|---|---|---|
| 15m | 1,983 | 2,548 | +0,565 | **+0,575** | 2,37 |
| 30m | 1,822 | 2,354 | +0,532 | **+0,537** | 2,35 |
| 1h | 2,147 | 2,667 | +0,520 | **+0,608** | 2,77 |
| 1m | 1,855 | 2,354 | +0,499 | **+0,543** | 0,52 |
| 5m | 1,927 | 2,418 | +0,491 | **+0,558** | 2,33 |
| 4h | 1,387 | 1,693 | +0,306 | **+0,430** | **7,30** |
| 1d | 1,702 | 1,683 | −0,019 | **+0,507** | 0,00 |

## El hallazgo que decide el hito

Tres temporalidades superaban el listón de +0,5 votos efectivos. Parecía un aprobado.

Entonces se añadió un control que no estaba en el plan: **¿cuánto lift daría una columna de ruido
aleatorio?** Doscientas repeticiones por temporalidad.

**Un voto de ruido puro da entre +0,42 y +0,61.** En ninguna temporalidad el detector supera al
azar; en 1h, 4h, 5m, 1m y 1d queda por debajo.

La razón es aritmética y, vista de frente, evidente: la participación de autovalores mide cuánta
variabilidad **no compartida** entra en el sistema, y el ruido, por definición, no comparte nada con
nadie. Añadir una variable independiente sube la métrica tanto si lleva información como si no.

Así que el resultado no es «los niveles no aportan un eje independiente». Es más incómodo:
**el criterio que propuse para medirlo no distinguía un eje nuevo de un generador de números
aleatorios.** El listón de +0,5 estaba mal puesto, y no por generoso o exigente, sino por medir otra
cosa.

## El |t| = 7,30 de 4h, y por qué no rescata nada

Es el único resultado que supera el umbral de significancia, y hay tres razones para no darle
crédito:

**1 · Es la temporalidad en cuarentena.** Esos cortos son el periodo que acumuló −0,485 R con el
85,6 % al stop. En un tramo donde el precio no paró de caer, «ponerse corto cerca de un soporte
funcionó» significa que los soportes se rompieron. Es una descripción del periodo, no una regla.

**2 · En 4h el detector no está midiendo niveles.** Mirando su correlación con los votos existentes
según la historia disponible:

| TF | velas | correlación máx. con Bollinger/Estocástico |
|---|---|---|
| 15m | 2276 | 0,11 |
| 30m | 937 | 0,05 |
| 1h | 726 | 0,32 |
| 4h | 330 | **0,54** |
| 1d | 232 | **0,90** |

Cuanta menos historia, más se parece a un oscilador de reversión. Tiene sentido: con pocas velas los
«niveles» son los extremos recientes, y la distancia a un extremo reciente es exactamente lo que
mide Bollinger. En 1d la correlación con RSI llega a **+0,90** — ahí el detector es, literalmente,
otra copia del precio.

Es decir: el único |t| significativo aparece justo donde el indicador ha degenerado en algo que ya
teníamos.

**3 · Aceptarlo sería repetir un error ya cometido.** «El fundamental habría salvado el 4h» también
era una inferencia a partir de los desenlaces de ese mismo periodo, y resultó falsa al medirla. La
lección de entonces se aplica igual ahora.

## Veredicto

Ninguna temporalidad pasa los dos listones. Y el que pasaban tres de ellas resulta no medir lo que
se pretendía. **No se le da voto al Analista de Niveles.**

Coste del hito: un detector, un script y este documento. La decisión no se ha tocado en ningún
momento, que era exactamente el propósito de hacer la Fase 0 antes que nada.

## Lo que sí deja el hito

**Una corrección metodológica que vale para todo lo que venga.** El lift de votos efectivos era la
métrica con la que el proyecto pensaba juzgar futuros candidatos a «eje independiente» —está escrito
como criterio de juicio en la especificación del Fundamental Score—. Ahora se sabe que **premia por
igual a una fuente nueva y a un dado**. Anotado en [independencia.md](independencia.md).

> ### ⚠ Revisión pendiente (22 ago 2026): este veredicto se apoya en un instrumento roto
>
> La Fase 0 del CVD llevó el control de ruido un paso más allá y preguntó lo que aquí no se
> preguntó: **¿superarían el listón los seis votos que la plataforma ya usa?** La respuesta es
> **ninguno** — ni uno de los seis, en las diez claves medidas. Ver
> [cvd-fase0.md](cvd-fase0.md).
>
> Cuánto de inalcanzable se midió en el límite: una columna construida por **Gram-Schmidt** para ser
> *perfectamente* ortogonal a los seis votos supera al p95 del ruido por **0,001** — un 0,2 %. El
> listón deja esa rendija entre «imposible» y «el máximo concebible», y ninguna variable informativa
> cabe ahí, porque describir el mismo mercado implica correlacionar algo.
>
> La conclusión correcta del hallazgo de este hito no era «hay que superar al ruido», sino que **los
> votos efectivos no sirven para decidir si una fuente aporta información**: miden diversificación.
> El Analista de Niveles se cerró en negativo apoyándose en esa comparación, así que **su veredicto
> habría que volver a mirarlo**. El criterio que lo sustituye ya existe —`informacion.py`, que mide
> aportación de información sobre el desenlace y viene calibrado: aprueba a `supertrend` y suspende
> al ruido—, así que la revisión es reproducible con un comando. Se deja anotado y no se reabre
> dentro del hito del CVD: hacerlo allí habría sido cambiar el criterio después de ver el resultado,
> que es justo lo que este proyecto no hace.

**Un detector con las garantías puestas.** `levels.py` no vota y no se importa desde ningún camino
de decisión, pero está probado contra look-ahead (ocho tests, incluido el que comprueba que un
pivote sin confirmar no se detecta). Si algún día se retoma —con más historia, o con la lectura de
ruptura en vez de reversión pura— el punto de partida está y su medición se reproduce con un
comando.

## Cómo reproducirlo

```bash
python -m trademe_quant.run_levels_study <snapshots.csv> BTCUSDT
```

El CSV se exporta con:

```sql
COPY (SELECT interval, captured_at, action, direction,
             ema_cross_score, macd_score, supertrend_score,
             rsi14_score, bbands_score, stoch14_score, outcome_return_r
      FROM snapshots WHERE symbol='BTCUSDT' AND ema_cross_score IS NOT NULL
      ORDER BY interval, captured_at) TO STDOUT WITH CSV HEADER;
```

## Si se retomara

Dos caminos, y ninguno es «bajar el listón»:

- **Más historia.** La degeneración en oscilador está ligada a las velas disponibles. Con 2000+
  velas de 4h el detector mediría estructura y no extremos recientes. Requiere relleno retroactivo,
  que ya existe para funding y sería análogo.
- **Lectura de ruptura** en vez de reversión pura. Es más parecida a cómo se opera, pero mezcla dos
  efectos opuestos y necesita una medición diseñada para separarlos.

En ambos casos, el criterio de independencia tendría que ser **superar el control de ruido**, no
alcanzar un número absoluto.
