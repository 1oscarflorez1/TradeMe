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

## Los seis checks

| # | Qué comprueba | Si sale ATENCION |
|---|---|---|
| 1 | La última vela 1d guardada es la de ayer (UTC) | Si dura más de un ciclo del piloto (15 min), el relleno no está corriendo. Justo tras las 00:00 UTC es normal |
| 2 | No hay huecos interiores de 1d en 60 días | El relleno no ha terminado; comprobar la línea `huecos:` del piloto |
| 3 | La api estaba corriendo a las 00:00 UTC de cada día | La vela se recupera igual, pero **la decisión de ese cierre no se toma**. Es lo único que el relleno no puede arreglar |
| 4 | La **última** decisión de cada clave: solo ETH y SOL en 1d pueden operar | **Fallo de la lista blanca.** Revisar `active_keys` en el yaml desplegado y reiniciar la api |
| 5 | Ninguna vela de 1d con decisión lleva más de 12 días sin desenlace. Cuenta **velas**, no capturas | Faltan velas dentro de su ventana: mirar checks 1 y 2 |
| 6 | Expectancy bruta frente a neta | Informativo: comprueba que el descuento de comisiones actúa. No mide rendimiento |

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

## Cuándo pasarlo

| Cuándo | Qué mirar |
|---|---|
| Tras cada despliegue, en el primer ciclo (≤15 min) | Check 4 |
| Cada mañana | Checks 1 y 3 |
| Semanalmente | Checks 2 y 5 |
| Tras cualquier caída del portátil | Checks 1, 2 y 3 en el ciclo siguiente |
