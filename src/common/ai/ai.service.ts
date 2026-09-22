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
  food_name: string | null;
  original_name?: string;
  confidence?: number;
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
            headers: formData.getHeaders(),
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
