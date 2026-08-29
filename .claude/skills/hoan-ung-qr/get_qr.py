#!/usr/bin/env python3
"""Tra QR chuyển khoản của 1 đơn (ưu tiên Hoàn ứng) theo LC-ID — bảng 57 CFM411.

Chạy trên MacBook: gọi lark-cli qua `ssh macmini` (profile tenant 1 iSuccess).
Usage:  python3 get_qr.py LC3408 [--json] [--open]
        python3 get_qr.py 3408
"""
import json, re, subprocess, sys, urllib.parse

BASE = 'RcX6wwhnZiJsQrkx7TPl9OlCglc'   # CFM411
TBL_57 = 'tblp36MD9kmWmZRO'            # 57. Đề Xuất Chi
PROFILE = 'cli_a80df38cc639d02f'       # tenant 1 iSuccess (đọc Base)
SSH_HOST = 'macmini'

FIELDS = ['DXC-ID', 'LC-ID', 'LC-ID-TƯ', 'Status 1', '4L_Status của cả LC',
          '4F_Loại đơn', '4F_Loại hoàn ứng', '4F_Số tiền', '4F_Số tiền còn lại',
          '4F_Tổng tiền lô chi', '1F_Chênh lệch', '4F_Tiền tệ', '1F_TT KC',
          '4F_Cách chuyển tiền LC', '1F_NDCK', '4F_Link QR', '4F_Link QR 1',
          '1F_QR hoàn tiền thừa về MB Bank', '1L_Có qua QR ko?',
          '4F_English Bank Name', '4F_Email - STK', '4F_Chủ tài khoản',
          '4L_Bank của TKT (55)', '4L_Email/STK TKT', '4L_Tên TK TKT',
          '4L_Số tiền đã tạm ứng', 'Số tiền đã sử dụng', '1M_Nhân sự',
          'Requester', '1L_Người đề xuất ID', '1A_Link ĐXC', 'Instance']


def lark_search(lc_id):
    body = {'field_names': FIELDS, 'automatic_fields': False,
            'filter': {'conjunction': 'and', 'conditions': [
                {'field_name': 'LC-ID', 'operator': 'is', 'value': [lc_id]}]}}
    cmd = ('export PATH=/opt/homebrew/bin:$PATH; lark-cli --profile %s api POST '
           '"/open-apis/bitable/v1/apps/%s/tables/%s/records/search" --as bot '
           "--params '{\"page_size\":20}' --data %s" %
           (PROFILE, BASE, TBL_57, json_shell(body)))
    out = subprocess.run(['ssh', SSH_HOST, cmd], capture_output=True, text=True, timeout=90)
    if out.returncode != 0:
        raise SystemExit('ssh/lark-cli lỗi: ' + (out.stderr or out.stdout)[:300])
    try:
        res = json.loads(out.stdout)
    except json.JSONDecodeError:
        raise SystemExit('Không parse được output: ' + out.stdout[:300])
    if not res.get('ok'):
        raise SystemExit('Lark API lỗi: ' + json.dumps(res.get('error'), ensure_ascii=False)[:300])
    return res.get('data', {}).get('items') or []


def json_shell(obj):
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "'\\''") + "'"


def val(f, key):
    """Lấy giá trị phẳng của field bitable (formula/lookup/text/number)."""
    v = f.get(key)
    if isinstance(v, dict):
        v = (v.get('value') or [None])[0]
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, dict):
        return v.get('text') or v.get('link') or v.get('name') or v
    return v


def money(x, cur='VND'):
    if x is None:
        return '-'
    try:
        return '{:,.0f} {}'.format(abs(float(x)), cur).replace(',', '.')
    except (TypeError, ValueError):
        return str(x)


def diagnose(f):
    """Vì sao 4F_Link QR rỗng."""
    loai_hu = val(f, '4F_Loại hoàn ứng') or ''
    if (val(f, '4L_Status của cả LC') or '') != 'Approved':
        return 'Đơn chưa duyệt xong (4L_Status của cả LC = %s) → QR chỉ sinh khi Approved.' % (
            val(f, '4L_Status của cả LC') or 'trống')
    if not val(f, '1F_Chênh lệch'):
        return ('Chênh lệch = 0 → đơn đã tất toán (đã chi/đã thu xong), QR tự tắt. '
                'Cần QR lại thì kiểm tra giao dịch thực ở bảng 56.')
    if val(f, '4F_Cách chuyển tiền LC') == 'Chi gộp 1 TK' and val(f, '1F_TT KC') != 1:
        return 'LC "Chi gộp 1 TK" → QR chỉ nằm ở record có 1F_TT KC = 1 (thường là K1).'
    if loai_hu != 'NV hoàn trả' and not val(f, '1L_Có qua QR ko?'):
        return ('Thiếu bank người nhận: 1M_Nhân sự rỗng hoặc bảng 20 chưa đủ '
                '(Bank / STK / Chủ tài khoản) → 1L_Có qua QR ko? = 0. '
                'Fix: set 1M_Nhân sự = người đề xuất trên record bảng 57.')
    return 'Không rõ — soi trực tiếp 4F_Link QR / 4F_Link QR 1 / 1F_QR hoàn tiền thừa về MB Bank.'


def report(f):
    cur = val(f, '4F_Tiền tệ') or 'VND'
    loai_don = val(f, '4F_Loại đơn') or '-'
    loai_hu = val(f, '4F_Loại hoàn ứng') or ''
    qr = val(f, '4F_Link QR') or ''
    chenh = val(f, '1F_Chênh lệch')
    nv_tra = loai_hu == 'NV hoàn trả'
    if nv_tra:
        bank = '%s %s — %s (TK công ty)' % (val(f, '4L_Bank của TKT (55)') or '?',
                                            val(f, '4L_Email/STK TKT') or '?',
                                            val(f, '4L_Tên TK TKT') or '?')
        huong = 'NV chuyển trả công ty'
    else:
        bank = '%s %s — %s (TK cá nhân)' % (val(f, '4F_English Bank Name') or '?',
                                            val(f, '4F_Email - STK') or '?',
                                            val(f, '4F_Chủ tài khoản') or '?')
        huong = 'Công ty chi cho NV'

    out = {
        'dxc_id': val(f, 'DXC-ID'), 'lc_id': val(f, 'LC-ID'),
        'loai_don': loai_don, 'loai_hoan_ung': loai_hu, 'huong': huong,
        'status': val(f, 'Status 1'), 'status_lc': val(f, '4L_Status của cả LC'),
        'so_tien_don': val(f, '4F_Số tiền còn lại'),   # giá trị quyết toán của đơn
        'so_tien': chenh, 'tien_te': cur, 'tk_nhan': bank,  # chênh lệch = còn phải chuyển = số tiền trên QR
        'ndck': val(f, '1F_NDCK'), 'lc_tam_ung': val(f, 'LC-ID-TƯ'),
        'da_tam_ung': val(f, '4L_Số tiền đã tạm ứng'),
        'da_su_dung': val(f, 'Số tiền đã sử dụng'),
        'nguoi': val(f, '1L_Người đề xuất ID') or (val(f, 'Requester') or {}),
        'link_record': val(f, '1A_Link ĐXC'), 'instance': val(f, 'Instance'),
        'qr': qr,
    }
    if not qr:
        out['qr_empty_reason'] = diagnose(f)
    return out


def print_human(o):
    print('%s · %s%s · %s' % (o['dxc_id'], o['loai_don'],
                              (' — ' + o['loai_hoan_ung']) if o['loai_hoan_ung'] else '',
                              o['status_lc'] or o['status']))
    who = o['nguoi'] if isinstance(o['nguoi'], str) else (o['nguoi'] or {}).get('name', '-')
    line = 'Người: %s' % who
    if o['lc_tam_ung']:
        line += ' · TƯ gốc: %s' % o['lc_tam_ung']
    print(line)
    if o['da_tam_ung'] is not None:
        print('Tạm ứng %s → đã dùng %s → %s %s' % (
            money(o['da_tam_ung'], o['tien_te']), money(o['da_su_dung'], o['tien_te']),
            'NV trả lại' if o['loai_hoan_ung'] == 'NV hoàn trả' else 'công ty chi thêm',
            money(o['so_tien_don'], o['tien_te'])))
    print('Còn phải chuyển: %s%s' % (money(o['so_tien'], o['tien_te']),
                                     ' (đã tất toán)' if not o['so_tien'] else ''))
    print('Hướng tiền: %s' % o['huong'])
    print('TK nhận: %s' % o['tk_nhan'])
    print('NDCK: %s' % (o['ndck'] or '-'))
    if o['qr']:
        print('QR: %s' % o['qr'])
    else:
        print('QR: (rỗng) — %s' % o.get('qr_empty_reason', ''))
    if o['link_record']:
        print('Record: %s' % o['link_record'])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if not args:
        raise SystemExit('Usage: get_qr.py <LC-ID> [--json] [--open]')
    raw = args[0].strip().upper()
    m = re.search(r'(\d+)', raw)
    if not m:
        raise SystemExit('LC-ID không hợp lệ: ' + raw)
    lc_id = 'LC' + m.group(1)

    items = lark_search(lc_id)
    if not items:
        raise SystemExit('Không tìm thấy %s trong bảng 57.' % lc_id)
    # nhiều K → ưu tiên record có QR, sau đó K nhỏ nhất
    items.sort(key=lambda it: str(val(it['fields'], 'DXC-ID') or ''))
    pick = next((it for it in items if val(it['fields'], '4F_Link QR')), items[0])
    o = report(pick['fields'])
    o['so_ban_ghi_K'] = len(items)

    if '--json' in flags:
        print(json.dumps(o, ensure_ascii=False, indent=2))
    else:
        print_human(o)
        if len(items) > 1:
            print('(LC có %d lô chi K — QR lấy từ %s)' % (len(items), o['dxc_id']))
    if '--open' in flags and o['qr']:
        subprocess.run(['open', o['qr']])


if __name__ == '__main__':
    main()
