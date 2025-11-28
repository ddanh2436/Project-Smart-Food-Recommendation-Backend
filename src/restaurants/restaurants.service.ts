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

    // 2. Setup Filter Rating
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

    // [LOGIC TÌM KIẾM NGHIÊM NGẶT (STRICT SEARCH)]
    let aiIndexMap: Record<string, number> = {};
    let isAiSearch = false;

    if (search && search.trim() !== '') {
      isAiSearch = true;
      
      // Tách từ khóa bằng dấu phẩy (xử lý cả trường hợp nhiều dấu phẩy hoặc khoảng trắng)
      // Ví dụ: "Miền Nam, Phở , Sang trọng" -> ["Miền Nam", "Phở", "Sang trọng"]
      const keywords = search.split(/[,]+/).map(k => k.trim()).filter(k => k.length > 0);

      // --- Bước A: Gọi AI (Lấy ID ranking) ---
      // Mục đích: Lấy danh sách ID phù hợp nhất theo ngữ nghĩa để ưu tiên hiển thị
      let recommendedIds: string[] = [];
      try {
        const payload = {
            query: search,
            user_gps: (userLat && userLon) ? [parseFloat(userLat), parseFloat(userLon)] : null
        };
        // Timeout ngắn để tránh treo nếu AI chậm
        const aiResponse = await firstValueFrom(
          this.httpService.post('http://127.0.0.1:5000/recommend', payload, { timeout: 3000 })
        );
        const recommendedItems = aiResponse.data.scores || [];
        recommendedIds = recommendedItems.map((item: any) => item.id);
        
        if (recommendedIds.length > 0) {
           // Lưu lại thứ tự của AI để sort sau này
           recommendedItems.forEach((item: any, index: number) => {
               aiIndexMap[item.id] = index;
           });
           
           // [QUAN TRỌNG] Chỉ thêm điều kiện lọc theo ID nếu tìm thấy
           filterQuery['_id'] = { $in: recommendedIds };
        }
      } catch (error) {
        console.warn("AI Service skip:", error.message);
        // Nếu AI lỗi, bỏ qua filter ID, hệ thống sẽ tự tìm trong toàn bộ DB dựa vào keywords bên dưới
      }

      // --- Bước B: Bộ lọc Từ khóa Bắt buộc ($and) ---
      // Đây là chốt chặn cuối cùng: Dù AI gợi ý gì, quán phải chứa TẤT CẢ từ khóa
      if (keywords.length > 0) {
        if (!filterQuery['$and']) {
            filterQuery['$and'] = [];
        }

        keywords.forEach(keyword => {
            // Escape ký tự đặc biệt trong regex để tránh lỗi (vd: dấu ngoặc, cộng, sao...)
            const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Tạo điều kiện: (Tags chứa từ khóa) HOẶC (Tên quán chứa từ khóa)
            filterQuery['$and'].push({
                $or: [
                    { tags: { $regex: safeKeyword, $options: 'i' } },
                    { tenQuan: { $regex: safeKeyword, $options: 'i' } }
                ]
            });
        });
      }
    }

    // 3. Chế độ xử lý (Manual vs DB)
    const isOpenNowBool = openNow === 'true';
    const isSortDistance = sortBy === 'distance' && userLat && userLon;
    // Nếu có AI search, ta cũng dùng manual processing để sort lại theo thứ tự AI
    const isManualProcessing = isOpenNowBool || isSortDistance || isAiSearch;

    let data: any[] = [];
    let total = 0;

    if (isManualProcessing) {
      // --- MANUAL PROCESSING ---
      // Lấy dữ liệu thô từ DB (đã lọc sơ bộ bằng filterQuery gồm ID và Keywords)
      let allCandidates = await this.restaurantModel
        .find(filterQuery)
        .lean()
        .exec();

      // Tính khoảng cách
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

      // Lọc giờ mở cửa
      if (isOpenNowBool) {
        allCandidates = allCandidates.filter((res: any) => this.checkIsOpen(res.gioMoCua));
      }

      // Sắp xếp
      if (isAiSearch && sortBy === 'diemTrungBinh') {
         // Ưu tiên thứ tự từ AI (nếu có trong map), nếu không thì để cuối
         allCandidates.sort((a: any, b: any) => {
            const idxA = aiIndexMap[a._id.toString()] !== undefined ? aiIndexMap[a._id.toString()] : 99999;
            const idxB = aiIndexMap[b._id.toString()] !== undefined ? aiIndexMap[b._id.toString()] : 99999;
            return idxA - idxB;
         });
      } else if (isSortDistance) {
         allCandidates.sort((a: any, b: any) => {
            return order === 'asc' ? (a.distance - b.distance) : (b.distance - a.distance);
         });
      } else {
         allCandidates.sort((a: any, b: any) => {
            const valA = a[sortField] || 0;
            const valB = b[sortField] || 0;
            return sortDirection === 1 ? valA - valB : valB - valA;
         });
      }

      total = allCandidates.length;
      data = allCandidates.slice(skip, skip + limitNum);
    } else {
      // --- DB QUERY THUẦN TÚY (Tối ưu tốc độ) ---
      total = await this.restaurantModel.countDocuments(filterQuery).exec();
      data = await this.restaurantModel
        .find(filterQuery)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
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