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
import { UsersService } from 'src/users/users.service';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

interface MaybeAuthedRequest extends Request {
  user?: { sub: string; email: string };
}

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Post a review. Signed-in members only, one review per restaurant.
   *
   * Anonymous posting is gone. Each review counts towards the adjusted score
   * that orders every listing, so anonymous reviews were a lever anyone could
   * pull, at five a minute, to move any restaurant up the rankings. An account
   * turns that into something the one-per-restaurant rule can hold.
   *
   * The public author name is the username. It used to be the part of the
   * email before the "@", published on every review — for a Gmail address,
   * that is the address.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Body() createReviewDto: CreateReviewDto,
    @Req() req: MaybeAuthedRequest,
  ) {
    const user = await this.usersService.findOne(req.user!.sub);
    return this.reviewsService.create(createReviewDto, {
      id: user._id.toString(),
      name: user.username,
    });
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
