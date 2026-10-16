import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffController } from './staff.controller';
import { StaffProfilesService } from './staff-profiles.service';
import { StaffService } from './staff.service';
import { CredentialCipher } from './credential-cipher';
import { SendGridService } from './sendgrid.service';
import { StaffDeliveryWorker } from './staff-delivery.worker';

@Module({
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [
    StaffService,
    StaffProfilesService,
    CredentialCipher,
    SendGridService,
    StaffDeliveryWorker,
  ],
})
export class StaffModule {}
