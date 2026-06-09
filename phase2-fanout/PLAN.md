# Lark Approval — Phase 2: Fan-out trạng thái duyệt cross-tenant

> Ghi nhớ thiết kế & quyết định. Cập nhật: 08/06/2026
> Trạng thái: đã chốt topology + hướng kiến trúc. Chờ repo Phase 1 để ráp code.

---

## 1. Bối cảnh & phạm vi

- **Phase 1 (đã xong):** user submit form trong Base → automation đẩy lên Approval → Approval trả `status` + `request_code` + `instance_code` về Base qua server.
- **Phase 2 (đang thiết kế):** sau khi có kết quả duyệt, đẩy thông báo trạng thái (kiểu thông báo của Approval app) **tới đúng user** — DM card hoặc hiển thị trên Lark.

## 2. Topology đã chốt

- **8 org Lark RIÊNG** (8 `tenant_key` khác nhau), không phải 8 BU trong 1 org.
- **Approval chạy TẬP TRUNG tại 1 tenant trung tâm.**
- Mỗi org ≥ 20 user (~160 user tổng).
- ⇒ Đây là kịch bản **fan-out cross-tenant thật sự**.

## 3. Ràng buộc cốt lõi (không vượt qua được)

- **1 app/bot chỉ nhắn được cho user TRONG chính org của nó.** App ở tenant trung tâm KHÔNG DM được user thuộc 7 org kia.
- ⇒ Bắt buộc phải có **app hiện diện bên trong cả 8 org** thì mới gửi tin được.
- Server trung tâm chỉ **điều phối** (quyết định gửi gì / cho ai / org nào); việc *gửi* phải đi qua app nằm trong org của user.
- Approval app native KHÔNG tự báo cho user thật được (applicant ở tenant trung tâm là proxy/bot, không phải member org user) → vì vậy mới cần tự fan-out.

## 4. Quyết định kiến trúc

- **Hướng đi:** thử **ISV (1 app cài lên cả 8 org)** trước; không xuôi thì rớt về **8 custom app**. Không ngại overhead 8 app.
- **Nguyên tắc số 1 — cô lập tầng token:** bọc sau 1 interface duy nhất

  ```
  get_tenant_token(tenant_key) -> token
  ```

  Toàn bộ phần dưới (resolve `open_id`, dựng card, gửi message) chỉ gọi hàm này, KHÔNG biết đang chạy ISV hay custom.
  - Provider ISV: `app_ticket → app_access_token → tenant_access_token(tenant_key)`
  - Provider custom: tra `(app_id, app_secret)` của org trong bảng credential → `tenant_access_token` thẳng
  - `tenant_registry` giữ NGUYÊN hình dạng ở cả 2 chế độ.
  - ⇒ Đổi ISV ↔ 8 app = **swap 1 provider + đổ bảng credential**, KHÔNG đụng logic fan-out / card.

## 5. Mô hình app ISV

### Build trong developer console (open.larksuite.com)
1. App type = **Store/Marketplace (ISV)**.
2. Bật **Bot**.
3. Scope: `im:message`, `contact:user.id:readonly` (+ approval scope nếu sau này subscribe trực tiếp).
4. Event subscription: set Encrypt Key + Verification Token, trỏ Request URL về server. **Bắt buộc subscribe event `app_ticket`** + event lúc org cài app (để bắt `tenant_key`).
5. Nếu cần trang chi tiết H5 → thêm capability Web App + khai báo security/redirect domain.

### Token ISV — 3 tầng
```
app_ticket (Lark push qua event → LƯU DB, bền)
  └─ POST /auth/v3/app_access_token  (app_id + app_secret + app_ticket)
       └─ app_access_token
            └─ POST /auth/v3/tenant_access_token  (app_access_token + tenant_key)
                 └─ tenant_access_token  (riêng từng org, TTL ~2h)
```
- SDK đỡ cực: `@larksuiteoapi/node-sdk` với `appType: lark.AppType.ISV`, mỗi call truyền `lark.withTenantKey(tenant_key)`.
- Mất `app_ticket` = chết toàn hệ thống → có API **resend app_ticket** để cứu.

### Privacy — KHÔNG cần listing công khai
- **Mức 1 — Test enterprise:** add 8 org làm test tenant → cài bản test, không lên directory. Nhanh nhất cho rollout nội bộ (lưu ý: bản test mang tính development, có thể có giới hạn — xác nhận trong console).
- **Mức 2 — Publish targeted:** qua review 1 lần, nhưng khóa availability về đúng 8 org (designated tenants) → không ai khác tìm/cài. Đây là trạng thái production sạch.
- **Mức 3 — Né hẳn store/review:** không khả thi với ISV → đó chính là phương án 8 custom app.

## 6. Mô hình dữ liệu (server trung tâm)

- `tenant_registry`: `org_name → tenant_key` (+ trạng thái cài app). Lấy `tenant_key` từ event cài app, hoặc từ header `tenant_key` trên bất kỳ event nào org bắn về, hoặc nhập tay.
- `user_directory`: `business_id` (email công ty / SĐT / mã NV), `tenant_key`, `open_id_cache`.
- **Gap cần bổ sung:** mỗi record submit trong Base phải mang (a) định danh bền của user và (b) user thuộc org nào. Nếu Base chưa có field "org/tenant" → thêm ngay.
- Lưu ý resolve: email/SĐT ở trung tâm phải khớp attribute trong directory của org nhà user thì `batch_get_id` mới ra `open_id`.

## 7. Luồng fan-out Phase 2

> Hook vào ĐÚNG result-handler của Phase 1 (chỗ nhận `status` + `instance_code` về Base), KHÔNG dựng luồng mới.

1. Phase 1 nhận kết quả (`APPROVED` / `REJECTED` / `CANCELED` / `DELETED` / `TERMINATED`...), kèm `instance_code`, record submitter.
2. Đọc `business_id` + `tenant_key` từ record/registry.
3. `get_tenant_token(tenant_key)` → token đúng org.
4. `contact/v3/users/batch_get_id` (by email/SĐT) → `open_id` (cache lại).
5. `im/v1/messages`, `receive_id_type=open_id`, `msg_type=interactive` → DM card cho user trong org của họ.

## 8. Nội dung card

- Tên đơn / loại approval.
- Trạng thái: **xanh = duyệt, đỏ = từ chối**.
- Vài field chính của đơn + thời gian.
- Nút **"Xem chi tiết"** deep-link về record Base hoặc trang H5.

## 9. Scopes / cấu hình
- `im:message` (gửi as bot), `contact:user.id:readonly` (resolve id), approval scope nếu subscribe event.
- Bật **Bot** cho app.

## 10. Gotchas / độ tin cậy
- **`app_ticket` = single point of failure** → lưu DB (không giữ RAM), dùng resend API khi mất.
- **Idempotency:** dedupe theo `instance_code + status` để không bắn trùng khi webhook/event retry.
- **Queue/outbox + retry backoff** cho lỗi 429.
- **Cache token** theo `(app_id, tenant_key)`, TTL ~2h.
- "Hiển thị trên Lark" → card tương tác là đủ & nhẹ; muốn trang riêng kiểu H5 MiniApp thì thêm Web App tab.

## 11. Phương án B — 8 custom app (fallback)
- Mỗi org tạo 1 app trong chính org đó → `tenant_access_token` thẳng từ `app_id`+`secret`, **không cần `app_ticket`**.
- Không review, không cài-từ-store. Đổi lại: 8 bộ credential, 8 lần cấu hình scope/bot/event, 8 chỗ maintain.
- Nhờ tầng `get_tenant_token`, chuyển sang đây chỉ là swap provider + đổ bảng credential.

## 12. Việc tiếp theo (pending)
- [ ] **Nguyen gửi repo Phase 1** (hoặc 3 mảnh: result-handler approval, code lấy token/gọi Lark hiện tại, file config/env đã che secret).
- [ ] Claude đọc hiểu → xác định chỗ chèn fan-out, HOẶC viết luôn token-manager + fan-out (chốt khi gửi repo).
- [ ] Module token-manager: handler `app_ticket` + cache `(app_id, tenant_key)` + resend + 2 provider (ISV / custom) bật-tắt.
- [ ] Bổ sung field "org/tenant" vào Base submit nếu chưa có.
- [ ] Add 8 org làm test enterprise; admin mỗi org cài + set availability.

## 13. Câu hỏi mở
- Stack server Phase 1 (Node / Python / Go-GoClaw...) → biết khi nhận repo.
- Email/SĐT của user ở trung tâm có khớp directory từng org không? (nếu khác → cần map riêng).
- Giới hạn cụ thể của bản test-enterprise (thời hạn, ràng buộc) → xác nhận trong console khi add test tenant.
