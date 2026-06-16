---
name: check-push-dxc
description: Check + đẩy lại thủ công 1 Đề Xuất Chi (DXC) lên Lark Approval theo LC-ID. Dùng skill này khi user gửi/paste 1 LC-ID (vd "LC2801K1", "check LC2801", "LC2801K1 check approval", "đẩy lại LC...", "sao LC... không lên approval"). Quy trình: dry-run CHECK trước → báo kết quả (dept/người/số tiền/lỗi nếu có) → nếu OK thì PUSH thật và báo instance. KHÔNG tự push khi check ra lỗi — báo lỗi để user xử lý.
---

Bạn xử lý **check + push thủ công 1 Đề Xuất Chi (DXC)** lên Lark Approval [KAI], theo **LC-ID** user gửi. Server: `~/duong/dxc-push/push_batch.py` chạy trên **Mac mini** (đẩy qua `dxcpush.kntmcptools.online`).

## Hằng số
- SSH: `ssh macmini`, sau đó luôn `export PATH=/opt/homebrew/bin:$PATH` (lark-cli/node cần PATH này).
- Script: `cd /Users/duong/dxc-push` → `python3 push_batch.py <LC-ID> [--dry-run]`.
  - **Có `--dry-run`** = CHECK (in payload, KHÔNG tạo instance).
  - **Không có** = PUSH THẬT (tạo instance + writeback Base + gửi noti).
- LC-ID dạng `LC<số>K<n>` (vd `LC2801K1`). Nếu user gửi thiếu hậu tố K (vd "LC2801") → mặc định thử `LC2801K1`; nếu sai báo user.
- Submitter mặc định = Long `e63f4f5d`. Nếu người đề xuất thuộc **org 2 (KAI)** thì `requester_user` sẽ là KAI user_id của họ (initiator thật) — đúng, không phải lỗi.
- Auto-replace: nếu record đã có `Instance` cũ → push tự **cancel đơn cũ rồi tạo mới** (an toàn khi đẩy lại).
- Resolve phòng ban: tự động qua bảng 53 (không cần map tay).

## Quy trình (LUÔN làm đúng thứ tự)

### Bước 1 — CHECK (dry-run)
```bash
ssh macmini 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/duong/dxc-push; python3 push_batch.py <LC-ID> --dry-run 2>&1' | tail -40
```
Kết quả là JSON ở dòng cuối, các field quan trọng:
- `status`: `dry_run` (OK, sẵn sàng push) · `error` (có lỗi, KHÔNG push) · `skipped` (vd amount empty).
- `dept`: phòng ban resolve được (hiện tên, vd "Website").
- `requester_user`: `e63f4f5d` (Long) hoặc KAI user_id (người org-2 thật).
- `amt`, `cur`: số tiền + tiền tệ.
- `reason`: lý do nếu `error`/`skipped`.

**Báo cho user kết quả check** gọn gàng, ví dụ:
> ✅ Check LC2801K1: status=dry_run · phòng ban Website · người đề xuất Long(e63f4f5d) · 5.95 USD → sẵn sàng push.

Hoặc nếu lỗi:
> ❌ Check LC2801K1: error — `dept open_id unknown: X` (hoặc `amount empty`…). Chưa push.

### Bước 2 — Xử lý theo kết quả
- **status = `dry_run`** → tiếp Bước 3 (push thật).
- **status = `error` / `skipped`** → **DỪNG, KHÔNG push**. Báo `reason` + chẩn đoán nhanh:
  - `dept open_id unknown: <X>` → phòng "<X>" không có trong bảng 53. Cần thêm vào bảng 53 hoặc kiểm tra `1L_Phòng ban` của record.
  - `amount empty` → record chưa có `4F_Số tiền`.
  - Lỗi khác → đọc kỹ message, kiểm tra record bảng 57 (`tblp36MD9kmWmZRO`, app `RcX6wwhnZiJsQrkx7TPl9OlCglc`).

### Bước 3 — PUSH thật (chỉ khi check OK)
```bash
ssh macmini 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/duong/dxc-push; python3 push_batch.py <LC-ID> 2>&1' | tail -40
```
Kết quả JSON: `status=ok` + `instance_code`. **Báo user**:
> ✅ Đã đẩy LC2801K1 → instance `EAF739EB-...`. Đã ghi Instance + status về Base.

Nếu `status=error` ở bước push (hiếm, vd race) → báo reason, có thể thử lại 1 lần.

## Lưu ý
- **Mặc định: gửi 1 LC-ID = chạy đủ chuỗi** Bước 1 (check) → báo kết quả → Bước 3 (push). Báo kết quả check TRƯỚC rồi push ngay sau (cùng 1 lượt), trừ khi check ra `error`/`skipped` thì DỪNG ở Bước 2.
- Ngoại lệ: nếu user nói rõ **"chỉ check" / "kiểm tra thôi" / "đừng push"** → chỉ Bước 1 + báo, KHÔNG push.
- Tra status đơn đã đẩy: lấy `instance_code` từ Base (`Instance` field) → `lark-cli --profile tenant2 api GET /open-apis/approval/v4/instances/<code> --as bot` → xem `status` (PENDING/APPROVED/REJECTED) + `task_list` (ai đang duyệt).
- Tìm record theo LC-ID nếu cần: search bảng 57 filter `DXC-ID` is `<LC-ID>` qua `lark-cli --profile cli_a80df38cc639d02f api POST /open-apis/bitable/v1/apps/RcX6wwhnZiJsQrkx7TPl9OlCglc/tables/tblp36MD9kmWmZRO/records/search`.
- Server log đẩy gần đây: `tail /Users/duong/dxc-push/server.log`.
