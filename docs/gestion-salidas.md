# Gestión de la salida y del tamaño

> Ocho planes de salida y un esquema de sizing, sobre 1d. **Ninguno aporta** — y esta vez el «no»
> viene con un mecanismo explicado, no solo con un p-valor.

## Por qué esta palanca

Los tres estudios de alfa —funding, precio y macro; 96 pruebas— dijeron lo mismo: no aparece ventaja
en la **entrada**. Filtrar entradas de un motor sin ventaja no crea ventaja, solo reparte la misma
nada entre menos operaciones.

La gestión de la salida es distinta en un sentido concreto: **no depende de acertar más veces**.
Redistribuye lo que ya ocurre dentro de cada operación. Eso no la hace mágica, pero la convertía en
la única palanca sin explorar.

## Dónde parecía estar el margen

Medido antes de diseñar nada, sobre las 1.416 operaciones de 1d:

| desenlace | n | R medio | qué decía |
|---|---|---|---|
| stop | 621 | −1,005 | solo el **6,6 %** llegó a +1 R antes de morir |
| take-profit | 209 | +2,000 | MFE mediano 2,30 R: deja poco sobre la mesa |
| timeout | 586 | +0,332 | el **48,5 %** llegó a +1 R; los ganadores cobran +0,63 R con un MFE mediano de **+1,13 R** |

La lectura parecía inequívoca: el breakeven tiene poco que salvar, y los **timeouts son el 41 % de
todo y devuelven la mitad de su mejor momento**.

## El look-ahead que había que evitar primero

En 1d una vela es un día entero y **nadie sabe si el máximo ocurrió antes o después del mínimo**.
Mover el stop con el máximo de la vela `t` y comprobar después el mínimo de esa misma vela sería
suponer el orden favorable, siempre, y daría un resultado espectacular y falso.

La regla es la del resto del proyecto: en cada vela se comprueba **primero** si el stop vigente se
toca y **solo después** se actualiza con esa vela ya cerrada. Hay un test que construye una vela que
sube a +1 R y baja al stop en el mismo periodo, y exige que salte el stop.

Y el que más importa: **sin plan, el resultado es idéntico bit a bit** al de siempre, comprobado
sobre 50 series aleatorias en las dos direcciones. Sin eso, cualquier comparación contra el baseline
mediría el cambio de código en vez del mecanismo.

## Resultados: 32 pruebas, 0 positivos

Ocho planes × cuatro claves. El listón conserva las tres condiciones de `alfa.juzgar` —muestra,
control del azar y viabilidad— con una diferencia en la segunda que merece explicarse:

> `nula.p95_seleccion` pregunta «¿qué daría elegir *otras* operaciones?», que es lo correcto para un
> filtro. Un plan de salida no elige: **cambia el desenlace** de las que toca, y el delta de cada una
> depende de su propio recorrido, así que no es transferible a otra. La pregunta aquí es «¿la mejora
> sobrevive a que me hubieran tocado otros meses?», y se responde con un **bootstrap por bloques de
> 24 h**. Se exige que el percentil 5 del lift remuestreado siga siendo positivo.

| plan | claves que aportan |
|---|---|
| breakeven a +1 R | 0/4 |
| trailing 1 R desde +1 R | 0/4 |
| trailing con ATR corriente | 0/4 |
| salida por decaimiento de la señal | 0/4 |
| trailing + señal | 0/4 |
| breakeven + trailing | 0/4 |
| sin TP + trailing 1 R | 0/4 |
| sin TP + trailing ATR | 0/4 |

## Por qué falla: el TP a 2 R es un techo, y el trailing solo puede actuar por debajo

Esto es lo que hace que el resultado sea un hallazgo y no un p-valor. Descomponiendo qué le pasa a
cada operación con el trailing de 1 R:

| transición | n | Δ R medio | Δ total |
|---|---|---|---|
| **take-profit → gestión** | 32 | **−1,411** | **−45,1 R** |
| stop → gestión | 29 | +1,273 | +36,9 R |
| timeout → gestión | 138 | −0,059 | −8,2 R |
| **efecto neto** | | | **−16,4 R** sobre 1.108 operaciones |

El trailing **salva 29 stops y corta 32 take-profits**, y las segundas cuestan más que lo que valen
las primeras. Con un sistema de 1:2 y ~43 % de aciertos, la economía depende de que las ganadoras
lleguen al techo: cortarlas antes rompe justo la pata que sostiene la cuenta.

Y no es un problema de calibrar la distancia. **Es estructural**: con el TP fijo a 2 R, cualquier
arrastre que se active por debajo puede cortar una ganadora, y uno que se active por encima llega
tarde porque el TP ya cobró. No hay hueco.

### Los timeouts tampoco eran capturables

El margen que el MFE parecía prometer era una ilusión de medición, y vale la pena entender por qué.
Los timeouts ganadores tienen un MFE mediano de **+1,13 R** y cobran **+0,63 R** al cierre del
horizonte. Un trailing a 1 R por detrás del máximo saldría en 1,13 − 1,00 = **+0,13 R**: peor que no
hacer nada. Por eso su Δ medio es −0,059.

**El MFE mide lo que el precio llegó a ofrecer, no lo que un mecanismo causal podría haber cobrado.**
Para capturar ese pico habría que estar mucho más cerca del precio, y estar más cerca corta más
ganadoras. Es la misma tensión, otra vez.

### Lo que sí se ve, sin sobrevenderlo

Quitar el TP y arrastrar con el ATR corriente **baja el drawdown en 3 de 4 claves** (BTC 19,0→15,1;
ETH 16,3→9,9; SOL 16,4→13,7) y sube el Sharpe en 3 de 4. Pero la expectancy cae, dos claves mejoran
y dos empeoran, y 3 de 4 con una moneda al aire sale el 31 % de las veces. **No es un hallazgo.**
Queda anotado por si algún día hay más histórico con el que separarlo del ruido.

## El sizing por volatilidad inversa: ya estaba hecho, y repetirlo empeora

Lo primero que hay que ver es que **buena parte del mecanismo ya está en el sistema**. El stop está
a `atr_stop_mult × ATR`, así que cuando la volatilidad sube el stop se aleja y hay que comprar menos
unidades para arriesgar el mismo 1 %. **1 R es siempre 1 % del capital, con cualquier ATR.** Por eso
todo el proyecto mide en R: la normalización por volatilidad está dentro de la unidad.

Lo que quedaba por probar era variar el **porcentaje de capital** según el régimen de volatilidad.
Con los pesos **normalizados a media 1** —sin eso, arriesgar menos baja el drawdown por definición y
se leería como una mejora—:

| clave | retorno/DD base | con vol. inversa | maxDD base | con vol. inversa |
|---|---|---|---|---|
| BTCUSDT | −0,412 | −0,288 | 19,01 | 17,64 |
| ETHUSDT | **1,452** | **0,691** | 16,27 | **25,47** |
| SOLUSDT | **1,750** | **1,363** | 16,44 | 19,20 |
| BNBUSDT | −0,672 | −0,679 | 26,44 | 34,24 |

**Mejora en 1 de 4**, y la única que mejora es la que pierde dinero. En ETH y SOL —las dos que
ganan— empeora claramente, y el drawdown de ETH **sube un 57 %**.

La explicación es la misma que arriba: **es una doble corrección**. R ya es «riesgo constante», así
que ponderar además por `1/volatilidad` no neutraliza la volatilidad, la sobre-corrige — concentra
el riesgo en los periodos tranquilos, que en cripto son justo los que preceden a las rupturas.

## Qué queda

Cuatro direcciones exploradas con el mismo resultado: entrada (funding, precio, macro) y ahora
salida y tamaño. La conclusión acumulada se afila:

**La expectancy bruta del ensemble es ≈0 y ninguna reorganización de lo que ya hace la cambia.** Los
filtros reparten la misma nada entre menos operaciones; la gestión de salidas mueve valor de las
ganadoras a las perdedoras; el sizing redistribuye riesgo sin crear retorno. Todos son
transformaciones de una serie sin ventaja, y ninguna transformación crea ventaja.

Lo único que quedó anotado, con su salvedad: sin TP y arrastrando con ATR, el drawdown baja en 3 de
4 claves. No supera el listón y no se promociona.

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_salidas
docker exec trademe-prod-quant-1 python -m trademe_quant.run_sizing
```

Informes en `artifacts/salidas_estudio.json` y `artifacts/sizing_estudio.json`.
