import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('mad_promotion_codes')
export class PromotionCode {
  @PrimaryGeneratedColumn('uuid', { name: 'promo_id' })
  promoId!: string;

  @Column({ name: 'code_string', type: 'varchar', length: 50, unique: true })
  codeString!: string;

  @Column({
    name: 'discount_type',
    type: 'enum',
    enum: ['PERCENTAGE', 'FIXED_AMOUNT'],
  })
  discountType!: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @Column({ name: 'discount_value', type: 'int' })
  discountValue!: number;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil!: Date;

  @Column({
    name: 'applicable_room_types',
    type: 'uuid',
    array: true,
    nullable: true,
  })
  applicableRoomTypes!: string[] | null;

  @Column({ name: 'max_redemptions', type: 'int', default: 100 })
  maxRedemptions!: number;

  @Column({ name: 'current_redemptions', type: 'int', default: 0 })
  currentRedemptions!: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE',
  })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
