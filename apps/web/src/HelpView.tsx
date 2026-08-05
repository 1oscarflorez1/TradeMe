import { useState } from 'react';

type Section = 'inicio' | 'manual' | 'kb' | 'faq' | 'glosario';

interface Article {
  title: string;
  body: React.ReactNode;
}

/** Manual de usuario: cómo hacer las tareas, paso a paso. */
const MANUAL: Article[] = [
  {
    title: '1. Leer una decisión en el Panel',
    body: (
      <>
        <p>
          El Panel muestra la decisión <strong>en vivo</strong> del símbolo y la temporalidad
          seleccionados arriba. El anillo indica la dirección (LONG al alza, SHORT a la baja, FLAT
          fuera) y el porcentaje es la confianza de esa decisión.
        </p>
        <ol>
          <li>Elige símbolo y temporalidad en la barra superior.</li>
          <li>
            Mira el anillo: si dice FLAT/MANTENER, el modelo no ve ventaja suficiente para operar.
          </li>
          <li>
            Debajo, las barras muestran cómo se reparte la probabilidad entre Comprar, Mantener y
            Vender.
          </li>
          <li>
            El <strong>Plan de acción</strong> traduce la decisión a números concretos: entrada,
            stop, objetivo, tamaño de posición y hasta cuándo es válida.
          </li>
          <li>
            Los <strong>Indicadores</strong> de abajo explican el porqué: cada uno vota entre −1
            (vender) y +1 (comprar).
          </li>
        </ol>
      </>
    ),
  },
  {
    title: '2. Guardar un registro (snapshot) y seguirlo',
    body: (
      <>
        <p>
          Un registro congela una decisión real para comprobar después si acertó. Es la prueba de
          fuego del sistema: mide en el presente, no sobre el pasado.
        </p>
        <ol>
          <li>
            En el Panel, pulsa <strong>📸 Snapshot</strong> cuando quieras registrar la decisión
            actual.
          </li>
          <li>
            Ve a <strong>Registros</strong>: verás la fila con su plan y el estado (En curso, ✓ TP si
            alcanzó el objetivo, ✗ SL si tocó el stop).
          </li>
          <li>
            Pulsa la <strong>flecha</strong> de una fila para ver todos sus datos y su informe;{' '}
            <strong>📈</strong> para ver el gráfico de ese momento (y dibujar sobre él);{' '}
            <strong>✕</strong> para borrarla.
          </li>
          <li>
            Usa los <strong>filtros</strong> (temporalidad, acción, dirección, estado) y ordena
            pulsando en Fecha, Confianza o R en vivo.
          </li>
        </ol>
      </>
    ),
  },
  {
    title: '3. Automatizar el guardado de registros',
    body: (
      <>
        <p>
          No hace falta que estés pendiente: la app puede registrar sola las decisiones que superen
          tu umbral de confianza.
        </p>
        <ol>
          <li>
            Pulsa el <strong>⚙ engranaje</strong> junto a la barra de temporalidades.
          </li>
          <li>
            Ajusta el <strong>umbral</strong> por temporalidad (40 % es un buen punto de partida; 50
            % es muy exigente para un modelo de tres salidas).
          </li>
          <li>
            Activa <strong>«Guardar snapshot automático»</strong> y pon un <strong>límite</strong>{' '}
            (al alcanzarlo se desactiva solo, para que no se te llene sin control).
          </li>
          <li>
            El <strong>cooldown</strong> evita repetir la misma alerta o registro una y otra vez.
          </li>
        </ol>
      </>
    ),
  },
  {
    title: '4. Medir la estrategia (Backtest)',
    body: (
      <>
        <p>
          El backtest simula la estrategia sobre el histórico para responder: ¿esto tiene ventaja o
          es suerte? Es <strong>por temporalidad</strong>: cada una tiene el suyo.
        </p>
        <ol>
          <li>
            Abre <strong>Backtest</strong> con la temporalidad que quieras medir.
          </li>
          <li>
            Pulsa <strong>▶ Correr backtest</strong> (tarda ~10–30 s). Además evalúa tus registros
            pendientes.
          </li>
          <li>
            Lee primero <strong>Expectancy</strong> (ganancia media por operación en R) y{' '}
            <strong>Profit factor</strong>; luego mira las métricas <strong>OOS</strong>: si se
            parecen al resto, el resultado es creíble.
          </li>
          <li>
            El informe bajo la curva resume en palabras lo que muestran los números.
          </li>
        </ol>
        <p className="bt-note">
          No necesitas pulsarlo a diario: el piloto automático lo hace cada pocas horas.
        </p>
      </>
    ),
  },
  {
    title: '5. Afinar el modelo (Laboratorio)',
    body: (
      <>
        <p>
          En el <strong>Laboratorio</strong> está todo lo que ajusta la maquinaria. Puedes no tocar
          nada: el piloto lo gestiona. Si quieres hacerlo a mano:
        </p>
        <ol>
          <li>
            <strong>⚙ Optimizar</strong>: busca mejores parámetros y solo los aplica si ganan en un
            tramo reservado (hold-out). Úsalo con moderación.
          </li>
          <li>
            <strong>🎯 Calibrar</strong>: ajusta las probabilidades para que un «70 %» signifique
            acertar ~70 % de las veces.
          </li>
          <li>
            <strong>🧠 Entrenar ahora</strong>: reentrena el meta-modelo con tus registros
            evaluados.
          </li>
          <li>
            <strong>🤖 Piloto automático</strong>: pulsa <strong>⚙ Configurar</strong> para decidir
            cada cuánto mide, optimiza y qué temporalidades vigila.
          </li>
        </ol>
      </>
    ),
  },
  {
    title: '6. Alertas y notificaciones',
    body: (
      <>
        <p>
          La <strong>campana 🔔</strong> reúne todo lo importante: decisiones que superan tu umbral,
          señales Reditum recibidas, registros que tocan objetivo o stop, cambios de dirección y
          avisos del piloto.
        </p>
        <ol>
          <li>Ábrela y pulsa «Activar push en este dispositivo» para recibir avisos de escritorio.</li>
          <li>
            El <strong>punto verde</strong> sobre una temporalidad indica que ahí hay una decisión
            operable por encima de tu umbral.
          </li>
          <li>Con la app instalada (PWA) y HTTPS, los avisos llegan aunque esté cerrada.</li>
        </ol>
      </>
    ),
  },
];

/** Base de conocimientos: cómo funciona por dentro. */
const KB: Article[] = [
  {
    title: 'Arquitectura general',
    body: (
      <p>
        TradeMe tiene tres piezas: el <strong>motor en vivo</strong> (recibe velas, calcula
        indicadores y decide en milisegundos), el <strong>servicio quant</strong> (backtesting,
        optimización y machine learning, en Python) y el <strong>portal</strong> que estás usando.
        Comparten un <em>contrato</em> de señal y una <strong>suite de paridad</strong> que verifica
        que ambos motores calculan exactamente lo mismo: lo que se mide en el backtest es lo que se
        decide en vivo.
      </p>
    ),
  },
  {
    title: 'Cómo se construye una decisión',
    body: (
      <>
        <p>Cada vela dispara esta cadena:</p>
        <ol>
          <li>
            <strong>Indicadores → votos:</strong> seis indicadores votan entre −1 y +1. Tres miran
            tendencia/momentum (EMA 9/21, MACD, Supertrend) y tres reversión (RSI, Bollinger,
            Estocástico).
          </li>
          <li>
            <strong>Régimen (ADX):</strong> mide la fuerza de la tendencia y <em>pondera
            continuamente</em>: cuanto más tendencial el mercado, más pesan tendencia y momentum;
            cuanto más lateral, más pesa la reversión.
          </li>
          <li>
            <strong>Score neto:</strong> media ponderada de los votos.
          </li>
          <li>
            <strong>Probabilidades:</strong> una función <em>softmax</em> convierte ese score en
            Comprar / Mantener / Vender. La «zona neutra» (hold band) evita operar con señales
            débiles.
          </li>
          <li>
            <strong>Plan y riesgo:</strong> el ATR define el stop (1,5×ATR), el objetivo (2R) y el
            tamaño para arriesgar el 1 % del capital.
          </li>
        </ol>
      </>
    ),
  },
  {
    title: 'Backtesting honesto: sin look-ahead y peor caso',
    body: (
      <p>
        En cada vela la decisión usa <strong>solo</strong> información disponible hasta ese momento.
        Si dentro de una misma vela se tocan stop y objetivo, se asume la <strong>pérdida</strong>{' '}
        (no sabemos qué ocurrió primero). Las operaciones <strong>no se solapan</strong>. Además se
        reserva el <strong>30 % final</strong> de los datos como examen (out-of-sample). Todo esto
        hace que los resultados pequen de conservadores en lugar de ilusionar.
      </p>
    ),
  },
  {
    title: 'Optimización con Optuna y hold-out',
    body: (
      <p>
        Optuna prueba cientos de combinaciones de parámetros (pesos, multiplicadores de régimen,
        zona neutra, temperatura, sensibilidad del ADX) buscando la que más ventaja habría dado, en
        una <strong>validación temporal con purga y embargo</strong> (nunca mezcla pasado y futuro).
        El candidato ganador <strong>solo se promociona si además supera al actual</strong> en un
        tramo hold-out que no participó en la búsqueda. Cada temporalidad guarda su propia
        configuración.
      </p>
    ),
  },
  {
    title: 'Calibración de probabilidades',
    body: (
      <p>
        Un modelo puede acertar la dirección pero exagerar su confianza. La calibración (isotónica o
        Platt, la que menos error dé) corrige esa confianza para que refleje la{' '}
        <strong>frecuencia real de acierto</strong>, por régimen de mercado. Importa porque tus
        alertas y el guardado automático dependen de un umbral de confianza.
      </p>
    ),
  },
  {
    title: 'Meta-modelo (meta-labeling)',
    body: (
      <p>
        Es un segundo modelo que aprende de tus <strong>decisiones ya evaluadas</strong> (las que
        tocaron objetivo o stop) a estimar la probabilidad de éxito de cada señal nueva. No cambia la
        dirección: actúa como <strong>filtro anti-falsos-positivos</strong>. Se entrena con división
        temporal y solo se publica si mejora la expectancy en validación. Se reentrena solo conforme
        acumulas registros.
      </p>
    ),
  },
  {
    title: 'El piloto automático',
    body: (
      <p>
        Un trabajador en el servicio quant que <strong>mide</strong> cada pocas horas (y evalúa tus
        registros), <strong>optimiza</strong> solo por mantenimiento o si detecta degradación (con
        cooldown para no perseguir ruido), <strong>recalibra</strong> tras cada promoción y{' '}
        <strong>reentrena</strong> el meta-modelo. Te avisa por la campana cuando algo relevante
        ocurre. Su política es configurable desde el Laboratorio.
      </p>
    ),
  },
  {
    title: 'Proveedores de datos: de dónde salen las velas',
    body: (
      <p>
        TradeMe separa <strong>quién entrega los datos</strong> de <strong>qué hace con ellos</strong>.
        Binance aporta cripto en <strong>⚡ tiempo real</strong> (streaming, sin clave). Twelve Data
        aporta <strong>acciones, divisas, índices y ETF</strong> por <strong>⏱ consulta periódica</strong>:
        su plan gratuito no tiene streaming, así que TradeMe pregunta cada pocos minutos y emite las
        velas ya cerradas. Por eso, en activos ⏱ conviene trabajar de <strong>15m en adelante</strong>.
        Añadir otro proveedor no toca la matemática de la decisión: todos entregan la misma vela.
      </p>
    ),
  },
  {
    title: '¿Por qué TradingView no es un proveedor de datos?',
    body: (
      <p>
        Porque no publica una API de velas para terceros. Su widget <em>dibuja</em> casi cualquier
        mercado y sus alertas <em>avisan</em>, pero sus feeds internos son privados, cambian sin aviso
        y su uso automatizado va contra sus condiciones. Construir el motor sobre eso sería frágil y
        arriesgado. De ahí el reparto: <strong>TradingView es pantalla y sensor</strong> (gráfico +
        alertas Reditum), y los <strong>proveedores son la fuente</strong> con la que se decide,
        calibra, se hace backtest y se entrena. Consecuencia práctica: el gráfico puede mostrar un
        mercado que TradeMe todavía no sabe analizar.
      </p>
    ),
  },
  {
    title: 'Señales externas Reditum (TradingView)',
    body: (
      <p>
        Las estrategias privadas de la suite Reditum viven en TradingView. Cuando una alerta se
        dispara, llega al webhook de TradeMe y se convierte en <strong>un voto más</strong> del
        ensemble (con más peso, por ser fuente principal de alfa) durante un tiempo limitado. Ningún
        código propietario vive en la plataforma: solo se mapean sus salidas.
      </p>
    ),
  },
  {
    title: 'Análisis fundamental (en pausa)',
    body: (
      <p>
        La plataforma tuvo un <strong>sesgo macro</strong> (funding + tendencia semanal) que
        inclinaba la decisión. Está <strong>desactivado a propósito</strong> para afinar primero el
        análisis técnico puro y que backtest y vivo midan exactamente lo mismo. La arquitectura para
        reincorporarlo —con peso ajustado por temporalidad— ya está programada y en espera.
      </p>
    ),
  },
];

const KB_EXTRA: Article[] = [
  {
    title: 'Cómo se lee el informe de un backtest',
    body: (
      <>
        <p>
          El informe responde a una sola pregunta: <strong>¿esta configuración tenía ventaja sobre el
          pasado?</strong> Se lee de fuera hacia dentro.
        </p>
        <ol>
          <li>
            <strong>Expectancy primero.</strong> Si es negativa, lo demás da igual. Si es positiva,
            mide cuánta ventaja hay por operación.
          </li>
          <li>
            <strong>Después el número de trades.</strong> Una expectancy magnífica sobre 12
            operaciones no significa nada. Por debajo de 30 no saques conclusiones.
          </li>
          <li>
            <strong>Luego el fuera de muestra.</strong> Si el resultado se desploma en el último 30 %
            de los datos, el ajuste está memorizando el pasado en vez de aprender de él.
          </li>
          <li>
            <strong>Y por último el drawdown.</strong> No mide si ganas, mide si podrías aguantarlo.
          </li>
        </ol>
        <p>
          La <strong>curva de equity</strong> suma el resultado de cada operación. Lo que buscas no es
          una línea que suba mucho, sino una que suba <em>de forma sostenida</em>: los escalones
          bruscos suelen ser una racha afortunada que no se repetirá.
        </p>
        <p className="muted">
          Ninguna de estas cifras descuenta comisiones ni deslizamiento. Medir ese coste real es el
          motivo de la futura cuenta de papel.
        </p>
      </>
    ),
  },
  {
    title: 'Cómo se lee el Laboratorio',
    body: (
      <>
        <p>
          El Laboratorio tiene cuatro secciones y cada una responde a una pregunta distinta. No hay
          que tocarlas: el piloto automático las lanza cuando toca. Lo que muestran es el estado.
        </p>
        <ul>
          <li>
            <strong>Calibración.</strong> ¿Cuando el sistema dice «70 % de confianza», acierta de
            verdad el 70 % de las veces? Ajusta la escala de confianza sin tocar la dirección.
          </li>
          <li>
            <strong>Optimización de pesos.</strong> ¿Qué indicador merece pesar más? Optuna prueba
            miles de combinaciones y solo promociona la candidata si además gana en el tramo que no
            vio.
          </li>
          <li>
            <strong>Dataset ML.</strong> ¿Hay ya bastantes decisiones evaluadas para entrenar al
            meta-modelo? Las barras muestran cuánto falta para cada criterio.
          </li>
          <li>
            <strong>Piloto automático.</strong> ¿Cuándo fue la última medición y cuándo toca la
            siguiente? Es el reloj de todo lo demás.
          </li>
        </ul>
        <p>
          El orden natural es: se acumulan registros → se miden → si empeoran, se optimiza → tras
          optimizar, se recalibra → con suficientes datos, se entrena el meta-modelo.
        </p>
      </>
    ),
  },
  {
    title: 'Por qué perder más veces de las que se gana puede ser bueno',
    body: (
      <>
        <p>
          Es la confusión más común y merece su propio apartado. TradeMe coloca el objetivo al{' '}
          <strong>doble</strong> de distancia que el stop (relación 2:1). Con esa proporción, el punto
          de equilibrio está en acertar el <strong>33,3 %</strong> de las veces.
        </p>
        <p>
          Acertar el 44 % con esa relación deja una ganancia media de <strong>+0,32 R</strong> por
          operación: por cada 100 que arriesgas, ganas 32 a la larga. Ver el doble de stops que de
          objetivos es, por tanto, el comportamiento <em>esperado</em>, no una señal de alarma.
        </p>
        <p>
          Lo preocupante sería lo contrario: muchos aciertos pequeños y pocas pérdidas grandes. Eso
          suele acabar mal.
        </p>
        <p>
          La pestaña <strong>Registros</strong> hace esta cuenta sola y te dice si el sistema tiene
          ventaja o no.
        </p>
      </>
    ),
  },
];

const FAQ: Article[] = [
  {
    title: '¿Por qué casi siempre dice MANTENER / FLAT?',
    body: (
      <p>
        Porque el modelo solo sugiere operar cuando el acuerdo entre indicadores supera la zona
        neutra. Es deliberado: preferimos pocas señales con criterio que muchas al azar. Si quieres
        más señales, baja el umbral en el engranaje (a 40 %) — pero recuerda que más señales también
        significa más ruido.
      </p>
    ),
  },
  {
    title: '¿Por qué el backtest no cambia si guardo registros?',
    body: (
      <p>
        Son cosas distintas: el backtest mide sobre el <strong>histórico</strong> y solo cambia
        cuando se vuelve a ejecutar; los registros son un test <strong>hacia adelante</strong>. Lo
        que sí ocurre al correr el backtest es que tus registros pendientes se evalúan.
      </p>
    ),
  },
  {
    title: '¿Por qué cambia el número de operaciones entre corridas?',
    body: (
      <p>
        Porque la ventana de ~1000 velas se desplaza con el tiempo y las operaciones no se solapan.
        No es un parámetro fijo: es cuántas veces la lógica dijo Comprar o Vender en ese tramo.
      </p>
    ),
  },
  {
    title: '¿Qué hago si una temporalidad da expectancy negativa?',
    body: (
      <p>
        Primero, no operarla. El piloto intentará optimizarla y, si no encuentra nada que gane en
        hold-out, te avisará de «degradación sin mejora»: eso significa que en ese marco temporal la
        estrategia no tiene filo ahora mismo. Concéntrate en las temporalidades con expectancy
        positiva y OOS también positivo.
      </p>
    ),
  },
  {
    title: '¿Los botones interfieren con el piloto automático?',
    body: (
      <p>
        ▶ no: solo mide. ⚙ sí: reinicia el reloj del piloto (cooldown y mantenimiento cuentan desde
        ese momento). Por eso ambos piden confirmación antes de ejecutarse.
      </p>
    ),
  },
  {
    title: '¿TradeMe opera por mí?',
    body: (
      <p>
        <strong>No.</strong> Es apoyo a la decisión. La ejecución con dinero real está detrás de un
        interruptor desactivado por diseño, y no se activará sin límites de riesgo, doble
        confirmación y pruebas en simulado.
      </p>
    ),
  },
  {
    title: '¿Puedo instalarlo como app en el móvil?',
    body: (
      <p>
        Sí: es una PWA. Con HTTPS, el navegador ofrece «Instalar»; en iPhone, Compartir → Añadir a
        inicio. Así recibes notificaciones aunque esté cerrada.
      </p>
    ),
  },
];

const GLOSARIO: Array<[string, string, string]> = [
  [
    'Trades',
    'básico',
    'Operaciones que la lógica de decisión habría abierto sobre el histórico. Cuantas más, más fiable la estadística: con menos de 30 cualquier conclusión es ruido.',
  ],
  [
    'Win rate',
    'básico',
    'Porcentaje de operaciones ganadoras. Por sí solo NO dice si el sistema gana dinero: con objetivo al doble de distancia que el stop, acertar el 40 % ya es rentable.',
  ],
  [
    'Expectancy',
    'básico',
    'La métrica reina: ganancia media por operación medida en R. Una R es lo que arriesgas en cada entrada (la distancia entrada→stop). Positiva significa que el sistema tiene ventaja.',
  ],
  [
    'R (múltiplo de riesgo)',
    'básico',
    'La unidad con la que medimos todo. 1 R = lo que pierdes si salta el stop. Ganar 2 R es ganar el doble de lo que arriesgabas. Permite comparar operaciones de tamaños distintos.',
  ],
  [
    'Profit factor',
    'intermedio',
    'Ganancias brutas ÷ pérdidas brutas. Por encima de 1 es rentable. 1,10 indica que apenas gana un 10 % más de lo que pierde: ventaja pequeña y frágil.',
  ],
  [
    'Max drawdown',
    'intermedio',
    'La peor caída acumulada desde un punto alto. Mide cuánto duele la peor racha y sirve para saber si podrías aguantarla, psicológica y financieramente.',
  ],
  [
    'Sharpe',
    'intermedio',
    'Rentabilidad ajustada a la volatilidad: cuánto ganas por unidad de riesgo. Cuanto mayor, más estable y menos dependiente de la suerte.',
  ],
  [
    'Fuera de muestra (OOS)',
    'intermedio',
    'Las mismas métricas pero solo sobre el 30 % final de los datos, un tramo que no influyó en el ajuste. Es la prueba de honestidad: si se parece al resto, el sistema no está sobreajustado.',
  ],
  [
    'Timeout',
    'básico',
    'Una operación que se cerró al agotarse el horizonte de evaluación sin tocar objetivo ni stop. Ni acierto ni fallo: cuenta con el resultado parcial que llevara.',
  ],
  ['Vela (candle)', 'Básico', 'Resumen del precio en un intervalo: apertura, máximo, mínimo y cierre.'],
  ['Temporalidad (timeframe)', 'Básico', 'Duración de cada vela: 15m, 1h, 1d… Marca el horizonte de la decisión.'],
  ['LONG / SHORT / FLAT', 'Básico', 'Apostar al alza, a la baja o quedarse fuera.'],
  ['Stop-loss', 'Básico', 'Precio de salida con pérdida. Protege el capital de un movimiento adverso.'],
  ['Take-profit (objetivo)', 'Básico', 'Precio de salida con ganancia.'],
  ['R (unidad de riesgo)', 'Clave', 'Lo que arriesgas en una operación (distancia entrada→stop). Ganar 2R = el doble de lo arriesgado.'],
  ['R:R (riesgo:beneficio)', 'Clave', 'Relación entre lo arriesgado y lo buscado. Aquí 1:2 por defecto.'],
  ['Expectancy', 'Clave', 'Ganancia media por operación en R. Positiva = el sistema tiene ventaja. La métrica más importante.'],
  ['Win rate', 'Clave', 'Porcentaje de operaciones ganadoras. Por sí solo no dice si se gana dinero.'],
  ['Profit factor', 'Clave', 'Ganancias brutas ÷ pérdidas brutas. Mayor que 1 = rentable.'],
  ['Drawdown', 'Clave', 'Caída acumulada desde un máximo. Mide cuánto duele la peor racha.'],
  ['Sharpe', 'Clave', 'Rentabilidad ajustada a la volatilidad: cuánta ganancia por unidad de riesgo asumido.'],
  ['Indicador', 'Técnico', 'Cálculo sobre el precio que resume una idea (tendencia, momentum, exceso).'],
  ['EMA 9/21', 'Técnico', 'Medias exponenciales rápida y lenta; su cruce indica dirección de la tendencia.'],
  ['MACD', 'Técnico', 'Mide impulso: aceleración o pérdida de fuerza de un movimiento.'],
  ['RSI', 'Técnico', 'Oscilador 0–100: valores bajos sugieren sobreventa; altos, sobrecompra.'],
  ['Bandas de Bollinger', 'Técnico', 'Envoltura de volatilidad; el precio en los extremos sugiere exceso.'],
  ['Estocástico', 'Técnico', 'Compara el cierre con el rango reciente; detecta giros en zonas extremas.'],
  ['Supertrend', 'Técnico', 'Seguidor de tendencia basado en ATR; marca el lado del mercado.'],
  ['ADX', 'Técnico', 'Fuerza de la tendencia (no su dirección). Aquí modula cuánto pesan tendencia vs reversión.'],
  ['ATR', 'Técnico', 'Rango medio verdadero: mide volatilidad. Define stop, objetivo y tamaño.'],
  ['Ensemble', 'Sistema', 'Combinación ponderada de todos los votos para producir una decisión única.'],
  ['Régimen', 'Sistema', 'Estado del mercado: tendencial o lateral. Cambia el peso de cada familia de indicadores.'],
  ['Score neto', 'Sistema', 'Resultado de la media ponderada de votos, entre −1 y +1.'],
  ['Softmax / temperatura', 'Sistema', 'Convierte el score en probabilidades; la temperatura regula lo «decidido» del reparto.'],
  ['Zona neutra (hold band)', 'Sistema', 'Umbral por debajo del cual se prefiere MANTENER.'],
  ['Confianza', 'Sistema', 'Probabilidad de la acción elegida. Calibrada, refleja la frecuencia real de acierto.'],
  ['Snapshot (registro)', 'Sistema', 'Foto de una decisión real, con su plan, para comprobarla después.'],
  ['Backtest', 'Validación', 'Simulación de la estrategia sobre datos históricos.'],
  ['Look-ahead bias', 'Validación', 'Error de usar información del futuro al decidir. Aquí se evita por diseño.'],
  ['Out-of-sample (OOS)', 'Validación', 'Tramo reservado que no participó en el ajuste; sirve de examen.'],
  ['Hold-out', 'Validación', 'Reserva final usada para decidir si un candidato se promociona.'],
  ['Walk-forward', 'Validación', 'Validación por bloques que respeta el orden del tiempo.'],
  ['Purga y embargo', 'Validación', 'Técnicas que impiden que una operación cruce la frontera entre entrenamiento y prueba.'],
  ['Sobreajuste (overfitting)', 'Validación', 'Ajustar tanto al pasado que se memoriza el ruido y falla en el futuro.'],
  ['Optuna', 'ML', 'Buscador inteligente de parámetros; prueba combinaciones y aprende de los resultados.'],
  ['Calibración', 'ML', 'Ajuste para que las probabilidades sean honestas (isotónica / Platt).'],
  ['Brier score', 'ML', 'Error de las probabilidades: más bajo, mejor calibrado.'],
  ['Meta-labeling', 'ML', 'Modelo secundario que juzga la calidad de las señales del principal.'],
  ['AUC', 'ML', 'Capacidad de distinguir aciertos de fallos: 0,5 azar, 1,0 perfecto.'],
  ['ONNX', 'ML', 'Formato estándar para ejecutar modelos entrenados de forma rápida y portable.'],
  ['Funding rate', 'Fundamental', 'Coste de financiación de los perpetuos; refleja el posicionamiento del mercado.'],
  ['Sesgo macro', 'Fundamental', 'Inclinación de fondo (funding + tendencia semanal). Hoy desactivado a propósito.'],
];

/** Una frase por artículo: es lo que permite decidir si merece la pena abrirlo. */
const RESUMEN: Record<string, string> = {
  '1. Leer una decisión en el Panel': 'Qué significa el anillo, las barras y el plan de acción.',
  '2. Guardar un registro (snapshot) y seguirlo': 'Cómo congelar una decisión para comprobar después si acertó.',
  '3. Automatizar el guardado de registros': 'Que el motor capture solo, sin tener el portal abierto.',
  '4. Medir la estrategia (Backtest)': 'Correr la prueba histórica y saber si hay ventaja.',
  '5. Afinar el modelo (Laboratorio)': 'Calibrar, optimizar y entrenar, sin tocar la terminal.',
  '6. Alertas y notificaciones': 'Que te avise cuando pasa algo, incluso con la app cerrada.',
  'Arquitectura general': 'Quién hace qué: Node decide, Python aprende, la web muestra.',
  'Cómo se construye una decisión': 'El camino completo desde la vela hasta COMPRAR o VENDER.',
  'Backtesting honesto: sin look-ahead y peor caso': 'Por qué nuestras cifras son más feas y más ciertas.',
  'Optimización con Optuna y hold-out': 'Cómo se eligen los pesos sin engañarse con el pasado.',
  'Calibración de probabilidades': 'Que un 70 % signifique de verdad un 70 %.',
  'Meta-modelo (meta-labeling)': 'Un segundo modelo que decide cuándo NO fiarse del primero.',
  'El piloto automático': 'Quién mide, optimiza y reentrena mientras no miras.',
  'Proveedores de datos: de dónde salen las velas': 'Binance, Twelve Data e IBKR: quién da qué y a qué velocidad.',
  '¿Por qué TradingView no es un proveedor de datos?': 'Dibuja y avisa, pero no entrega velas. La razón importa.',
  'Señales externas Reditum (TradingView)': 'Cómo entran tus algoritmos privados en la decisión.',
  'Análisis fundamental (en pausa)': 'Por qué está desactivado a propósito y cuándo volverá.',
  'Cómo se lee el informe de un backtest': 'En qué orden mirar las métricas para no engañarte.',
  'Cómo se lee el Laboratorio': 'Qué pregunta responde cada una de las cuatro secciones.',
  'Por qué perder más veces de las que se gana puede ser bueno': 'La cuenta que explica por qué ves más SL que TP.',
};

/** Entradas por tarea: la mayoría llega con una intención concreta, no a «leerse la ayuda». */
const RUTAS: Array<{ icono: string; titulo: string; sub: string; sec: Section; art: string }> = [
  {
    icono: '🧭',
    titulo: 'Acabo de entrar y no sé qué miro',
    sub: 'Empieza por cómo se lee una decisión.',
    sec: 'manual',
    art: '1. Leer una decisión en el Panel',
  },
  {
    icono: '📉',
    titulo: 'Veo muchos stops y me preocupa',
    sub: 'La cuenta que explica por qué es normal.',
    sec: 'kb',
    art: 'Por qué perder más veces de las que se gana puede ser bueno',
  },
  {
    icono: '🔬',
    titulo: 'Quiero saber si la estrategia funciona',
    sub: 'Cómo se lee el informe de un backtest.',
    sec: 'kb',
    art: 'Cómo se lee el informe de un backtest',
  },
  {
    icono: '🧠',
    titulo: 'Quiero entender cómo aprende',
    sub: 'Las tres capas que ajustan el criterio.',
    sec: 'kb',
    art: 'Cómo se construye una decisión',
  },
];

/** Minutos de lectura estimados a partir del texto real del artículo. */
function minutos(nodo: React.ReactNode): number {
  const texto = JSON.stringify(nodo);
  return Math.max(1, Math.round(texto.split(/\s+/).length / 180));
}

export function HelpView() {
  const [sec, setSec] = useState<Section>('inicio');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const KB_TODO = [...KB, ...KB_EXTRA];
  const porSeccion: Record<Exclude<Section, 'inicio' | 'glosario'>, Article[]> = {
    manual: MANUAL,
    kb: KB_TODO,
    faq: FAQ,
  };

  const busca = q.trim().toLowerCase();
  const coincide = (a: Article) =>
    (a.title + ' ' + (RESUMEN[a.title] ?? '')).toLowerCase().includes(busca);

  // La búsqueda atraviesa las cuatro secciones: nadie sabe de antemano en cuál está su respuesta.
  const resultados = busca
    ? ([
        ['Manual', MANUAL.filter(coincide)] as const,
        ['Base de conocimientos', KB_TODO.filter(coincide)] as const,
        ['Preguntas frecuentes', FAQ.filter(coincide)] as const,
      ].filter(([, l]) => l.length > 0) as Array<readonly [string, Article[]]>)
    : [];
  const glosBusca = busca
    ? GLOSARIO.filter(([t, , d]) => (t + d).toLowerCase().includes(busca))
    : GLOSARIO;

  const irA = (s: Section, art: string) => {
    setSec(s);
    setAbierto(art);
    setQ('');
    requestAnimationFrame(() => {
      document.getElementById(`art-${art}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const Tarjeta = ({ a, n }: { a: Article; n?: number }) => {
    const ab = abierto === a.title;
    return (
      <article id={`art-${a.title}`} className={`help-card ${ab ? 'open' : ''}`}>
        <button
          type="button"
          className="help-card-head"
          aria-expanded={ab}
          onClick={() => setAbierto(ab ? null : a.title)}
        >
          {n !== undefined && <span className="help-card-n">{n}</span>}
          <span className="help-card-txt">
            <strong>{a.title}</strong>
            {RESUMEN[a.title] && <span className="help-card-sub">{RESUMEN[a.title]}</span>}
          </span>
          <span className="help-card-meta">
            <span className="help-card-min">{minutos(a.body)} min</span>
            <span className="help-card-chev" aria-hidden>
              {ab ? '▴' : '▾'}
            </span>
          </span>
        </button>
        {ab && <div className="help-body">{a.body}</div>}
      </article>
    );
  };

  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Centro de ayuda</h2>
        <p className="reg-intro">
          No hace falta leerlo entero. Dinos qué necesitas ahora y te llevamos directo, o busca por
          palabra: la búsqueda mira en todo a la vez.
        </p>
      </div>

      <input
        className="help-search help-search-big"
        placeholder="Buscar en toda la ayuda: expectancy, calibración, snapshot, drawdown…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {busca ? (
        <div className="help-results">
          {resultados.length === 0 && glosBusca.length === 0 ? (
            <p className="muted">
              Nada coincide con «{q}». Prueba con una palabra más corta, o mira el glosario.
            </p>
          ) : (
            <>
              {resultados.map(([grupo, arts]) => (
                <div key={grupo} className="help-group">
                  <h3 className="help-group-h">
                    {grupo} <span className="muted">· {arts.length}</span>
                  </h3>
                  {arts.map((a) => (
                    <Tarjeta key={a.title} a={a} />
                  ))}
                </div>
              ))}
              {glosBusca.length > 0 && (
                <div className="help-group">
                  <h3 className="help-group-h">
                    Glosario <span className="muted">· {glosBusca.length}</span>
                  </h3>
                  {glosBusca.map(([t, nivel, d]) => (
                    <p key={t} className="help-glos-hit">
                      <strong>{t}</strong> <span className="help-nivel">{nivel}</span>
                      <span className="muted"> — {d}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="help-nav">
            {(
              [
                ['inicio', 'Empezar aquí'],
                ['manual', 'Cómo se hace'],
                ['kb', 'Cómo funciona'],
                ['faq', 'Dudas frecuentes'],
                ['glosario', 'Glosario'],
              ] as Array<[Section, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={sec === k ? 'help-tab active' : 'help-tab'}
                onClick={() => setSec(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {sec === 'inicio' && (
            <div className="help-home">
              <div className="help-rutas">
                {RUTAS.map((r) => (
                  <button
                    key={r.titulo}
                    type="button"
                    className="help-ruta"
                    onClick={() => irA(r.sec, r.art)}
                  >
                    <span className="help-ruta-ico" aria-hidden>
                      {r.icono}
                    </span>
                    <strong>{r.titulo}</strong>
                    <span className="muted">{r.sub}</span>
                    <span className="help-ruta-go">Ir →</span>
                  </button>
                ))}
              </div>

              <div className="help-recorrido">
                <h3 className="help-group-h">Si es tu primer día, este es el recorrido</h3>
                <ol className="help-pasos">
                  <li>
                    <button type="button" onClick={() => irA('manual', MANUAL[0]!.title)}>
                      Leer una decisión en el Panel
                    </button>
                    <span className="muted">Entender qué te está diciendo la pantalla principal.</span>
                  </li>
                  <li>
                    <button type="button" onClick={() => irA('manual', MANUAL[1]!.title)}>
                      Guardar un registro y seguirlo
                    </button>
                    <span className="muted">Congelar una decisión para comprobar después si acertó.</span>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => irA('kb', 'Por qué perder más veces de las que se gana puede ser bueno')}
                    >
                      Entender por qué hay más stops que objetivos
                    </button>
                    <span className="muted">La cuenta que evita el susto inicial.</span>
                  </li>
                  <li>
                    <button type="button" onClick={() => irA('kb', 'Cómo se lee el informe de un backtest')}>
                      Leer un backtest sin engañarte
                    </button>
                    <span className="muted">En qué orden mirar las métricas y cuándo desconfiar.</span>
                  </li>
                </ol>
              </div>

              <p className="muted help-home-foot">
                ¿Prefieres explorar por tu cuenta? <strong>Cómo se hace</strong> son tareas paso a
                paso, <strong>Cómo funciona</strong> explica la maquinaria por dentro, y el{' '}
                <strong>Glosario</strong> traduce cualquier término que te encuentres.
              </p>
            </div>
          )}

          {sec === 'glosario' && (
            <div className="snap-scroll">
              <table className="snap-table help-glos">
                <thead>
                  <tr>
                    <th>Término</th>
                    <th>Nivel</th>
                    <th>Qué es y cómo lo aprovechamos</th>
                  </tr>
                </thead>
                <tbody>
                  {GLOSARIO.map(([term, level, def]) => (
                    <tr key={term}>
                      <td>
                        <strong>{term}</strong>
                      </td>
                      <td>
                        <span className="help-nivel">{level}</span>
                      </td>
                      <td className="muted help-def">{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sec !== 'inicio' && sec !== 'glosario' && (
            <div className="help-articles">
              {porSeccion[sec].map((a, i) => (
                <Tarjeta key={a.title} a={a} n={sec === 'manual' ? i + 1 : undefined} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="muted calib-legend">
        Apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad; el
        rendimiento pasado no asegura resultados futuros.
      </p>
    </section>
  );
}
