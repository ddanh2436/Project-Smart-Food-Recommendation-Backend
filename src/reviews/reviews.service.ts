// src/reviews/reviews.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs'; // [UPDATE] Dùng firstValueFrom thay cho lastValueFrom
import { Review, ReviewDocument } from './schemas/review.schema';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  // Logger giúp debug trên Render dễ hơn
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    private readonly httpService: HttpService,
  ) {}

  // --- 1. Hàm gọi AI (ĐÃ SỬA LỖI URL) ---
  async analyzeSentiment(content: string) {
    // [QUAN TRỌNG] Lấy URL từ biến môi trường, fallback về localhost nếu chạy local
    const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
    
    // [LOG] In ra để kiểm tra xem trên Render nó đang dùng link nào
    this.logger.log(`🔍 Calling AI Sentiment at: ${aiUrl}/sentiment`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${aiUrl}/sentiment`, { review: content })
      );
      return response.data; 
    } catch (error) {
      this.logger.error(`⚠️ Lỗi AI Service: ${error.message}`);
      // Nếu AI chết, trả về kết quả mặc định để không làm lỗi tính năng Review
      return { label: 'neutral', score: 0.5 };
    }
  }

  // --- 2. Hàm tạo mới Review ---
  async create(createReviewDto: CreateReviewDto): Promise<Review> {
    // Gọi AI phân tích trước khi lưu
    const aiResult = await this.analyzeSentiment(createReviewDto.noiDung);
    
    const newReviewData = {
      ...createReviewDto,
      aiSentimentLabel: aiResult.label,
      aiSentimentScore: aiResult.score,
      createdAt: new Date(), // Đảm bảo có thời gian tạo
    };
    
    const createdReview = new this.reviewModel(newReviewData);
    return createdReview.save();
  }

  // --- 3. Hàm tìm kiếm theo URL nhà hàng ---
  async findByRestaurantUrl(url: string): Promise<Review[]> {
    if (!url) return [];
    // Sắp xếp review mới nhất lên đầu
    return this.reviewModel.find({ urlGoc: url }).sort({ createdAt: -1 }).exec();
  }

  // --- 4. Hàm Quét và Cập nhật Review cũ (Công cụ Admin) ---
  async updateAllReviewsSentiment() {
    this.logger.log('>>> BẮT ĐẦU CẬP NHẬT SENTIMENT CHO DỮ LIỆU CŨ...');

    // Tìm các review chưa có nhãn
    const reviewsToUpdate = await this.reviewModel.find({
      aiSentimentLabel: { $exists: false } 
    }).exec();

    this.logger.log(`>>> Tìm thấy ${reviewsToUpdate.length} review cần xử lý.`);

    let successCount = 0;
    let failCount = 0;

    for (const review of reviewsToUpdate) {
      if (!review.noiDung) continue;

      try {
        const aiResult = await this.analyzeSentiment(review.noiDung);

        review.aiSentimentLabel = aiResult.label;
        review.aiSentimentScore = aiResult.score;
        await review.save();

        successCount++;
        if (successCount % 10 === 0) {
          this.logger.log(`   Running... Đã cập nhật ${successCount} review.`);
        }
      } catch (e) {
        failCount++;
        this.logger.error(`   Fail ID ${review._id}: ${e.message}`);
      }
    }

    this.logger.log(`>>> HOÀN TẤT! Thành công: ${successCount}, Thất bại: ${failCount}`);
    return { 
      message: 'Cập nhật hoàn tất', 
      total: reviewsToUpdate.length, 
      updated: successCount,
      failed: failCount 
    };
  }
}