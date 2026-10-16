import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ComplaintsController } from './complaints.controller';
import { COMPLAINT_CLOCK, ComplaintsService } from './complaints.service';

@Module({
  imports: [AuthModule],
  controllers: [ComplaintsController],
  providers: [
    ComplaintsService,
    { provide: COMPLAINT_CLOCK, useValue: () => new Date() },
  ],
})
export class ComplaintsModule {}
