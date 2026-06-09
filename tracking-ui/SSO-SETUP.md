# Quy trình thêm app SSO cho 1 org (web app "Đơn của tôi")

> Lặp các bước này cho **6 org còn lại (1, 3, 4, 6, 7, 8)**. org 2 + org 5 đã xong.
> Trang tự dò org (try-each) → **mọi app dùng CHUNG 1 Home URL, KHÔNG cần `?org=`**.

---

## Phần A — Bạn làm trên Lark Developer Console (mỗi org 1 custom app)

Vào https://open.larksuite.com (đăng nhập tài khoản admin của **org đó**) → **Create Custom App**.

### 1. Add features (Tính năng)
- ✅ **Bot** (để fan-out gửi DM card)
- ✅ **Web App**:
  - **Desktop home page URL** = `https://atrack.kntmcptools.online/`
  - **Mobile home page URL** = `https://atrack.kntmcptools.online/`

### 2. Permissions & Scopes (Quyền) — bật ĐỦ 4 scope
| Scope | Để làm gì |
|---|---|
| `im:message` | gửi DM card (fan-out) |
| `contact:user.email:readonly` | **đọc email user (SSO bắt buộc)** |
| `contact:user.base:readonly` | thông tin cơ bản |
| `contact:user.id:readonly` | open_id |

> Mẹo: mở app org 2 (đang chạy đúng) → copy y hệt danh sách scope.

### 3. Security Settings (Bảo mật)
- **Redirect URL**: `https://atrack.kntmcptools.online/`  ← thiếu = lỗi **10235**
- **H5 trusted domain**: `atrack.kntmcptools.online`  ← thiếu = JSSDK không chạy

### 4. Availability (Phạm vi sử dụng)
- Chọn **toàn org** (hoặc phòng ban cần dùng). ← thiếu = lỗi **10228 "no visibility"**

### 5. Version Management & Release
- Tạo version → **Publish** (chờ admin duyệt nếu có). ← chưa publish = 10228.

### 6. Lấy credential
- **Credentials & Basic Info** → copy **App ID** (`cli_…`) + **App Secret** → **gửi cho tôi**.

---

## Phần B — Tôi làm (khi nhận App ID + Secret)
- Thêm org vào `sso-config.json` (apps map) trên mini (gitignored). Try-each **tự nhận org mới** — không phải đổi Home URL, không sửa code.
- Validate app_access_token + báo bạn test.

---

## Test sau khi xong 1 org
1 user của org mở web app → phải hiện **đơn của chính họ**. Nếu sai, gửi tôi **email user** đó → tôi soi log:
```
sso auth(orgX) → <email> src=user_info   ✅ đúng
src=none   → thiếu scope email (Phần A bước 2)
FAIL 10228 → thiếu Availability/Publish (bước 4-5)
FAIL 10235 → thiếu Redirect URL (bước 3)
```

## Đúc kết (đã gặp ở org 2/5)
- Home URL **giống nhau mọi app** — trang tự dò org (sai org fail ~0.2s rồi thử org kế).
- Email công ty trong bảng 20 có thể lệch domain (`isuccesscorp.com` vs `isuccesscorp360.com`) → đã xử khớp theo phần trước `@`, không cần lo.
- Mỗi org là **tenant riêng** dù chung domain → phải có app riêng trong từng org (đây là lý do Phase 2 tồn tại).
