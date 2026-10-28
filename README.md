# VietNomNom — Backend API

API NestJS + MongoDB của VietNomNom. Backend lo đăng nhập, dữ liệu quán và review, chấm điểm hiệu chỉnh, và là
cầu nối duy nhất tới AI service.

- Chạy thật: <https://project-smart-food-recommendation-backend.onrender.com> (Render)
- Frontend: [Project-Smart-Food-Recommendation-Frontend](https://github.com/ddanh2436/Project-Smart-Food-Recommendation-Frontend)
- AI service: [Project-Smart-Food-Recommendation-AI](https://github.com/ddanh2436/Project-Smart-Food-Recommendation-AI)
- Triển khai: [DEPLOY.md](./DEPLOY.md)

```text
Frontend (Vercel) ──▶ Backend (Render) ──▶ MongoDB Atlas
                            │
                            └──▶ AI service (HF Space): tìm kiếm · chat · cảm xúc review · nhận diện ảnh
```

Mọi lời gọi AI đều đi qua `src/common/ai/ai.service.ts`, nơi duy nhất biết URL, timeout và cách xử lý lỗi của AI
service. Space miễn phí có thể đang ngủ và mất khoảng 50 giây để dậy, nên mỗi lời gọi AI đều có đường lùi: tìm kiếm
quay về khớp tên, review vẫn được lưu và gán nhãn cảm xúc sau.

## Điểm hiệu chỉnh

Điểm gốc lấy từ Foody không so được giữa các quán, vì quán điểm cao nhất thường lại là quán ít review nhất.
`rating-stats.service.ts` kéo điểm của từng quán về mức trung bình toàn hệ thống, kéo mạnh hay nhẹ tuỳ số review
(`CONFIDENCE = 5`), rồi ghi vào `diemTrungBinhAdj` và các điểm con `...Adj`. Danh sách, trang chủ, chatbot và trang
quán đều hiển thị và sắp xếp theo điểm này. Chạy lại sau khi nhập thêm dữ liệu:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" $BACKEND_URL/restaurants/admin/rating-stats
```

## Endpoint

🔒 cần Bearer access token · 🔑 cần `x-admin-token` · giới hạn tính theo IP

### Auth

| Method | Path | Ghi chú |
| --- | --- | --- |
| `POST` | `/auth/register` | 5/phút |
| `POST` | `/auth/login` | 10/phút |
| `POST` | `/auth/refresh` | 30/phút; chỉ nhận refresh token, user lấy từ payload đã xác thực |
| `POST` | `/auth/logout` | 🔒 xoá hash refresh token đã lưu |
| `POST` | `/auth/change-password` | 🔒 10/phút |
| `GET` `PATCH` | `/auth/profile` | 🔒 |
| `GET` | `/auth/google` → `/auth/google/callback` | token trả về trong **fragment** của URL |

### Quán

| Method | Path | Ghi chú |
| --- | --- | --- |
| `GET` | `/restaurants` | lọc, sắp xếp, phân trang; có `search` thì AI xếp hạng; có `userLat`/`userLon` thì ưu tiên quán gần |
| `GET` | `/restaurants/:id` | |
| `GET` | `/restaurants/:id/similar` | quán tương tự, cùng quận nếu đủ, không thì cùng thành phố |
| `GET` | `/restaurants/compare?ids=` | so sánh 2–3 quán |
| `GET` | `/restaurants/suggestions` | đang mở, hợp bữa hiện tại, gần bạn |
| `GET` | `/restaurants/surprise` | một quán ngẫu nhiên phù hợp; 30/phút |
| `GET` | `/restaurants/nearby?lat=&lon=&radius=` | |
| `POST` | `/restaurants/chat` | chatbot, nhận `history`; 20/phút và 300/ngày |
| `POST` | `/restaurants/search-by-image` | tối đa 8 MB, chỉ nhận ảnh; 10/phút |
| `GET` `POST` | `/restaurants/admin/rating-stats` | 🔑 xem / tính lại điểm hiệu chỉnh |

### Review

| Method | Path | Ghi chú |
| --- | --- | --- |
| `GET` | `/reviews?url=` | review của một quán |
| `GET` | `/reviews/insights?url=` | tóm tắt theo khía cạnh do AI tạo |
| `GET` | `/reviews/mine` | 🔒 |
| `POST` | `/reviews` | 🔒 5/phút; mỗi tài khoản một review cho mỗi quán |
| `DELETE` | `/reviews/:id` | 🔒 chỉ xoá review của chính mình |
| `POST` | `/reviews/migrate-sentiment` | 🔑 gán nhãn cảm xúc cho review chưa có nhãn |

### Khác

| Method | Path | Ghi chú |
| --- | --- | --- |
| `GET` | `/users/me`, `/users/:id` | 🔒 chỉ tài khoản của chính mình |
| `GET` | `/health` | trạng thái DB; Render dùng để health check, không bị giới hạn |
| `GET` | `/admin/client-ip` | 🔑 kiểm tra `TRUST_PROXY_HOPS` sau khi deploy |

## Cấu hình

Chép `.env.example` thành `.env`. Ứng dụng **dừng ngay khi khởi động** nếu thiếu `MONGODB_URI`, `JWT_SECRET` hoặc
`JWT_REFRESH_SECRET`, hoặc nếu hai JWT secret trùng nhau (khi đó access token sẽ được chấp nhận như refresh token).

| Biến | Ghi chú |
| --- | --- |
| `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` | bắt buộc |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | thời hạn token |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BACKEND_URL` | đăng nhập Google |
| `FRONTEND_URL`, `CORS_ORIGINS` | origin được phép gọi API |
| `VERCEL_PREVIEW_PROJECT`, `VERCEL_TEAM_SLUG` | cho phép preview deploy của đúng project này |
| `AI_SERVICE_URL`, `INTERNAL_API_TOKEN` | địa chỉ AI service và token dùng chung với nó |
| `ADMIN_TOKEN` | cho các route 🔑 |
| `TRUST_PROXY_HOPS` | số proxy phía trước (Render: `1`) để giới hạn request nhận đúng IP người dùng |
| `PORT`, `NODE_ENV` | |

## Phát triển

```bash
npm install
npm run start:dev     # http://localhost:3001, tự reload
npm run build && npm run start:prod
npm test              # unit test
npm run test:e2e      # cần MONGODB_URI truy cập được
npm run typecheck
npm run lint
```

`scripts/dup-scan.js` (chỉ đọc) và `scripts/dedupe-restaurants.js` dùng để tìm và gộp các quán bị trùng `urlGoc`.

## Bảo mật

- Mật khẩu và refresh token được hash bằng bcrypt. Đăng nhập sai email hay sai mật khẩu đều trả cùng một lỗi 401,
  nên không dò được email nào đã đăng ký.
- `ValidationPipe` chạy với `whitelist` + `forbidNonWhitelisted`: trường lạ trong body bị từ chối, không lọt được vào
  Mongoose.
- Chuỗi tìm kiếm của người dùng được escape trước khi đưa vào `$regex`. `limit` bị giới hạn tối đa 100.
- `helmet`, CORS theo danh sách cho phép, rate limit toàn cục 120 request/phút cộng giới hạn riêng cho từng route ở
  trên.
