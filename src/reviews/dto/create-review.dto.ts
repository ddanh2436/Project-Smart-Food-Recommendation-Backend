export class CreateReviewDto {
  tenQuan: string;
  urlGoc: string;
  diemReview: number;
  noiDung: string;
  aiSentimentLabel?: string;
  aiSentimentScore?: number;
}