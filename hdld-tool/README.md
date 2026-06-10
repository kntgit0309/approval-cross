# HĐLĐ Tool — Phân tích Lark Base

Tài liệu phân tích hệ thống **sinh tài liệu nhân sự (HĐLĐ)** trên Lark Base.

> Nguồn: Base HR chấm công/lương `DLewbVqU7aZM65sAW6mlcOpngse`
> (cùng base với các bảng 30/35/39/40… về chấm công & lương)

---

## Tổng quan luồng

```
[26. Template] ──(ID template / Biến)──> [24. Tool tạo tài liệu] ──(File Docs)──> Google Docs đã sinh
```

- **Bảng 26 "Template"**: kho template HĐLĐ (Google Docs) + danh sách biến thay thế.
- **Bảng 24 "Tool tạo tài liệu"**: engine đổ dữ liệu nhân sự vào template → xuất ra tài liệu, lưu link ở `File Docs`.

---

## Bảng 24 — "Tool tạo tài liệu"

| Thuộc tính | Giá trị |
|---|---|
| Table ID | `tblnLGFNlUfoHC6G` |
| Số field | 100 |
| Số record | 96 |

### Quy ước đặt tên field (prefix)

| Prefix | Ý nghĩa | Loại field |
|---|---|---|
| `2M_…(manual)` | Dữ liệu nhập tay (lương, ngày ký, CCCD, giới tính…) | text / select / number / datetime / link |
| `1L_…(auto)` | Kéo từ bảng khác qua lookup (nguồn chính: **"20. 🤝 Danh sách NS"**) | lookup |
| `4F_…(final)` | Giá trị tổng hợp cuối cùng để đổ vào template | formula |
| `1F_…` | Hệ thống (STT, thời gian tạo) | auto_number / created_at |
| `… chưa đúng ?` | ~25 checkbox QC từng trường (Ngày sinh, Lương, Vị trí, Người đại diện…) | checkbox |
| `File Docs`, `Link tài liệu đã ký`, `1A_Link ruta`, `ID template` | Output: link/file tài liệu đã tạo | text / lookup |

### Liên kết (link fields)
- `NS-ID`, `QL-ID`, `2M_Địa điểm làm việc 2` → link sang các bảng nhân sự khác.
- Lookup nguồn chính từ **"20. 🤝 Danh sách NS"** và `tblw5nuyhFSUy0nb` (LS-Phòng ban).

### Trường `File Docs` (`fldbXJAs7b`)
- Kiểu: **text style URL** — chứa link **Google Docs** của tài liệu đã sinh.
- Định dạng: `https://docs.google.com/document/d/<docId>/edit?usp=drivesdk`
- Tình trạng điền: **89 / 96 có link · 7 trống**.

**7 record trống `File Docs`** (đều chưa có `Link tài liệu đã ký` ⇒ chưa generate tài liệu):

| STT | Họ tên |
|---|---|
| 093 | Nguyễn Thị Thúy An |
| 122 | Bùi Thanh Tuyền |
| 139 | Phạm Trần Kiều Ánh |
| 140 | Phạm Trần Kiều Ánh |
| 141 | Võ Minh Hải |
| 143 | Huỳnh Hà Ny |
| 144 | Trần Hoàng Tân |

> ⚠️ STT **139 & 140 trùng tên** "Phạm Trần Kiều Ánh" — nghi record nhân đôi, cần kiểm tra lại.

---

## Bảng 26 — "Template"

| Thuộc tính | Giá trị |
|---|---|
| Table ID | `tblqRlWLHyo8tvpu` |
| Số field | 8 |
| Số record | 3 |

### Field
`1F_STT` (auto_number) · `Link template` (text/url) · `Template` (formula — logic chọn template) · `Loại tài liệu` (select) · `ID template` (text) · `Loại HĐ` (select) · `Biến` (lookup — danh sách biến thay thế) · `Tên Template` (text)

### Dữ liệu template

| STT | Tên Template | Loại HĐ | ID template | Khớp link? |
|---|---|---|---|---|
| 001 | HĐLĐ Thử Việc | Thử việc | `1F1xGmACD8ru1ugs4kZzXRnRNG2bTOpibRMCtx5W2qb4` | ❌ **KHÔNG** |
| 002 | HĐLĐ CHÍNH THỨC CÓ THỜI HẠN | Có thời hạn | `1r4-ttMz7oloQADMTPUF1Jn-JJln240Hajos_1e5HGfk` | ✅ |
| 003 | HĐLĐ Thử Việc - Mai VT | Thử việc | `1F7t-VtLzVqnTbU4L3tiizpmVFqUzm1P2NlJNg2lm-Ak` | ✅ |

Tất cả là loại "Hợp đồng lao động", template lưu trên Google Docs.

> ⚠️ **Bất thường STT 001:** `ID template` **không khớp** doc id trong `Link template`:
> - `ID template` = `1F1xGmACD8ru1ugs4kZzXRnRNG2bTOpibRMCtx5W2qb4`
> - doc id trong link = `1c9NxZeQEnrT4IUFBauS_vVMF7XFXqNDejL1g7c7qtLs`
>
> STT 002 & 003 khớp đúng. ⇒ Nếu tool dùng `ID template` để copy doc, STT 001 có thể đang trỏ **sai template**. Cần xác minh doc nào mới đúng.

---

## Việc cần làm tiếp (TODO)

- [ ] Xác minh mismatch `ID template` ở **Template STT 001** — doc nào là bản đúng.
- [ ] Kiểm tra cặp record trùng **NS STT 139 / 140** (Phạm Trần Kiều Ánh).
- [ ] Generate tài liệu cho 7 record còn trống `File Docs` (sau khi check đủ field input).
- [ ] Soát các checkbox `… chưa đúng ?` để lọc record có dữ liệu lỗi trước khi sinh tài liệu.

---

_Truy cập Base qua `lark-cli` trên máy `macmini` (đã config sẵn identity user)._
