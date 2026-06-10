# Promo Approval — Duyệt thăng tiến / bổ nhiệm / thưởng (B28 → Approval)

Đẩy đơn từ bảng **B28** (HRM) → Approval **"Duyệt thăng tiến/ bổ nhiệm / thưởng"** trên tenant 2 KAI. Cùng pattern với [hr-approval/](../hr-approval/) + [dxc-approval/](../dxc-approval/) (chiều submit: Base → Approval, cross-tenant, Long admin proxy).

> **Trạng thái:** `push_promo.js` đã chạy **dry-run OK** cho loại "Duyệt NV thử việc vào chính thức". Còn 2 việc trước khi tạo instance thật (xem §Pending). Chạy trên **macmini** (`ssh macmini`, user duong) — nơi có profile `tenant2` + `cli_a80df...`.

## Hằng số

| | Giá trị |
|---|---|
| **Base HRM** | `DLewbVqU7aZM65sAW6mlcOpngse` |
| **Bảng B28** | `tblVw1dYJhkg1RUM` |
| **Approval code** | `3083B2D4-583A-4A1F-9072-220BB655FC0F` |
| **Profile đọc Base** | `cli_a80df38cc639d02f` (tenant 1) |
| **Profile tạo instance** | `tenant2` (tenant 2 KAI) |
| **Submitter proxy** | `e63f4f5d` (Long admin) |

## `2M_Loại đơn` — 1 form gánh 5 loại

1. Duyệt thay đổi Level (thăng tiến) — `mjmmvci0-vhul31k9igs-0`
2. Duyệt Ứng Viên Vào Thử Việc (tuyển dụng) — `mjmmvci0-6x05wvpwa3h-0`
3. **Duyệt NV thử việc vào chính thức** — `mjmmvci0-0n8t5rzfbuff-0` ← đã làm
4. Duyệt nhận thưởng Best Design/ Rising Star — `mjmmvcj2-lueu5ky775-1`
5. Duyệt nhận thưởng Best Support — `mjmmvcj2-jcko0ctgt1-3`

Mỗi loại dùng subset widget khác nhau (form có 46 widget, chỉ **RQ-ID + Loại đơn là required**).

## Mapping B28 → widget approval (loại "vào chính thức")

| Widget (id) | type | ← B28 field |
|---|---|---|
| RQ-ID `…0898540001` | input | `RQ-ID` |
| Loại đơn `…1444560001` | radioV2 | `2M_Loại đơn` → key |
| Tiêu chí vào chính thức `…3602740001` | textarea | `Tiêu chí vào chính thức` |
| Người đề xuất `…1270680001` | contact | **Long proxy** (xem Pending ①) |
| Người được đề xuất `…3365820001` | contact | **Long proxy** (xem Pending ①) |
| Họ và tên `…2960510001` | input | `4L_Họ và tên` |
| Phòng ban `…3133690001` | department | `4L_Phòng ban` → DEPT_MAP |
| BU `…6883100001` | department | `4L_BU` → DEPT_MAP |
| Chức vụ `…3329380001` | input | `4F_Chức vụ` |
| Ngày vào chính thức `…6788650001` | date | `Ngày vào chính thức` |
| Level hiện tại `…3508640001` | radioV2 | `4L_Level hiện tại` → key (73 opts) |
| Đề xuất Level `…4615430001` | radioV2 | `Đề xuất chuyển sang Level` → key |
| KPI Level mới `…4817110001` | number | `4F_KPI Level mới` |
| Thực đạt tháng trước/này | number | cùng tên |
| Thời gian áp dụng `…5027110001` | date | `Thời gian áp dụng` |

Option key của radioV2 (Loại đơn, Level hiện tại, Đề xuất Level…) nằm trong [`form-maps.json`](./form-maps.json).

**Writeback** (như HR/DXC): `1A_InstanceCode` ← instance_code, `2M_Status` ← 'Under Review', `1M_Request No.` ← serial_number.

## Chạy

```bash
# trên macmini (ssh macmini)
cd ~/promo-push                 # nơi deploy (hoặc clone repo dir promo-approval)
node push_promo.js <record_id>            # DRY-RUN (mặc định, in payload, KHÔNG tạo)
node push_promo.js <record_id> --commit   # TẠO instance thật + writeback
```

## ⚠️ Pending (làm tiếp trên máy cty)

**① Contact mapping cross-tenant** — hiện cả "Người đề xuất" + "Người được đề xuất" = Long proxy → **approval route qua Long, không đúng người**.
- B28 chỉ có `open_id tenant-1` của người (vd `ou_b565e366…`); approval tenant-2 cần `user_id tenant-2`.
- Cách giải: thêm scope `contact:contact:readonly` cho bot `cli_a80df…` → lấy email từ open_id tenant-1 → `batch_get_id` (tenant2) → user_id tenant-2. Điền vào `resolveContact()` / `USER_T2_MAP`.
- Hoặc dùng bảng nhân sự (link `NS-ID` → `recuZ7kmJ17ORG`) nếu có sẵn user_id tenant-2.

**② DEPT_MAP chưa đủ** — vd "Etsy 2.ZenE" chưa có → widget Phòng ban bị bỏ (optional, vẫn tạo được). Bổ sung dần trong `DEPT_MAP` hoặc resolve động qua `/contact/v3/departments` tenant-2 (xem hr-approval/push.js cách lookup bảng 53).

**③ Các loại đơn khác** — mới làm "vào chính thức". 4 loại còn lại (thăng tiến/ứng viên/2 thưởng) dùng subset widget khác — mở rộng `push_promo.js` theo `2M_Loại đơn`.

## Liên quan
- Chiều ngược (Approval → hiển thị): tracking-ui trên macmini (`atrack.kntmcptools.online`) — cần thêm hệ `promo` vào `SYS_BY_CODE` để hiện đúng (xem [phase2-fanout/STATUS.md](../phase2-fanout/STATUS.md)).
