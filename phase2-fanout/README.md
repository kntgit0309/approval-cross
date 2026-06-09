# Phase 2 — Fan-out trạng thái duyệt cross-tenant

Đẩy thông báo kết quả duyệt (DM interactive card) **tới đúng user trong org của họ**, sau khi Approval (tenant trung tâm) trả status về. Triển khai theo [lark-approval-phase2-isv-plan.md](../../../Downloads/lark-approval-phase2-isv-plan.md).

> **Trạng thái:** module độc lập, **chạy & test hoàn toàn OFFLINE** (mock transport). **Chưa cắm vào server Phase 1 đang chạy** — xem [Wire-in](#wire-in) khi sẵn sàng.

## Vì sao cần module này

App/bot ở tenant trung tâm **không DM được** user thuộc 7 org kia (ràng buộc plan §3). Phải có app hiện diện trong từng org. Server trung tâm chỉ **điều phối**; việc *gửi* đi qua token của org user. Module này gói toàn bộ phần đó sau **1 interface duy nhất** để đổi ISV ↔ 8 custom app không phải sửa logic.

## Nguyên tắc số 1 — cô lập tầng token (plan §4)

```
getTenantToken(tenant_key) -> token      // src/token-manager.js
```

Mọi thứ phía dưới (resolve open_id, dựng card, gửi message) chỉ gọi hàm này, **không biết** đang chạy ISV hay custom.

| | Provider ISV (`src/providers/isv.js`) | Provider custom (`src/providers/custom.js`) |
|---|---|---|
| Nguồn token | `app_ticket → app_access_token → tenant_access_token(tenant_key)` | `(app_id, app_secret)` của org → `tenant_access_token` thẳng |
| `app_ticket` | Cần (single point of failure, có resend) | Không cần |
| Setup | 1 app cài 8 org | 8 app, 8 bộ credential |

**Đổi chế độ = đổi `PROVIDER_MODE` + đổ bảng credential.** Không đụng fan-out/card. Test `Swap provider ISV → CUSTOM` chứng minh điều này.

## Luồng fan-out (plan §7)

`src/fanout.js` → `notifyApprovalResult({ instanceCode, status, businessId, tenantKey, card })`:

1. **Idempotency** — skip nếu `(instance_code + status)` đã bắn (chống event retry).
2. **getTenantToken(tenantKey)** — token đúng org (cache theo `(app_id, tenant_key)`, TTL ~2h).
3. **resolveOpenId(businessId)** — `contact/v3/users/batch_get_id` (cache lại open_id).
4. **buildStatusCard(status, card)** — xanh = duyệt, đỏ = từ chối, nút "Xem chi tiết".
5. **sendCard** — `im/v1/messages`, `receive_id_type=open_id`, `msg_type=interactive`.

Fan-out **không ném lỗi ra ngoài** — trả object `{ ok, error, code, skipped }` để result-handler chính không bị hỏng.

## Chạy

```bash
cd phase2-fanout
node --test        # 9 test offline, không network
node demo.js       # demo 1 lượt fan-out + in card + chuỗi API call
```

Cấu hình thật: `cp .env.example .env` rồi điền. Custom mode: `cp config/credentials.example.json config/credentials.json`.

## Cấu trúc

```
src/
  config.js            # PROVIDER_MODE, host, load registry/directory/credentials
  lark-client.js       # transport mỏng (INJECTABLE → test bơm mock)
  token-manager.js     # ★ getTenantToken(tenant_key) — interface cô lập
  providers/isv.js     # app_ticket → app_access → tenant_access
  providers/custom.js  # app_id/secret → tenant_access thẳng
  app-ticket-store.js  # lưu app_ticket bền (.data/, KHÔNG giữ RAM)
  token-cache.js       # cache token (app_id, tenant_key) TTL ~2h
  resolve-open-id.js   # batch_get_id + cache open_id
  build-card.js        # interactive card theo status
  send-message.js      # im/v1/messages
  idempotency.js       # dedupe instance_code+status
  event-handlers.js    # handle event app_ticket + bắt tenant_key lúc cài app
  fanout.js            # ★ orchestrator notifyApprovalResult(...)
config/                # tenant_registry, user_directory, credentials.example
test/                  # mock-transport + fanout.local.test.js (offline)
.data/                 # state bền (gitignored): app_ticket, cache, idempotency
```

## Data model (plan §6)

- `config/tenant_registry.json` — `org_name → tenant_key` (+ `installed`). Tự cập nhật từ event cài app (`event-handlers.js`).
- `config/user_directory.json` — `business_id → tenant_key` (+ open_id cache).
- **Gap cần làm ở Base:** mỗi record submit phải mang **business_id bền** + **field org/tenant**. Fan-out đọc 2 cái này từ record để biết gửi cho ai, org nào.

## Wire-in

Khi sẵn sàng cắm vào Phase 1 (HR `server.js:154`, DXC `server.js:280`) — chỗ đã có `status` + `instance_code` + record. **Thêm**, không thay:

```js
// trong result-handler, sau khi đã update status về Base:
const { createFanout } = require('../phase2-fanout/src/fanout');
const fanout = createFanout(); // PROVIDER_MODE từ .env; transport thật

const f = fetchRecordFields(recId); // đã có sẵn ở DXC
const r = await fanout.notifyApprovalResult({
  instanceCode: instCode,
  status,
  businessId: asText(f['Email']),          // field business_id bền — CẦN có trên Base
  tenantKey:  asText(f['Tenant']),          // field org/tenant — CẦN thêm nếu chưa có
  card: { type: 'ĐXC', title: dxc, requester, dept, amount: amtStr, content: mota, detailUrl: linkDxc },
});
if (!r.ok) log(`fanout skip/err: ${r.error || r.skipped} ${r.code || ''}`);
```

Và 1 route event riêng cho ISV (KHÔNG đụng `/event` cũ):

```js
const { handleIsvEvent } = require('../phase2-fanout/src/event-handlers');
// POST /event-isv:
const out = handleIsvEvent(body);
if (out.type === 'url_verification') return jsonRes(res, 200, { challenge: out.challenge });
return jsonRes(res, 200, { code: 0 });
```

## Việc còn lại trước production (plan §12)

- [ ] Điền `ISV_APP_ID/SECRET` thật (hoặc credentials.json cho custom).
- [ ] Thêm field **org/tenant** + **business_id** vào Base submit nếu chưa có.
- [ ] Đăng ký event `app_ticket` + install trỏ về route `/event-isv`.
- [ ] Add 8 org làm test enterprise; admin mỗi org cài app + set availability.
- [ ] Xác nhận email/SĐT ở trung tâm khớp directory từng org (nếu khác → cần map riêng).
- [ ] (Tùy chọn) outbox + retry backoff cho lỗi 429 (hiện idempotency + cache đã có).
```
