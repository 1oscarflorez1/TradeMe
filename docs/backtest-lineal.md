# El backtest, de O(N²) a O(N)

> Sin esto, alargar la ventana de optimización era imposible. Con esto, 208 días de 15m se recorren
> en medio segundo.

## El problema

`run_backtest` llamaba a `decide(high[:t+1], …)` en cada vela, y `decide` a `compute_readings`, que
recorre la serie entera en cada uno de sus ocho indicadores. Cada vela repetía todo el trabajo de
las anteriores.

| velas | segundos | ×tiempo | ×velas |
|---|---|---|---|
| 250 | 0,024 | 1,0 | 1,0 |
| 500 | 0,107 | 4,4 | 2,0 |
| 1.000 | 0,375 | 15,5 | 4,0 |

**Al doblar las velas, el tiempo se cuadruplica.** Multiplicar por diez la ventana llevaba el piloto
de ~9 minutos a más de 15 horas; por cien, a más de mil.

## Por qué el resultado es idéntico y no solo parecido

Los ocho indicadores son **prefijo-calculables**: el valor en `t` depende solo de datos hasta `t`.

- **EMA, RSI, ATR, ADX** — recursiones de Wilder sembradas con una media al principio de la serie.
  El valor en `t` sale del valor en `t-1` y de la barra `t`.
- **Estocástico y Bollinger** — ventanas de las últimas `period` barras.
- **Supertrend** — arrastra un estado (bandas finales + dirección) que se propaga hacia delante.

Ninguno mira al futuro. Por eso calcular la serie entera de una vez **no es una aproximación**: es
la misma cuenta hecha una sola vez en lugar de N veces.

## Qué se tocó, y qué no

- **`indicadores_series.py`** (nuevo): una versión «serie» de cada indicador. Emite el valor en cada
  índice en una sola pasada.
- **`decision.decidir_con_lecturas`**: el núcleo de `decide`, separado para recibir las lecturas ya
  calculadas y el precio. `decide` sigue existiendo igual y ahora es una fachada sobre él, así que
  **la lógica de decisión sigue escrita una sola vez**.
- **`indicators.py` NO se toca.** Sus funciones `*_last` son el mirror de Node y las que sostienen
  la suite de paridad. La corrección del módulo nuevo se define como «coincidir con ellas»: si
  alguna vez divergen, manda `indicators.py` y el test falla.

## La verificación

Dos tests, y ninguno admite tolerancia:

1. **Lecturas vela a vela**: para cada `t`, `readings_series(...)[t] == compute_readings(serie[:t+1])`
   en los ocho indicadores y sus tres campos. Igualdad exacta con `==`, no `isclose`.
2. **Operaciones del backtest**: `run_backtest` frente a un oráculo que reproduce literalmente la
   implementación anterior. Mismo número de operaciones, mismo índice, dirección, régimen, niveles,
   desenlace, barras y R.

Comprobado además contra datos reales de Binance en cuatro claves —BTCUSDT 15m, ETHUSDT 1h,
SOLUSDT 5m, BNBUSDT 30m—: **189 operaciones, diferencia máxima 0,000e+00** en todos los campos.

## El resultado

| velas | días de 15m | antes | ahora |
|---|---|---|---|
| 1.000 | 10 | 0,375 s | **0,023 s** |
| 5.000 | 52 | ~9 s | **0,113 s** |
| 10.000 | 104 | ~37 s | **0,242 s** |
| 20.000 | 208 | ~150 s | **0,536 s** |

El escalado es lineal: ×20 velas → ×22,7 tiempo. Y la muestra que produce el backtest crece con
ella: de **91 operaciones** con 1.000 velas a **1.874** con 20.000.

Eso es lo que este hito desbloquea. El cuello de la plataforma nunca fue la velocidad por sí misma:
era que con 30 días de producción y 22 bloques temporales útiles **ningún mecanismo podía demostrar
nada**. La producción no se puede acelerar; el backtest sí.

## Lo que sigue siendo cierto después

Linealizar no valida ninguna estrategia. Solo hace posible medirla con muestra suficiente. Alargar
la ventana de optimización es el paso siguiente, y ahora tiene un coste asumible: el piloto completo
sobre 20.000 velas son unos 7 minutos, frente a las 33 horas que habría costado antes.
