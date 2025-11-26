// src/restaurants/restaurants.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios'; // Cần import HttpModule trong Module
import { firstValueFrom } from 'rxjs';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    private readonly httpService: HttpService,
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

  // --- HÀM PHỤ TRỢ: Tính khoảng cách (Haversine) ---
  private getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Bán kính trái đất (km)
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
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
    userLat: string = '', 
    userLon: string = '',
    search: string = '',
  ): Promise<any> {
    // [FIX QUAN TRỌNG] Ép kiểu số để tránh lỗi cộng chuỗi (32 + 32 = "3232")
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 32;
    const skip = (pageNum - 1) * limitNum;

    // 1. Setup Sort
    const sortOptions: any = {};
    const allowedSortFields = [
      'diemTrungBinh', 'diemKhongGian', 'diemViTri', 
      'diemChatLuong', 'diemPhucVu', 'diemGiaCa'
    ];
    const sortField = (allowedSortFields.includes(sortBy) && sortBy !== 'default') ? sortBy : 'diemTrungBinh';
    const sortDirection = order === 'asc' ? 1 : -1;
    sortOptions[sortField] = sortDirection;

    // 2. Setup Filter
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

    // [LOGIC GỌI AI]
    let aiIndexMap: Record<string, number> = {};
    let isAiSearch = false;
    if (search && search.trim() !== '') {
      isAiSearch = true;
      try {
        const payload = {
            query: search,
            // Gửi GPS sang AI nếu có
            user_gps: (userLat && userLon) ? [parseFloat(userLat), parseFloat(userLon)] : null
        };
        const aiResponse = await firstValueFrom(
          this.httpService.post('http://127.0.0.1:5000/recommend', payload)
        );
        
        const recommendedItems = aiResponse.data.scores || [];
        const recommendedIds = recommendedItems.map((item: any) => item.id);

        if (recommendedIds.length > 0) {
           filterQuery['_id'] = { $in: recommendedIds }; // Lọc theo ID AI trả về
           recommendedItems.forEach((item: any, index: number) => {
               aiIndexMap[item.id] = index;
               });
        } else {
           // AI không tìm thấy gì -> Trả về rỗng
           return { data: [], total: 0, currentPage: pageNum, totalPages: 0 }; 
        }
      } catch (error) {
        console.error("Lỗi kết nối AI:", error.message);
        // Fallback: Tìm kiếm thường bằng Regex
        filterQuery['tenQuan'] = { $regex: search, $options: 'i' };
      }
    }

    // 3. Xác định chế độ xử lý
    const isOpenNowBool = openNow === 'true';
    const isSortDistance = sortBy === 'distance' && userLat && userLon;
    // Nếu cần Sort Distance, Lọc OpenNow, hoặc là kết quả từ AI -> Xử lý thủ công
    const isManualProcessing = isOpenNowBool || isSortDistance || isAiSearch;

    let data: any[] = [];
    let total = 0;

    if (isManualProcessing) {
      // --- MANUAL PROCESSING ---
      let allCandidates = await this.restaurantModel
        .find(filterQuery)
        .lean()
        .exec();

      // Tính khoảng cách (nếu có tọa độ user)
      if (userLat && userLon) {
        const uLat = parseFloat(userLat);
        const uLon = parseFloat(userLon);
        
        allCandidates = allCandidates.map((res: any) => {
          const parseCoord = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
            return 0;
          };
          const resLat = parseCoord(res.lat);
          const resLon = parseCoord(res.lon);
          const dist = (resLat && resLon) ? this.getDistanceFromLatLonInKm(uLat, uLon, resLat, resLon) : 99999;
          return { ...res, distance: dist };
        });
      }

      // Lọc Open Now
      if (isOpenNowBool) {
        allCandidates = allCandidates.filter((res: any) => this.checkIsOpen(res.gioMoCua));
      }

      // Sắp xếp
     if (isAiSearch && sortBy === 'diemTrungBinh') {
         // NẾU LÀ TÌM KIẾM AI VÀ NGƯỜI DÙNG KHÔNG CHỌN SORT CỤ THỂ KHÁC
         // -> TUÂN THỦ TUYỆT ĐỐI THỨ TỰ CỦA AI (Index 0 lên đầu)
         allCandidates.sort((a: any, b: any) => {
            const idxA = aiIndexMap[a._id.toString()] ?? 9999;
            const idxB = aiIndexMap[b._id.toString()] ?? 9999;
            return idxA - idxB;
         });

      } else if (isSortDistance) {
         // Sort khoảng cách (khi user bấm nút "Gần tôi" trên UI)
         allCandidates.sort((a: any, b: any) => {
            return order === 'asc' ? (a.distance - b.distance) : (b.distance - a.distance);
         });
      } else {
         // Sort thường theo các tiêu chí khác (Giá, Không gian...)
         allCandidates.sort((a: any, b: any) => {
            const valA = a[sortField] || 0;
            const valB = b[sortField] || 0;
            return sortDirection === 1 ? valA - valB : valB - valA;
         });
      }

      total = allCandidates.length;
      data = allCandidates.slice(skip, skip + limitNum);
    } else {
      // --- DB QUERY (Tối ưu) ---
      total = await this.restaurantModel.countDocuments(filterQuery).exec();
      data = await this.restaurantModel
        .find(filterQuery)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum) // [FIX]
        .exec();
    }

    return {
      data,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      sortBy: sortBy,
      order: order
    };
  }

  async findOne(id: string): Promise<Restaurant> {
    const restaurant = await this.restaurantModel.findById(id).exec();
    if (!restaurant) throw new NotFoundException(`Restaurant with ID ${id} not found`);
    return restaurant;
  }
  update(id: number, updateRestaurantDto: UpdateRestaurantDto) { return `This action updates a #${id} restaurant`; }
  remove(id: number) { return `This action removes a #${id} restaurant`; }
}