# HĐLĐ Tool — Sinh hợp đồng lao động từ Lark Base

Server đọc dữ liệu nhân sự trên **Lark Base**, đổ vào **template Google Docs** và ghi link tài liệu sinh ra trở lại Base.

> Base nguồn: `DLewbVqU7aZM65sAW6mlcOpngse` (cùng base chấm công/lương — bảng 30/35/39/40…)

---

## Luồng

```
[User submit form tạo HĐ]
        │  (set "Mã template" → trỏ 1 record bảng 26)
        ▼
[24. Tool tạo tài liệu] ── data 4F_… (Họ tên, Ngày sinh, CCCD, Lương…)
        │
        │  engine đọc [27. Biến merge]:  {{Bxxx}} ↔ 4F_<Tên trên Base> ──link──> [26. Template]
        ▼
[copy Google Doc template → replaceAllText {{Bxxx}} → giá trị 4F_]
        ▼
[Google Doc sinh ra] ── ghi link vào field `File Docs` của bảng 24
```

| Bảng | Table ID | Vai trò |
|---|---|---|
| **24** Tool tạo tài liệu | `tblnLGFNlUfoHC6G` | Nguồn data (`4F_…`) + đích lưu link (`File Docs`) |
| **27** Biến merge | `tblXJzGzyAJkq6jy` | Map `{{Bxxx}}` ↔ tên field `4F_` ↔ template nào áp dụng |
| **26** Template | `tblqRlWLHyo8tvpu` | Google Doc chứa placeholder `{{Bxxx}}` |

---

## Server

Node thuần (không framework), gọi Lark qua **lark-cli** (profile config sẵn trên Mac mini) và sinh doc qua **Google service account**. Khớp pattern hr/dxc/tracking.

```
hdld-tool/
  server.js            HTTP :3502 — POST /generate {record_id}
  generate.js          orchestrator: record bảng24 → doc link (cũng chạy CLI: node generate.js <rec>)
  lib.js               lark-cli wrapper + bitable CRUD + normalize value
  google.js            service account: copyTemplate + replacePlaceholders
  install-launchd.sh   đóng gói launchd (KeepAlive) trên mini
  .env.example         cấu hình
```

### Endpoint

| Method | Path | Body | Tác dụng |
|---|---|---|---|
| GET | `/` | — | health check |
| POST | `/generate` | `{ "record_id": "rec...", "token": "...", "force": false }` | sinh doc+PDF cho 1 record bảng 24, ghi link về `File Docs`/`File PDF` |

Body `/generate`:
- `record_id` — bắt buộc (hoặc `stt` = `1F_STT` để server tự resolve record_id).
- `token` — bắt buộc nếu server set `HDLD_TOKEN` (cũng nhận `?token=` hoặc header `Authorization: Bearer`).
- `force` — `true` để tạo lại dù đã có `File Docs` (dùng cho nút "Tạo lại tài liệu"). Mặc định idempotent: đã có `File Docs` → trả `{skipped:"already_generated"}`.
- Record chưa có `Mã template` → `{skipped:"no_template"}`; chưa kịp tính `4F_Họ và tên` → `{skipped:"not_ready"}` (automation retry vô hại).

Mỗi lần generate: copy Google Doc template → replace `{{Bxxx}}` → **xuất PDF** → ghi link doc về `File Docs` và link PDF về `File PDF` (cả hai field kiểu URL → ghi object `{link,text}`).

Xử lý giá trị đặc biệt:
- **Ngày** (field tên chứa `ngày` — kể cả sau `_` như `4F_Ngày cấp` — hoặc `bắt đầu`/`kết thúc`, giá trị số serial/epoch/`DD/MM/YYYY`) → format `DD/MM/YYYY`. KHÔNG khớp "cấp"/"sinh" trơ để tránh format nhầm số tiền ("Phụ cấp" = số).
- **Ngày ký** B028/B029/B030 (+B007) tách từ **`4F_HĐLĐ Ngày bắt đầu`** (fallback `4F_Ngày thực hiện`) thành ngày/tháng/năm; nguồn có thể là serial hoặc text.
- **Bằng chữ** B031 (lương cơ bản) / B066 (phụ cấp) → đọc số tiền thành chữ tiếng Việt (vd `9000000` → "Chín triệu đồng").

`POST /generate` trả JSON: `docUrl`, `docId`, `pdfUrl`, `pdfId`, `template{recordId,name,srcDocId}`, `varsCount`, **`unresolved`** (biến không tìm thấy field nguồn) và **`warnings`** (vd mismatch doc-id).

```bash
curl -s -XPOST http://127.0.0.1:3502/generate \
  -H 'Content-Type: application/json' \
  -d '{"record_id":"recXXXXXXXX","token":"<HDLD_TOKEN>"}' | jq
```

### Automation (Lark Base → server)

Endpoint nội bộ `127.0.0.1:3502`; để Lark Base gọi được cần route public (Cloudflare tunnel) `hdld.* → 127.0.0.1:3502`. Server bảo vệ bằng `HDLD_TOKEN`.

Hai automation trên **bảng 24** (Lark Base → Automation → action "Gửi yêu cầu HTTP"):

1. **Khi bản ghi được tạo** → POST `https://hdld.<domain>/generate`
   - Header: `Content-Type: application/json`
   - Body: `{"record_id":"<record id của trigger>","token":"<HDLD_TOKEN>"}`
   - Lúc mới tạo field có thể chưa settle → server trả `not_ready`/`no_template`; lần cập nhật sau (khi điền `Mã template`) gọi lại sẽ sinh. (Có thể thêm automation thứ 2: trigger "bản ghi cập nhật" + điều kiện `Mã template` ≠ rỗng & `File Docs` rỗng.)

2. **Nút "Tạo lại tài liệu"** (field Button) → POST cùng URL
   - Body thêm `"force":true` để tạo lại dù đã có `File Docs`.

> Nếu UI automation không chèn được record_id, gửi `{"stt":"<1F_STT>","token":"..."}` — server tự tra record_id theo `1F_STT`.

### Cách chọn template & doc-id (quan trọng)

- Record bảng 24 phải có **`Mã template`** (link) trỏ tới 1 record bảng 26. Engine lấy template từ đó (KHÔNG đoán theo Loại HĐ).
- Doc nguồn để copy: lấy **doc-id trong `Link template`** (doc người sửa thật), không dùng field `ID template`.
  - ⚠️ Lý do: **TEM001** đang mismatch — `ID template` = `1F1xGm…` nhưng doc trong `Link template` = `1c9NxZ…`. Engine ưu tiên doc của Link template và **log cảnh báo** khi 2 id khác nhau.
  - Muốn ép doc khác: set `TEMPLATE_DOC_OVERRIDE` (JSON `{"id_sai":"id_đúng"}`).
- Biến áp dụng: lọc các record bảng 27 có `Template` link tới đúng record template; fallback theo CSV `Biến` trên record template.
- Biến có `Tên trên Base` không tồn tại trong record 24 (vd `2M_…`, `4L_…`) → placeholder bị thay **rỗng** và liệt kê trong `unresolved` (không để sót `{{Bxxx}}` trong hợp đồng).

---

## Cài đặt & deploy (Mac mini)

```bash
# 1) đưa thư mục lên mini, cài deps
cd ~/hdld-tool && npm install        # googleapis

# 2) đặt service account JSON (ngoài git) + share quyền
#    - SA email được share Editor: các Google Doc template (bảng 26) + thư mục đích
cp /path/sa-key.json ~/hdld-tool/sa-key.json

# 3) cấu hình env (xem .env.example) — tối thiểu:
export GOOGLE_SA_KEY=~/hdld-tool/sa-key.json
export GOOGLE_DEST_FOLDER_ID=<id thư mục Shared Drive chứa doc sinh ra>

# 4) chạy thử 1 record
node generate.js recXXXXXXXX

# 5) đóng gói launchd (KeepAlive, port 3502)
bash ~/hdld-tool/install-launchd.sh
```

**Tunnel:** thêm ingress `hdld.* → http://127.0.0.1:3502` vào `~/.cloudflared/config.yml` + route DNS (qua Cloudflare Zero Trust dashboard, giống `atrack.*`/`track.*` đang ở dashboard tunnel).

### Lưu ý service account
- SA **thường không có quota** lưu file trong My Drive cá nhân → đặt `GOOGLE_DEST_FOLDER_ID` là thư mục trong **Shared Drive** (SA là Editor). Mọi call Drive đã bật `supportsAllDrives`.
- SA phải được share quyền **đọc** từng Google Doc template, nếu không `drive.files.copy` sẽ 404.

### Lưu ý lark-cli
- `LARK_PROFILE` phải có quyền **đọc + ghi** bitable trên base HR. Mặc định `cli_a80df38cc639d02f` (reader tenant1) — kiểm tra lại quyền GHI `File Docs`, đổi profile nếu thiếu.

---

## Điểm bất thường còn treo (cần người xác minh)

- [ ] **TEM001 mismatch doc-id** — xác minh doc nào đúng (`1F1xGm…` hay `1c9NxZ…`); nếu cần ép, dùng `TEMPLATE_DOC_OVERRIDE`.
- [ ] **Bảng 27 B055** ("4L_Các khóa học đã Pass") thiếu `Nhóm các biến`, link 4 template thay vì 3.
- [ ] Biến prefix `2M_/4L_` (vd B007 `2M_Ngày thực hiện`, B008 `4L_NS-ID Key`) **không khớp tên field** bảng 24 → sẽ vào `unresolved`. Cần sửa `Tên trên Base` cho khớp field thật, hoặc bổ sung field vào bảng 24.
- [ ] `Tên hiển thị` (bảng 27) dính `\n` ở đầu — không ảnh hưởng merge (engine dùng `Biến khai báo` + `Tên trên Base`), nhưng nên dọn nếu hiển thị lên UI.

---

_Đọc/ghi Base qua `lark-cli` profile trên `macmini`; sinh doc qua Google service account._
