import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';

export class ChatTurnDto {
  @IsIn(['user', 'bot'])
  role: 'user' | 'bot';

  @IsString()
  @MaxLength(1000)
  text: string;
}

export class ChatRestaurantsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message: string;

  /** Prior turns, so the assistant can resolve follow-ups like "rẻ hơn". */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  userLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  userLon?: number;

  @IsOptional()
  @IsIn(['vi', 'en'])
  lang?: 'vi' | 'en' = 'vi';
}
