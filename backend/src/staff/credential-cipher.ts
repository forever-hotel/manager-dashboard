import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface StaffCredentials {
  email: string;
  username: string;
  password: string;
  role: string;
}

@Injectable()
export class CredentialCipher {
  constructor(private readonly config: ConfigService) {}
  private key() {
    const encoded = this.config.get<string>('STAFF_CREDENTIALS_KEY');
    if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
      throw new ServiceUnavailableException();
    return Buffer.from(encoded, 'base64');
  }
  encrypt(id: string, credentials: StaffCredentials): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    return [nonce, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64'))
      .join('.');
  }
  decrypt(id: string, payload: string): StaffCredentials {
    const [nonce, tag, body] = payload
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8'),
    ) as StaffCredentials;
  }
}
