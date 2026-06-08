# Phase 2 — Trạng thái & các bước còn lại

> Cập nhật: 09/06/2026. Mục tiêu: fan-out trạng thái duyệt cross-tenant tới đúng user + trang chi tiết H5 như Lark Approval Center.

## ✅ Đã xong

### Fan-out cross-tenant (custom app)
- Token cô lập sau 1 interface `getTenantToken(tenant_key)` — 2 provider **ISV / custom**, đổi chế độ = đổi `PROVIDER_MODE` + đổ bảng credential (không sửa logic). Chốt dùng **custom (8 app riêng)**.
- Pipeline chạy THẬT end-to-end: token → resolve open_id (`batch_get_id`) → gửi DM interactive card (`im/v1/messages`).
- **2/8 org đã test thật OK**: org 2 (`cli_a96f1c42…`) + org 5 (`cli_aaac63e3…`). Công thức mỗi app: scope `im:message` + `contact:user.id:readonly` + bật **Bot** + **Publish version**.
- Idempotency (dedupe `instance+status`), cache token `(app_id, tenant_key)`, cache open_id. 14 test offline pass (`node --test`).

### Trang chi tiết H5 (atrack.kntmcptools.online)
- atrack → **Mac mini khác** (`ssh macmini`, user `duong`, :3400 = `/Users/duong/tracking-ui/server.js`).
- Backend đã có sẵn & hoàn chỉnh: `/track/data` (data THẬT qua `lib.fetchInstance`+`normalize`), `/send`, `/event` (auto-patch card khi status đổi).
- **Đã thay UI** = giao diện native-Lark (Details + Approval Record dạng bảng + Comments, tabs đổi màu, nút ✕): scp `track.html` mới → `~/tracking-ui/public/track.html` (backup `track.html.bak.*`). KHÔNG đụng `server.js`/`lib.js`/`:3100`/`:3200`.
- Card test gửi tới `khoanht.des@isuccesscorp360.com` (org 2) → **View Details → atrack** chạy OK.

## ⚠️ Giới hạn then chốt đã xác định
- `/send` của tracking-ui dùng **bot tenant-1** (`cli_a80df…`) → **KHÔNG DM được cross-tenant** (lỗi 230001). Đây đúng là lý do Phase 2 tồn tại.
- ⇒ Kiến trúc đúng: **tracking-ui lo data + UI + card-build + auto-update; custom app org (phase2-fanout) lo việc GỬI cross-tenant.**
- Domain `isuccesscorp360.com` = org 2 (KAI). Các org chung domain nhưng là tenant riêng.

## 🗺️ Kiến trúc hiện tại
```
[Phase 1] đơn duyệt/reject (approval_instance event)
        │
        ▼
custom app org (cross-tenant) ──gửi card──► user (đúng org)
                                              │ bấm "View Details"
                                              ▼
              atrack.kntmcptools.online/track  (macmini :3400)
                  │ /track/data → lib.fetchInstance (data THẬT)
                  ▼
              UI native-Lark (track.html mới)
                  ▲ /event → lib.patchCard (auto-update khi status đổi)
```

## 📋 Các bước còn lại

1. **Data thật thay DEMO** — test với `instance_code` thật (HR form E6D2C2C3 + DXC form DAD13F4B), verify `normalize` map đúng field/step. `node test-noti.js TENANT_ORG2 <email> <instance_code>`.
2. **Tự động hóa gửi cross-tenant** (cốt lõi) — ghép "send qua custom app org" vào luồng, chọn 1:
   - **A.** Sửa `/send` của tracking-ui → gửi qua custom app org (thay bot tenant-1).
   - **B.** Wire vào Phase 1 result-handler (dxc `server.js:280` / hr `server.js:158`) → mỗi đơn final tự bắn card + atrack tới đúng user.
3. **Field org/tenant + business_id trên Base** — mỗi record submit cần biết user thuộc **org nào** + **email bền** → để resolve cross-tenant tự động (chưa có, plan §6).
4. **Auto-update card cross-tenant** — `/event` hiện patch card gửi bởi bot tenant-1; cần patch card gửi qua custom app (token org tương ứng).
5. **Thêm 6 org còn lại** (1,3,4,6,7,8) — tạo custom app (scope + Bot + Publish) → nạp `config/credentials.json`.
6. **Card chuẩn** — chốt dùng card kiểu nào gửi qua custom app: CC'd noti (`buildNotiCard`) hay `lib.buildCard` (có progress/status). Hiện đang test bằng `buildNotiCard`.
7. **Web App capability** (tùy chọn) — nhúng atrack vào custom app để SSO + native feel + whitelist domain (plan §5).
8. **Persistent service** — đảm bảo nơi chạy phần "send qua custom app" (launchd như 2 server kia); tracking-ui đã có `install-launchd.sh`.

## 📁 File chính (phase2-fanout/)
- `src/token-manager.js` — `getTenantToken` (interface cô lập)
- `src/providers/{isv,custom}.js` — 2 provider token
- `src/fanout.js` — orchestrator `notifyApprovalResult`
- `src/build-card.js` — `buildStatusCard` + `buildNotiCard`
- `test-real.js` / `test-noti.js` — gửi thật qua custom app
- `h5/track.html` — UI native-Lark (đã deploy lên macmini)
- `h5/` (server.js, approval-center/detail.html) — bản mock local :3300 để dev UI
- `config/credentials.json` — app_id/secret thật (GITIGNORED)
