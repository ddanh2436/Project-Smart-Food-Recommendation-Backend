import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiModule } from 'src/common/ai/ai.module';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { Restaurant, RestaurantSchema } from './schemas/restaurant.schema';
import { RatingStatsService } from './rating-stats.service';
import { Review, ReviewSchema } from 'src/reviews/schemas/review.schema';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Restaurant.name, schema: RestaurantSchema },
      // The rating backfill counts reviews per restaurant, so it needs the
      // Review model as well.
      { name: Review.name, schema: ReviewSchema },
    ]),
    AiModule,
    // The chat reads a signed-in diner's saved tastes.
    UsersModule,
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService, RatingStatsService],
  exports: [RestaurantsService, RatingStatsService],
})
export class RestaurantsModule {}
