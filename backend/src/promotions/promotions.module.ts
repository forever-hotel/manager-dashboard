import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotionsController } from './promotions.controller';
import { PROMOTION_CLOCK, PromotionsService } from './promotions.service';

@Module({
  imports: [AuthModule],
  controllers: [PromotionsController],
  providers: [
    PromotionsService,
    { provide: PROMOTION_CLOCK, useValue: () => new Date() },
  ],
})
export class PromotionsModule {}
