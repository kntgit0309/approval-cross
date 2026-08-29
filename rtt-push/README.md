# rtt-push — Duyệt thủ tục hành chính

Tự động đẩy record bảng **28.1 Đề xuất thủ tục hành chính** (HRM `DLewbVqU7aZM65sAW6mlcOpngse` / `tbl3SBngNF198w1U`) lên Lark Approval **"Duyệt thủ tục hành chính"** (`9C770ED9-454D-4300-B8D4-84AEE4866F6B`, tenant 2 KAI).

## Cách hoạt động

- **Base Automation (luồng chính):** bảng 28.1 → automation "khi có record mới" → gửi HTTP `POST https://rtt-push.kntmcptools.online/push {"record_id":"<Record ID>"}` → `server.js` (port **3503**) spawn `push_rtt.js <rec> --commit`.
- Poller quét bảng (backup) MẶC ĐỊNH TẮT — bật bằng env `RTT_POLL=1` trong plist. Khi bật: quét 60s/lần record có `1A_InstanceCode` trống, retry backoff 5ph, max 8 lần.
- ⚠️ Tunnel `kntmcptools.online` là **remote-managed**: thêm hostname `rtt-push` phải làm trên Cloudflare Zero Trust dashboard (Networks → Tunnels → mac-mcp → Public Hostname → `rtt-push` / `http://localhost:3503`). `config.yml` local bị ignore. DNS CNAME đã tạo sẵn bằng `cloudflared tunnel route dns`.

## push_rtt.js

```bash
node push_rtt.js <record_id>            # dry-run (mặc định, không tạo instance)
node push_rtt.js <record_id> --commit   # tạo thật
```

- Mapping: RQ-ID→input · 4L_Department ID→department (open_department_id KAI; fallback tra bảng 53 theo `4L_Phòng ban`) · Nhóm đơn từ→"Nhóm thủ tục" · Lý do→"Đề xuất cụ thể" · Ngày bắt đầu→"Ngày đề xuất" (fallback ngày tạo) · Ngày kết thúc→deadline · `1A_Link ruta`→link (fallback link record) · Minh chứng→attachmentV2 (upload `approval/openapi/v2/file/upload`, type=attachment; trống thì bỏ qua — API không bắt buộc).
- Requester: `Email Công Ty` → `batch_get_id` trên KAI → tạo instance bằng `open_id` (đứng tên thật). Không tìm được → Long `e63f4f5d`.
- Auto-cancel instance cũ (`1A_InstanceCode`) đúng danh nghĩa initiator trước khi tạo mới.
- Writeback: `1A_InstanceCode` + `1M_Request No.` (serial).

## Điều kiện record push được

`RQ-ID` settle · `Nhóm đơn từ` · `Lý do` · phòng ban resolve được (NS phải có Phòng ban trong bảng 20). Người duyệt = **trưởng department chọn trên form** — dept trong Contacts KAI **phải khai leader**, không thì đơn auto-APPROVED.

## Deploy (Mac mini)

- Thư mục `~/rtt-push` + `.tenant2_secret` (copy từ promo-push).
- launchd: `~/Library/LaunchAgents/com.rtt-push.server.plist` → log `~/rtt-push/server.log`.

```bash
launchctl kickstart -k gui/$(id -u)/com.rtt-push.server   # restart
tail -f ~/rtt-push/server.log
```
