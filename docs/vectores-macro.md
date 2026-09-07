# Vectores macro: dólar y volatilidad implícita

> La vía externa se agotó. Dos vectores de otro mercado, genuinamente ortogonales, y **ninguno
> aporta**: 32 pruebas, 1 positivo, 1,6 esperados por azar.

## Lo primero: los índices no existen en el plan gratuito

`DXY` y `VIX` devuelven **404** en Twelve Data, y su buscador de símbolos no los tiene. No es una
restricción del plan que se pueda sortear pagando poco: son índices con licencia propia, y el
catálogo gratuito solo ofrece **réplicas cotizadas**.

| proxy | qué replica | mercado | histórico |
|---|---|---|---|
| `UUP` | Invesco DB US Dollar Index | NYSE | **4.911 sesiones**, desde 2007 |
| `VXX` | futuros del VIX a corto plazo | CBOE | **2.165 sesiones**, desde 2018 |

Profundidad de sobra. Los problemas están en otro sitio, y son dos.

### El nivel de VXX no es el nivel del VIX

Su cierre pasa de **1.770 a 17,72** entre 2018 y 2026. No es un error de datos ni un split sin
ajustar —la serie viene ajustada—: es que mantener futuros de volatilidad cuesta dinero, y en ocho
años ese coste se come el 99 %. Un vector sobre el **nivel** de VXX mediría sobre todo el paso del
tiempo.

Lo que sí sobrevive son sus **variaciones**. Sus cinco saltos de más del 25 % en un día son
Volmageddon (feb-2018), el COVID (mar-2020), junio de 2020, Ómicron (nov-2021) y el desarme del carry
del yen (ago-2024). Ahí sigue al VIX de verdad. Por eso el vector de estrés es un cambio logarítmico
y nunca un nivel, y hay un test que lo fija: **duplicar toda la serie no cambia ni un valor**.

### Dos mercados con horarios distintos

UUP y VXX cotizan seis horas y media, de lunes a viernes. El cripto opera 24/7. Emparejarlos es la
mitad del trabajo de este hito, y es donde se cuela el look-ahead más fácil de cometer: usar el
cierre del día D en una vela que empezó ese mismo día.

La regla es deliberadamente conservadora: **la sesión del día D está disponible a partir de las
00:00 UTC del día D+1**. El cierre real es a las 16:00 de Nueva York —20:00 o 21:00 UTC según el
horario de verano—, así que esperar al cambio de día sobra de margen y ahorra razonar sobre husos,
que es justo donde se cometen estos errores.

Sin dato fresco se **arrastra el último conocido**, que es literalmente lo que tiene delante quien
opera un domingo. No se interpola: interpolar inventaría sesiones que no existieron, el mismo motivo
por el que el relleno de huecos solo toca símbolos de Binance.

El coste de esa regla, medido sobre el calendario real de UUP:

| antigüedad del dato macro | días | % |
|---|---|---|
| 1 día | 4.911 | 68,9 % |
| 2 días | 1.067 | 15,0 % |
| 3 días | 1.018 | 14,3 % |
| 4–5 días | 132 | 1,8 % |

Media de **1,49 días**. Sobre ventanas de veinte sesiones es ruido — pero es la diferencia entre un
vector macro y uno de precio, y por eso se mide en vez de suponerse.

## Los dos vectores

1. **Tendencia del dólar** — z-score del cierre de UUP frente a su media y desviación de las últimas
   **20 sesiones**. Positivo = dólar fuerte *para lo que ha estado siendo*. El nivel en dólares no
   es comparable entre 2007 y 2026; el z-score sí, porque pregunta por el régimen.
2. **Estrés de volatilidad** — cambio logarítmico del cierre de VXX en **5 sesiones**. Positivo = la
   volatilidad implícita ha subido esta semana. El logaritmo y no el porcentaje porque estas
   variaciones son grandes y asimétricas: un +100 % y un −50 % son el mismo viaje de ida y vuelta.

**Solo dos, y a propósito.** Cada candidato se prueba en 8 claves × 2 reglas, y cada prueba tiene un
5 % de salir positiva por azar. Un tercer vector poco motivado no aumenta la probabilidad de
encontrar algo: aumenta la de encontrar **ruido con aspecto de algo**.

## La ortogonalidad, esta vez de verdad

Los vectores de precio salían de la misma serie que la decisión y rondaban correlaciones de 0,17.
Estos vienen de otro mercado:

| vector | correlación máxima con un voto existente |
|---|---|
| tendencia del dólar | **−0,129** (ema_cross) |
| estrés de volatilidad | **−0,171** (ema_cross) |

Es información que el ensemble no puede deducir de su propia serie por mucho que la mire. Lo que
sigue es el resultado de que esa información, siendo nueva, no sirva para nada.

## Resultados

| vector | descartar bajos | descartar altos | veredicto |
|---|---|---|---|
| tendencia del dólar | 0/8 | 0/8 | **ruido** |
| estrés de volatilidad | 0/8 | 1/8 (p = 0,337) | **ruido** |

**Global: 32 pruebas, 1 positivo, 1,6 esperados por azar. p de que todo sea ruido = 0,806.**

Ningún vector+regla se acerca a los tres positivos que harían falta. Y hay algo peor que el número:

**El único positivo está en `BTCUSDT:4h`, que lleva en cuarentena estructural desde 0.63.0.** Aunque
fuera real —y con 1 de 8 no lo es—, sería un hallazgo sobre decisiones que hoy no se toman. En 1d,
la única temporalidad que opera, **no hay ni un solo positivo en las 16 pruebas**.

## Lo que el marco volvió a frenar

De las 32 pruebas, **4 superaron la nula por bloques**. De esas cuatro, la tercera condición —ser
viable— frenó **tres**:

| clave | vector | base → filtrada | lift vs nula |
|---|---|---|---|
| SOLUSDT:4h | tendencia del dólar | −0,105 → **−0,062** | +0,043 > 0,041 |
| BNBUSDT:4h | estrés de volatilidad | −0,074 → **−0,040** | +0,034 > 0,033 |
| ETHUSDT:4h | estrés de volatilidad | −0,005 → **+0,010** | +0,0154 > 0,0145 |

Las tres en 4h, y las dos primeras en las claves que peor van. Es el patrón de siempre: en una serie
perdedora cualquier filtro «mejora», porque quitar operaciones sube la media hacia cero. Con un
criterio de solo dos condiciones habríamos aprobado tres filtros que pierden menos dinero, no que lo
ganen.

## Qué queda después de tres estudios

Funding, precio y macro. Tres direcciones, **seis vectores**, **96 pruebas** y **12 veredictos de
vector y regla**. El mismo resultado en las tres: no aparece ventaja en ninguna.

Eso ya no es una serie de negativos sueltos. Es un hallazgo con forma propia: **el problema no es que
falte una variable**. La expectancy bruta del ensemble es ≈0 en todas las temporalidades (+0,003 a
+0,037 sobre miles de operaciones), y filtrar entradas de un motor sin ventaja no crea ventaja — solo
reparte la misma nada entre menos operaciones. Un filtro multiplica lo que ya hay; si lo que hay es
cero, el producto es cero por bueno que sea el filtro.

Lo que sigue sin explorarse, y ahora por razones distintas:

- **Interés abierto y long/short**: Binance solo da 30 días. La ingesta los acumula desde M11, así
  que dentro de un año habrá con qué medir.
- **Microestructura** (libro de órdenes, flujo de agresores): no hay histórico público.
- **La gestión de la operación** —dónde se pone el stop, cuándo se mueve, cuándo se sale— que es la
  única palanca que **no** depende de acertar más veces, y la única que estos tres estudios no han
  tocado.

## Cómo reproducirlo

Una vez, para traer las series (dos créditos de Twelve Data):

```
docker exec trademe-prod-quant-1 python -m trademe_quant.descargar_macro
```

Y el estudio, cuantas veces haga falta, ya sin red:

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_alfa_macro
```

Las series quedan en `artifacts/macro_series.json` y el informe en
`artifacts/alfa_vectores_macro.json`.
