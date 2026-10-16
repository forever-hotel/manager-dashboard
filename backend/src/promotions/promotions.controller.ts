import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePromotionDto, PromotionPageDto } from './promotion.dto';
import { PromotionsService } from './promotions.service';

@Controller('mad/promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}
  @Post() create(@Body() input: CreatePromotionDto) {
    return this.promotions.create(input);
  }
  @Get() list(@Query() query: PromotionPageDto) {
    return this.promotions.list(query);
  }
  @Get('room-types') roomTypes(@Query() query: PromotionPageDto) {
    return this.promotions.roomTypes(query);
  }
  @Get(':id') detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.promotions.detail(id);
  }
}
