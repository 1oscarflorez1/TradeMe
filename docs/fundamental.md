# Fundamental Score — el funding, y solo contra los largos (M12)

> Estado: **en sombra**. Se calcula, se registra y **no influye en ninguna decisión**.

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

## Configuración

```yaml
fundamental:
  mode: 'shadow'        # off · shadow · active
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
que esa acaba de guardar). La api recoge el artefacto nuevo con `POST /reload`.

## Relacionado

- [datos-externos.md](datos-externos.md) — la capa que alimenta esto (M11)
- [macro.md](macro.md) — el sesgo macro, del que sale el funding al promocionar
- [independencia.md](independencia.md) — el desinflado por dependencia de los votos
- [metodologia.md](metodologia.md) — por qué nada decide sin demostrarlo antes
