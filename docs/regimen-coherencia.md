# El régimen no significa lo que dice

> **Once de las quince configuraciones que Optuna ha publicado invierten la conmutación por
> régimen.** Cuando una decisión guarda `regime_label = 'tendencia'`, en la mayoría de las claves el
> motor está aplicando pesos que favorecen la reversión.

## De dónde sale la pregunta

En [habilidad-direccional.md](habilidad-direccional.md) quedó medido que la plataforma no aporta
habilidad direccional: el mercado daba +0,626 R y ella sacó +0,035 R. Faltaba el **mecanismo**: por
qué emite más cortos que largos en un tramo alcista.

Los votos medios lo dicen. En régimen de **tendencia**, cuando la plataforma emite un **SHORT**:

| voto | valor medio | familia |
|---|---|---|
| ema_cross | **+0,517** | tendencia |
| macd | +0,096 | momentum |
| supertrend | **+0,661** | tendencia |
| rsi14 | −0,600 | reversión |
| bbands | −0,447 | reversión |
| stoch14 | −0,567 | reversión |
| **net** | **−0,386** | |

Los tres indicadores de tendencia están **claramente positivos** —el mercado sube y ellos lo dicen—
y aun así el resultado es un corto. **La plataforma se pone corta contra la tendencia que sus propios
indicadores de tendencia señalan.** Y le sale caro: en ese régimen, sus cortos dan **−0,563 R**
frente a **+0,624 R** de sus largos.

## Por qué pasa

`ensemble.yaml` declara la conmutación: *«En tendencia sube tendencia/momentum; en rango,
reversión»*. La config base lo cumple — `trend: 1.5, momentum: 1.5, reversion: 0.6`.

Pero el optimizador propone cada peso así:

```python
for reg, kind in REGIME_KEYS:
    params[f"r_{reg}_{kind}"] = trial.suggest_float(f"r_{reg}_{kind}", 0.0, 2.0)
```

**Sin ninguna restricción de orden.** Nada impide publicar `trend: 0.50` y `reversion: 1.99` en el
bloque de tendencia, y es lo que ocurre.

## La auditoría, sobre lo que hay publicado hoy

```
  (base) ensemble.yaml       trend/mom= 1.50  reversion= 0.60   coherente
  BNBUSDT.15m                trend/mom= 1.35  reversion= 1.40   INVERTIDA · trend 1.04x
  BNBUSDT.1h                 trend/mom= 1.69  reversion= 1.38   INVERTIDA · range 1.39x
  BNBUSDT.30m                trend/mom= 1.58  reversion= 1.08   INVERTIDA · range 1.22x
  BTCUSDT.15m                trend/mom= 1.48  reversion= 0.58   coherente
  BTCUSDT.1d                 trend/mom= 0.75  reversion= 0.39   coherente
  BTCUSDT.1h                 trend/mom= 0.73  reversion= 0.91   INVERTIDA · trend 1.24x · range 1.53x
  BTCUSDT.30m                trend/mom= 0.68  reversion= 1.32   INVERTIDA · trend 1.95x
  BTCUSDT.4h                 trend/mom= 1.72  reversion= 1.79   INVERTIDA · trend 1.04x
  ETHUSDT.15m                trend/mom= 1.87  reversion= 1.53   INVERTIDA · range 2.50x
  ETHUSDT.1d                 trend/mom= 1.99  reversion= 0.78   coherente
  ETHUSDT.1h                 trend/mom= 1.48  reversion= 0.67   INVERTIDA · range 1.31x
  SOLUSDT.15m                trend/mom= 0.50  reversion= 1.99   INVERTIDA · trend 3.97x
  SOLUSDT.1d                 trend/mom= 0.58  reversion= 1.23   INVERTIDA · trend 2.12x · range 26.19x
  SOLUSDT.1h                 trend/mom= 1.81  reversion= 0.86   INVERTIDA · range 1.90x
  SOLUSDT.4h                 trend/mom= 0.90  reversion= 0.78   coherente

  coherentes: 5/16   ·   INVERTIDAS: 11
```

### Cómo se cuenta, porque es fácil equivocarse

En régimen de tendencia dominan **dos** familias —tendencia y momentum— y basta con que una mande.
Mirar solo `trend` e ignorar `momentum` infla el recuento: `BNBUSDT:1h` tiene `trend 0.15`, que
parece una inversión de 9x frente a su `reversion 1.38`, pero su `momentum` es **1.69**. Su bloque de
tendencia es coherente; su inversión está en el de rango. Hay un test que fija esto.

## Qué está demostrado y qué no

**Demostrado.** Once de quince configuraciones publicadas invierten la semántica declarada. En
régimen de tendencia, los cortos se emiten con `supertrend` en +0,661 y dan −0,563 R.

**No demostrado.** Que la inversión *cause* los cortos malos. Solo cinco claves tienen suficientes
cortos en régimen de tendencia para medirlo, y con esa muestra la correlación entre el ratio de
inversión y la expectancy de los cortos (r = −0,405) **no dice nada**. Es una hipótesis razonable y
nada más.

El argumento que **sí se sostiene sin estadística** es otro: `regime_label` se guarda en cada
decisión y se muestra en el panel. Cuando dice «tendencia» y los pesos aplicados favorecen la
reversión, **ese registro describe algo que no ocurrió**. Eso vale con independencia de si el
rendimiento resulta bueno o malo.

Es el mismo patrón que los umbrales decorativos, el cupo del percentil 95 y el listón de ruido: un
nombre que dejó de corresponderse con el mecanismo, sin que nada lo vigilara.

## Lo que se ha hecho, y lo que no

**Hecho:** `regimen.auditar` detecta la inversión, y el piloto automático la ejecuta tras cada
promoción. Si la configuración recién promovida invierte la semántica, levanta una alerta
`regimen_incoherente` con el detalle. El optimizador llevaba semanas haciendo esto sin que nada lo
señalara.

**No hecho, a propósito:** no se restringe el espacio de búsqueda ni se bloquea ninguna promoción.
Eso cambiaría lo que la plataforma opera y es una decisión de diseño, no una corrección obvia.

## La decisión que queda

Son dos caminos y no da igual cuál:

**a) Restringir la búsqueda** para que Optuna respete la semántica —en tendencia, `max(trend,
momentum) ≥ reversion`—. El régimen vuelve a significar lo que dice. El coste: se le quita al
optimizador un grado de libertad, y si resultara que la reversión funciona mejor en tendencia, se
estaría imponiendo un prejuicio.

**b) Aceptar que el optimizador mande y renombrar** el mecanismo a lo que de verdad es: dos juegos
de pesos conmutados por ADX, sin promesa de sentido. Entonces `regime_label` pasaría a ser un
identificador, no una descripción.

Lo que no vale es dejarlo como está, con un nombre que promete algo que no se cumple.

Una consideración para elegir: las configuraciones que invirtieron el régimen **ganaron en el
backtest fuera de muestra** —si no, Optuna no las habría promocionado— y sin embargo en producción
dan −0,563 R en cortos. Esa desconexión entre backtest y realidad es una pregunta abierta que este
hito no responde, y probablemente sea más importante que la elección entre (a) y (b).

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_regimen_auditoria
```
