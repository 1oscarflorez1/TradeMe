# Salud de la operativa en 1d

> Desde 0.70.0 solo operan `ETHUSDT:1d` y `SOLUSDT:1d`. Este documento explica cómo comprobar que
> eso se cumple en producción y que los datos de los que dependen llegan completos.

## Cómo se ejecuta

Desde PowerShell, en `C:\Users\hp\Claude\Projects\TradeMe - Build\TradeMe`:

```powershell
Get-Content infra\salud-1d.sql | docker exec -i trademe-prod-postgres-1 psql -U trademe -d trademe
```

Es **solo lectura**. Cada bloque devuelve una columna `estado` con `OK` o `ATENCION`.

## Por qué 1d necesita vigilancia propia

Una vela de 1m cierra 1.440 veces al día; una de 1d, **una**. La api guarda una vela solo si ve
pasar su cierre, así que si el stack está parado a las 00:00 UTC la vela del día anterior no se
guarda. En 1m eso son unos minutos que el relleno recupera en el siguiente ciclo. En 1d es la vela
entera.

Medido el 12-sep-2026: **el stack estaba parado a las 00:00 UTC en 3 de los últimos 7 cierres**
(días 6, 11 y 12). Como el despliegue corre en un portátil, no es raro.

Hasta 0.70.0 esas velas se quedaban sin guardar hasta el cierre siguiente, porque el relleno solo
reparaba huecos **interiores** y una vela que falta al final de la serie no lo es. Desde 0.71.0 el
piloto repara también **la cola**. Ver `huecos.cola_faltante` y la sección de proveedores.

## Los siete checks

| # | Qué comprueba | Si sale ATENCION |
|---|---|---|
| 1 | La última vela 1d guardada es la de ayer (UTC) | Si dura más de un ciclo del piloto (15 min), el relleno no está corriendo. Justo tras las 00:00 UTC es normal |
| 2 | No hay huecos interiores de 1d en 60 días | El relleno no ha terminado; comprobar la línea `huecos:` del piloto |
| 3 | La api estaba corriendo a las 00:00 UTC de cada día | La vela se recupera igual, pero **la decisión de ese cierre no se toma**. Es lo único que el relleno no puede arreglar |
| 4 | La **última** decisión de cada clave: solo ETH y SOL en 1d pueden operar | **Fallo de la lista blanca.** Revisar `active_keys` en el yaml desplegado y reiniciar la api |
| 5 | Ninguna vela de 1d con decisión lleva más de 12 días sin desenlace. Cuenta **velas**, no capturas | Faltan velas dentro de su ventana: mirar checks 1 y 2 |
| 6 | Expectancy bruta frente a neta | Informativo: comprueba que el descuento de comisiones actúa. No mide rendimiento, y mezcla las decisiones de las configuraciones optimizadas (hasta el 8-sep-2026) con las de la base |
| 7 | Cuánto falta para saber si la expectancy neta es mayor que cero | Informativo, salvo `ATENCION: perdida confirmada`: la clave pierde con evidencia y hay que revisar la lista blanca. Ver [el check 7](#el-check-7-cuánto-falta-para-saber-si-ganan-0760) |

### Por qué el check 4 mira la última decisión y no una ventana de tiempo

La primera versión contaba las decisiones operables de las últimas 24 h. El 12-sep-2026, recién
desplegado 0.70.0, dio `ATENCION` en seis claves — y la lista blanca **estaba funcionando**: todas
esas decisiones eran de antes del despliegue. Una ventana de tiempo mezcla el antes y el después de
cualquier cambio.

Mirando la última decisión registrada de cada clave, el check responde a la pregunta correcta
—*¿qué hace hoy cada clave?*— desde el primer ciclo de captura, sin esperar a que caduque nada. La
columna `hace_min` dice lo reciente que es cada lectura.

### Por qué el check 5 cuenta velas y no filas

Cada vela de 1d genera **varias capturas** a lo largo del día. La primera versión contaba filas, y
el 12-sep-2026 decía 16 decisiones evaluadas de ETHUSDT:1d cuando eran **6 velas**: tres capturas
por vela de media. El veredicto `OK` era correcto —cero atascadas es cero lo cuentes como lo
cuentes—, pero las cifras de al lado inflaban la muestra unas tres veces, que es la trampa de
agregar por decisión que el proyecto ya había documentado. Ahora toma la primera captura de cada
vela, igual que el check 6 y que el panel.

El límite de «atascada» es de **12 días** y no 11: 10 de horizonte, uno para que cierre la última
vela de la ventana —que abre justo en el límite— y uno de holgura para el ciclo del piloto.
Desde 0.72.0 la ventana arranca en la vela de captura y cierra un día antes, así que el límite
queda con dos días de holgura. No se ajusta: esperar de más solo retrasa un aviso, esperar de menos
lo daría falso. Ver `docs/reproducibilidad.md`.

### El contador del piloto: «N decisiones nunca se evaluarán»

La línea `datos:` del piloto cuenta las decisiones a las que les faltan velas dentro de su ventana y
ya no las van a tener. Hasta 0.71.1 contaba también las que **aún estaban en camino**: la última vela
de una ventana abre justo cuando esta vence, así que durante un periodo entero parecía perdida. En
1d eso era un día de aviso falso por cada decisión. Ver `db.ventana_cerrada`.

## El check 7: cuánto falta para saber si ganan (0.76.0)

La pregunta que responde: **¿la expectancy neta de ETHUSDT:1d y SOLUSDT:1d es mayor que cero, y
cuándo podremos saberlo?** Se operan porque el backtest les da ventaja con la configuración base;
el check dice cuántas operaciones en vivo harían falta para confirmarla si fuera real, y cuántas
llevamos.

Es la regla de `trademe_quant.tamano_muestral`, fijada el 15-sep-2026. El piloto la calcula en cada
ciclo —líneas `muestra:`, en el log y en `datos` de `/automation`— y el Laboratorio la muestra. El
check la reproduce en SQL con los mismos literales, y un test falla si se separan.

### Lo medido el 15-sep-2026

| | ETHUSDT:1d | SOLUSDT:1d |
|---|---|---|
| Hipótesis: expectancy neta del backtest, configuración base | +0,0588 R | +0,1026 R |
| Evaluadas con la configuración base | **0** | **0** |
| σ agrupada, 15 operaciones reales | 1,069 R | 1,069 R |
| Operaciones independientes necesarias | **2.045** | **672** |
| Velas mínimas | 20.450 (~56 años) | 6.720 (~18 años) |

**¿Por qué 0 evaluadas si el check 6 enseña 7 y 8?** Porque esas 15 se decidieron con las
configuraciones optimizadas (`ens-opt-*`), que hasta 0.69.0 sustituían al yaml. La configuración
base decide ETH y SOL desde la vela del **8-sep-2026**, y sus primeros desenlaces llegarán hacia el
18-sep, cuando vencen sus 10 velas. Medían otro sistema: no cuentan para la media, aunque sí
para estimar σ (ver abajo).

### Qué significa cada columna

| columna | qué es |
|---|---|
| `evaluadas` | Velas con desenlace, primera captura de cada una, tomadas con la configuración base |
| `independientes` | Las que no comparten recorrido: la primera y, cada vez, la siguiente que abre 10 velas después. Es la muestra que cuenta |
| `media_neta` | Media de las evaluadas, en R neta |
| `sigma`, `sigma_de` | Dispersión por operación: la propia desde 30 evaluadas; antes, la agrupada de las reales de ETH y SOL con cualquier configuración |
| `ic95_inferior` | Límite inferior del intervalo unilateral del 95 % (t de Student, `independientes − 1` grados). Por encima de 0, confirmada |
| `detectable_hoy` | La expectancy más pequeña que, de ser la real, hoy se confirmaría con potencia 0,80 |
| `hipotesis` | La expectancy que da el backtest. Constante: un objetivo que se mueve en cada ciclo no se puede seguir |
| `necesarias` | `((1,645 + 0,842) · σ / hipótesis)²`: independientes para confirmarla con α = 5 % y potencia 80 % |
| `velas_minimas`, `anios_minimos` | `necesarias × 10`: cabe como mucho una independiente por horizonte |
| `progreso_pct` | `independientes / necesarias` |

### Por qué independientes y no decisiones

Cada día hay una decisión, y cada una se evalúa durante 10 velas: la de mañana comparte nueve de sus
diez días con la de hoy. Sus desenlaces van juntos. Los datos lo enseñan: las decisiones de SOL del
24, 25 y 26 de agosto acabaron las tres en stop, y las del 19 y 20 las dos en objetivo.

Veinte decisiones diarias valen **dos** observaciones. Contarlas como veinte haría el error estándar
unas tres veces más pequeño (√10) y daría por confirmado lo que es ruido, que es la trampa de
[agregar por decisión](lista-blanca.md#lo-que-esa-cifra-no-demuestra) que el proyecto ya documentó.
Es conservador: en el backtest una operación dura 6,9 velas de media, no 10. Con esa duración las
velas necesarias bajan un 30 %, a ~39 años en ETH y ~13 en SOL, y la conclusión no cambia.

### Por qué σ agrupada, y de todas las configuraciones

Lo que mide un TP, un SL o un timeout lo fija el plan —stop a 1 R, objetivo a 2 R, 10 velas—, no la
configuración que decidió abrir. El backtest lo respalda: **1,127 y 1,148 R** con 403 y 272
operaciones que no se solapan. Con esa σ las necesarias serían 2.270 y 775: el mismo orden.

Cada clave por separado sí daría otra cosa: 0,686 R en ETH con 7 operaciones y 1,311 en SOL con 8.
Con tan pocas, la σ propia movería el resultado al triple de un ciclo a otro. Por eso se agrupa
hasta que la clave tenga 30 evaluadas propias.

### Lo que esto quiere decir

- **En vivo no se va a confirmar la ventaja del backtest en un plazo útil.** Ni juntando las dos
  claves y suponiendo que se mueven por separado —no es así: son cripto y van juntas—: 605
  independientes por clave, ~16,6 años.
- **El backtest tampoco la confirma.** ETH: t = 1,05 (p = 0,15) con 403 operaciones; SOL: t = 1,47
  (p = 0,07) con 272. Coincide con lo que ya decía `lista-blanca.md`: la ventaja no alcanza
  significancia, y el argumento sólido para operar estas dos es que excluir BNB evita pérdida.
- **Lo que el vivo sí puede detectar es una pérdida grande**, o un sistema que no se parece a su
  backtest:

  | expectancy real | independientes para confirmar la pérdida | tiempo mínimo |
  |---|---|---|
  | −1 R | ~8 | ~80 días |
  | −0,5 R | ~29 | ~290 días |
  | −0,3 R | ~79 | ~2,2 años |

  Y lo más pequeño que se podrá confirmar con el tiempo, al ritmo máximo de una independiente cada
  10 velas: +0,45 R en un año, +0,26 R en tres, +0,20 R en cinco y +0,14 R en diez.

Así que el check **no está para esperar un `CONFIRMADA`**. Lo normal durante años es `EN CURSO`. El
estado que pide actuar es `ATENCION: perdida confirmada`: esa clave pierde con evidencia y la lista
blanca debe revisarse.

**Tampoco relaja nada.** La cuarentena sigue sacando una clave por un umbral fijo sobre sus 30
decisiones más recientes, sin pedir significancia, a propósito: exigirla dejaría operando claves
malas mientras no se demuestre que lo son.

```
docker exec trademe-prod-quant-1 python -m trademe_quant.tamano_muestral
```

## Cuándo pasarlo

| Cuándo | Qué mirar |
|---|---|
| Tras cada despliegue, en el primer ciclo (≤15 min) | Check 4 |
| Cada mañana | Checks 1 y 3 |
| Semanalmente | Checks 2 y 5 |
| Tras cualquier caída del portátil | Checks 1, 2 y 3 en el ciclo siguiente |
| Una vez al mes | Check 7 |
