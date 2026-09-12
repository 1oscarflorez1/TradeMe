# Qué opera de verdad, y por qué solo dos claves

> Desde 0.70.0 solo emiten señal **`ETHUSDT:1d`** y **`SOLUSDT:1d`**. Aquí está la evidencia que lo
> sostiene y, con el mismo detalle, la que no.

## El mecanismo

`active_keys` en el `ensemble.yaml` lista las claves `SÍMBOLO:intervalo` autorizadas a emitir. Vacía
o ausente, no restringe nada — que es el comportamiento de todo el histórico anterior.

**Restringe, nunca habilita.** Una clave que esté en la lista pero además en cuarentena sigue
vetada: el veto efectivo es un `OR` de los dos filtros. Escrito así a propósito, porque una lista
blanca que pudiera levantar una cuarentena sería una puerta trasera al gobierno — bastaría añadir un
nombre a un fichero para deshacer un veto que se puso con evidencia. Hay un test que lo fija.

Estado efectivo resultante, comprobado de extremo a extremo sobre el yaml desplegado:

| filtro | qué veta |
|---|---|
| `quarantine_intervals` | 15m, 30m, 1h, 4h en todos los símbolos |
| `active_keys` | todo lo demás salvo `ETHUSDT:1d` y `SOLUSDT:1d` |
| **emiten** | **`ETHUSDT:1d` · `SOLUSDT:1d`** |

Un efecto que conviene tener presente: **1m y 5m nunca estuvieron en cuarentena** y ahora quedan
vetadas por la lista. Es deseado, pero es un cambio de comportamiento y no una consecuencia
automática de lo anterior.

## Por qué estas dos, y qué demuestra realmente

Decir «son las dos mejores» sobre el mismo histórico con el que se midieron sería **selección
post-hoc**: con cuatro claves, la mejor está sesgada al alza por construcción. Es el mismo error que
el optimizador cometía, y no se arregla mirando el número otra vez.

Así que se probó la **regla**, no el resultado. Walk-forward con 21 cortes trimestrales: seleccionar
las `K` mejores con todo lo anterior y operarlas en el trimestre siguiente.

| K | seleccionadas | operar las 4 | media por trimestre |
|---|---|---|---|
| 1 | +0,0385 R | −0,0130 R | +0,0252 |
| **2** | **+0,0388 R** (n=437) | −0,0130 R | **+0,0431** |
| 3 | −0,0032 R | −0,0130 R | +0,0039 |

Las dos primeras columnas son expectancies agregadas sobre todas las operaciones; la tercera es la
media de la diferencia **trimestre a trimestre**, que es la que lleva el bootstrap. No coinciden, y
no deberían: la agregada pesa más los trimestres con más operaciones.

**K=2 es el óptimo**, con +0,043 R por trimestre sobre operar las cuatro. Y la regla es **estable**:
eligió SOL y ETH en los 21 trimestres, sin rotar una sola vez.

### Lo que esa cifra no demuestra

Conviene decirlo con la misma claridad, porque es lo que impide sobrevender la decisión:

- **El bootstrap por trimestres da P5 = −0,015.** La ventaja no alcanza significancia con el listón
  que este proyecto exige en todo lo demás. 14 de 21 trimestres salen positivos, que con una moneda
  al aire ocurre el 9,5 % de las veces.
- **Ninguna clave llega a 2 sigmas por separado**: SOL +0,106 sobre 271 operaciones son 1,52 σ; ETH
  +0,059 sobre 402, 1,05 σ.
- **El ranking no es estable en el tiempo.** Por mitades del histórico:

| clave | total | 1ª mitad | 2ª mitad (desde ene-2022) |
|---|---|---|---|
| SOLUSDT:1d | +0,106 | +0,143 | +0,070 |
| ETHUSDT:1d | +0,059 | +0,102 | **+0,016** |
| BTCUSDT:1d | −0,020 | −0,068 | **+0,028** |
| BNBUSDT:1d | −0,043 | −0,001 | −0,086 |

En la segunda mitad **BTC supera a ETH**, y la ventaja de ETH casi desaparece.

### El argumento que sí se sostiene

No es «elegimos las dos mejores» sino **«excluimos las que pierden»**, y esa versión es más robusta:

- **BNBUSDT:1d pierde en todos los tramos** (−0,001 y −0,086). Excluirla no depende de ningún
  ranking.
- **BTCUSDT:1d es el caso frontera**: −0,020 en total, pero +0,028 en la segunda mitad, por encima
  del umbral de viabilidad. La regla walk-forward nunca lo eligió en 21 trimestres, así que
  operativamente da igual — pero es la clave que habría que revisar primero si esto se reabre.

Concentrar no crea ventaja: **evita pérdida esperada**. Es la misma lección que el resto del
proyecto, y por eso funciona cuando nada de lo que se añadió funcionó.

## Cuándo revisar esto

La lista está fijada a mano y **no se actualiza sola**, a propósito: una regla que rotase claves cada
trimestre perseguiría el ruido, y ya se vio lo que eso hace con el optimizador. Merece revisarse
cuando:

- una clave excluida acumule un tramo largo por encima del umbral de viabilidad — **BTCUSDT:1d es la
  candidata**;
- o una incluida caiga por debajo de forma sostenida, que es lo que la cuarentena por expediente ya
  vigila por su cuenta.

## Cómo reproducir la medición

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_lista_blanca
```
