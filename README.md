# 📄 Hệ Thống Trích Xuất Văn Bản PDF (PDF OCR)

> Hệ thống web tự động đọc văn bản hành chính từ file PDF bằng AI (Google Gemini), sau đó xuất dữ liệu có cấu trúc ra file Excel — giúp số hóa hồ sơ văn bản một cách nhanh chóng và chính xác.

![Demo](https://img.shields.io/badge/Demo-Live-brightgreen) ![License](https://img.shields.io/badge/License-MIT-blue) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)

---

## ✨ Tính Năng

- 📤 **Upload hàng loạt**: Chọn nhiều file PDF cùng lúc để xử lý theo lô
- 🤖 **AI Phân tích**: Sử dụng Google Gemini 1.5 Flash để OCR và trích xuất thông tin có cấu trúc từ trang đầu và trang cuối của văn bản
- 📊 **Xuất Excel**: Tải dữ liệu đã trích xuất ra file `.xlsx` với đúng tên cột tiếng Việt, sẵn sàng cho sổ văn bản đến
- ⚡ **Realtime Progress**: Theo dõi tiến độ xử lý từng file theo thời gian thực
- 🔒 **Bảo mật API Key**: Gemini API Key được lưu an toàn tại Cloudflare Worker, không lộ ra phía client
- 🌐 **Không cần cài đặt phần mềm**: Chạy hoàn toàn trên trình duyệt web

---

## 📋 Dữ Liệu Trích Xuất

Hệ thống tự động nhận dạng và điền vào các trường sau:

| Trường | Mô tả |
|---|---|
| **Số Đến** | Số văn bản đến (từ dấu/tem đến) |
| **Số Ký Hiệu** | Ký hiệu văn bản (VD: `4524/QĐ-UBND`) |
| **Nội Dung** | Trích yếu/tiêu đề văn bản |
| **Ngày VB Đến** | Ngày tháng năm trên văn bản hoặc dấu đến (DD/MM/YYYY) |
| **Thời Hạn Giải Quyết** | Deadline xử lý nếu có |
| **Ý Kiến Chỉ Đạo** | Ý kiến của lãnh đạo nếu có |
| **Tiến Độ Giải Quyết** | Trạng thái xử lý văn bản |
| **Số KH VB Trả Lời** | Số ký hiệu văn bản phản hồi nếu có |

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────────┐       ┌──────────────────────────┐       ┌─────────────────────┐
│                     │       │                          │       │                     │
│   React Frontend    │──────▶│  Cloudflare Worker       │──────▶│  Google Gemini API  │
│   (Vite + PDF.js)   │       │  (TypeScript / Proxy)    │       │  (gemini-1.5-flash) │
│                     │◀──────│                          │◀──────│                     │
└─────────────────────┘       └──────────────────────────┘       └─────────────────────┘
         │
         ▼
  Render trang PDF thành ảnh JPEG (scale 2x)
  → Gửi base64 lên Worker
  → Worker gọi Gemini API
  → Nhận JSON có cấu trúc
  → Hiển thị bảng + Xuất Excel
```

**Tại sao dùng Cloudflare Worker làm proxy?**
- Bảo vệ Gemini API Key khỏi bị lộ trên client
- Xử lý CORS linh hoạt
- Edge computing giúp giảm độ trễ toàn cầu
- Miễn phí ở mức sử dụng vừa phải (100,000 requests/ngày)

---

## 📁 Cấu Trúc Thư Mục

```
pdf-ocr/
├── frontend/                    # React App (Vite)
│   ├── src/
│   │   ├── App.jsx              # Component chính: upload, bảng dữ liệu, xuất Excel
│   │   ├── utils/
│   │   │   └── pdfProcessor.js  # Render PDF → ảnh JPEG base64 dùng PDF.js
│   │   └── main.jsx             # Entry point
│   ├── .env.production          # URL của Cloudflare Worker (production)
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── backend/                     # Cloudflare Worker (TypeScript)
    ├── src/
    │   └── index.ts             # Worker handler: nhận ảnh → gọi Gemini → trả JSON
    ├── wrangler.toml            # Cấu hình Cloudflare Worker
    ├── tsconfig.json
    └── package.json
```

---

## 🚀 Hướng Dẫn Cài Đặt & Triển Khai

### Yêu Cầu

- [Node.js](https://nodejs.org/) >= 18
- Tài khoản [Cloudflare](https://cloudflare.com) (miễn phí)
- [Google AI API Key](https://aistudio.google.com/app/apikey) (Gemini)

---

### 🔧 Bước 1: Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/pdf-ocr.git
cd pdf-ocr
```

---

### ⚙️ Bước 2: Triển Khai Backend (Cloudflare Worker)

```bash
cd backend

# Cài đặt dependencies
npm install

# Đăng nhập Cloudflare (chỉ cần làm 1 lần)
npx wrangler login

# Cài API Key vào Cloudflare Secrets (an toàn, không lộ trong code)
npx wrangler secret put GEMINI_API_KEY
# Nhập API Key của bạn khi được hỏi

# Deploy lên Cloudflare Workers
npx wrangler deploy
```

Sau khi deploy, bạn sẽ nhận được URL dạng:
```
https://pdf-ocr-backend.YOUR_SUBDOMAIN.workers.dev
```

#### Chạy Development Local (tuỳ chọn)

```bash
# Tạo file .dev.vars trong thư mục backend/
echo "GEMINI_API_KEY=your_actual_api_key_here" > .dev.vars

# Chạy Worker local
npx wrangler dev
# Worker sẽ chạy tại: http://localhost:8787
```

---

### 🎨 Bước 3: Cấu Hình & Chạy Frontend

```bash
cd frontend

# Cài đặt dependencies
npm install
```

**Cập nhật URL Backend:** Mở file `frontend/.env.production` và thay bằng URL Worker của bạn:

```env
VITE_API_URL=https://pdf-ocr-backend.YOUR_SUBDOMAIN.workers.dev/api/extract
```

Nếu chạy local với Worker ở `localhost:8787`, tạo file `frontend/.env.local`:
```env
VITE_API_URL=http://localhost:8787/api/extract
```

```bash
# Chạy development server
npm run dev
# Mở trình duyệt tại: http://localhost:5173

# Build production
npm run build
```

---

### ☁️ Bước 4: Deploy Frontend (Cloudflare Pages / Vercel / Netlify)

**Option A — Cloudflare Pages (khuyến nghị):**
```bash
cd frontend
npm run build
npx wrangler pages deploy dist
```

**Option B — Vercel:**
```bash
cd frontend
npx vercel --prod
```

**Option C — Netlify:**
```bash
cd frontend
npm run build
# Kéo thả thư mục dist/ lên netlify.com
```

---

## 🔐 Biến Môi Trường

### Backend (Cloudflare Worker Secrets)

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | API Key từ [Google AI Studio](https://aistudio.google.com/app/apikey) |

> **Lưu ý**: Không bao giờ commit API Key vào code. Sử dụng `wrangler secret put` cho production và file `.dev.vars` (đã có trong `.gitignore`) cho development.

### Frontend (Vite Env Variables)

| Biến | Mặc định | Mô tả |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8787/api/extract` | URL endpoint của Cloudflare Worker |

---

## 🛠️ Công Nghệ Sử Dụng

### Frontend
| Công nghệ | Phiên bản | Mục đích |
|---|---|---|
| [React](https://react.dev/) | 19 | UI Framework |
| [Vite](https://vitejs.dev/) | 8 | Build tool & Dev server |
| [PDF.js](https://mozilla.github.io/pdf.js/) | 5 | Render PDF thành ảnh |
| [SheetJS (xlsx)](https://sheetjs.com/) | 0.18 | Tạo và xuất file Excel |
| [Lucide React](https://lucide.dev/) | latest | Bộ icon đẹp |
| [Tailwind CSS](https://tailwindcss.com/) | 4 | Styling |

### Backend
| Công nghệ | Phiên bản | Mục đích |
|---|---|---|
| [Cloudflare Workers](https://workers.cloudflare.com/) | - | Serverless Edge Runtime |
| [TypeScript](https://www.typescriptlang.org/) | 6 | Type-safe backend code |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | 4 | CLI deploy Cloudflare |
| [Google Gemini API](https://ai.google.dev/) | 1.5 Flash | AI Vision & OCR |

---

## 🔄 Luồng Xử Lý Chi Tiết

```
1. Người dùng chọn 1 hoặc nhiều file PDF
   │
2. PDF.js render trang 1 và trang cuối thành ảnh JPEG (scale 2x để đảm bảo độ nét)
   │
3. Ảnh được chuyển sang chuỗi base64, loại bỏ tiền tố data:image/...
   │
4. Frontend gửi POST request đến Cloudflare Worker với mảng ảnh base64
   │
5. Worker xây dựng prompt tiếng Việt + đính kèm ảnh → Gọi Gemini API
   │
6. Gemini trả về JSON thuần với 8 trường thông tin văn bản
   │
7. Frontend parse JSON → Hiển thị vào bảng
   │
8. Người dùng nhấn "Xuất Excel" → Tải về file .xlsx
```

---

## ⚠️ Lưu Ý Quan Trọng

- **Chất lượng scan**: Kết quả OCR phụ thuộc vào độ nét của file PDF. PDF scan mờ có thể cho kết quả không chính xác.
- **Giới hạn API**: Gemini API có rate limit. Khi xử lý hàng loạt nhiều file, nên theo dõi quota tại [Google AI Studio](https://aistudio.google.com/).
- **Kích thước file**: Ảnh được compress xuống JPEG 80% để giảm kích thước gửi API. File PDF quá lớn có thể bị timeout.
- **CORS**: Backend đã cấu hình `Access-Control-Allow-Origin: *`. Trong production, nên giới hạn chỉ cho phép domain frontend của bạn.

---

## 📝 License

MIT © 2026

---

## 🤝 Đóng Góp

Pull requests và issues luôn được chào đón. Nếu bạn muốn đóng góp:
1. Fork repository
2. Tạo branch mới (`git checkout -b feature/ten-tinh-nang`)
3. Commit thay đổi (`git commit -m 'feat: thêm tính năng X'`)
4. Push lên branch (`git push origin feature/ten-tinh-nang`)
5. Tạo Pull Request
