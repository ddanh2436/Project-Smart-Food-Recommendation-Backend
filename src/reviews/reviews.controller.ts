import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  Req,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminGuard } from 'src/common/guards/admin.guard';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

interface MaybeAuthedRequest extends Request {
  user?: { sub: string; email: string };
}

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /**
   * Post a review.
   *
   * Rate limited to 5 per minute per IP: this endpoint writes to the database
   * and triggers an AI inference call, and previously had no limit at all.
   * Authentication is optional so the existing anonymous flow keeps working,
   * but a signed-in user's review is attributed to them.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async create(
    @Body() createReviewDto: CreateReviewDto,
    @Req() req: MaybeAuthedRequest,
  ) {
    const author = req.user
      ? { id: req.user.sub, name: req.user.email.split('@')[0] }
      : undefined;
    return this.reviewsService.create(createReviewDto, author);
  }

  @Get()
  async findAll(@Query('url') url: string) {
    if (!url) {
      throw new BadRequestException('Missing url parameter');
    }
    return this.reviewsService.findByRestaurantUrl(url);
  }

  /** Aspect-level AI summary of a restaurant's reviews. */
  @Get('insights')
  async insights(@Query('url') url: string, @Query('lang') lang?: string) {
    if (!url) {
      throw new BadRequestException('Missing url parameter');
    }
    return this.reviewsService.getInsights(url, lang === 'en' ? 'en' : 'vi');
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string, @Req() req: MaybeAuthedRequest) {
    return this.reviewsService.deleteOwn(id, req.user!.sub);
  }

  /**
   * Maintenance: label reviews that have no sentiment yet.
   *
   * Now behind AdminGuard. It was publicly reachable, so anyone could trigger a
   * full-collection scan plus one AI inference per row — an easy way to exhaust
   * both the database and the AI service.
   */
  @UseGuards(AdminGuard)
  @Post('migrate-sentiment')
  async backfill(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.reviewsService.backfillSentiment(
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 2000,
    );
  }
}
