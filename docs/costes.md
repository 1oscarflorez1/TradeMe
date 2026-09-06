# Costes de transacción

> La expectancy bruta del ensemble es **≈0 en todas las temporalidades**. Lo que decide cuáles son
> viables no es su ventaja —no la tienen— sino cuánto pesa el coste sobre su unidad de riesgo.

## El fallo que corrige

Hasta 0.63.0 el backtest medía en **bruto**: ni comisiones ni deslizamiento. Con eso, todos los
listones de gobierno estaban calibrados contra un mercado que no existe — la cuarentena en −0,15 R,
la promoción en +0,05 R, el meta-modelo y el Fundamental Score.

Exigir +0,05 R de mejora en 15m, cuando abrir y cerrar ya cuesta 0,29 R, no significa nada.

## Por qué el coste no es igual en todas las temporalidades

Porque **`1 R = atr_stop_mult × ATR`**. La unidad en la que se mide todo depende de la volatilidad,
y la comisión es un porcentaje del precio. Cuanto más corta la temporalidad, menos vale 1 R en
dinero y más se lleva la misma comisión.

Medido en BTCUSDT:

| temporalidad | ATR/precio | 1 R en % del precio | coste (round-trip 0,12 %) |
|---|---|---|---|
| 15m | 0,267 % | 0,400 % | **0,300 R** |
| 30m | 0,382 % | 0,573 % | 0,209 R |
| 1h | 0,606 % | 0,910 % | 0,132 R |
| 4h | 1,644 % | 2,466 % | 0,049 R |
| 1d | 4,393 % | 6,589 % | **0,018 R** |

Un factor **17×** entre los extremos, con la misma comisión.

## Cómo se calcula

`|entry − stop|` **ya es 1 R expresado en precio**, así que el coste en R es el coste en precio
dividido por ese riesgo. No hace falta el ATR en el cálculo, y sigue siendo correcto si algún día
cambia `atr_stop_mult`.

Se cobra el **round-trip** —abrir y cerrar— y el deslizamiento se cuenta en las dos patas: en la de
salida suele ser peor, porque un stop se ejecuta justo cuando el mercado va en contra.

```yaml
costs:
  enabled: true
  mode: 'taker'       # taker | maker
  taker_pct: 0.05     # por orden
  maker_pct: 0.02
  slippage_pct: 0.01  # por orden, estimado
  # taker -> 2 x (0,05 + 0,01) = 0,12 % · maker -> 0,06 %
```

Mercado: **Binance USDT-M Futuros**. Sin la sección `costs` el round-trip es **cero** y el
comportamiento es el de antes — así, medir en neto es siempre una decisión explícita.

## Lo que se midió

Años de histórico, ~1.850 operaciones por clave, 20 claves (medianas de las cuatro):

| tf | bruta | coste | **neta (taker)** | neta (maker) |
|---|---|---|---|---|
| 15m | +0,003 | 0,290 | **−0,265** | −0,131 |
| 30m | +0,003 | 0,173 | **−0,186** | −0,094 |
| 1h | +0,003 | 0,112 | **−0,107** | −0,052 |
| 4h | +0,010 | 0,041 | −0,030 | −0,010 |
| 1d | +0,037 | 0,015 | **+0,020** | +0,029 |

**Lo que esto dice, y conviene leerlo entero:** la expectancy bruta es prácticamente la misma en
todas —entre +0,003 y +0,037— y ninguna es una ventaja. El ensemble de ocho indicadores no tiene
señal direccional en ninguna temporalidad. Lo único que las diferencia es cuánto coste soportan.

Por clave, solo dos quedan claramente positivas en neto: **ETHUSDT:1d (+0,059)** y **SOLUSDT:1d
(+0,108)**. Las de 4h son marginales y solo con maker.

De paso quedó refutado que «los cortos» fueran el problema: sobre años, largos y cortos rinden igual
(BTCUSDT:1h da +0,001 y +0,002). La asimetría de producción —+0,511 frente a −0,292— era un
artefacto del tramo alcista de 45 días.

## La cuarentena estructural de 15m y 30m

Entran en `quarantine_intervals` por un motivo **distinto** al de 4h. Aquella entró por su
expediente —−0,485 R en 89 decisiones—; estas entran porque el coste es estructural:

- Haría falta una ventaja bruta de **+0,29 R** en 15m solo para empatar.
- Lo medido es **+0,003 R** sobre 1.875 operaciones.
- La diferencia es de dos órdenes de magnitud. No se cierra afinando pesos.

Se retira el permiso para operar, no la observación: su expediente sombra se sigue midiendo, y desde
0.63.0 **en neto**, así que solo saldrán si de verdad ganan después de pagar al exchange. El
mecanismo se cierra sobre sí mismo sin necesidad de una regla nueva.

## Lo que queda pendiente de decidir

**1h también sale negativa** (−0,107 R) y **4h es marginal**. Con el criterio aplicado a 15m y 30m,
1h debería seguir el mismo camino, y entonces solo quedaría **1d** operando. Es una decisión de
alcance que este hito no toma.

## Lo que este hito no arregla

Nada de esto añade ventaja. Lo que hace es dejar de medirla contra un listón falso. La pregunta que
abre es la misma de siempre, ahora con la cifra delante: **hace falta una ventaja bruta de +0,29 R
en 15m, o de +0,015 en 1d, para que operar tenga sentido** — y ningún reparto de pesos sobre los
mismos ocho indicadores ha producido nunca nada parecido.
