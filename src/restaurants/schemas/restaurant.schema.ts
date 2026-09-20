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

  // --- Raw scores as crawled. These are what the UI displays. ---
  @Prop({ index: true }) diemTrungBinh: number;
  @Prop() diemKhongGian: number;
  @Prop() diemViTri: number;
  @Prop() diemChatLuong: number;
  @Prop() diemPhucVu: number;
  @Prop() diemGiaCa: number;

  /**
   * How many reviews back this restaurant's scores.
   *
   * Populated by the rating-stats backfill (POST /restaurants/admin/rating-stats).
   * Without it the raw scores cannot be compared between restaurants, because
   * the highest-scoring ones are also the least reviewed: of the 488 places
   * rated 9.5-10, the median has a single review.
   */
  @Prop({ default: 0, index: true }) reviewCount: number;

  /**
   * Scores shrunk toward the global mean in proportion to review count:
   *
   *     adjusted = (C * mean + n * raw) / (C + n)
   *
   * These exist so listings can be *ordered* by a trustworthy figure while the
   * card still *shows* the raw score, which is what the source site reports.
   * A 10.0 from one review lands near the mean; a 10.0 from ten keeps most of
   * its score.
   */
  @Prop({ index: true }) diemTrungBinhAdj: number;
  @Prop() diemKhongGianAdj: number;
  @Prop() diemViTriAdj: number;
  @Prop() diemChatLuongAdj: number;
  @Prop() diemPhucVuAdj: number;
  @Prop() diemGiaCaAdj: number;

  /** When the backfill last recomputed the fields above. */
  @Prop() ratingStatsAt: Date;

  @Prop() avatarUrl: string;

  /** Natural key linking a restaurant to its reviews. */
  @Prop({ index: true }) urlGoc: string;
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);

/**
 * Indexes for the queries this app actually issues. Without them every listing
 * page was a full collection scan plus an in-memory sort.
 */
// Listing pages: filter by city, then order.
RestaurantSchema.index({ diaChi: 1, diemTrungBinhAdj: -1 });

// The six "Top ..." home sections each order by their own adjusted score.
RestaurantSchema.index({ diemTrungBinhAdj: -1 });
RestaurantSchema.index({ diemChatLuongAdj: -1 });
RestaurantSchema.index({ diemKhongGianAdj: -1 });
RestaurantSchema.index({ diemPhucVuAdj: -1 });
RestaurantSchema.index({ diemGiaCaAdj: -1 });
RestaurantSchema.index({ diemViTriAdj: -1 });

// Raw-score indexes are kept: the rating-band filter still matches on the raw
// value, because that is the number shown on the card.
RestaurantSchema.index({ diemChatLuong: -1 });
RestaurantSchema.index({ diemKhongGian: -1 });
RestaurantSchema.index({ diemPhucVu: -1 });
RestaurantSchema.index({ diemGiaCa: -1 });
RestaurantSchema.index({ diemViTri: -1 });

// Text index for the name fallback used when the AI service is unreachable.
RestaurantSchema.index({ tenQuan: 'text', tags: 'text' });
