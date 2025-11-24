// src/restaurants/restaurants.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';
import { Model } from 'mongoose';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
  ) {}

  create(createRestaurantDto: CreateRestaurantDto) {
    return 'This action adds a new restaurant';
  }

  // --- HÀM PHỤ TRỢ: Kiểm tra giờ mở cửa ---
  private checkIsOpen(gioMoCua: string): boolean {
    if (!gioMoCua) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const ranges = gioMoCua.split(/[|,]/).map(r => r.trim());

    for (const range of ranges) {
      const parts = range.split('-').map(p => p.trim());
      if (parts.length !== 2) continue;
      const [startStr, endStr] = parts;
      const toMinutes = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };
      const start = toMinutes(startStr);
      const end = toMinutes(endStr);

      if (start <= end) {
        if (currentMinutes >= start && currentMinutes <= end) return true;
      } else {
        if (currentMinutes >= start || currentMinutes <= end) return true;
      }
    }
    return false;
  }

  // --- [MỚI] HÀM PHỤ TRỢ: Tính khoảng cách (Công thức Haversine) ---
  private getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Bán kính trái đất (km)
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Khoảng cách (km)
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }

  // --- HÀM CHÍNH: FIND ALL ---
  async findAll(
    page: number = 1, 
    limit: number = 32,
    sortBy: string = 'diemTrungBinh',
    order: string = 'desc',
    rating: string = 'all',
    openNow: string = 'false',
    userLat: string = '', // [MỚI]
    userLon: string = '', // [MỚI]
  ): Promise<any> {
    const skip = (page - 1) * limit;

    // 1. Xử lý Sort Option (DB Sort)
    const sortOptions: any = {};
    const allowedSortFields = [
      'diemTrungBinh', 'diemKhongGian', 'diemViTri', 
      'diemChatLuong', 'diemPhucVu', 'diemGiaCa'
    ];
    const sortField = (allowedSortFields.includes(sortBy) && sortBy !== 'default') ? sortBy : 'diemTrungBinh';
    const sortDirection = order === 'asc' ? 1 : -1;
    sortOptions[sortField] = sortDirection;

    // 2. Xử lý Filter (Rating)
    const filterQuery: any = {};
    const scoreFieldToCheck = sortField; 

    if (rating && rating !== 'all') {
      switch (rating) {
        case 'gte9': filterQuery[scoreFieldToCheck] = { $gte: 9.0 }; break;
        case '8to9': filterQuery[scoreFieldToCheck] = { $gte: 8.0, $lt: 9.0 }; break;
        case '7to8': filterQuery[scoreFieldToCheck] = { $gte: 7.0, $lt: 8.0 }; break;
        case '6to7': filterQuery[scoreFieldToCheck] = { $gte: 6.0, $lt: 7.0 }; break;
        case 'lt6': filterQuery[scoreFieldToCheck] = { $lt: 6.0 }; break;
      }
    }

    // 3. Xác định chế độ xử lý (Manual vs DB)
    // Nếu cần Lọc OpenNow HOẶC Sort theo Distance -> Phải xử lý thủ công (Manual)
    const isSortDistance = sortBy === 'distance' && userLat && userLon;
    const isOpenNow = openNow === 'true';
    
    const isManualProcessing = isOpenNow || isSortDistance;

    let data: any[] = [];
    let total = 0;

    if (isManualProcessing) {
      // === LOGIC XỬ LÝ THỦ CÔNG ===
      
      // B1: Lấy TẤT CẢ bản ghi thỏa mãn Filter điểm số
      let allCandidates = await this.restaurantModel
        .find(filterQuery)
        .lean() // Dùng lean() để trả về object JS thuần, dễ gắn thêm thuộc tính distance
        .exec();

      // B2: Tính khoảng cách (Nếu cần)
      if (userLat && userLon) {
        const uLat = parseFloat(userLat);
        const uLon = parseFloat(userLon);
        
        allCandidates = allCandidates.map((res: any) => {
          // [CẢI TIẾN] Chuyển đổi dấu phẩy thành dấu chấm trước khi parse
          const parseCoord = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
            return 0;
          };

          const resLat = parseCoord(res.lat);
          const resLon = parseCoord(res.lon);

          const dist = (resLat && resLon) 
            ? this.getDistanceFromLatLonInKm(uLat, uLon, resLat, resLon)
            : 99999; // Nếu lỗi tọa độ thì đẩy xuống cuối
          return { ...res, distance: dist };
        });
      }
      // B3: Lọc Open Now (Nếu có)
      if (isOpenNow) {
        allCandidates = allCandidates.filter((res: any) => this.checkIsOpen(res.gioMoCua));
      }

      // B4: Sắp xếp (Sort)
      if (isSortDistance) {
        // Sort theo khoảng cách (Mặc định là tăng dần - gần nhất trước)
        // Nếu user chọn 'desc' thì đảo ngược (xa nhất trước)
        allCandidates.sort((a: any, b: any) => {
          return order === 'asc' ? (a.distance - b.distance) : (b.distance - a.distance);
        });
      } else {
        // Sort theo các tiêu chí điểm số khác (nếu chỉ lọc OpenNow)
        allCandidates.sort((a: any, b: any) => {
          const valA = a[sortField] || 0;
          const valB = b[sortField] || 0;
          return sortDirection === 1 ? valA - valB : valB - valA;
        });
      }

      total = allCandidates.length;
      // B5: Phân trang (Slice)
      data = allCandidates.slice(skip, skip + limit);

    } else {
      // === LOGIC DB THUẦN TÚY (Nhanh hơn) ===
      total = await this.restaurantModel.countDocuments(filterQuery).exec();
      data = await this.restaurantModel
        .find(filterQuery)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .exec();
    }

    return {
      data,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      sortBy: sortBy,
      order: order
    };
  }

  // ... (Các hàm findOne, update, remove giữ nguyên)
  async findOne(id: string): Promise<Restaurant> {
    const restaurant = await this.restaurantModel.findById(id).exec();
    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${id} not found`);
    }
    return restaurant;
  }

  update(id: number, updateRestaurantDto: UpdateRestaurantDto) {
    return `This action updates a #${id} restaurant`;
  }

  remove(id: number) {
    return `This action removes a #${id} restaurant`;
  }
}