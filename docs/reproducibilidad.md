# Reproducibilidad del histórico

> ¿Se puede confiar en el desenlace que hay guardado? La respuesta no es «depende de la fecha».

## El problema

El histórico mezcla **cuatro** reglas de evaluación:

| desde | regla |
|---|---|
| el principio | 20 velas fijas para toda temporalidad |
| M10.5 (6-ago-2026) | `horizon_by_tf`, horizonte por temporalidad |
| 0.55.0 (24-ago-2026) | la ventana se acota **en tiempo**, no en número de velas |
| 0.72.0 (12-sep-2026) | la ventana arranca **en la captura**, no en la vela siguiente |

Un desenlace escrito con una regla vieja no es un dato «antiguo»: es **otra medición**. Y seguía
alimentando entera a cuatro consumidores —el entrenamiento del meta-modelo, el expediente de la
cuarentena, los estudios del Fundamental Score y la evaluación de sombra del meta-modelo—, ninguno
de los cuales filtraba.

## Por qué no se marca en una columna

Porque **el veredicto cambia con los datos**. Al rellenar los huecos de `candles`, una decisión que
hoy no reproduce pasa a reproducir en cuanto llegan sus velas: no había cambiado el desenlace, había
cambiado lo que se sabía de él. Una marca escrita hoy sería falsa mañana y habría que acordarse de
refrescarla — que es exactamente el fallo que el proyecto lleva varios hitos corrigiendo.

Así que no se marca: se **recalcula**. El estado derivado no se duplica.

## Por qué no se filtra por fecha

El corte del 6 de agosto parecía separar lo fiable de lo que no. No lo hace: de los 83 «timeout»
posteriores a esa fecha, **50 tampoco tenían ventana completa**. Se filtra por reproducibilidad.

## El criterio

`evaluacion.juzgar` reevalúa la decisión con la regla vigente y la compara con lo guardado, con la
misma asimetría que la evaluación real:

- Un toque de objetivo o de stop es **definitivo** aunque ocurra en la primera vela.
- Un «timeout» solo vale si de verdad transcurrió el horizonte completo.

Y distingue los dos motivos de descarte, que no significan lo mismo:

- **sin ventana** — le faltan velas. Se arregla rellenando huecos, y entonces vuelve a contar.
- **discrepante** — con sus velas completas sale otro desenlace. Ese sí estaba escrito con otra regla.

## Lo que se midió (24-ago-2026)

Sobre las **1.042** decisiones cerradas con `tp`/`sl`:

| | n | qué significa |
|---|---|---|
| reproducen | **564** | entran en los estudios |
| sin toque en ventana | 467 | de ellas, **464 es solo que le faltan velas** |
| discrepan | 11 | desenlace distinto con las velas completas |

Sumando las 3 que tienen ventana completa y aun así no reproducen: **14 discrepancias genuinas** de
1.042. Todo lo demás es falta de datos, no una medición equivocada.

**Predicción falsable:** cuando el relleno de huecos (0.56.0) se ponga al día, la muestra del
meta-modelo debería subir de 564 a cerca de 1.028. Si no sube, es que el relleno no está haciendo su
trabajo — y esa es justamente la gracia de tener la cifra en el log del piloto cada ciclo.

### Cómo salió la predicción (5-sep-2026): a medias, y lo interesante es por qué

Con el relleno ya al día —1m pasó de 118.606 velas ausentes a unas 3.000— la muestra reproducible
subió de 564 a **710 de 1.105**. Subió, pero no hasta las ~1.028 previstas. Las 354 que siguen fuera
se reparten en dos grupos que no significan lo mismo:

| | n | de la regla vieja |
|---|---|---|
| aún les faltan velas | 186 | 169 |
| **ventana completa y aun así sin toque** | **168** | 3 |

- Las **186** son decisiones **anteriores a la primera vela guardada** de su símbolo. El relleno
  cubre huecos *interiores* por diseño —no extiende la serie hacia atrás—, así que quedan fuera de
  su alcance. Recuperarlas exigiría sembrar histórico anterior, que es otra decisión.
- Las **168** son el hallazgo: con su ventana **completa** no hay ningún toque, y sin embargo están
  guardadas como `tp` o `sl`. Solo 3 son de la regla vieja. Son la huella directa del fallo de
  `LIMIT h`: se cerraron con velas tomadas de más allá de un hueco, donde sí había toque.

La predicción falló porque daba por hecho que todo lo descartado era falta de datos recuperable.
Una parte no lo era: **eran desenlaces falsos**, y el relleno no los arregla — los destapa. Que el
criterio siga descartándolos es exactamente lo que debe hacer.

## Una advertencia que costó descubrir

Una comprobación de reproducibilidad **solo vale si puede fallar por el motivo que se busca**.

La de `run_direccion_study` declaraba «coincidencia perfecta desde el 6-ago: 0 de 673». Pedía las
velas con `LIMIT h` **igual que la evaluación original**, así que verificador y verificado
compartían el mismo defecto: coincidían por repetir el error, no por ausencia de error. Con la
ventana acotada, de las 839 cerradas desde esa fecha ninguna cambia de desenlace pero 343 no tenían
ventana completa.

Por eso la ventana se pide **en un solo sitio**. Dos implementaciones de la misma regla es una
implementación de más, y la que se olvida siempre es la del verificador.

## La ventana arranca en la captura (0.72.0)

### El fallo

La evaluación en vivo pedía las velas con `ts > captured_at`. Una decisión diaria capturada a las
00:00:15 **excluía su propia vela** —que abre a las 00:00:00— y se evaluaba desde el día siguiente:
**se ignoraban las primeras 24 horas de cada operación de 1d**, y el «timeout» cerraba una vela más
tarde que en el backtest. Un stop tocado el mismo día de la decisión no contaba; uno tocado el día
11 sí.

Salió al medir la paridad entre vivo y backtest: las decisiones coincidían (27 de 27 operables),
pero varios desenlaces de ETHUSDT:1d cambiaban con la ventana del backtest.

### Por qué no basta con incluir la vela entera

Excluirla tenía una razón: una decisión capturada a las 14:22 no puede ganar ni perder por lo que
el precio hizo a las 09:00, y la vela diaria entera lo contaría. Así que la vela de captura se
recorre con **velas más finas posteriores a la captura** (1h para 1d, 15m para 4h… ver
`ventana.FINA`) y, a partir de la siguiente, con las de su temporalidad. Se pierde como mucho un
periodo fino —una hora en 1d— y no entra nada anterior a la decisión.

La vela de captura cuenta como **la primera de las h**, igual que en el backtest: la trayectoria
cierra al final de la vela D+h−1. Hay un test que exige el mismo desenlace que `evaluate_trade`
sobre la misma ventana.

La definición vive en **un solo sitio**, `ventana.trayectoria`, y la usan el evaluador (real y
sombra), el filtro de reproducibilidad, el contador de bloqueadas y la reevaluación del histórico.

### El filtro compara también el R

`juzgar` comparaba solo la **clase** de resultado. Casi todo lo que cambia con la ventana son
timeouts que siguen siendo timeouts pero cierran a otro precio: comparando solo la clase, el
filtro **no podía fallar por el motivo que se buscaba** — la advertencia de abajo, otra vez. Desde
0.72.0 exige también el mismo R, con tolerancia de redondeo (`TOLERANCIA_R = 1e-6`).

## La reevaluación del histórico

Desplegar la ventana nueva sin tocar lo guardado dejaría fuera del expediente todo lo que cambia:
el filtro lo recalcularía con la regla nueva y lo daría por discrepante. Así que
`python -m trademe_quant.reevaluar_desenlaces` recalcula cada desenlace guardado **con la misma
función que el evaluador** y lo clasifica:

- **igual** — no se toca.
- **cambia** — se reescribe con `--aplicar`, guardando antes una copia en `artifacts/` con el valor
  anterior y el nuevo de cada fila. `evaluated_at` no se modifica.
- **no recalculable** — le faltan velas y hoy no puede cerrarse. **No se toca**: borrarlo lo dejaría
  pendiente para siempre. El filtro lo sigue excluyendo.

Sin `--aplicar` es un informe en seco y no escribe nada.

### Informe en seco sobre producción (12-sep-2026)

| rama | desenlaces | iguales | cambian | no recalculables |
|---|---|---|---|---|
| real | 1.743 | 997 | 470 | 276 |
| sombra | 2.130 | 1.579 | 550 | 1 |

Los 276 no recalculables de la rama real son todos anteriores al 6-ago-2026, sobre todo de 1m y 5m,
cuyas velas de entonces no están guardadas.

**Filas que cuentan como evidencia** para la cuarentena y el meta-modelo:

| rama | hoy (0.71.1) | desplegado sin reescribir | desplegado y reescrito |
|---|---|---|---|
| real | ~1.212 | 997 | 1.467 |
| sombra | ~2.014 | 1.579 | 2.129 |

La columna del medio es la razón del orden: **desplegar y reescribir van seguidos**. La de hoy es
aproximada: reproduce el filtro anterior fuera de la base.

### Qué explica cada cambio

Lo importante no es cuántas filas cambian sino **por qué**. Sobre los cambios posteriores al
6-ago-2026, comprobando cada uno contra la regla anterior:

| | real | sombra | qué es |
|---|---|---|---|
| la regla anterior reproduce lo guardado exactamente | 130 | 353 | **solo la ventana** |
| evaluadas después del 25-ago, reproducen con horizonte 20 | 7 | 51 | horizonte equivocado |
| evaluadas antes del 25-ago, reproducen con horizonte 10, 20, 25 o 30 | 73 | 28 | horizonte equivocado |
| evaluadas antes del 25-ago, ningún horizonte probado las reproduce | 132 | 118 | compatible con `LIMIT h` sobre huecos |

Las dos últimas filas son un hallazgo aparte: **desenlaces que ya estaban mal con su propia regla**.

- **Horizonte 20 en 4h y 1h.** Cuatro configuraciones optimizadas de BTC (15m, 30m, 1h y 1d) no
  tienen `horizon_by_tf`. Hasta 0.68.0 **sustituían** al yaml entero, y la evaluación de todas las
  decisiones pendientes se lanza desde el backtest de una clave con la configuración de esa clave:
  cuando la clave era una de esas cuatro, todo se evaluaba con el horizonte por defecto, 20. Desde
  0.68.0 la fusión conserva `evaluation` del yaml base. Los horizontes 25 y 30 anteriores son los
  de 5m y 1m, compatibles con el mismo mecanismo; no se ha reconstruido exactamente.
- **Sin horizonte que las reproduzca** (probados 10, 15, 18, 20, 25 y 30). Evaluadas antes de
  acotar la ventana en tiempo (0.55.0). En los timeouts, el cierre guardado coincide casi siempre
  con velas **posteriores** a la ventana, que es la huella de `LIMIT h` sobre series con huecos que
  el relleno cubrió después: lo que ya describía la sección de 5-sep, ahora también en timeouts.

Muchas de estas filas **pasaban el filtro anterior**: la clase coincidía —timeout con timeout— y el
R no se miraba. Todo lo evaluado después del 25-ago que cambia está explicado: o es la ventana o es
el horizonte 20.

### En las claves que operan

Primera captura de cada vela, rama real, expectancy en R:

| clave | velas | bruta antes | bruta después | neta antes | neta después |
|---|---|---|---|---|---|
| ETHUSDT:1d | 6 | −0,167 | −0,210 | −0,191 | −0,235 |
| SOLUSDT:1d | 7 | −0,143 | −0,143 | −0,165 | −0,165 |

Cambian 4 velas de ETH, todas timeouts que siguen siéndolo: la del 21-ago pasa de +0,38 a +0,76, la
del 24 de +0,54 a −0,31, la del 25 de −0,19 a +0,19 y la del 26 de +0,27 a +0,09. **Con 6 y 7 velas
esto no dice nada del rendimiento**; lo que dice es que ahora vivo y backtest miden lo mismo.

