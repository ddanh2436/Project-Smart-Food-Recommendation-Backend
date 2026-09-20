import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseFloatPipe,
  Post,
  Query,
  Body,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AdminGuard } from 'src/common/guards/admin.guard';
import { RestaurantsService } from './restaurants.service';
import { RatingStatsService } from './rating-stats.service';
import { QueryRestaurantsDto } from './dto/query-restaurants.dto';
import { ChatRestaurantsDto } from './dto/chat-restaurants.dto';

/** Upload ceiling for dish photos. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;

@Controller('restaurants')
export class RestaurantsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    private readonly ratingStatsService: RatingStatsService,
  ) {}

  /**
   * Recompute `reviewCount` and the adjusted score fields.
   *
   * Run once after deploying, and again after any crawl that adds reviews.
   * Admin-only: it rewrites every restaurant document.
   *
   * Declared before the `:id` route, or `admin` would be read as an id.
   */
  @UseGuards(AdminGuard)
  @Post('admin/rating-stats')
  recomputeRatingStats() {
    return this.ratingStatsService.backfill();
  }

  @UseGuards(AdminGuard)
  @Get('admin/rating-stats')
  ratingStatsStatus() {
    return this.ratingStatsService.status();
  }

  /**
   * Image search.
   *
   * Declared before `@Get(':id')` and given an explicit size and MIME-type
   * limit. `FileInterceptor` with no limits let a client stream an
   * arbitrarily large body into memory, and the AI call was made regardless of
   * whether the upload was even an image.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('search-by-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_IMAGE_TYPES.test(file.mimetype)) {
          return callback(
            new BadRequestException(
              `Unsupported image type: ${file.mimetype}`,
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async searchByImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('userLat') userLat?: string,
    @Query('userLon') userLon?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No image uploaded');
    }
    return this.restaurantsService.searchByImage(
      file,
      userLat ? Number(userLat) : undefined,
      userLon ? Number(userLon) : undefined,
    );
  }

  /** Conversational search. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('chat')
  async chat(@Body() body: ChatRestaurantsDto) {
    return this.restaurantsService.chat(
      body.message,
      body.history ?? [],
      body.userLat,
      body.userLon,
      body.lang ?? 'vi',
    );
  }

  @Get()
  findAll(@Query() query: QueryRestaurantsDto) {
    // One validated DTO instead of ten loose positional query strings.
    return this.restaurantsService.findAll(query);
  }

  /** Restaurants within a radius of a point. */
  @Get('nearby')
  findNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
    @Query('radius') radius?: string,
    @Query('limit') limit?: string,
  ) {
    return this.restaurantsService.findNearby(
      lat,
      lon,
      radius ? Number(radius) : 5,
      limit ? Number(limit) : 20,
    );
  }

  // Must stay last: a literal route declared after this would be captured by
  // the `:id` parameter instead.
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.restaurantsService.findOne(id);
  }
}
