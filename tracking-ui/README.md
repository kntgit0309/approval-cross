# Approval Tracking — Card + H5 cho nhân viên

> Gửi cho **nhân viên (người đề xuất)** một card Lark theo dõi tiến độ phê duyệt **nhiều cấp**, kèm nút mở **trang H5 chi tiết** (timeline). Dùng chung cho cả **HR** (đơn nghỉ phép/OT) lẫn **DXC** (Đề Xuất Chi). Card **tự cập nhật** khi có người duyệt.

Đây là **bản chạy thật**, cắm vào kiến trúc sẵn có (`hr-approval/`, `dxc-approval/`) — không cần build, không dependency ngoài, chỉ dùng `lark-cli` (đã config profile trên Mac mini).

---

## 🗺️ Luồng

```
                ┌──────────── Lúc submit (hoặc bất kỳ lúc nào) ────────────┐
push.js/push_batch.py tạo instance Approval [KAI]  ──┐
                                                     ↓
            node tracking-ui/send.js <instance> <nhân_viên>   (hoặc POST /send)
                                                     ↓
            lib.fetchInstance(instance)  ← GET Approval [KAI] (profile tenant2)
            lib.normalize()              → canonical JSON (HR/DXC tự nhận diện)
            lib.buildCard()              → Lark Interactive Card
            lib.sendCard(to, card)       → im/v1/messages (bot writer-app tenant 1)
                                                     ↓
                          📩 Nhân viên nhận card trong Lark
                          [🔎 Xem chi tiết] → https://track.…/track?instance=…
                                                     ↓
                          H5 page fetch /track/data → render timeline

                ┌──────────── Khi có người duyệt/từ chối ────────────┐
Lark approval_instance event ──→ /event (server.js :3400)
                                     ↓ lib.getSent(instance) → message_id đã gửi
                                     ↓ re-fetch + normalize + buildCard
                                     ↓ lib.patchCard(message_id, card)
                          🔄 Card cũ trong chat nhân viên TỰ cập nhật tiến độ mới
```

---

## 📁 Files

```
tracking-ui/
├── server.js              # Standalone tracking server :3400 (serve H5 + data + send + patch)
├── lib.js                 # Core: fetch/normalize/card/send/patch/store/resolveUsers
├── send.js                # CLI: gửi card tracking cho 1 nhân viên
├── public/
│   └── track.html         # H5 detail page — self-contained (vanilla, no build)
├── approval-tracking.jsx  # Mockup React gốc (tham chiếu thiết kế)
├── store.json             # (runtime, gitignored) instance → {message_id, receive_id, sys}
├── usercache.json         # (runtime, gitignored) open_id → {name, initials}
└── README.md
```

---

## 🌐 Endpoints (`server.js`, port 3400)

| Endpoint | Method | Body / Query | Mô tả |
|---|---|---|---|
| `/` | GET | — | Health check |
| `/track` | GET | `?instance=CODE&sys=hr\|dxc` | Trả H5 page (`public/track.html`) |
| `/track/data` | GET | `?instance=CODE&sys=…` | Canonical JSON (H5 fetch cái này) |
| `/track/card` | GET | `?instance=CODE&sys=…` | Preview card JSON (debug) |
| `/track/push` | POST | `{instance, webhook?, sys?, force?}` | **Build card + bắn vào webhook** (cho Base Automation). Chống gửi trùng multi-K |
| `/send` | POST | `{instance, to, sys?}` | Build card + DM nhân viên (cần bot publish) |
| `/event` | POST | Lark event | `approval_instance` → re-fetch + PATCH card đã gửi |

`instance=DEMO` → trả dữ liệu mẫu, **không cần instance thật** (để xem/khoe giao diện ngay).

---

## 🧩 Canonical JSON (hợp đồng giữa lib ↔ card ↔ H5)

```jsonc
{
  "instanceCode": "…", "id": "LC2343K1", "system": "dxc",
  "status": "in_progress",                 // approved | in_progress | rejected | canceled
  "title": "Đề Xuất Chi · LC2343K1",
  "type": "Thanh toán", "amount": "12,500,000 VND", "summary": "…",
  "submitter": { "name": "…", "dept": "…", "time": "…", "initials": "KN", "color": "#1456F0" },
  "tags":  [ { "label": "Thanh toán", "kind": "type" }, … ],   // kind: type|amount|id|date
  "meta":  [ { "label": "Người gửi", "value": "…" }, … ],       // hàng key-value cho info card
  "steps": [ { "level": 1, "role": "Quản lý", "name": "…", "initials": "…",
               "color": "#1CB87E", "status": "approved", "time": "06/06 09:14",
               "comment": "…" }, … ],
  "links": { "record": "…", "qr": "…" }, "updatedAt": "09:14 06/06/2026"
}
```

Nguồn dữ liệu thật: `GET /open-apis/approval/v4/instances/{code}` (tenant2 KAI).
- `task_list[]` → `steps[]` (status APPROVED→approved, REJECTED→rejected, PENDING active→in_progress, còn lại pending).
- `form` (JSON widgets) → title/amount/dates/… match theo **tên widget** (`Người đề xuất:`, `Số tiền`, `Loại đơn`, `Ngày bắt đầu`…).
- Tên người duyệt: `open_id` → `contact/v3/users` (cache `usercache.json`).
- ⚠️ Người gửi lấy từ widget **`Người đề xuất:`** (submitter native là Long admin proxy do cross-tenant — xem README gốc).

---

## ⚙️ Setup & Deploy

> ⚠️ **Port (đã đối chiếu lsof trên mini production `ISuccess Mac mini`):** tracking dùng **`3400`** vì đó là port TRỐNG đúng họ. PORT (local) độc lập với TRACK_BASE_URL (host public) — cả hai override qua env.

**Bản đồ port Mac mini (thật):** `3100` hr-approval · `3200` dxc-approval · `3300` Support Console (`cssupport.*`) · `3401` home · `18790` **goclaw (BẬN — đừng dùng)** · ngoài ra bận: 3000/3001/4173/5432/7456/8000/8080/8081/8765-8770/8773/8787/9000/9100/20128. → **`3400` TRỐNG** (đã verify).

> ⚠️ **Domain:** `track.kntmcptools.online` đã bị một SPA khác chiếm (Cloudflare Pages / tunnel khác — KHÔNG có trong `config.yml` của mini). Vì vậy tracking dùng hostname riêng **`atrack.kntmcptools.online`** (trống), route mới qua chính tunnel mini.

```bash
# 1. Chạy server trên mini  (PORT + TRACK_BASE_URL override qua env)
PORT=3400 TRACK_BASE_URL=https://atrack.kntmcptools.online node tracking-ui/server.js
#   (hoặc pm2 start tracking-ui/server.js --name track / launchd)

# 2a. Thêm vào ~/.cloudflared/config.yml (TRÊN dòng `- service: http_status:404`):
#       - hostname: atrack.kntmcptools.online
#         service: http://127.0.0.1:3400
# 2b. Tạo DNS route cho tunnel mini (UUID 654e9432-…):
#       cloudflared tunnel route dns 654e9432-511a-48d9-af45-2cb804226acb atrack.kntmcptools.online
# 2c. Restart cloudflared để nạp config (vd: launchctl kickstart -k gui/$(id -u)/com.cloudflared … )

# 3. (Auto-update) forward approval_instance event sang :3400/event — xem mục Tích hợp
```

**Env:**
- `PORT` — port local server nghe (mặc định `3400`). Phải khớp target trong tunnel ingress.
- `TRACK_BASE_URL` — host public gắn vào nút card (mặc định `https://atrack.kntmcptools.online`).

**Profile lark-cli cần có:** `tenant2` (KAI — đọc Approval) + `cli_a80df38cc639d02f` (writer-app tenant 1 — bot DM nhân viên). Cả hai đã dùng sẵn ở `dxc-approval` / `hr-approval`.

---

## 🚀 Dùng

### Gửi card cho 1 nhân viên (CLI)
```bash
# <instance_code> lấy từ field Instance (bảng 57) hoặc 1A_InstanceCode (bảng 35V2)
# <to> = open_id (ou_…) / user_id / email / chat_id (oc_…) của nhân viên trên tenant 1
node tracking-ui/send.js 9F1B…-UUID ou_abc123 dxc
node tracking-ui/send.js 9F1B…-UUID info.khoa@isuccess.vn        # sys auto theo approval_code
```

### Gửi qua HTTP
```bash
curl -X POST http://127.0.0.1:3400/send \
  -H 'Content-Type: application/json' \
  -d '{"instance":"9F1B…-UUID","to":"ou_abc123","sys":"dxc"}'
# → { ok, message_id, track_url }
```

### Xem giao diện ngay (demo)
```
https://atrack.kntmcptools.online/track?instance=DEMO
```

---

## 🔌 Tích hợp với server có sẵn (auto-send + auto-patch)

### A. Tự gửi card cho nhân viên ngay sau khi push
Trong `push.js` (HR) / sau bước writeback của `push_batch.py` (DXC), gọi `/send` với `instance_code` vừa tạo và `open_id` nhân viên:

```js
// sau khi có instance_code + open_id nhân viên (resolve từ Requester / bảng 20 NS)
http.request({ host:'127.0.0.1', port:3400, path:'/send', method:'POST',
  headers:{'Content-Type':'application/json'} },
).end(JSON.stringify({ instance: instanceCode, to: employeeOpenId, sys: 'hr' }));
```

### B. Tự cập nhật card khi status đổi
Hai server hiện đã nhận `approval_instance` event (HR `:3100/event`, forward DXC `:3200/event`). Thêm 1 dòng **forward sang tracking** để card tự patch — không đụng logic cũ:

```js
// trong handler /event, sau khi updateStatus(...) — fire-and-forget:
require('http').request({ host:'127.0.0.1', port:3400, path:'/event', method:'POST',
  headers:{'Content-Type':'application/json'} }).end(JSON.stringify(body));
```

> `server.js /event` tự bỏ qua instance chưa từng gửi card (`store.json` không có) nên an toàn khi forward tất cả event.

---

## 🤖 Tự động gửi card sau khi đơn lên Approval (Base Automation)

Card gửi qua **custom-bot webhook** (vào group), không cần bot publish. Endpoint `POST /track/push` tự build card + bắn webhook (chống gửi trùng multi-K bằng `store.json`).

**Lark Base Automation trên bảng 57 (CFM411):**
1. **Trigger:** `When a record is updated` · field `Status 1` · điều kiện `Status 1` = `Pending` (ngay sau khi push xong, `Instance` đã ghi về).
2. **Action:** `Send HTTP request`
   - URL: `https://atrack.kntmcptools.online/track/push` (để nguyên, **không** thêm chữ `POST` ở đầu)
   - Method `POST` · Header `Content-Type: application/json`
   - Body: `{"instance":"{Instance}","webhook":"https://open.larksuite.com/open-apis/bot/v2/hook/…"}`

> Webhook truyền trong **body** (giữ trong Base của bạn, server không lưu secret). Nếu muốn body chỉ cần `{"instance":"{Instance}"}` thì nhúng `TRACK_WEBHOOK` vào env launchd (kém an toàn hơn).
> Báo kết quả cuối: thêm automation 2 — trigger `Status 1` = `Approved`/`Rejected`, Body thêm `"force":true` (webhook không sửa card cũ → gửi card mới).

## 🔒 Đóng gói chạy nền (launchd)

Server đang chạy `nohup` → mất khi mini reboot. Đóng gói launchd (tự bật lại) **trên mini**:

```bash
bash ~/tracking-ui/install-launchd.sh          # PORT/TRACK_BASE_URL mặc định, KHÔNG nhúng webhook
# (tuỳ chọn nhúng webhook vào env để body chỉ cần {instance}):
# TRACK_WEBHOOK='https://open.larksuite.com/open-apis/bot/v2/hook/…' bash ~/tracking-ui/install-launchd.sh
```
Quản: `launchctl kickstart -k gui/$(id -u)/com.approval-tracking.server` · log `tail -f ~/tracking-ui/server.log`.

---

## 🎨 Lark Design Tokens (H5 + card)

### Màu
| Token | Hex | Dùng cho |
|---|---|---|
| `primary` | `#1456F0` | Button, link, progress bar, header card |
| `success` | `#1CB87E` | Đã duyệt |
| `warn` | `#FF8800` | Đang duyệt |
| `danger` | `#F54A45` | Từ chối |
| `neutral9…1` | `#1F2329` → `#F9FAFB` | Text, label, border, background |
| Desktop bg | `#E8ECF2` | Nền tổng thể |

Typography: `'PingFang SC','SF Pro Text',-apple-system,…` · radius 8/12 · shadow `0 2px 8px rgba(31,35,41,.10)`.

### Status map
| status | Label | Màu | H5 icon | Card icon | Header card |
|---|---|---|---|---|---|
| `approved` | Đã duyệt | `#1CB87E` | ✓ polyline | 🟢 | green |
| `in_progress` | Đang duyệt | `#FF8800` | ••• (anim) | 🟡 | blue |
| `rejected` | Từ chối | `#F54A45` | ✕ | 🔴 | red |
| `pending` | Chờ duyệt | `#8F959E` | số cấp | ⚪️ | — |
| `canceled` | Đã hủy | `#8F959E` | ✕ | — | grey |

Card không vẽ được progress bar HTML → dùng dải emoji `🟩🟩🟨⬜️` + list từng cấp. Bản giàu (timeline, animated dot, comment expand) nằm ở **H5 page**.

---

## 🐛 Lưu ý

| Vấn đề | Ghi chú |
|---|---|
| Tên người duyệt ra `Người duyệt cấp N` | `contact/v3/users` chưa resolve (open_id lạ / cache rỗng) — sẽ tự fill khi gọi được API |
| Card không tự update | Chưa forward event sang `:3400/event`, hoặc instance gửi trước khi có `store.json` |
| `track?instance=…` lỗi tải | Tunnel chưa expose 3400, hoặc instance_code sai/đã xóa |
| Ngày lệch 7h | `fmtTime` giữ local ICT `+07:00` — không convert UTC (giống push.js) |
| H5 lộ thông tin với ai có link | Tool nội bộ; hardening: thêm Lark JSAPI auth (`@larksuite/web-sdk`) kiểm tra user trước khi render |
| Multi-K (DXC) | 1 instance = 1 card; gửi cho người đề xuất của LC đó |

---

*Mockup thiết kế gốc: `approval-tracking.jsx` (render bằng React). Bản chạy thật ở trên dùng `public/track.html` (vanilla) cùng design tokens.*
