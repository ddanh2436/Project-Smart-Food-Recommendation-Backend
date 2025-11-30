// src/restaurants/restaurants.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseInterceptors, // [MỚI]
  UploadedFile,    // [MỚI]
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express'; // [MỚI]
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Post()
  create(@Body() createRestaurantDto: CreateRestaurantDto) {
    return this.restaurantsService.create(createRestaurantDto);
  }

  // [MỚI] API Tìm kiếm bằng hình ảnh
  @Post('search-by-image')
  @UseInterceptors(FileInterceptor('file'))
  async searchByImage(@UploadedFile() file: Express.Multer.File) {
    return this.restaurantsService.searchByImage(file);
  }

  @Get()
  findAll(
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('sortBy') sortBy: string,
    @Query('order') order: string,
    @Query('rating') rating: string,
    @Query('openNow') openNow: string,
    @Query('userLat') userLat: string, 
    @Query('userLon') userLon: string, 
    @Query('search') search: string,   
  ) {
    return this.restaurantsService.findAll(
      page, 
      limit, 
      sortBy, 
      order, 
      rating, 
      openNow, 
      userLat, 
      userLon,
      search
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.restaurantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRestaurantDto: UpdateRestaurantDto) {
    return this.restaurantsService.update(+id, updateRestaurantDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.restaurantsService.remove(+id);
  }
}