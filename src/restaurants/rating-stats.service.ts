import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Review, ReviewDocument } from 'src/reviews/schemas/review.schema';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';

/**
 * The six crawled score fields, each paired with the adjusted field it feeds.
 */
export const SCORE_FIELDS = [
  { raw: 'diemTrungBinh', adjusted: 'diemTrungBinhAdj' },
  { raw: 'diemKhongGian', adjusted: 'diemKhongGianAdj' },
  { raw: 'diemViTri', adjusted: 'diemViTriAdj' },
  { raw: 'diemChatLuong', adjusted: 'diemChatLuongAdj' },
  { raw: 'diemPhucVu', adjusted: 'diemPhucVuAdj' },
  { raw: 'diemGiaCa', adjusted: 'diemGiaCaAdj' },
] as const;

/**
 * Review count at which a score is believed halfway between the global mean
 * and its face value.
 *
 * Chosen for the measured shape of this dataset: median 3 reviews per
 * restaurant, mean 5, p90 of 10, maximum 36 (the crawler capped them). On a
 * 10.0 score that yields 7.8 at one review, 8.7 at five, 9.1 at ten.
 *
 * Raise it to trust raw scores less, lower it to trust them more. Keep it in
 * step with RATING_CONFIDENCE in the AI service's data_store.py, which applies
 * the same correction in memory for search ranking.
 */
export const CONFIDENCE = 5;

/** Documents written per bulk batch. */
const BATCH_SIZE = 500;

export interface RatingStatsResult {
  restaurants: number;
  updated: number;
  withReviews: number;
  withoutReviews: number;
  means: Record<string, number>;
  confidence: number;
  durationMs: number;
}

/**
 * Recomputes `reviewCount` and the six adjusted score fields.
 *
 * Why this exists: the six "Top ..." sections on the home page ordered
 * restaurants by their raw crawled score, so they showcased places whose score
 * rests on a single review. Ordering by a shrunk score fixes that without
 * changing the number displayed on the card.
 *
 * Run it after any crawl that adds reviews, via
 * `POST /restaurants/admin/rating-stats` with an `x-admin-token` header.
 */
@Injectable()
export class RatingStatsService {
  private readonly logger = new Logger(RatingStatsService.name);

  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Review.name)
    private reviewModel: Model<ReviewDocument>,
  ) {}

  async backfill(): Promise<RatingStatsResult> {
    const startedAt = Date.now();
    this.logger.log('Recomputing rating statistics');

    // 1. Review counts per restaurant, grouped server-side so only one small
    //    row per restaurant crosses the wire rather than every review body.
    const counts = new Map<string, number>();
    const grouped = await this.reviewModel.aggregate<{
      _id: string | null;
      n: number;
    }>([{ $group: { _id: '$urlGoc', n: { $sum: 1 } } }]);
    for (const row of grouped) {
      if (row._id) counts.set(String(row._id), row.n);
    }
    this.logger.log(`${counts.size} restaurants have at least one review`);

    // 2. Global mean per score field, over rows that actually have a score.
    //    Each field needs its own mean: "price" scores sit lower than "food
    //    quality" scores, so one shared mean would skew five of the six.
    const means = await this.computeMeans();
    this.logger.log(
      `means: ${Object.entries(means)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(' ')}`,
    );

    // 3. Write the adjusted values in batches.
    const cursor = this.restaurantModel
      .find({}, { urlGoc: 1, ...this.rawProjection() })
      .lean()
      .cursor();

    let restaurants = 0;
    let updated = 0;
    let withReviews = 0;
    const now = new Date();
    let operations: Parameters<typeof this.restaurantModel.bulkWrite>[0] = [];

    for await (const doc of cursor) {
      restaurants += 1;
      const reviewCount = counts.get(String(doc.urlGoc ?? '')) ?? 0;
      if (reviewCount > 0) withReviews += 1;

      const update: Record<string, unknown> = {
        reviewCount,
        ratingStatsAt: now,
      };
      for (const { raw, adjusted } of SCORE_FIELDS) {
        update[adjusted] = this.shrink(
          Number((doc as Record<string, unknown>)[raw]) || 0,
          reviewCount,
          means[raw] ?? 0,
        );
      }

      operations.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: update } },
      });

      if (operations.length >= BATCH_SIZE) {
        updated += await this.flush(operations);
        operations = [];
      }
    }
    if (operations.length > 0) {
      updated += await this.flush(operations);
    }

    const result: RatingStatsResult = {
      restaurants,
      updated,
      withReviews,
      withoutReviews: restaurants - withReviews,
      means,
      confidence: CONFIDENCE,
      durationMs: Date.now() - startedAt,
    };
    this.logger.log(
      `Done: ${updated}/${restaurants} updated in ${result.durationMs}ms`,
    );
    return result;
  }

  /**
   * Shrink a raw score toward the mean in proportion to how little evidence
   * supports it. A score of 0 means "not rated" and stays 0, rather than being
   * lifted to the mean by the formula.
   */
  private shrink(raw: number, reviewCount: number, mean: number): number {
    if (!raw || raw <= 0) return 0;
    const adjusted =
      (CONFIDENCE * mean + reviewCount * raw) / (CONFIDENCE + reviewCount);
    // Two decimals is plenty and keeps the documents small.
    return Math.round(adjusted * 100) / 100;
  }

  private async computeMeans(): Promise<Record<string, number>> {
    const group: Record<string, unknown> = { _id: null };
    for (const { raw } of SCORE_FIELDS) {
      // $avg ignores nulls, but a stored 0 means "no score" here and would drag
      // the mean down, so those are excluded explicitly.
      group[raw] = {
        $avg: {
          $cond: [{ $gt: [`$${raw}`, 0] }, `$${raw}`, null],
        },
      };
    }

    const [row] = await this.restaurantModel.aggregate<Record<string, number>>([
      { $group: group as never },
    ]);

    const means: Record<string, number> = {};
    for (const { raw } of SCORE_FIELDS) {
      means[raw] = Number(row?.[raw]) || 0;
    }
    return means;
  }

  private rawProjection(): Record<string, 1> {
    return Object.fromEntries(
      SCORE_FIELDS.map(({ raw }) => [raw, 1]),
    ) as Record<string, 1>;
  }

  private async flush(
    operations: Parameters<typeof this.restaurantModel.bulkWrite>[0],
  ): Promise<number> {
    if (operations.length === 0) return 0;
    const outcome = await this.restaurantModel.bulkWrite(operations);
    return outcome.modifiedCount ?? 0;
  }

  /** Whether the backfill has ever run. */
  async status() {
    const [total, withStats, sample] = await Promise.all([
      this.restaurantModel.countDocuments({}),
      this.restaurantModel.countDocuments({ ratingStatsAt: { $exists: true } }),
      this.restaurantModel
        .findOne({ ratingStatsAt: { $exists: true } }, { ratingStatsAt: 1 })
        .sort({ ratingStatsAt: -1 })
        .lean(),
    ]);
    return {
      total,
      withStats,
      missing: total - withStats,
      lastRunAt: sample?.ratingStatsAt ?? null,
      confidence: CONFIDENCE,
    };
  }
}
