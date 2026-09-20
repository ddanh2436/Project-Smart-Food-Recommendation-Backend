import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RestaurantDocument = HydratedDocument<Restaurant>;

@Schema({ collection: 'restaurants' })
export class Restaurant {
  @Prop({ index: true }) tenQuan: string;
  @Prop({ index: true }) cityId: string;
  @Prop() diaChi: string;
  @Prop() gioMoCua: string;
  @Prop() giaCa: string;
  @Prop() tags: string;

  /**
   * Stored as numbers, but crawled rows sometimes hold a comma-decimal string
   * ("10,7769"), so readers must parse defensively.
   */
  @Prop() lat: number;
  @Prop() lon: number;

  @Prop({ index: true }) diemTrungBinh: number;
  @Prop() diemKhongGian: number;
  @Prop() diemViTri: number;
  @Prop() diemChatLuong: number;
  @Prop() diemPhucVu: number;
  @Prop() diemGiaCa: number;

  @Prop() avatarUrl: string;

  /** Natural key linking a restaurant to its reviews. */
  @Prop({ index: true }) urlGoc: string;
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);

/**
 * Indexes for the queries this app actually issues. Without them every listing
 * page was a full collection scan plus an in-memory sort.
 */
// Listing pages: filter by city, sort by score.
RestaurantSchema.index({ diaChi: 1, diemTrungBinh: -1 });
// The five "Top ..." home sections each sort by their own score field.
RestaurantSchema.index({ diemChatLuong: -1 });
RestaurantSchema.index({ diemKhongGian: -1 });
RestaurantSchema.index({ diemPhucVu: -1 });
RestaurantSchema.index({ diemGiaCa: -1 });
RestaurantSchema.index({ diemViTri: -1 });
// Text index for the name fallback used when the AI service is unreachable.
RestaurantSchema.index({ tenQuan: 'text', tags: 'text' });
