// src/restaurants/restaurants.module.ts
import { Module } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { MongooseModule } from '@nestjs/mongoose'; // 1. Import
import { Restaurant, RestaurantSchema } from './schemas/restaurant.schema'; // 2. Import

@Module({
  // 3. Thêm MongooseModule.forFeature
  imports: [
    MongooseModule.forFeature([
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService],
})
export class RestaurantsModule {}