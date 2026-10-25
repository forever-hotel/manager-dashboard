import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotionsController } from './promotions.controller';
import { PROMOTION_CLOCK, PromotionsService } from './promotions.service';
import { PromotionBroker } from './promotion-broker';
import { PromotionPublicationWorker } from './promotion-publication.worker';

@Module({
  imports: [AuthModule],
  controllers: [PromotionsController],
  providers: [
    PromotionBroker,
    PromotionPublicationWorker,
    PromotionsService,
    { provide: PROMOTION_CLOCK, useValue: () => new Date() }
  ]
})
export class PromotionsModule {}
