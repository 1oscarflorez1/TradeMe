# La ventana de optimización

> Con 1.000 velas el hold-out eran 25 operaciones. Con 20.000 son 445, y lo primero que se ve con
> esa muestra es que **el optimizador no aporta**.

## De dónde venía el tope

`fetch_klines` hacía una sola petición, y Binance devuelve como máximo 1.000 velas. Esas 1.000 velas
eran toda la ventana con la que se medía, se calibraba y se optimizaba: en 15m, **diez días**.

De ahí salían hold-outs de 11 a 32 operaciones. Con esa muestra ningún criterio de promoción puede
distinguir una mejora de una racha, y el guardia de 0.54.0 frenaba el 100 % de las promociones —
tenía razón en hacerlo, pero dejaba al optimizador inutilizado.

Paginar siempre fue trivial. Lo que era caro es lo que se hace con las velas: con el backtest
cuadrático anterior, 20.000 velas habrían llevado el piloto a más de treinta horas. Por eso este
hito va **después** de linealizarlo.

## Cuánta ventana, y por qué

Medido sobre BTCUSDT:15m con 40 trials, ya con el backtest lineal:

| velas | días | una optimización | piloto (20 claves) | hold-out |
|---|---|---|---|---|
| 1.000 | 10 | 1,7 s | 0,6 min | **25** |
| 5.000 | 52 | 5,0 s | 1,7 min | 133 |
| 10.000 | 104 | 10,0 s | 3,3 min | 232 |
| **20.000** | **208** | **19,3 s** | **6,4 min** | **445** |

`VELAS_POR_DEFECTO = 20.000`. Se expresa en **velas** y no en días porque lo que decide si una
medición vale es el número de observaciones, no el calendario. En temporalidades largas Binance da
menos y la paginación se detiene sola: BTCUSDT en 1d devuelve 3.307 velas —todo lo que existe, desde
agosto de 2017— sin fallar.

## La caché, y por qué hacía falta

Con 1.000 velas daba igual: eran 200 kB y una petición. Con 20.000 cada clave son veinte peticiones
y unos nueve segundos, y en un mismo ciclo las piden el backtest, la calibración y el optimizador.
Sin caché, sesenta descargas por ciclo: unos nueve minutos solo de red.

`velas.series` cachea las series **ya normalizadas**, no las filas crudas: 20.000 velas crudas ocupan
14 MB y las tres listas de float que usa el backtest, 1,9 MB. Veinte claves pasan de 280 MB a 38.

El TTL es de treinta minutos, holgado a propósito: el backtest mide historia, no el presente, y media
hora de desfase sobre 208 días no cambia ninguna medición.

**El ciclo sigue cabiendo**: 3,5 minutos cuando solo mide, unos 10 cuando además optimiza — y la
optimización es semanal.

## Lo primero que se ve con muestra suficiente

| clave | n hold-out | base | optimizada | veredicto |
|---|---|---|---|---|
| BTCUSDT:15m | 445 | **+0,074** | −0,019 | no promociona |
| BTCUSDT:30m | 468 | **+0,007** | −0,065 | no promociona |
| ETHUSDT:1h | 529 | **+0,120** | +0,031 | no promociona |
| SOLUSDT:15m | 530 | **+0,117** | +0,014 | no promociona |
| BNBUSDT:30m | 543 | **+0,170** | +0,013 | no promociona |

Ninguna promociona, pero **el motivo ha cambiado**: ya no es «muestra insuficiente» sino «no promete
ganar». Y el patrón es el mismo en las cinco: **la configuración base bate a la optimizada fuera de
muestra**.

Eso es sobreajuste, y es exactamente lo que un hold-out de 25 operaciones no podía ver. Optuna
encontraba pesos que mejoraban en el tramo de validación y se caían fuera; con la muestra de antes,
el ruido lo tapaba y el criterio relativo (`opt > base`) los dejaba pasar.

**Cautela antes de concluir de más:** son cinco claves con 40 trials. Que Optuna no mejore puede ser
sobreajuste, pocos trials, o un espacio de búsqueda mal planteado —el mismo `suggest_float(0.0, 2.0)`
sin restricción de orden que produjo el régimen invertido. Lo que sí está establecido es que ahora
**se puede distinguir**, que es lo que este hito buscaba.

## Lo que este hito no hace

No mejora ninguna decisión. Amplía la muestra con la que se juzgan, que es distinto y previo. La
producción sigue teniendo sus 30 días y sus 22 bloques temporales útiles: lo que ha crecido es el
backtest.
