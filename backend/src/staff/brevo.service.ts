import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StaffCredentials } from './credential-cipher';
import { staffAccountEmail } from './staff-account-email';

@Injectable()
export class BrevoService {
  constructor(private readonly config: ConfigService) {}

  async send(credentials: StaffCredentials): Promise<void> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'api-key': this.config.getOrThrow<string>('BREVO_API_KEY'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: [{ email: credentials.email }],
        sender: { email: this.config.getOrThrow<string>('STAFF_EMAIL_FROM') },
        ...staffAccountEmail(credentials)
      })
    });
    // Never retain/log provider response bodies: they can echo submitted data.
    await response.body?.cancel();
    if (response.status !== 201) throw new Error('Email provider did not accept the message');
  }
}
