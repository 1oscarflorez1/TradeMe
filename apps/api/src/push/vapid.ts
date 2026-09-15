import webpush from 'web-push';
import { esProduccion, type Env } from '../config.js';

/** De dónde salieron las claves con las que firma el push. */
export type OrigenVapid = 'entorno' | 'efimeras' | 'ninguna';

export interface ClavesVapid {
  publicKey: string;
  privateKey: string;
  subject: string;
  origen: OrigenVapid;
  /** Lo que se registra al arrancar. Nunca incluye las claves. */
  nivel: 'info' | 'warn';
  mensaje: string;
}

type Generador = () => { publicKey: string; privateKey: string };

/**
 * Las claves VAPID salen del entorno, nunca del código.
 *
 * Hasta 0.75.0 `config.ts` traía un par por defecto, con la privada publicada en el repositorio:
 * cualquier despliegue sin las variables firmaba con una clave que conoce todo el que lea el código.
 *
 * - Con las dos variables definidas se usan tal cual, en cualquier entorno.
 * - En producción (`NODE_ENV=production`, que fija `docker-compose.prod.yml`) no hay reserva: si
 *   faltan, el push queda desactivado y se avisa. Los avisos en la app siguen funcionando.
 * - En desarrollo y tests, si faltan las dos, se genera un par al arrancar. El push funciona, pero
 *   las suscripciones hechas con el par anterior dejan de valer en cada reinicio.
 * - Con solo una de las dos es un error de configuración en cualquier entorno: una clave generada
 *   no casaría con la que sí está.
 */
export function resolverClavesVapid(
  env: Pick<Env, 'NODE_ENV' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>,
  generar: Generador = () => webpush.generateVAPIDKeys(),
): ClavesVapid {
  const publicKey = env.VAPID_PUBLIC_KEY.trim();
  const privateKey = env.VAPID_PRIVATE_KEY.trim();
  const subject = env.VAPID_SUBJECT;

  if (publicKey && privateKey) {
    return {
      publicKey,
      privateKey,
      subject,
      origen: 'entorno',
      nivel: 'info',
      mensaje: 'push: claves VAPID tomadas de las variables de entorno',
    };
  }
  const sinPush = { publicKey: '', privateKey: '', subject, origen: 'ninguna' as const };
  if (publicKey || privateKey) {
    const falta = publicKey ? 'VAPID_PRIVATE_KEY' : 'VAPID_PUBLIC_KEY';
    return {
      ...sinPush,
      nivel: 'warn',
      mensaje: `push desactivado: falta ${falta} (hacen falta las dos claves VAPID, del mismo par)`,
    };
  }
  if (esProduccion(env)) {
    return {
      ...sinPush,
      nivel: 'warn',
      mensaje:
        'push desactivado: producción sin VAPID_PUBLIC_KEY ni VAPID_PRIVATE_KEY (solo avisos en la ' +
        'app). Genéralas con npx web-push generate-vapid-keys y ponlas en infra/.env.prod',
    };
  }
  return {
    ...generar(),
    subject,
    origen: 'efimeras',
    nivel: 'info',
    mensaje: 'push: claves VAPID efímeras de desarrollo, se regeneran en cada arranque',
  };
}
