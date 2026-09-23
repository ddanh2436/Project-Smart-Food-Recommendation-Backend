import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

export interface AiRecommendation {
  id: string;
  name: string;
  tags: string;
  S_taste: number;
  distance_km: number;
  price: number;
  address?: string;
  district?: string;
  city?: string;
  rating?: number;
  /** Why this row is in the answer, and what to know before going. Facts, not
   *  sentences: the client words them in whichever language it is showing. */
  reasons?: Array<Record<string, unknown>>;
  cautions?: Array<Record<string, unknown>>;
}

export interface AiRecommendResponse {
  sort_by: string;
  scores: AiRecommendation[];
  total_matches?: number;
  intent?: Record<string, unknown>;
  relaxed_filters?: string[];
}

export interface AiSentiment {
  label: string;
  score: number;
  available?: boolean;
}

/** A quick reply under a chat answer: `label` is shown, `query` is sent. */
export interface AiChatChip {
  label: string;
  query: string;
}

export interface AiChatResponse {
  reply: string;
  results: AiRecommendation[];
  kind: string;
  intent?: Record<string, unknown>;
  total_matches?: number;
  relaxed_filters?: string[];
  /** Which of dish / area / price the query left unset. */
  slots_missing?: string[];
  chips?: AiChatChip[];
}

export interface AiFoodPrediction {
  /** Null unless a dish is actually being asserted (tiers confident/uncertain). */
  food_name: string | null;
  original_name?: string;
  confidence?: number;
  /** How much to trust the guess. The client words the reply from this. */
  tier?: 'confident' | 'uncertain' | 'group' | 'none';
  /** The kind of food it looks like, when the dish itself is not certain. */
  group?: 'soup' | 'dry' | null;
  /** Dishes worth offering next, as Vietnamese search terms. */
  suggestions?: string[];
  detections?: Array<{
    food_name: string;
    original_name: string;
    confidence: number;
  }>;
}

/**
 * Single client for the FastAPI AI service.
 *
 * The URL, timeouts and error handling used to be duplicated across
 * RestaurantsService and ReviewsService, each reading `process.env` directly and
 * each logging differently. Centralising it means one place to change, and
 * consistent graceful degradation when the AI service is asleep — which matters
 * because a free Hugging Face Space cold-starts in tens of seconds.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The shared secret the AI service requires on every data endpoint.
   *
   * The Space is public, so without it anyone could call the AI directly and
   * skip every limit this API enforces — including the review-insights
   * endpoint, where one request can hold the Space's only CPU for minutes.
   * Sent only when configured, so a rollout can set it here first and on the
   * Space second without an outage in between.
   */
  private get authHeaders(): Record<string, string> {
    const token = this.configService.get<string>('INTERNAL_API_TOKEN');
    return token ? { 'x-internal-token': token } : {};
  }

  get baseUrl(): string {
    const url =
      this.configService.get<string>('AI_SERVICE_URL') ??
      'http://127.0.0.1:5000';
    return url.replace(/\/+$/, '');
  }

  async recommend(payload: {
    query: string;
    user_gps?: [number, number] | null;
    city_filter?: string | null;
    limit?: number;
  }): Promise<AiRecommendResponse | null> {
    return this.post<AiRecommendResponse>('/recommend', payload, 30_000);
  }

  async chat(payload: {
    message: string;
    history?: Array<{ role: 'user' | 'bot'; text: string }>;
    user_gps?: [number, number] | null;
    lang?: string;
    limit?: number;
  }): Promise<AiChatResponse | null> {
    return this.post<AiChatResponse>('/chat', payload, 30_000);
  }

  /**
   * Classify one review. Returns a neutral placeholder on failure so that a
   * sleeping AI service cannot block a user from posting a review.
   */
  async sentiment(review: string): Promise<AiSentiment> {
    const result = await this.post<AiSentiment>(
      '/sentiment',
      { review },
      20_000,
    );
    return result ?? { label: 'NEU', score: 0.5, available: false };
  }

  /** Classify many reviews in one request. */
  async sentimentBatch(reviews: string[]): Promise<AiSentiment[]> {
    const result = await this.post<{ results: AiSentiment[] }>(
      '/sentiment/batch',
      { reviews },
      120_000,
    );
    return (
      result?.results ??
      reviews.map(() => ({ label: 'NEU', score: 0.5, available: false }))
    );
  }

  async reviewInsights(
    reviews: Array<{ noiDung: string; diemReview?: number }>,
    lang = 'vi',
  ): Promise<Record<string, unknown> | null> {
    return this.post('/review-insights', { reviews, lang }, 60_000);
  }

  async predictFood(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<AiFoodPrediction | null> {
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: filename || 'upload.jpg',
      contentType: mimetype || 'image/jpeg',
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post<AiFoodPrediction>(
          `${this.baseUrl}/predict-food`,
          formData,
          {
            headers: { ...formData.getHeaders(), ...this.authHeaders },
            timeout: 60_000,
            maxBodyLength: Infinity,
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logFailure('/predict-food', error);
      return null;
    }
  }

  private async post<T>(
    path: string,
    payload: unknown,
    timeout: number,
  ): Promise<T | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(`${this.baseUrl}${path}`, payload, {
          timeout,
          headers: this.authHeaders,
        }),
      );
      return response.data;
    } catch (error) {
      this.logFailure(path, error);
      return null;
    }
  }

  private logFailure(path: string, error: unknown): void {
    const axiosError = error as AxiosError;
    if (axiosError?.code === 'ECONNABORTED') {
      this.logger.warn(
        `AI ${path} timed out. A free Hugging Face Space may be cold-starting.`,
      );
      return;
    }
    const status = axiosError?.response?.status;
    this.logger.warn(
      `AI ${path} failed${status ? ` (HTTP ${status})` : ''}: ${
        axiosError?.message ?? String(error)
      }`,
    );
  }
}
