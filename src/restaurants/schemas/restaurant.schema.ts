// src/restaurants/schemas/restaurant.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RestaurantDocument = HydratedDocument<Restaurant>;

@Schema({ collection: 'restaurants' }) // Chỉ định tên collection là 'restaurants'
export class Restaurant {
  // Các @Prop() này phải KHỚP với header trong file CSV của bạn
  @Prop()
  tenQuan: string;

  @Prop()
  diemTrungBinh: string;

  @Prop()
  diaChi: string;

  @Prop()
  gioMoCua: string;

  @Prop()
  giaCa: string;

  @Prop()
  diemKhongGian: string;

  @Prop()
  diemViTri: string;

  @Prop()
  diemChatLuong: string;

  @Prop()
  diemPhucVu: string;

  @Prop()
  diemGiaCa: string;

  @Prop()
  url: string;
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);