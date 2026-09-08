# Qué configuración decide, exactamente

> El optimizador publica una copia **completa** del yaml pero solo busca doce cosas. Quien la
> consumía la cargaba entera. Resultado: quince claves operando con el estado de gobierno de agosto.

## El mecanismo

Cada clave `SÍMBOLO:temporalidad` puede tener una configuración propia en
`artifacts/optimized/ensemble.<SÍMBOLO>.<tf>.yaml`, publicada por Optuna cuando una optimización
supera el hold-out. Si no existe, manda `artifacts/ensemble.yaml`.

Lo que Optuna **busca** son doce parámetros, y son todos los que aparecen como `trial.suggest_*` en
`optimize.py`:

| qué | cuántos |
|---|---|
| pesos de los seis votos | 6 |
| `hold_band`, `temperature` | 2 |
| `adx_lo`, `adx_width` | 2 |
| multiplicadores de régimen (`trend`, `range`) | 2 bloques |

Lo que Optuna **publica** es el yaml entero: costes, cuarentena, riesgo, plan, horizontes, macro,
fundamental y pesos externos incluidos. Ninguna de esas cosas se optimiza; simplemente viajan de
copia.

## El fallo (detectado el 7 de septiembre de 2026)

`load_active_ensemble` (quant) y `getEnsembleFor` (api) hacían lo mismo: *si existe la optimizada,
úsala; si no, la base*. **Sustitución, no fusión.**

Como esas copias congelan el yaml del día en que se generaron, cada clave optimizada quedaba anclada
al estado de gobierno de entonces. Las quince que había eran de agosto:

| la base decía | las quince aplicaban | efecto |
|---|---|---|
| sección `costs` (0,12 % round-trip) | **no existía** | se medían **en bruto** |
| `quarantine_intervals: [15m,30m,1h,4h]` | `[4h]` | la cuarentena estructural no llegaba |
| `external_weights.tradingview: 0.0` | **2.0** | latente: 0 filas en `external_signals` |

**Nada fallaba.** No había excepción, ni aviso, ni fichero corrupto. Una configuración vieja se
aplicaba correctamente; solo que era vieja.

### Lo caro no fue lo que hacía, sino lo que hizo creer

`docs/costes.md` concluyó que **1d era la única temporalidad viable, con +0,020 R netos**. Ese
número sale de medir la configuración **base**. Reproducido:

| configuración medida | neta |
|---|---|
| base | **+0,0198** ← de aquí salió la tabla |
| la que **opera**, con sus costes | **−0,0193** |

Y de ahí colgaba más cosas: `UMBRAL_VIABILIDAD = 0,015` de `alfa.py` se justificó con aquel +0,020,
y los tres estudios de alfa —funding, precio y macro— midieron sus bases de 1d sin descontar
comisiones en tres de las cuatro claves.

El sesgo iba en la dirección **laxa**: bases infladas hacen más fácil que un filtro parezca aportar.
Los tres estudios se repitieron con la base corregida y **ninguna conclusión cambió**.

## La corrección: lista blanca

`fusionar_optimizada` aplica sobre la base **solo** `temperature`, `hold_band`, `weights`, los cuatro
campos optimizables de `regime` y la `version` —esta última porque es la identidad del artefacto que
decidió, y la interfaz y los informes la muestran—.

Es una lista **blanca** a propósito. Con una lista negra, cada sección nueva del yaml nacería
desprotegida y nadie se enteraría hasta que alguien reprodujera un número y no cuadrara, que es
exactamente cómo se encontró esto. Con la blanca, lo nuevo viene de la base por defecto y hay un test
que lo comprueba.

Existe en las dos implementaciones —`ensemble.py` y `config.ts`— porque las dos resuelven la
configuración activa, y su equivalencia está cubierta por tests espejo a cada lado.

## Qué NO arregla esto

**Las configuraciones optimizadas siguen siendo peores que la base.** Con la fusión aplicada y en
R **netas**, sobre 1d:

| clave | con la optimizada | con la base | diferencia |
|---|---|---|---|
| BTCUSDT:1d | −0,026 | −0,020 | +0,006 |
| ETHUSDT:1d | +0,007 | +0,059 | +0,052 |
| SOLUSDT:1d | −0,013 | **+0,106** | **+0,119** |
| BNBUSDT:1d | −0,044 | −0,044 | — (no tiene optimizada) |
| **mediana** | **−0,019** | **+0,020** | **+0,039** |

Es decir: **retirarlas devolvería 1d justo al +0,020 que se creía tener.**

Conviene leer bien la salvedad, porque apunta en la dirección contraria a la que parece. Desde que
cada configuración se generó solo han pasado **entre 2 y 4 operaciones** por clave, así que esta
comparación es casi toda *in-sample para las optimizadas* — son los datos con los que se ajustaron.
**Pierden incluso ahí**, contra una configuración manual que nunca se ajustó a nada. Eso es
sobreajuste de manual: parámetros que iban bien en su ventana de validación y mal en general.

Es coherente con lo que ya se sabía —la reoptimización periódica se desactivó en 0.62.0 justamente
porque no aportaba— pero mucho más marcado de lo que se había medido, porque hasta ahora se comparaba
sobre hold-outs de 22 a 26 operaciones.

**Retirar las quince es una decisión aparte y no la toma este documento.** Aquí solo se ha arreglado
que no arrastren consigo el gobierno de agosto. Lo que sí deja dicho es que la medición para tomarla
ya está hecha, y que el efecto sería mayor que el de cualquier ajuste de la operativa.
