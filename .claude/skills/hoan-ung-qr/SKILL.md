---
name: hoan-ung-qr
description: Nhập LC-ID đơn Hoàn ứng (vd "LC3408", "QR 3408") → trả QR chuyển khoản VietQR + số tiền, tài khoản nhận, NDCK. Dùng khi user nói "lấy QR đơn hoàn ứng", "QR chuyển khoản LC...", "đơn này chuyển tiền vào đâu", "NV trả lại bao nhiêu", "sao đơn hoàn ứng không hiện QR". Cũng chạy được cho đơn Thanh toán/Tạm ứng (QR chuyển cho người nhận). KHÔNG dùng để đẩy đơn lên approval (đó là skill push-approval).
---

Bạn tra **QR chuyển khoản của đơn Đề Xuất Chi** (chủ yếu loại **Hoàn ứng**) trong Base CFM411 bảng 57, rồi trả link VietQR + tóm tắt tiền/tài khoản/NDCK. Chỉ ĐỌC Base — không sửa gì trừ khi user yêu cầu fix.

## Chạy

```bash
python3 .claude/skills/hoan-ung-qr/get_qr.py LC3408          # tóm tắt tiếng Việt
python3 .claude/skills/hoan-ung-qr/get_qr.py 3408 --json     # JSON cho xử lý tiếp
python3 .claude/skills/hoan-ung-qr/get_qr.py LC3408 --open   # mở QR trên trình duyệt
```
Nhận mọi dạng input: `LC3408`, `lc3408`, `LC3408K1`, `3408`. Script gọi `ssh macmini` + lark-cli profile `cli_a80df38cc639d02f` (tenant 1 iSuccess) — MacBook không có profile này nên **bắt buộc qua macmini**.

Output mẫu (LC3408):
```
LC3408K1 · Hoàn ứng — NV hoàn trả · Approved
Người: NV549 Huỳnh Hà Ny · TƯ gốc: LC3230
Tạm ứng 700.000 VND → đã dùng 500.000 VND → NV trả lại 200.000 VND
Còn phải chuyển: 200.000 VND
Hướng tiền: NV chuyển trả công ty
TK nhận: MBBank 803048047 — TRAN THI HANG (TK công ty)
NDCK: ISU LC3408 HƯ Tam ung mua be ca ngay 24/07/2026
QR: https://img.vietqr.io/image/MBBank-803048047-print.png?&amount=200000&...
```

Báo cho user: 1 dòng hướng tiền + số tiền + TK nhận, rồi **link QR** (link ảnh PNG, mở là quét được). Đơn nhiều lô K → QR lấy ở record có `1F_TT KC = 1` (thường K1), script tự chọn.

## Hằng số

- Base CFM411 `RcX6wwhnZiJsQrkx7TPl9OlCglc` · bảng 57 ĐXC `tblp36MD9kmWmZRO` · bảng 56 (LC/giao dịch) `tblTihnieUFr0Yk8` · bảng 20 NS `tbl0edSaPODwl2Ne`.
- SSH: `ssh macmini`, luôn `export PATH=/opt/homebrew/bin:$PATH`.
- lark-cli phân trang: `page_size`/`page_token` phải để trong `--params`, để trong query string bị **bỏ qua** (bảng 57 có 148 field → list field mặc định chỉ trả 100).

## Logic QR (đọc từ công thức Base, đừng đoán)

`4F_Link QR` = **QR chốt**, tự chọn theo `4F_Loại hoàn ứng`:

| `4F_Loại hoàn ứng` | Điều kiện | QR lấy từ | Tiền vào |
|---|---|---|---|
| `NV hoàn trả` | `4F_Số tiền còn lại` < 0 (NV xài ít hơn tạm ứng) | `1F_QR hoàn tiền thừa về MB Bank` | TK công ty (TKT bảng 55) — MBBank 803048047 TRAN THI HANG |
| `Công ty trả` | `4F_Số tiền còn lại` ≥ 0 | `4F_Link QR 1` | TK cá nhân NS (bảng 20: `4F_English Bank Name` + `4F_Email - STK` + `4F_Chủ tài khoản`) |
| `""` (đơn Thanh toán/Tạm ứng) | — | `4F_Link QR 1` | TK người/đối tác nhận |

Cấu trúc link: `https://img.vietqr.io/image/<Bank>-<STK>-print.png?&amount=ABS(1F_Chênh lệch)&accountName=<Chủ TK>&addInfo=<1F_NDCK>`.

**Điều kiện để QR có giá trị** (cả 2 công thức):
1. `4L_Status của cả LC` = `Approved` — chưa duyệt xong thì QR rỗng.
2. `1F_Chênh lệch` ≠ 0 — đây là **số tiền còn phải chuyển** (rollup từ bảng 56). Chi/thu xong → về 0 → QR tự tắt (đúng thiết kế, không phải lỗi).
3. Riêng nhánh `Công ty trả`: `1L_Có qua QR ko?` = 1, tức bảng 20 của NS có đủ Bank + STK + Chủ TK, và `1M_Nhân sự` trên record 57 KHÔNG rỗng.
4. LC `Chi gộp 1 TK` → chỉ record có `1F_TT KC = 1` mới có QR.

> Lưu ý: `4F_Số tiền còn lại` = giá trị quyết toán của đơn; `1F_Chênh lệch` = số còn phải chuyển thực tế (= số tiền trên QR). Hai số này khác nhau khi đơn đã chi một phần/đã tất toán.

## QR rỗng — chẩn đoán theo thứ tự

Script đã in sẵn `qr_empty_reason`, đối chiếu:

1. **Chưa Approved** → chờ duyệt xong, không fix gì.
2. **Chênh lệch = 0** → đơn đã tất toán rồi; muốn xem lại giao dịch thì tra bảng 56 theo LC-ID.
3. **`Công ty trả` mà `1L_Có qua QR ko?` = 0** → chuỗi lookup đứt. Nguyên nhân hay gặp: `1M_Nhân sự` (bảng 57) RỖNG → không kéo được bank từ bảng 20. Fix (hỏi user trước khi ghi Base):
   ```bash
   ssh macmini 'export PATH=/opt/homebrew/bin:$PATH; lark-cli --profile cli_a80df38cc639d02f api PUT \
     "/open-apis/bitable/v1/apps/RcX6wwhnZiJsQrkx7TPl9OlCglc/tables/tblp36MD9kmWmZRO/records/<rec_id>" --as bot \
     --params "{\"user_id_type\":\"open_id\"}" \
     --data "{\"fields\":{\"1M_Nhân sự\":[{\"id\":\"<open_id NS>\"}]}}"'
   ```
   (Đây chính là `ensure_nhan_su()` trong `~/dxc-push/push_batch.py` — đơn push bằng tool đã tự set.) Nếu bảng 20 của NS thiếu STK/bank thật → báo user bổ sung, không tự bịa.
4. **Chi gộp 1 TK, đang xem K≠1** → chạy lại với LC-ID gốc, script tự lấy record có QR.

## Tra tay (khi cần soi thêm field)

```bash
ssh macmini 'export PATH=/opt/homebrew/bin:$PATH; lark-cli --profile cli_a80df38cc639d02f api POST \
  "/open-apis/bitable/v1/apps/RcX6wwhnZiJsQrkx7TPl9OlCglc/tables/tblp36MD9kmWmZRO/records/search" --as bot \
  --params "{\"page_size\":20}" \
  --data "{\"filter\":{\"conjunction\":\"and\",\"conditions\":[{\"field_name\":\"LC-ID\",\"operator\":\"is\",\"value\":[\"LC3408\"]}]}}"'
```
Field đáng soi: `4F_Link QR`, `4F_Link QR 1`, `1F_QR hoàn tiền thừa về MB Bank`, `4F_Loại hoàn ứng`, `1F_Chênh lệch`, `4L_Status của cả LC`, `1L_Có qua QR ko?`, `1M_Nhân sự`, `1F_NDCK`, `LC-ID-TƯ`.

## Gửi QR tự động (card kết quả duyệt)

Card "✅ ĐXC đã được duyệt" do `~/dxc-push/server.js` → `sendStatusNoti()` bắn vào 2 group webhook, chạy bằng event `POST /event` từ Lark Approval. Từ 12/08/2026 card đã đính **`4F_Link QR`** (đúng chiều tiền, kèm số tiền + TK nhận) và chờ tối đa 40s cho formula settle.
- Test không spam group: `ssh macmini 'cd ~/dxc-push; node server.js --dry-noti <record_id> APPROVED'` → in card JSON ra stdout.
- Không thấy card nào → kiểm tra event có về không: `grep "POST /event" ~/dxc-push/server.log | tail`. Event từng chết âm thầm 25/06→12/08/2026 (fix: unsubscribe + subscribe lại `approval/v4/approvals/<code>/subscribe` bằng profile `cli_a968bc93f5381e17`).

## Lưu ý

- Trả lời tiếng Việt, ngắn. Luôn kèm **link QR nguyên vẹn** (đừng cắt query string — cắt là mất số tiền/NDCK).
- Không tự sửa Base để "ép" QR hiện ra; muốn fix `1M_Nhân sự` phải confirm với user trước.
- Cần đẩy/push lại đơn lên Approval → chuyển sang skill `push-approval`.
