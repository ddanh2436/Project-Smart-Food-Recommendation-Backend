import { Injectable, Logger } from '@nestjs/common'; // [THÊM] Logger
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { Review } from './schemas/review.schema';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  // Tạo logger để theo dõi tiến độ cập nhật
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<Review>,
    private readonly httpService: HttpService
  ) {}

  // --- 1. Hàm gọi AI (Giữ nguyên) ---
  async analyzeSentiment(content: string) {
    try {
      const pythonApiUrl = 'http://127.0.0.1:5000/sentiment';
      const response = await lastValueFrom(
        this.httpService.post(pythonApiUrl, { review: content })
      );
      return response.data; 
    } catch (error) {
      this.logger.error(`Lỗi AI Service: ${error.message}`);
      return { label: 'neutral', score: 0.5 };
    }
  }

  // --- 2. Hàm tạo mới (Giữ nguyên) ---
  async create(createReviewDto: CreateReviewDto): Promise<Review> {
    const aiResult = await this.analyzeSentiment(createReviewDto.noiDung);
    const newReviewData = {
      ...createReviewDto,
      aiSentimentLabel: aiResult.label,
      aiSentimentScore: aiResult.score,
    };
    const createdReview = new this.reviewModel(newReviewData);
    return createdReview.save();
  }

  // --- 3. Hàm tìm kiếm (Giữ nguyên) ---
  async findByRestaurantUrl(url: string): Promise<Review[]> {
    if (!url) return [];
    return this.reviewModel.find({ urlGoc: url }).exec();
  }

  // --- [MỚI] 4. Hàm QUÉT VÀ CẬP NHẬT REVIEW CŨ ---
  // Hàm này sẽ tìm các review chưa có nhãn cảm xúc và cập nhật chúng
  async updateAllReviewsSentiment() {
    this.logger.log('>>> BẮT ĐẦU CẬP NHẬT SENTIMENT CHO DỮ LIỆU CŨ...');

    // Tìm tất cả review mà trường aiSentimentLabel chưa tồn tại
    const reviewsToUpdate = await this.reviewModel.find({
      aiSentimentLabel: { $exists: false } 
    }).exec();

    this.logger.log(`>>> Tìm thấy ${reviewsToUpdate.length} review cần xử lý.`);

    let successCount = 0;
    let failCount = 0;

    for (const review of reviewsToUpdate) {
      if (!review.noiDung) continue;

      try {
        // Gọi AI phân tích
        const aiResult = await this.analyzeSentiment(review.noiDung);

        // Cập nhật vào DB
        review.aiSentimentLabel = aiResult.label;
        review.aiSentimentScore = aiResult.score;
        await review.save();

        successCount++;
        // Log tiến độ mỗi 10 review để đỡ rối mắt
        if (successCount % 10 === 0) {
          this.logger.log(`   Đã cập nhật xong ${successCount} review...`);
        }
      } catch (e) {
        failCount++;
        this.logger.error(`   Lỗi khi cập nhật review ID ${review._id}: ${e.message}`);
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