import { useState } from 'react';

type Section = 'manual' | 'kb' | 'faq' | 'glosario';

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

export function HelpView() {
  const [sec, setSec] = useState<Section>('manual');
  const [q, setQ] = useState('');

  const list = sec === 'manual' ? MANUAL : sec === 'kb' ? KB : sec === 'faq' ? FAQ : [];
  const filtered = q
    ? list.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()))
    : list;
  const glos = q
    ? GLOSARIO.filter(([t, , d]) => (t + d).toLowerCase().includes(q.toLowerCase()))
    : GLOSARIO;

  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Centro de ayuda</h2>
        <p className="reg-intro">
          Todo lo que necesitas saber para usar TradeMe y entender cómo piensa: desde cómo guardar un
          registro hasta qué significa cada término técnico.
        </p>
      </div>

      <div className="help-nav">
        {(
          [
            ['manual', '📘 Manual de usuario'],
            ['kb', '🧩 Base de conocimientos'],
            ['faq', '❓ Preguntas frecuentes'],
            ['glosario', '📖 Glosario'],
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
        <input
          className="help-search"
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {sec === 'glosario' ? (
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
              {glos.map(([term, level, def]) => (
                <tr key={term}>
                  <td>
                    <strong>{term}</strong>
                  </td>
                  <td className="muted">{level}</td>
                  <td className="muted help-def">{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="help-articles">
          {filtered.length === 0 ? (
            <p className="muted">Nada coincide con «{q}».</p>
          ) : (
            filtered.map((a, i) => (
              <details key={a.title} className="bt-acc" open={sec === 'manual' && i === 0}>
                <summary>{a.title}</summary>
                <div className="bt-acc-body help-body">{a.body}</div>
              </details>
            ))
          )}
        </div>
      )}

      <p className="muted calib-legend">
        Apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad; el
        rendimiento pasado no asegura resultados futuros.
      </p>
    </section>
  );
}
