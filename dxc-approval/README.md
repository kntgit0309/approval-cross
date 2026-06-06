# DXC Approval — Đề Xuất Chi (Payment Proposal)

Server bridge giữa bảng CFM411 **57 ĐXC** (`tblp36MD9kmWmZRO`) → Lark Approval form `DAD13F4B-3D66-4597-8263-1031A80D7FEF` tenant 2 KAI.

**Port 3200** · **Domain `dxcpush.kntmcptools.online`**

---

## 🗺️ Luồng

```
┌──────────────────────────────────────────────────────────────┐
│ SUBMIT (Single LC or Multi-K)                                 │
└──────────────────────────────────────────────────────────────┘
Base CFM411 (RcX6wwhnZiJsQrkx7TPl9OlCglc / tblp36MD9kmWmZRO)
   ↓ Button Retry click (Automation Base — Send HTTP Request)
   ↓ POST dxcpush.kntmcptools.online/push-base   body={record_id}
   ↓
server.js  (port 3200)
   ↓ /push-base → resolveDxcId(record_id) → call push_batch.py
   ↓
push_batch.py
   ├── fetch_lc_siblings(dxc_id) — tất cả K records cùng LC
   ├── Nếu current ≠ smallest K → skip "push via base K=LC...K1"
   ├── Auto-cancel: nếu record có Instance cũ → POST /instances/cancel
   ├── Resolve dept (priority match DEPT_MAP):
   │     • fetch_user_dept (1F_Phòng ban từ bảng 20 NS)
   │     • 1L_Phòng ban 1 (auto)
   │     • 4F_Phòng ban
   │     • Phòng ban 2 (manual)
   │     • BU fallback (vd 'Support.AMZ Eco' → 'AMZ Eco')
   ├── Resolve requester user_id tenant 2 (USER_T2_MAP, fallback Long admin)
   ├── Build form payload:
   │     • Top-level widgets: LC-ID, Requester, Phòng ban, Loại đơn,
   │       Tên TK C1/C2/C2.5/C3, Mô tả Lô Chi, NDCK_BO,
   │       Link chứng từ, Hạn TT, Link ĐXC, TT qua, Người đề xuất:
   │     • fieldList "Các khoản chi" (N items, 1/K):
   │       Mô tả, Số tiền, Loại TK, English Bank Name, Email-STK, Chủ TK
   ├── Download attachments:
   │     • Đọc field 'File/Tài liệu chứng từ' từ tất cả K
   │     • GET /drive/v1/medias/batch_get_tmp_download_url
   │       với extra={"bitablePerm":{"tableId":"tblp36MD9kmWmZRO"}}
   │     • Download → save ~/dxc-push/public/<lc>_K<idx>_<idx>.<ext>
   │     • Append public URLs vào widget Link chứng từ
   ├── POST /open-apis/approval/v4/instances → tenant 2 KAI
   ├── writeback_instance(all_record_ids, instance_code, dxc_id):
   │     • Instance     ← instance_code (cả N K)
   │     • Status 1     ← 'Pending'
   │     • Request No.  ← serial_number từ Approval API
   │     • Serial no.   ← parse từ DXC-ID (LC2654K1 → 2654)
   └── notify_push_card → bot webhook 🔔 "Push — 1 đơn mới cần duyệt"

┌──────────────────────────────────────────────────────────────┐
│ STATUS SYNC                                                   │
└──────────────────────────────────────────────────────────────┘
User duyệt/reject trên Lark Approval
   ↓ event approval_instance status=APPROVED/REJECTED/CANCELED/...
   ↓ POST hrapprovals.kntmcptools.online/event   (URL chung tenant 2)
   ↓ HR server check ev.approval_code = DAD13F4B → forward
   ↓ POST localhost:3200/event
   ↓
server.js /event
   ├── findRecordByInstance(instance_code) — search bảng 57 theo Instance
   ├── updateDxcStatus(record_id, status):
   │     PENDING→Pending, APPROVED→Approved, REJECTED→Rejected,
   │     CANCELED→Canceled, DELETED→Deleted, REVERTED→Reverted
   └── Nếu status ≠ PENDING → sendStatusNoti(record_id, instance_code, status)
        ✅ green / ❌ red / 🚫 grey / ↩️ orange theme card
```

---

## 📂 Files

```
dxc-approval/
├── server.js                 HTTP relay :3200 — routes: /push, /push-batch,
│                              /push-base, /event, /img/:file, /auto-push-hoan-ung,
│                              /sync-cong-no
├── push_batch.py             Core push + writeback + noti
├── auto_push_hoan_ung.py     Cron auto-push Hoàn ứng (mỗi 5p) qua launchd
└── sync_cong_no.py           Sync bảng 210.6 công nợ (mỗi 10p)
```

---

## ⚙️ Constants (push_batch.py)

```python
APPROVAL_CODE = 'DAD13F4B-3D66-4597-8263-1031A80D7FEF'  # [KAI] Đề xuất chi
BASE_TOKEN    = 'RcX6wwhnZiJsQrkx7TPl9OlCglc'           # CFM411 Base
TBL_57        = 'tblp36MD9kmWmZRO'                       # bảng 57 ĐXC
TBL_20        = 'tbl0edSaPODwl2Ne'                       # bảng 20 NS
TBL_54        = 'tblqqqEBYRcsIjTl'                       # bảng 54 ĐMC
PROFILE_BASE     = 'cli_a80df38cc639d02f'                # tenant 1 iSuccess
PROFILE_APPROVAL = 'tenant2'                              # tenant 2 KAI
LONG_USER     = 'e63f4f5d'                                # Long admin tenant 2
```

### W dict — Form widgets

| Key | Widget ID | Tên | Loại | Source |
|---|---|---|---|---|
| `LC` | widget17722753358230001 | LC-ID | input | `lc_id_short` |
| `REQ` | widget17600081356300001 | Requester | contact | USER_T2_MAP / Long |
| `REQ_NAME` | widget17805866523170001 | Người đề xuất: | input | `requester_name` |
| `DEPT` | widget17604405159210001 | Phòng ban | department | resolved `open_department_id` |
| `LOAI_DON` | widget17600073486700001 | Loại đơn | radioV2 | Thanh toán/Hoàn ứng/Tạm ứng key |
| `C1` | widget17600074266640001 | Tên TK C1 | input | `4F_Tên TK C1` |
| `C2` | widget17608436088880001 | Tên TK C2 | radioV2 | C2_KEYS lookup |
| `C25` | widget17660528398620001 | Tên TK C2.5 | radioV2 | Normal hardcode |
| `C3` | widget17660529077140001 | Tên TK C3 | input | `4F_Tên TK C3` |
| `MOTA` | widget17616249848160001 | Mô tả Lô Chi | textarea | `Mô tả Lô Chi` field |
| `NDCK_BO` | widget17689822824110001 | NDCK cần bỏ mã ISU | input | "Không" hardcode |
| `KHOAN` | widget17600076876340001 | Các khoản chi | fieldList | **N items per K**, xem bảng dưới |
| `LINK_CT` | widget17600079038590001 | Link chứng từ | input | URL text + public URLs ảnh |
| `HAN_TT` | widget17600080405520001 | Hạn thanh toán | date | ISO ICT +07:00 |
| `LINK_DXC` | widget17625971107210001 | Link ĐXC | input | `1A_Link ĐXC` |
| `TT_QUA` | widget17701805557680001 | TT qua | input | field `Cần chi qua` (manual) |

### Sub-widgets fieldList "Các khoản chi" (per K item, 6 fields, theo đúng thứ tự)

| Widget ID | Tên | Source per K |
|---|---|---|
| `widget17616245704220001` | Mô tả | field `Mô tả` (per K) |
| `widget17600077199570001` | Số tiền | `4F_Số tiền` |
| `widget17600078545610001` | Loại tài khoản | VN Bank hardcode |
| `widget17600078246080001` | English Bank Name | `4F_English Bank Name` (Thanh toán/Tạm ứng) hoặc bank requester (Hoàn ứng) |
| `widget17600078077980001` | Email - STK | `4F_Email - STK` |
| `widget17600079111360001` | Chủ tài khoản | `4F_Chủ tài khoản` |

---

## 🗂️ DEPT_MAP — Phòng ban → tenant 2 open_department_id

| Phòng ban | open_department_id |
|---|---|
| Purchasing.AMZ Eco | `od-3be65c7752943973b956f22aa1fe2294` |
| Support.ZenE | `od-9c433b6119f103bf6a1f271c4c50c0d6` |
| Support Account.ZenE | `od-9c433b6119f103bf6a1f271c4c50c0d6` (= Support.ZenE) |
| AMZ.AMZ Eco | `od-fc35b649a100cd218e40cd6d684336e6` |
| HR | `od-9af9fe1764c4f209ed65e4266ca81f4c` |
| HUB | `od-6f16989ea2443cd3b3596f7b5a6d3a1a` |
| Amazon Eco | `od-0d878683a0ceefa0588d94af27dfd991` |
| AMZ Eco | `od-0d878683a0ceefa0588d94af27dfd991` (BU alias) |
| Support.AMZ Eco | `od-0d878683a0ceefa0588d94af27dfd991` |
| R&D.AMZ Eco | `od-7ec89adc0ddf39d568995ed725c6382b` |
| ZenE | `od-9c433b6119f103bf6a1f271c4c50c0d6` |
| Etsy | `od-8aafc66758639c2d2231f74f185e5b43` |
| Website | `od-5509c762108f3a4c28a9c7f589f4b47e` |

---

## 🌐 Endpoints

| Endpoint | Method | Body | Mô tả |
|---|---|---|---|
| `/` | GET | — | Health |
| `/push` | POST | `{"dxc_id":"LC2654K1"}` | Push 1 LC theo DXC-ID |
| `/push-batch` | POST | `{"dxc_ids":[...]}` | Push nhiều |
| `/push-base` | POST | `{"record_id":"recXXX"}` | Resolve record → DXC-ID → push (dùng cho Automation Base) |
| `/auto-push-hoan-ung` | POST | `{}` | Scan + push Hoàn ứng pending |
| `/sync-cong-no` | POST | `{}` | Sync bảng 210.6 |
| `/event` | POST | Lark event | Sync status từ Approval |
| `/img/:file` | GET | — | Serve ảnh/PDF public từ `public/` |

---

## 🔄 Writeback fields (writeback_instance)

Sau push thành công, ghi vào **TẤT CẢ K records** cùng LC:

| Field bảng 57 | Field ID | Giá trị |
|---|---|---|
| `Instance` | `fldEgl37a9` | `instance_code` |
| `Status 1` | `fldnKARoM9` | `Pending` |
| `Request No.` | `fld6Z5CooP` | `serial_number` (Approval API `GET /instances/{code}`) |
| `Serial no.` | `fldeKmTkAV` | parse từ DXC-ID (`LC2654K1` → `2654`) |

Khi event sync:

| Lark status | Status 1 |
|---|---|
| `PENDING` | `Pending` |
| `APPROVED` | `Approved` |
| `REJECTED` | `Rejected` |
| `CANCELED` | `Canceled` |
| `DELETED` | `Deleted` |
| `REVERTED` | `Reverted` |

---

## 📎 Multi-K Logic

1 Lô Chi (LC) có thể có nhiều K record (LC2699K1, LC2699K2, …). Mỗi K = 1 khoản chi riêng (recipient riêng).

- `fetch_lc_siblings(dxc_id)`: query bảng 57 lấy tất cả K cùng LC, sort theo K number
- Trong `push_one`: nếu `dxc_id` ≠ K nhỏ nhất → return `skipped` với reason `"push via base K=LC<num>K1 (multi-K)"`
- Form `fieldList` (Các khoản chi) chứa **N items** (1 cho mỗi K), mỗi item có bank info + amount riêng
- `writeback_instance(record_ids[], ...)` ghi 4 field vào TẤT CẢ K records

→ User click Retry trên K1 hay K2 đều OK, server chỉ push **1 instance** cover tất cả.

---

## 🔁 Auto-replace (Cancel old + Push new)

`/push-base` (và `push_one`) tự cancel instance cũ trước khi push mới:
1. Đọc field `Instance` của record
2. POST `/open-apis/approval/v4/instances/cancel` với Long admin user_id
3. Nếu instance đã advanced node (manager đã action) → API trả `"Current process cannot be canceled"` → log warning, vẫn push mới
4. Continue push → writeback Instance mới override

→ Mỗi LC luôn chỉ có **1 active instance** trên Approval. Anh click Retry nhiều lần không accumulate.

---

## 📎 Attachment serving

Function `serve_attachments(siblings, lc_short)`:
1. Đọc field `File/Tài liệu chứng từ` (Attachment, `fldjzwx65e`) từ **tất cả K** records
2. Với mỗi `file_token`: gọi `GET /open-apis/drive/v1/medias/batch_get_tmp_download_url` với param:
   ```json
   {"file_tokens":[file_token],"extra":"{\"bitablePerm\":{\"tableId\":\"tblp36MD9kmWmZRO\"}}"}
   ```
   **Phải có `extra.bitablePerm.tableId`** — nếu không sẽ trả empty array
3. Download `tmp_download_url` (pre-signed, không cần auth header) qua `urllib.request.urlretrieve`
4. Save `public/<lc>_K<idx>_<idx>.<ext>`
5. Sinh URL `https://dxcpush.kntmcptools.online/img/<filename>` (Cloudflare tunnel → /img/:file)
6. Combine với `Link chứng từ` text field, join `\n`, fill vào widget LINK_CT

⚠️ Lark-cli `base +record-download-attachment` có bug: trả `"param baseToken is invalid"`. Tránh — dùng `batch_get_tmp_download_url` + urllib thay.

---

## 🔔 Noti cards

Webhook: `NOTI_WEBHOOK` env var (bot custom incoming webhook).

### Push noti — `notify_push_card` (Python)
Gửi sau mỗi `push_one()` thành công. Header green 🔔. Nội dung: Người đề xuất, Phòng ban, Loại đơn, TK C3, Số tiền, Hạn TT, Nội dung. Footer Phân tích ĐMC nếu có.

### Status noti — `sendStatusNoti` (JS, server.js)
Gửi từ `/event` handler khi status ≠ PENDING. Theme:
| Status | Theme | Icon |
|---|---|---|
| APPROVED | green | ✅ |
| REJECTED | red | ❌ |
| CANCELED / DELETED | grey | 🚫 |
| REVERTED | orange | ↩️ |

Nội dung: LC ID (clickable), Request No., Người đề xuất, Phòng ban, TK C3, Số tiền, Cần chi qua, Nội dung, QR (nếu có).

---

## 🐛 Vấn đề đã gặp & fix

| Lỗi | Fix |
|---|---|
| `TK C2 key unknown: <text>` (CLI fail, REPL OK) | `_EXTRA_C2` block đặt SAU `if __name__=='__main__'` → main chạy với C2_KEYS chưa update. Fix: move `_EXTRA_C2` lên TRƯỚC main block |
| `TK C2 key unknown: <new option>` | Get value key từ form schema: `lark-cli --profile tenant2 api GET /open-apis/approval/v4/approvals/DAD13F4B-...` parse `data.form` → widget `widget17608436088880001`. Add vào `_EXTRA_C2` |
| `Automation parse "POST https://..." first path segment cannot contain colon` | URL field gõ thừa `POST ` ở đầu — xoá đi, method đã set ở dropdown |
| Submit Approval sai phòng ban | `dept_name` priority: bảng 20 NS → LC fields. Dùng nguồn ĐẦU MATCH `DEPT_MAP`. Có BU suffix fallback |
| `dept open_id unknown: <dept>` | Add vào DEPT_MAP, hoặc alias BU suffix |
| `need_user_authorization` (event lookup) | DXC server `/event` dùng `--as bot` (launchd context hết user token) |
| Currency hiển thị `optXXX` thay vì VND | JS GET single record `--as bot` trả raw option ID. Dùng `batch_get` POST → enriched format |
| Widget LINK_CT bị drop khỏi form response | Bug timing — code state lúc push chưa update. Retest verify form đầy đủ |
| Cancel instance fail "Current process cannot be canceled" | Instance đã advanced manager node — log warning, vẫn push mới OK |

---

## 🔧 Common commands

```bash
# Push 1 LC (qua DXC-ID)
curl -X POST https://dxcpush.kntmcptools.online/push \
  -H 'Content-Type: application/json' -d '{"dxc_id":"LC2687K1"}'

# Push nhiều
curl -X POST https://dxcpush.kntmcptools.online/push-batch \
  -H 'Content-Type: application/json' \
  -d '{"dxc_ids":["LC2687K1","LC2688K1"]}'

# Trigger Automation flow (qua record_id)
curl -X POST https://dxcpush.kntmcptools.online/push-base \
  -H 'Content-Type: application/json' -d '{"record_id":"recXXX"}'

# Auto-push Hoàn ứng ngay
curl -X POST https://dxcpush.kntmcptools.online/auto-push-hoan-ung

# Cancel 1 instance approval
lark-cli --profile tenant2 api POST \
  /open-apis/approval/v4/instances/cancel --as bot \
  --params '{"user_id_type":"user_id"}' \
  --data '{"approval_code":"DAD13F4B-3D66-4597-8263-1031A80D7FEF",
           "instance_code":"XXX","user_id":"e63f4f5d"}'

# Dry-run
python3 ~/dxc-push/push_batch.py LC2687K1 --dry-run

# Restart server
launchctl kickstart -k gui/501/com.dxc-push.server

# Tail logs
tail -f ~/dxc-push/server.log
```
