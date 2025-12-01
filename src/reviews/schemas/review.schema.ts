import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ collection: 'reviews' }) 
export class Review {
  @Prop()
  tenQuan: string;

  // Đây là trường quan trọng để liên kết với Nhà hàng
  @Prop({ index: true }) 
  urlGoc: string;

  @Prop()
  diemReview: number;

  @Prop()
  noiDung: string;

  @Prop()
  aiSentimentLabel: string; // Ví dụ: 'LABEL_2' (Tích cực)

  @Prop()
  aiSentimentScore: number;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);