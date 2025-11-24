// src/restaurants/schemas/restaurant.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RestaurantDocument = HydratedDocument<Restaurant>;

@Schema({ collection: 'restaurants' })
export class Restaurant {
  @Prop() tenQuan: string;
  @Prop() diemTrungBinh: number;
  @Prop() diaChi: string;
  @Prop() gioMoCua: string;
  @Prop() giaCa: string;
  @Prop() tags: string; // [QUAN TRỌNG CHO AI]

  @Prop() lat: number;
  @Prop() lon: number;
  @Prop() diemKhongGian: number;
  @Prop() diemViTri: number;
  @Prop() diemChatLuong: number;
  @Prop() diemPhucVu: number;
  @Prop() diemGiaCa: number;
  @Prop() avatarUrl: string;
  @Prop() urlGoc: string;
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);