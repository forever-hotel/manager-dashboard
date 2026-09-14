import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { StaffUser } from '../entities/staff-user.entity';
import { CreateStaffDto } from './dto/create-staff.dto';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @InjectRepository(StaffUser)
    private readonly staffRepo: Repository<StaffUser>,
  ) {}

  /**
   * MAD-012 — Create Staff Account
   * Auto-generates username (vocation-prefix + random 4 digits)
   * and a 12-char temporary password (returned plaintext once, then hashed).
   */
  async create(dto: CreateStaffDto) {
    // 1. Generate username: first 6 chars of vocation (lowercase, no spaces) + '-' + 4 random digits
    const prefix = dto.vocation
      .toLowerCase()
      .replace(/\s+/g, '')
      .slice(0, 6);
    const username = await this.generateUniqueUsername(prefix);

    // 2. Generate temporary password (12 chars)
    const tempPassword = this.generateTempPassword();

    // 3. Hash the password
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // 4. Persist
    const staff = this.staffRepo.create({
      fullName: dto.fullName,
      vocation: dto.vocation,
      email: dto.email,
      phone: dto.phone ?? null,
      age: dto.age ?? null,
      nic: dto.nic ?? null,
      username,
      passwordHash,
      role: dto.role,
      isActive: true,
    });

    try {
      const saved = await this.staffRepo.save(staff);
      this.logger.log(`Created staff account: ${saved.username} (${saved.role})`);

      return {
        workerId: saved.workerId,
        fullName: saved.fullName,
        email: saved.email,
        username: saved.username,
        role: saved.role,
        vocation: saved.vocation,
        isActive: saved.isActive,
        createdAt: saved.createdAt,
        // Temporary password exposed ONCE — must be changed on first login
        tempPassword,
      };
    } catch (error: unknown) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        // Unique constraint (email or username already exists)
        throw new ConflictException(
          'A staff member with this email already exists.',
        );
      }
      this.logger.error('Failed to create staff account', error);
      throw new InternalServerErrorException('Failed to create staff account.');
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async generateUniqueUsername(prefix: string): Promise<string> {
    // Try up to 10 times to find an unused username
    for (let attempt = 0; attempt < 10; attempt++) {
      const digits = Math.floor(1000 + Math.random() * 9000).toString();
      const candidate = `${prefix}-${digits}`;
      const existing = await this.staffRepo.findOne({
        where: { username: candidate },
      });
      if (!existing) return candidate;
    }
    throw new InternalServerErrorException(
      'Could not generate a unique username. Please try again.',
    );
  }

  private generateTempPassword(length = 12): string {
    const charset =
      'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    return password;
  }
}
