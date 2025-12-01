import {
  Controller,
  Get,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // API Endpoint: GET /reviews?url=...
  @Get()
  async findAll(@Query('url') url: string) {
    if (!url) {
      throw new HttpException('Missing url parameter', HttpStatus.BAD_REQUEST);
    }

    // Gọi service để lấy dữ liệu
    const reviews = await this.reviewsService.findByRestaurantUrl(url);
    return reviews;
  }
}
