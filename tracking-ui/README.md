# Lark Approval Tracking — Thiết kế & Tài liệu

> Luồng tracking phê duyệt nhiều cấp hiển thị trong Lark Chat, lấy dữ liệu từ Lark Approval native (approval.larksuite.com)

---

## Kiến trúc tổng quan

```
Lark Approval API
  ↓ (Webhook callback khi status thay đổi)
Backend Server (FastAPI / Node.js)
  ↓ GET /approval/v4/instances/{instance_id}
  ↓
  ├── Interactive Card JSON  →  PATCH vào Lark message (realtime update)
  └── H5 MiniApp URL         →  Link nhúng trong card → mở trong Lark browser
```

---

## 1. Lark Design Tokens

Toàn bộ UI áp dụng đúng design system của Lark/Feishu:

### Màu sắc

| Token | Hex | Dùng cho |
|---|---|---|
| `primary` | `#1456F0` | Button, header, link, progress bar |
| `primaryHov` | `#0E47D6` | Button hover state |
| `primaryBg` | `#EEF3FF` | Tag background (primary) |
| `success` | `#1CB87E` | Trạng thái "Đã duyệt" |
| `successBg` | `#E8F9F2` | Background tag success |
| `warn` | `#FF8800` | Trạng thái "Đang duyệt" |
| `warnBg` | `#FFF4E5` | Background callout đang xử lý |
| `danger` | `#F54A45` | Trạng thái "Từ chối" |
| `dangerBg` | `#FFF0EF` | Background tag danger |
| `neutral9` | `#1F2329` | Text chính (title, name) |
| `neutral8` | `#3D3D3D` | Text thứ cấp |
| `neutral7` | `#51545B` | Button text phụ |
| `neutral6` | `#646A73` | Label, meta |
| `neutral5` | `#8F959E` | Placeholder, time |
| `neutral4` | `#B2B8C0` | Icon phụ, border nhạt |
| `neutral3` | `#DEE0E3` | Border mặc định, divider |
| `neutral2` | `#F3F4F5` | Background row, tag neutral |
| `neutral1` | `#F9FAFB` | Background panel H5 |
| `white` | `#FFFFFF` | Background card, button |
| Desktop bg | `#E8ECF2` | Background tổng thể Lark desktop |

### Typography

```
font-family: 'PingFang SC', 'SF Pro Text', -apple-system, 'Helvetica Neue', sans-serif
```

| Dùng cho | Size | Weight |
|---|---|---|
| Card title | 14px | 600 |
| H5 page title | 16px | 600 |
| Nav bar title | 15px | 600 |
| Body / meta | 12–13px | 400–500 |
| Tag / label | 11px | 500 |
| Timestamp | 11px | 400 |

### Border radius & Shadow

```
radius:   8px   (card nội dung, button, tag)
radiusLg: 12px  (card container chính)

shadow:   0 2px 8px rgba(31,35,41,0.10), 0 0 1px rgba(31,35,41,0.08)
shadowLg: 0 8px 24px rgba(31,35,41,0.12), 0 2px 6px rgba(31,35,41,0.06)
```

---

## 2. Status Map

| Status | Label | Màu | Icon |
|---|---|---|---|
| `approved` | Đã duyệt | `#1CB87E` | ✓ (SVG polyline) |
| `in_progress` | Đang duyệt | `#FF8800` | ••• (3 dot animation) |
| `rejected` | Từ chối | `#F54A45` | ✕ |
| `pending` | Chờ duyệt | `#8F959E` | số thứ tự cấp |

---

## 3. Component: Interactive Card (Lark Chat)

Hiển thị như bot message trong Lark group/DM. Cấu trúc:

```
┌─────────────────────────────────────┐
│ [icon] Yêu cầu phê duyệt  [Đang duyệt] │  ← Header bar màu primary
├─────────────────────────────────────┤
│ Tiêu đề đề xuất                      │
│ [Tag: loại] [Tag: số tiền] [Tag: ID] │
├─────────────────────────────────────┤
│ [Avatar] Tên người gửi · Dept  Giờ  │  ← Submitter row
├─────────────────────────────────────┤
│ Tiến độ phê duyệt           2/4 cấp │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░    │  ← Progress bar gradient
│ ●──✓──●···──○──○                    │  ← Step dot track
│ Lan   Hùng  Dũng  Hà               │
├─────────────────────────────────────┤
│ ⚠ Đang chờ phê duyệt               │  ← Callout warnBg
│   [Avatar] Phạm Quốc Dũng — Giám đốc│
├─────────────────────────────────────┤
│ [  Xem chi tiết  ]  [ Nhắc nhở ]   │  ← Actions
└─────────────────────────────────────┘
```

### Lark Interactive Card JSON (template)

```json
{
  "config": { "wide_screen_mode": true },
  "header": {
    "template": "blue",
    "title": { "tag": "plain_text", "content": "Yêu cầu phê duyệt" }
  },
  "elements": [
    {
      "tag": "div",
      "text": { "tag": "lark_md", "content": "**Đề xuất mua thiết bị văn phòng Q3**" }
    },
    {
      "tag": "div",
      "fields": [
        { "is_short": true, "text": { "tag": "lark_md", "content": "**Người gửi**\nNguyễn Minh Tuấn" }},
        { "is_short": true, "text": { "tag": "lark_md", "content": "**Số tiền**\n48.500.000 ₫" }}
      ]
    },
    { "tag": "hr" },
    {
      "tag": "note",
      "elements": [
        { "tag": "plain_text", "content": "⏳ Đang chờ: Phạm Quốc Dũng — Giám đốc bộ phận" }
      ]
    },
    {
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Xem chi tiết" },
          "type": "primary",
          "url": "https://your-h5-app.com/approval?id=APP-2025-0612"
        },
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Nhắc nhở" },
          "type": "default",
          "value": { "action": "remind", "instance_id": "APP-2025-0612" }
        }
      ]
    }
  ]
}
```

---

## 4. Component: H5 MiniApp (Detail Panel)

Trang web nhúng trong Lark browser / side panel. Cấu trúc:

```
┌─────────────────────────────────────┐
│ ← Chi tiết phê duyệt    [Đang duyệt]│  ← Nav bar (white, border-bottom)
├─────────────────────────────────────┤
│ Info Card (white)                   │
│   Tiêu đề 16px/600                  │
│   Tags: loại · tiền · ID            │
│   Người gửi | Thời gian | Mô tả     │  ← Key-value rows
├─────────────────────────────────────┤
│ Quy trình phê duyệt                 │
│ ████████░░░░░░░░  2/4 cấp          │  ← Progress bar
│                                     │
│  ✓ ─────────────────────────────   │
│  [TTL] Trần Thị Lan    [Đã duyệt]   │  ← Step card (successBg border)
│  🕐 06/06 09:14                     │
│  > Xem nhận xét ▼                   │  ← Expandable comment
│                                     │
│  ✓ ─────────────────────────────   │
│  [LVH] Lê Văn Hùng     [Đã duyệt]  │
│                                     │
│  ··· ───────────────────────────   │  ← Animated dots
│  [PQD] Phạm Quốc Dũng [Đang duyệt] │  ← warnBg border
│                                     │
│  4  ────────────────────────────   │
│  [NTH] Ngô Thanh Hà    [Chờ duyệt] │  ← neutral border
│  Chưa đến lượt phê duyệt (italic)  │
├─────────────────────────────────────┤
│ [  Nhắc người duyệt  ]  [ Rút đơn ]│  ← Footer actions
└─────────────────────────────────────┘
```

### Tính năng H5
- Click step card → expand/collapse comment (animated `max-height`)
- Progress bar animated khi load
- Scroll độc lập, footer cố định
- Dot animation `larkDot` cho bước `in_progress`

---

## 5. API Tích hợp

### Lấy dữ liệu approval instance

```http
GET https://open.larksuite.com/open-apis/approval/v4/instances/{instance_id}
Authorization: Bearer {tenant_access_token}
```

Response fields cần dùng:

```json
{
  "instance": {
    "approval_code": "...",
    "status": "PENDING",
    "form": "...",
    "task_list": [
      {
        "id": "...",
        "node_name": "Quản lý trực tiếp",
        "status": "APPROVED",
        "user_id": "...",
        "start_time": "...",
        "end_time": "...",
        "comments": [{ "content": "..." }]
      }
    ],
    "timeline": [...]
  }
}
```

### Webhook event khi có cập nhật

```json
{
  "event": {
    "type": "approval_instance",
    "approval_code": "...",
    "instance_code": "APP-2025-0612",
    "status": "PENDING",
    "task": {
      "node_name": "Giám đốc bộ phận",
      "status": "APPROVED",
      "user_id": "..."
    }
  }
}
```

### Update card sau khi có approver mới

```http
PATCH https://open.larksuite.com/open-apis/im/v1/messages/{message_id}
Content-Type: application/json
Authorization: Bearer {token}

{
  "msg_type": "interactive",
  "content": "{...updated card JSON...}"
}
```

---

## 6. Backend Handler (FastAPI)

```python
from fastapi import FastAPI, Request
import httpx

app = FastAPI()

@app.post("/webhook/approval")
async def handle_approval_event(request: Request):
    body = await request.json()
    event = body.get("event", {})
    instance_id = event.get("instance_code")
    
    # 1. Lấy full instance data
    instance = await get_approval_instance(instance_id)
    
    # 2. Build card JSON mới
    card = build_approval_card(instance)
    
    # 3. Patch message trong Lark chat
    message_id = await get_message_id_by_instance(instance_id)
    await patch_lark_message(message_id, card)
    
    return {"code": 0}

async def get_approval_instance(instance_id: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://open.larksuite.com/open-apis/approval/v4/instances/{instance_id}",
            headers={"Authorization": f"Bearer {TENANT_TOKEN}"}
        )
        return resp.json()["data"]["instance"]
```

---

## 7. H5 App Setup

```bash
# Next.js hoặc plain Vite React
npm create vite@latest lark-approval-h5 -- --template react
cd lark-approval-h5
npm install @larksuite/web-sdk  # Lark JSAPI cho auth
```

```javascript
// pages/approval.jsx
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function ApprovalDetail() {
  const params = useSearchParams()
  const instanceId = params.get('id')
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch(`/api/approval/${instanceId}`)
      .then(r => r.json())
      .then(setData)
  }, [instanceId])

  // Render timeline UI
}
```

---

## 8. Cấu trúc file dự án

```
lark-approval-tracking/
├── frontend/
│   ├── components/
│   │   ├── LarkCard.jsx        # Interactive card mockup
│   │   ├── H5Detail.jsx        # H5 detail panel
│   │   ├── StepTimeline.jsx    # Timeline steps
│   │   ├── ProgressBar.jsx     # Progress bar
│   │   └── StatusTag.jsx       # Status badge
│   ├── tokens/
│   │   └── lark.js             # Design tokens L{}
│   └── pages/
│       └── approval.jsx        # H5 page
├── backend/
│   ├── main.py                 # FastAPI app
│   ├── webhook.py              # Webhook handler
│   ├── lark_api.py             # Lark API client
│   └── card_builder.py        # Build card JSON
└── card-templates/
    └── approval-card.json      # Lark card JSON template
```

---

## 9. Bước tiếp theo

- [ ] Setup Lark App tại [open.larksuite.com](https://open.larksuite.com) → lấy App ID + Secret
- [ ] Cấu hình webhook endpoint cho event `approval_instance`
- [ ] Deploy backend (FastAPI) + expose qua Cloudflare Tunnel (port hiện tại: 18790)
- [ ] Build H5 page → deploy → cấu hình URL trong Lark App
- [ ] Test end-to-end: tạo approval → bot gửi card → approver duyệt → card tự update

---

*Tài liệu này đi kèm file `approval-tracking.jsx` — React mockup đầy đủ của cả 2 component.*
