import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RestaurantDocument = HydratedDocument<Restaurant>;

@Schema({ collection: 'restaurants' })
export class Restaurant {
  @Prop()
  tenQuan: string;

  @Prop()
  diemTrungBinh: number; // Đổi sang number để tính toán nếu cần

  @Prop()
  diaChi: string;

  @Prop()
  gioMoCua: string;

  @Prop()
  giaCa: string;

  // --- CÁC TRƯỜNG MỚI ---
  @Prop()
  lat: number; // Vĩ độ

  @Prop()
  lon: number; // Kinh độ

  @Prop()
  diemKhongGian: number;

  @Prop()
  diemViTri: number;

  @Prop()
  diemChatLuong: number;

  @Prop()
  diemPhucVu: number;

  @Prop()
  diemGiaCa: number;

  @Prop()
  avatarUrl: string; // Link ảnh đại diện

  @Prop()
  urlGoc: string; // Link gốc Foody
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);
