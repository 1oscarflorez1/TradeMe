import { useState } from 'react';
import {
  FAQ,
  GLOSARIO,
  KB,
  KB_EXTRA,
  MANUAL,
  RESUMEN,
  RUTAS,
  type Article,
  type Section,
} from './help/contenido';

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
