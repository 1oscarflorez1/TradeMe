import { useEffect, useMemo, useState } from 'react';
import { fetchReleases, type ReleasesResponse } from './api';
import { categoriaDe, filtra, formatea, recuento, titularDe } from './news';

/**
 * Novedades: el historial de versiones, leído del CHANGELOG.
 *
 * Hasta la 0.34.0 esta pestaña era una **segunda copia** del registro de cambios, escrita a mano
 * aquí mismo: un array de 27 entradas cuya última era la 0.28.0 mientras la plataforma ejecutaba la
 * 0.34.0. Seis versiones que el equipo no podía ver, y que había que recordar añadir en cada
 * entrega. Un ritual que depende de acordarse no es un proceso.
 *
 * Ahora los datos vienen de `GET /releases`, que interpreta `CHANGELOG.md`. Esta vista ya no puede
 * desviarse de la realidad porque no tiene nada propio que desviar, y CI falla si la versión del
 * paquete no coincide con la primera entrada del registro.
 */

/** Convierte **negrita** y `código` sin meter una librería de markdown por tan poco. */
function Texto({ children }: { children: string }) {
  const partes = children.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {partes.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
          return <code key={i}>{p.slice(1, -1)}</code>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function NewsView() {
  const [datos, setDatos] = useState<ReleasesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let vivo = true;
    fetchReleases()
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        setAbierta(d.releases[0]?.version ?? null);
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      vivo = false;
    };
  }, []);

  const releases = datos?.releases ?? [];
  const lista = useMemo(() => filtra(releases, q), [q, releases]);

  if (error) {
    return (
      <section className="panel registros">
        <div className="reg-head">
          <h2>Novedades</h2>
          <p className="reg-intro">
            No se pudo leer el historial de versiones: <strong>{error}</strong>. El historial lo
            sirve la API desde el registro de cambios; si la API no responde, esta pestaña se queda
            sin datos. No hay ninguna copia local que mostrar, y es a propósito.
          </p>
        </div>
      </section>
    );
  }

  if (!datos) {
    return (
      <section className="panel registros">
        <div className="reg-head">
          <h2>Novedades</h2>
          <p className="reg-intro muted">Cargando el historial…</p>
        </div>
      </section>
    );
  }

  const primera = formatea(releases[releases.length - 1]?.fecha ?? null);
  const ultima = formatea(releases[0]?.fecha ?? null);
  const alDia = releases[0]?.version === datos.actual;

  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Novedades</h2>
        <p className="reg-intro">
          Todo lo que ha cambiado, de lo más reciente a lo más antiguo. Se lee directamente del
          registro de cambios del repositorio, así que no puede quedarse atrás respecto a lo que la
          plataforma hace de verdad.
        </p>
      </div>

      <div className="reg-summary">
        <span className="reg-chip">
          Versiones <strong>{datos.total}</strong>
        </span>
        <span className="reg-chip" title={`Primera versión: ${primera.largo}`}>
          Desde <strong>{primera.dia}</strong>
        </span>
        <span className="reg-chip" title={`Última versión: ${ultima.largo}`}>
          Última <strong>{ultima.dia}</strong>
        </span>
        <span
          className="reg-chip"
          title={
            alDia
              ? 'Estás viendo la versión que la plataforma está ejecutando ahora mismo.'
              : `La plataforma ejecuta la ${datos.actual}, que no es la primera del registro. Falta desplegar, o falta anotar la versión en el registro de cambios.`
          }
        >
          {alDia ? '✓ ' : '⚠ '}En ejecución <strong>v{datos.actual}</strong>
        </span>
      </div>

      <input
        className="help-search help-search-big"
        placeholder="Buscar en el historial: calibración, snapshots, seguridad, proveedores…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {lista.length === 0 ? (
        <p className="muted">Nada coincide con «{q}».</p>
      ) : (
        <ol className="nv-linea">
          {lista.map((r) => {
            const f = formatea(r.fecha);
            const ab = abierta === r.version;
            const esActual = r.version === datos.actual;
            return (
              <li key={r.version} className={`nv-item ${ab ? 'open' : ''}`}>
                <span className="nv-punto" aria-hidden />
                <button
                  type="button"
                  className="nv-head"
                  aria-expanded={ab}
                  onClick={() => setAbierta(ab ? null : r.version)}
                >
                  <span className="nv-ver">
                    v{r.version}
                    {esActual && <span className="nv-hito">en ejecución</span>}
                  </span>
                  <span className="nv-txt">
                    <strong>{titularDe(r)}</strong>
                    <span className="nv-res">
                      {recuento(r).apartados === 1 ? '1 apartado' : `${recuento(r).apartados} apartados`}
                      {' · '}
                      {recuento(r).cambios} cambios
                    </span>
                  </span>
                  <span className="nv-fecha" title={f.largo}>
                    <span>{f.dia}</span>
                  </span>
                  <span className="nv-chev" aria-hidden>
                    {ab ? '▴' : '▾'}
                  </span>
                </button>

                {ab && (
                  <div className="nv-cuerpo">
                    {r.nota && (
                      <p className="nv-nota">
                        <Texto>{r.nota}</Texto>
                      </p>
                    )}
                    {r.secciones.map((s, i) => {
                      const cat = categoriaDe(s.categoria);
                      return (
                        <div className={`nv-bloque ${cat.clase}`} key={i}>
                          <span className="nv-bloque-h">
                            {cat.etiqueta}
                            {s.titulo && <> — {s.titulo}</>}
                          </span>
                          <ul>
                            {s.puntos.map((x, j) => (
                              <li key={j}>
                                <Texto>{x}</Texto>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="muted calib-legend">
        Las fechas son las del cambio real en el repositorio. Esta pestaña y el asistente leen el
        mismo registro de cambios, así que no pueden contradecirse.
      </p>
    </section>
  );
}
