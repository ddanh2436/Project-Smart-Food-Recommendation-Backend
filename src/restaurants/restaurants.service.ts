import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { InjectModel } from '@nestjs/mongoose'; 
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema'; 
import { Model } from 'mongoose'; 

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
  ) {}

  create(createRestaurantDto: CreateRestaurantDto) {
    return 'This action adds a new restaurant';
  }

  async findAll(page: number = 1, limit: number = 100): Promise<any> {
    const skip = (page - 1) * limit;

    // Lấy tổng số lượng để tính số trang
    const total = await this.restaurantModel.countDocuments().exec();

    // Lấy dữ liệu theo trang
    const data = await this.restaurantModel
      .find()
      .sort({ diemTrungBinh: -1 }) // Vẫn sắp xếp theo điểm cao nhất
      .skip(skip)
      .limit(limit)
      .exec();

    return {
      data, // Danh sách nhà hàng
      total, // Tổng số nhà hàng
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Restaurant> {
    const restaurant = await this.restaurantModel.findById(id).exec();
    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${id} not found`);
    }
    return restaurant;
  }
  update(id: number, updateRestaurantDto: UpdateRestaurantDto) {
    return `This action updates a #${id} restaurant`;
  }

  remove(id: number) {
    return `This action removes a #${id} restaurant`;
  }
}
