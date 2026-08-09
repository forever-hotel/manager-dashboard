import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('staff_users')
export class StaffUser {
  @PrimaryGeneratedColumn('uuid', { name: 'worker_id' })
  workerId!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName!: string;

  @Column({ name: 'vocation', type: 'varchar', length: 100 })
  vocation!: string;

  @Column({ name: 'email', type: 'varchar', length: 320, unique: true })
  email!: string;

  @Column({ name: 'phone', type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ name: 'age', type: 'int', nullable: true })
  age!: number | null;

  @Column({ name: 'nic', type: 'varchar', length: 50, nullable: true })
  nic!: string | null;

  @Column({ name: 'username', type: 'varchar', length: 100, unique: true })
  username!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: [
      'MANAGER',
      'RECEPTIONIST',
      'WORKER',
      'KITCHEN_STAFF',
      'KITCHEN_MANAGER',
    ],
  })
  role!:
    | 'MANAGER'
    | 'RECEPTIONIST'
    | 'WORKER'
    | 'KITCHEN_STAFF'
    | 'KITCHEN_MANAGER';

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
