import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantsService } from './restaurants.service';
import { getModelToken } from '@nestjs/mongoose';
import { Restaurant } from './schemas/restaurant.schema';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { NotFoundException } from '@nestjs/common';

describe('RestaurantsService', () => {
  let service: RestaurantsService;
  let httpService: HttpService;
  let restaurantModel: any;

  const mockRestaurant = {
    _id: 'rest_id_1',
    tenQuan: 'Phở Ngon',
    diemTrungBinh: 9.5,
    gioMoCua: '06:00 - 22:00',
  };

  // Mock chuỗi hàm của Mongoose (find -> sort -> skip -> limit -> exec)
  const mockQuery = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([mockRestaurant]),
  };

  const mockRestaurantModel = {
    find: jest.fn(() => mockQuery),
    findById: jest.fn(),
    countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(10) }),
  };

  const mockHttpService = {
    post: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        { provide: getModelToken(Restaurant.name), useValue: mockRestaurantModel },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
    httpService = module.get<HttpService>(HttpService);
    restaurantModel = module.get(getModelToken(Restaurant.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- TEST FIND ONE ---
  describe('findOne', () => {
    it('should return a restaurant if found', async () => {
      mockRestaurantModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockRestaurant),
      });
      const result = await service.findOne('rest_id_1');
      expect(result).toEqual(mockRestaurant);
    });

    it('should throw NotFoundException if not found', async () => {
      mockRestaurantModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(service.findOne('invalid_id')).rejects.toThrow(NotFoundException);
    });
  });

  // --- TEST FIND ALL (Quan trọng) ---
  describe('findAll', () => {
    it('should return paginated data', async () => {
      const result = await service.findAll(1, 10);
      
      expect(result.data).toEqual([mockRestaurant]);
      expect(result.total).toBe(10);
      expect(restaurantModel.find).toHaveBeenCalled();
      expect(mockQuery.skip).toHaveBeenCalledWith(0);
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
    });
  });

  // --- TEST SEARCH BY IMAGE ---
  describe('searchByImage', () => {
    it('should process image and return sorted restaurants', async () => {
      const mockFile = {
        buffer: Buffer.from('fake-image'),
        originalname: 'pho.jpg',
      } as Express.Multer.File;

      // Mock AI response
      const aiResponse = {
        data: { food_name: 'Pho' },
        status: 200, statusText: 'OK', headers: {}, config: {},
      };
      mockHttpService.post.mockReturnValue(of(aiResponse));

      // Spy findAll để trả về danh sách giả định
      jest.spyOn(service, 'findAll').mockResolvedValue({
        data: [
          { _id: '1', tenQuan: 'Phở Dở', diemTrungBinh: 5.0 },
          { _id: '2', tenQuan: 'Phở Xịn', diemTrungBinh: 9.0 },
        ],
        total: 2, currentPage: 1, totalPages: 1, sortBy: '', order: ''
      });

      const result = await service.searchByImage(mockFile);

      expect(httpService.post).toHaveBeenCalled();
      // Kiểm tra logic sort lại (quán điểm cao lên đầu)
      expect(result.data[0].tenQuan).toBe('Phở Xịn');
      expect(result.detectedFood).toBe('Pho');
    });

    it('should return error message if processing fails', async () => {
       const result = await service.searchByImage(null as any);
       expect(result.message).toContain('Lỗi');
    });
  });

  // --- TEST CHAT WITH AI ---
  describe('chatWithAI', () => {
    it('should return reply and results', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue({
        data: [mockRestaurant],
        total: 1, currentPage: 1, totalPages: 1, sortBy: '', order: ''
      });

      const result = await service.chatWithAI('Tìm quán phở');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.reply).toBeTruthy();
    });
  });
});