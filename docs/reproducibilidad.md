# Reproducibilidad del histórico

> ¿Se puede confiar en el desenlace que hay guardado? La respuesta no es «depende de la fecha».

## El problema

El histórico mezcla **tres** reglas de evaluación:

| desde | regla |
|---|---|
| el principio | 20 velas fijas para toda temporalidad |
| M10.5 (6-ago-2026) | `horizon_by_tf`, horizonte por temporalidad |
| 0.55.0 (24-ago-2026) | la ventana se acota **en tiempo**, no en número de velas |

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
