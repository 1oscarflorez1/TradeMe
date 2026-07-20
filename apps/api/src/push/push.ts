import webpush from 'web-push';

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

/** Envío de Web Push (VAPID). Devuelve false si la suscripción está muerta (410/404). */
export class Pusher {
  private ready = false;

  constructor(publicKey: string, privateKey: string, subject: string) {
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.ready = true;
    }
  }

  get enabled(): boolean {
    return this.ready;
  }

  async send(sub: PushSub, payload: PushPayload): Promise<boolean> {
    if (!this.ready) return true;
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      return true;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      return !(code === 410 || code === 404);
    }
  }
}
