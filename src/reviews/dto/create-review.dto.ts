import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * This DTO previously had no validation decorators at all. Combined with a
 * ValidationPipe that did not whitelist, that meant any JSON body was accepted
 * and written to the database — including the `aiSentimentLabel` and
 * `aiSentimentScore` fields, which a client could set to anything it liked,
 * and unbounded `noiDung` strings.
 */
export class CreateReviewDto {
  /**
   * Accepted for older clients and then ignored: the stored name is read from
   * the restaurant the review points at, so a review cannot be filed under a
   * name the restaurant does not have.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tenQuan?: string;

  /** Links the review to its restaurant. */
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  @MaxLength(500)
  urlGoc: string;

  @IsInt()
  @Min(1)
  @Max(10)
  diemReview: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Please write at least 10 characters' })
  @MaxLength(3000)
  noiDung: string;
}
