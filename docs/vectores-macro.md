# Vectores macro: dólar y volatilidad implícita

> La vía externa se agotó. Dos vectores de otro mercado, genuinamente ortogonales, y **ninguno
> aporta**: 32 pruebas, **0 positivos**, 1,6 esperados por azar.

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
| estrés de volatilidad | 0/8 | 0/8 | **ruido** |

**Global: 32 pruebas, 0 positivos, 1,6 esperados por azar. p de que todo sea ruido = 1,000.**

No hay ni un positivo en las 32 pruebas, cuando el azar solo produce cero el 19 % de las veces.

### La primera medición daba un positivo, y era un artefacto

Cuando este estudio se corrió por primera vez salía **1 positivo**: `BTCUSDT:4h` con el estrés de
volatilidad, descartando altos, de +0,022 a +0,039 R. Ya entonces se leyó como ruido —1 de 8 sale el
34 % de las veces— y además caía en una temporalidad en cuarentena.

Resultó ser algo más concreto que ruido: **estaba medido sin descontar comisiones**. `BTCUSDT:4h`
tiene configuración optimizada y, por el fallo que corrige `ensemble.fusionar_optimizada`, esas
configuraciones no traían la sección `costs`. Con los costes aplicados, la base cae y el filtro deja
de superar el listón de viabilidad. El positivo desaparece.

Es un buen recordatorio de por qué el veredicto tiene dos niveles: el criterio de falsos positivos ya
lo había descartado antes de saber que además estaba mal medido.

## Lo que el marco volvió a frenar

Con los costes ya aplicados, **ninguna de las 32 pruebas supera la nula por bloques y llega a ser
viable a la vez**. En la primera medición, cuatro superaban la nula y la tercera condición —ser
viable— frenaba a tres, todas en 4h y dos en las claves que peor van. Ese patrón es el de siempre: en
una serie perdedora cualquier filtro «mejora», porque quitar operaciones sube la media hacia cero.

Con la base corregida el efecto es más limpio todavía: las bases son más negativas, así que la
condición de viabilidad es más difícil y no queda ni un candidato en pie.

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
