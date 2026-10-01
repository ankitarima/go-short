import type { Logger } from 'pino';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Default provider: logs instead of sending. In non-production the body is logged so reset/invite
 * links can be copied; in production only metadata is logged (bodies contain single-use tokens)
 * and a warning tells the operator no real provider is configured.
 */
export class ConsoleEmailProvider implements EmailProvider {
  constructor(
    private readonly logger: Logger,
    private readonly isProd: boolean,
  ) {}
  async send(m: EmailMessage): Promise<void> {
    if (this.isProd)
      this.logger.warn({ subject: m.subject }, 'Email not sent: no EmailProvider configured');
    else
      this.logger.info({ to: m.to, subject: m.subject, text: m.text }, 'email (console provider)');
  }
}
