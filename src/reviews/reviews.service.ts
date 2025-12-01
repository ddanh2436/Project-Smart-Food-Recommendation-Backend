import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Review } from './schemas/review.schema';

@Injectable()
export class ReviewsService {
  constructor(@InjectModel(Review.name) private reviewModel: Model<Review>) {}

  async findByRestaurantUrl(url: string): Promise<Review[]> {
    if (!url) return [];
    
    return this.reviewModel.find({ urlGoc: url }).exec();
  }
}