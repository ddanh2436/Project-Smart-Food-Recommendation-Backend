import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import {
  Restaurant,
  RestaurantDocument,
} from 'src/restaurants/schemas/restaurant.schema';
import { AiService } from 'src/common/ai/ai.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { Review, ReviewDocument } from './schemas/review.schema';

/** How many reviews go to the AI service in one batch during a backfill. */
const BACKFILL_BATCH_SIZE = 64;

/**
 * The confidence the AI client reports when it could not reach the model.
 * A genuine prediction is essentially never exactly this value.
 */
const PLACEHOLDER_SCORE = 0.5;

/** Neutral labels, across the old and current backend spellings. */
const NEUTRAL_LABELS = ['neutral', 'NEU', 'LABEL_1'];
/** Cap on how many reviews a single insights request analyses. */
const INSIGHTS_LIMIT = 300;

interface ReviewAuthor {
  id: string;
  /** The member's public username — never anything derived from the email. */
  name: string;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    private readonly aiService: AiService,
  ) {}

  async create(
    createReviewDto: CreateReviewDto,
    author: ReviewAuthor,
  ): Promise<Review> {
    /**
     * The review has to belong to a restaurant that exists, and it takes the
     * restaurant's name from the database rather than from the request.
     *
     * Before, `urlGoc` could be any URL and `tenQuan` any string, and a review
     * counted towards `reviewCount` — which feeds the adjusted score that orders
     * every listing. Anyone could lift a restaurant up the rankings by posting
     * reviews at it, or file reviews under a name it does not have.
     */
    const restaurant = await this.restaurantModel
      .findOne({ urlGoc: createReviewDto.urlGoc })
      .select('tenQuan')
      .lean()
      .exec();
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    // Checked here for a clear message; the unique index is what actually
    // guarantees it when two requests arrive together.
    const existing = await this.reviewModel.exists({
      authorId: author.id,
      urlGoc: createReviewDto.urlGoc,
    });
    if (existing) {
      throw new ConflictException('You have already reviewed this restaurant');
    }

    const sentiment = await this.aiService.sentiment(createReviewDto.noiDung);

    /**
     * Only persist a label the model actually produced.
     *
     * The AI client returns a neutral placeholder when the service is
     * unreachable, and that used to be written straight to the document. The
     * result was permanent: a glowing review posted while the AI Space was
     * cold-starting was stored as "neutral" forever, because the backfill only
     * looks for rows with *no* label. 62 reviews in production ended up this
     * way, including genuinely positive ones.
     *
     * Leaving the fields unset instead means the row is simply unlabelled, and
     * the next backfill run picks it up.
     */
    const created = new this.reviewModel({
      ...createReviewDto,
      tenQuan: restaurant.tenQuan,
      // Sentiment is assigned server-side from the AI service. It is not read
      // from the request body, so a client cannot label its own review.
      ...(sentiment.available === false
        ? {}
        : {
            aiSentimentLabel: sentiment.label,
            aiSentimentScore: sentiment.score,
          }),
      authorId: author.id,
      authorName: author.name,
    });

    if (sentiment.available === false) {
      this.logger.warn(
        'AI sentiment unavailable; review saved unlabelled and will be ' +
          'picked up by the next backfill run.',
      );
    }

    try {
      return await created.save();
    } catch (error: any) {
      // Lost the race to a simultaneous request from the same member.
      if (error?.code === 11000) {
        throw new ConflictException('You have already reviewed this restaurant');
      }
      throw error;
    }
  }

  async findByRestaurantUrl(url: string, limit = 200): Promise<Review[]> {
    if (!url) return [];
    return this.reviewModel
      .find({ urlGoc: url })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 500))
      .lean()
      .exec();
  }

  /** Aspect-level AI digest of one restaurant's reviews. */
  async getInsights(url: string, lang = 'vi') {
    const reviews = await this.reviewModel
      .find({ urlGoc: url })
      .select('noiDung diemReview')
      .sort({ createdAt: -1 })
      .limit(INSIGHTS_LIMIT)
      .lean()
      .exec();

    if (reviews.length === 0) {
      throw new NotFoundException('No reviews found for this restaurant');
    }

    const insights = await this.aiService.reviewInsights(
      reviews.map((review) => ({
        noiDung: review.noiDung,
        diemReview: review.diemReview,
      })),
      lang,
    );

    if (!insights) {
      // Degrade to the counts we can compute locally rather than failing the
      // whole restaurant page when the AI service is unreachable.
      return {
        available: false,
        review_count: reviews.length,
        aspects: [],
        summary: null,
        message: 'AI service unavailable, showing basic counts only',
        ...(await this.localSentimentBreakdown(url)),
      };
    }
    return insights;
  }

  /** Sentiment tallies straight from the stored labels. */
  async localSentimentBreakdown(url: string) {
    const rows = await this.reviewModel.aggregate<{
      _id: string | null;
      count: number;
    }>([
      { $match: { urlGoc: url } },
      { $group: { _id: '$aiSentimentLabel', count: { $sum: 1 } } },
    ]);

    const overall = { positive: 0, neutral: 0, negative: 0 };
    for (const row of rows) {
      const label = row._id ?? '';
      if (label === 'POS' || label === 'LABEL_2') overall.positive += row.count;
      else if (label === 'NEG' || label === 'LABEL_0')
        overall.negative += row.count;
      else overall.neutral += row.count;
    }
    return { overall };
  }

  /**
   * Backfill sentiment labels for rows that have none.
   *
   * Rewritten to use the AI service's batch endpoint and `bulkWrite`. The old
   * version issued one HTTP request and one `save()` per review inside a
   * sequential loop, so a few thousand crawled reviews took many minutes and
   * would often exceed a platform request timeout halfway through.
   */
  async backfillSentiment(maxReviews = 2000) {
    this.logger.log('Starting sentiment backfill');

    const pending = await this.reviewModel
      .find({
        $or: [
          { aiSentimentLabel: { $exists: false } },
          { aiSentimentLabel: null },
          { aiSentimentLabel: '' },
          /**
           * Rows written with the old AI-failure placeholder.
           *
           * Both the previous backend and this one returned
           * `{ label: 'neutral' | 'NEU', score: 0.5 }` when the AI service was
           * unreachable, and stored it. A real model output is essentially
           * never exactly 0.5, so that exact value combined with a neutral
           * label identifies a failure rather than a verdict. Re-processing
           * them fixes reviews that were mislabelled through no fault of
           * their own.
           */
          {
            aiSentimentScore: PLACEHOLDER_SCORE,
            aiSentimentLabel: { $in: NEUTRAL_LABELS },
          },
        ],
        noiDung: { $exists: true, $ne: '' },
      })
      .select('_id noiDung')
      .limit(maxReviews)
      .lean()
      .exec();

    this.logger.log(`${pending.length} reviews need a sentiment label`);
    if (pending.length === 0) {
      return { message: 'Nothing to update', total: 0, updated: 0, failed: 0 };
    }

    let updated = 0;
    let failed = 0;

    for (let start = 0; start < pending.length; start += BACKFILL_BATCH_SIZE) {
      const batch = pending.slice(start, start + BACKFILL_BATCH_SIZE);
      const results = await this.aiService.sentimentBatch(
        batch.map((review) => review.noiDung),
      );

      const operations = batch
        .map((review, index) => {
          const result = results[index];
          // Skip the placeholder the client returns when the AI service is
          // down, so the row is retried on the next run instead of being
          // permanently marked neutral.
          if (!result || result.available === false) {
            failed += 1;
            return null;
          }
          return {
            updateOne: {
              filter: { _id: review._id },
              update: {
                $set: {
                  aiSentimentLabel: result.label,
                  aiSentimentScore: result.score,
                },
              },
            },
          };
        })
        .filter((operation): operation is NonNullable<typeof operation> =>
          Boolean(operation),
        );

      if (operations.length > 0) {
        const outcome = await this.reviewModel.bulkWrite(operations);
        updated += outcome.modifiedCount ?? 0;
      }

      this.logger.log(
        `Backfill progress: ${Math.min(start + BACKFILL_BATCH_SIZE, pending.length)}/${pending.length}`,
      );
    }

    this.logger.log(`Backfill finished. Updated ${updated}, failed ${failed}`);
    return {
      message: 'Backfill complete',
      total: pending.length,
      updated,
      failed,
    };
  }

  async deleteOwn(reviewId: string, authorId: string) {
    // A malformed id made findById throw a CastError, which surfaced as a 500.
    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      throw new BadRequestException('Invalid review id');
    }
    const review = await this.reviewModel.findById(reviewId).exec();
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.authorId !== authorId) {
      throw new NotFoundException('Review not found');
    }
    await review.deleteOne();
    return { success: true };
  }
}
