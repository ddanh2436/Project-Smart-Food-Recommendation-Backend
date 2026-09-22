import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { AiService } from 'src/common/ai/ai.service';
import { QueryRestaurantsDto, SortField } from './dto/query-restaurants.dto';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';

/** Score fields a client is allowed to sort by. */
const SORTABLE_SCORES: Record<SortField, string> = {
  diemTrungBinh: 'diemTrungBinh',
  diemKhongGian: 'diemKhongGian',
  diemViTri: 'diemViTri',
  diemChatLuong: 'diemChatLuong',
  diemPhucVu: 'diemPhucVu',
  diemGiaCa: 'diemGiaCa',
};

/**
 * The field actually used to ORDER results, per requested score.
 *
 * Clients keep asking for `diemTrungBinh`; ordering silently uses the
 * review-count-adjusted twin. This is deliberate: the six "Top ..." home
 * sections ordered by the raw score and so showcased restaurants whose 10.0
 * rests on one review. Swapping only the sort key means no client has to
 * change, and the card still shows the raw score the source site reports.
 *
 * See RatingStatsService for how the adjusted values are produced.
 */
const ORDER_BY_ADJUSTED: Record<SortField, string> = {
  diemTrungBinh: 'diemTrungBinhAdj',
  diemKhongGian: 'diemKhongGianAdj',
  diemViTri: 'diemViTriAdj',
  diemChatLuong: 'diemChatLuongAdj',
  diemPhucVu: 'diemPhucVuAdj',
  diemGiaCa: 'diemGiaCaAdj',
};

const RATING_RANGES: Record<string, { $gte?: number; $lt?: number }> = {
  gte9: { $gte: 9 },
  '8to9': { $gte: 8, $lt: 9 },
  '7to8': { $gte: 7, $lt: 8 },
  '6to7': { $gte: 6, $lt: 7 },
  lt6: { $lt: 6 },
};

/**
 * City address patterns.
 *
 * Kept as data rather than the two enormous inline regex literals the old
 * findAll held, so adding a city is a one-line change.
 */
const CITY_PATTERNS: Record<string, RegExp> = {
  hanoi:
    /Hà Nội|Ha Noi|Hanoi|Ba Đình|Ba Dinh|Hoàn Kiếm|Hoan Kiem|Tây Hồ|Tay Ho|Long Biên|Long Bien|Cầu Giấy|Cau Giay|Đống Đa|Dong Da|Hai Bà Trưng|Hai Ba Trung|Hoàng Mai|Hoang Mai|Thanh Xuân|Thanh Xuan|Sóc Sơn|Soc Son|Đông Anh|Dong Anh|Gia Lâm|Gia Lam|Nam Từ Liêm|Nam Tu Liem|Bắc Từ Liêm|Bac Tu Liem|Thanh Trì|Thanh Tri|Hà Đông|Ha Dong|Sơn Tây|Son Tay/i,
  hcmc:
    /Hồ Chí Minh|Ho Chi Minh|TP\.?\s?HCM|TPHCM|Sài Gòn|Sai Gon|\bHCM\b|Thủ Đức|Thu Duc|Gò Vấp|Go Vap|Bình Thạnh|Binh Thanh|Tân Bình|Tan Binh|Tân Phú|Tan Phu|Phú Nhuận|Phu Nhuan|Bình Tân|Binh Tan|Củ Chi|Cu Chi|Hóc Môn|Hoc Mon|Bình Chánh|Binh Chanh|Nhà Bè|Nha Be|Cần Giờ|Can Gio|(?:Quận|District|Q\.?)\s?(?:1|3|4|5|6|7|8|10|11|12)\b/i,
  danang:
    /Đà Nẵng|Da Nang|Hải Châu|Hai Chau|Thanh Khê|Thanh Khe|Sơn Trà|Son Tra|Ngũ Hành Sơn|Ngu Hanh Son|Liên Chiểu|Lien Chieu|Cẩm Lệ|Cam Le|Hòa Vang|Hoa Vang/i,
};

/** Hard ceiling on page size, so `?limit=999999` cannot be used to dump the DB. */
const MAX_LIMIT = 100;

@Injectable()
export class RestaurantsService {
  private readonly logger = new Logger(RestaurantsService.name);

  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    private readonly aiService: AiService,
  ) {}

  /**
   * Whether the adjusted score fields have been populated.
   *
   * Cached, because `findAll` consults it on every request and the answer only
   * changes when the backfill runs. Once true it is never re-checked; while
   * false it is re-checked at most once a minute, so a freshly run backfill is
   * picked up without a redeploy.
   */
  private adjustedScoresReady = false;
  private adjustedScoresCheckedAt = 0;

  private async hasAdjustedScores(): Promise<boolean> {
    if (this.adjustedScoresReady) return true;
    if (Date.now() - this.adjustedScoresCheckedAt < 60_000) return false;

    this.adjustedScoresCheckedAt = Date.now();
    try {
      const one = await this.restaurantModel
        .exists({ diemTrungBinhAdj: { $gt: 0 } })
        .exec();
      this.adjustedScoresReady = Boolean(one);
      if (!this.adjustedScoresReady) {
        this.logger.warn(
          'Adjusted scores are not populated, ordering by the raw score. ' +
            'Run POST /restaurants/admin/rating-stats with an x-admin-token.',
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not check adjusted scores: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
    return this.adjustedScoresReady;
  }

  // -------------------------------------------------------------- reading
  async findAll(query: QueryRestaurantsDto) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 32, 1), MAX_LIMIT);
    const skip = (page - 1) * limit;
    const order = query.order === 'asc' ? 1 : -1;

    const sortField = SORTABLE_SCORES[query.sortBy as SortField]
      ? (query.sortBy as SortField)
      : 'diemTrungBinh';
    // Order by the adjusted twin, but only once the backfill has populated it;
    // otherwise every document would sort as 0 and the listing would be
    // arbitrary. `orderField` therefore falls back to the raw score.
    const orderField = (await this.hasAdjustedScores())
      ? ORDER_BY_ADJUSTED[sortField]
      : sortField;

    const filter: mongoose.FilterQuery<RestaurantDocument> = {};

    if (query.city && CITY_PATTERNS[query.city]) {
      filter.diaChi = { $regex: CITY_PATTERNS[query.city] };
    }

    if (query.rating && query.rating !== 'all' && RATING_RANGES[query.rating]) {
      filter[sortField] = RATING_RANGES[query.rating];
    }

    const hasCoordinates =
      query.userLat !== undefined && query.userLon !== undefined;

    // ---- AI-ranked text search -----------------------------------------
    let aiRank: Map<string, number> | null = null;
    let aiSortBy: string | null = null;

    if (query.search?.trim()) {
      const aiResponse = await this.aiService.recommend({
        query: query.search.trim(),
        user_gps: hasCoordinates
          ? [query.userLat as number, query.userLon as number]
          : null,
        city_filter: query.city ?? null,
        limit: 200,
      });

      if (aiResponse) {
        const ids = (aiResponse.scores ?? [])
          .map((item) => item.id)
          .filter((id) => mongoose.Types.ObjectId.isValid(id));

        if (ids.length === 0) {
          return this.emptyPage(page, sortField, query.order);
        }

        aiRank = new Map(ids.map((id, index) => [id, index]));
        aiSortBy = aiResponse.sort_by;
        filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
      } else {
        // AI service unreachable: fall back to a plain name search rather than
        // returning nothing. `escapeRegex` matters here — the raw user string
        // used to go straight into $regex, so a query like "c++(" threw a
        // regex-compile error and a crafted one could cause catastrophic
        // backtracking against every document.
        this.logger.warn('AI search unavailable, falling back to name match');
        filter.tenQuan = {
          $regex: this.escapeRegex(query.search.trim()),
          $options: 'i',
        };
      }
    }

    /**
     * Distance sorting and open-now filtering cannot be expressed in this
     * schema's Mongo query (coordinates are loose fields and opening hours are
     * free text), so they need documents in memory. The old code did that for
     * *any* search and with no cap, reading the entire collection on a request
     * as ordinary as `openNow=true`. Now the in-memory path is bounded.
     */
    const needsInMemory =
      query.openNow === true || (query.sortBy === 'distance' && hasCoordinates);

    if (!needsInMemory && !aiRank) {
      const [total, data] = await Promise.all([
        this.restaurantModel.countDocuments(filter).exec(),
        this.restaurantModel
          .find(filter)
          .sort({ [orderField]: order })
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
      ]);
      return {
        data,
        total,
        currentPage: page,
        totalPages: Math.ceil(total / limit) || 1,
        sortBy: query.sortBy ?? sortField,
        order: query.order ?? 'desc',
      };
    }

    // ---- bounded in-memory path ----------------------------------------
    const inMemoryLimit = aiRank ? aiRank.size : MAX_IN_MEMORY;
    let candidates = await this.restaurantModel
      .find(filter)
      .limit(inMemoryLimit)
      .lean()
      .exec();

    if (!aiRank && candidates.length === MAX_IN_MEMORY) {
      // Truncation would quietly drop restaurants from the result count, so
      // say so instead of letting the page total silently understate reality.
      this.logger.warn(
        `In-memory path hit the ${MAX_IN_MEMORY}-document cap; results are ` +
          `truncated. Precompute opening hours into a queryable field.`,
      );
    }

    if (hasCoordinates) {
      candidates = candidates.map((restaurant) => ({
        ...restaurant,
        distance: this.distanceKm(
          query.userLat as number,
          query.userLon as number,
          this.parseCoordinate(restaurant.lat),
          this.parseCoordinate(restaurant.lon),
        ),
      }));
    }

    if (query.openNow) {
      candidates = candidates.filter((restaurant) =>
        this.isOpenNow(restaurant.gioMoCua),
      );
    }

    if (aiRank && query.sortBy !== 'distance') {
      if (query.order === 'asc' && query.sortBy) {
        candidates.sort(
          (a, b) =>
            ((a as any)[orderField] ?? 0) - ((b as any)[orderField] ?? 0),
        );
      } else {
        // Preserve the AI's relevance order by default.
        candidates.sort(
          (a, b) =>
            (aiRank!.get(String(a._id)) ?? Number.MAX_SAFE_INTEGER) -
            (aiRank!.get(String(b._id)) ?? Number.MAX_SAFE_INTEGER),
        );
      }
    } else if (query.sortBy === 'distance') {
      candidates.sort((a, b) =>
        order === 1
          ? ((a as any).distance ?? Infinity) - ((b as any).distance ?? Infinity)
          : ((b as any).distance ?? -Infinity) -
            ((a as any).distance ?? -Infinity),
      );
    } else {
      candidates.sort(
        (a, b) =>
          order === 1
            ? ((a as any)[orderField] ?? 0) - ((b as any)[orderField] ?? 0)
            : ((b as any)[orderField] ?? 0) - ((a as any)[orderField] ?? 0),
      );
    }

    const total = candidates.length;
    return {
      data: candidates.slice(skip, skip + limit),
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit) || 1,
      sortBy: aiSortBy ?? query.sortBy ?? sortField,
      order: query.order ?? 'desc',
    };
  }

  async findOne(id: string): Promise<Restaurant> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid restaurant id: ${id}`);
    }
    const restaurant = await this.restaurantModel.findById(id).lean().exec();
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${id} not found`);
    }
    return restaurant as Restaurant;
  }

  /**
   * Other places a diner looking at this one would plausibly consider.
   *
   * Ranked by how much of the restaurant's own tag set they share, preferring
   * the same district, and ordered by the review-count-adjusted score so the
   * suggestions are places that are actually good rather than merely similar.
   */
  async findSimilar(id: string, limit = 8) {
    const source = await this.findOne(id);

    // Tags are stored as the string form of a Python list, e.g.
    // "['Hồ Chí Minh', 'Quận 1', 'Phở', 'Máy lạnh']".
    const tags = this.parseTags(source.tags);
    // The first two entries are city and district, which every neighbour
    // shares and which therefore say nothing about similarity.
    const descriptive = tags.slice(2).filter((t) => t.length > 1);
    const district = tags[1];

    if (descriptive.length === 0) {
      return { data: [], basedOn: [] };
    }

    const candidates = await this.restaurantModel
      .find({
        _id: { $ne: new mongoose.Types.ObjectId(id) },
        tags: { $regex: this.escapeRegex(descriptive[0]), $options: 'i' },
      })
      .limit(400)
      .lean()
      .exec();

    const wanted = new Set(descriptive.map((t) => t.toLowerCase()));
    const scored = candidates
      .map((candidate) => {
        const theirs = this.parseTags(candidate.tags);
        const shared = theirs.filter((t) => wanted.has(t.toLowerCase())).length;
        const sameDistrict =
          district && theirs[1]
            ? theirs[1].toLowerCase() === district.toLowerCase()
            : false;
        return {
          ...candidate,
          _similarity: shared + (sameDistrict ? 2 : 0),
        };
      })
      .filter((candidate) => candidate._similarity > 0)
      .sort(
        (a, b) =>
          b._similarity - a._similarity ||
          ((b as any).diemTrungBinhAdj ?? 0) -
            ((a as any).diemTrungBinhAdj ?? 0),
      )
      .slice(0, Math.min(limit, 20));

    return {
      data: scored,
      basedOn: descriptive.slice(0, 4),
      district: district ?? null,
    };
  }

  /** Parse the stringified Python list the crawler stores in `tags`. */
  private parseTags(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return raw
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  /** Restaurants near a point, for a "near me" view. */
  async findNearby(lat: number, lon: number, radiusKm = 5, limit = 20) {
    const candidates = await this.restaurantModel
      .find({ lat: { $exists: true }, lon: { $exists: true } })
      .limit(MAX_IN_MEMORY)
      .lean()
      .exec();

    return candidates
      .map((restaurant) => ({
        ...restaurant,
        distance: this.distanceKm(
          lat,
          lon,
          this.parseCoordinate(restaurant.lat),
          this.parseCoordinate(restaurant.lon),
        ),
      }))
      .filter((restaurant) => restaurant.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(limit, MAX_LIMIT));
  }

  // ------------------------------------------------------------- AI paths
  async searchByImage(
    file: Express.Multer.File,
    userLat?: number,
    userLon?: number,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image uploaded');
    }

    const prediction = await this.aiService.predictFood(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    // No dish named means no search: a confident list of the wrong
    // restaurants is worse than saying the photo was not clear enough. The
    // tier and the suggestions are what let the client offer a way forward
    // instead of the dead end this used to be.
    if (!prediction?.food_name) {
      return {
        data: [],
        detectedFood: null,
        total: 0,
        tier: prediction?.tier ?? 'none',
        group: prediction?.group ?? null,
        suggestions: prediction?.suggestions ?? [],
      };
    }

    const page = await this.findAll({
      page: 1,
      limit: 20,
      sortBy: 'diemTrungBinh',
      order: 'desc',
      rating: 'all',
      openNow: false,
      search: prediction.food_name,
      userLat,
      userLon,
    } as QueryRestaurantsDto);

    const top = (page.data ?? [])
      .slice()
      .sort(
        (a: any, b: any) => (b.diemTrungBinh ?? 0) - (a.diemTrungBinh ?? 0),
      )
      .slice(0, 5);

    return {
      data: top,
      detectedFood: prediction.food_name,
      confidence: prediction.confidence,
      detections: prediction.detections ?? [],
      tier: prediction.tier ?? 'confident',
      group: prediction.group ?? null,
      suggestions: prediction.suggestions ?? [],
      total: top.length,
    };
  }

  /**
   * Conversational search.
   *
   * Delegates the whole turn to the AI service, which owns the conversation
   * state and the wording, then hydrates the returned ids into full restaurant
   * documents so the UI has images and addresses to render. The old version
   * built its reply from a hardcoded list of Vietnamese sentences here in the
   * backend, duplicating logic the AI service also had.
   */
  async chat(
    message: string,
    history: Array<{ role: 'user' | 'bot'; text: string }> = [],
    userLat?: number,
    userLon?: number,
    lang = 'vi',
  ) {
    const response = await this.aiService.chat({
      message,
      history,
      user_gps:
        userLat !== undefined && userLon !== undefined
          ? [userLat, userLon]
          : null,
      lang,
      limit: 5,
    });

    if (!response) {
      return {
        reply:
          lang === 'en'
            ? 'The assistant is waking up, please try again in a moment.'
            : 'Trợ lý đang khởi động lại, bạn thử lại sau một chút nhé! 🤒',
        results: [],
        kind: 'error',
        slotsMissing: [],
        chips: [],
      };
    }

    const ids = (response.results ?? [])
      .map((item) => item.id)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    let results: any[] = [];
    if (ids.length > 0) {
      const documents = await this.restaurantModel
        .find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
        .lean()
        .exec();
      // Preserve the AI's ordering, which $in does not.
      const byId = new Map(documents.map((doc) => [String(doc._id), doc]));
      results = ids
        .map((id) => byId.get(id))
        .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));
    }

    return {
      reply: response.reply,
      results,
      kind: response.kind,
      intent: response.intent,
      totalMatches: response.total_matches,
      relaxedFilters: response.relaxed_filters ?? [],
      slotsMissing: response.slots_missing ?? [],
      chips: response.chips ?? [],
    };
  }

  // ------------------------------------------------------------- helpers
  private emptyPage(page: number, sortField: string, order?: string) {
    return {
      data: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
      sortBy: sortField,
      order: order ?? 'desc',
    };
  }

  /** Escape user input before it is used inside a $regex. */
  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseCoordinate(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private distanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    // Missing coordinates are stored as 0/0, which is in the Atlantic. Return a
    // sentinel so such rows sort last instead of appearing to be nearby.
    if (!lat2 || !lon2 || !lat1 || !lon1) return 99_999;

    const toRad = (degrees: number) => degrees * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Whether a restaurant is open, from a free-text hours field such as
   * "07:00 - 22:00 | 17:00 - 02:00".
   *
   * An unparseable or empty value counts as open. Returning false — as the old
   * implementation did — silently hid every restaurant whose hours had not been
   * crawled, which is a large share of the data.
   */
  private isOpenNow(hours?: string): boolean {
    if (!hours?.trim()) return true;

    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    let sawValidWindow = false;

    for (const window of hours.split(/[|,]/)) {
      const parts = window.split('-').map((part) => part.trim());
      if (parts.length !== 2) continue;

      const toMinutes = (time: string): number | null => {
        const [h, m] = time.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return h * 60 + m;
      };
      const start = toMinutes(parts[0]);
      const end = toMinutes(parts[1]);
      if (start === null || end === null) continue;

      sawValidWindow = true;
      if (start <= end) {
        if (minutesNow >= start && minutesNow <= end) return true;
      } else if (minutesNow >= start || minutesNow <= end) {
        // Window crosses midnight.
        return true;
      }
    }

    return sawValidWindow ? false : true;
  }
}

/**
 * Ceiling on documents pulled into memory for distance/open-now processing.
 *
 * Opening hours are free text and coordinates are loose fields, so neither can
 * be filtered in the Mongo query; those two paths need documents in memory.
 *
 * This was 3,000 against a 5,707-row collection, so an open-now request
 * silently considered barely half the data and the rest simply did not exist
 * as far as the user was concerned. The cap now sits above the collection
 * size, and hitting it is logged rather than passing unnoticed.
 *
 * At roughly 1KB per lean document this is about 8MB, which is fine on
 * Render's 512MB free tier. If the collection grows past this, the real fix is
 * to precompute opening hours into a queryable field rather than raising the
 * number again.
 */
const MAX_IN_MEMORY = 8000;
