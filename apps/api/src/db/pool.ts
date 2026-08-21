import pg from 'pg';

/**
 * Pool de conexiones a Postgres, con la red de seguridad que `pg` no pone por ti.
 *
 * `pg.Pool` emite un evento `error` cuando el servidor cierra una conexión **inactiva**: un
 * reinicio de la base, un `pg_terminate_backend`, mantenimiento, o simplemente apagar el
 * contenedor. Node trata un `error` sin listener como excepción no capturada y **mata el proceso**.
 *
 * Eso ocurrió el 20 de agosto de 2026: al pararse Postgres, la api registró
 * `terminating connection due to administrator command`, seguido de `Unhandled 'error' event`, y se
 * cayó con código 1. No es que perdiera la conexión y reintentara — es que se murió por un error en
 * una conexión que ya nadie estaba usando.
 *
 * Con el listener, el pool descarta el cliente roto y sigue vivo: la siguiente consulta abre una
 * conexión nueva. Es la diferencia entre una base que se reinicia y una plataforma que se cae.
 */
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  pool.on('error', (err: Error) => {
    // Se registra y se sigue. No hay nada que reparar aquí: el cliente afectado estaba ocioso y el
    // pool ya lo ha descartado. Silenciarlo del todo escondería una base que se reinicia sola.
    console.error(`[db] conexión inactiva perdida (el pool sigue vivo): ${err.message}`);
  });
  return pool;
}
