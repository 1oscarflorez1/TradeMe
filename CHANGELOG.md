# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y [Versionado Semántico](https://semver.org/lang/es/).

> Este fichero es la **única fuente** del historial de versiones: la pestaña Novedades y el
> asistente lo leen de aquí. No se edita ninguna copia aparte, y CI comprueba que la versión de
> los `package.json` coincide con la primera entrada de abajo.

## [0.48.0] — 2026-08-22

> Un listón no es un cupo. El umbral de salida que se entregó en 0.46.0 exigía el percentil 95 de
> una nula muestreada de la propia plataforma, y eso, por construcción, solo lo cruza el 5 %.

### Fixed — La puerta de salida pasa a ser no-inferioridad al mercado, no el percentil 95

- El error estaba en el propio diseño del Hito A, no en su ejecución: **la nula se muestrea de la
  plataforma misma**, así que pedir su P95 para readmitir es un cupo del 5 %. Si todas las
  temporalidades fueran buenas e idénticas, el 95 % seguiría vetado.
- Con la relación 2:1 traducida a tasa de acierto (`E = 3w − 1`), lo que se estaba exigiendo:

  | | Entra en cuarentena | Volvía a operar (0.46.0) |
  |---|---|---|
  | Umbral | −0,15 R | ~0,70 R |
  | Aciertos | ≤ 28 % | ≥ 57 % |

- Una banda muerta del 28 % al 55 % con el punto de equilibrio del sistema en el 33 %: ahí dentro
  caben temporalidades **rentables**.
- La comprobación que lo dejó claro: de las claves que operaban ese día, **la mitad no habría podido
  volver** si hubiera caído en cuarentena. `BTCUSDT:1m` operaba sin objeción con +0,267 R y para
  regresar habría necesitado +0,735 R.
- El criterio pasa a `max(0,05 R, mediana de la nula + 0,05 R)`: *sé algo mejor que un tramo típico
  del mercado que hubo*. El 0,05 R sigue siendo un **suelo**, así que por muy malo que vaya el
  mercado no se sale con 0,00 R.

### Changed — Lo que se conserva del Hito A, y lo que se corrige

- **Se conserva la neutralidad respecto al régimen**, que era el objetivo declarado: el listón sube
  en las rachas buenas y baja en las malas. El P95 no lo hacía neutral, lo hacía extremo.
- **Se conserva el caso que motivó el hito**: con la plataforma en una racha de +1 R, una
  temporalidad cuya sombra dé +0,30 R sigue sin salir. Hay un test que lo fija.
- `meta_policy` y `fundamental_policy` **siguen con el P95**, y no es incoherencia: allí la pregunta
  es «¿este mecanismo aporta algo o es azar?», con un solo candidato al que se exige evidencia
  fuerte. Aquí es «¿esta temporalidad merece volver?», con muchos competidores homogéneos. Preguntas
  distintas, percentiles distintos. Queda escrito en `nula.PERCENTIL_REFERENCIA`.
- Es el defecto espejo del que `meta_policy` ya documentaba: allí un umbral que solo se comprueba al
  ascender es un peaje de entrada; aquí un umbral de readmisión mucho más alto que el de permanencia
  es un cupo.

### Verificado sobre los datos reales antes de entregar

Con las 1.339 decisiones cerradas y el artefacto de producción: **ninguna clave sale hoy**, porque a
todas les falta muestra. La corrección no libera a nadie de golpe; cambia hacia dónde tiende la
plataforma. La candidata más cercana es `BNBUSDT:4h` (+1,062 R en 16 de 40), y con el criterio nuevo
se le sumaría `BTCUSDT:1h` (+0,355 R en 31 de 40), que con el P95 no habría vuelto nunca.

### Changed — El percentil deja de estar en el nombre de la función

`p95_expectancy_bloques` pasa a `percentil_expectancy_bloques`, con el percentil explícito en la
llamada. Cuál es el correcto depende de la pregunta, y confundirlos ya salió caro una vez.

### Sin cambios — La puerta de entrada

Sigue en −0,15 R. Cambiar las dos a la vez mezclaría efectos y no se sabría cuál hizo qué. Con la
salida arreglada, el desequilibrio deja de ser urgente y se podrá medir con datos limpios.

## [0.47.0] — 2026-08-22

> Una cuarentena que no se puede levantar no es una cuarentena, es una condena. Había 11 claves
> vetadas acumuladas en seis días, 6 de ellas incapaces de volver jamás, y ninguna había salido
> nunca.

### Fixed — El destrabe: las claves vetadas por su rendimiento vuelven a tener camino de vuelta

- `publish` elegía a qué expediente mirar con `interval in quarantine_intervals` —la lista del
  `ensemble.yaml`, **que es por temporalidad**— cuando quien veta de verdad es `quarantine.json`,
  **que es por clave `SÍMBOLO:intervalo`**.
- Una clave que entraba en cuarentena por su rendimiento real dejaba de producir
  `outcome_return_r` —una temporalidad vetada solo genera sombra—, así que su expediente real se
  congelaba en las decisiones de antes del veto. Como su temporalidad no figuraba en el yaml, se la
  seguía juzgando con **ese expediente congelado** y se la recondenaba cada ciclo con las mismas
  filas. **Nunca llegaba a la puerta de salida.**
- Es el fallo de la migración 017 reaparecido en el eje `SÍMBOLO:intervalo`: *«una medida temporal,
  irreversible por construcción»*.

### Fixed — Lo que se estaba viendo en producción, y por qué corría prisa

| | |
|---|---|
| Claves vetadas | **11 de 21**, acumuladas en seis días |
| De ellas, atrapadas | **6** |
| Claves que habían salido alguna vez | **0** |
| Ritmo de entrada | ~2 al día, sin frenar |
| Actividad del 22 de agosto | 53 decisiones reales frente a **51 en sombra** |
| Claves operando | 12 el día 19 → **5** el día 22 |

Casi la mitad de lo que calculaba la plataforma ya no se emitía, y el trinquete solo giraba en un
sentido. Dos de las seis atrapadas estaban además a punto de tener muestra suficiente —`SOLUSDT:15m`
con 35 de 40 decisiones sombra y `BTCUSDT:1h` con 31—, así que habrían cruzado el mínimo y seguido
condenadas igual, dejando sin efecto el gobierno que se acababa de entregar en 0.46.0.

### Changed — El yaml pasa a ser un suelo, no un techo

- `quarantine_intervals` puede vetar una temporalidad entera, pero **quitarla de la lista ya no
  levanta un veto vigente**: quien esté vetado sigue vetado hasta demostrar la salida con su
  expediente sombra. Una cuarentena se levanta con evidencia, no editando un fichero.
- La vía manual, si algún día hiciera falta, es borrar la entrada del artefacto.
- Sin artefacto, o con uno ilegible, manda el yaml: exactamente el comportamiento anterior.

### Changed — Se acaban las alertas falsas de cada ciclo

Las 6 atrapadas publicaban `changed = true` en cada pasada, porque `was_quarantined` se leía del
yaml y siempre salía `false`. Cada ejecución del piloto automático generaba 6 alertas de «entra en
cuarentena» sobre claves que ya llevaban días vetadas. Medido antes de entregar: **de 6 por ciclo
a 0**.

### Verificado sobre los datos reales antes de entregar

Simulado el ciclo completo con las 1.339 decisiones cerradas y el artefacto de producción:

- **0 claves cambian de estado.** Nadie sale ni entra de golpe.
- **6 pasan de juzgarse por su expediente real a su expediente sombra**, que sí crece.
- Ninguna sale todavía, porque a todas les falta muestra: siguen vetadas por *«n/40 decisiones
  sombra evaluadas»*, que es el motivo correcto en vez de una recondena con filas viejas.

### Changed — La duplicación que causó el fallo, eliminada

El informe `run_quarantine_nula` sabía leer el artefacto por clave y el gobierno no: dos copias de
la misma regla que discrepaban, y esa discrepancia era exactamente el fallo. Ahora el informe delega
en `quarantine_policy.estado_previo`, con un test que comprueba que no pueden divergir. La marca
`⚠ ATRAPADA` se queda como **detector de regresión**: debe dar siempre 0.

### Pendiente, medido y no tocado a propósito

El umbral de **entrada** sigue en −0,15 R. El ritmo de 2 claves al día sugiere que es demasiado
sensible con 30 decisiones que caben en horas: la última en entrar, `ETHUSDT:30m`, lo hizo con
−0,200 R y **p = 0,471**, o sea indistinguible del azar. Cambiarlo a la vez que la semántica del
estado mezclaría dos efectos y no se sabría cuál hizo qué.

## [0.46.0] — 2026-08-22

> La cuarentena era el único módulo de gobierno con poder de veto activo sobre las decisiones, y el
> único que no comparaba su umbral con lo que consigue el azar. Ya no.

### Added — La puerta de salida de la cuarentena se compara con una distribución nula

- **El problema, medido**: las decisiones que juzgan a una temporalidad se amontonan en el tiempo.
  `BTCUSDT:15m` entró en cuarentena con −0,940 R sobre 30 decisiones que caben en **9,8 horas**.
  Eso puede ser una temporalidad mala o puede ser un mal martes, y la medición no lo distinguía.
- La nula pregunta: *¿qué expectancy sale de coger `n` decisiones cualesquiera de la plataforma, en
  bloques de 24 h, del mismo periodo?* Se muestrean **bloques enteros**, y ahí está la gracia: eso
  hace que la nula incorpore sola el solapamiento temporal, sin inventar ningún factor de descuento.
- La puerta de salida exige ahora `max(0,05 R, P95 de la nula)`.

### Changed — La regla es asimétrica, y a propósito

- **Salir** de cuarentena: se compara con el azar. **Entrar**: sin cambios, umbral fijo de −0,15 R.
- Exigir significancia para *entrar* dejaría operando temporalidades malas mientras no se demuestre
  que lo son, que es el error contrario y el caro. La nula solo se usa donde endurece la seguridad.
- No es cuestión de acordarse: `evaluate_real`, que juzga la entrada, **ni siquiera acepta** el
  argumento de la población. Aislamiento estructural, no de disciplina.
- Como el umbral efectivo es el máximo entre el fijo y el del azar, el cambio **nunca puede
  relajar** el criterio. Sin nula estimable vale 0,0 y manda el 0,05 R de siempre.

### Changed — El meta-modelo también compara su lift con el azar

- El umbral de +0,05 R no distinguía mérito de suerte: un modelo entrenado con **etiquetas
  barajadas** produce un lift medio de +0,083 R. El azar lo superaba de media.
- Nula sin reentrenar, sobre las probabilidades ya guardadas. Se exige `max(0,05 R, P95)` tanto para
  ascender como para permanecer.
- **Ojo con el estadístico**: el Fundamental Score reparte los descartes sobre `n` (una operación
  evitada aporta 0 y sigue contando) y el meta-modelo promedia **solo las conservadas**. Se llaman
  igual y son cosas distintas, así que `nula.py` recibe el estadístico desde fuera.

### Added — `nula.py`, y el patrón que ya iba por la tercera vez

Fijar un listón sin preguntarle antes al azar ha fallado tres veces seguidas en este proyecto: con
los votos efectivos, con el lift del meta-modelo y con el del Fundamental Score. El bucle de
permutación por bloques vivía duplicado; ahora es un módulo con dos nulas —selección y expectancy— y
sus guardias. Cuando no se puede estimar devuelve 0,0 y manda el umbral fijo.

Se verificó que trasladar el bucle **no mueve un solo dígito** del percentil que ya calculaba
`fundamental_policy`, con la misma semilla y en doce repartos distintos.

### Added — Informe `run_quarantine_nula` y lo que dijo sobre los datos reales

Ejecutado sobre las 1.302 decisiones cerradas de producción, con 10.000 permutaciones:

- **Ninguna temporalidad sale ni entra por este cambio.** Ninguna clave vetada tiene todavía las 40
  decisiones sombra para plantearse salir; la que más lleva va por 31. Es una regla para cuando
  llegue la muestra.
- **De los cinco vetos por rendimiento real, dos se sostienen y tres no.** `BTCUSDT:15m`
  (−0,940 R, p=0,005) y `BTCUSDT:30m` (−0,900 R, p=0,010) se distinguen del azar; `BTCUSDT:1h`
  (p=0,073), `SOLUSDT:15m` (p=0,089) y `BNBUSDT:1h` (p=0,093), **no**. Esas tres podrían estar
  teniendo un mal martes.
- Siguen vetadas, y es lo correcto: la puerta de entrada no usa la nula precisamente para esto. Si
  la usara, seguirían operando mientras se reúne la evidencia de que pierden dinero. El dato sirve
  para saber cuáles han demostrado algo y cuáles no, no para levantarles el veto.
- El p-valor se calcula **bilateral y contando los empates**, no comparando con el percentil 5. No
  es un detalle: `SOLUSDT:15m` y `BNBUSDT:1h` dan exactamente −0,700 R y el percentil 5 de su nula
  cae también en −0,700. Comparar con `<` las declaraba «distintas del azar» por un residuo de coma
  flotante. Con desenlaces casi discretos —casi todo es −1 R o +2 R— los empates son el caso normal,
  no una rareza de laboratorio.

### Fixed — Un fallo aparte, encontrado al medir: 5 claves atrapadas en cuarentena

`publish` elige a qué expediente mirar con `interval in quarantine_intervals` —la lista del
`ensemble.yaml`, **que es por temporalidad**—, pero quien veta de verdad es `quarantine.json`, **que
es por clave**. Una clave vetada por su rendimiento real deja de producir `outcome_return_r`, su
expediente real se queda congelado en las decisiones de antes del veto, y como su temporalidad no
figura en el yaml se la recondena cada ciclo con las mismas filas. Nunca llega a la puerta de salida.

Es el fallo de la migración 017 reaparecido en el eje `SÍMBOLO:intervalo`. **Queda documentado y
medido, no corregido**: cerrarlo cambia la semántica del estado de cuarentena y merece su propia
decisión. El informe lo marca con `⚠ ATRAPADA`.

## [0.45.0] — 2026-08-22

> Limpieza de deuda. Y el test que se escribió para vigilar el Centro de ayuda encontró tres enlaces
> rotos al primer intento — uno de ellos lo había dejado la entrega de M12.

### Fixed — Los activos sin funding guardaban `fund_percentile = 0` en vez de `NULL`

- `stale` significa «no se sabe dónde cae este funding», y eso **no es un percentil 0**: el 0 es una
  lectura legítima —funding en el mínimo de su ventana— y ocurre de verdad. Guardar el mismo valor
  para las dos cosas mezclaba «sin datos» con «funding muy bajo» en cualquier análisis por percentil.
- Es el mismo error conceptual que el funding a cero de 0.38.0, esta vez en la capa de persistencia:
  convertir un «no lo sé» en un número con aspecto de medición.
- Migración **020** que limpia el histórico. La penalización se deja como está: un 0 ahí es un hecho
  sobre la decisión —no se penalizó a nadie—, no una laguna.

### Changed — `HelpView.tsx` pasa de 1017 a 262 líneas

- Las ~700 líneas de contenido salen a `help/contenido.tsx`. Escribir un artículo ya no obliga a
  tocar el componente que lo pinta.
- Y lo que de verdad importaba: el índice pasa a ser un **dato consultable**. El asistente cita ahora
  el artículo exacto —«Lo tienes explicado en *«…»*»— en vez de remitir genéricamente al Centro de
  ayuda.
- Sigue **sin derivarse del CHANGELOG**, como estaba decidido: Ayuda es documentación conceptual, no
  un registro de cambios. Tres registros con público distinto (CHANGELOG → Novedades y asistente;
  `docs/` → asistente técnico; Ayuda → usuario), y mezclarlos empeoraría los tres.

### Added — Tests de coherencia del Centro de ayuda, y lo que encontraron

Las referencias entre `RESUMEN`, `RUTAS` y lo que cita el asistente son **cadenas de texto**:
renombrar un artículo las rompe sin que nada falle. Los tests convierten esa disciplina en
estructura — y al ejecutarlos por primera vez fallaron tres:

- **`RESUMEN` huérfano**: «Análisis fundamental (en pausa)». Ese artículo se renombró al entregar
  M12 y su resumen se quedó apuntando al título viejo. La ficha llevaba desde entonces sin resumen.
- **El asistente citaba «correlación» y ningún artículo lo cubría** para la búsqueda, pese a existir
  el artículo de exposición correlacionada.
- **Cuatro términos duplicados en el glosario** (Expectancy, Win rate, Profit factor, Sharpe): un
  bloque «Clave» con versiones abreviadas de definiciones que ya estaban más completas.

Los tres arreglados.

## [0.44.0] — 2026-08-22

> Se midió si al Fundamental Score le pasaba lo mismo que al meta-modelo. La respuesta fue distinta
> y más útil: **su umbral no falla por selección, falla por régimen**.

### Added — Distribución nula del Fundamental Score

- Medido sobre 114 decisiones LONG cerradas con 10.000 permutaciones. La hipótesis nula correcta no
  es barajar resultados —eso cambiaría el baseline— sino: *¿descartar estas d compras es mejor que
  descartar d cualesquiera?*
- **Dos nulas**, porque las observaciones están correlacionadas (1,52 activos efectivos): simple y
  **por bloques de 24 h**. El veredicto usa la más conservadora. Una permutación simple habría
  subestimado la varianza — sería tratar `n` como evidencia otra vez.

| | |
|---|---|
| expectancy base | +1,395 R |
| descartadas | 79 de 114 (69 %) |
| **lift observado** | **−0,965 R** |
| nula simple | [−1,044, −0,886] |
| nula por bloques | [−1,018, −0,149] |
| AUC | 0,511 (nula [0,408, 0,587]) |

- **El score descarta como si eligiera al azar**: el lift coincide casi exactamente con el nulo
  simple y el AUC es 0,511. Con esta muestra no distingue buenas de malas compras.

### Changed — El umbral se compara con el azar, no con un número fijo

- El lift nulo del Fundamental Score es **negativo**, al revés que el del meta-modelo. Es aritmética:
  con baseline +1,395 R, descartar el 69 % al azar arrastra la media hacia cero. En el meta-modelo la
  nula salía positiva porque `pick_threshold` optimizaba el corte; aquí la fórmula es fija y no hay
  nada que optimizar.
- Consecuencia: **un umbral fijo no es neutral respecto al régimen**. Los mismos 0,05 R son exigentes
  en rachas buenas y regalados en las malas — cuando el baseline es negativo, cualquier filtro que
  quite operaciones parece bueno.
- El gobierno usa ahora `umbral_efectivo = max(0,05 R, percentil 95 de la nula)`. Neutral al régimen
  y **solo endurece**: nunca deja pasar algo que antes no pasaba. Se recalcula en cada ciclo (1.000
  permutaciones por bloques) y se publica como `lift_nulo_p95` en la evidencia.

### Estado

El score sigue en **sombra**, y ahora por dos motivos independientes: muestra insuficiente en
observaciones efectivas, y un lift que no se distingue del azar.

## [0.43.0] — 2026-08-22

> El meta-modelo no estaba invertido: **no aprende**. Y al comprobarlo apareció algo mayor — el
> umbral que exigimos para promocionarlo lo supera el azar de media.

### Added — Diagnóstico del meta-modelo (Fase A): resultado **negativo**

- Parecía anti-correlacionado: AUC 0,46 y, en BTCUSDT, +0,195 R en el tercil de menor confianza
  frente a −0,168 R en el de mayor, con la dirección repetida en las cuatro temporalidades.
- Antes de buscar causas, se descartó la más simple. Con 785 decisiones evaluadas y el reparto
  correcto, el **AUC es 0,4967** y el nulo de 10.000 barajadas es [0,4216 – 0,5796]: **dentro**,
  p = **0,942**. Azar puro.
- Segunda prueba, permutando **y reentrenando** 300 veces para juzgar el procedimiento entero: AUC
  observado 0,497 sobre un nulo [0,163 – 0,842], y lift +0,260 sobre un nulo [−0,469 – +0,816]. Los
  dos dentro.
- **No hay un modelo invertido que arreglar: hay un modelo que no aprende.** Lo que falta no es
  afinar el bosque, son features que no deriven todas del mismo precio — las 15 actuales salen de
  seis votos que valen 1,41 efectivos.

### El hallazgo que va más allá del meta-modelo

- El nulo del lift tiene **media +0,083 R** y llega a **+0,816 R** en el percentil 95. El umbral para
  promocionar es **0,05 R**: un modelo entrenado con etiquetas barajadas lo supera de media.
- La causa es mecánica: el filtro conserva pocas señales (32 de 157) y con muestras pequeñas
  quedarse con un subconjunto produce mejoras aparentes. Con el AUC pasa igual: exigir ≥ 0,55 no
  protege cuando el percentil 95 del azar llega a 0,84.
- Es el mismo tipo de fallo que el control de ruido destapó en los votos efectivos: un criterio que
  parece riguroso y que el azar supera. **Van dos veces en este proyecto.**
- Esos umbrales gobiernan el meta-modelo **y** el Fundamental Score. Ninguno ha promocionado nunca,
  así que no ha habido consecuencia práctica — pero el listón no distingue mérito de suerte.
  **No se han tocado aquí**: cambiarlos afecta a dos componentes y merece su propia medición.

### Fixed — El umbral del meta-modelo se elegía mirando el conjunto de prueba

- `pick_threshold(probs_te, r_te)` seguido de medir la expectancy filtrada sobre ese mismo `r_te`:
  el umbral se optimizaba en los datos que después lo juzgaban, así que la mejora salía inflada por
  construcción y el `threshold` publicado venía ajustado a datos ya vistos.
- Ahora hay **tres tramos** —entrenamiento · selección · prueba—: el umbral se elige en el del medio
  y solo se juzga en el último.

### No se invirtió el modelo, a propósito

Era la tentación obvia. Habría sido el ajuste post-hoc que este proyecto evita desde M10.5 — y la
medición dice que tampoco habría funcionado: no hay señal que invertir.

## [0.42.0] — 2026-08-22

> El dato que faltaba en pantalla: cuando el sistema marca comprar en tres criptos a la vez, eso no
> son tres oportunidades. Son **una y media**.

### Added — Aviso de exposición correlacionada en el Panel

- Debajo de la decisión, cuando hay varias señales operables alineadas en distintos activos:
  **«3 señales de compra · ≈ 1,4 apuestas»**, con los símbolos implicados y el par más parecido
  entre sí.
- **Es un aviso, no un veto.** Las señales se muestran igual y la plataforma no ejecuta órdenes.
  Decidir cuánto arriesgar sigue siendo del usuario; esto solo pone delante un número que no estaba
  en ninguna pantalla y que cambia la respuesta a «¿cuánto arriesgo en esto?».
- Se toma el **lado cargado**: dos largos y un corto no se compensan, porque el riesgo está donde se
  acumulan.
- Nuevo endpoint `GET /exposicion?interval=15m`, que resuelve las señales de todos los activos de la
  lista y devuelve el resumen.

### Added — Los activos efectivos de cada combinación se precalculan en quant

- El artefacto de correlaciones incluye ahora `subconjuntos`: los efectivos de **cada** combinación
  de dos o más activos (11 con cuatro símbolos).
- Se hace ahí y no en la api a propósito: calcularlo exige autovalores de la submatriz, y
  reimplementar álgebra lineal en TypeScript para un dato **informativo** arriesgaría que la pantalla
  y el gobierno del Fundamental Score dieran números distintos. Con tope de 12 símbolos para que la
  combinatoria no se dispare.
- Medido en producción: BTC+ETH = **1,21** apuestas · BTC+ETH+SOL = **1,40** · los cuatro = **1,52**.

### Sin medición no se inventa un descuento

Si no hay correlación medida, el aviso dice que **no se sabe** en vez de enseñar un número. Mostrar
«1,4 apuestas» sin haberlo medido sería peor que callar: el usuario decidiría cuánto arriesgar con
una cifra falsa. Hay tests para las dos mitades.

### Added — Artículo en el Centro de ayuda

- Explica en lenguaje llano por qué tres señales pueden ser una sola apuesta, con los porcentajes
  reales, y deja claro que no bloquea nada. Más dos entradas de glosario: *apuestas efectivas* y
  *correlación*.

## [0.41.0] — 2026-08-21

> Cuatro activos cripto son, en información, **poco más de uno y medio**. El mismo hallazgo que el de
> los seis votos que valían 1,41, en otro eje — y esta vez corrige cuánta evidencia cree tener el
> sistema al juzgar a sus propios componentes.

### Added — Gestor de Correlaciones (fase de medición)

- Medido sobre 500 velas de 1h, los cuatro activos correlacionan entre **0,69 y 0,81**. Aplicando la
  participación de autovalores —la misma medida que `independence.py` usa para los votos—: **4
  activos nominales → 1,52 efectivos**.
- El gobierno del Fundamental Score pasa a comparar `MIN_SAMPLES` contra **observaciones efectivas**,
  no contra el recuento de filas. Sobre los datos actuales: **75 decisiones → 38,2 efectivas**.
- Publica `artifacts/correlaciones.json` en cada ciclo del piloto. **No toca ninguna decisión de
  trading**: solo corrige cuánta evidencia cree tener el sistema.

### Por qué el descuento no es `n × 0,38`

- Dos decisiones de ETH separadas por una semana **sí** son bastante independientes, aunque ETH y BTC
  se muevan juntos: la correlación entre activos solo resta cuando las decisiones son **simultáneas**.
- Por eso se agrupa en ventanas de **24 h** y dentro de cada una los activos presentes cuentan como
  sus efectivos. El descuento castiga la **concentración**, que es el problema real, y no la
  diversidad temporal, que es justo lo que se quiere premiar.
- Se correlacionan **retornos logarítmicos**, no precios: dos series con tendencia siempre parecen ir
  juntas aunque suban por motivos distintos.

### Verificado contra extremos conocidos

Aprendida la lección del Analista de Niveles —una métrica puede parecer rigurosa y no medir lo que se
cree—, hay tests contra los dos casos cuya respuesta se conoce de antemano: cuatro series aleatorias
independientes dan **> 3,3** efectivos, y cuatro copias de la misma serie dan **< 1,2**.

### Corregido — «multiplica la muestra por 4» era optimista

- Al entregar el multiactivo se dijo eso. La multiplicó por **~1,5** en evidencia real. Sigue
  mereciendo la pena —más regímenes, replicación entre activos, más decisiones por hora— pero el
  número era ingenuo, y cambia cuándo podrá juzgarse el Fundamental Score: hará falta del orden de
  250-270 decisiones brutas, no 100.

### Salvaguardas

- Suelo de 0,35: por muy correlacionados que estén, la muestra no se anula.
- Sin medición suficiente (menos de 100 velas, un solo activo, una serie plana), factor 1: no se
  descuenta nada.
- El descuento **solo endurece** el criterio; nunca puede provocar una promoción que sin él no
  ocurriría.
- Se publican **los dos números** (`n` y `n_efectivo`): la diferencia tiene que verse.

### Lo que no captura

La correlación entre **temporalidades del mismo activo**: una decisión de ETH en 15m y otra en 1h a
la misma hora son casi la misma observación y aquí cuentan como dos. Queda anotado.

## [0.40.0] — 2026-08-21

> El Fundamental Score ya puede ser juzgado. Y su primera lectura es negativa —aunque por ahora eso
> dice más del mercado de esta semana que del score.

### Added — Gobierno automático del Fundamental Score

- `fundamental_policy.py` mide el expediente sombra en cada ciclo y publica
  `artifacts/fundamental_policy.json`. Asciende de `shadow` a `active` solo con lift ≥ 0,05 R y
  AUC ≥ 0,55 —los umbrales escritos en la migración 019 antes de ver ningún resultado— y **retrocede
  en cuanto deja de cumplirlos**. Permanencia simétrica, la lección que el meta-modelo aprendió
  conservando poder con un AUC de 0,43.
- **El lift no se reconstruye**: sale de `fund_shadow_action`, que ya guarda qué se habría decidido.
  Donde la sombra discrepa, esa operación no se habría abierto y su resultado habría sido 0.
  Reconstruirlo a posteriori invitaría a elegir el criterio mirando el desenlace.
- **Solo LONG**, porque el score solo penaliza compras. Evaluarlo sobre cortos sería medir ruido y
  diluir la señal con él.
- **Mínimo de discrepancias, no solo de decisiones.** Un score que nunca cambia nada tiene lift 0
  por construcción, y eso se leería como «no perjudica» en vez de como «no ha demostrado nada».
- El `mode` de `ensemble.yaml` pasa a ser un **tope**: la automatización puede rebajar el modo, nunca
  subirlo. Si el artefacto falta o viene corrupto, el peor caso es que el score influya *menos*.

### Primera medición real: no promociona

| | |
|---|---|
| decisiones LONG cerradas | 75 (de 100 exigidas) |
| discrepancias | 44 |
| expectancy real | +1,08 R |
| con el score aplicado | +0,55 R |
| **lift** | **−0,53 R** |
| **AUC** | **0,456** |

- Se queda en sombra por muestra insuficiente, que es lo correcto. Pero la señal preliminar apunta a
  que el score **empeoraría** el resultado.
- Antes de concluir nada: **74 de esos 75 registros son de ETH y SOL dentro de las mismas 14 horas**,
  con 27 aciertos de 35 en ETH. El baseline de +1,08 R no describe la plataforma, describe ese rally.
  Es justo el escenario donde el funding alto **no** predice mal resultado.

### Documentado — `n` cuenta decisiones, no evidencia

- Cien decisiones correlacionadas siguen siendo casi una sola apuesta observada cien veces, y
  `MIN_SAMPLES` no protege de eso. Queda anotado en el módulo y en `docs/fundamental.md`: hasta que
  exista el Gestor de Correlaciones, hay que mirar el reparto por símbolo y por ventana antes de dar
  peso a un veredicto — tanto si favorece al score como si no.

## [0.39.3] — 2026-08-21

> La api no perdía la conexión con la base y reintentaba: **se moría**. Un despliegue que no
> arrancaba lo destapó.

### Fixed — Un reinicio de Postgres tumbaba la api entera

- `pg.Pool` emite un evento `error` cuando el servidor cierra una conexión **inactiva** —un reinicio
  de la base, mantenimiento, o apagar el contenedor—. `createPool` no tenía listener, y Node trata
  un `error` sin escuchar como excepción no capturada: **mata el proceso**.
- Ocurrió el 20 de agosto: al pararse Postgres, la api registró `terminating connection due to
  administrator command`, después `Unhandled 'error' event`, y salió con código 1. No hubo
  reconexión ni reintento; simplemente dejó de existir por un error en una conexión que ya nadie
  usaba.
- Con el listener, el pool descarta el cliente roto y sigue: la siguiente consulta abre una conexión
  nueva. Es la diferencia entre una base que se reinicia y una plataforma que se cae.
- Importa más de lo que parece porque al morir se pierde el estado en memoria —buffer de velas,
  sesgo macro, funding— y al volver hay que resembrar histórico, lo que gasta cupo de proveedores
  que sí lo tienen contado.

## [0.39.2] — 2026-08-21

> El asistente volvía a responder desde su base local, esta vez por un motivo distinto: el modelo
> nuevo existe y la clave vale, pero **una sola pregunta puede agotar la cuota del minuto**.

### Fixed — Se rendía al primer 429 en lugar de esperar

- Groq mide la cuota **por minuto** (8.000 tokens en esta cuenta). El código lanzaba un error
  genérico ante el 429 y caía al instante a la base local, convirtiendo un tope temporal en una
  caída.
- Ahora reintenta hasta dos veces respetando la cabecera `retry-after`, con la espera **acotada a
  8 s** por intento: un proveedor que pidiera esperar una hora no puede dejar colgada la petición
  del usuario.
- Error tipado `SinCupoError` y estado `sin_cupo`, para que quedarse sin cuota no se confunda con
  un proveedor caído. El endpoint responde **429**, no 502.

### Fixed — El mensaje de repuesto mandaba a revisar una configuración correcta

- Decía *«sin un modelo de lenguaje configurado»* con el modelo perfectamente configurado. Ahora
  distingue quedarse sin cupo —y dice que se vuelva a preguntar en un minuto— de una avería real.
- La comprobación de salud también: un 429 al consultar el catálogo ya no se marca como «proveedor
  caído». Importaba porque ese resultado **se cachea 15 minutos**, así que un diagnóstico inventado
  se quedaba pegado un cuarto de hora.

### Changed — Cada pregunta gasta bastante menos

Medido contra la API: **cambiar de modelo no era una salida**. En esta cuenta, todos los que
soportan herramientas tienen el mismo techo de 8.000 TPM (`gpt-oss-120b`, `gpt-oss-20b`,
`qwen3.6-27b`), y los únicos con 70.000 —`groq/compound` y `compound-mini`— responden
`tool calling is not supported`. Así que había que gastar menos:

- **Dos vueltas de herramientas en vez de tres.** Cada vuelta reenvía el hilo completo, ya crecido
  con los resultados anteriores; la tercera era la que solía reventar el cupo. Con dos, el modelo
  consulta y responde, que es el caso real.
- **El resultado de cada herramienta se recorta a 2.000 caracteres** en vez de 6.000. Eran ~1.500
  tokens por llamada, reenviados íntegros en la vuelta siguiente: dos consultas se comían la mitad
  del cupo del minuto antes de que el modelo escribiera una palabra.

## [0.39.1] — 2026-08-19

> El asistente llevaba días respondiendo desde su base local y nadie se había enterado: Groq retiró
> el modelo configurado y cada consulta devolvía 404 en silencio. Al ir a arreglarlo apareció que,
> aun con el modelo bueno, tampoco habría podido responder.

### Fixed — Un asistente caído se veía igual que uno sin configurar

- Groq retiró `llama-3.3-70b-versatile`. El portal no tenía forma de distinguir «el modelo ya no
  existe» de «no hay modelo configurado», así que el fallo solo salía a la luz cuando alguien
  preguntaba algo y recibía la respuesta de la base local con un 404 pegado al final.
- Ahora se comprueba el catálogo del proveedor **al arrancar** y cada 15 minutos, y el resultado
  aparece en `/health` y en la pestaña Estado. Si el modelo no está, el panel **lista los que sí
  ofrece la cuenta** para poder elegir uno.
- Los estados distinguen lo que se sabe de lo que no: `modelo_ausente`, `clave_rechazada`,
  `proveedor_caido` y `sin_catalogo`. Este último importa: hay proveedores compatibles con OpenAI
  que no publican `/models`, y ahí **no se puede concluir que el modelo falte**. Decirlo sería
  inventar un diagnóstico y mandar a cambiar algo que funciona.
- La comprobación no cuelga de `/health`: se cachea y se refresca en segundo plano. El estado de la
  plataforma no puede depender de la latencia de un tercero.

### Added — `docs/cuarentena.md`

- La cuarentena no tenía documento propio, a diferencia de la calibración, la independencia, el
  meta-modelo y el fundamental. Estaba explicada solo en comentarios de código y en el Centro de
  ayuda, y **el asistente no lee ninguno de los dos**.
- Recoge lo que estaba disperso: por qué entró 4h (−0,485 R en 89 decisiones, 69 cortos con el
  85,6 % al stop), los umbrales de entrada y salida y por qué son asimétricos, el modo sombra y el
  fallo de diseño que lo hizo necesario —la cuarentena era irreversible por construcción—, y la
  causa que se creyó durante meses y resultó falsa al medirla.

### Fixed — El asistente no encontraba documentos por cómo se escriben

- Preguntando «¿por qué las cuarentenas?», el modelo pide el tema `cuarentenas` y el fichero se
  llama `cuarentena.md`: la respuesta era «no hay documentación» teniéndola delante. Lo mismo
  habría pasado con `calibración` (tilde), `meta-modelo` (guion) o `datos externos` (espacio).
- La resolución ahora tolera mayúsculas, tildes, guiones, espacios y singular/plural en sus dos
  formas del castellano. Y compara **contra la lista de ficheros reales** en vez de construir una
  ruta con lo que llega de fuera, así que de paso cierra la puerta a salirse del directorio.

### Changed — El asistente ya no lee media explicación

- El tope por documento sube de 6000 a 9000 caracteres. A 6000 se truncaban **7 de los 29**
  documentos, y justamente los conceptuales —independencia, fundamental, cuarentena, asistente—,
  que son los que alguien pregunta. El asistente recibía la mitad y respondía con ella.

### Added — Artículo de cuarentena en el Centro de ayuda

- Con la parte incómoda incluida: no se sabe por qué falla el 4 horas, y la explicación que se dio
  por buena durante meses resultó falsa al poder medirla.

## [0.39.0] — 2026-08-19

> Cuatro activos cripto en lugar de uno. El objetivo no es «más mercados»: es que el proyecto pueda
> **replicar sus propios hallazgos**, porque hasta ahora todos venían de la misma serie de precios.
> De paso, pasar de uno a cuatro destapó tres piezas que asumían que solo existía BTCUSDT y que
> fallaban en silencio.

### Added — ETH, SOL y BNB por el streaming gratuito de Binance

- Alta en la watchlist con `provider: binance`. **Coste 0** y sin tocar el cupo de Twelve Data, que
  solo aplica a acciones: ARQQ sigue exactamente igual.
- Relleno retroactivo de funding a 120 días para los tres, reutilizando el `backfill_funding` de
  M11: **360 observaciones cada uno**, así que sus distribuciones son válidas desde el primer ciclo
  en vez de dentro de 90 días.
- Efecto inmediato en el Fundamental Score, que era el motivo del hito: con BTC solo, el funding
  estaba en el tercil bajo y la penalización era 0, así que **no se registraba ni una decisión
  sombra**. Con cuatro activos, **SOL entra en percentil 0,888 (penalización 0,832) y BNB en 0,557
  (0,336)** desde el primer momento. El score empieza a acumular expediente de verdad.

### Fixed — La Data Intelligence Layer solo pedía datos de BTCUSDT

- El piloto llamaba a `run_once(dsn)` sin símbolos, que cae en `default_providers()` con
  `["BTCUSDT"]` cableado. Cualquier activo añadido después quedaba **sin funding, sin interés
  abierto y sin long/short**, y por tanto con el Fundamental Score `stale` para siempre.
- Sin error a la vista: «sin datos» es un estado legítimo del score. Se veía solo en la base de
  datos — `derivatives_metrics` tenía tres filas y todas eran de BTC.

### Fixed — El dataset del meta-modelo habría perdido el 75 % de la muestra

- Deduplicaba por `DISTINCT ON (interval, candle_open)` **sin el símbolo**, en una consulta que no
  filtra por activo. Las velas de todos los símbolos comparten los mismos `candle_open` porque son
  ventanas de tiempo alineadas: con cuatro activos, cuatro filas habrían colapsado en una.
- Corregido a `(symbol, interval, candle_open)`. Habría sido el fallo más costoso del hito y el más
  difícil de notar: el dataset simplemente no habría crecido.

### Changed — Calibradores por símbolo

- El artefacto era único y entrenado con un solo activo (su versión lo delataba: `cal-BTCUSDT-30m`).
  Con varios activos habría mostrado la calibración de BTC en el panel de ETH.
- Ahora `symbols['ETHUSDT']['rango']`, y **un activo sin calibración propia no hereda la de otro**:
  se queda sin confianza calibrada. La calibración responde a «¿cuánto vale una confianza del 70 %
  *en este mercado*?» y esa respuesta no se transfiere entre activos.
- Transición cuidada: el artefacto en formato antiguo se sigue leyendo, pero **solo para el símbolo
  que su versión declara**. Así el despliegue no deja a BTC sin calibración ni se la inventa a los
  demás mientras el piloto no republica.

### Changed — El dataset del meta-modelo arrastra el símbolo

- `symbol` entra en el dataset pero **no como feature**: meterlo enseñaría al bosque a memorizar el
  activo. Está para poder hacer la prueba que de verdad importa —entrenar con BTC y validar con
  ETH/SOL/BNB— y para separar el modelo por símbolo si la medición lo pide.
- El meta-modelo **sigue global y en sombra**, sin cambios de comportamiento. Su anti-correlación
  medida (AUC 0,46; +0,195 R en el tercil de menor confianza frente a −0,168 R en el de mayor)
  queda pendiente de diagnóstico, y ahora habrá con qué validarlo fuera de muestra. **No se invierte
  nada a ojo.**

### Verificado en producción

- Impacto en base de datos despreciable: 26 MB totales y `candles` en 2,2 MB. Multiplicar por cuatro
  no requiere política de retención todavía.
- Los tres símbolos existen en Binance spot (velas) y en Futures (funding del perpetuo), comprobado
  antes del alta.
- Cuarentena de 4h **heredada** por los activos nuevos: es lo conservador, y desde M10.7 la
  cuarentena registra decisión sombra, así que cada activo acumulará su propio expediente y saldrá
  solo si lo merece.

## [0.38.2] — 2026-08-19

> Un hito que se cierra sin entregar nada al motor, y que aun así deja algo importante: la métrica
> con la que el proyecto pensaba juzgar futuros «ejes independientes» no distinguía una fuente nueva
> de un generador de números aleatorios.

### Added — Analista de Niveles, Fase 0: medición previa con resultado **negativo**

- Se midió antes de darle voto, como se acordó. Dos listones fijados de antemano: **+0,5 votos
  efectivos** y expectancy por tercil con Bonferroni sobre 24 comparaciones declaradas (|t| ≥ 3,124).
- Tres temporalidades (15m, 30m, 1h) superaban el listón de independencia. Parecía un aprobado.
- **Un control que no estaba en el plan lo tumbó**: una columna de ruido aleatorio añade entre
  **+0,42 y +0,61** votos efectivos. El detector no supera al azar en ninguna temporalidad, y queda
  por debajo en cinco de siete. El criterio medía «variabilidad no compartida», que es justo lo que
  el ruido tiene de sobra.
- El único |t| significativo (7,30 en 4h) **no rescata nada**: es la temporalidad en cuarentena, con
  la muestra del periodo que acumuló −0,485 R, y es donde el detector ha degenerado en un oscilador
  —correlación 0,54 con Bollinger/Estocástico en 4h y **0,90 con RSI en 1d**, frente a 0,11 en 15m—.
  A menos historia disponible, más se parece a lo que ya teníamos. Darlo por bueno sería repetir el
  error de «el fundamental habría salvado el 4h».
- **No se le da voto.** La decisión no se tocó en ningún momento. Informe completo en
  `docs/analista-niveles-fase0.md`.

### Changed — El lift de votos efectivos exige control de ruido

- `docs/independencia.md` proponía *«¿cuántos votos efectivos añade?»* como métrica para juzgar
  candidatos a eje independiente — y es la métrica de juicio escrita en la especificación del
  Fundamental Score. Queda anotado que **sola no sirve**: hay que superar el lift de una columna
  aleatoria sobre la misma muestra, no alcanzar un número absoluto.
- Y superar el ruido demuestra que la fuente es **distinta**, no que **sirva**. Para eso sigue
  haciendo falta que prediga algo sobre decisiones reales cerradas.

### Added — Detector de niveles con las garantías puestas (sin uso en producción)

- `levels.py` no vota ni se importa desde ningún camino de decisión. Ocho tests, incluido el que
  comprueba que **un pivote sin confirmar no se detecta**: sin esa garantía el estudio habría usado
  información que en el momento de decidir no existía, y habría dado resultados excelentes e
  irreproducibles.

## [0.38.1] — 2026-08-19

> El Fundamental Score se veía bien en el Panel y no estaba midiendo nada. Enseñaba «percentil 1»
> con cara de medición, y ese número era el cero de un valor por defecto.

### Fixed — El score no recibía el funding y lo sustituía por cero

- El funding solo se pedía dentro de `refreshMacro`, que **sale antes de nada si `MACRO_ENABLED` no
  está a `true`**. En producción está apagado, así que desde el despliegue de 0.38.0 el score
  evaluaba `funding = 0` en todas las decisiones.
- Comprobado en la base de datos: **414 capturas en siete días, 0 con funding**. El percentil que
  mostraba el Panel (0,007) no era el estado del mercado: era el cero del valor por defecto situado
  contra la distribución real.
- Consecuencia, y es la grave: penalización siempre 0, **ninguna decisión sombra registrada** y por
  tanto **ninguna posibilidad de promocionar nunca**. Exactamente el fallo de diseño que tuvo la
  cuarentena en M10.5 —un mecanismo que no puede acumular el expediente que necesita para salir—,
  repetido tres hitos después.
- El funding pasa a refrescarse por su cuenta, **independiente del sesgo macro**. El score existe
  precisamente porque el funding no deriva del precio; acoplarlo al interruptor del macro unía justo
  lo que el hito separaba. Solo se pide a los perpetuos de Binance: preguntarle el funding a una
  acción de Twelve Data era una petición condenada a fallar cada hora.

### Fixed — «No lo sé» ya no acaba valiendo cero

- `computeFundamental` recibía `funding: number` con un `?? 0` delante. Ahora recibe
  `funding?: number` y, si no hay dato, se declara **`stale`** igual que si faltara la distribución.
  Un cero por defecto se sitúa en la distribución y produce un percentil con toda la pinta de ser
  una medición; un `stale` dice la verdad.
- `Fundamental.funding` pasa a `number | null`. El Panel distingue ahora los dos motivos de «sin
  datos»: no conocemos el funding de ahora, o no tenemos con qué compararlo.

### Fixed — Artefactos vacíos para activos sin funding

- El piloto escribía `artifacts/fundamental/<SÍMBOLO>.json` también para acciones, que nunca tendrán
  funding: un fichero muerto por cada una. Ahora no se publica si no hay ni una observación.

## [0.38.0] — 2026-08-18

> El análisis fundamental entra en la decisión, y lo hace **torcido a propósito**: el funding
> penaliza los largos y no dice nada de los cortos. No es una elección de diseño elegante, es lo
> único que sostienen los datos. Y entra en sombra: se calcula, se registra y no manda.

### Added — Fundamental Score asimétrico (en sombra)

- Cruzadas **728 decisiones evaluadas** con el valor *as-of* de cada serie de la Data Intelligence
  Layer, se probaron seis relaciones y **sobrevivió una sola** —también a la corrección de
  Bonferroni (t=2,95 sobre umbral 2,64)—, y solo en un lado:

  | LARGOS por tercil de funding | n | Expectancy | Acierto |
  |---|---|---|---|
  | funding **bajo** | 117 | **+0,200 R** | 47,9 % |
  | funding medio | 117 | −0,005 R | 41,9 % |
  | funding **alto** | 117 | **−0,230 R** | 29,1 % |

  En **cortos no hay patrón** (−0,111 / +0,131 / −0,004). Spearman funding↔R en LONG: ρ = −0,156,
  n=351.
- De ahí la asimetría: `logit_BUY -= w · penalización` y **`logit_SELL` no se toca**. Aplicarlo a los
  dos lados por simetría formal habría añadido ruido en la mitad de las decisiones.
- **Percentil, no valor absoluto.** El rango observado fue 0,000003–0,0001; cualquier umbral fijo
  describiría este régimen, no una regla. La ventana móvil de 90 días pregunta lo único que se
  sostiene cuando el mercado cambie: ¿está caro el apalancamiento *comparado con lo normal
  últimamente*?
- **Fear & Greed y BCE se quedan fuera de la decisión**, y no por inútiles: no se puede saber. F&G
  osciló solo entre 25 y 41 —siempre «miedo»— y el BCE tiene uno o dos valores distintos en un mes.
  Sin contraste no hay nada que medir. Se siguen registrando.

### Added — Gobierno en sombra, con los umbrales fijados de antemano

- El score **no influye en ninguna decisión**. Se calcula, se guarda y se compara. Solo pasará a
  mandar si demuestra **lift ≥ 0,05 R y AUC ≥ 0,55** sobre decisiones reales cerradas. Los umbrales
  quedan escritos en la migración 019 antes de ver el primer resultado: elegirlos después sería
  elegirlos mirando el desenlace.
- Columnas propias en `snapshots` (`fund_*`), nunca las de `outcome_*`. Mismo criterio que la sombra
  de la cuarentena: el aislamiento tiene que ser **estructural**, para que una consulta que olvide
  filtrar no pueda contaminar la expectancy.
- Se registra además **qué se habría decidido** con la penalización aplicada. Sin eso no habría nada
  que comparar el día de la revisión, y el score estaría condenado a no promocionar nunca — el mismo
  fallo de diseño que tuvo la cuarentena en M10.5.

### Changed — La migración del funding va atada a la promoción, no a la entrega

- El acuerdo de M12 es que el funding deje `macro.bias` y viva solo en el score. Pero moverlo el día
  de la entrega haría **lo contrario** de lo que pretende el gobierno en sombra: quitaría el funding
  de las decisiones reales sin que nada lo sustituyera y sin haberlo medido.
- Por eso `effectiveMacro()` solo retira el funding cuando el score está en `active`. Mientras siga
  en sombra, **el sesgo macro se calcula exactamente igual que antes de M12**.
- Y al promocionarlo, el peso del funding **se transfiere** a la tendencia en vez de desaparecer.
  Sin esa transferencia `|bias| ≤ 0,5`, y el escudo macro —que exige `|bias| > conflict_threshold`,
  hoy 0,5— no volvería a dispararse jamás: se habría desactivado una salvaguarda sin que nadie lo
  decidiera ni lo notara.

### Added — Reparto Python/Node y paridad acotada

- `apps/quant` publica la **distribución de referencia** (101 cortes de percentil de los últimos 90
  días) en `artifacts/fundamental/<SÍMBOLO>.json`, leyendo `derivatives_metrics` por `published_at`.
  `apps/api` sitúa contra esos cortes el funding del momento. Mismo reparto que el calibrador y el
  meta-modelo: Python mide, Node aplica.
- A la suite de paridad entra **solo la fórmula de inyección** —dónde cae un funding y cuánto
  penaliza—, no el cómputo del score, que es un input como Reditum o el funding crudo.
- Un símbolo sin histórico suficiente se declara `stale` y penaliza **0**. Una fuente muda no debe
  empujar la decisión en ninguna dirección, y menos disimuladamente.

### Added — El Panel enseña el score y dice que no manda

- Nuevo bloque en el sustento: percentil del funding, la barra con el umbral del tercil, y qué
  habría decidido el score si estuviera activo. Un indicador visible que el usuario cree que manda,
  y no manda, es peor que no enseñarlo.

## [0.37.1] — 2026-08-18

> Un «Error: GET /candles 502» al cambiar de activo destapó tres cosas: el presupuesto de peticiones
> no cubría la vía de mayor consumo, el portal pedía nueve temporalidades cada quince segundos, y
> cualquier fallo del proveedor se veía igual que una avería.

### Fixed — El presupuesto no cubría las peticiones del portal

- `tryTake()` solo se llamaba en el sondeo y en la búsqueda. **`getHistory` —la vía que usa el
  panel— no pasaba por el presupuesto en absoluto**, así que el límite documentado como «6/min y
  700/día con margen» no protegía nada de lo que hace un usuario mirando la pantalla.
- Resultado medido: **1822 créditos consumidos sobre un límite de 800**.
- El cupo diario pasa a contarse **por día natural UTC** en vez de en ventana deslizante de 24 h,
  que es como lo cuentan los proveedores. Con ventana deslizante el presupuesto y el proveedor
  discrepaban, y el aviso de «se repone a medianoche» habría sido mentira.

### Fixed — Nueve peticiones cada quince segundos

- El panel consultaba la decisión de **todas** las temporalidades en paralelo cada 15 s: 36
  peticiones por minuto. Con 800 créditos diarios, el cupo se agotaba en **veintidós minutos**.
- Ahora se consultan **en serie y espaciado**, y la cadencia depende del proveedor: 20 s para los de
  tiempo real —que no pagan por petición— y 5 minutos para los de sondeo, con una pausa entre
  llamadas porque estos planes limitan también por minuto.

### Fixed — Un 502 para todo escondía la causa

- Nuevos errores tipados: **sin cupo** (429, se resuelve solo), **activo no servido** (422, no se
  arregla esperando) y **proveedor caído** (502). Twelve Data responde 200 con `{status:"error",
  code:429}` al agotar el cupo, así que sin traducirlo era indistinguible de cualquier otro fallo.
- El panel lo explica en castellano y dice **cuándo vuelve**: «Cupo diario de datos agotado. Se
  restablece a las 00:00 UTC», con la nota de que los activos en tiempo real siguen funcionando.

### Added — Filtro por activo en Registros

- Selector de activo dentro de la pestaña y el símbolo visible en la cabecera. Las decisiones, el
  desinflado por dependencia y la cuarentena funcionan por **símbolo y temporalidad**: mezclar
  activos en una misma media agregada no dice nada útil, y ahora se ve de qué activo son las cifras.

### Notas

- 9 pruebas nuevas del presupuesto y del mapeo de errores, incluido el caso del cambio de día UTC.
- `ARQQ` **estaba bien añadido**: la validación de `POST /assets` funcionó. El fallo era posterior,
  al pedir las velas.

## [0.37.0] — 2026-08-18 · M11 · Data Intelligence Layer

> La capa que prepara datos y **no decide nada**. Registrar primero y decidir después es lo que
> permite comprobar si el análisis fundamental aporta algo — y la primera comprobación que se hizo
> con ella desmintió la hipótesis que lo justificaba.

### Fixed — «El fundamental habría salvado el 4h» era falso

- Desde el primer informe se sostuvo que el escudo macro habría impedido los 69 cortos de 4h que
  costaron −0,723 R. Reconstruido el funding real desde el 23 de julio y recalculado el sesgo con la
  fórmula y los parámetros exactos del motor (EMA 20 semanal, cierre semanal):

  | Métrica | Ventana de los 69 cortos |
  |---|---|
  | macroBias medio | **−0,496** (bajista) |
  | Componente tendencia semanal | −0,884 |
  | Veces que habría **vetado** un corto | **0 de 60** |
  | Veces que habría **reforzado** el corto | **60 de 60** |

- **El escudo macro habría estado de acuerdo con los cortos.** El diagnóstico original —«contra una
  tendencia alcista de fondo»— era una inferencia a partir de los desenlaces, no una medición: hubo
  un rebote de corto plazo dentro de una tendencia semanal claramente bajista.
- La afirmación se corrige en los cinco sitios donde estaba escrita (CHANGELOG de 0.34.0,
  `ensemble.yaml`, `config.ts`, `quarantine_policy.py` y el propio proveedor).
- **No invalida el análisis fundamental, cambia su argumento**: sigue justificándose porque el
  funding, el macro y el calendario **no derivan del precio** —son la primera evidencia
  independiente en un comité cuyos seis votos colapsan en 1,41 efectivos—, no por haber salvado nada.
- Si M12 se hubiera construido sobre aquella tesis, habríamos cableado un escudo que empeora el
  problema que decía resolver. Es exactamente para esto que M11 va antes.

### Added — Esquema point-in-time (migración 018)

- `macro_series`, `derivatives_metrics`, `sentiment` y `econ_calendar`, cada fila con **dos fechas**:
  `observed_at` (a qué momento se refiere) y `published_at` (cuándo se supo). El IPC de julio se
  publica a mediados de agosto; un backtest situado el 10 de agosto no puede verlo.
- `published_at` es **obligatorio**: un dato sin fecha de conocimiento no se puede usar honestamente,
  así que no se guarda.
- `as_of()` es la única forma autorizada de leer estas tablas, y filtra por `published_at`. Cualquier
  otra consulta podría olvidar el filtro y devolver datos del futuro sin que nadie lo note.
- Tabla `data_sources` con la salud de cada fuente: sin ella, una fuente caída y una sin novedades
  son indistinguibles.

### Added — Framework de proveedores y cuatro fuentes gratuitas

- Contrato `DataProvider`: implementar `fetch()` y declarar cadencia. Validación, deduplicación,
  salud y aislamiento de errores ya están resueltos.
- **Binance** (funding, interés abierto, long/short), **Fear & Greed**, **BCE** — las tres sin clave
  ni registro, funcionando desde el primer despliegue. **FRED** con clave gratuita opcional: sin ella
  queda **apagado, no roto**.
- **Degradación grácil**: cada fuente va aislada; si una falla se anota y las demás siguen. Una
  fuente ausente nunca se convierte en un dato inventado.
- **Relleno retroactivo** del funding: permite comprobar hipótesis sobre decisiones ya tomadas sin
  inventar nada.
- Planificador **compartido entre ciclos**: sin él la cadencia declarada sería decorativa y el BCE
  se consultaría cada pocos minutos en vez de dos veces al día.

### Notas

- **M11 no toca la decisión.** Ni una señal cambia. La paridad Node≡Python sigue verde por eso mismo.
- 15 pruebas nuevas, centradas en la regla de oro: que un dato conocido después no se pueda usar
  antes, y que una fuente caída no tumbe el ciclo.
- `docs/datos-externos.md` con el diseño completo.

## [0.36.2] — 2026-08-17

### Fixed — El expediente de cuarentena promediaba toda la historia

- El gobierno entregado en M10.7 medía **todas** las decisiones evaluadas de una temporalidad, sin
  distinguir con qué configuración se tomaron. En 15m eso mezclaba 65 decisiones recientes a
  −0,260 R con 155 antiguas a +0,068 R y daba **−0,029 R**: por encima del umbral de entrada, así
  que la temporalidad se libraba de la cuarentena por un pasado que ya no la describe.
- **Cambiar la configuración cambia el sujeto medido.** El historial anterior describe a un sistema
  que ya no existe. Corta en las dos direcciones: también podía dejar vetada una temporalidad por
  un mal pasado ya corregido.
- Ahora el expediente mira **solo las decisiones evaluadas más recientes**, en número igual al
  mínimo de muestra que la política ya exigía (30 para entrar, 40 para salir).
- **La ventana no se eligió mirando el resultado**: es el umbral que estaba fijado desde M10.7,
  antes de que este problema existiera. Cualquier otro número habría que justificarlo, y la única
  justificación disponible sería el desenlace que produce.
- No se filtra por `model_version` exacta a propósito: Optuna publica una nueva cada una o dos
  semanas y el expediente se reiniciaría con ella, dejando el gobierno paralizado justo después de
  cada reoptimización.

## [0.36.1] — 2026-08-17

### Fixed — El buscador de activos decía que no había nada cuando no había buscado

- Con la barra vacía mostraba «Sin coincidencias», que parecía indicar que el catálogo estaba vacío.
  Ahora invita a escribir y **sugiere qué teclear en la clase seleccionada** (`AAPL, NVDA, TSLA` en
  Acciones, `EUR/USD` en Divisas…).
- Cuando de verdad no hay resultados **en una clase**, lo dice sin ambigüedad y ofrece repetir la
  búsqueda en todas: la causa habitual no es que el activo no exista, sino que se buscó en la clase
  equivocada. El buscador solo pregunta a los proveedores de la clase elegida, así que en «Cripto»
  jamás aparecerá una acción.

### Fixed — El mismo ticker aparecía repetido

- Un ticker cotiza en muchas bolsas: `AAPL` vuelve **diez veces** de Twelve Data (NASDAQ en dólares,
  BMV en pesos mexicanos, GPW en zlotys, ADR en Toronto…). Se deduplicaba por símbolo, pero
  quedándose con la primera que llegara, que no siempre es la de referencia.
- Ahora se prioriza **cotización en USD y bolsa principal**, y se descartan los ADR cuando está el
  original. La etiqueta incluye la **moneda** además del mercado, que es lo que distingue de un
  vistazo el AAPL de Nueva York del de Ciudad de México.
- Un mismo símbolo puede seguir apareciendo dos veces si lo ofrecen **dos proveedores distintos**
  (Binance y Twelve Data). Eso es correcto y son activos distintos: la insignia de proveedor y la de
  clase los diferencian.

## [0.36.0] — 2026-08-14

> M10.7. La cuarentena que se entregó en M10.5 era irreversible por construcción: una temporalidad
> vetada no generaba nada evaluable, así que no podía demostrar nunca que merecía volver. Se arregla
> el fallo y se le pone gobierno automático, con el mismo principio que rige al meta-modelo.

### Fixed — La cuarentena era una trampa sin salida

- Al degradar 4h a MANTENER, la decisión se guardaba con dirección `FLAT` y sin plan. El evaluador
  solo puntúa filas con `plan_entry IS NOT NULL` y dirección operable, de modo que **ninguna decisión
  en cuarentena llegaba a evaluarse**. Comprobado en producción: 1 de 1 filas en cuarentena sin plan,
  sin dirección y sin desenlace.
- Se escribió que la cuarentena «retira el permiso para operar, no la observación». Retiraba las dos.

### Added — Modo sombra de la cuarentena (migración 017)

- Una temporalidad vetada sigue registrando **qué habría hecho**: acción, dirección y plan, en
  columnas `shadow_*` propias. El evaluador las puntúa con las mismas reglas —primer toque, horizonte
  por temporalidad— en `shadow_outcome_*`.
- **El aislamiento es estructural, no de disciplina.** Las sombra tienen su propio juego de columnas:
  aunque alguien olvide filtrar, es imposible que una operación que nadie abrió cuente como
  rendimiento. `expectancy` y `winRate` no las ven; el resumen las expone aparte.

### Added — Gobierno automático de la cuarentena

- `quarantine_policy.py`: una temporalidad vetada **sale sola** cuando su expediente sombra acumule
  ≥40 decisiones evaluadas y ≥ +0,05 R; una que opera **entra sola** con ≥30 decisiones y ≤ −0,15 R.
- Deliberadamente **asimétrico**: dejar de operar es barato y volver a operar no. Con la misma
  muestra, una expectancy que no basta para entrar tampoco basta para salir.
- Los umbrales están escritos **antes** de que exista muestra suficiente, a propósito: fijarlos
  después sería elegirlos mirando el resultado.
- `artifacts/quarantine.json` manda sobre `ensemble.yaml`, que pasa a ser el estado inicial. Sin
  medición para una clave, manda la configuración: nunca se levanta una cuarentena por falta de datos.
- Cada decisión lleva su motivo en texto: una decisión automática que no se puede explicar no es
  auditable. Se avisa por la campana cuando una temporalidad entra o sale.

### Added — Primeras pruebas del portal

- `apps/web` no tenía ninguna. Se extrae la lógica pura de Novedades a `news.ts` y se cubre con
  **16 pruebas**: fechas, titulares, recuentos y buscador, incluidos los casos que rompen (fecha
  inválida, versión sin secciones, categoría desconocida).
- Sin stack de renderizado: lo que se puede probar sin montar un navegador se prueba así.

### Fixed — Cifra equivocada en el registro de cambios

- La entrada de 0.35.0 decía «35 versiones» reconstruidas. Son **37** (38 con la propia 0.35.0). Al
  leer la salida del reconstructor se cortaron las dos primeras líneas y la cifra se arrastró al
  CHANGELOG, al commit y al PR. El fichero siempre estuvo bien; la cifra sobre él, no.

## [0.35.0] — 2026-08-13

> M10.6. La plataforma pasa a contar su propia historia sin que nadie tenga que acordarse. El
> problema no era que se olvidara actualizar Novedades: era que Novedades no leía el registro de
> cambios, sino que **era una segunda copia** escrita a mano.

### Fixed — Novedades mostraba la 0.28.0 con la 0.34.0 desplegada

- `NewsView.tsx` guardaba un array de **27 entradas redactadas a mano**, la última de la 0.28.0.
  Seis versiones invisibles para el equipo. Comprobado en el propio paquete servido en producción:
  contenía la cadena `0.28.0` y no `0.34.0`, con el resto del código de M10.5 ya desplegado.
- Ahora los datos vienen de `GET /releases`, que interpreta `CHANGELOG.md`. La vista pierde sus 532
  líneas y se queda en 258: **no puede desviarse porque ya no tiene nada propio que desviar**.
- Un chip nuevo avisa si la versión en ejecución no es la primera del registro, que es justo la
  situación que nadie detectaba.

### Fixed — El CHANGELOG no estaba versionado

- Tenía **dos** cabeceras: `[0.34.0]` y `[No publicado]`, con **48 secciones** colgando de la
  segunda. Todo el historial anterior estaba sin atribuir, y no había ni un solo tag de git.
- Reconstruido desde la propia historia del repositorio: para cada commit que tocó el CHANGELOG se
  mira qué versión declaraba `apps/api/package.json` en ese momento. **37 versiones desde la 0.0.0**
  con sus fechas reales, sin inventar ninguna. Cero secciones perdidas y una recuperada
  («Multi-activo + visualizaciones del motor») que se había borrado por el camino.
- Tags `v0.0.0`…`v0.34.0` creados sobre los commits que ya existían.

### Fixed — El asistente decía no saber en qué versión corría

- `pkgVersion` salía de `npm_package_version`, que solo existe si el proceso se lanza con un script
  de npm. En el contenedor se arranca el binario directamente, así que valía «desconocida».

### Added — El asistente conoce la historia y la documentación

- **`cambios_de_version`**: qué cambió en cada versión y por qué, leído del mismo registro que ve el
  portal. «¿Qué trajo la última actualización?» pasa a tener respuesta con fuente en vez de un «no
  lo sé», que era lo único honesto que podía decir antes.
- **`consultar_documentacion`**: busca y lee `docs/`, que ya viaja dentro de la imagen. Explica con
  el texto vigente en vez de con lo que recuerde.
- Su contexto incluye ahora la versión activa y las tres últimas entregas.
- Se retira de la base local del portal la explicación duplicada de la calibración y se sustituye
  por una remisión. **El Centro de ayuda no se toca**: es documentación conceptual pensada para
  leerse en pantalla, no un registro de cambios, y derivarlo del CHANGELOG habría sido un error.

### Added — Puerta de versión en CI

- `scripts/check-version.mjs` falla si `apps/api` y `apps/web` no coinciden entre sí o con la
  primera entrada del CHANGELOG, y si hay versiones repetidas en el registro. Corre antes que el
  lint, y el mensaje de error dice exactamente qué hacer.
- Detecta el caso real que ocurrió: **dos ramas distintas usaron el número 0.34.0**, una fusionada y
  otra no. Sin esta puerta, la anterior corrección se degradaría sola en unas semanas.

### Added — Primeras pruebas del historial

- 17 pruebas del intérprete del CHANGELOG, incluidas las que validan el **registro real**: todas las
  versiones con semver y fecha, sin repetidos, ordenadas y ninguna sin contenido.

### Added — `CLAUDE.md` en el repositorio

- Las instrucciones del proyecto vivían fuera del repositorio, así que no viajaban con el clon ni
  llegaban al equipo. Ahora están versionadas junto al código.

## [0.34.0] — 2026-08-12

> Antes de añadir el análisis fundamental o cualquier agente nuevo, se corrige la base matemática
> sobre la que se apoyarían. Cinco arreglos, ninguno estructural, todos sobre defectos medidos en
> los registros reales de la plataforma.

### Fixed — Un modelo peor que una moneda estaba modulando las decisiones

- **Gobierno simétrico del meta-modelo** (`meta_policy.py::decide_mode`). Para ascender se exigía
  AUC ≥ 0,55; para **permanecer**, nada. El AUC no se volvía a comprobar jamás. Resultado: un
  meta-modelo degradado hasta **AUC 0,43** —anti-predictivo— seguía en modo `modulate` sobre las
  decisiones en vivo, porque su lift de −0,005 R no llegaba al umbral de retroceso.
- Ahora la condición de permanencia **repite la de ascenso**. Si un componente deja de cumplir lo
  que se le exigió para darle poder, lo pierde. Es la regla que gobernará al consejo de agentes.

### Added — Ajuste por dependencia de los votos

- Los seis indicadores internos no son seis evidencias: medido sobre 636 registros, en 4h equivalen
  a **1,41 votos independientes** (el 83 % de su información cabe en un solo factor). La confianza
  del softmax, calculada como si fueran seis, estaba sistemáticamente inflada.
- Nuevo `apps/quant/trademe_quant/independence.py`: mide la dimensionalidad efectiva por
  símbolo+temporalidad y publica `artifacts/independence.json`. La API solo lo evalúa, con recarga
  en caliente — mismo patrón que `calibrators.json`.
- El factor multiplica **los tres logits por igual**, así que **no cambia la dirección de ninguna
  decisión**: solo baja la confianza declarada. Hay un test en Node y otro en Python que fallan si
  esa invariante se rompe. Es una corrección de calibración, no de criterio.
- Chip **⚖** en el Panel cuando hay desinflado. `docs/independencia.md` con la medición completa.

### Added — «No operar» pasa a ser un veredicto con motivo

- 324 COMPRAR, 309 VENDER y **cero MANTENER** en 633 registros: el dataset solo contenía decisiones
  operables y el meta-modelo aprendía de la mitad del mundo tratándola como si fuera entera.
- Nuevo campo `hold_reason` (`cuarentena`, `conflicto_macro`, `veto_meta`, `banda_neutra`) y
  migración **016**. Se registran los MANTENER **informativos**: los provocados por un filtro y los
  que se quedaron a las puertas del umbral (`AUTO_CAPTURE_HOLD_MARGIN`). Los 1 440 «no operar»
  diarios de 1m no se guardan: sería ahogar el dataset en indecisión.
- No contaminan ninguna estadística: sin plan no hay desenlace que evaluar, y el resumen ya los
  separa. Se añade el contador `noTrade`.
- En el Panel, un chip **⛔** explica por qué no se opera. «Mantener» a secas no distinguía entre
  «no veo nada» y «algo me ha frenado», que son cosas muy distintas.

### Changed — Cuarentena de temporalidades

- `quarantine_intervals` en `ensemble.yaml`, con **4h dentro**: −0,485 R en 89 decisiones, 69 cortos
  con el 85,6 % al stop. *(Se dijo entonces que era «contra una tendencia alcista de fondo»; era una
  inferencia a partir de los desenlaces, y M11 la desmintió al reconstruir los datos reales. Ver la
  entrada de 0.37.0.)*
- Una temporalidad en cuarentena **se calcula y se registra, pero no emite señal operable**. Se
  retira el permiso para operar, no la observación: el backtest la sigue simulando a propósito,
  porque si dejara de hacerlo no habría forma de saber cuándo levantarla.

### Changed — Horizonte de evaluación y frescura de la entrada, por temporalidad

- **El 31 % de las decisiones expiraba sin resolverse y 1d/1w/1M no se evaluaban nunca.** La causa
  no era la validez del plan sino `horizon`, fijo en 20 velas para todas las temporalidades y
  escrito como valor por defecto de una función: 20 minutos en 1m y 20 días en 1d, cuando el
  histórico no llega a tanto.
- Se separan los dos conceptos, que estaban confundidos: `plan.valid_candles_by_tf` (hasta cuándo
  tiene sentido **entrar**) y `evaluation.horizon_by_tf` (cuánto tiempo se le da a la operación
  **ya abierta**). Ambos por temporalidad, ambos en `ensemble.yaml`, ambos con paridad.

### Notas de despliegue

- Migración **016** automática al arrancar la API.
- Tras el primer ciclo del piloto aparecerá `artifacts/independence.json` y las confianzas bajarán
  en las temporalidades con votos redundantes. **Es el comportamiento correcto, no una regresión**:
  la cifra anterior afirmaba más seguridad de la que los datos respaldaban.
- 4h dejará de proponer entradas. Se sigue viendo y midiendo.

## [0.33.0] — 2026-08-05

### Changed — El sustento vive dentro del Panel

- **Se retira la pestaña «Sustento»**: su contenido pasa a ser una sección debajo del Panel, que es
  la continuación natural de la decisión y no un sitio aparte al que había que ir.
- **Espacios vacíos corregidos**: `.panel` llevaba `max-width: 720px`, pensado para las vistas
  estrechas, y en Backtest, Laboratorio y Sustento dejaba media pantalla en blanco.
- **Cabecera en una sola fila**: pestañas y temporalidades compactadas; en vez de envolver a dos
  filas, cada bloque se encoge y la tira de temporalidades desliza con sus flechas.

### Added — El asistente puede buscar en internet

- Octava herramienta `buscar_en_internet` con **Tavily** o **Brave Search** (ambos con plan
  gratuito), configurable por `ASSISTANT_SEARCH`. Para noticias, contexto macro y todo lo que
  dependa de información externa o posterior al conocimiento del modelo.
- **Solo se le ofrece si hay proveedor configurado**: prometerle una capacidad que no funciona lo
  empuja a inventarse las fuentes.
- **Prohibida para datos de TradeMe**: si internet y la plataforma se contradicen sobre las cifras
  propias, gana la plataforma y el asistente debe decirlo.

## [0.32.0] — 2026-08-05

### Added — El asistente puede consultar la plataforma (herramientas)

- Siete **herramientas de solo lectura** que el modelo puede invocar cuando la pregunta necesita
  datos que no tiene: decisión de otra temporalidad, resumen de registros, historial de backtests,
  evidencia por indicador, resumen de precios, estado del sistema y uso por temporalidad.
- Deja de ser «te explico la foto que me dieron» y pasa a «déjame mirar y te digo»: ya puede
  responder a *«compara 15m con 30m y dime cuál va mejor»*.
- **Sin superficie de escritura**: ninguna herramienta modifica nada, no hay consulta SQL libre y
  los parámetros van por listas cerradas. Una prueba falla si se añade una herramienta cuyo nombre
  sugiera acción.
- Tope de **tres vueltas** por pregunta, con la última sin herramientas para forzar respuesta.
- Bajo cada respuesta se muestra **qué consultó** el asistente.

## [0.31.0] — 2026-08-05

### Added — El asistente puede usar un modelo de lenguaje gratuito

- **`POST /assistant/ask`**: la llamada al proveedor ocurre en el servidor, nunca en el navegador,
  para que la clave no viaje al cliente. Un solo adaptador compatible con el formato de OpenAI cubre
  **Groq, Cerebras, Mistral, OpenRouter y Ollama**: cambiar de proveedor son dos variables.
- El contexto lo construye la API (`assistant/context.ts`): decisión en vivo con sus votos, régimen,
  estadísticas de registros, configuración activa y aporte medido de cada indicador. **No se envían
  claves, correos ni datos personales**, solo cifras agregadas.
- **Instrucciones que el modelo no puede saltarse**: no da asesoría financiera, no recomienda operar,
  no promete rentabilidad y no puede inventar datos que no estén en el contexto.
- **Cupo por usuario** (6/min, 120/día) para que una pestaña abierta no agote el plan gratuito.
- **Reserva automática**: si no hay proveedor, o si falla, responde la base de conocimiento local.
  El asistente nunca se queda mudo.
- `docs/asistente.md` con la comparativa de proveedores gratuitos, qué se envía exactamente y cómo
  montar Ollama si se prefiere que nada salga de la red.

## [0.30.0] — 2026-08-05

### Added — Asistente de la plataforma

- **Botón flotante 🤖** abajo a la derecha con un asistente que responde sobre TradeMe: por qué
  decide lo que decide ahora mismo, qué significan las métricas, cómo aprende, de dónde salen los
  datos, cómo está montado por dentro y qué estado tiene cada componente.
- No es un buscador de documentación: **lee el estado en vivo** (decisión actual y sus votos,
  estadísticas de registros, configuración activa, salud de los servicios, uso por temporalidad) y
  responde con las cifras reales del sistema. Todo se resuelve en el navegador; no sale nada de la
  red y no hay coste por consulta.

### Fixed — Barra de temporalidades

- **Las flechas ya no arrastran la página.** Faltaba `min-width: 0` en la tira y en su contenedor,
  así que la barra crecía hasta su contenido, empujaba la cabecera y desplazaba la vista entera en
  horizontal. Además las flechas ahora **recorren la tira** en lugar de cambiar de temporalidad:
  navegar y elegir son cosas distintas.
- **Una sola marca en vez de tres glifos.** Los símbolos `● ◆ ▮` no se entendían sin consultar la
  leyenda. Queda un punto que se enciende cuando el motor analiza y registra esa temporalidad; el
  detalle vive en el tooltip y en el botón «?».

## [0.29.0] — 2026-08-05

### Added — Panel de decisión (pestaña «Sustento»)

- **`GET /decision/sustento`**: configuración activa (pesos, multiplicadores de régimen, banda
  neutra, riesgo) más la **evidencia histórica de cada indicador** calculada sobre las decisiones ya
  evaluadas: cuántas veces acompañó a la decisión y con qué acierto, cuántas se opuso y con cuál, y
  la diferencia entre ambas — su aporte real. Mínimo de 10 casos por columna para dar una cifra.
- **Pestaña Sustento** con tres bloques: tacómetro de la inclinación actual (−1 a +1 con la banda
  neutra dibujada), tabla de **quién empuja** (voto × peso × multiplicador de régimen = aportación,
  con barra de empuje) y tabla de **por qué cada peso**, ordenada por aporte real.
- La pestaña dice explícitamente lo que todavía no puede: los pesos de hoy los fijó Optuna sobre el
  backtest, no esta evidencia. Fijarlos desde aquí, y distintos por régimen, es el paso siguiente y
  depende de acumular muestra.

## [0.28.0] — 2026-08-05

### Fixed — El resumen de Registros contaba mal

- **Estado autoritativo de un snapshot.** Se mezclaban dos conceptos distintos: `outcome_result`
  (resultado real, calculado por quant sobre las velas posteriores con la regla del primer toque) y
  `tracking.status` (dónde está el precio AHORA). Un registro cerrado en stop cuyo precio volviera al
  medio sumaba a la vez en «En curso» y en «SL», y los totales no cuadraban (138+164+210=512 sobre un
  total de 413). Nuevo `estadoFinal()` con precedencia única y estados excluyentes, más 6 pruebas.
- **Las cifras se calculaban sobre la página cargada** (500 filas) en vez de sobre todos los
  registros. Nuevo `SnapshotsRepo.stats()` que agrega en SQL, con desglose por temporalidad.
- El aprendizaje **nunca estuvo afectado**: el dataset y el meta-modelo siempre usaron
  `outcome_result`.

### Added — Legibilidad de los datos y de la interfaz

- **Veredicto en Registros:** compara el acierto real con el mínimo necesario según la relación
  riesgo:beneficio configurada (2:1 → 33,3 %) y dice si el sistema tiene ventaja, con la expectancy
  media en R. Responde a la duda de «¿es malo que haya más SL que TP?».
- **`GET /backtest/history`** y sección **Evolución entre ejecuciones** en Backtest: sparkline de
  expectancy por corrida, variación respecto a la anterior y tabla desplegable con todas.
- **`GET /timeframes`**: en qué procesos participa cada temporalidad (captura automática, pesos
  optimizados, backtest guardado, registros acumulados).
- **Barra de temporalidades nueva:** navegación con botones `‹ ›` en lugar de tira deslizable, con
  distintivos de uso por temporalidad y leyenda desplegable.

### Changed — Presentación

- **Backtest y Laboratorio a lo ancho:** se retiran las guías laterales (`BacktestGuide`,
  `LabGuide`) y su contenido se refunde en el Centro de ayuda.
- **Centro de ayuda rediseñado:** entrada por tarea («¿qué necesitas ahora?»), recorrido sugerido
  para el primer día, búsqueda que atraviesa las cuatro secciones a la vez, y artículos con resumen
  de una línea y tiempo de lectura (divulgación progresiva).
- **Novedades reconstruida:** historial completo desde M0 (27 versiones) con **fecha y hora exactas**
  tomadas del repositorio, línea de tiempo compacta y **dos niveles de despliegue**: qué cambió y,
  opcionalmente, por qué se hizo así.
- Laboratorio: introducción que sitúa las cuatro secciones y márgenes uniformes.

### Fixed — Integridad de los registros (auditoría del 5 de agosto)

- **Una decisión por vela, no una por reloj.** La captura automática usaba un enfriamiento fijo de
  20 minutos para todas las temporalidades: en 4h producía hasta 12 registros de la misma vela y en
  1d hasta 72. Esos duplicados se contaban como observaciones independientes —si la decisión acababa
  en stop se anotaban doce stops en vez de uno— y sesgaban tanto las estadísticas como el dataset
  del meta-modelo. Ahora la captura se ancla a la vela, que es además como decide el backtest.
- **El evaluador cerraba antes de tiempo.** Pedía 20 velas futuras pero evaluaba con las que
  hubiera; al no tocar ningún nivel marcaba `timeout` y, como el resultado dejaba de ser nulo, no
  volvía a mirarse nunca. En 1d eso convertía el 100 % de los registros en timeouts artificiales.
  Regla nueva y asimétrica: un toque de objetivo o stop es definitivo aunque ocurra en la primera
  vela; un timeout solo vale si transcurrió el horizonte completo.
- **Migración 015:** columna `candle_open` (retroactiva) para poder quedarse con una decisión por
  vela sin borrar nada, y reapertura de los timeouts cerrados prematuramente para que el piloto los
  vuelva a medir bien. No se elimina ningún registro.
- Las estadísticas de Registros y el entrenamiento del meta-modelo deduplican por vela, preservando
  el orden cronológico que necesita la división temporal.

## [0.27.0] — 2026-07-31

### Added — Multi-activo, multi-proveedor + visualizaciones del motor

- **Arquitectura multi-proveedor:** nueva capa `apps/api/src/providers` con el contrato
  `MarketProvider` (identidad, clases de activo, modo de entrega, catálogo, histórico, suscripción) y
  un `ProviderRegistry` que enruta cada símbolo a su proveedor, combina los catálogos en una sola
  búsqueda y reparte las suscripciones. Binance queda envuelto como proveedor de **streaming**.
- **Proveedor por sondeo:** `PollingProvider` resuelve de una vez el caso de las fuentes sin
  WebSocket gratuito — cadencia derivada de la temporalidad (≈¼ de vela, con suelo y techo),
  presupuesto de peticiones por minuto y por día, y emisión únicamente de velas cerradas nuevas.
  Sobre él, **Twelve Data** aporta acciones, divisas, índices y ETF; se activa con
  `TWELVEDATA_API_KEY` y, sin clave, aparece como «sin configurar» sin romper nada.
- **Migración 014:** `watchlist` recuerda `provider`, `asset_class` y `tv_symbol` de cada activo, de
  modo que el widget de TradingView muestra el mercado correcto (`NASDAQ:AAPL`, `FX:EURUSD`…).
- **web:** filtro por clase de activo e insignias de clase y proveedor en el gestor de activos;
  panel de proveedores en **Estado del sistema** (activo/sin configurar, tiempo real o sondeo).
- **docs:** `docs/proveedores.md`, que explica el contrato, los dos modos de entrega, los límites del
  plan gratuito y **por qué TradingView no puede ser proveedor de datos**.

## [0.26.0] — 2026-07-31

### Added — Multi-activo + visualizaciones del motor

- **Multi-activo:** nueva tabla `watchlist` (migración 013) y endpoints `/assets*`; buscador sobre el
  catálogo del proveedor (Binance spot, con caché de 6 h) y **suscripción en caliente**: al añadir un
  activo, el motor se suscribe, siembra su histórico y el piloto lo incluye en sus ciclos, con
  estrategia optimizada propia por símbolo+temporalidad. Se puede pausar o quitar sin perder
  historial. `TRADEME_SYMBOLS` queda como respaldo.
- **web:** gestor de activos (buscar, añadir, pausar, quitar) accesible desde la barra superior.
- **Visualizaciones (`Viz.tsx`):** medidores, barras de progreso, comparativas, anillos y
  *sparklines* en SVG puro, aplicados al **Dataset ML** (progreso hacia cada criterio + reparto
  TP/SL), **Optimización** (comparativa base vs candidato y medidor de mejora), **Calibración**
  (veredicto por régimen) y **Piloto** (frescura de mediciones y cuenta atrás de calibración y
  reentrenamiento).
- **Reditum/TradingView:** el Estado muestra la dirección exacta del webhook y nueva guía
  `docs/reditum-tradingview.md` para configurar las alertas.
- **docs:** `multiactivo.md`.

## [0.25.0] — 2026-07-31

### Added — M10 (cierre) · captura server-side y auditoría

- **Captura automática en el servidor:** la API registra las decisiones operables (confianza ≥ 40 %,
  con cooldown y por temporalidad configurable) **sin depender de que alguien tenga el portal
  abierto**. Antes los snapshots solo nacían en el navegador, así que el dataset del meta-modelo se
  congelaba cuando nadie miraba. Configurable con `AUTO_CAPTURE*`.
- **Auditoría de accesos:** tabla `access_log` (migración 012) con cada acceso concedido, fallido o
  bloqueado (correo, IP, motivo).
- **Freno general por IP** además del específico del login (protege toda la API de abuso).
- **Accesibilidad:** foco visible al navegar con teclado, respeto por «reducir movimiento» y áreas
  táctiles cómodas en móvil.
- **Estado del sistema:** nuevo componente «Captura automática de registros».
- **Novedades:** al día con las versiones 0.24.0 y 0.25.0.

## [0.24.0] — 2026-07-31

### Added — M10 (seguridad base) + pulido de interfaz para móvil

**Seguridad (la plataforma ya está expuesta a internet):**
- **Freno a la fuerza bruta en el login:** ventana deslizante por IP+email, 5 intentos por 15 min y
  bloqueo con *backoff* creciente (1 → 30 min). Responde `429` con `Retry-After` (+6 tests).
- **Registro de accesos:** cada intento fallido y cada acceso concedido queda en el log con IP y
  correo.
- **Cabeceras de seguridad** en toda respuesta: `X-Content-Type-Options`, `X-Frame-Options: DENY`
  (anti-clickjacking), `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- (Ya existía: sesiones JWT con caducidad de 12 h y comparación *timing-safe*.)

**Interfaz:**
- **Responsive real en móvil:** la barra superior se reorganiza en tres filas (marca · pestañas
  deslizables · controles), el Panel pasa a una sola columna con alturas naturales, y guías, tablas
  y modales se adaptan. Segundo punto de corte para pantallas pequeñas.
- **Panel:** el chip 🧠 del meta-modelo se muestra **siempre** (también en HOLD): la modulación/veto
  solo se aplica si hay acción operable, pero ahora ves qué opina el filtro en todo momento.
- **Backtest:** la **Expectancy** se destaca como métrica clave (verde/rojo según signo) y aparece un
  veredicto «✓ Con ventaja / ⚠ Sin ventaja clara».
- **Registros:** los niveles de entrada, stop y objetivo se dibujan con etiqueta en el eje del
  gráfico del snapshot, con leyenda y el resultado real si ya cerró.

## [0.23.1] — 2026-07-30

### Fixed — Despliegue tras un túnel (Tailscale Funnel)

- **web:** el servidor de *preview* de Vite bloqueaba el dominio del túnel («Blocked request… not
  allowed»). Ahora autoriza `localhost`, `.ts.net` y `.trycloudflare.com`, más los que añadas en
  `ALLOWED_HOSTS` (variable del servicio web en producción).
- **docs:** guía corregida con lo aprendido en el despliegue real — migración del dataset entre
  entornos (sin `>` de PowerShell, que corrompe el volcado a UTF-16), creación de usuarios con `tsx`
  (Node 20 no admite `--experimental-strip-types`) y recreación de la API si no publica su puerto.

## [0.23.0] — 2026-07-29

### Added — El filtro ML se gradúa solo (política automática)

- **quant:** `meta_policy.py` — el piloto evalúa el **modo sombra** con decisiones reales cerradas
  (compara lo ocurrido con lo que habría pasado filtrando) y **asciende el modo solo cuando hay
  evidencia**: `shadow → modulate` (≥40 decisiones, mejora ≥0,05 R, AUC ≥0,55) y `modulate → veto`
  (sostenido con ≥100). **Retrocede** si el filtro empeora los resultados. Avisa por la campana
  (+8 tests).
- **api:** lee `artifacts/meta_policy.json`; `META_MODE` pasa a ser **tope de seguridad** (la
  automatización nunca lo supera). Nuevo componente «Meta-modelo» en `GET /status`.
- **snapshots:** columna `meta_confidence` (migración 011) para poder evaluar el modo sombra.
- **web:** el Laboratorio muestra el modo del filtro ML y por qué está en ese modo.

## [0.22.0] — 2026-07-28

### Added — Módulo 2 cerrado · inferencia del meta-modelo en vivo

- **Arquitectura:** el entrenamiento sigue 100 % en Python; el motor en vivo (Node) **evalúa** un
  artefacto plano (`metamodel.json`, el bosque serializado) con el mismo patrón que `ensemble.yaml`
  y `calibrators.json`. **Sin `onnxruntime-node`** (dependencia nativa frágil) y **sin salto de red**
  por vela: la señal nace en Node y `quant` no entra en el camino en vivo. El `.onnx` se sigue
  exportando como formato estándar. Ver `docs/metamodelo.md`.
- **Política configurable** (`META_MODE`): `off` · `shadow` (por defecto: calcula y registra sin
  afectar) · `modulate` (combina confianzas, peso configurable) · `veto` (descarta señales por
  debajo de `META_VETO_THRESHOLD`).
- **Señal:** nuevos campos `meta_confidence`, `meta_version`, `meta_mode`, `meta_vetoed`; chip 🧠 en
  el Panel. `POST /reload` recarga también el meta-modelo.
- **Paridad:** vectores dorados del bosque (Node≡Python) en la suite de CI.

## [0.21.0] — 2026-07-28

### Added — Centro de ayuda, Laboratorio, Novedades y Estado del sistema

- **web · Centro de ayuda:** manual de usuario paso a paso, base de conocimientos (cómo funciona por
  dentro), preguntas frecuentes y **glosario** de ~45 términos (de lo básico a lo técnico), con
  buscador. Consolida la teoría que estaba dispersa.
- **web · Laboratorio:** nueva pestaña que reúne lo de *afinar* — calibración, optimización de
  pesos, dataset ML y piloto automático — con su propia guía. Backtest queda centrado en **medir**
  (métricas, curva, informe y metodología).
- **web · Novedades:** historial de versiones en lenguaje claro (nuevo / mejorado / corregido).
- **web · Estado del sistema:** semáforo en vivo de API, base de datos, datos de mercado, servicio
  quant (+ piloto), push y webhook, con latencias y qué implica cada fallo. Refresco cada 30 s.
- **api:** `GET /status` — comprueba de verdad cada componente y su comunicación.
- **web:** el botón 🧠 Entrenar ahora explica qué hace y cuándo pulsarlo; la barra de temporalidades
  muestra de entrada el rango operativo (15m–1d) y el resto se alcanza deslizando.

## [0.20.0] — 2026-07-27

### Added — Módulo 2 · Meta-modelo (meta-labeling) + calibración automatizada

- **quant · meta-modelo:** `metamodel.py` + `run_metamodel.py` — aprende de los snapshots ya
  evaluados (TP/SL) a estimar la probabilidad de éxito de cada señal (filtro anti-falsos-positivos).
  **RandomForest** (mejor que boosting con datasets pequeños y exportable a ONNX de forma nativa),
  **split temporal**, umbral elegido por expectancy y **publicación solo si mejora** en validación.
  Exporta `artifacts/metamodel.onnx` + metadatos. **Reentrenamiento continuo:** cada ejecución usa
  todos los registros disponibles, así el modelo mejora con los datos que llegan (+5 tests).
- **Calibración automatizada:** el piloto recalibra **siempre tras una promoción** (los parámetros
  nuevos cambian la distribución de confianzas) y por **mantenimiento periódico** (deriva del
  mercado), con **cooldown 24h** para no ajustar a muestras pequeñas (+4 tests).
- **Piloto:** reentrena el meta-modelo cada 12h y avisa por la campana cuando publica uno nuevo.
- **api:** `POST /ml/train`. **web:** botón 🧠 Entrenar ahora con resultado (AUC, umbral, expectancy
  antes/después) y estado de calibración/meta-modelo en la tarjeta del piloto.
- **snapshots:** nueva columna `supertrend_score` (migración 010) — feature que faltaba desde M1b.

## [0.19.0] — 2026-07-27

### Added — 🤖 Piloto automático de backtest/optimización

- **quant:** worker en el servicio (scheduler): **mide** cada símbolo+TF activo cada 6h (y evalúa
  snapshots pendientes); **optimiza** solo por mantenimiento (7d) o **degradación** (2 mediciones
  seguidas con expectancy negativa y muestra suficiente), con **cooldown 48h** y el gate de hold-out
  de siempre. Configurable por env (`AUTO_*`); 5m fuera por defecto. Crea **alertas** en la campana
  ante promoción o degradación sin mejora (+5 tests de la política).
- **api:** `GET /automation` (estado del piloto).
- **web:** tarjeta **Piloto automático** en Backtest (política, estado por TF, última medición/
  optimización) y guía: los botones quedan para resultados inmediatos.

### Added — Confirmaciones, política editable y adiós a la terminal

- **web:** los botones ▶/⚙ piden **confirmación** explicando cómo interfieren con el piloto (⚙
  reinicia su reloj; optimizar seguido = sobreajuste). Botón **⚙ Configurar** en la tarjeta del
  piloto: política editable desde la UI (activo, frecuencias, cooldown, temporalidades) — se guarda
  en el servidor (`artifacts/automation.json`) y el worker la aplica en su siguiente ciclo, sin
  reiniciar. Botón **🎯 Calibrar** (entrena calibradores desde la UI). Eliminados todos los textos
  con comandos de terminal.
- **quant:** overrides persistentes de la política (env como defaults) releídos por ciclo;
  `POST /automation` y `POST /run-calibration`; `calibrate_and_publish()` usa la config ACTIVA del TF.
- **api:** `POST /automation` (validado) y `POST /calibrate/run`.

## [0.18.0] — 2026-07-27

### Fixed — Parámetros optimizados POR temporalidad

- **Antes:** un único `ensemble.optimized.yaml` global — optimizar 15m sobrescribía lo de 5m, y el
  backtest medía con la config base (no la optimizada). **Ahora:** cada símbolo+TF tiene su artefacto
  (`artifacts/optimized/ensemble.<SYM>.<TF>.yaml` + `report.<SYM>.<TF>.json`); la decisión en vivo,
  el backtest (▶) y el comparador usan **la config activa de esa temporalidad**, y ⚙ Optimizar
  compite contra la activa (mejora iterativa honesta).
- **api:** caché por símbolo+TF con recarga en `POST /reload`; `GET /ensemble?symbol&interval`.
- **quant:** `load_active_ensemble()` compartido por backtest y optimizador (+2 tests).
- **web:** el panel de Optimización muestra la temporalidad y se actualiza al cambiarla.
- Los artefactos optimizados legados (globales) quedan ignorados; re-optimiza por TF.

### Added — Registros: filtros, orden y contadores reales

- **web · Registros:** barra de **filtros** por Temporalidad, Acción, Dirección y Estado
  (En curso / ✓ TP / ✗ SL / Expirados / Sin plan) con chip "Filtradas" y botón limpiar;
  **orden** pulsando las cabeceras Fecha y hora, Confianza o R en vivo (↓/↑).
- **Contadores arreglados:** la web pedía solo 50 filas (los chips se congelaban en 50). Ahora pide
  hasta 500, la API admite 1000 (antes 200) y devuelve el **total real** desde la base de datos; el
  chip Total muestra `total (últimos N)` si hay más de los cargados.

## [0.17.0] — 2026-07-26

### Added — Claridad de botones · Dataset ML · despliegue gratis

- **web · Backtest:** aclaración de los botones (▶ mide la estrategia actual y evalúa registros;
  ⚙ además busca parámetros mejores) con hint visible; nueva tarjeta **Dataset ML** con el estado de
  preparación para el meta-modelo (evaluadas, TP/SL, features, criterios y veredicto).
- **quant:** módulo `dataset.py` (informe de preparación con criterios mínimos: ≥60 evaluadas,
  ≥20 por clase, ≥90% features completas) + endpoint `/dataset-report` en el servicio.
- **api:** `GET /ml/dataset` (proxy al servicio quant, protegido por el auth global).
- **docs:** `despliegue-gratis.md` — opción sin costo recomendada (Tailscale, 3 usuarios gratis,
  HTTPS ts.net para PWA/push, app corriendo en la PC con el compose intacto; alternativa Oracle
  Always Free para 24/7).

- **docs:** `despliegue-gratis.md` (Tailscale en tu PC) y `despliegue-oracle.md` (VM Always Free
  de Oracle + Tailscale, 24/7 gratis, paso a paso).
- **infra:** `docker-compose.prod.yml` (volúmenes nombrados, restart automático, servicios internos,
  web/API solo en localhost detrás de Tailscale, CORS estricto) + `.env.prod.example` (secrets fuera
  del repo); el Dockerfile de la web acepta `VITE_API_URL` como build-arg.

## [0.16.0] — 2026-07-24

### Added — Módulo 3 · Auth del equipo + despliegue PaaS

- **api:** login JWT (`POST /auth/login`, `GET /auth/me`) — hash de contraseñas con `scrypt`
  (nativo de Node) y JWT HS256 hecho a mano (sin dependencias nuevas). Con `JWT_SECRET`
  configurado, todas las rutas exigen `Authorization: Bearer <jwt>` salvo `/health`, `/tv-hook`
  (secreto propio) y `/auth/login`; el canal WS `/stream/{symbol}` exige `?token=` en el
  handshake. Sin `JWT_SECRET` la API queda abierta (comportamiento previo, dev/tests intactos).
- **api:** tabla `users` (migración `009_users.sql`) + script `scripts/create-user.ts` para dar de
  alta al equipo — sin registro público.
- **web:** pantalla de login (`Login.tsx` + `AuthGate.tsx`); el token vive en `sessionStorage`
  (nunca `localStorage`); `GET /health` anuncia `authRequired` para que la web solo pida
  credenciales si el backend las exige. Botón de cerrar sesión en la barra superior.
- **docs:** `docs/despliegue.md` — Vercel (web) + Railway (api/quant/Postgres-Timescale/Redis) en
  vez de Caddy/VPS; sin dominio propio aún, todo parametrizado por variables de entorno.

## [0.15.0] — 2026-07-24

### Added — Módulo 1b · Supertrend

- **ensemble (api+quant):** nuevo indicador **Supertrend(10, 3)**, `kind: trend`. No existe en
  `technicalindicators` (Node) ni en el stack Python: se implementa a mano en ambos lados (bandas
  ATR `(H+L)/2 ± 3·ATR` con regla "sticky" + flip de tendencia), recorriendo todo el historial
  disponible para que las bandas estén asentadas antes de leer el valor (evita ruido por
  calentamiento insuficiente). `score = clamp(tanh((close − línea)/ATR))`. Mirror Node≡Python +
  vectores de paridad regenerados.
- **ensemble:** peso inicial `1.0` (igual que EMA/MACD) — balancea el ensemble a 3 indicadores de
  tendencia/momentum vs 3 de reversión.
- **optimize:** Optuna ahora también afina `w_supertrend`.

## [0.14.0] — 2026-07-24

### Changed — Módulo 1a · ADX continuo + estructura w_macro por TF (flag off)

- **ensemble:** el ADX deja de ser un corte binario y pasa a **escalado continuo**: los
  multiplicadores de régimen se interpolan entre "rango" (ADX bajo) y "tendencia" (ADX alto) por un
  factor `f = clamp((ADX−adx_lo)/(adx_hi−adx_lo))` (nuevos `adx_lo`/`adx_hi`). Módula dinámicamente la
  fuerza del voto de tendencia/momentum. Mirror Node≡Python + vectores de paridad regenerados.
- **optimize:** Optuna ahora ajusta `adx_lo`/`adx_hi` (en vez de `adx_threshold`, que solo etiqueta).
- **macro (scaffold, DESACTIVADO):** firma/interfaz de escalado de `w_macro` por temporalidad
  (`scaledWMacro`/`scaled_w_macro` + `enable_scaling: false` + `tf_scale`), lista para cuando vuelva
  el análisis fundamental, sin interferir en la fase solo-técnica.
- **web:** definición ampliada del botón **⚙ Optimizar** (tooltip + acordeón).

## [0.13.0] — 2026-07-22

### Added — Backtest desde la UI + Δ + límite de auto-snapshot

- **quant:** servicio HTTP (FastAPI) `run-backtest` / `run-optimize`; los CLI se refactorizan a
  funciones reutilizables. El contenedor quant pasa a servidor (uvicorn); el CLI sigue disponible con
  `docker compose run --rm quant python -m ...`.
- **api:** `POST /backtest/run` y `POST /optimize/run` (proxy al servicio quant); `GET /backtest`
  devuelve además la corrida anterior para calcular deltas.
- **web:** botones **▶ Correr backtest** y **⚙ Optimizar** en la pestaña Backtest (sin terminal);
  indicadores **Δ** (verde/rojo) junto a cada métrica respecto a la corrida previa; en el engranaje,
  **límite** de snapshots automáticos (al alcanzarlo se desactiva y hay que reactivarlo).

### Changed — Optimizador ampliado (afinar técnico)

- **quant/optimize:** Optuna ahora ajusta también la "forma" de la decisión —`hold_band`,
  `temperature` y el umbral de régimen `adx_threshold`— además de los pesos y multiplicadores. La
  penalización de complejidad se aplica solo a pesos/multiplicadores (no a la forma).

## [0.12.0] — 2026-07-22

### Added — M9 · PWA + Web Push

- **web:** PWA instalable (manifest, iconos, service worker) y registro del SW; la app se instala en
  móvil/escritorio. Botón "Activar push en este dispositivo" (suscripción Web Push).
- **api:** Web Push con VAPID — `GET /push/vapid`, `POST /push/subscribe`, tabla `push_subscriptions`;
  **regla en el servidor** que envía push en segundo plano ante decisión accionable de alta confianza
  (con cooldown). Dependencia `web-push`.
- El push real completa el hueco dejado en M8 (avisos con la app cerrada).

### Changed — Modo solo-técnico (separar fundamental del técnico)

- **api:** flag `MACRO_ENABLED` (por defecto `false`): el sesgo macro/fundamental deja de inyectarse
  en la decisión en vivo, que pasa a ser **solo-técnica** y queda consistente con el backtest (que ya
  era solo-técnico). Reversible con `MACRO_ENABLED=true`. La matemática macro y su paridad quedan
  intactas (en pausa, no eliminadas).
- **web:** el panel Macro indica "modo solo-técnico"; la pestaña Backtest explica de forma intuitiva
  por qué emerge el número de operaciones.

### Changed / Added — Afinar técnico

- **ensemble:** `hold_band` 0.15 → 0.06 (menos zona neutra). En modo solo-técnico la decisión ya no
  cae en FLAT tan a menudo: sugiere COMPRAR/VENDER cuando |net| > 0.06 (antes 0.15). Vectores de
  paridad regenerados (Node≡Python).
- **web:** snapshot **automático** (toggle en el engranaje): guarda un snapshot al superar el umbral
  de una temporalidad, con el mismo cooldown, sin tener que registrarlo a mano.

## [0.11.0] — 2026-07-19

### Added — M8 · Notificaciones

- **api:** tabla `alerts` (historial) + endpoints `GET /alerts`, `POST /alerts`, `POST /alerts/read`.
- **web:** **centro de alertas** (campana con no-leídas + historial) y **notificaciones del navegador**;
  **motor de reglas en el cliente** (decisión ≥ umbral, señal Reditum, snapshot TP/SL, cambio de
  dirección/macro, avance 10% al objetivo) con **cooldown configurable** en el engranaje.
- El push móvil real (FCM/APNs) queda para M9 (requiere la app móvil).

## [0.10.0] — 2026-07-19

### Added — Fase presentación (UX)

- **Temporalidades:** nuevo intervalo **Mes (1M)** y barra deslizable (muestra 30m en adelante por
  defecto; las menores, deslizando a la izquierda). Tooltip con la decisión y % actual por TF.
- **Panel en una sola vista:** grid a pantalla completa sin scroll vertical (gráfico, decisión/plan/
  webhooks e indicadores compactos).
- **Gráfico local principal + lápiz:** capa de dibujo (colores/grosores/borrar) sobre el gráfico en
  vivo; TradingView queda como pestaña opcional.
- **Captura por snapshot:** botón 📈 en cada registro que abre el gráfico reconstruido de ese momento
  (velas hasta la captura + niveles del plan) y sirve de pizarra con lápiz.
- **Backtest:** tooltips en métricas y títulos; acordeón profundo (Calibración y Optimización). Fix:
  el panel de Optimización también aparece cuando hay backtest.
- **api:** `/candles?to=<ms>` (histórico hasta un instante) y `DELETE /snapshots/:id`.

## [0.9.0] — 2026-07-18

### Added — M7 · Optimización (Slice B)

- `apps/quant`: **Optuna** (TPE) optimiza pesos de indicadores y multiplicadores de régimen
  maximizando **expectancy penalizada** en **walk-forward con purga/embargo** (`walkforward.py`,
  `optimize.py`); promoción **solo si gana en hold-out**. CLI `run_optimize` → `ensemble.optimized.yaml`
  + `optimization_report.json`.
- `apps/api`: `POST /reload` recarga también el ensemble (prefiere el optimizado si existe);
  `GET /ensemble` con la versión activa y el informe base vs optimizado.
- `apps/web`: comparador de **Optimización** en la pestaña Backtest (veredicto + hold-out base vs
  optimizado). Además, layout de Backtest a dos columnas y guía en acordeón.
- Sin cambios de contrato ni de la matemática de decisión (mismos campos del ensemble): la paridad
  Node≡Python sigue vigente.

## [0.8.0] — 2026-07-18

### Added — M7 · Calibración (Slice A)

- `apps/quant`: módulo `calibration.py` con calibradores por régimen **isotónica (PAVA)** y **Platt**
  (elige el de menor **Brier**), a mano en numpy; CLI `python -m trademe_quant.run_calibration` que
  exporta `artifacts/calibrators.json`. El backtest guarda `regime` y `confidence` por trade.
- `apps/api`: applier del calibrador (**paridad** Node≡Python), campos `calibrated_confidence` y
  `calibration_version` en la señal, `GET /calibration` (fiabilidad + Brier) y `POST /reload`
  (recarga en caliente de artefactos).
- `apps/web`: panel **Calibración** en la pestaña Backtest (diagrama de fiabilidad por régimen + Brier).
- `infra`: volumen compartido `artifacts/` entre `quant` (escribe) y `api` (lee).
- Contrato: `calibrated_confidence`/`calibration_version` en el esquema; vectores de paridad del
  calibrador en `macro_vectors.json`.

## [0.7.0] — 2026-07-17

### Added — M6 · Backtesting

- `apps/quant`: mirror de la decisión (`decision.py`, agregación + plan) con **paridad** ampliada;
  harness de backtest sin look-ahead (primer toque, peor caso SL), métricas out-of-sample
  (win rate, expectancy, profit factor, max drawdown, Sharpe) y **evaluador de outcomes** de snapshots;
  CLI `python -m trademe_quant.run_backtest`.
- `apps/api`: tabla `backtests` (TimescaleDB) y `GET /backtest` (último resultado).
- `apps/web`: pestaña **Backtest** (métricas + curva de equity).
- Reditum: se añade `reditum_geny` (Geny Trend) al mapeo; atribución corregida a **Ingresarios**.

## [0.6.1] — 2026-07-16

### Added — M5.6 · UX, registros y validez del plan

- `apps/api`: runner de migraciones al arrancar (crea tablas faltantes sin recrear el volumen);
  **validez temporal del plan** (`plan.valid_candles`, campo `valid_until`); `GET /snapshots` con
  seguimiento en vivo (precio actual vs entrada/SL/TP, R aproximado, expirado). Contrato v1.2.0.
- `apps/web`: pestañas **Panel / Registros**; indicadores reubicados a lo ancho en la parte inferior;
  vista de Registros con tabla de snapshots y seguimiento en vivo.
- `docs/`: `metodologia.md` y `backlog.md` (integración de los documentos del equipo).

### Fixed

- El sesgo macro ahora se aplica de verdad en las señales en vivo (`/signal`, WS y `/snapshots`):
  en M5.5 el `macro` no se pasaba en esas llamadas.

## [0.6.0] — 2026-07-14

### Added — M5.5 · Macro Bias, Direccionalidad y Snapshots

- `apps/api`: sesgo macro (funding + tendencia semanal EMA 1w) inyectado en los logits del softmax,
  con degradación a FLAT en conflicto fuerte; campo `direction` (LONG/SHORT/FLAT); intervalo `1w`.
- `apps/api`: `POST /snapshots` (recalcula la señal, autoritativo) y tabla `snapshots` en TimescaleDB
  con columnas nombradas + `raw_signal` JSONB (dataset para entrenamiento de IA; `outcome_*` los llena M6).
- `apps/quant`: mirrors `macro.py` e `inference.py` con paridad (nuevos vectores dorados `macro_vectors.json`).
- `apps/web`: anillo LONG/SHORT/FLAT, panel Macro (sesgo/funding/tendencia/confluencia) y botón 📸 Snapshot.
- Contrato `signal.schema.json` v1.1.0 (`direction`, `macro`).

## [0.5.0] — 2026-07-10

### Added — M5 · Integración TradingView (Reditum)

- `apps/api`: webhook seguro `POST /tv-hook` (token en el body) para alertas Pine de la suite Reditum
  (`reditum_sniper`, `reditum_poc`); registro de alertas en TimescaleDB (`external_signals`) para el
  backtest de M6.
- `apps/web`: pestaña TradingView (widget Advanced Chart) junto a "Local" y panel de estado de
  webhooks (estrategia, latencia, TTL restante).
- `apps/quant`: lector/validador de `external_signals` (semilla del replay de M6).
- `docs/tradingview.md`: guía de configuración de la alerta (URL + JSON + túnel ngrok).

### Removed

- **Purga completa de NinjaTrader**: fuera `POST /signals/ninjatrader`, la fuente `ninjatrader`, el
  secret NT8 y toda referencia en código, tests y docs. La integración externa es exclusivamente
  TradingView (Reditum). El peso 2× pasa a `tradingview`.

- `artifacts/ensemble.yaml`: pesos, reglas de régimen, temperatura y la fuente externa con peso 2×.
  endpoint de señales externas con mapeo declarativo `config/external_signals.yaml` y TTL.
- `apps/web`: heatmap de indicadores en vivo (color por score, intensidad por confianza, badge de fuente externa).

## [0.4.0] — 2026-07-08

### Added — M4 · Plan de acción

- `apps/api`: `buildPlan` (entrada, stop-loss por ATR, take-profit por múltiplo de riesgo y tamaño
  de posición por riesgo fijo) integrado en el Signal; parámetros en `ensemble.yaml` (sección `risk`)
  y capital por `ACCOUNT_EQUITY`.
- `apps/quant`: validación de la sección `risk` del `ensemble.yaml`.
- `apps/web`: panel "Plan de acción" con el checklist numerado.

## [0.3.0] — 2026-07-07

### Added — M3 · Ensemble + probabilidades

- `apps/api`: agregador ponderado por régimen (ADX), inferencia `net → BUY/HOLD/SELL` vía softmax
  con temperatura, objeto Signal completo, `GET /signal` y WS `{type:'signal'}`.
- `artifacts/ensemble.yaml`: pesos, reglas de régimen, temperatura y NinjaTrader con peso 2×.
- `apps/quant`: validación de esquema de `ensemble.yaml` (`load_ensemble`/`validate_ensemble`).
- `apps/web`: panel de decisión con anillo de confianza y desglose de probabilidades BUY/HOLD/SELL.

- Multi-temporalidad: soporte para `1m, 5m, 15m, 30m, 1h, 4h, 1d` (suscritas en vivo; configurable
  vía `TRADEME_INTERVALS`). El selector del dashboard se puebla desde `GET /symbols`.

## [0.2.0] — 2026-07-06

### Added — M2 · Indicadores plugin + paridad

- `apps/api`: contrato `Indicator`/voto (con `source`, `ts`, `ttlMs`), 7 built-in con
  `technicalindicators` y normalización a `score` en [-1,+1], `IndicatorRegistry` y `GET /indicators`.
- `apps/api`: votos en vivo por WS (`{type:'votes'}`), `GET /votes`, y slot de señales externas
  `POST /signals/ninjatrader` con mapeo declarativo `config/external_signals.yaml` y TTL (stub NT8).
- `apps/quant`: mirror de indicadores en numpy (paridad con technicalindicators) y runner de paridad.
- `packages/core-signals`: vectores dorados `parity/vectors.json` (generador `gen-parity.ts`).
- CI: tercer job **parity** (Node y Python contra los mismos vectores).
- `apps/web`: heatmap de indicadores en vivo (color por score, intensidad por confianza, badge NT8).

## [0.1.0] — 2026-07-03

### Added — M1 · Datos en vivo (Binance)

- `apps/api`: interfaz `DataAdapter` y `BinanceAdapter` (WebSocket de klines, normalización OHLCV,
  reconexión con backoff exponencial + jitter, `getHistory` por REST).
- `apps/api`: canal `ws://…/stream/{symbol}?interval=1m|1h`, endpoints `GET /candles` y `GET /symbols`,
  y persistencia de velas cerradas en TimescaleDB vía `pg`.
- `apps/quant`: `seed_history` (siembra idempotente), `detect_gaps`, cliente REST de Binance y sink
  `PgCandleSink` (psycopg).
- `apps/web`: gráfico de velas en vivo con lightweight-charts, selector de activo y temporalidad
  (1m/1h) y estado de conexión.
- `infra`: `candles` multi-temporalidad (PK `symbol, interval, ts`) + migración `002`.
- Tests nuevos (Node y Python), incluida la prueba de reconexión del adaptador.

### Fixed
- Build de imágenes Docker de `apps/api` y `apps/web`: se instala el workspace pnpm completo
  (devDeps incluidas, `tsc` disponible) y se añade `.dockerignore` para no arrastrar `node_modules`
  del host. Resuelve `MODULE_NOT_FOUND` de `tsc` en `docker compose build`.

## [0.0.0] — 2026-06-29

### Added — M0 · Scaffolding

- Monorepo pnpm con workspaces (`apps/api`, `apps/quant`, `apps/web`, `packages/core-signals`).
- `apps/api`: servidor Fastify con `GET /health` y canal WebSocket base `/stream`.
- `apps/quant`: esqueleto de paquete Python con tracking MLflow local y pruebas.
- `packages/core-signals`: esquema de señal `signal.schema.json` v1.0.0 y carpeta de paridad.
- `apps/web`: shell del dashboard React + Vite con tema oscuro y selector de activos.
- `infra/docker-compose.yml`: api + quant + web + PostgreSQL/TimescaleDB + Redis.
- CI de GitHub Actions con dos jobs (Node y Python): lint + typecheck/mypy + tests.
- Documentación inicial en `docs/` y `.env.example`.
