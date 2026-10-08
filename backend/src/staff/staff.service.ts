import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { DataSource } from 'typeorm';
import { CreateStaffDto } from './create-staff.dto';
import { CredentialCipher } from './credential-cipher';

@Injectable()
export class StaffService {
  constructor(
    private readonly database: DataSource,
    private readonly cipher: CredentialCipher,
  ) {}
  async create(profile: CreateStaffDto) {
    try {
      const staffId = randomUUID();
      const deliveryId = randomUUID();
      const password = randomBytes(24).toString('base64url');
      // Enforce key availability before database writes and expensive hashing.
      const username = 'staff_' + randomUUID().replace(/-/g, '');
      const payload = this.cipher.encrypt(deliveryId, {
        email: profile.email,
        username,
        password,
        role: profile.role,
      });
      const passwordHash = await hash(password, 12);
      await this.database.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO public.staff_users
            (worker_id,full_name,vocation,email,age,phone,nic,username,password_hash,role,is_active,password_change_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)`,
          [
            staffId,
            profile.name,
            profile.vocation,
            profile.email,
            profile.age,
            profile.phone,
            profile.nic,
            username,
            passwordHash,
            profile.role,
          ],
        );
        await manager.query(
          `INSERT INTO public.mad_staff_deliveries(delivery_id,worker_id,encrypted_credentials) VALUES ($1,$2,$3)`,
          [deliveryId, staffId, payload],
        );
      });
      return { staffId, deliveryId, deliveryStatus: 'pending' as const };
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (
        (error as { driverError?: { code?: string }; code?: string })
          ?.driverError?.code === '23505' ||
        (error as { code?: string })?.code === '23505'
      )
        throw new ConflictException(
          'A staff account with this email or generated username already exists.',
        );
      throw new ServiceUnavailableException();
    }
  }
}
