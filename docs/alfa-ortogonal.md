# Búsqueda de alfa ortogonal

> El marco pregunta si un vector aporta **dinero**, no información. Primer candidato medido: el
> momentum del funding. **No aporta.**

## Por qué hacía falta otro criterio

`informacion.py` mide ΔAUC: si una columna ayuda a **ordenar** mejor los desenlaces. Es la pregunta
correcta para admitir un voto en el ensemble, y sigue siéndolo.

No es la pregunta de este hito. Un vector puede ordenar algo mejor —AUC 0,52— y no mover la
expectancy lo suficiente para cubrir el coste de operar. Desde 0.63.0 sabemos cuánto es «lo
suficiente»: en 1d, la única temporalidad que queda operando, el round-trip cuesta **0,018 R** y la
expectancy neta del ensemble es **+0,020 R**.

Así que aquí se mide **R neta**, directamente, y contra un listón absoluto: `UMBRAL_VIABILIDAD =
+0,015 R`.

## El marco

Un vector es una serie alineada con las velas que, en cada instante, solo usa información
disponible **en ese instante**. El marco no puede comprobarlo, pero lo exige: un vector que mire al
futuro dará un resultado espectacular y falso.

La prueba es un **filtro contrafactual**: se descartan las operaciones donde el vector dice «no» y
se compara la expectancy neta con la de operarlas todas. Las descartadas cuentan como **0 sobre el
mismo `n`** — no operar también es una decisión, y renunciar a operaciones ganadoras se paga.

### Las tres condiciones

1. **Muestra** — al menos 25 operaciones descartadas y 25 conservadas. Un filtro que apenas cambia
   nada tiene lift ≈0 por construcción, y eso se leería como «no perjudica» en vez de como «no ha
   demostrado nada».
2. **Superar al azar** — batir el P95 de una nula que descarta la **misma cantidad**, repartida por
   bloques de 24 h. Sin bloques, un día bueno contaría como decenas de observaciones
   independientes.
3. **Ser viable** — la expectancy neta resultante debe superar +0,015 R. Mejorar de −0,20 a −0,10 R
   es una mejora real y sigue siendo un negocio ruinoso.

Se exigen **las tres**.

## Qué se puede medir, y qué no

La disponibilidad de datos descarta casi todos los candidatos. Comprobado contra la API de Binance
el 6-sep-2026:

| fuente | histórico disponible | ¿medible? |
|---|---|---|
| **funding rate** | **desde 2020**, paginando | **sí** |
| open interest (`openInterestHist`) | 30 días | no |
| long/short ratio | 30 días | no |
| taker buy/sell volume | 30 días | no |
| DXY, VIX | Twelve Data, sin clave configurada | pendiente |

Los **deltas de interés abierto** son una idea razonable y **no son medibles hoy**: 30 días son unas
30 observaciones en 1d, y cualquier veredicto sobre esa muestra sería ruido. Para poder usarlos
habría que empezar a guardarlos ahora y esperar — la ingesta ya lo hace desde M11, así que dentro de
un año habrá con qué.

## Primer candidato: momentum del funding

**Qué mide**, y en qué se diferencia del Fundamental Score: aquel sitúa el **nivel** del funding por
percentil y penaliza los largos cuando está caro. Este mide la **variación** respecto a su media de
la última semana — si el apalancamiento se está cargando, no si está cargado.

**Resultado (16 pruebas: 4 símbolos × 2 temporalidades × 2 reglas):**

| clave | regla | n | base | filtrada | lift | nula P95 | |
|---|---|---|---|---|---|---|---|
| BTCUSDT:4h | bajos | 1445 | +0,0389 | +0,0345 | −0,0044 | 0,0044 | no |
| BTCUSDT:1d | altos | 291 | +0,0091 | +0,0003 | −0,0088 | 0,0472 | no |
| ETHUSDT:1d | altos | 286 | +0,0487 | +0,0812 | +0,0325 | 0,0355 | no |
| SOLUSDT:1d | altos | 259 | −0,0028 | +0,0325 | +0,0354 | 0,0548 | no |
| BNBUSDT:1d | altos | 307 | −0,0557 | +0,0234 | **+0,0791** | 0,0672 | **APORTA** |
| *(y 11 más)* | | | | | | | no |

**Veredicto: no aporta.** Una prueba de 16 supera el listón, y con un P95 el azar produce **0,8**.
Encontrar una es exactamente lo esperado. El propio informe imprime esa cifra al lado del recuento
para que no se lea de otra forma.

Y el caso positivo es además marginal por los dos lados: el lift (+0,0791) apenas supera su nula
(+0,0672), y la neta resultante (+0,0234) apenas supera el listón (+0,015).

### Una hipótesis que queda anotada, sin sobrevenderla

En 1d, la regla `descartar_altos` da lift positivo en **tres de las cuatro** claves —ETH +0,0325,
SOL +0,0354, BNB +0,0791—. La dirección es consistente: descartar las entradas cuando el funding se
está cargando rápido parece ayudar.

Tres de cuatro con una moneda justa sale el **31 %** de las veces, así que no es un hallazgo. Es una
dirección que merece volver a mirarse cuando haya más historia o más símbolos, y que **no** justifica
tocar nada hoy.

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_alfa_estudio
```

## Lo que este hito deja listo

El marco es reutilizable: cualquier vector futuro solo tiene que producir un `{índice de vela:
valor}` sin mirar al futuro, y `alfa.evaluar_vector` hace el resto. El siguiente candidato no
necesitará volver a discutir el criterio — solo traer los datos.
