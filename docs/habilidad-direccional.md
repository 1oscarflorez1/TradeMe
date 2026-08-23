# ¿Elige TradeMe la dirección mejor que una moneda?

> **No, con los datos de agosto de 2026.** El mercado regalaba **+0,626 R** a quien se pusiera largo
> sin pensar, y la plataforma sacó **+0,035 R**. Casi todo lo que gana en largos es deriva, y sus
> cortos rinden **peor** que ponerse corto al azar.

## El hecho que abre la pregunta

Sobre las decisiones cerradas de producción:

| dirección | n | expectancy | aciertos |
|---|---|---|---|
| LONG | 586 | **+0,488 R** | 53,9 % |
| SHORT | 632 | **−0,309 R** | 28,3 % |
| TOTAL | 1218 | +0,074 R | 40,6 % |

Con la relación 2:1, el punto de equilibrio está en **33,3 %** de aciertos. Los largos lo baten con
holgura; los cortos quedan por debajo. Y se emiten **más cortos que largos**.

Eso admite dos explicaciones que nadie había separado: **habilidad** (la plataforma acierta al
elegir y los cortos tienen un defecto propio) o **deriva** (el mercado subió, así que cualquier
largo ganaba y cualquier corto perdía).

## El contrafactual: qué habría pasado apostando al revés

Cada decisión guardó su plan —entrada, stop y objetivo— al tomarla. El **plan espejo** es ese mismo
plan con la dirección invertida y los niveles reflejados sobre la entrada: mismo riesgo, misma
relación, dirección opuesta. Evaluado con **`backtest.evaluate_trade`** —el evaluador real del
proyecto, no una reimplementación— contra las mismas velas y el mismo `horizon_by_tf`.

Reflejar y no reconstruir es lo que hace la comparación limpia: un corto que la plataforma hubiera
generado de verdad habría tenido su propio dimensionamiento a partir del ATR, y estaríamos midiendo
dos cosas a la vez. Con el espejo, lo único que cambia es el signo de la apuesta.

Y la nula: **elegir la dirección a cara y cruz, una tirada por bloque de 24 h**. Por bloque y no por
decisión, porque las decisiones de un mismo tramo comparten mercado — sortearlas por separado
promediaría la deriva hasta hacerla desaparecer y daría una nula artificialmente estrecha.

## Lo que salió

```
  obs = lo que hizo la plataforma · largo/corto = apostar siempre a un lado (la deriva)
  moneda = elegir la dirección a cara y cruz, una tirada por bloque de 24 h

  TODAS      n=970  obs=+0.035R  largo=+0.626  corto=-0.418  moneda p50=+0.102 p95=+0.257  no supera
  LONG       n=442  obs=+0.658R  largo=+0.658  corto=-0.337  moneda p50=+0.160 p95=+0.644  supera
  SHORT      n=528  obs=-0.486R  largo=+0.599  corto=-0.486  moneda p50=+0.054 p95=+0.540  no supera

  15m        n=328  obs=-0.228R  largo=+0.368  corto=-0.285  moneda p50=+0.040 p95=+0.375  no supera
  1d         n= 66  obs=+1.091R  largo=+1.782  corto=-1.000  moneda p50=+0.382 p95=+0.964  supera
  1h         n= 85  obs=-0.530R  largo=+0.928  corto=-0.424  moneda p50=+0.249 p95=+0.950  no supera
  1m         n= 64  obs=-0.016R  largo=+1.297  corto=-0.578  moneda p50=+0.359 p95=+0.828  no supera
  30m        n=292  obs=+0.347R  largo=+0.813  corto=-0.509  moneda p50=+0.149 p95=+0.475  no supera
  4h         n= 95  obs=-0.151R  largo=-0.726  corto=-0.119  moneda p50=-0.411 p95=-0.004  no supera
```

### Lo que aporta *elegir*, descontada la deriva de cada lado

| | la plataforma | apostar siempre a ese lado | **aportación de elegir** |
|---|---|---|---|
| en largos | +0,658 R | +0,626 R | **+0,032 R** |
| en cortos | −0,486 R | −0,418 R | **−0,068 R** |

Ese es el resultado. **Casi todo el +0,658 R de los largos es deriva**: elegir cuáles solo añadió
+0,032 R. Y en los cortos, elegir cuáles **restó** 0,068 R respecto a ponerse corto sin criterio.

### El «supera» de los largos no significa lo que parece

Dentro del subconjunto de los largos, la moneda incluiría cortos, que en un mercado alcista pierden.
Superarla ahí es casi automático y **no es evidencia de habilidad direccional**. La comparación que
vale es la de la tabla de arriba: contra el propio lado.

## Veredicto

**La plataforma no tiene habilidad direccional demostrable en este periodo.** Su resultado no supera
al percentil 95 de la moneda; ni siquiera llega a su mediana (+0,102 R).

Y hay algo peor que «no aportar»: el mercado ofrecía +0,626 R gratis y la plataforma acabó en
+0,035 R. Emitiendo **528 cortos frente a 442 largos** en un tramo alcista, se comió la ventaja que
tenía delante.

Eso encaja con todo lo demás que se ha medido este mes y le da sentido: el meta-modelo no encuentra
señal (AUC 0,4967), cinco de los seis votos no aportan información incremental, el CVD la empeora y
el Analista de Niveles no la aporta. **Ninguno de esos hallazgos era el problema: eran síntomas de
este.**

## Salvedades, que son importantes

**Un solo régimen.** Veintisiete días de mercado alcista. En un tramo bajista, «siempre largo» sería
ruinoso y los cortos brillarían. Esto **no demuestra que la plataforma sea mala en general**;
demuestra que en este periodo no aportó habilidad y perdió la deriva que tenía a favor.

**«Siempre largo» no es una estrategia.** No tiene gestión de riesgo ni sabe cuándo parar. Es el
listón correcto para «¿aportaste algo al elegir?», no una alternativa que se pueda operar.

**El espejo es una idealización.** Asume niveles simétricos; un corto real habría dimensionado con su
propio ATR. La diferencia debería ser pequeña, pero existe.

## Un hallazgo secundario: el histórico mezcla dos reglas de evaluación

Al comprobar la coherencia —reevaluar el plan **real** y compararlo con lo guardado— fallaron **248
de 1.218**, todas anteriores al 6 de agosto, y con exactamente 15, 18, 25 o 30 velas disponibles: los
valores de `horizon_by_tf`, que se introdujo en M10.5. Antes eran 20 fijas para todo.

Desde el 6 de agosto la coincidencia es perfecta (0 de 673). El estudio descarta lo no reproducible
y lo dice; descartar por eso no sesga el veredicto, porque el horizonte de una decisión depende de su
temporalidad y de cuándo se evaluó, no de cómo acabó.

**Afecta a cualquier análisis que use `outcome_return_r` del histórico antiguo**, el entrenamiento
del meta-modelo incluido.

## Qué se puede hacer con esto

No se ha tocado nada de producción: esto es una medición. Lo que abre, por orden de lo más directo a
lo más especulativo:

1. **El sesgo direccional es medible y corregible.** Emitir más cortos que largos en un mercado
   alcista es el error concreto. El escudo macro (`MACRO_ENABLED`, hoy apagado) existe precisamente
   para empujar hacia la tendencia de fondo — y en M11 se midió que en 4h habría reforzado los
   cortos malos, así que **no basta con encenderlo**: habría que medirlo con esta misma vara.
2. **La cuarentena podría actuar por dirección**, no solo por temporalidad. Hoy veta claves enteras;
   los datos dicen que el problema tiene lado.
3. **Repetir esta medición en un tramo bajista** antes de concluir nada estructural. Es la salvedad
   que más pesa.

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_direccion_study
```
