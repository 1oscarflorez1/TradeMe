# Vectores nativo-precio

> Tres candidatos derivados del precio, ortogonales de verdad a los ocho indicadores.
> **Ninguno aporta.** Y el marco frenó cuatro filtros que habrían pasado con un criterio peor.

## Por qué del precio

Los candidatos externos se agotaron por falta de datos: interés abierto y long/short solo dan
**30 días** de histórico en Binance, y DXY/VIX exigen una clave de Twelve Data que no está
configurada. El precio, en cambio, tiene todo el histórico — hasta 2017 en 1d.

La apuesta: los ocho indicadores actuales describen **dirección** (EMA, MACD, Supertrend) y
**posición en un rango** (RSI, Bollinger, Estocástico). Ninguno describe la **forma** de la vela ni
el **estado** de la volatilidad.

## Los tres

1. **Asimetría de mechas** — `(mecha superior − mecha inferior) / rango`. Proxy de rechazo: una vela
   con mecha superior larga es precio que subió y fue devuelto. Necesita la apertura para separar
   cuerpo de mechas, de ahí `velas.series_ohlc`.
2. **Ratio de Parkinson** — volatilidad de rango frente a la de cierre-cierre. Distingue dos estados
   que la volatilidad sola confunde: mucho recorrido con poco avance —agitación— frente a poco
   recorrido con avance limpio —tendencia ordenada—.
3. **Compresión ATR** — `ATR(5) / ATR(30)`. Por debajo de 1 la volatilidad se comprime; por encima,
   se expande. Reutiliza `atr_series` en vez de redefinir el ATR: una segunda definición podría
   divergir de la primera sin que nadie lo notase.

Los tres son **prefijo-calculables** y hay un test que lo comprueba: el valor en `t` sobre la serie
truncada en `t` debe ser idéntico al de la serie entera. Es la condición que `alfa.py` exige y no
puede verificar por sí mismo.

## La ortogonalidad, comprobada antes de juzgar

Era una hipótesis, no una premisa. Medida sobre BTCUSDT:1d (3.308 velas):

| vector | correlación máxima con un voto existente |
|---|---|
| asimetría de mechas | **0,10** (bbands) |
| ratio de Parkinson | **0,17** (atr14) |
| compresión ATR | **0,17** (atr14) |

Los tres describen algo que el ensemble no mira. La hipótesis se sostiene — lo que no se sostiene es
que eso sirva para algo.

## El problema que había que resolver antes de mirar resultados

Son **3 vectores × 2 reglas × 4 símbolos × 2 temporalidades = 48 pruebas**, cada una contra un
listón del percentil 95. Sin más, el azar produce **2,4 positivos**, y el primero que salga parece un
hallazgo.

Por eso el veredicto tiene dos niveles y solo cuenta el segundo (`alfa.p_falsos_positivos`):

| positivos de 8 claves | p |
|---|---|
| 1 | 0,337 |
| 2 | 0,057 |
| **3** | **0,006** |

**Un vector que gana en una clave no ha demostrado nada. Uno que gana en tres, sí.**

## Resultados

| vector | descartar bajos | descartar altos | veredicto |
|---|---|---|---|
| asimetría de mechas | 1/8 (p = 0,337) | 1/8 (p = 0,337) | **ruido** |
| ratio de Parkinson | 0/8 | 0/8 | **ruido** |
| compresión ATR | 1/8 (p = 0,337) | 1/8 (p = 0,337) | **ruido** |

**Global: 48 pruebas, 4 positivos, 2,4 esperados por azar. p de que todo sea ruido = 0,218.**

Ningún vector+regla llega a los tres positivos que harían falta. Y los cuatro que salen están
repartidos entre vectores y reglas distintas, sin patrón — si hubiera señal real, se concentrarían.

El más limpio en su negativa es el **ratio de Parkinson**: 0 de 16 pruebas. La hipótesis de que
distinguir agitación de tendencia ayudase a filtrar entradas queda descartada con claridad.

## Lo que el marco frenó, y por qué importa

De las 48 pruebas, **8 superaron la nula por bloques**. De esas ocho, **la tercera condición —ser
viable— frenó cuatro**:

| clave | vector | base → filtrada | lift vs nula |
|---|---|---|---|
| SOLUSDT:4h | asimetría de mechas | −0,105 → **−0,052** | +0,053 > 0,040 |
| SOLUSDT:4h | ratio de Parkinson | −0,105 → **−0,063** | +0,042 > 0,040 |
| SOLUSDT:4h | compresión ATR | −0,105 → **−0,051** | +0,054 > 0,040 |
| BNBUSDT:4h | asimetría de mechas | −0,078 → **−0,030** | +0,047 > 0,035 |

Las cuatro están en las claves que **peor van**. Ahí cualquier filtro «mejora», porque quitar
operaciones de una serie perdedora sube la media hacia cero — y las cuatro siguen siendo un negocio
ruinoso después de filtrar.

Con un criterio de solo dos condiciones —muestra y superar la nula— habríamos aprobado cuatro
filtros que únicamente pierden más despacio. Es el mismo fallo que 0.54.0 corrigió en el
optimizador, y esta vez el marco lo paró solo.

## Qué queda

La conclusión acumulada de los dos estudios de alfa —funding y precio— es la misma: **no aparece
ventaja en ninguna dirección explorada**. Ni en el apalancamiento, ni en la forma de la vela, ni en
el estado de la volatilidad.

Eso no cierra la búsqueda, pero sí acota dónde no está. Lo que queda sin explorar por falta de datos,
no de ideas:

- **Interés abierto y long/short**: la ingesta los acumula desde M11; dentro de un año habrá
  histórico para medirlos.
- **DXY, VIX y macro**: exigen `TWELVEDATA_API_KEY`, y habría que comprobar su histórico antes de
  contar con ellos.
- **Microestructura** (libro de órdenes, flujo de agresores): Binance no la publica con histórico.

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_alfa_precio
```
