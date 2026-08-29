#!/usr/bin/env python3
"""Lưới an toàn: quét bảng 57 tìm đơn ĐXC đã tạo nhưng KHÔNG có Instance (không lên Approval).

Chạy định kỳ (launchd). CHỈ CẢNH BÁO, không tự push — người xử lý quyết định push lại.

Bỏ qua:
- Đơn tạo dưới GRACE_MIN phút (có thể đang push dở)
- Đơn K2+ khi K1 cùng lô đã có Instance (multi-K đẩy chung qua K1)
- Đơn đã cảnh báo rồi (state file), tránh spam mỗi lần chạy

Usage: check_missing_instance.py [--days N] [--dry-run]
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from push_batch import lark, BASE_TOKEN, TBL_57, PROFILE_BASE, first

NOTI_WEBHOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/cd0c70bd-1e37-4c42-9185-639d4948cdcf'
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'missing_instance_state.json')
GRACE_MIN = 20          # đơn mới hơn ngần này phút thì bỏ qua (có thể đang push)
DEFAULT_DAYS = 3
ICT = timezone(timedelta(hours=7))


def fetch_recent(days):
    """Lấy toàn bộ record bảng 57 (API không filter được field text ngày) rồi lọc theo ngày tạo."""
    items, token = [], None
    while True:
        params = {'page_size': 500}
        if token:
            params['page_token'] = token
        res = lark('api', 'POST',
                   f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/search',
                   '--as', 'bot', '--params', json.dumps(params),
                   '--data', json.dumps({'automatic_fields': True}), profile=PROFILE_BASE)
        data = res.get('data') or {}
        items += data.get('items') or []
        token = data.get('page_token')
        if not data.get('has_more'):
            break

    now = datetime.now(ICT)
    since = (now - timedelta(days=days)).strftime('%Y%m%d%H%M%S')
    cutoff = (now - timedelta(minutes=GRACE_MIN)).strftime('%Y%m%d%H%M%S')

    rows = []
    for it in items:
        f = it.get('fields') or {}
        created = first(f.get('1F_Ngày giờ tạo (text)')) or ''
        if not (since <= created <= cutoff):
            continue
        rows.append({
            'record_id': it.get('record_id'),
            'dxc_id': first(f.get('DXC-ID')) or '',
            'instance': first(f.get('Instance')),
            'created': created,
            'amount': first(f.get('4F_Số tiền')),
            'currency': first(f.get('4F_Tiền tệ')) or 'VND',
            'mota': first(f.get('Mô tả')) or first(f.get('1F_NDCK')) or '',
            'link': first(f.get('1A_Link ĐXC')) or '',
        })
    return rows


def find_missing(rows):
    """Đơn thiếu Instance. K2+ được tha nếu K1 cùng lô đã có Instance (multi-K push qua K1)."""
    have_inst = {r['dxc_id'] for r in rows if r['instance']}

    def lo(dxc):                      # LC3277K2 → LC3277
        return dxc.rsplit('K', 1)[0] if 'K' in dxc else dxc

    lo_ok = {lo(d) for d in have_inst}
    out = []
    for r in rows:
        if r['instance']:
            continue
        if not r['dxc_id'].endswith('K1') and lo(r['dxc_id']) in lo_ok:
            continue                  # K2+ đã đi kèm K1
        out.append(r)
    return out


def load_state():
    try:
        with open(STATE_FILE) as fh:
            return set(json.load(fh).get('alerted') or [])
    except Exception:
        return set()


def save_state(alerted):
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump({'alerted': sorted(alerted),
                   'updated': datetime.now(ICT).isoformat()}, fh, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def fmt_amount(amount, currency):
    try:
        return f'{float(str(amount).replace(",", "")):,.0f} {currency}'
    except Exception:
        return f'{amount} {currency}'


def send_alert(missing):
    lines = []
    for r in missing:
        try:
            when = datetime.strptime(r['created'], '%Y%m%d%H%M%S').strftime('%d/%m %H:%M')
        except Exception:
            when = r['created']
        name = f"[{r['dxc_id']}]({r['link']})" if r['link'] else r['dxc_id']
        lines.append(f"• {name} — {fmt_amount(r['amount'], r['currency'])} — {when} — {r['mota'][:60]}")

    card = {
        'msg_type': 'interactive',
        'card': {
            'config': {'wide_screen_mode': True},
            'header': {'title': {'tag': 'plain_text',
                                 'content': f'⚠️ {len(missing)} đơn ĐXC chưa lên Approval'},
                       'template': 'orange'},
            'elements': [
                {'tag': 'div', 'text': {'tag': 'lark_md',
                                        'content': '\n'.join(lines[:25])}},
                {'tag': 'div', 'text': {'tag': 'lark_md',
                                        'content': '👉 Cần push lại thủ công (mỗi đơn chỉ báo 1 lần).'}},
                {'tag': 'note', 'elements': [{'tag': 'lark_md',
                                              'content': '🤖 check_missing_instance • dxc-push'}]},
            ],
        },
    }
    req = urllib.request.Request(
        NOTI_WEBHOOK, data=json.dumps(card, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status


def main():
    days = DEFAULT_DAYS
    if '--days' in sys.argv:
        days = int(sys.argv[sys.argv.index('--days') + 1])
    dry = '--dry-run' in sys.argv

    rows = fetch_recent(days)
    missing = find_missing(rows)
    alerted = load_state()
    fresh = [r for r in missing if r['dxc_id'] not in alerted]

    print(json.dumps({'scanned': len(rows), 'missing': len(missing), 'new': len(fresh),
                      'dxc_ids': [r['dxc_id'] for r in fresh]}, ensure_ascii=False))

    if fresh and not dry:
        send_alert(fresh)
        # chỉ giữ state của các đơn còn trong cửa sổ quét → state không phình mãi
        in_window = {r['dxc_id'] for r in rows}
        save_state((alerted | {r['dxc_id'] for r in fresh}) & in_window)


if __name__ == '__main__':
    main()
