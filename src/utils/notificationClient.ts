import config from '../config';
import Logger from './logger';

export type NotificationChannel = 'whatsapp' | 'email';

export interface NotificationPayload {
  to: string;
  channel: NotificationChannel;
  subject?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationSendResult {
  success: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

export class NotificationApiClient {
  private logger: Logger;

  constructor(private tenantId?: string) {
    this.logger = new Logger({
      service: 'NotificationApiClient',
      tenantId: this.tenantId,
    });
  }

  private resolveToken(channel: NotificationChannel): string | undefined {
    if (channel === 'email') return config.notification.tokenPax || config.notification.tokenLider;
    return config.notification.tokenLider || config.notification.tokenPax;
  }

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    const token = this.resolveToken(payload.channel);

    if (!token) {
      this.logger.warn('Skipping notification: missing provider token', {
        channel: payload.channel,
      });
      return { success: false, skipped: true, error: 'Missing provider token' };
    }

    const base = config.notification.baseUrl.replace(/\/$/, '');
    const path =
      payload.channel === 'email'
        ? '/notifications/email'
        : payload.channel === 'whatsapp'
          ? '/notifications/whatsapp'
          : '/notifications';
    const url = `${base}${path}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseText = await response.text();
        this.logger.error('Notification API returned an error', {
          status: response.status,
          body: responseText,
        });
        return {
          success: false,
          status: response.status,
          error: responseText || 'Notification API error',
        };
      }

      return { success: true, status: response.status };
    } catch (error: any) {
      this.logger.error('Failed to call notification provider', error);
      return { success: false, error: error?.message ?? 'Unexpected error' };
    }
  }
}
