# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y [Versionado Semántico](https://semver.org/lang/es/).

> Este fichero es la **única fuente** del historial de versiones: la pestaña Novedades y el
> asistente lo leen de aquí. No se edita ninguna copia aparte, y CI comprueba que la versión de
> los `package.json` coincide con la primera entrada de abajo.

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
  con el 85,6 % al stop contra una tendencia alcista de fondo.
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
