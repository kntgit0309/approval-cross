# HR Approval — Đơn xin phép / Nghỉ việc / OT / Remote

Server bridge giữa bảng HRM 37 “Tổng hợp Đơn nghỉ phép” (`tblH5K1duVmQPmgO`) → Lark Approval form `E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E` tenant 2 KAI.

**Port 3100** · **Domain `hrapprovals.kntmcptools.online`**

---

## 🗺️ Luồng

```
┌──────────────────────────────────────────────────────────────┐
│ SUBMIT                                                        │
└──────────────────────────────────────────────────────────────┘
Base HRM (DLewbVqU7aZM65sAW6mlcOpngse / tblH5K1duVmQPmgO)
    ↓ Button click
    ↓ Lark Automation Base — Send HTTP Request
    ↓ POST hrapprovals.kntmcptools.online/push
    ↓
server.js  (port 3100)
    ↓ spawn push.js <record_id>
    ↓
push.js
    ├── lark base +record-get → fields
    ├── Resolve dept:
    │     • 4L_Phòng ban
    │     • 1F_Phòng ban(text)
    │     • parse en_name suffix (vd "Phong NK.Website" → "Website")
    ├── Resolve dept_id tenant 2:
    │     • 4L_Department ID (nếu có sẵn)
    │     • Hoặc search bảng 53 HRM (`tblHI0qVlA1Yqu7F`) bằng "Phòng <name>"
    │     • Hoặc Lark Contact API tenant 2 → open_department_id
    ├── Resolve Requester: SUBMITTER_USER_ID = Long admin (fixed)
    │     → Widget riêng `Người đề xuất:` fill tên thật từ 4L_Họ và tên
    ├── Build form payload:
    │     RQ_ID, REQUESTER, DEPT, NHOM, LOAI (radioV2),
    │     LY_DO (text thuần — không prefix), REQ_NAME (tên thật),
    │     NGAY_BD, NGAY_KT (date ISO ICT +07:00)
    ├── POST /open-apis/approval/v4/instances → tenant 2 KAI
    └── Writeback Base:
         • 1A_InstanceCode = instance_code
         • Serial no.       = từ Approval API
         • 1M_Request No.   = từ Approval API
         • Status 2 (manual) = "Under review"

┌──────────────────────────────────────────────────────────────┐
│ STATUS SYNC                                                   │
└──────────────────────────────────────────────────────────────┘
User duyệt/reject trên Lark Approval
    ↓ event approval_instance status=APPROVED/REJECTED/...
    ↓ POST hrapprovals.kntmcptools.online/event   (URL Request app tenant 2)
    ↓
server.js /event
    ├── if approval_code = DAD13F4B → forward localhost:3200 (DXC)
    └── if approval_code = E6D2C2C3 (HR):
         ├── findRecordByInstance(instance_code) trong bảng 37
         ├── updateStatus(record_id, status)
         │     PENDING→"Under review", APPROVED→"Approved",
         │     REJECTED→"Rejected", CANCELED/DELETED→"Canceled",
         │     REVERTED→"Under review"
         └── (no noti card cho HR hiện tại)
```

---

## 📂 Files

```
hr-approval/
├── server.js        HTTP relay :3100 — routes: /push, /event, /upsert-46-2, /sync-gdt-late, /qr, /event/im-message
└── push.js          Core: read record → build form → POST Approval → writeback
```

---

## ⚙️ Constants (push.js)

```js
const APPROVAL_CODE = 'E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E'; // HR form
const BASE_TOKEN    = 'DLewbVqU7aZM65sAW6mlcOpngse';            // HRM Base
const TABLE_ID      = 'tblH5K1duVmQPmgO';                       // bảng 37 “Tổng hợp Đơn nghỉ phép” (README cũ ghi 35V2 là nhãn sai)
const PROFILE_BASE     = 'cli_a80df38cc639d02f';                // tenant 1 iSuccess
const PROFILE_APPROVAL = 'cli_a968bc93f5381e17';                 // tenant 2 KAI (alias 'tenant2' đã bị bỏ)
const SUBMITTER_USER_ID = 'e63f4f5d';                            // Long admin tenant 2
```

### W dict (form widgets)

| Key | Widget ID | Tên | Loại | Source |
|---|---|---|---|---|
| `RQ_ID` | `widget17603242761530001` | RQ-ID | input | `r['RQ-ID']` |
| `REQUESTER` | `widget17603242964160001` | Requester | contact | Long admin fixed |
| `REQ_NAME` | `widget17806518115900001` | Người đề xuất | input | `hoTen` (4L_Họ và tên) |
| `DEPT` | `widget17605367021680001` | Phòng ban | department | resolved `open_department_id` |
| `NHOM` | `widget17603242829260001` | Nhóm đơn từ | input | `r['Nhóm đơn từ']` |
| `LOAI` | `widget17606086651990001` | Loại đơn | radioV2 | mapped key theo `r['Loại đơn từ']` |
| `LY_DO` | `widget17603243249540001` | Lý do | input | `r['Lý do']` (thuần text) |
| `NGAY_BD` | `widget17603243925320001` | Ngày bắt đầu | date | ISO `+07:00` |
| `NGAY_KT` | `widget17603244102900001` | Ngày kết thúc | date | ISO `+07:00` |
| `LINK_BAN_GIAO` | `widget17859994800260001` | Link file bàn giao công việc | input | `urlOf(r['Link'])` (`fldByboNM4`) |

### Link file bàn giao công việc (đơn nghỉ việc)

Form Base `37.BF1 Đơn từ` bắt buộc field **Link file bàn giao công việc** (`Link`, `fldByboNM4`, type Url) khi chọn Loại đơn từ = Nghỉ việc. push.js đẩy sang widget `input` `widget17859994800260001` (thêm tay trong Approval editor 06/08/2026), chỉ đẩy khi field có giá trị.

⚠️ Lark **không cho thêm/sửa widget qua API** (`approval/v4/approvals` chỉ tạo approval mới, không update) → mọi widget mới phải tạo tay trong **Lark Approval editor**, xong lấy ID qua `GET /open-apis/approval/v4/approvals/{code}`.

Override khi cần: env `HR_WIDGET_LINK_BG=widget178xxxxxxxxxxxx`. Set rỗng → có link vẫn bỏ qua + log cảnh báo (không làm hỏng đơn).

⚠️ **Cần check**: widget này đang `required: true` nhưng `display_condition: null` → áp cho MỌI loại đơn. Hai widget file nghỉ việc đều có điều kiện `Loại đơn từ is Nghỉ việc` (`mgt8xwfv-6zhcwbpg2c4-4`). Nếu Lark siết validate required, đơn đi trễ/tăng ca/phép năm sẽ bị chặn → phải set điều kiện hiển thị cho widget này trong Approval editor.

### Đính kèm đơn nghỉ việc (attachmentV2)

Hai field đính kèm trong Base bảng 37 (`tblH5K1duVmQPmgO`) → 2 widget file trong form. push.js chỉ đẩy khi field có file (đơn nghỉ việc), rỗng thì bỏ qua.

| Base field (type attachment) | Widget ID | Tên widget |
|---|---|---|
| `2M_File đơn xin nghỉ việc` (`fldZlD3RMr`) | `widget17831290316200001` | File đơn xin nghỉ việc |
| `2M_File biên bản bàn giao` (`fldK6pA6uz`) | `widget17831290903540001` | Biên bản bàn giao |

**Luồng upload** (hàm `buildAttachmentWidget` trong push.js):

```
Base field (file_token)
  → GET /open-apis/drive/v1/medias/batch_get_tmp_download_url   (extra bitablePerm, --as bot)
  → curl tmp_download_url → <tmp>/<i>/<tên file thật>   (mỗi file 1 thư mục con, giữ nguyên tên)
  → curl POST /open-apis/approval/v4/files/upload       (multipart: type, name, content)
      → data.urls_detail[0].code
  → form widget { type:'attachmentV2', value:[code, ...] }
```

⚠️ **KHÔNG upload bằng lark-cli** (sửa 06/08/2026, đơn 202608060018 hiện `unknown-file`): API này nhận `name`/`type` là **field trong multipart body**, mà `lark-cli api` chỉ có `--params` (query string) + `--file` cho 1 field file — không gửi được field text. Hậu quả: file lên approval mất tên, widget đọc ra `ext: "unknown-file"`, URL không có đuôi.

→ push.js gọi thẳng `curl` với `tenant_access_token`, `--form-string type=... name=...` + `-F content=@<file>`. Nhận biết đúng/sai qua URL trả về: đúng thì đuôi file còn nguyên (`...bfb2397f.pdf#/obj/obj.pdf`), sai thì trống trơn (`...eec47648?...#/obj/obj`).

**Credential**: `approval-push/.env` (chmod 600, KHÔNG commit) —
```
APPROVAL_APP_ID=cli_a968bc93f5381e17
APPROVAL_APP_SECRET=<secret app tenant 2>
```
Thiếu `APPROVAL_APP_SECRET` → push.js throw ngay ở bước upload (không tạo đơn thiếu file).

**Đảm bảo đủ file** (sửa 06/08/2026 sau sự cố RQ2760 — Base đủ 2 file nhưng approval chỉ nhận 1):

- Mỗi file retry **3 lần** (`retry()`, nghỉ 2s/4s) — lỗi hay gặp là 429 hoặc curl timeout với file vài MB (file 4.2MB mất ~15s).
- Upload thiếu dù chỉ 1 file → `buildAttachmentWidget` **throw**, cả lần push fail, record KHÔNG bị ghi `1A_InstanceCode`/`Status 2` → bấm nút **Retry** trong Base để đẩy lại. Thà không có đơn còn hơn đơn thiếu file.
- Sau khi tạo instance, push.js **đọc lại instance** và đối chiếu widget đã gửi vs widget thực nhận → log `✓ verify: đủ N/N widget` hoặc `⚠ instance THIẾU widget: ...` (Lark có thể im lặng bỏ widget).

**Log**: server.js ghi stdout/stderr của push.js vào `push.log` (trước đây `stdio:'ignore'` → mất sạch). Mỗi dòng có prefix `<ISO time> <record_id>`.

⚠️ **Gotcha lark-cli**: `--file` (và `--output`) CHỈ nhận path **tương đối trong cwd**, path tuyệt đối `/tmp/...` bị chặn `cannot open file`. push.js chạy upload với `cwd = <thư mục tạm>` + tên file tương đối.

⚠️ Widget `Minh chứng` (`widget17604997380380001`) tồn tại trong form nhưng push.js **cố tình KHÔNG đẩy** (theo yêu cầu — chỉ 2 field nghỉ việc).

---

## 🌐 Endpoints

| Endpoint | Method | Body | Mô tả |
|---|---|---|---|
| `/health` | GET | — | Health check |
| `/push` | POST | `{"record_id":"recXXX"}` | Push 1 đơn từ Base |
| `/event` | POST | Lark event | URL verification + approval_instance sync + forward DXC |
| `/upsert-46-2` | POST | `{"record_id":"recXXX"}` | (HRM internal) Upsert 35V2 → 46.2 |
| `/sync-gdt-late` | POST | `{"record_id":"recXXX"}` | (CFM internal) Sync GDT late money |
| `/qr` | POST | `{"record_id":"recXXX"}` | (HRM internal) QR upload synchronous |
| `/event/im-message` | POST | Lark event | IM forwarded card → reply summary |

---

## 🔄 Writeback fields

Sau khi push thành công:

| Field Base 37 | Giá trị |
|---|---|
| `1A_InstanceCode` | UUID instance |
| `Serial no.` | từ Approval API (vd `0149`) |
| `1M_Request No.` | từ Approval API (vd `202606040239`) |
| `Status 2 (manual)` | `Under review` |

Khi event status đổi:

| Lark status | Status 2 (manual) |
|---|---|
| `PENDING` | `Under review` |
| `APPROVED` | `Approved` |
| `REJECTED` | `Rejected` |
| `CANCELED` / `DELETED` | `Canceled` |
| `REVERTED` | `Under review` |

---

## 🐛 Vấn đề đã gặp & fix

| Lỗi | Fix |
|---|---|
| `need_user_authorization` | Đổi `--as user` → `--as bot` trong push.js và server.js |
| `app secret invalid` | Hardcode secret vào config.json thay keychain |
| `FieldNameNotFound: Serial No.` | Đúng tên field là `Serial no.` (lowercase o) |
| Event không về sau reject | Subscribe form: `POST /open-apis/approval/v4/approvals/{code}/subscribe` |
| Profile `tenant2 not found` | Re-add bằng python script, hardcode secrets |
| Ngày bắt đầu/kết thúc lệch 7h | `toISO()` gửi `+07:00` local — KHÔNG convert UTC Z |
| `ERROR: missing 4L_Phòng ban` | Parse từ `Requester[0].en_name` suffix sau `.` |

---

## 🔧 Common commands

```bash
# Restart server (launchd)
launchctl kickstart -k gui/501/com.approval-push.server

# Test push 1 record
curl -X POST https://hrapprovals.kntmcptools.online/push \
  -H 'Content-Type: application/json' \
  -d '{"record_id":"rec27xsLcIXUwz"}'

# Dry-run
node ~/approval-push/push.js rec27xsLcIXUwz --dry-run

# Subscribe form mới
lark-cli --profile tenant2 api POST \
  /open-apis/approval/v4/approvals/E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E/subscribe \
  --as bot --data '{}'

# Tail log
tail -50 ~/approval-push/server.log
```
