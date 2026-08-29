#!/usr/bin/env python3
"""Push DXC từ bảng 57 sang Approval form [KAI] Đề xuất chi.

Tự động:
- Đọc Phòng ban từ LC field 1L_Phòng ban 1 (auto), map sang dept open_id tenant 2
- Đọc Requester từ LC, lookup tenant 2 user_id; fallback Long admin
- Dùng Họ và tên đầy đủ từ bảng 20 cho NDCK
"""
import json, subprocess, sys, os, re, time
from datetime import datetime, timezone, timedelta

LARK = '/opt/homebrew/bin/lark-cli'
APPROVAL_CODE = 'DAD13F4B-3D66-4597-8263-1031A80D7FEF'
BASE_TOKEN = 'RcX6wwhnZiJsQrkx7TPl9OlCglc'
TBL_57 = 'tblp36MD9kmWmZRO'
TBL_20 = 'tbl0edSaPODwl2Ne'
HRM_BASE = 'DLewbVqU7aZM65sAW6mlcOpngse'  # base HRM (chứa bảng 53 TTCP)
TBL_53 = 'tblHI0qVlA1Yqu7F'              # 53. TTCP — tên TT → 1M_Dept ID (tenant 2)
LONG_USER = 'e63f4f5d'
LONG_OPEN_ID = 'ou_de021e8dd5bc3150ce34ee36df09a498'

# Profiles
PROFILE_BASE = 'cli_a80df38cc639d02f'   # tenant 1 iSuccess (Base 210.6 / 57 / 20)
PROFILE_APPROVAL = 'cli_a968bc93f5381e17'             # tenant 2 KAI (form Đề Xuất Chi)

W = {
    'LC':'widget17722753358230001','REQ':'widget17600081356300001','DEPT':'widget17604405159210001',
    'LOAI_DON':'widget17600073486700001','C1':'widget17600074266640001','C2':'widget17608436088880001',
    'C25':'widget17660528398620001','C3':'widget17660529077140001','MOTA':'widget17616249848160001',
    'NDCK_BO':'widget17689822824110001','KHOAN':'widget17600076876340001','LINK_CT':'widget17600079038590001',
    'HAN_TT':'widget17600080405520001','LINK_DXC':'widget17625971107210001','LINK_TU':'widget17817751558660001','TT_QUA':'widget17701805557680001','REQ_NAME':'widget17805866523170001',
    'MOTA_ITEM':'widget17616245704220001','AMT':'widget17600077199570001','LOAI_TK':'widget17600078545610001','BANK_EN':'widget17600078246080001',
    'EMAIL_STK':'widget17600078077980001','CHU_TK':'widget17600079111360001',
}

# Loại đơn radio keys
LOAI_DON_KEYS = {
    'Thanh toán': 'mgjawlng-cd32gwq00zb-28',
    'Tạm ứng':    'mgjawlng-jtucvwzeq1r-29',
    'Hoàn ứng':   'mgjawlng-bmkmd04dw-30',
}
KEY_HOAN_UNG = 'mgjawlng-bmkmd04dw-30'  # kept for compat
KEY_C25_NORMAL = 'mjba9ghk-w4zgokjcl6e-0'
KEY_TK_VN_BANK = 'mgjb8fz7-7nq0z2e5iv8-0'

C2_KEYS = {
    'Giá vốn hàng hóa thương mại':'mioetvzf-wyfjmnr8sgs-26',
    'Chi phí nguyên vật liệu, bao bì':'mioetvzf-cqujwqmf0ii-21',
    'Chi phí dịch vụ mua ngoài':'mioetvzf-kwtoqbtq0yc-13',
    'Chi phí bằng tiền khác':'mioetvzf-a5u53946csg-14',
    'Chi phí đồ dùng văn phòng':'mioetvzf-x9pfilv6si9-22',
    'Chi phí khác':'mioetvzf-fb8v04kwcic-3',
    'Chi phí nhân viên':'mioetvzf-hj41g2zdg36-15',
    'Chi phí nhân viên quản lý':'mioetvzf-cmbmig33m8-24',
    'Mua hàng hóa':'mioetvzf-wly0y253v67-6',
    'Phải trả cho người bán':'mioetvzf-24h59xpz45b-4',
    'Phải trả công nhân viên':'mioetvzf-encnrqktohs-7',
    'Phải trả, phải nộp khác':'mioetvzf-d4y6gyl17g-23',
    'Phải thu nội bộ khác':'mioetvzf-2fvbggrmz9g-17',
    'Phải thu khác':'mioetvzf-ytt94jrlr3r-20',
    'Quỹ khen thưởng':'mioetvzf-2cwycijh2s7-11',
    'Quỹ phúc lợi':'mioetvzf-tcf9wyddkd-12',
    'Thuế, phí và lệ phí':'mioetvzf-gfcmfso6etb-5',
}

# Phòng ban → tenant 2 open_id (mapped from observed instances)
DEPT_MAP = {
    'AI engineer':        'od-e65417caa016023c3ffccd0ce074f4d0',  # BU Dich vu - QL Khoa NHT.DES (dept_id 5d1efad186997758)
    'Purchasing.AMZ Eco': 'od-3be65c7752943973b956f22aa1fe2294',
    'Support.ZenE':       'od-9c433b6119f103bf6a1f271c4c50c0d6',
    'Support Account.ZenE':'od-9c433b6119f103bf6a1f271c4c50c0d6',
    'AMZ.AMZ Eco':        'od-fc35b649a100cd218e40cd6d684336e6',
    'HR':                 'od-9af9fe1764c4f209ed65e4266ca81f4c',
    'Kế toán':            'od-427a8a61e07ffe2fbc2a40de4c7595e5',  # Phòng Kế toán (QL theo bảng 53 = Cong LT.CEO); tránh rớt về BU của requester
    'HUB':                'od-6f16989ea2443cd3b3596f7b5a6d3a1a',
    'Amazon Eco':         'od-0d878683a0ceefa0588d94af27dfd991',
    'AMZ Eco':            'od-0d878683a0ceefa0588d94af27dfd991',  # BU alias
    'Support.AMZ Eco':    'od-0d878683a0ceefa0588d94af27dfd991',  # sub-dept → BU
    'Designer AMZ Eco':   'od-0d878683a0ceefa0588d94af27dfd991',  # sub-team → BU AMZ Eco
    'R&D.AMZ Eco':        'od-7ec89adc0ddf39d568995ed725c6382b',
    'Etsy':               'od-8aafc66758639c2d2231f74f185e5b43',  # Etsy (BU ZenE Etsy team)
    # ZenE = parent dept of Support.ZenE — fallback to Support.ZenE until verified
    'ZenE':               'od-9c433b6119f103bf6a1f271c4c50c0d6',
}

# CFM open_id (bảng 57/20, app RcX6) → KAI user_id. User org iSuccess 2 → đẩy đơn dưới danh nghĩa
# CHÍNH HỌ (initiator thật) → approval route đúng theo luồng thiết kế, hết self-approval. Empty/thiếu → Long.
USER_T2_MAP = {
    'ou_575625322339997c3b4b73a4cae2b165': '99bccg3a',  # An NTT.HR
    'ou_29636517a37438417113026de06708a6': '8c61f62b',  # Vy THH.SP
    'ou_638a6a895a5997edd4dc5a98db3c6884': '2b4841ef',  # Thư VTA.AMZ
    'ou_a9fa408d8b57fbddf2235b07b7edc096': '420',       # Huỳnh Hà Ny (Ny HH.HR)
    'ou_aafcd277d2414150efefa55f69ecbafa': 'c69ag24f',  # Trần Bảo Hưng (Hưng TB.HR)
    'ou_e953935b23d904fcd81e0ae09f73404b': '5865cd2e',  # Nguyễn Hồ Trọng Khoa (Khoa NHT.DES)
    'ou_21f778c46d2d598555d749eaf13be443': '995d7gfb',  # Lê Quang Đức (Đức LQ.DEV)
    'ou_474e992bc93d9d1c318d6f89daa336b3': 'c18eb2de',  # Lê Thành Công (Cong LT.CEO)
    'ou_b4de375478bb58a0c222f54cf4601424': 'gd3ceg76',  # Nguyễn Thị Mai Anh (Anh NTM.ETS)
    'ou_8a9c3e208c1dbcfbc75557ed66adb93f': '4a39be97',  # Lê Thị Cẩm Tiên (Tiên LTC.Etsy)
    'ou_04c52da8beb27c103f9d666752f32cc9': '9c6348eg',  # Nguyễn Đoàn Bảo Ngọc (Ngọc NDB.SP)
    'ou_3b7c2108d086b60985ff1b8f5fae5b48': '1463c181',  # Huỳnh Thị Thủy Tiên (Tiên HTT.MBA)
    'ou_211392e2d3ff856e075a5987c7a8cf84': 'c4c4fcec',  # Thùy NTT.AMZ (open_id HRM — chưa chắc CFM, sai thì fallback Long)
    'ou_7880c61107134d9af0bf66e3697bf189': '',          # Nhanh TTK.Purchasing (không trên KAI)
}

# Loi TAM THOI cua lark-cli/Lark API: rate limit 429, TLS/network timeout, response rong.
# Chi retry nhung pattern nay — chung deu la "request CHUA duoc server xu ly" nen retry an toan,
# khong sinh instance trung. Loi nghiep vu (RolePermNotAllow, not found...) KHONG retry.
_TRANSIENT_PATTERNS = (
    'http 429', 'rate limit', 'too many request',
    'tls handshake timeout', 'i/o timeout', 'client.timeout',
    'connection reset', 'connection refused', 'eof',
    'no such host', 'temporary failure',
)
LARK_RETRIES = 5

def _is_transient(msg):
    m = (msg or '').lower()
    return any(p in m for p in _TRANSIENT_PATTERNS)

def lark(*args, profile=None):
    cmd = [LARK]
    if profile: cmd += ['--profile', profile]
    cmd += list(args)
    env = {**os.environ, 'PATH':'/opt/homebrew/bin:' + os.environ.get('PATH','')}
    last_err = None
    for attempt in range(LARK_RETRIES):
        out = subprocess.run(cmd, capture_output=True, text=True, env=env)
        raw = out.stderr or out.stdout
        if out.returncode == 0 and out.stdout.strip():
            break
        last_err = raw
        # stdout rong (exit!=0) hoac loi tam thoi → doi roi thu lai
        if attempt < LARK_RETRIES - 1 and (_is_transient(raw) or not out.stdout.strip()):
            print(json.dumps({'lark_retry': (raw or '')[:160], 'attempt': attempt + 1,
                              'api': args[2] if len(args) > 2 else ''}), file=sys.stderr)
            time.sleep(2 + attempt * 3)   # 2s, 5s, 8s, 11s
            continue
        break
    if out.returncode != 0: raise RuntimeError(f"lark-cli failed: {last_err}")
    r = json.loads(out.stdout)
    # lark-cli moi tra format {ok,identity,data,error} thay vi {code,msg,data} → chuan hoa ve legacy
    if isinstance(r, dict) and 'ok' in r and 'code' not in r:
        if r.get('ok'):
            return {'code': 0, 'msg': 'success', 'data': r.get('data') or {}}
        err = r.get('error') or {}
        msg = (err.get('message') if isinstance(err, dict) else str(err)) or 'error'
        return {'code': 1, 'msg': msg, 'error': err, 'data': {}}
    return r

# Resolve động phòng ban/BU → open_department_id (tenant2), khi không có trong DEPT_MAP tĩnh.
# Tên TT (Phòng ban/BU) → bảng 53 (4F_TTCP-ID Name = 'Phòng '/'BU '+tên) → 1M_Dept ID → tenant2 dept.
_DEPT_CACHE = {}
def resolve_dept_dynamic(name):
    if not name: return None
    if name in _DEPT_CACHE: return _DEPT_CACHE[name]
    open_id = None
    try:
        sr = lark('api', 'POST', f'/open-apis/bitable/v1/apps/{HRM_BASE}/tables/{TBL_53}/records/search',
                  '--params', json.dumps({'page_size': 3}),
                  '--data', json.dumps({'filter': {'conjunction': 'or', 'conditions': [
                      {'field_name': '4F_TTCP-ID Name', 'operator': 'is', 'value': ['Phòng ' + name]},
                      {'field_name': '4F_TTCP-ID Name', 'operator': 'is', 'value': ['BU ' + name]},
                      {'field_name': '4F_TTCP-ID Name', 'operator': 'is', 'value': [name]},
                  ]}, 'field_names': ['1M_Dept ID']}, ensure_ascii=False),
                  '--as', 'bot', profile=PROFILE_BASE)
        items = (sr.get('data') or {}).get('items') or []
        did = None
        if items:
            d = items[0]['fields'].get('1M_Dept ID')
            if isinstance(d, list) and d: did = d[0].get('text') if isinstance(d[0], dict) else d[0]
            elif isinstance(d, dict): did = d.get('text') or d.get('value')
            else: did = d
        if did:
            dr = lark('api', 'GET', f'/open-apis/contact/v3/departments/{did}',
                      '--params', json.dumps({'department_id_type': 'department_id'}), '--as', 'bot', profile=PROFILE_APPROVAL)
            open_id = ((dr.get('data') or {}).get('department') or {}).get('open_department_id')
    except Exception as e:
        print(json.dumps({'resolve_dept_err': str(e)[:150], 'dept': name}), file=sys.stderr)
    _DEPT_CACHE[name] = open_id
    return open_id

def fetch_lc(dxc_id):
    res = lark('api','POST', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/search',
        '--as','bot','--params','{"page_size":1}',
        '--data', json.dumps({'filter':{'conjunction':'and','conditions':[
            {'field_name':'DXC-ID','operator':'contains','value':[dxc_id]}]}}, ensure_ascii=False),
        profile=PROFILE_BASE)
    items = res.get('data',{}).get('items') or []
    if not items: raise ValueError(f"LC {dxc_id} not found")
    return items[0].get('record_id'), items[0]['fields']

def fetch_instance_serial(instance_code):
    """Query Approval API for instance serial_number (format YYYYMMDD####)."""
    try:
        res = lark('--profile','cli_a968bc93f5381e17','api','GET',
                   f'/open-apis/approval/v4/instances/{instance_code}','--as','bot')
        return res.get('data',{}).get('serial_number','') or ''
    except Exception: return ''

def serial_from_dxc(dxc_id):
    """LC2668K1 → '2668' (numeric part between LC and K)."""
    m = re.match(r'LC(\d+)K\d+$', dxc_id or '')
    return m.group(1) if m else ''

PUBLIC_DIR = '/Users/duong/dxc-push/public'
PUBLIC_URL_BASE = 'https://dxcpush.kntmcptools.online/img'

# --- Upload chứng từ NATIVE vào control attachmentV2 của đơn approval [KAI] ---
APP_ID_T2 = 'cli_a968bc93f5381e17'                  # app tenant2 KAI (mint token cho upload approval)
ATT_WIDGET = 'widget17600079430120001'              # control attachmentV2 'File/Tài liệu chứng từ'
APPROVAL_UPLOAD_URL = 'https://www.larksuite.com/approval/openapi/v2/file/upload'
T2_TOKEN_URL = 'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal'
SECRET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.tenant2_secret')

def _tenant2_secret():
    s = os.environ.get('TENANT2_APP_SECRET')
    if s: return s.strip()
    try:
        return open(SECRET_FILE).read().strip()
    except Exception:
        return ''

_T2_TOKEN_CACHE = {}
def _tenant2_token():
    import urllib.request, time
    now = time.time()
    if _T2_TOKEN_CACHE.get('exp', 0) > now + 60:
        return _T2_TOKEN_CACHE['tok']
    body = json.dumps({'app_id': APP_ID_T2, 'app_secret': _tenant2_secret()}).encode()
    req = urllib.request.Request(T2_TOKEN_URL, data=body, headers={'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=15))
    tok = r.get('tenant_access_token')
    if not tok:
        raise RuntimeError('tenant2 token mint failed: ' + json.dumps(r)[:200])
    _T2_TOKEN_CACHE['tok'] = tok
    _T2_TOKEN_CACHE['exp'] = now + int(r.get('expire', 7200))
    return tok

def _upload_to_approval(token, path, name):
    """Upload 1 file lên Lark Approval (host openapi/v2) → trả file code để gắn vào attachmentV2."""
    import urllib.request, mimetypes
    content = open(path, 'rb').read()
    b = '----dxcpushboundary7f3a2b9c1d'
    parts = []
    def fld(k, v):
        parts.append(('--' + b).encode())
        parts.append(('Content-Disposition: form-data; name="' + k + '"').encode())
        parts.append(b'')
        parts.append(v.encode())
    fld('name', name)
    fld('type', 'attachment')
    parts.append(('--' + b).encode())
    parts.append(('Content-Disposition: form-data; name="content"; filename="' + name + '"').encode())
    ctype = mimetypes.guess_type(name)[0] or 'application/octet-stream'
    parts.append(('Content-Type: ' + ctype).encode())
    parts.append(b'')
    body = b'\r\n'.join(parts) + b'\r\n' + content + ('\r\n--' + b + '--\r\n').encode()
    req = urllib.request.Request(APPROVAL_UPLOAD_URL, data=body, headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + b,
    })
    r = json.load(urllib.request.urlopen(req, timeout=30))
    if r.get('code') != 0:
        raise RuntimeError('approval upload failed: ' + json.dumps(r)[:200])
    return (r.get('data') or {}).get('code', '')

def serve_attachments(siblings, lc_short):
    """Đọc field File/Tài liệu chứng từ (Attachment) từ tất cả sibling K records,
    download qua lark-cli (bearer auth) rồi UPLOAD lên Lark Approval → trả list file code
    để gắn vào widget attachmentV2 'File/Tài liệu chứng từ' của đơn."""
    import os
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    codes = []
    token = None
    # Chi day hinh tu lo chi DAU TIEN (siblings[0]); khong day trung hinh o cac lo K khac.
    for sib_idx, (_, _, sf) in enumerate(siblings[:1]):
        atts = sf.get('File/Tài liệu chứng từ') or []
        if not isinstance(atts, list): continue
        for f_idx, att in enumerate(atts):
            if not isinstance(att, dict): continue
            file_token = att.get('file_token','')
            name = att.get('name','file')
            if not file_token: continue
            ext = os.path.splitext(name)[1] or '.bin'
            safe = f'{lc_short}_K{sib_idx+1}_{f_idx+1}{ext}'
            dest = os.path.join(PUBLIC_DIR, safe)
            import time as _t_att
            for _att_try in range(3):  # retry chong 429/transient -> khong drop anh
                try:
                    # Get pre-signed tmp_download_url với bitablePerm extra (auth context)
                    extra = json.dumps({'bitablePerm':{'tableId':TBL_57}})
                    br = lark('api','GET','/open-apis/drive/v1/medias/batch_get_tmp_download_url',
                              '--params', json.dumps({'file_tokens':[file_token],'extra':extra}),
                              '--as','bot', profile=PROFILE_BASE)
                    tmp_dl = (br.get('data',{}).get('tmp_download_urls') or [{}])[0].get('tmp_download_url','')
                    if not tmp_dl: raise RuntimeError('no tmp_download_url')
                    import urllib.request
                    urllib.request.urlretrieve(tmp_dl, dest)
                    if os.path.getsize(dest) <= 0:
                        raise RuntimeError('empty file')
                    if token is None:
                        token = _tenant2_token()
                    code = _upload_to_approval(token, dest, name)
                    if code:
                        codes.append(code)
                    break  # upload OK
                except Exception as e:
                    if _att_try < 2:
                        print(json.dumps({'attach_retry': str(e)[:120], 'file': name, 'attempt': _att_try+1}), file=sys.stderr)
                        _t_att.sleep(2 + _att_try*3)  # backoff cho 429
                        continue
                    print(json.dumps({'attach_err': str(e)[:200], 'file': name}), file=sys.stderr)
    return codes

def cancel_instance(instance_code, user_id=None):
    """Cancel 1 approval instance. Return True nếu cancel OK hoặc đã không active.

    Lark chi cho INITIATOR huy don cua minh — cancel bang user khac se tra 60009
    (no operation permission). Vi vay thu initiator that truoc, roi moi fallback Long.
    """
    if not instance_code: return True
    candidates = [u for u in (user_id, LONG_USER) if u]
    # Fallback cuoi: hoi Approval xem initiator that la ai (fix 60009 khi don do nguoi khac tao)
    try:
        _d = lark('--profile','cli_a968bc93f5381e17','api','GET',
                  f'/open-apis/approval/v4/instances/{instance_code}',
                  '--as','bot','--params','{"user_id_type":"user_id"}').get('data') or {}
        _init = _d.get('user_id') or _d.get('open_id')
        if _init and _init not in candidates: candidates.append(_init)
    except Exception:
        pass
    seen, tried = set(), []
    for uid in candidates:
        if uid in seen: continue
        seen.add(uid); tried.append(uid)
        try:
            res = lark('--profile','cli_a968bc93f5381e17','api','POST','/open-apis/approval/v4/instances/cancel',
                       '--as','bot','--params','{"user_id_type":"user_id"}',
                       '--data', json.dumps({
                           'approval_code': APPROVAL_CODE,
                           'instance_code': instance_code,
                           'user_id': uid,
                       }, ensure_ascii=False))
            if res.get('code') == 0:
                print(json.dumps({'cancelled': instance_code, 'by': uid}), file=sys.stderr)
                return True
            msg = str(res.get('msg','')).lower()
            if 'not active' in msg or 'invalid status' in msg or 'finished' in msg:
                return True
            print(json.dumps({'cancel_warn': res.get('msg'), 'instance': instance_code, 'by': uid}), file=sys.stderr)
        except Exception as e:
            print(json.dumps({'cancel_err': str(e)[:200], 'instance': instance_code, 'by': uid}), file=sys.stderr)
    print(json.dumps({'cancel_failed': instance_code, 'tried': tried}), file=sys.stderr)
    return False

def fetch_lc_siblings(dxc_id):
    """Lấy tất cả K records của cùng Lô Chi. Vd LC2699K1 → [LC2699K1, LC2699K2, ...].
    Trả về list of (record_id, dxc_id_full, fields), sắp xếp theo K number."""
    m = re.match(r'(LC\d+)K\d+$', dxc_id or '')
    if not m: return []
    lc_base = m.group(1)
    res = lark('api','POST', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/search',
        '--as','bot','--params','{"page_size":50}',
        '--data', json.dumps({'filter':{'conjunction':'and','conditions':[
            {'field_name':'DXC-ID','operator':'contains','value':[lc_base + 'K']}]}}, ensure_ascii=False),
        profile=PROFILE_BASE)
    out = []
    for it in res.get('data',{}).get('items') or []:
        rid = it.get('record_id')
        f = it.get('fields', {})
        dxc_v = first(f.get('DXC-ID'))
        if not dxc_v: continue
        m2 = re.match(r'^' + lc_base + r'K(\d+)$', dxc_v)
        if m2: out.append((int(m2.group(1)), rid, dxc_v, f))
    out.sort()
    return [(rid, dxc, f) for k, rid, dxc, f in out]

def build_khoan_item(record_f, loai_don, requester_bank):
    """Build 1 fieldList row cho 1 K record."""
    so_tien = first(record_f.get('4F_Số tiền'))
    cur = first(record_f.get('4F_Tiền tệ'))
    cur_code = cur if cur in ('VND','USD') else 'VND'
    if loai_don == 'Hoàn ứng' and requester_bank:
        bank_name_widget = requester_bank['bank_name']
        stk_widget = requester_bank['stk']
        owner_widget = requester_bank['owner']
    else:
        bank_name_widget = first(record_f.get('4F_English Bank Name')) or first(record_f.get('Bank-English Name 2')) or 'Vietcombank'
        stk_widget = first(record_f.get('4F_Email - STK')) or first(record_f.get('Email - STK 2 (Manual)')) or ''
        owner_widget = first(record_f.get('4F_Chủ tài khoản')) or first(record_f.get('Chủ tài khoản 2 (manual)')) or ''
    # Mô tả riêng từng K item: ưu tiên 1F_NDCK của K, fallback NDCK của TƯ, cuối cùng owner
    item_mota = first(record_f.get('Mô tả')) or first(record_f.get('1F_NDCK')) or owner_widget or ''
    return [
        {'id':W['MOTA_ITEM'],'type':'textarea','value':item_mota},
        {'id':W['AMT'],'type':'amount','value':so_tien,'currency':cur_code},
        {'id':W['LOAI_TK'],'type':'radioV2','value':KEY_TK_VN_BANK},
        {'id':W['BANK_EN'],'type':'input','value':bank_name_widget},
        {'id':W['EMAIL_STK'],'type':'input','value':stk_widget},
        {'id':W['CHU_TK'],'type':'input','value':owner_widget},
    ]

def writeback_instance(record_ids, instance_code, dxc_id):
    """Ghi 4 field initial vào N records (all K của 1 LC) sau khi tạo instance thành công.

    Tra ve True neu ghi duoc field Instance vao ÍT NHẤT record base (rid dau tien).
    Ghi hong record base = Base khong biet instance nay → lan push sau khong cancel duoc
    → sinh instance TRUNG. Vi vay caller phai xu ly khi tra ve False.
    """
    if isinstance(record_ids, str): record_ids = [record_ids]
    if not record_ids: return False
    fields = {
        'Instance': instance_code,
        'Status 1': 'Pending',
        'Request No.': fetch_instance_serial(instance_code),
        'Serial no.': serial_from_dxc(dxc_id),
    }
    base_ok = False
    for idx, rid in enumerate(record_ids):
        for attempt in range(3):   # lark() da retry loi tam thoi; them 1 lop cho chac
            try:
                lark('api','PUT', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/{rid}',
                     '--as','bot','--data', json.dumps({'fields': fields}, ensure_ascii=False),
                     profile=PROFILE_BASE)
                if idx == 0: base_ok = True
                break
            except Exception as e:
                print(json.dumps({'writeback_err': str(e)[:200], 'record_id': rid,
                                  'instance': instance_code, 'attempt': attempt + 1}), file=sys.stderr)
                if attempt < 2: time.sleep(3 + attempt * 4)
    return base_ok

def fetch_user_bank(user_open_id):
    res = lark('api','POST', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_20}/records/search',
        '--as','bot','--params','{"page_size":1}',
        '--data', json.dumps({'filter':{'conjunction':'and','conditions':[
            {'field_name':'User Lark','operator':'contains','value':[user_open_id]}]}}, ensure_ascii=False),
        profile=PROFILE_BASE)
    items = res.get('data',{}).get('items') or []
    if not items: raise ValueError(f"User {user_open_id} not found in bảng 20")
    f = items[0]['fields']
    tk_id_name = (f.get('4L_TK-ID Name') or [{}])[0].get('text','')
    bank_name = 'Vietcombank'
    for b in ['Vietcombank','MBBank','Techcombank','BIDV','ACB','VPBank','TPBank','VietinBank','Sacombank']:
        if b in tk_id_name: bank_name = b; break
    return {
        'full_name': (f.get('4F_Họ và tên') or [{}])[0].get('text',''),
        'owner':     (f.get('4L_Chủ tài khoản') or [{}])[0].get('text',''),
        'stk':       (f.get('4L_Số tài khoản') or [{}])[0].get('text',''),
        'bank_name': bank_name,
    }

def fetch_user_dept(user_open_id):
    """Lookup 1F_Phòng ban from bảng 20 NS by requester open_id."""
    if not user_open_id: return None
    try:
        res = lark('api','POST', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_20}/records/search',
            '--as','bot','--params','{"page_size":1}',
            '--data', json.dumps({'filter':{'conjunction':'and','conditions':[
                {'field_name':'User Lark','operator':'contains','value':[user_open_id]}]}}, ensure_ascii=False),
            profile=PROFILE_BASE)
        items = res.get('data',{}).get('items') or []
        if items:
            return (items[0]['fields'].get('1F_Phòng ban') or [{}])[0].get('text','') or None
    except Exception: pass
    return None


def fetch_ns_dept(ns_field_value):
    """Lookup 1F_Phòng ban từ bảng 20 NS qua linked record trong 1M_Nhân sự.
    Dùng cho đề xuất chi giải/thưởng cho người khác nhận — dept theo người nhận."""
    if not ns_field_value: return None
    try:
        # 1M_Nhân sự là user field → lấy open_id của người đó
        ns_list = ns_field_value if isinstance(ns_field_value, list) else []
        for ns in ns_list:
            oid = ns.get('id') or ns.get('open_id','')
            if oid:
                dept = fetch_user_dept(oid)
                if dept: return dept
    except Exception: pass
    return None

def first(v):
    if isinstance(v, list) and v:
        if isinstance(v[0], dict): return v[0].get('text', v[0])
        return v[0]
    if isinstance(v, dict):
        val = v.get('value')
        if isinstance(val, list) and val:
            if isinstance(val[0], dict): return val[0].get('text', str(val[0]))
            return val[0]
    return v

TBL_54 = 'tblqqqEBYRcsIjTl'  # Bảng 54 Định Mức Chi Phí

TBL_54 = 'tblqqqEBYRcsIjTl'  # Bảng 54 Định Mức Chi Phí

def check_dmc(c3):
    """Check if TK C3 has an expense budget in bảng 54."""
    if not c3:
        return '❓ Chưa có ĐMC\n> Không có TK C3, cần xem xét.'
    try:
        res = lark('api','POST', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_54}/records/search',
            '--as','bot','--params','{"page_size":3}',
            '--data', json.dumps({'field_names':['4L_Tên TK C3','Định mức CHI','Tiền tệ','4F_Còn/ Hết'],
                'filter':{'conjunction':'and','conditions':[
                {'field_name':'4L_Tên TK C3','operator':'contains','value':[c3]}
            ]}}, ensure_ascii=False),
            profile=PROFILE_BASE)
        items = res.get('data',{}).get('items') or []
        if not items:
            return f'❓ Chưa có ĐMC\n> Không tìm thấy định mức cho TKC3 này trong kỳ này. Cần xem xét.'
        f0 = items[0]['fields']
        dmc_amt = f0.get('Định mức CHI')
        con_het = (f0.get('4F_Còn/ Hết') or {}).get('value', [None])[0] if isinstance(f0.get('4F_Còn/ Hết'), dict) else f0.get('4F_Còn/ Hết')
        if dmc_amt:
            status = '✅ Còn ĐMC' if con_het != 'Hết' else '⚠️ Hết ĐMC'
            return f'{status}\n> Định mức: {int(dmc_amt):,} VND | {con_het or ""}'
        return f'✅ Có ĐMC\n> Tìm thấy định mức cho "{c3}".'
    except Exception as e:
        return f'❓ Chưa có ĐMC\n> Không tìm thấy định mức cho TKC3 này trong kỳ này. Cần xem xét.'

NOTI_WEBHOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/cd0c70bd-1e37-4c42-9185-639d4948cdcf'
VI_WEBHOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/ad0f7c2e-3e37-4ebb-bca7-e2e9f03c3a45'  # bot noti Vĩ — nhận push card ĐXC mới + kết quả duyệt

def notify_push_card(result, source='Push'):
    """Gửi noti card cho 1 push result thành công vào bot cd0c70bd."""
    if result.get('status') != 'ok': return
    import urllib.request
    dxc = result.get('dxc_id','-')
    mota = result.get('mota','-')
    dept = result.get('dept','-')
    amt = result.get('amt')
    cur = result.get('cur','VND')
    han = result.get('han','-')
    requester = result.get('requester','-')
    c3 = result.get('c3','-')
    dmc = result.get('dmc','')
    amt_str = f"{int(amt):,} {cur}" if amt is not None else '-'
    body = '\n'.join([
        f"**Người đề xuất:** {requester}",
        f"**Phòng ban:** {dept}",
        f"**Loại đơn:** {result.get('loai_don','-')}",
        f"**TK C3:** {c3}",
        f"**Số tiền:** {amt_str}",
        f"**Hạn TT:** {han}",
        f"**Nội dung:** {mota}",
    ])
    elements = [
        {'tag':'column_set','flex_mode':'none','background_style':'grey',
         'columns':[{'tag':'column','width':'weighted','weight':1,'vertical_align':'center',
                     'elements':[{'tag':'markdown','content':f"**🆕 ĐXC mới cần duyệt — {dxc}**"}]}]},
        {'tag':'div','text':{'tag':'lark_md','content': body}},
    ]
    if dmc:
        elements.append({'tag':'div','text':{'tag':'lark_md','content':f"🎁 **Phân tích:** {dmc}"}})
    elements.append({'tag':'note','elements':[
        {'tag':'lark_md','content':f"🤖 {source} {datetime.now().strftime('%H:%M %d/%m/%Y')} • Bảng 57 CFM"}]})
    card = {'msg_type':'interactive','card':{
        'config':{'wide_screen_mode':True},
        'header':{'title':{'tag':'plain_text','content':f"🔔 {source} — 1 đơn mới cần duyệt"},'template':'green'},
        'elements':elements,
    }}
    def _send(webhook):
        try:
            req = urllib.request.Request(webhook,
                data=json.dumps(card, ensure_ascii=False).encode('utf-8'),
                headers={'Content-Type':'application/json; charset=utf-8'}, method='POST')
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            print(json.dumps({'noti_err': str(e)[:200]}), file=sys.stderr)

    _send(NOTI_WEBHOOK)
    if 'Vĩ' in requester:
        _send(VI_WEBHOOK)

def ensure_nhan_su(siblings, req_open_id):
    """Hoan ung: set field link 1M_Nhan su = nguoi de xuat tren record bang 57 (neu rong).
    Nho do lookup 1L_STK 1.1 (tu bang 20) tu keo bank -> 4F_Link QR -> bang 56 hien QR."""
    if not req_open_id: return
    for rid, _, sf in siblings:
        if sf.get('1M_Nhân sự'):
            continue
        try:
            lark('api','PUT', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/{rid}',
                 '--as','bot','--params','{"user_id_type":"open_id"}',
                 '--data', json.dumps({'fields':{'1M_Nhân sự':[{'id':req_open_id}]}}, ensure_ascii=False),
                 profile=PROFILE_BASE)
            print(json.dumps({'set_nhan_su': rid, 'open_id': req_open_id}), file=sys.stderr)
        except Exception as e:
            print(json.dumps({'nhan_su_err': str(e)[:200], 'record_id': rid}), file=sys.stderr)


def push_one(dxc_id, dry_run=False):
    siblings = fetch_lc_siblings(dxc_id)
    if not siblings:
        # Fallback to old single-record path (vd DXC-ID không match pattern LCxxxKx)
        rid, fields = fetch_lc(dxc_id)
        siblings = [(rid, dxc_id, fields)]
    # Use smallest K as base; nếu current khác base → skip để tránh push trùng
    base_rid, base_dxc, base_f = siblings[0]
    if dxc_id != base_dxc:
        return {'dxc_id': dxc_id, 'status':'skipped', 'reason':f'push via base K={base_dxc} (multi-K)'}
    # Chong race: 4F_So tien (formula) chua settle ngay sau khi tao record -> doi & doc lai (max 30s)
    if not dry_run and first(base_f.get('4F_Số tiền')) is None:
        import time as _t
        for _w in range(6):
            _t.sleep(5)
            _sib = fetch_lc_siblings(dxc_id)
            if _sib:
                siblings = _sib
                base_rid, base_dxc, base_f = siblings[0]
            if first(base_f.get('4F_Số tiền')) is not None:
                print(json.dumps({'dxc_id': dxc_id, 'note': 'waited %ds for fields (race)' % ((_w + 1) * 5)}), file=sys.stderr)
                break
    record_id_57 = base_rid
    f = base_f
    all_record_ids = [rid for rid, _, _ in siblings]

    lc_full = first(f.get('DXC-ID')) or dxc_id
    lc_id_short = lc_full[:-2] if lc_full.endswith('K1') else lc_full
    loai_don = first(f.get('4F_Loại đơn')) or 'Thanh toán'
    so_tien = first(f.get('4F_Số tiền'))
    cur = first(f.get('4F_Tiền tệ'))
    c1 = first(f.get('4F_Tên TK C1'))
    c2 = first(f.get('4F_Tên TK C2'))
    c3 = first(f.get('4F_Tên TK C3'))
    ndck_tu = first(f.get('1L_NDCK của TƯ')) or ''
    ndck_bank = first(f.get('1F_NDCK')) or ''  # NDCK for Thanh toán/Tạm ứng
    han_tt = f.get('Hạn thanh toán')
    link_ct = (f.get('Link chứng từ') or [{}])[0].get('link','') if f.get('Link chứng từ') else ''
    # Đẩy file 'File/Tài liệu chứng từ' (all K) NATIVE lên đơn approval (widget attachmentV2) → list codes
    _att_codes = serve_attachments(siblings, lc_full[:-2] if lc_full.endswith('K1') else lc_full)
    link_dxc = (f.get('1A_Link ĐXC') or [{}])[0].get('link','') if f.get('1A_Link ĐXC') else ''
    # Link Tạm ứng: đơn Hoàn ứng → resolve LC-ID-TƯ (đơn tạm ứng gốc) → link record Base của nó
    link_tu = ''
    if loai_don == 'Hoàn ứng':
        _lc_tu = first(f.get('LC-ID-TƯ')) or ''
        if _lc_tu:
            try:
                _r = lark('api','POST', f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/search',
                          '--as','bot','--params','{"page_size":1}',
                          '--data', json.dumps({'filter':{'conjunction':'and','conditions':[
                              {'field_name':'DXC-ID','operator':'contains','value':[_lc_tu]}]}}, ensure_ascii=False),
                          profile=PROFILE_BASE)
                _it = _r.get('data',{}).get('items') or []
                if _it:
                    _lk = _it[0]['fields'].get('1A_Link ĐXC') or [{}]
                    link_tu = (_lk[0].get('link','') if _lk else '') or ''
            except Exception:
                pass
    requester = (f.get('Requester') or [{}])[0]
    req_open_id = requester.get('id','')
    requester_name = requester.get('name','-')
    # Resolve dept: thử các nguồn theo priority, dùng nguồn ĐẦU TIÊN match DEPT_MAP
    _dept_candidates = [
        first(f.get('Phòng ban 2 (manual)')),  # user chọn tay = override cao nhất (fix LC3118 bị lấy dept người nhận)
        first(f.get('1L_Phòng ban 1 (auto)')),
        fetch_ns_dept(f.get('1M_Nhân sự')),  # dept người nhận (đề xuất chi giải cho người khác)
        first(f.get('4F_Phòng ban')),
        fetch_user_dept(req_open_id),  # fallback CUOI: phong NS requester chi dung khi don khong co Phong ban
    ]
    # Resolve THEO THỨ TỰ ưu tiên candidate: mỗi nguồn thử DEPT_MAP tĩnh → resolve động (bảng 53)
    # → BU-suffix. Dùng nguồn ĐẦU TIÊN ra được open_department_id. Nhờ vậy phòng manual/Base (vd
    # 'Website' chưa có trong DEPT_MAP nhưng resolve động được) được ưu tiên trước phòng requester
    # (candidate cuối) — fix LC3176 bị đẩy nhầm sang ZenE (phòng người tạo).
    def _resolve_any(c):
        if not c: return None
        variants = [c]
        if '.' in c: variants.append(c.rsplit('.', 1)[-1].strip())
        tokens = c.replace('.', ' ').split()
        for n in range(len(tokens) - 1, 0, -1):
            variants.append(' '.join(tokens[-n:]))
        for v in variants:
            od = DEPT_MAP.get(v) or resolve_dept_dynamic(v)
            if od: return (v, od)
        return None

    dept_name, dept_open = None, None
    for c in _dept_candidates:
        r = _resolve_any(c)
        if r:
            dept_name, dept_open = r
            break
    if not dept_name:
        # không nguồn nào resolve được → giữ nguồn đầu non-empty cho error msg
        dept_name = next((c for c in _dept_candidates if c), 'HR')

    if so_tien is None:
        return {'dxc_id': dxc_id, 'status':'skipped', 'reason':'amount empty'}

    # Nếu record đã có Instance từ push trước → cancel old Pending instance rồi push mới (auto-replace)
    if not dry_run:
        old_instance = first(f.get('Instance'))
        if old_instance:
            cancel_instance(old_instance)

    # Resolve dept on tenant 2 — đã resolve ở vòng ưu tiên trên; nếu chưa có thì thử lại (map tĩnh → động).
    if not dept_open:
        dept_open = DEPT_MAP.get(dept_name) or resolve_dept_dynamic(dept_name)
    if not dept_open:
        return {'dxc_id': dxc_id, 'status':'error', 'reason':f'dept open_id unknown: {dept_name}'}

    # Resolve requester on tenant 2; fallback Long
    tenant2_user = USER_T2_MAP.get(req_open_id, '')
    requester_widget_value = tenant2_user if tenant2_user else LONG_USER

    # Loại đơn widget key
    loai_don_key = LOAI_DON_KEYS.get(loai_don, LOAI_DON_KEYS['Thanh toán'])

    # Bank info — source differs by Loại đơn:
    # Hoàn ứng: bank of requester (from bảng 20 NS)
    # Thanh toán / Tạm ứng: bank of recipient (from 4F_ fields in bảng 57)
    _requester_bank = None
    if loai_don == 'Hoàn ứng':
        if not dry_run:
            ensure_nhan_su(siblings, req_open_id)  # set link -> bang 56 tu sinh QR hoan tien
        _requester_bank = fetch_user_bank(req_open_id)
        bank_name_widget = _requester_bank['bank_name']
        # NDCK: ISU <LC_TU> <Họ tên> ck
        parts = ndck_tu.replace('ISU ','',1).split(' ',1) if ndck_tu else ['LC????']
        original_lc = parts[0] if parts else 'LC'
        mota = f"ISU {original_lc} {_requester_bank['full_name']} ck"
    else:
        # Thanh toán / Tạm ứng — bank from LC fields directly (cho TT_QUA widget; per-K bank trong fieldList qua build_khoan_item)
        bank_name_widget = first(f.get('4F_English Bank Name')) or first(f.get('Bank-English Name 2')) or 'Vietcombank'
        # NDCK: use 1F_NDCK if available
        mota = ndck_bank or f"ISU {lc_id_short} {requester_name}"

    c2_key = C2_KEYS.get(c2)
    if not c2_key: return {'dxc_id': dxc_id, 'status':'error', 'reason':f'TK C2 key unknown: {c2}'}

    cur_code = cur if cur in ('VND','USD') else 'VND'
    if han_tt:
        dt = datetime.fromtimestamp(han_tt/1000, tz=timezone(timedelta(hours=7)))
        han_iso = dt.strftime('%Y-%m-%dT00:00:00+07:00')
    else:
        han_iso = datetime.now(tz=timezone(timedelta(hours=7))).strftime('%Y-%m-%dT00:00:00+07:00')

    form = [
        {'id':W['LC'],'type':'input','value':lc_id_short},
        {'id':W['REQ'],'type':'contact','value':[requester_widget_value]},
        {'id':W['DEPT'],'type':'department','value':[{'name':dept_name,'open_id':dept_open}]},
        {'id':W['LOAI_DON'],'type':'radioV2','value':loai_don_key},
        {'id':W['C1'],'type':'input','value':c1},
        {'id':W['C2'],'type':'radioV2','value':c2_key},
        {'id':W['C25'],'type':'radioV2','value':KEY_C25_NORMAL},
        {'id':W['C3'],'type':'input','value':c3},
        {'id':W['MOTA'],'type':'textarea','value':mota},
        {'id':W['NDCK_BO'],'type':'input','value':'Không'},
        {'id':W['KHOAN'],'type':'fieldList','value':[
            build_khoan_item(sf, loai_don, _requester_bank) for _, _, sf in siblings
        ]},
        {'id':W['LINK_CT'],'type':'input','value':link_ct},
        {'id':W['HAN_TT'],'type':'date','value':han_iso},
        {'id':W['LINK_DXC'],'type':'input','value':link_dxc},
        {'id':W['LINK_TU'],'type':'input','value':link_tu},
        {'id':W['TT_QUA'],'type':'input','value': first(f.get('Cần chi qua')) or ''},
        {'id':W['REQ_NAME'],'type':'input','value':requester_name},
    ]
    if _att_codes:
        form.append({'id':ATT_WIDGET,'type':'attachmentV2','value':_att_codes})

    # Initiator = chính người làm đơn nếu là user org-2 (requester_widget_value = KAI id), else Long.
    payload = {'approval_code':APPROVAL_CODE,'user_id':requester_widget_value,'form':json.dumps(form, ensure_ascii=False)}

    if dry_run:
        return {'dxc_id': dxc_id, 'status':'dry_run', 'mota':mota, 'amt':so_tien, 'cur':cur_code, 'dept':dept_name, 'requester_user':requester_widget_value, 'initiator':requester_widget_value, 'loai':loai_don, 'link_tu':link_tu}

    try:
        res = lark('--profile','cli_a968bc93f5381e17','api','POST','/open-apis/approval/v4/instances',
                   '--as','bot','--data', json.dumps(payload, ensure_ascii=False))
    except RuntimeError as e:
        # If user not found, retry as Long (cả initiator lẫn widget)
        if 'not found' in str(e) and requester_widget_value != LONG_USER:
            for item in form:
                if item.get('id') == W['REQ']: item['value'] = [LONG_USER]
            payload['user_id'] = LONG_USER
            payload['form'] = json.dumps(form, ensure_ascii=False)
            res = lark('--profile','cli_a968bc93f5381e17','api','POST','/open-apis/approval/v4/instances',
                       '--as','bot','--data', json.dumps(payload, ensure_ascii=False))
        else:
            raise
    if res.get('code') != 0:
        return {'dxc_id': dxc_id, 'status':'error', 'reason':res.get('error') or res.get('msg')}
    instance_code = res['data']['instance_code']
    # Ghi Instance ve Base. Neu HONG record base → Base khong luu instance nay, lan push sau
    # se khong cancel duoc no → sinh don TRUNG (ca LC3285, 2 instance PENDING cung luc).
    # Nen huy luon instance vua tao roi bao error de push lai sach se.
    if not writeback_instance(all_record_ids, instance_code, base_dxc):
        cancelled = cancel_instance(instance_code, payload.get('user_id'))
        return {'dxc_id': dxc_id, 'status':'error', 'instance_code': instance_code,
                'rolled_back': cancelled,
                'reason': ('writeback Instance that bai — da huy instance vua tao, hay push lai'
                           if cancelled else
                           'writeback Instance that bai VA khong huy duoc instance — CAN HUY TAY: ' + instance_code)}
    han_str =datetime.fromtimestamp(han_tt/1000, tz=timezone(timedelta(hours=7))).strftime('%-d/%-m/%Y') if han_tt else '-'
    # Check ĐMC (Expense Budget) for TK C3
    dmc_note = check_dmc(c3)
    _result = {'dxc_id': dxc_id, 'status':'ok', 'instance_code':instance_code,
            'mota':mota, 'dept':dept_name, 'loai_don':loai_don,
            'amt':so_tien, 'cur':cur_code, 'han':han_str,
            'requester':requester_name, 'c3':c3 or '-', 'dmc':dmc_note}
    notify_push_card(_result, source='Push')
    return _result

# Patch: add missing C2_KEYS
_EXTRA_C2 = {
    'Tiền Việt Nam':                    'mioetvzf-hcvpkb6m9d6-9',
    'Chi phí trả trước':                'mioetvzf-lifpck78asf-10',
    'Chi phí tài chính':                'mioetvzf-x1dc5fzarme-18',
    'Doanh thu hoạt động tài chính':    'mioetvzf-par9ub069ne-1',
    'Doanh thu bán hàng hóa':           'mioetvzf-pb1608o2vgh-25',
    'Doanh thu cung cấp dịch vụ':       'mioetvzf-ozvl01kbu9l-0',
    'Doanh thu khác':                   'mioetvzf-crn4ei4zweu-19',
    'Thu nhập khác':                    'mioetvzf-autxhlmj7h9-8',
    'Hàng bán bị trả lại':              'mioetvzf-hud3ti9u2ts-2',
    'Ngoại tệ':                         'mioetvzf-cssuj7ah4e9-16',
    'Phải thu nội bộ khác':             'mioetvzf-2fvbggrmz9g-17',
    'Phải thu khác':                    'mioetvzf-ytt94jrlr3r-20',
}
C2_KEYS.update(_EXTRA_C2)

if __name__ == '__main__':
    args = sys.argv[1:]
    dry = '--dry-run' in args
    args = [a for a in args if a != '--dry-run']
    if not args:
        print("Usage: push_batch.py <LC2343K1> [LC...] [--dry-run]"); sys.exit(1)
    for dxc in args:
        try: result = push_one(dxc, dry_run=dry)
        except Exception as e: result = {'dxc_id': dxc, 'status':'exception', 'error':str(e)}
        print(json.dumps(result, ensure_ascii=False))
