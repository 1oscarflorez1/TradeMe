# Fundamental Score — el funding, y solo contra los largos (M12)

> Estado: **retirado en 0.75.0** (`fundamental.mode: 'off'`). La api no lo calcula y el piloto ni
> publica su distribución ni lo gobierna. Auditado en walk-forward contra una regla fijada antes de
> medir, lo que habría dejado abrir rendía menos que todo. Ver
> [Auditoría y retirada](#auditoría-walk-forward-y-retirada-0750). El resto del documento describe
> cómo funcionaba.

## Qué se midió antes de programar nada

Se cruzaron **728 decisiones ya evaluadas** con el valor *as-of* de cada serie de la Data
Intelligence Layer (M11). Se probaron **seis relaciones** y sobrevivió **una sola**, que además
aguanta la corrección de Bonferroni (t=2,95 sobre umbral 2,64):

| LARGOS por tercil de funding | n | Expectancy | Acierto |
|---|---|---|---|
| funding **bajo** | 117 | **+0,200 R** | 47,9 % |
| funding medio | 117 | −0,005 R | 41,9 % |
| funding **alto** | 117 | **−0,230 R** | 29,1 % |

Control en cortos, con los mismos terciles: **−0,111 / +0,131 / −0,004**. No hay patrón.
Spearman funding↔R en LONG: **ρ = −0,156**, n=351.

## Las tres decisiones de diseño, y por qué

### 1. Asimetría

```
logit_BUY  -= w_fund · penalizacion(percentil)
logit_SELL  # sin tocar
```

El `macro.bias` histórico se inyecta simétrico. Cablear igual un efecto que solo existe en los
largos no es «aprovecharlo también en los cortos»: es **añadir ruido en la mitad de las
decisiones**, con la seguridad aparente que da una fórmula simétrica.

Un matiz que conviene no confundir: la asimetría es del **logit**, no de la probabilidad. `P(SELL)`
sí cambia cuando se penaliza el largo, porque el softmax normaliza y la masa que pierde BUY se
reparte. Lo que queda invariante es la **relación SELL/HOLD**, y hay un test que lo comprueba. En la
práctica significa que el score desaconseja comprar sin llegar a aconsejar vender.

### 2. Percentil sobre 90 días, no valor absoluto

El rango observado durante la medición fue **0,000003–0,0001**. Un umbral fijo calibrado ahí
describe un régimen concreto, no una regla: al primer cambio de mercado deja de significar lo que
significaba. El percentil sobre ventana móvil responde a la única pregunta que se sostiene: *¿está
caro el apalancamiento comparado con lo normal últimamente?*

La curva de penalización es **una recta** que arranca en el tercil inferior (`start = 1/3`, el
tercil donde los largos rendían +0,200 R) y llega a 1 en el percentil máximo. Sin parámetros de
forma a propósito: una recta no se puede sobreajustar a posteriori, y la medición no distingue entre
una recta y cualquier otra curva monótona.

### 3. Fear & Greed y BCE se quedan fuera

No por inútiles: **no se puede saber**. F&G osciló entre 25 y 41 (siempre «miedo») y el BCE tiene
uno o dos valores distintos en un mes. Sin contraste no hay nada que medir. Se registran y se
decidirá cuando lo haya.

## Reparto Python / Node

| | |
|---|---|
| **`apps/quant`** | Lee `derivatives_metrics` filtrando por `published_at` y publica la **distribución de referencia**: 101 cortes de percentil de los últimos 90 días, en `artifacts/fundamental/<SÍMBOLO>.json`. |
| **`apps/api`** | Sitúa contra esos cortes el funding del momento y aplica la penalización. No consulta las tablas de la DIL. |

Es el mismo reparto que el calibrador y el meta-modelo: Python mide, Node aplica.

**Paridad acotada**: a la suite Node≡Python entra solo la **fórmula de inyección** —`percentile_of`,
`long_penalty` y el softmax con `fund_term`—. El cómputo del score es un *input*, como Reditum o el
funding crudo.

**Sin datos, cero.** Un símbolo con menos de 30 observaciones en la ventana se declara `stale` y la
penalización es **0**, no una estimación. Lo mismo si no se conoce el funding del momento: `stale`,
no un cero por defecto. Un cero se situaría en la distribución y produciría un percentil con toda la
pinta de ser una medición — es el fallo que tuvo 0.38.0 durante su primer día en producción.

**Y sin ventana, tampoco.** Contar observaciones responde «cuántos datos hay»; la pregunta que
faltaba era «de cuándo son». Desde 0.55.0 hacen falta las dos cosas: `MIN_OBSERVACIONES = 30` y
`MIN_COBERTURA = 0,8` de los días de la ventana, medida en **días distintos con dato** para que un
hueco en mitad también cuente.

Lo que dejaba pasar el guardia anterior: BTCUSDT publicaba **120 observaciones** —cuatro veces el
mínimo— repartidas por **40 de los 90 días**, porque al incorporar los activos nuevos se les hizo el
relleno retroactivo a ellos y no a él. Su distribución describía otro periodo, y su tercil de
referencia quedó en **+5,0e-5** frente al **+2,0e-5** de ETHUSDT y el **−2,5e-5** de SOLUSDT. Con un
funding real de +3,0e-5, dos símbolos penalizaban el largo y BTCUSDT no. **Un percentil solo compara
si las ventanas comparan**, y esa condición no la estaba comprobando nadie.

El 0,8 se fijó mirando lo que ya estaba dentro, no el resultado que interesaba: los tres símbolos
con histórico completo cubren el 100 % de la ventana, así que el listón les deja veinte puntos de
margen y solo excluye al que de verdad está incompleto.

El artefacto publica `cobertura` y `min_cobertura` para que el veredicto se pueda auditar, y el log
del piloto distingue los dos motivos: «faltan datos» se arregla esperando, «faltan días» se arregla
con un relleno retroactivo. Decir «sin muestra suficiente» cuando sobran observaciones y lo que
falta es historia manda a mirar donde no es.

**El funding no depende del sesgo macro.** Se refresca por su cuenta, para los perpetuos de Binance,
tenga `MACRO_ENABLED` el valor que tenga. El score existe precisamente porque el funding no deriva
del precio; acoplarlo al interruptor del macro uniría justo lo que este hito separa.

## Gobierno: cómo se promociona

El score entra en `shadow` y no influye. Para pasar a `active` tiene que demostrar, sobre
**decisiones reales cerradas**:

- **lift ≥ 0,05 R**
- **AUC ≥ 0,55**

Los dos umbrales están escritos en la migración `019_fundamental_score.sql` **antes de ver el primer
resultado**. Métrica adicional de juicio: *¿cuántos votos efectivos añade?* — es la prueba de que
aporta un eje propio y no otra copia del precio (ver [independencia](independencia.md)).

### El evaluador, y su primera lectura

`fundamental_policy.py` mide el expediente sombra en cada ciclo del piloto y publica
`artifacts/fundamental_policy.json`. La api lo lee, y el `mode` de `ensemble.yaml` actúa como
**tope**: la automatización puede rebajar el modo, nunca subirlo. Si el artefacto falta o viene
corrupto, el peor caso es que el score influya *menos* de lo previsto.

El lift no se reconstruye: sale de `fund_shadow_action`, que ya guarda qué se habría decidido. Donde
la sombra discrepa, esa operación no se habría abierto y su resultado habría sido 0.

**Primera medición real (21 ago 2026)** — no promociona, y con motivo:

| | |
|---|---|
| decisiones LONG cerradas | 75 (de 100 exigidas) |
| discrepancias | 44 |
| expectancy real | +1,08 R |
| con el score aplicado | +0,55 R |
| **lift** | **−0,53 R** |
| **AUC** | **0,456** |

La señal preliminar es **negativa**: aplicar el score habría empeorado el resultado. Pero antes de
concluir nada hay que mirar de dónde salen esos 75 registros: **74 son de ETH y SOL dentro de las
mismas 14 horas** del 19 al 20 de agosto, con 27 aciertos de 35 en ETH. El baseline de +1,08 R no
describe la plataforma, describe ese rally — y contra un tramo así, cualquier filtro que quite
compras parece desastroso.

Es justo el escenario donde el funding alto **no** predice mal resultado: un rally sostenido con
largos cargados que siguen ganando. Ni confirma ni refuta la medición original; simplemente todavía
no hay contraste de régimen.

### El umbral se compara con el azar, no con un número fijo

Al diagnosticar el meta-modelo apareció que su umbral de promoción lo superaba el azar. La pregunta
obvia era si al Fundamental Score le pasaba lo mismo — y la respuesta resultó ser **distinta y más
interesante**.

Medido el 22 de agosto de 2026 sobre 114 decisiones LONG cerradas (10.000 permutaciones):

| | |
|---|---|
| expectancy base | +1,395 R |
| descartadas por el score | 79 de 114 (69 %) |
| **lift observado** | **−0,965 R** |
| nula simple | media −0,967 · [−1,044, −0,886] |
| nula por bloques de 24 h | media −0,570 · [−1,018, −0,149] |
| AUC observado | 0,511 (nula [0,408, 0,587]) |

Dos lecturas:

**El score descarta como si eligiera al azar.** El lift observado coincide casi exactamente con el
nulo simple, y el AUC es 0,511. Con esta muestra no distingue buenas de malas compras.

**Y el lift nulo aquí es negativo, no positivo como en el meta-modelo.** La razón es aritmética: con
un baseline de +1,395 R, descartar el 69 % de las operaciones al azar arrastra la media hacia cero.
En el meta-modelo la nula salía positiva porque `pick_threshold` **optimizaba** el corte; aquí no
hay nada que optimizar, la fórmula es fija.

De ahí la consecuencia que importa: **un umbral fijo no es neutral respecto al régimen**. Los mismos
0,05 R son exigentes cuando el baseline es positivo y regalados cuando es negativo — en una racha
mala, cualquier filtro que quite operaciones parecería bueno.

Por eso el gobierno usa ahora:

```
umbral_efectivo = max(0,05 R, percentil 95 de la nula)
```

Tomar el máximo hace el criterio neutral al régimen y **solo endurece**: nunca deja pasar algo que
antes no pasaba. La nula se recalcula en cada ciclo (1.000 permutaciones por bloques) y se publica
como `lift_nulo_p95` en la evidencia del artefacto.

Reproducible con:

```bash
python -m trademe_quant.run_fundamental_nula <sombra.csv>
```

### Limitación conocida: `n` cuenta decisiones, no evidencia

Cien decisiones correlacionadas siguen siendo casi una sola apuesta observada cien veces.
`MIN_SAMPLES` no protege de eso. Mientras no exista el **Gestor de Correlaciones**, conviene mirar
el reparto por símbolo y por ventana temporal antes de dar peso a un veredicto — en las dos
direcciones, tanto si el score sale bien parado como si sale mal.

Mientras tanto se registra en columnas propias (`fund_percentile`, `fund_penalty`, `fund_mode`,
`fund_version`, `fund_shadow_action`, `fund_shadow_confidence`), nunca en las de `outcome_*`. El
aislamiento es **estructural**: una consulta que olvide filtrar no puede contaminar la expectancy.

## La migración del funding va atada a la promoción

El acuerdo es que el funding deje `macro.bias` y viva solo en el score. Pero moverlo el día de la
entrega haría **lo contrario** de lo que pretende el gobierno en sombra: quitaría el funding de las
decisiones reales sin que nada lo sustituyera y sin haberlo medido.

Por eso `effectiveMacro()` solo retira el funding cuando el score está en `active`:

| `fundamental.mode` | `macro.funding_weight` | `macro.trend_weight` |
|---|---|---|
| `shadow` (hoy) | 0,5 | 0,5 |
| `active` | **0** | **1,0** |

La transferencia del peso no es cosmética. Sin ella `|bias| ≤ 0,5`, y el **escudo macro** —que exige
`|bias| > conflict_threshold`, hoy 0,5— no volvería a dispararse jamás. Se habría desactivado una
salvaguarda sin que nadie lo decidiera ni lo notara.

## Auditoría walk-forward y retirada (0.75.0)

### El método, el mismo que retiró el meta-modelo

`trademe_quant.run_fundamental_estudio` juzga semana a semana lo que el score registró en vivo desde
el 19-ago-2026: una fila por vela (primera captura), desenlaces reales y de sombra reproducibles, en
R neta. Dos diferencias con el estudio del meta-modelo, las dos por la naturaleza del score:

- **No se entrena.** Es una fórmula fija sobre un percentil de los 90 días anteriores a cada
  decisión, así que cada semana ya es fuera de muestra.
- **Solo actúa sobre los largos.** En los cortos no descarta nada, así que el control por dirección
  pasa a ser que el efecto en largos **se mantenga dentro de cada semana**. Si solo aparece
  mezclando semanas, es deriva.

La regla, fijada antes de ejecutarlo: se queda solo si **AUC en largos ≥ 0,55**, **mejora de lo
conservado > máx(0,05 R; P95 del azar por bloques diarios)** y **AUC en largos dentro de cada semana
≥ 0,55**.

### Lo medido (14-sep-2026)

5 semanas, 1.482 largos (1.224 con TP/SL), 601 de ellos descartados por el score:

| | Fundamental Score | listón |
|---|---|---|
| AUC en largos | **0,421** | ≥ 0,55; el azar alcanza 0,619 |
| Mejora de lo que conservaría | **−0,101 R** | > máx(0,05; +0,317) |
| AUC en largos dentro de cada semana | 0,552 | ≥ 0,55 |
| Referencia: expectancy de los largos la semana anterior | **0,633** | — |
| Control: AUC en cortos (no descarta ninguno) | 0,543 | — |

| semana | largos | descartados | expectancy | AUC | mejora |
|---|---|---|---|---|---|
| W34 | 334 | 231 | +0,310 | 0,582 | +0,280 |
| W35 | 133 | 80 | +0,481 | 0,566 | +0,232 |
| W36 | 162 | 76 | −0,007 | 0,478 | +0,030 |
| W37 | 739 | 174 | −0,647 | 0,557 | +0,010 |
| W38 | 114 | 40 | −0,133 | 0,531 | −0,198 |

**Falla dos de las tres condiciones.** Y la tabla por semanas enseña por qué, sin necesidad de
interpretarla mucho: dentro de cada semana hay una ordenación débil —0,552 de media, justo en el
listón—, pero **el score descartaba sobre todo en las semanas en que los largos ganaban**. En W34
descartó 231 de 334 con una expectancy de +0,31 R; en W37, la peor semana, solo 174 de 739. El
funding alto acompañó a las semanas alcistas, que es lo contrario de lo que el score supone. Al
agregar, lo que deja abrir rinde **0,101 R menos** que todo, y una regla trivial que solo mira cómo
les fue a los largos la semana anterior ordena mucho mejor.

El gobierno del score lo medía con su propio estadístico (las descartadas aportan 0): +0,029 R,
frente a un azar de +0,112. Tampoco pasaba.

### Qué cambia

- `fundamental.mode: 'off'` en `ensemble.yaml`, con la medición en el comentario.
- **La api** no calcula el score ni registra su sombra; el panel dice «Fundamental Score apagado».
  El funding sigue en el sesgo macro, que solo lo cedía con el score activo.
- **El piloto** no publica la distribución del funding ni gobierna el modo, y lo dice en el log. La
  ingesta del funding de la Data Intelligence Layer sigue: la usan otros estudios.
- No se borra nada: ni el código, ni los artefactos `fundamental/*.json`, ni `fundamental_policy.json`.

### Cómo reactivarlo

Repetir el estudio con más histórico y poner `mode: 'shadow'` solo si cumple la regla de arriba. La
ordenación débil dentro de cada semana podría sugerir otra formulación —el percentil frente a la
propia semana, por ejemplo—, pero eso sería una hipótesis nueva sacada de estos mismos datos:
tendría que medirse sobre datos que no se hayan usado para plantearla.

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_fundamental_estudio
```

## Configuración

```yaml
fundamental:
  mode: 'off'           # off · shadow · active — retirado en 0.75.0
  w_fund: 0.5           # peso de la penalización sobre el logit BUY
  start: 0.3333333333   # percentil por debajo del cual no se penaliza
  window_days: 90
  absorbs_funding: true # al promocionar, el funding sale de macro
```

`w_fund: 0.5` —la mitad del peso macro, porque actúa en un solo lado— es un punto de partida
razonado, **no medido**. Se calibrará con decisiones reales cerradas antes de promocionar el score.

## Operación

```bash
python -m trademe_quant.run_fundamental BTCUSDT
```

El piloto automático lo ejecuta en cada ciclo, justo después de la Data Intelligence Layer (usa lo
que esa acaba de guardar). La api recoge el artefacto nuevo sola, en unos 15 segundos como mucho: ver
[`recarga-artefactos.md`](recarga-artefactos.md).

## Relacionado

- [datos-externos.md](datos-externos.md) — la capa que alimenta esto (M11)
- [macro.md](macro.md) — el sesgo macro, del que sale el funding al promocionar
- [independencia.md](independencia.md) — el desinflado por dependencia de los votos
- [metodologia.md](metodologia.md) — por qué nada decide sin demostrarlo antes
