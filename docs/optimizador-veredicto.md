# ¿Aporta Optuna? El veredicto, con muestra suficiente

> Con los 40 trials que usa producción, reoptimizar **empeora** (p = 0,0013). Con 120 el resultado
> se vuelve un empate. Lo primero que demuestra este estudio es que **producción infra-optimiza**;
> lo segundo, que ni así ninguna configuración se distingue del `ensemble.yaml` escrito a mano.

## Por qué no se podía responder antes

El hold-out del optimizador eran **25 operaciones**, justo el mínimo del guardia. Con esa muestra la
diferencia entre una mejora y una racha no es medible, y el guardia frenaba el 100 % de las
promociones — con razón, pero dejando la pregunta abierta.

Desde 0.60.0 la ventana es de 20.000 velas y el hold-out pasa a **56-562 operaciones**. La pregunta
se vuelve contestable.

## El diseño

Cuatro condiciones sobre el **mismo hold-out intacto** (el 30 % final, nunca visto por la búsqueda):

| condición | qué es |
|---|---|
| **manual** | el `ensemble.yaml` de M3, escrito a mano, nunca optimizado |
| **activa** | lo que esa clave opera hoy — en 15 de 20 es una optimizada de agosto |
| **libre** | Optuna con el espacio de siempre: `suggest_float(0.0, 2.0)` sin restricción |
| **coherente** | Optuna con la conmutación de régimen obligada a significar lo que dice |

La cuarta existe porque la tercera tenía una salida fácil: 6 de las 15 configuraciones publicadas
invertían el régimen, así que «Optuna no aporta» podía ser «Optuna busca en un espacio que permite
configuraciones incoherentes». Separarlas era el objeto del estudio.

**El criterio se fijó antes de ver resultados**: aportar = ganar en más de la mitad de las claves.
Se cuenta por claves y no promediando expectancies, porque las claves comparten mercado —cuatro
activos que la plataforma calcula como 1,49 independientes— y promediar sobre ellas volvería a
inflar la evidencia, que es el error que este proyecto ya cometió una vez.

## El resultado (40 trials, 20 claves)

| clave | n hold-out | manual | activa | libre | coherente |
|---|---|---|---|---|---|
| BNBUSDT:15m | 476 | **0,042** | 0,010 | −0,037 | 0,019 |
| BNBUSDT:1h | 502 | −0,032 | **0,027** | −0,016 | −0,040 |
| BNBUSDT:30m | 235 | −0,082 | **0,170** | 0,012 | 0,025 |
| BTCUSDT:15m | 472 | 0,019 | 0,074 | 0,060 | **0,103** |
| BTCUSDT:30m | 539 | −0,068 | 0,008 | −0,065 | **0,068** |
| ETHUSDT:1d | 77 | 0,272 | **0,386** | 0,017 | 0,204 |
| SOLUSDT:15m | 562 | 0,051 | **0,121** | 0,017 | 0,018 |
| *(y 13 más)* | | | | | |

**Recuentos, con su contraste binomial de una cola:**

| comparación | recuento | p |
|---|---|---|
| **la activa gana a Optuna libre** | **17/20** | **0,0013** |
| **la activa gana a Optuna coherente** | **15/20** | **0,021** |
| la activa gana a la manual | 12/20 | 0,252 |
| Optuna libre gana a la manual | 11/20 | 0,412 |
| Optuna coherente gana a la manual | 9/20 | 0,748 |

Y **ninguna de las 40 configuraciones generadas pasa el guardia de promoción**: cero con libre, cero
con coherente.

## Qué significa, y qué no

**Lo que está establecido:**

1. **Con 40 trials, reoptimizar empeora** (17/20, p = 0,0013). Con 120 la diferencia desaparece
   (12/20, p = 0,252). Lo que está demostrado, entonces, no es que reoptimizar sea malo sino que
   **producción infra-optimiza**: `AUTO_TRIALS = 40` no basta para el espacio que explora.
2. **Nada se distingue del diseño manual.** Activa, libre y coherente están todas en el empate
   estadístico frente al `ensemble.yaml` de M3 (p entre 0,25 y 0,75). Un año de optimización
   automática no ha producido una configuración demostrablemente mejor que la escrita a mano.
3. **La coherencia de régimen no se justifica por rendimiento, y tampoco cuesta.** Su efecto
   **cambia de signo** con el número de trials: con 40 va mejor que la búsqueda libre (5/20 contra
   3/20) y con 120, peor (6/20 contra 8/20). Es decir, no hay evidencia de que ayude ni de que
   perjudique. Se activa porque el mecanismo debe significar lo que dice —`regime_label` se guarda
   en cada decisión—, no porque rinda más.

**Lo que NO está establecido:**

- **No** que «Optuna sea inútil» en abstracto. Lo medido es este espacio de búsqueda, con estos
  datos, contra estas configuraciones.
- **No** que la configuración manual sea buena. Es indistinguible de las demás, y todas rondan
  expectancies de ±0,1 R. Empatar en la mediocridad sigue siendo mediocridad.
- **No** que la búsqueda esté agotada: triplicar los trials movió el resultado, así que el espacio
  todavía tiene margen sin explorar. Lo que no aparece, ni con 40 ni con 120, es una **ventaja**.

## El control: ¿eran pocos trials? Sí, y cambia el veredicto

Era la objeción obvia. Se repitió con **120 trials** —el triple— sobre las mismas 20 claves y el
mismo hold-out.

| comparación | 40 trials | 120 trials |
|---|---|---|
| la activa gana a Optuna libre | **17/20** (p = 0,0013) | 12/20 (p = 0,252) |
| la activa gana a Optuna coherente | **15/20** (p = 0,021) | 14/20 (p = 0,058) |
| Optuna libre gana a la manual | 11/20 (p = 0,412) | 10/20 (p = 0,588) |
| la activa gana a la manual | 12/20 (p = 0,252) | 12/20 (p = 0,252) |
| configuraciones que pasan el guardia | 0 | 2 |

Y la mejora media frente a la activa sube al triplicar la búsqueda: de **−0,063 a −0,041 R** en la
libre, de −0,064 a −0,047 en la coherente.

**Lo que esto obliga a corregir:** «reoptimizar empeora» era un artefacto de usar 40 trials. Con una
búsqueda tres veces más larga, la diferencia deja de ser significativa. Lo que el estudio demuestra
de verdad es que **producción está infra-optimizando**: `AUTO_TRIALS = 40` es demostrablemente
insuficiente para el espacio que tiene que explorar.

**Lo que NO cambia:** con 120 trials tampoco aparece ninguna ventaja. Optuna sigue sin ganar a la
configuración manual (10/20, p = 0,588), y la activa tampoco (12/20, p = 0,252). Todo sigue dentro
del empate.

### Las dos promociones, y por qué no son evidencia

Con 120 trials aparecen dos configuraciones que pasarían el guardia:

| clave | condición | activa | optimizada | nula P95 | n |
|---|---|---|---|---|---|
| BTCUSDT:4h | libre | +0,001 | **+0,265** | 0,154 | 109 |
| ETHUSDT:4h | coherente | +0,113 | **+0,328** | 0,172 | 122 |

Tentador, y hay que resistirse: son **20 claves × 2 condiciones = 40 pruebas** contra un listón del
percentil 95. Encontrar dos que lo superen es **exactamente lo que produce el azar** (40 × 0,05 = 2).
Sin corrección por comparaciones múltiples no son un hallazgo, son el ruido esperado.

Que ambas caigan en 4h —la temporalidad que lleva en cuarentena desde M10.5 por acumular −0,485 R en
producción— es una razón más para no fiarse.

## Qué hacer con esto

Hay una decisión que tomar y los datos no la resuelven solos, porque apuntan a dos lecturas
legítimas:

**(a) Subir `AUTO_TRIALS` a 120 o más.** Está demostrado que 40 infra-optimiza, y con el backtest
lineal el coste es asumible: una optimización pasa de 19 s a unos 56 s por clave, y el paso completo
de ~6 a ~19 minutos —semanal—. Es lo correcto *si* se va a seguir optimizando.

**(b) Dejar de reoptimizar en piloto automático.** Ni con 40 ni con 120 trials aparece una ventaja
sobre la configuración manual, y el guardia ya frena de hecho casi todo. Optimizar cada semana algo
que no mejora es gastar ciclo y arriesgar promociones de ruido.

Lo que **no** es defendible es lo actual: seguir optimizando cada semana con 40 trials, que es la
peor de las dos —el coste de (a) con el resultado de (b)—.

### Decidido (0.62.0): la opción (b)

`optimize_every_h = 0`, y ese valor apaga la optimización automática **entera**, no solo la
periódica. Es deliberado: las tres vías —primera vez, degradación y mantenimiento— llaman al mismo
optimizador, y apagar solo el mantenimiento dejaría viva la de degradación, que reoptimizaría justo
las claves que peor van — donde más tienta el sobreajuste.

**No se borra nada.** `POST /run-optimize` sigue lanzando una optimización a mano, y
`run_optimizador_estudio` sigue disponible para rehacer la pregunta cuando cambie algo sustancial:
más historia, un indicador nuevo, otro espacio de búsqueda. Subir el parámetro vuelve a encenderlo.

Lo que se apaga es **hacerlo cada semana sin que nadie mire el resultado**.

Lo que sí abre este resultado es una pregunta mejor: si el espacio de pesos no tiene nada más que
dar, el margen no está en ajustar los votos sino en **qué se vota**. La plataforma sigue sin
habilidad direccional demostrable, y ningún reparto de pesos sobre los mismos ocho indicadores va a
producirla.

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_optimizador_estudio 40
```
