import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  @Prop({ required: true })
  tenQuan: string;

  /** Links a review to its restaurant. Indexed: every read filters on it. */
  @Prop({ required: true, index: true })
  urlGoc: string;

  @Prop({ required: true, min: 1, max: 10 })
  diemReview: number;

  @Prop({ required: true })
  noiDung: string;

  /** 'POS' | 'NEU' | 'NEG' (older rows may hold 'LABEL_0'..'LABEL_2'). */
  @Prop({ required: false, index: true })
  aiSentimentLabel?: string;

  @Prop({ required: false })
  aiSentimentScore?: number;

  /**
   * Set for reviews written in this app, absent for crawled ones. Lets the UI
   * distinguish "Thực khách Foody" from a real signed-in member.
   */
  @Prop({ required: false, index: true })
  authorId?: string;

  @Prop({ required: false })
  authorName?: string;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// Serving a restaurant page means "this restaurant's reviews, newest first",
// which this compound index answers without an in-memory sort.
ReviewSchema.index({ urlGoc: 1, createdAt: -1 });
