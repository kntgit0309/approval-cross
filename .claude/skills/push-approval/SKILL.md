---
name: push-approval
description: Check & đẩy/push lại approval qua 5 tool trên Mac mini — hr-approval (nghỉ phép), dxc-approval (Đề Xuất Chi), promo-approval (thăng tiến/bổ nhiệm/thưởng), rtt-push (thủ tục hành chính), hdld-tool (sinh HĐLĐ). Dùng khi user paste ID/serial kèm yêu cầu "check approval / đẩy lên approval / push lại / sao đơn không lên / đơn sai phòng ban / huỷ đơn / sinh HĐLĐ", vd "LC2801K1", "202607100018", "rec27...", "check approval giải thưởng X". Quy trình chuẩn: CHECK (dry-run) trước → báo kết quả → OK mới PUSH thật. KHÔNG tự push khi check ra lỗi.
---

Bạn xử lý **check + đẩy/push lại approval** qua 5 tool chạy trên **Mac mini** (`ssh macmini`). Pattern an toàn chung: **CHECK (dry-run) → báo kết quả → chỉ PUSH thật khi check OK**. Check ra lỗi → DỪNG, báo `reason`, KHÔNG push. Push lại đơn sai → đảm bảo đơn cũ được cancel (tránh trùng).

## Hằng số chung
- SSH: `ssh macmini`, **luôn** prefix `export PATH=/opt/homebrew/bin:$PATH` (lark-cli/node/python cần PATH).
- Profile lark-cli: **`cli_a80df38cc639d02f`** = tenant 1 iSuccess (đọc/ghi Base) · **`cli_a968bc93f5381e17`** = tenant 2 KAI (Approval API). Alias `tenant2` KHÔNG còn tồn tại — gặp code cũ dùng `tenant2` là lỗi.
- Long admin proxy (tenant 2, user_id): **`e63f4f5d`** — requester fallback khi người gửi không có tài khoản KAI. User KAI thật có user_id NGẮN bất kỳ (vd Ny=`420`, Khoa=`5865cd2e`, Ngọc=`9c6348eg`, Cong=`c18eb2de`) — id ngắn/lạ KHÔNG có nghĩa là sai, verify bằng contact API trước khi kết luận.
- Approval codes (đều tenant 2 KAI):
  - HR nghỉ phép: `E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E`
  - DXC: `DAD13F4B-3D66-4597-8263-1031A80D7FEF`
  - Promo: `3083B2D4-583A-4A1F-9072-220BB655FC0F`
  - RTT thủ tục hành chính: `9C770ED9-454D-4300-B8D4-84AEE4866F6B`
- Base: HRM `DLewbVqU7aZM65sAW6mlcOpngse` (bảng 37 nghỉ phép, B28 promo `tblVw1dYJhkg1RUM`, 28.1 RTT `tbl3SBngNF198w1U`, bảng 53 TTCP `tblHI0qVlA1Yqu7F`, bảng 20 NS `tblunlcjf6Pluzzv`) · CFM `RcX6wwhnZiJsQrkx7TPl9OlCglc` (bảng 57 DXC `tblp36MD9kmWmZRO`, bảng 20 `tbl0edSaPODwl2Ne`).
- **2 cách trigger tool:** (A) chạy script CLI trực tiếp — DÙNG CÁCH NÀY để check/push có kiểm soát; (B) HTTP endpoint — đường Base Automation, chỉ dùng test route.

## Bảng tra nhanh 5 tool

| Tool | Port / Domain | Thư mục | Input | CHECK | PUSH thật |
|---|---|---|---|---|---|
| **hr-approval** (nghỉ phép) | 3100 · `hrapprovals.*` | `~/approval-push` | record_id bảng 37 | `node push.js <rec> --dry-run` | `node push.js <rec>` |
| **dxc-approval** (ĐXC) | 3200 · `dxcpush.*` | `~/dxc-push` | LC-ID (`LC<số>K<n>`) | `python3 push_batch.py <LC> --dry-run` | `python3 push_batch.py <LC>` |
| **promo-approval** | 3501 · `promo-push.*` | `~/promo-push` | record_id B28 | `node push_promo.js <rec>` (mặc định dry) | `node push_promo.js <rec> --commit` |
| **rtt-push** (thủ tục HC) | 3503 · `rtt-push.*` | `~/rtt-push` | record_id bảng 28.1 | `node push_rtt.js <rec>` (mặc định dry) | `node push_rtt.js <rec> --commit` |
| **hdld-tool** (sinh HĐLĐ) | 3502 · `hdld.*` | `~/hdld-tool` | record_id bảng 24 / stt | `node generate.js <rec>` (idempotent) | `node generate.js <rec> --force` |

> Domain `*.kntmcptools.online`. Khung lệnh: `ssh macmini 'export PATH=/opt/homebrew/bin:$PATH; cd ~/<dir>; <lệnh> 2>&1' | tail -40`
> ⚠️ Tunnel là **remote-managed** (Cloudflare dashboard) — `~/.cloudflared/config.yml` local bị IGNORE. Hostname mới phải thêm tay trên dashboard (Networks → Tunnels → mac-mcp → Public Hostname).

---

## CHECK approval — bộ lệnh tra cứu

### 1. Tra 1 instance theo instance_code
```bash
lark-cli --profile cli_a968bc93f5381e17 api GET /open-apis/approval/v4/instances/<CODE> --as bot
```
Đọc: `status` (PENDING/APPROVED/REJECTED/CANCELED) · `serial_number` · `task_list` (node + `user_id` đang giữ) · `form` (JSON string — soi widget department/contact xem đẩy đúng chưa).

### 2. Tìm instance theo SERIAL (vd `202607100018`)
Serial đánh **chung theo ngày cho cả tenant KAI** (mọi approval share 1 dãy) → không biết thuộc approval nào thì phải quét lần lượt 4 approval code:
```bash
lark-cli --profile cli_a968bc93f5381e17 api POST \
  "/open-apis/approval/v4/instances/query?page_size=50&user_id_type=user_id" --as bot \
  --data '{"approval_code":"<CODE>","instance_start_time_from":"<ms>","instance_start_time_to":"<ms>"}'
```
- Dùng POST `instances/query` (GET `/instances` list hay lỗi `99992402 field validation` với range dài).
- `instance_start_time_from/to` = epoch **ms dạng string**, khung 1 ngày theo serial (serial `20260710xxxx` → 10/07 00:00 → 11/07 00:00 giờ VN).
- Kết quả có `serial_id`/`serial_number` + `code`/`instance_code` + `status` — match serial cần tìm.

### 3. Tìm record Base từ đơn
- DXC: search bảng 57 filter `DXC-ID` contains `LC...` (field `Instance` = instance_code hiện tại).
- HR: bảng 37, promo: B28, RTT: 28.1 — đều có field `1A_InstanceCode`.
- Đơn theo mô tả (vd "giải thưởng teambuilding"): search bảng 57 `Mô tả` contains keyword; đơn mới nằm ở dải LC số cao nhất. `inst: None` = đơn CHƯA lên approval.

### 4. Debug "đơn không tự lên approval"
1. `grep "<LC/rec>" ~/<dir>/server.log` — automation có bắn không, lúc nào.
2. Có dòng push nhưng không có instance → **fail im lặng** → chạy CHECK dry-run của tool để xem lỗi thật (race field chưa settle / dept unknown / amount empty / requester sai...).
3. Race: automation bắn ngay khi tạo record, formula/lookup (4F_Số tiền, RQ-ID, 4L_Phòng ban...) chưa settle → đợi vài giây check lại. Các tool đã có settle-wait nhưng đơn cũ fail thì phải push tay lại.

---

## PUSH LẠI approval (đơn sai phòng ban / sai người / sửa nội dung)

Quy trình chuẩn:
1. **CHECK dry-run** → confirm payload mới đã đúng (dept/người/số tiền).
2. **Push thật** bằng lệnh tool. DXC/promo/rtt có auto-cancel đơn cũ; HR KHÔNG có (xem dưới).
3. **Verify cancel đơn cũ thành công** — auto-cancel hay fail lỗi quyền:
   - Cancel phải đứng **danh nghĩa initiator thật** của instance cũ. Tool cancel bằng Long trong khi đơn cũ đứng tên user khác → `60009 no operation permission` → đơn cũ VẪN PENDING (trùng đơn!). Fix cancel tay:
   ```bash
   lark-cli --profile cli_a968bc93f5381e17 api POST /open-apis/approval/v4/instances/cancel --as bot \
     --params '{"user_id_type":"user_id"}' \
     --data '{"approval_code":"<APPROVAL_CODE>","instance_code":"<INST_CŨ>","user_id":"<user_id initiator>"}'
   ```
   (initiator lấy từ GET instance — field `user_id`/`open_id`; dùng `user_id_type":"open_id"` nếu chỉ có open_id.)
   - Cancel được cả đơn **đã APPROVED**. Đơn **REJECTED** thì không (1395001 "cannot be canceled") — cũng không cần, cứ push đơn mới.
4. **Verify instance mới**: GET instance → status PENDING + form đúng + task đúng người → báo instance_code + serial.

---

## Chi tiết từng tool

### 1) hr-approval — nghỉ phép (bảng 37)
- CHECK: soi `hoTen`, `dept` phải có giá trị thật. `"[object Object]"`/dept rỗng = race lookup → ĐỢI rồi check lại, đừng push (route sai QL).
- ⚠️ **KHÔNG auto-cancel** — push lại = trùng đơn. Phải cancel instance cũ tay (lệnh mục PUSH LẠI, instance cũ ở `1A_InstanceCode` bảng 37) TRƯỚC khi push.
- Override người gửi: `--requester <user_id>`.

### 2) dxc-approval — Đề Xuất Chi (bảng 57)
- CHECK dry-run trả JSON: `status` (`dry_run`=OK/`error`/`skipped`), `dept`, `requester_user`, `amt`+`cur`.
- ✅ Auto-cancel (nhưng verify — xem 60009 ở trên). Thiếu K → mặc định K1.
- **Chọn phòng ban** (`_dept_candidates`, đã fix 10/07/2026): ưu tiên `Phòng ban 2 (manual)` (user chọn tay) → `1L_Phòng ban 1 (auto)` → dept người nhận (`1M_Nhân sự`→bảng 20) → `4F_Phòng ban` → phòng requester. Lấy nguồn ĐẦU TIÊN match `DEPT_MAP` (map tĩnh trong push_batch.py) rồi mới resolve động bảng 53. Đơn sai phòng ban = soi thứ tự này.
- **Requester**: `USER_T2_MAP` trong push_batch.py (open_id t1 → user_id KAI). Không có trong map → Long. Lỗi 'not found' tự fallback Long.
- Lỗi thường gặp: `dept open_id unknown: X` (X chưa có bảng 53/DEPT_MAP) · `amount empty` (4F_Số tiền chưa settle) · `TK C2 key unknown` · `attach_err` (1 file upload fail — không chặn tạo instance nhưng thiếu file).
- `dmc: Chưa có ĐMC` = cảnh báo định mức cho kế toán, KHÔNG chặn duyệt.

### 3) promo-approval — thăng tiến/bổ nhiệm/thưởng (B28)
- ✅ Auto-cancel + settle-wait. Trưởng BP/BU resolve động (bảng 53 `User Quản lý` → bảng 20 `Approval User_ID`); node trống → auto-pass.
- HTTP `/push` server tự thêm `--commit`.

### 4) rtt-push — thủ tục hành chính (bảng 28.1) [MỚI]
- Mapping: RQ-ID · Department (từ `4L_Department ID` → open_department_id KAI, fallback bảng 53 theo `4L_Phòng ban`) · `Nhóm đơn từ`→Nhóm thủ tục · `Lý do`→Đề xuất cụ thể · `Ngày bắt đầu`→Ngày đề xuất · `Minh chứng`→attachmentV2 (trống thì bỏ qua — API không enforce required) · Link fallback = link record.
- Requester: `Email Công Ty` → batch_get_id KAI → tạo instance bằng key `open_id`; không có → Long (`user_id`).
- ⚠️ **Người duyệt = leader của Department trong Contacts KAI** (KHÔNG phải User Quản lý bảng 53). Dept chưa khai leader → node trống → đơn **auto-APPROVED ngay** — đó là lỗi cấu hình danh bạ, không phải lỗi tool.
- Server :3503 nhận `POST /push {record_id}` từ Base Automation. Poller quét bảng mặc định TẮT (bật env `RTT_POLL=1`). Writeback `1A_InstanceCode` + serial → `1M_Request No.`.

### 5) hdld-tool — sinh HĐLĐ (bảng 24, KHÔNG phải approval)
- Idempotent: có `File Docs` rồi → skip; `--force` để sinh lại. Kết quả `{ok, skipped, unresolved[], warnings[]}` — `unresolved` nhiều → field rỗng/lệch `Tên trên Base` bảng 27.
- HTTP `/generate` cần token (HDLD_TOKEN trong plist); CLI không cần.

---

## Quy trình chuẩn (LUÔN theo thứ tự)
1. **Nhận diện input**: `LC...K...`→dxc · serial `YYYYMMDD####`→quét 4 approval tìm instance · record_id + ngữ cảnh (nghỉ phép→hr, promo→B28, thủ tục HC→rtt, HĐLĐ→hdld) · mô tả đơn→search bảng 57/B28/28.1. Không chắc → hỏi user.
2. **CHECK** dry-run / GET instance → đọc kỹ output.
3. **Báo kết quả** 1–2 dòng (dept/người/tiền/status hoặc lỗi + chẩn đoán).
4. Check OK → **PUSH ngay cùng lượt** → verify cancel cũ + instance mới → báo instance_code + serial + ai đang giữ task.
5. User nói "chỉ check thôi" → dừng ở bước 3.

## Lưu ý
- Tiếng Việt, gọn. Mỗi push → 1 dòng confirm + instance/serial.
- Lỗi Lark API: copy `error.code + message`. `1390001` user not found → fallback Long `e63f4f5d`. `60009` cancel sai danh nghĩa → cancel lại bằng initiator thật. `99992402` → sai param query instance (dùng POST query, time ms string).
- lark-cli output format `{ok,identity,data,error}` (không còn `code`). Restart service: `launchctl kickstart -k gui/$(id -u)/com.<tool>.server`.
- Log gần đây: `tail ~/<dir>/server.log`. Backup code trước khi patch: `cp file file.bak-<tag>-$(date +%Y%m%d-%H%M%S)`.
- Yêu cầu ngoài 5 tool → hỏi rõ trước khi làm.
