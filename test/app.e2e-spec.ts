import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Needs a reachable MONGODB_URI (a local mongod or an Atlas test cluster),
 * because AppModule connects on boot. Run with: npm run test:e2e
 */
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET / returns service info', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);
    expect(response.body.name).toBe('VietNomNom API');
  });

  it('GET /health reports database state', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(response.body).toHaveProperty('status');
    expect(response.body.database).toHaveProperty('state');
  });

  describe('authorization', () => {
    it('GET /users/me requires a token', () =>
      request(app.getHttpServer()).get('/users/me').expect(401));

    // Regression guard: this route was fully public and dumped every user.
    it('GET /users/:id requires a token', () =>
      request(app.getHttpServer())
        .get('/users/507f1f77bcf86cd799439011')
        .expect(401));

    it('DELETE /users/:id requires a token', () =>
      request(app.getHttpServer())
        .delete('/users/507f1f77bcf86cd799439011')
        .expect(401));

    // Regression guard: this triggered a full-collection AI backfill for anyone.
    it('POST /reviews/migrate-sentiment requires an admin token', async () => {
      const response = await request(app.getHttpServer()).post(
        '/reviews/migrate-sentiment',
      );
      expect([401, 503]).toContain(response.status);
    });
  });

  describe('input validation', () => {
    it('rejects an out-of-range page size', () =>
      request(app.getHttpServer())
        .get('/restaurants?limit=999999')
        .expect(400));

    it('rejects an unknown sort field', () =>
      request(app.getHttpServer())
        .get('/restaurants?sortBy=__proto__')
        .expect(400));

    it('rejects a review with no content', () =>
      request(app.getHttpServer())
        .post('/reviews')
        .send({ tenQuan: 'X', urlGoc: 'https://foody.vn/x', diemReview: 5 })
        .expect(400));

    it('strips unknown fields instead of writing them through', () =>
      request(app.getHttpServer())
        .post('/reviews')
        .send({
          tenQuan: 'X',
          urlGoc: 'https://foody.vn/x',
          diemReview: 5,
          noiDung: 'A perfectly reasonable review body.',
          aiSentimentLabel: 'POS',
        })
        .expect(400)); // forbidNonWhitelisted rejects the injected field
  });
});
