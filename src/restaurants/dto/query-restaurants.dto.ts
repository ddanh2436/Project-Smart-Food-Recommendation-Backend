import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type SortField =
  | 'diemTrungBinh'
  | 'diemKhongGian'
  | 'diemViTri'
  | 'diemChatLuong'
  | 'diemPhucVu'
  | 'diemGiaCa';

const SORT_VALUES = [
  'diemTrungBinh',
  'diemKhongGian',
  'diemViTri',
  'diemChatLuong',
  'diemPhucVu',
  'diemGiaCa',
  'distance',
  'default',
];

/**
 * Validated query parameters for GET /restaurants.
 *
 * The controller previously declared ten loose `@Query()` strings and passed
 * them positionally into the service, so `?page=abc&limit=99999` reached the
 * database unchecked and a reordered argument list would have silently swapped
 * latitude for longitude.
 */
export class QueryRestaurantsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 32;

  @IsOptional()
  @IsIn(SORT_VALUES)
  sortBy?: string = 'diemTrungBinh';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsIn(['all', 'gte9', '8to9', '7to8', '6to7', 'lt6'])
  rating?: string = 'all';

  // Query strings arrive as 'true'/'false', which IsBoolean would reject.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  openNow?: boolean = false;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  userLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  userLon?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(['hanoi', 'hcmc', 'danang', ''])
  city?: string;
}
