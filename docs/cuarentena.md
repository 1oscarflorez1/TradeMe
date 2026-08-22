# Cuarentena de temporalidades

> Una temporalidad en cuarentena **se calcula y se registra, pero no emite señal operable**. Se le
> retira el permiso para operar, no la observación.

## Por qué existe

En agosto de 2026, la temporalidad de 4h de BTCUSDT acumulaba **−0,485 R en 89 decisiones**: 69 de
ellas cortos, y el **85,6 % acabó en el stop**. No era una racha mala, era un patrón sostenido.

La opción evidente —bajarle el peso o afinar los parámetros— tiene un problema: cuando algo pierde
dinero de forma consistente y no sabes por qué, ajustar los números es apostar a que la causa era el
número que has tocado. La cuarentena hace lo contrario: **para de operar y sigue mirando**.

## Cómo se entra y cómo se sale

El gobierno es automático y vive en `apps/quant/trademe_quant/quarantine_policy.py`, que publica
`artifacts/quarantine.json`. La api solo lo lee. Nadie mantiene una lista a mano.

| | Entrar | Salir |
|---|---|---|
| **Muestra mínima** | 30 decisiones evaluadas | 40 decisiones **sombra** evaluadas |
| **Umbral** | expectancy ≤ **−0,15 R** | expectancy ≥ **+0,05 R** |

**La asimetría es deliberada**: cuesta poco dejar de operar y cuesta mucho volver a hacerlo. Por eso
salir pide más muestra que entrar.

Y el umbral de salida se pide **claramente positivo**, no «≥ 0». Salir con 0,00 R sería volver a
operar algo que no ha demostrado ganar nada — solo que ha dejado de perder tanto.

Los dos umbrales se escribieron **antes de que existiera muestra suficiente para juzgarlos**.
Elegirlos después de ver los resultados sería elegirlos mirando el desenlace.

### Solo las decisiones recientes cuentan

`evaluate_real` mira **las 30 evaluadas más recientes**, no toda la historia. Esto corrigió un
defecto real: promediando toda la vida de una temporalidad, mezclar 30 decisiones recientes a
−0,260 R con 155 antiguas a +0,068 R daba −0,029 R — por encima del umbral. Una temporalidad que
estaba perdiendo dinero *ahora* quedaba absuelta por lo bien que le fue hace meses.

## El modo sombra, y el fallo de diseño que lo hizo necesario

Cuando la cuarentena se entregó en M10.5, la decisión vetada se guardaba con `direction = 'FLAT'` y
sin plan. El evaluador solo puntúa filas con `plan_entry IS NOT NULL` y dirección operable, así que
**ninguna decisión en cuarentena llegaba a evaluarse jamás**.

La consecuencia es la que importa: 4h no podía acumular una sola operación medida mientras estuviera
vetada, y por tanto **no podía demostrar nunca que merecía salir**. Se había escrito que la
cuarentena «retira el permiso para operar, no la observación», y retiraba las dos. La medida se dijo
temporal y era, en la práctica, irreversible por construcción.

Se corrigió en M10.7 (migración 017): ahora se registra también **qué habría hecho**, en columnas
propias:

```
shadow_action · shadow_direction · shadow_entry · shadow_stop · shadow_take_profit
shadow_outcome_result · shadow_outcome_return_r · shadow_evaluated_at
```

**Columnas propias, no las de `outcome_*`.** El aislamiento tiene que ser estructural, no de
disciplina: si la sombra escribiera en las columnas reales, cualquier consulta existente —el resumen
de Registros, la expectancy, el dataset del meta-modelo— contaría como ganada una operación que
nadie abrió. Con columnas separadas esa confusión es imposible aunque alguien olvide filtrar.

Estas cifras alimentan el expediente de la temporalidad. **Nunca el rendimiento.**

## La causa que se creyó, y resultó falsa

Durante meses la explicación aceptada fue que 4h operaba sin contexto de fondo: se ponía corto
contra una tendencia alcista mayor, y el análisis fundamental lo habría evitado.

En M11 se pudo comprobar. Se reconstruyó el funding real de aquel periodo desde el histórico de
Binance —un hecho registrado, no una estimación hecha después— y se recalculó el sesgo macro con los
parámetros exactos del motor:

- macroBias medio: **−0,496** (bajista)
- **0 de 60** veces habría vetado un corto
- **60 de 60** lo habría reforzado

El escudo macro no habría salvado el 4h. Habría empujado en la misma dirección que ya fallaba. El
diagnóstico original era una inferencia a partir de los desenlaces, no una medición, y estaba escrito
en cinco sitios distintos del proyecto.

**La cuarentena sigue justificada por el resultado; la causa está por determinar.** Que es una frase
incómoda y es la única honesta.

## Dónde encaja en la decisión

La cuarentena se aplica **la última, por encima de todo lo demás** — después de la banda neutra, del
escudo macro y del meta-modelo:

```
votos → net → régimen → softmax → banda neutra → escudo macro → meta-modelo → CUARENTENA
```

No es una opinión que se pueda compensar con confianza alta: es una retirada del permiso. La decisión
se calcula entera —los votos, el net y las probabilidades quedan registrados— pero no sale de ahí
como operable. En el registro aparece con `hold_reason = 'cuarentena'`.

## El umbral de salida se compara con el azar (v0.46.0)

Hasta aquí la cuarentena tenía un problema que compartía con nadie: era **el único módulo de
gobierno con poder de veto activo sobre las decisiones** y **el único sin control contra el azar**.
El Fundamental Score tenía su distribución nula; el meta-modelo iba a tenerla; la cuarentena, que es
la que de verdad manda hoy, no.

Y aquí el problema muerde con fuerza, porque las decisiones que juzgan a una temporalidad se
amontonan en el tiempo. Medido el 22 de agosto de 2026:

| Clave | Decisiones | Caben en |
|---|---|---|
| `BTCUSDT:15m` | 30 | **9,8 horas** |
| `BTCUSDT:30m` | 30 | 26,5 horas |
| `SOLUSDT:15m` | 30 | 49,4 horas |

`BTCUSDT:15m` entró en cuarentena con −0,940 R sobre 30 decisiones de menos de un día. Eso puede ser
una temporalidad mala o puede ser **un mal martes**, y la medición anterior no lo distinguía.

### La pregunta que se le hace ahora al azar

> ¿Qué expectancy sale de coger `n` decisiones **cualesquiera** de la plataforma, en bloques de
> 24 horas, del mismo periodo?

Se muestrean bloques enteros y no filas sueltas, y esa es la parte que importa: muestrear bloques
hace que la nula **incorpore sola** el solapamiento temporal, sin inventar ningún factor de
descuento. Si una temporalidad concentra sus decisiones en un día, la pregunta correcta no es «¿30
decisiones cualesquiera darían esto?» sino «¿un día cualquiera de la plataforma daría esto?». Son
preguntas con respuestas muy distintas.

La población son los **14 días** anteriores a la decisión más reciente juzgada. No el periodo exacto
de lo observado, porque medido eso deja entre 1 y 4 bloques, y con cuatro días el «percentil 95» es
el mejor de los cuatro: no estima variabilidad ninguna.

### La regla es asimétrica, y es lo delicado

| Puerta | Regla | Efecto |
|---|---|---|
| **Salir** de cuarentena | `expectancy ≥ max(0,05 R, P95 de la nula)` | Más difícil volver a operar |
| **Entrar** en cuarentena | `expectancy ≤ −0,15 R` (sin cambios) | Igual de fácil dejar de operar |

**La nula solo se usa donde endurece la seguridad.** Aplicarla también a la entrada dejaría operando
temporalidades malas mientras no se demuestre que lo son —el efecto contrario al que se busca—.
Y no es cuestión de acordarse: `evaluate_real`, que es quien juzga la entrada, ni siquiera acepta el
argumento de la población. El fallo es estructuralmente imposible.

Que el umbral efectivo sea el **máximo** entre el fijo y el del azar significa que este cambio
**nunca puede relajar** el criterio: cuando la nula no se puede estimar —población corta, menos de 5
bloques— vale 0,0 y manda el 0,05 R de siempre.

### Qué dijeron los datos reales

Al ejecutarlo sobre las 1.302 decisiones cerradas de producción, con 10.000 permutaciones:

- **Ninguna temporalidad sale ni entra por este cambio.** Ninguna clave vetada tiene aún las 40
  decisiones sombra que hacen falta para plantearse salir (la que más lleva, `BTCUSDT:1h`, va por 31).
  Es una regla para cuando llegue la muestra, no un arreglo de algo que estuviera pasando.
- **Los vetos vigentes se sostienen.** Las cinco claves condenadas por rendimiento real quedan
  **por debajo del percentil 5** del azar: −0,940 R (`BTCUSDT:15m`), −0,900 (`BTCUSDT:30m`), −0,769
  (`BTCUSDT:1h`), −0,700 (`SOLUSDT:15m` y `BNBUSDT:1h`), contra un suelo del azar en −0,70. No fue un
  mal martes.

### Lo que este cambio NO arregla

Hay un fallo aparte, detectado al medir esto: `publish` elige a qué expediente mirar con
`interval in quarantine_intervals`, es decir con la lista del `ensemble.yaml`, **que es por
temporalidad**; pero quien veta de verdad es `quarantine.json`, **que es por clave**.

Consecuencia: una clave vetada por su rendimiento real —`BTCUSDT:15m`, por ejemplo— deja de producir
`outcome_return_r` y su expediente real se queda congelado en las decisiones de antes del veto. Como
su temporalidad no figura en el yaml, el gobierno la sigue juzgando con ese expediente congelado y la
recondena cada ciclo con las mismas filas. **Nunca llega a la puerta de salida.**

Son **5 claves** hoy. Es el mismo fallo que la migración 017 arregló para 4h, reaparecido en el eje
`SÍMBOLO:intervalo`, y está pendiente de decidir cómo se cierra.

## Estado actual

Por símbolo y temporalidad (claves `SÍMBOLO:intervalo` en `quarantine.json`), no global:

| Clave | En cuarentena | Motivo |
|---|---|---|
| `BTCUSDT:4h` · `ETHUSDT:4h` · `SOLUSDT:4h` · `BNBUSDT:4h` · `ARQQ:4h` | sí | base del `ensemble.yaml`; acumulando sombra (de 1 a 22 de 40) |
| `BTCUSDT:15m` | sí | entró sola: −0,940 R en 30 decisiones (el límite está en −0,15) |
| `BTCUSDT:30m` | sí | entró sola: −0,900 R en 30 |
| `BTCUSDT:1h` | sí | entró sola: −0,769 R en 30 |
| `SOLUSDT:15m` | sí | entró sola: −0,700 R en 30 |
| `BNBUSDT:1h` | sí | entró sola: −0,700 R en 30 |
| `BTCUSDT:1d` | no | opera con normalidad (+1,500 R en 30) |
| `SOLUSDT:30m` | no | opera con normalidad (+1,100 R en 30) |
| `ETHUSDT:30m` | no | opera con normalidad (+0,400 R en 30) |
| `BTCUSDT:1m` | no | opera con normalidad (+0,267 R en 30) |
| `BTCUSDT:5m` | no | opera con normalidad (+0,044 R en 30) |

Las cinco que entraron solas se distinguen del azar (por debajo de su percentil 5); las tres primeras
que operan, también, por arriba. Datos del 22 de agosto de 2026.

Nadie tocó una lista para que 1h entrara: la política lo decidió con sus propios umbrales.

## Con varios activos

Desde el multiactivo (v0.39.0), ETH, SOL y BNB **heredan la cuarentena de 4h** que estaba fijada como
base en `ensemble.yaml`. Es la postura conservadora: de esos activos no se sabe nada todavía, y
heredar el veto no cuesta nada porque **la sombra sigue registrándose**. Cada uno acumulará su propio
expediente y saldrá solo cuando lo demuestre, con las mismas 40 decisiones y el mismo +0,05 R.

Lo que **no** se hereda es el veredicto: `quarantine.json` tiene una entrada por símbolo y
temporalidad, así que que 1h esté vetada en BTC no dice nada sobre 1h en ETH.

## Preguntas frecuentes

**¿Por qué no se borra directamente la temporalidad?**
Porque entonces no habría forma de saber si el problema era la temporalidad o el momento del mercado.
La cuarentena es reversible por diseño; borrarla no.

**¿Las decisiones en cuarentena cuentan para la expectancy?**
No. Ni las reales (no hay ninguna: no se opera) ni las sombra (están en columnas separadas
precisamente para que no puedan contarse por error).

**¿Y las decisiones anteriores a M10.7?**
Se quedaron sin sombra. Reconstruirles un plan a posteriori exigiría recalcular la señal con la
configuración de aquel momento, e inventarlo sería exactamente el look-ahead que el proyecto evita.

## Relacionado

- [independencia.md](independencia.md) — el desinflado por dependencia de los votos
- [metamodelo.md](metamodelo.md) — el otro mecanismo que vive en sombra hasta demostrar su valor
- [fundamental.md](fundamental.md) — el mismo gobierno aplicado al Fundamental Score
- [metodologia.md](metodologia.md) — por qué nada gana poder sobre una decisión sin demostrarlo
