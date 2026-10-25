import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { DataSource } from 'typeorm';
import { CreateStaffDto, STAFF_ROLES } from './create-staff.dto';
import { CredentialCipher } from './credential-cipher';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);
  constructor(
    private readonly database: DataSource,
    private readonly cipher: CredentialCipher
  ) {}
  async resetPassword(staffId: string, actorId: string, expectedVersion?: number) {
    try {
      const result = await this.database.transaction(async manager => {
        const accounts = await manager.query<
          {
            username: string;
            email: string;
            role: (typeof STAFF_ROLES)[number];
            is_active: boolean;
            session_version: number;
          }[]
        >(
          'SELECT username,email,role,is_active,session_version FROM public.staff_users WHERE worker_id=$1 FOR UPDATE',
          [staffId]
        );
        const account = accounts[0];
        if (!account || !STAFF_ROLES.includes(account.role)) throw new NotFoundException('Staff account not found.');
        if (expectedVersion !== undefined && account.session_version !== expectedVersion)
          throw new ConflictException('The staff account changed. Reload before resetting.');
        if (!account.is_active) throw new ConflictException('Inactive staff accounts cannot be reset.');
        const deliveryId = randomUUID();
        const password = randomBytes(24).toString('base64url');
        const payload = this.cipher.encrypt(deliveryId, {
          email: account.email,
          username: account.username,
          role: account.role,
          password
        });
        const passwordHash = await hash(password, 12);
        const version = account.session_version + 1;
        await manager.query(
          `UPDATE public.staff_users SET password_hash=$2,password_change_required=true,
           session_version=$3,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE worker_id=$1`,
          [staffId, passwordHash, version]
        );
        // The existing queue allows one row per account. Replace its identity so
        // completion of an older in-flight delivery cannot overwrite this reset.
        await manager.query(
          `INSERT INTO public.mad_staff_deliveries
           (delivery_id,worker_id,encrypted_credentials,credential_version) VALUES ($1,$2,$3,$4)
           ON CONFLICT (worker_id) DO UPDATE SET delivery_id=EXCLUDED.delivery_id,
           encrypted_credentials=EXCLUDED.encrypted_credentials,credential_version=EXCLUDED.credential_version,
           status='pending',attempts=0,next_attempt_at=now(),lease_until=NULL,lease_token=NULL,
           last_error_code=NULL,created_at=now(),updated_at=now(),sent_at=NULL`,
          [deliveryId, staffId, payload, version]
        );
        return { staffId, deliveryId, deliveryStatus: 'pending' as const };
      });
      this.logger.log({
        event: 'staff.password_reset',
        actorId,
        staffId,
        outcome: 'queued'
      });
      return result;
    } catch (error: unknown) {
      this.logger.warn({
        event: 'staff.password_reset',
        actorId,
        staffId,
        outcome: error instanceof HttpException ? error.getStatus() : 503
      });
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    }
  }
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
        role: profile.role
      });
      const passwordHash = await hash(password, 12);
      await this.database.transaction(async manager => {
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
            profile.role
          ]
        );
        await manager.query(
          `INSERT INTO public.mad_staff_deliveries(delivery_id,worker_id,encrypted_credentials) VALUES ($1,$2,$3)`,
          [deliveryId, staffId, payload]
        );
      });
      return { staffId, deliveryId, deliveryStatus: 'pending' as const };
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (
        (error as { driverError?: { code?: string }; code?: string })?.driverError?.code === '23505' ||
        (error as { code?: string })?.code === '23505'
      )
        throw new ConflictException('A staff account with this email or generated username already exists.');
      throw new ServiceUnavailableException();
    }
  }
}
