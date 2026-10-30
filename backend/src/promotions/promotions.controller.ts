import { PromotionListDto } from './promotion.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  HttpCode,
  Query,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NewPromotionDto, PromotionPageDto, EditPromotionDto, PromotionVersionDto } from './promotion.dto';
import { PromotionsService } from './promotions.service';

@Controller('mad/promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post() create(@Body() input: NewPromotionDto) {
    return this.promotions.create(input);
  }

  @Get() list(@Query() query: PromotionListDto) {
    return this.promotions.list(query);
  }

  @Get('room-types') roomTypes(@Query() query: PromotionPageDto) {
    return this.promotions.roomTypes(query);
  }

  @Get(':id') detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.promotions.detail(id);
  }

  @Put(':id') edit(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: EditPromotionDto) {
    return this.promotions.edit(id, input);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PromotionVersionDto) {
    return this.promotions.changeState(id, input.version, 'activate');
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PromotionVersionDto) {
    return this.promotions.changeState(id, input.version, 'deactivate');
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PromotionVersionDto) {
    return this.promotions.changeState(id, input.version, 'delete');
  }
}
