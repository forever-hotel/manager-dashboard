import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffUser } from '../entities/staff-user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StaffUser])],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
