# Approval Cross — Lark Base ↔ Lark Approval (cross-tenant)

Bridge giữa **Lark Base** trên tenant iSuccess (1) và **Lark Approval** trên tenant iSuccess 2 KAI (2). Hỗ trợ submit form, sync status hai chiều, ghi data về Base.

Gồm 2 hệ thống submit độc lập (cùng pattern) + 1 hệ tracking cho nhân viên:

- 📂 **[hr-approval/](./hr-approval/)** — HR đơn xin phép/nghỉ việc/OT
- 📂 **[dxc-approval/](./dxc-approval/)** — Đề Xuất Chi (multi-K, attachment)
- 📂 **[tracking-ui/](./tracking-ui/)** — gửi nhân viên card theo dõi tiến độ duyệt nhiều cấp + H5 detail page; card tự cập nhật khi có người duyệt (chạy thật `:3300`, dùng chung HR + DXC)

| | [HR Approval](./hr-approval/) | [DXC Approval](./dxc-approval/) |
|---|---|---|
| **Domain** | `hrapprovals.kntmcptools.online` | `dxcpush.kntmcptools.online` |
| **Port** | 3100 | 3200 |
| **Base nguồn** | HRM (`DLewbVqU7aZM65sAW6mlcOpngse`) | CFM411 (`RcX6wwhnZiJsQrkx7TPl9OlCglc`) |
| **Bảng nguồn** | 35V2 đơn xin phép (`tblH5K1duVmQPmgO`) | 57 Đề Xuất Chi (`tblp36MD9kmWmZRO`) |
| **Approval form** | `E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E` | `DAD13F4B-3D66-4597-8263-1031A80D7FEF` |
| **Loại đơn** | Xin phép / nghỉ việc / OT / remote / … | Thanh toán / Tạm ứng / Hoàn ứng |
| **Multi-K** | ❌ 1 record = 1 instance | ✅ N K records cùng LC = 1 instance, N items trong fieldList |
| **Auto-cancel old** | ❌ (button trigger 1 lần) | ✅ Cancel instance cũ trước khi push mới |
| **File attachment** | ❌ | ✅ Auto download + serve public URL |

---

## 🗺️ Tổng quan luồng (chung cho cả 2 hệ thống)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SUBMIT (Base → Approval)                                  │
└─────────────────────────────────────────────────────────────┘
   User click Button trên Base
   ↓ Lark Base Automation (Send HTTP Request)
   ↓ POST <domain>/push-base  body={record_id}
   ↓ server.js → resolve DXC-ID/RQ-ID
   ↓ push_batch.py / push.js
   ↓   ├ Fetch record fields
   ↓   ├ Resolve dept (bảng 20 NS → LC fallback → BU suffix)
   ↓   ├ Resolve requester user_id tenant 2 (USER_T2_MAP, fallback Long admin)
   ↓   ├ Build form payload (widgets + fieldList items)
   ↓   ├ Download attachment files → public URL (DXC only)
   ↓   ├ POST /open-apis/approval/v4/instances → tenant 2 KAI
   ↓   ├ Writeback fields về Base (Instance, Request No., Serial no., Status=Pending)
   ↓   └ Send "đơn mới cần duyệt" noti card vào bot
   ↑
   ☑ Form widget "Người đề xuất:" giữ tên thật của requester
     (Submitter native widget = Long admin proxy do cross-tenant)

┌─────────────────────────────────────────────────────────────┐
│ 2. STATUS SYNC (Approval → Base)                             │
└─────────────────────────────────────────────────────────────┘
   User duyệt / reject / cancel trên Lark Approval
   ↓ Lark gửi approval_instance event
   ↓ POST hrapprovals.kntmcptools.online/event       (URL Request đăng ký 1 cho cả app tenant2)
   ↓ HR server kiểm tra ev.approval_code:
   ↓   ├ E6D2C2C3 → xử lý HR local
   ↓   └ DAD13F4B → forward POST localhost:3200/event (DXC)
   ↓ DXC/HR server:
   ↓   ├ Lookup record bằng Instance field
   ↓   ├ Update Status (Approved/Rejected/Canceled/Reverted)
   ↓   └ Gửi noti card kết quả vào bot (✅/❌/🚫)
```

---

## 🔧 Setup

### Lark side

1. **App tenant 2 KAI** (`cli_a968bc93f5381e17`):
   - Set Request URL events = `https://hrapprovals.kntmcptools.online/event`
   - Subscribe events: `approval_instance`, `approval_task`
   - Subscribe approval form codes (cho mỗi form):
     ```bash
     lark-cli --profile tenant2 api POST \
       /open-apis/approval/v4/approvals/<APPROVAL_CODE>/subscribe \
       --as bot --data '{}'
     ```
2. **App writer-app** (`cli_a80df38cc639d02f`) — thêm làm Editor trên iSuccess Bases (HRM, CFM411).
3. **Custom Bot webhook** — incoming webhook URL gắn vào env `NOTI_WEBHOOK`.

### Server side (Mac mini)

```bash
# Clone
git clone https://github.com/kntgit0309/approval-cross.git
cd approval-cross

# Env
cp .env.example .env
# fill NOTI_WEBHOOK trong .env

# lark-cli profile
lark-cli config init   # add cli_a80df38cc639d02f (iSuccess) + tenant2 KAI

# Run HR server
cd hr-approval && node server.js     # port 3100
# Run DXC server
cd ../dxc-approval && node server.js # port 3200

# Cloudflare tunnel → expose port 3100 = hrapprovals.kntmcptools.online
#                          port 3200 = dxcpush.kntmcptools.online
```

### Lark Base Automation trigger

Trên bảng nguồn, tạo Automation:
- **Trigger:** `When a button is clicked` (button field `Retry` / `Submit`)
- **Action:** `Send HTTP Request`
  - URL: `https://<domain>/push-base`
  - Method: `POST`
  - Header: `Content-Type: application/json`
  - Body: `{"record_id": "{Step 1 action: Record ID}"}`

---

## 📁 Cấu trúc

```
.
├── README.md                      # File này
├── .env.example                   # Template biến môi trường
├── .gitignore
├── hr-approval/                   # Hệ HR (xin phép, nghỉ việc, OT…)
│   ├── README.md                  # Chi tiết flow HR
│   ├── server.js                  # HTTP relay :3100
│   └── push.js                    # Core push logic
├── dxc-approval/                  # Hệ Đề Xuất Chi
│   ├── README.md                  # Chi tiết flow DXC
│   ├── server.js                  # HTTP relay :3200
│   ├── push_batch.py              # Core push + writeback + noti
│   ├── auto_push_hoan_ung.py      # Cron auto-push Hoàn ứng (nếu có)
│   └── sync_cong_no.py            # Sync bảng 210.6 công nợ
└── tracking-ui/                   # Hệ tracking cho nhân viên (HR + DXC)
    ├── README.md                  # Chi tiết flow + tích hợp
    ├── server.js                  # Tracking server :3300 (H5 + data + send + patch)
    ├── lib.js                     # Core: fetch/normalize/card/send
    ├── send.js                    # CLI gửi card cho nhân viên
    └── public/track.html          # H5 detail page (self-contained)
```

---

## 📚 Concepts quan trọng

### Cross-tenant Submitter
- Lark Approval form tenant 2 KAI yêu cầu `Requester` widget là `user_id` tenant 2
- User iSuccess không tự động có user_id tenant 2 → submit bằng **Long admin** (`e63f4f5d`) làm proxy
- Tên requester thật được fill vào widget text riêng `Người đề xuất:` để người duyệt biết ai

### Dept Resolution (cùng pattern HR + DXC)
Lookup theo thứ tự, **dùng nguồn ĐẦU TIÊN match DEPT_MAP**:
1. `fetch_user_dept(requester)` — `1F_Phòng ban` từ bảng 20 NS
2. Field LC: `1L_Phòng ban 1 (auto)` → `4F_Phòng ban` → `Phòng ban 2 (manual)`
3. Fallback BU suffix: nếu `'Sub.BU'` không match map, thử lookup `BU` (vd `'Support.AMZ Eco'` → `'AMZ Eco'`)
4. (HR only) parse en_name suffix sau `.` (vd `'Phong NK.Website'` → `'Website'`)

### Writeback
Sau khi tạo instance Approval thành công, ghi 4 field về record Base:
- `Instance` / `1A_InstanceCode` ← `instance_code`
- `Request No.` / `1M_Request No.` ← `serial_number` (query `GET /approval/v4/instances/{code}`)
- `Serial no.` ← parse từ DXC-ID hoặc trả về từ form số nội bộ
- `Status` ← `Pending` / `Under review`

Với DXC multi-K: ghi cho **TẤT CẢ** K records cùng LC.

### Date timezone
Lark Approval date widget hiển thị **local time as-is**. Server phải gửi ISO format ICT, không convert UTC Z:
```
'2026-06-06 08:30:00' (local từ Base)  →  '2026-06-06T08:30:00+07:00'  ✅
                                       ↛  '2026-06-06T01:30:00Z'      ❌ lệch 7h
```

---

## 🐛 Troubleshooting nhanh

| Lỗi | Sửa ở |
|---|---|
| `need_user_authorization` | dùng `--as bot`, profile có app Editor cho Base |
| `dept open_id unknown: X` | Add `X` vào DEPT_MAP, hoặc map BU alias |
| `TK C2 key unknown` (DXC) | Add option vào `_EXTRA_C2`, đảm bảo block đặt TRƯỚC `if __name__ == '__main__'` |
| Cancel `Current process cannot be canceled` | Instance đã advanced node — log warning, vẫn push mới |
| Widget LINK_CT bị drop | URL value OK, kiểm tra widget definition + form payload spy |
| Approval card hiển thị `optXXX` | Dùng search/`batch_get` thay GET single record (enriched format) |
| Date lệch 7h | `toISO` phải return `+07:00` không convert UTC |
| Multi-K push 2 instance | Chỉ push từ K nhỏ nhất, skip K2+ với reason |
| Automation URL parse error | Bỏ chữ `POST ` thừa ở đầu URL field |

---

## 📜 License

Internal — iSuccess Corp.
