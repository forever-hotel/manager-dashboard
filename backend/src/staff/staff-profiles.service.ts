import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { STAFF_ROLES } from './create-staff.dto';
import { CredentialCipher } from './credential-cipher';
import { UpdateStaffDto } from './update-staff.dto';

export interface StaffProfile {
  staffId: string;
  name: string;
  vocation: string;
  email: string;
  age: number | null;
  phone: string | null;
  nic: string | null;
  username: string;
  role: (typeof STAFF_ROLES)[number];
  isActive: boolean;
  passwordChangeRequired: boolean;
  version: number;
}
const columns = `worker_id AS "staffId",full_name AS name,vocation,email,age,phone,nic,username,role,
  is_active AS "isActive",password_change_required AS "passwordChangeRequired",session_version AS version`;
const mutable = ['name', 'vocation', 'email', 'age', 'phone', 'nic', 'role', 'isActive'] as const;

@Injectable()
export class StaffProfilesService {
  private readonly logger = new Logger(StaffProfilesService.name);
  constructor(
    private readonly database: DataSource,
    private readonly cipher: CredentialCipher
  ) {}

  private requireStaff(profile: StaffProfile | undefined): StaffProfile {
    if (!profile || !STAFF_ROLES.includes(profile.role)) throw new NotFoundException('Staff account not found.');
    return profile;
  }
  private fail(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const storage = error as {
      code?: string;
      driverError?: { code?: string };
    } | null;
    if (storage?.code === '23505' || storage?.driverError?.code === '23505')
      throw new ConflictException('A staff account with these unique details already exists.');
    throw new ServiceUnavailableException();
  }
  async get(staffId: string) {
    try {
      const rows = await this.database.query<StaffProfile[]>(
        `SELECT ${columns} FROM public.staff_users WHERE worker_id=$1`,
        [staffId]
      );
      return this.requireStaff(rows[0]);
    } catch (error: unknown) {
      this.fail(error);
    }
  }
  async update(staffId: string, actorId: string, patch: UpdateStaffDto) {
    const fields = mutable.filter(field => patch[field] !== undefined);
    try {
      if (!fields.length) throw new BadRequestException('Supply at least one mutable profile field.');
      const result = await this.database.transaction(async manager => {
        const rows = await manager.query<StaffProfile[]>(
          `SELECT ${columns} FROM public.staff_users WHERE worker_id=$1 FOR UPDATE`,
          [staffId]
        );
        const current = this.requireStaff(rows[0]);
        if (current.version !== patch.version)
          throw new ConflictException('The staff account changed. Reload it before editing.');
        const next = { ...current, version: current.version + 1 };
        for (const field of fields) Object.assign(next, { [field]: patch[field] });
        // PostgreSQL UPDATE returns [rows, affectedCount], unlike SELECT.
        const [saved] = await manager.query<[StaffProfile[], number]>(
          `UPDATE public.staff_users SET full_name=$2,vocation=$3,email=$4,age=$5,phone=$6,nic=$7,
           role=$8,is_active=$9,session_version=$10,updated_at=now() WHERE worker_id=$1 RETURNING ${columns}`,
          [
            staffId,
            next.name,
            next.vocation,
            next.email,
            next.age,
            next.phone,
            next.nic,
            next.role,
            next.isActive,
            next.version
          ]
        );
        const profile = this.requireStaff(saved[0]);
        await this.reconcileDelivery(manager, current, profile);
        return profile;
      });
      this.logger.log({
        event: 'staff.profile_updated',
        actorId,
        staffId,
        fields,
        version: result.version,
        outcome: 'saved'
      });
      return result;
    } catch (error: unknown) {
      this.logger.warn({
        event: 'staff.profile_updated',
        actorId,
        staffId,
        fields,
        outcome: error instanceof HttpException ? error.getStatus() : 'storage_failure'
      });
      this.fail(error);
    }
  }
  private async reconcileDelivery(manager: EntityManager, before: StaffProfile, after: StaffProfile) {
    const rows = await manager.query<
      {
        delivery_id: string;
        encrypted_credentials: string;
        credential_version: number;
      }[]
    >(
      `SELECT delivery_id,encrypted_credentials,credential_version FROM public.mad_staff_deliveries
      WHERE worker_id=$1 AND status IN ('pending','failed') FOR UPDATE`,
      [before.staffId]
    );
    const delivery = rows[0];
    if (!delivery) return;
    if (!after.isActive || !after.passwordChangeRequired || delivery.credential_version !== before.version) {
      await manager.query(
        `UPDATE public.mad_staff_deliveries SET status='cancelled',encrypted_credentials=NULL,
        lease_token=NULL,lease_until=NULL,last_error_code=NULL,updated_at=now() WHERE delivery_id=$1`,
        [delivery.delivery_id]
      );
      return;
    }
    // Preserve the password, but bind delivery to the current profile/version and
    // a fresh identity. Completion of an old worker lease cannot mutate this row.
    const credentials = this.cipher.decrypt(delivery.delivery_id, delivery.encrypted_credentials);
    const id = randomUUID();
    const encrypted = this.cipher.encrypt(id, {
      ...credentials,
      email: after.email,
      role: after.role,
      username: after.username
    });
    await manager.query(
      `UPDATE public.mad_staff_deliveries SET delivery_id=$2,encrypted_credentials=$3,
      credential_version=$4,status='pending',attempts=0,next_attempt_at=now(),lease_token=NULL,
      lease_until=NULL,last_error_code=NULL,sent_at=NULL,updated_at=now() WHERE delivery_id=$1`,
      [delivery.delivery_id, id, encrypted, after.version]
    );
  }
}
