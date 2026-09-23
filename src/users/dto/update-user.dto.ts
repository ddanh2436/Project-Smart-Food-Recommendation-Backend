import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Tastes a profile can list. Real tags from the data, so a preference can be
 * turned straight into a search the API understands.
 */
export const TASTE_TAGS = [
  'Phở',
  'Bún bò Huế',
  'Bún chả',
  'Bún đậu mắm tôm',
  'Cơm tấm',
  'Bánh mì',
  'Hủ tiếu',
  'Mì Quảng',
  'Bánh xèo',
  'Lẩu',
  'Món nướng',
  'Hải sản',
  'Ốc',
  'Ăn vặt',
  'Chè',
  'Cà phê',
  'Trà sữa',
  'Đồ chay',
  'Món Bắc',
  'Món Miền Trung',
  'Món Miền Nam',
  'Cơm văn phòng',
  'Nhậu',
  'Hẹn hò',
] as const;

/** Empty (remove it), an https URL (Google's avatar), or a small inline raster image. */
const PICTURE_PATTERN =
  /^(|https:\/\/[^\s]+|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/;

/** Only self-editable profile fields. Not password, email or username. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  /**
   * Uploaded avatars are stored inline: the browser shrinks them to 256px
   * (about 30 KB) first, so no paid file storage is needed. SVG is refused,
   * since it can carry script.
   */
  @IsOptional()
  @IsString()
  @MaxLength(150_000)
  @Matches(PICTURE_PATTERN, { message: 'picture must be an https URL or a PNG, JPEG or WebP image' })
  picture?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  fullName?: string;

  @IsOptional()
  @IsIn(['', 'hanoi', 'hcmc', 'danang'])
  homeCity?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsIn(TASTE_TAGS, { each: true })
  favoriteTags?: string[];
}
