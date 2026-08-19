# Independencia de los votos (M10.5)

## El problema, en una frase

El ensemble suma seis votos internos como si fueran seis evidencias. **No lo son.**

EMA9/21, MACD y Supertrend derivan todos de la misma serie de precio suavizada. RSI14, Bollinger y
Estocástico son tres formas de leer el mismo desplazamiento respecto a la media. Cuando el mercado
se mueve, no votan seis analistas: vota uno, seis veces.

## Lo que se midió

Sobre 636 decisiones reales de BTCUSDT (23 de julio – 11 de agosto de 2026), con la
**dimensionalidad efectiva** de la matriz de correlación de los seis votos:

| Temporalidad | n | Votos reales | Votos efectivos | Primer factor | Expectancy |
|---|---|---|---|---|---|
| 15m | 142 | 6 | **2,61** | 55 % | +0,121 R |
| 30m | 80 | 6 | **2,35** | 60 % | +0,110 R |
| 5m | 88 | 6 | **1,95** | 68 % | −0,116 R |
| 1m | 122 | 6 | **1,83** | 71 % | +0,116 R |
| 1h | 46 | 6 | **1,54** | 79 % | −0,347 R |
| 4h | 117 | 6 | **1,41** | 83 % | −0,485 R |
| 1d | 34 | 6 | **1,37** | 85 % | sin evaluar |

Correlaciones internas en 4h: Estocástico–Bollinger `0,96`, RSI–Bollinger `0,92`,
EMA–Supertrend `0,87`. Y entre bloques, EMA–RSI `−0,94`: son casi espejos.

Ordenar por votos efectivos da casi el mismo orden que ordenar por rentabilidad (ρ de Spearman
0,83, p = 0,029 por permutación exacta). El mecanismo se entiende: **cuanto más larga la
temporalidad, más suavizada la serie sobre la que se calculan los seis indicadores, y más se
parecen entre sí**. La diversidad del comité se evapora justo donde más falta hace.

> Honestidad estadística: son seis temporalidades de un solo activo en 19 días. Es razón suficiente
> para actuar porque el mecanismo es comprensible, no una ley demostrada.

## Por qué importa: la confianza estaba inflada

La confianza que declara el softmax se calcula como si seis fuentes independientes hubieran
coincidido. Si en realidad son 1,41, esa cifra afirma más seguridad de la que los datos respaldan.

Eso contaminaba tres cosas a la vez:

- El **umbral de captura** y el de **push**: se disparaban con confianzas que no valían lo que decían.
- El **tamaño de posición**, que se dimensiona con la confianza.
- El **meta-modelo**, entrenado sobre decisiones de todas las temporalidades mezcladas, donde la
  confianza de 4h y la de 15m estaban en escalas distintas sin que nada lo indicara.

La calibración (M7) no podía arreglarlo: corrige el *mapeo* de la confianza a probabilidad real, no
la falsa independencia que la genera.

## Cómo se calcula

**Dimensionalidad efectiva** = participación de los autovalores de la matriz de correlación:

```
N_efectivos = (Σλ)² / Σλ²
```

Con seis votos independientes todos los autovalores valen 1 y el resultado es 6. Si los seis son
copias —o espejos— de un mismo factor, un autovalor se lo lleva todo y el resultado tiende a 1.

Se usan autovalores y no una suma de correlaciones **porque los dos bloques son anticorrelacionados**.
Sumando correlaciones con signo, el −0,94 entre EMA y RSI cancelaría el +0,96 entre Estocástico y
Bollinger, y saldría una independencia altísima justo donde no la hay. Un espejo tampoco es
evidencia nueva, y los autovalores no se dejan engañar por el signo.

**Factor de desinflado:**

```
k = √(N_efectivos / N)
```

La media de N observaciones independientes tiene error estándar σ/√N. Con solo `N_efectivos` fuentes
reales, la misma cifra `net` respalda menos evidencia, en proporción a √(efectivos/N). En 4h,
k = √(1,41/6) ≈ 0,485.

## Cómo se aplica

Los **tres** logits del softmax se multiplican por `k`:

```
logit_BUY  = k · ( net/t + w_macro·bias)
logit_SELL = k · (−net/t − w_macro·bias)
logit_HOLD = k · ( hold_band/t)
```

De aquí sale la propiedad que hace seguro el cambio: **escalar todos los logits por una constante
positiva no altera cuál es el mayor**. El ajuste no cambia la dirección de ninguna decisión, solo
aplana la distribución y baja la confianza declarada. Es una corrección de calibración, no de
criterio: el sistema no cree otra cosa, declara con menos seguridad lo que ya creía.

Hay dos tests que fallan si esa invariante se rompe, uno en Node y otro en Python.

## Dónde vive

```
snapshots ──▶ apps/quant (independence.py: mide por símbolo+temporalidad)
                    │  artifacts/independence.json
                    ▼
              apps/api ──POST /reload──▶ aplica el factor en cada señal
```

Mismo patrón que `ensemble.yaml`, `calibrators.json` y `metamodel.json`: **el cómputo vive en
Python, con la muestra completa; la API solo evalúa el artefacto publicado.** Lo que entra en la
suite de paridad Node≡Python es únicamente la *aplicación* del factor, no su cálculo.

El piloto automático lo remide en cada ciclo: es barato (una matriz 6×6 por clave) y su valor cambia
con el régimen de mercado.

## Degradación grácil

- **Sin muestra suficiente** (menos de 40 decisiones para una clave): no se publica esa entrada y la
  API aplica factor 1. Inventar un ajuste con cuatro datos sería peor que no ajustar.
- **Sin artefacto** (primer arranque, fichero ilegible): factor 1 en todo. El motor decide como antes.
- **Suelo de 0,35**: por muy redundantes que sean los votos, no se anula la señal. Con seis votos el
  peor caso posible es √(1/6) ≈ 0,408, así que hoy el suelo no llega a activarse; existe para cuando
  el consejo crezca (M13).

## Qué se ve en el Panel

Junto a la decisión aparece un chip **⚖ 48 %** cuando hay desinflado, con el detalle al pasar el
ratón. Si no aparece, es que esa temporalidad no tiene medición o sus votos son razonablemente
independientes.

## Lo que esto NO arregla

El desinflado corrige la *escala* de la confianza; no crea información que no existe. Seis votos que
valen 1,41 seguirán valiendo 1,41 después del ajuste. La única forma de que el comité vuelva a tener
miembros de verdad es **añadir evidencia que no derive del precio**: el sesgo macro, el funding, el
calendario, las noticias. Ese, y no «más información», es el argumento fuerte del análisis
fundamental (M11–M12), y ahora hay una métrica para juzgarlo: *¿cuántos votos efectivos añade?*

## ⚠ Esa métrica, sola, no sirve — hace falta un control de ruido

Medido el 19 de agosto de 2026 al evaluar el Analista de Niveles: **una columna de ruido aleatorio
añade entre +0,42 y +0,61 votos efectivos**, según la temporalidad. Más que el detector que se
estaba evaluando, en cinco de las siete.

La razón es aritmética. La participación de autovalores mide cuánta variabilidad **no compartida**
entra en el sistema, y el ruido, por definición, no comparte nada con nadie. La métrica premia por
igual a una fuente de información nueva y a un dado.

**Consecuencia práctica**: cualquier candidato a «eje independiente» —un agente nuevo, otra fuente
de datos, un indicador estructural— tiene que **superar el lift de una columna aleatoria** sobre la
misma muestra, no alcanzar un número absoluto. Doscientas repeticiones bastan para tener el p95.
Está implementado en `run_levels_study.py` y el caso completo, en
[analista-niveles-fase0.md](analista-niveles-fase0.md).

Y el corolario incómodo: superar el ruido demuestra que la fuente **es distinta**, no que **sirva**.
Para eso sigue haciendo falta la otra mitad, la de siempre: que prediga algo sobre decisiones reales
cerradas.
