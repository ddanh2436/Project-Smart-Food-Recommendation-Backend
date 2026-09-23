import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

/**
 * Pins the review-integrity rules: a review needs a real restaurant, takes its
 * name from the database, carries the member's username, and a member gets one
 * review per restaurant.
 */
describe('ReviewsService', () => {
  const restaurantUrl = 'https://www.foody.vn/ho-chi-minh/quan-that';

  function build(options: { restaurant?: unknown; existing?: boolean; saveError?: unknown } = {}) {
    const saved: Record<string, unknown>[] = [];
    function ReviewModel(this: any, doc: Record<string, unknown>) {
      Object.assign(this, doc);
      this.save = async () => {
        if (options.saveError) throw options.saveError;
        saved.push(doc);
        return doc;
      };
    }
    (ReviewModel as any).exists = jest.fn().mockResolvedValue(options.existing ? { _id: 'x' } : null);
    (ReviewModel as any).findById = jest.fn().mockReturnValue({ exec: async () => null });

    const restaurantModel = {
      findOne: jest.fn().mockReturnValue({
        select: () => ({ lean: () => ({ exec: async () => options.restaurant ?? null }) }),
      }),
    };
    const aiService = { sentiment: jest.fn().mockResolvedValue({ label: 'POS', score: 0.99 }) };

    const service = new ReviewsService(ReviewModel as any, restaurantModel as any, aiService as any);
    return { service, saved, aiService };
  }

  const dto = { urlGoc: restaurantUrl, diemReview: 9, noiDung: 'Món ăn rất ngon, phục vụ nhanh', tenQuan: 'Tên giả mạo' };
  const author = { id: 'user-1', name: 'duyanh' };

  it('rejects a review for a restaurant that does not exist', async () => {
    const { service, aiService } = build({ restaurant: null });
    await expect(service.create(dto, author)).rejects.toBeInstanceOf(NotFoundException);
    expect(aiService.sentiment).not.toHaveBeenCalled();
  });

  it('stores the restaurant name from the database, not the one in the request', async () => {
    const { service, saved } = build({ restaurant: { tenQuan: 'Quán Thật' } });
    await service.create(dto, author);
    expect(saved[0].tenQuan).toBe('Quán Thật');
  });

  it('publishes the username as the author, never part of the email', async () => {
    const { service, saved } = build({ restaurant: { tenQuan: 'Quán Thật' } });
    await service.create(dto, author);
    expect(saved[0].authorName).toBe('duyanh');
    expect(saved[0].authorId).toBe('user-1');
  });

  it('refuses a second review of the same restaurant by the same member', async () => {
    const { service } = build({ restaurant: { tenQuan: 'Quán Thật' }, existing: true });
    await expect(service.create(dto, author)).rejects.toBeInstanceOf(ConflictException);
  });

  it('turns a lost race on the unique index into a conflict, not a 500', async () => {
    const { service } = build({ restaurant: { tenQuan: 'Quán Thật' }, saveError: { code: 11000 } });
    await expect(service.create(dto, author)).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers a malformed review id with 400 instead of a CastError', async () => {
    const { service } = build();
    await expect(service.deleteOwn('not-an-id', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
