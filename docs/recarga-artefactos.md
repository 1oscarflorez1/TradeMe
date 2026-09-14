# Recarga automática de artefactos

> Lo que el piloto decide tiene que llegar a lo que la api aplica. Hasta 0.72.2 llegaba en el
> siguiente despliegue.

## El problema

quant publica en `artifacts/` lo que la api usa para decidir: la cuarentena de cada clave, el
meta-modelo y su modo, los calibradores, la independencia, los fundamentales, el modo del
Fundamental Score y las correlaciones. El piloto los republica en cada ciclo.

La api los leía **al arrancar**, y después solo con `POST /reload`, que únicamente llamaba la web
desde el Laboratorio y el Backtest. Nadie la avisaba tras un ciclo del piloto. Con JWT activo, además,
recargar desde fuera exige sesión.

La consecuencia, verificada en producción el 14 de septiembre de 2026:

- `BNBUSDT:4h` salió de cuarentena a las **12:30:33**; la api, arrancada a las 12:14, no lo cargó
  hasta el reinicio de las **13:38:19** —68 minutos—, salvo que alguien pulsara la recarga en la
  web.
- Las siete entradas de cuarentena retiradas a mano a las **14:17:58** llevaban dos horas sin llegar
  a la api a las 16:13: seguía con lo cargado al arrancar a las 13:38.
- Si `ETHUSDT:1d` o `SOLUSDT:1d` —las únicas que operan— hubieran entrado en cuarentena por su
  expediente, **habrían seguido operando** hasta el siguiente despliegue.

La regla de cuarentena era idéntica en los dos lados desde 0.72.2 —con vectores de paridad—, pero la
api la aplicaba sobre una copia de hace horas. Paridad de reglas no es paridad de estado.

## Cómo funciona desde 0.73.0

`apps/api/src/artifacts/vigilancia.ts` mira cada `ARTIFACTS_POLL_MS` (15 s por defecto) la firma de
cada artefacto —inodo, fecha de modificación y tamaño; en `fundamental/`, la de cada `.json`— y
recarga **solo lo que cambió**. Tras cualquier recarga invalida la caché de configuración por clave,
que guarda la cuarentena, la independencia y el modo del Fundamental Score ya resueltos: sin eso,
recargar no cambiaría ninguna decisión.

| artefacto | fichero |
|---|---|
| ensemble | `ensemble.yaml` |
| cuarentena | `quarantine.json` |
| calibradores | `calibrators.json` |
| metamodelo | `metamodel.json` |
| meta_policy | `meta_policy.json` |
| independencia | `independence.json` |
| fundamentales | `fundamental/*.json` |
| fundamental_policy | `fundamental_policy.json` |
| correlaciones | `correlaciones.json` |

`POST /reload` usa la misma tabla, así que la recarga manual y la automática no pueden divergir. Los
yaml de `optimized/` no están: no se usan desde 0.69.0 (`use_optimized_configs: false`).

### Por qué sondeo y no `fs.watch`

Los artefactos llegan por un bind mount que comparten dos contenedores. `fs.watch` depende de que el
montaje propague los eventos de un contenedor a otro, y eso cambia con Docker Desktop, WSL2 o un
volumen de red. En producción sí los propagaba (la sonda contó eventos), pero esa garantía sería del
montaje y no del código. Unos pocos `stat` cada 15 segundos funcionan en cualquier montaje y acotan la
latencia al intervalo.

### Nunca se aplica un fichero a medias

Los cargadores de la api convierten un fichero ilegible en «sin artefacto», y sin artefacto una
cuarentena decidida por expediente **desaparece**. Así que:

- **La api** solo recarga un artefacto si lo puede leer entero (JSON o YAML válido). Si no, conserva
  el estado anterior, lo avisa una vez en el log y lo reintenta en el siguiente tick. Un fichero
  **borrado** sí se aplica: sin artefacto manda la configuración, que es un estado válido.
- **quant** escribe todos esos artefactos de forma atómica (`trademe_quant.publicacion`): primero un
  temporal oculto en el mismo directorio y después `os.replace`. Quien lea ve el fichero anterior
  entero o el nuevo entero.

### Y un fallo que la recarga habría dejado a medias

`buildApp` recibía el modo del meta-modelo **por valor**, el del arranque. `/signal` y `/status`
seguían usando ese modo aunque `meta_policy.json` cambiara y se recargara. Ahora es un getter.

## Latencia

| tramo | medido |
|---|---|
| Propagación del bind mount: el piloto escribe, la api ve el nuevo mtime | **83 ms** y **18 ms** (dos publicaciones, 14-sep-2026) |
| Sondeo | como mucho `ARTIFACTS_POLL_MS`, 15 s por defecto |
| Del disco a la memoria de la api, en producción | **9,3 s** (escrito 16:12:56.004, en memoria 16:13:05.291) |
| Antes de 0.73.0 | hasta el siguiente despliegue (68 min en el caso de BNBUSDT:4h) |

La cota es **intervalo + propagación**: unos 15 segundos como mucho y 7,5 de media, porque la
publicación cae en un punto cualquiera del intervalo. Los 9,3 s medidos están dentro. Frente a un ciclo
de piloto de ~15 minutos, bajar el intervalo apenas cuesta pero no cambia nada que importe.

**Cómo se midió antes de desplegar.** El módulo `vigilancia.ts` de esta versión, transpilado, se
ejecutó en solo lectura dentro del contenedor de la api de producción, sobre el `quarantine.json`
real y con el cargador desplegado, esperando a que el piloto publicara. Sin escribir nada y sin
tocar la api en marcha, que en ese mismo momento seguía con la copia de las 13:38.

### Cómo medirlo en producción

Cada recarga deja una línea en el log de la api con el retraso de cada artefacto: los milisegundos
entre la modificación del fichero y su aplicación en memoria. Desde
`C:\Users\hp\Claude\Projects\TradeMe - Build\TradeMe`, en PowerShell:

```
docker logs trademe-prod-api-1 --since 1h 2>&1 | Select-String "artefactos recargados"
```

La forma de la línea (valores de ejemplo):

```
{"recargados":["cuarentena","independencia"],"retraso_ms":{"cuarentena":6120,"independencia":6090},"cuarentena":"qtn-…","msg":"artefactos recargados desde disco"}
```

Un `retraso_ms` por encima del intervalo más un par de segundos es anómalo: el montaje no propaga, o
el fichero se quedó ilegible (buscar `artefacto ilegible en disco`).

## Configuración

`ARTIFACTS_POLL_MS` en el entorno de la api. `0` desactiva la recarga automática y deja solo
`POST /reload`, que es el comportamiento anterior a 0.73.0.
