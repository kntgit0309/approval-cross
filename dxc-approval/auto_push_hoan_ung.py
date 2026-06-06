#!/usr/bin/env python3
"""
Push ĐXC — được gọi bởi Lark Base Automation webhook (không tự scan).

Dùng qua:
  POST /push-base       body: {"record_id": "rec..."}  → từ Base Automation
  POST /push            body: {"dxc_id": "LC2687K1"}   → thủ công
  POST /push-batch      body: {"dxc_ids": [...]}        → thủ công batch

CUT_OFF_DATE: chỉ push LC tạo SAU ngày này (bảo vệ khỏi push LC cũ).
"""
import json, subprocess, os, sys, time, urllib.request
from datetime import datetime

NOTI_WEBHOOK = os.environ.get('NOTI_WEBHOOK', '')

# Chỉ push LC tạo SAU ngày này — tránh push LC cũ hàng loạt
# Format: YYYY-MM-DD (ICT +07:00)
CUT_OFF_DATE = '2026-06-01'

def send_noti(results):
    """Send notification card to bot after push."""
    ok = [r for r in results if r.get('status') == 'ok']
    err = [r for r in results if r.get('status') not in ('ok','skipped')]
    if not ok and not err:
        return

    elements = []
    for r in ok:
        dxc = r['dxc_id']
        mota = r.get('mota','-')
        dept = r.get('dept','-')
        amt = r.get('amt')
        cur = r.get('cur','VND')
        han = r.get('han','-')
        requester = r.get('requester','-')
        elements.append({
            'tag': 'column_set',
            'flex_mode': 'none',
            'background_style': 'grey',
            'columns': [
                {'tag':'column','width':'weighted','weight':1,'vertical_align':'center',
                 'elements':[{'tag':'markdown','content':f"**🆕 ĐXC mới cần duyệt — {dxc}**"}]},
            ]
        })
        amt_str = f"{int(amt):,} {cur}" if amt is not None else '-'
        c3 = r.get('c3', '-')
        dmc = r.get('dmc', '')
        elements.append({
            'tag': 'div',
            'text': {'tag': 'lark_md', 'content':
                f"**Người đề xuất:** {requester}\n"
                f"**Phòng ban:** {dept}\n"
                f"**Loại đơn:** {r.get('loai_don','-')}\n"
                f"**TK C3:** {c3}\n"
                f"**Số tiền:** {amt_str}\n"
                f"**Hạn TT:** {han}\n"
                f"**Nội dung:** {mota}"
            }
        })
        if dmc:
            elements.append({
                'tag': 'div',
                'text': {'tag': 'lark_md', 'content': f"🎁 **Phân tích:** {dmc}"}
            })
        elements.append({'tag':'hr'})

    for r in err:
        elements.append({'tag':'div','text':{'tag':'lark_md',
            'content':f"❌ **{r['dxc_id']}** → {r.get('reason') or r.get('error','-')}"}})

    elements.append({'tag':'note','elements':[
        {'tag':'lark_md','content':f"🤖 Auto-push {datetime.now().strftime('%H:%M %d/%m/%Y')} • Bảng 57 CFM"}
    ]})

    title_txt = f"🔔 Auto Push — {len(ok)} đơn mới cần duyệt" if not err else f"⚠️ Auto Push — {len(ok)} OK, {len(err)} lỗi"
    card = {
        'msg_type': 'interactive',
        'card': {
            'config': {'wide_screen_mode': True},
            'header': {
                'title': {'tag': 'plain_text', 'content': title_txt},
                'template': 'green' if not err else 'orange'
            },
            'elements': elements
        }
    }
    try:
        req = urllib.request.Request(
            NOTI_WEBHOOK,
            data=json.dumps(card, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json; charset=utf-8'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[noti] send failed: {e}", file=sys.stderr)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from push_batch import lark, push_one, BASE_TOKEN, TBL_57, PROFILE_BASE

STATE_FILE = os.path.join(HERE, 'auto_push_state.json')
LOG_FILE = os.path.join(HERE, 'auto_push.log')

def log(msg):
    line = f"{datetime.now().isoformat()} {msg}"
    print(line)
    with open(LOG_FILE,'a') as f: f.write(line+'\n')

def load_state():
    if os.path.exists(STATE_FILE):
        try: return json.load(open(STATE_FILE))
        except: return {}
    return {}

def save_state(s):
    json.dump(s, open(STATE_FILE,'w'), ensure_ascii=False, indent=2)

def find_pending():
    """Find LCs ready to push: TT KC=1, no Request No., tạo sau CUT_OFF_DATE."""
    from datetime import timezone, timedelta
    tz = timezone(timedelta(hours=7))
    y, m, d = map(int, CUT_OFF_DATE.split('-'))
    cut_ms = int(datetime(y, m, d, tzinfo=tz).timestamp() * 1000)

    items = []
    page_token = None
    while True:
        params = '{"page_size":200}'
        body = {'filter':{'conjunction':'and','conditions':[
            {'field_name':'4F_Loại đơn','operator':'isNotEmpty','value':[]},
            {'field_name':'1F_TT KC','operator':'is','value':['1']},
            {'field_name':'1L_Request No. 1','operator':'isEmpty','value':[]},
            {'field_name':'Ngày giờ tạo','operator':'isGreater','value':['ExactDate', str(cut_ms)]},
        ]}}
        if page_token:
            params = json.dumps({'page_size':200,'page_token':page_token})
        res = lark("api","POST", f"/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_57}/records/search",
            '--as','user','--params',params,'--data',json.dumps(body, ensure_ascii=False),
            profile=PROFILE_BASE)
        data = res.get('data',{})
        items.extend(data.get('items') or [])
        if not data.get('has_more'): break
        page_token = data.get('page_token')
        if not page_token: break
    return items

def main():
    state = load_state()
    log(f"--- auto-push-hoan-ung start; state has {len(state)} entries ---")
    items = find_pending()
    log(f"found {len(items)} pending DXC records")

    results = []
    for it in items:
        f = it['fields']
        dxc = (f.get('DXC-ID') or {}).get('value', [{}])[0].get('text','')
        if not dxc: continue
        amount = (f.get('4F_Số tiền') or {}).get('value', [None])[0]
        if amount is None:
            log(f"SKIP {dxc}: amount empty")
            continue
        # Skip recently pushed (within 1 hour) — to avoid duplicate after failures
        last = state.get(dxc)
        if last and last.get('status') == 'ok' and (time.time() - last.get('ts',0) < 3600):
            log(f"SKIP {dxc}: pushed recently {last.get('instance_code')}")
            continue
        try:
            r = push_one(dxc)
        except Exception as e:
            r = {'dxc_id':dxc,'status':'exception','error':str(e)}
        log(f"PUSH {dxc} → {r.get('status')} {r.get('instance_code','')} {r.get('reason') or r.get('error','')}")
        state[dxc] = {**r, 'ts': time.time()}
        results.append(r)

    save_state(state)
    summary = {
        'status': 'ok',
        'found': len(items),
        'pushed_ok': sum(1 for r in results if r.get('status')=='ok'),
        'pushed_err': sum(1 for r in results if r.get('status') not in ('ok','skipped')),
        'results': results,
    }
    log(f"--- end: ok={summary['pushed_ok']} err={summary['pushed_err']} ---")
    # Send notification if any push happened
    if results:
        send_noti(results)
    print(json.dumps(summary, ensure_ascii=False))

if __name__ == '__main__':
    main()
