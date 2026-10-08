import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StaffCredentials } from './credential-cipher';

@Injectable()
export class SendGridService {
  constructor(private readonly config: ConfigService) {}
  async send(credentials: StaffCredentials): Promise<void> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization:
          'Bearer ' + this.config.getOrThrow<string>('SENDGRID_API_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: credentials.email }] }],
        from: { email: this.config.getOrThrow<string>('SENDGRID_FROM_EMAIL') },
        subject: 'Your Forever Hotel staff account',
        content: [
          {
            type: 'text/plain',
            value: `Your ${credentials.role} account is ready.\nUsername: ${credentials.username}\nTemporary password: ${credentials.password}\nSign in to your staff system and change this password before accessing protected features.`,
          },
        ],
        tracking_settings: {
          click_tracking: { enable: false, enable_text: false },
          open_tracking: { enable: false },
        },
      }),
    });
    // Never retain/log provider response bodies: they can echo submitted data.
    await response.body?.cancel();
    if (response.status !== 202)
      throw new Error('Email provider did not accept the message');
  }
}
