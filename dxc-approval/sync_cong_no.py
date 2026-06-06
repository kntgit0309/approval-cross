#!/usr/bin/env python3
"""
Sync bảng 210.6 Công nợ Weekly từ bảng 210.4 Transaction.

Logic:
  - Lấy tất cả (Shop, Kỳ theo tháng) distinct từ 210.4
  - So với (Shop, Kỳ công nợ) trong 210.6
  - Tạo record mới cho các tuple thiếu — KHÔNG tạo lại record đã có

Usage:
  python3 sync_cong_no.py [--dry-run]
"""
import json, subprocess, sys, os

LARK = '/opt/homebrew/bin/lark-cli'
BASE_TOKEN = 'RcX6wwhnZiJsQrkx7TPl9OlCglc'
TBL_210_4 = 'tblPF303bcc055WU'   # Transaction
TBL_210_6 = 'tbldRXWKVhB0y0mm'   # Công nợ Weekly

def lark(*args):
    env = {**os.environ, 'PATH': '/opt/homebrew/bin:' + os.environ.get('PATH','')}
    out = subprocess.run([LARK, *args], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(f"lark-cli failed: {out.stderr}")
    return json.loads(out.stdout)

def fetch_all(table_id, field_names):
    """Paginate all records, return list of fields dicts."""
    items = []
    page_token = None
    while True:
        params = '{"page_size":500}'
        if page_token:
            params = json.dumps({'page_size':500,'page_token':page_token})
        body = json.dumps({'field_names': field_names}, ensure_ascii=False)
        res = lark('api','POST',
            f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{table_id}/records/search',
            '--as','user','--params',params,'--data',body)
        data = res.get('data', {})
        items.extend(data.get('items') or [])
        if not data.get('has_more'): break
        page_token = data.get('page_token')
        if not page_token: break
    return [it['fields'] for it in items]

def first_text(v):
    if isinstance(v, list) and v:
        if isinstance(v[0], dict): return v[0].get('text','')
        return str(v[0])
    if isinstance(v, dict):
        val = v.get('value')
        if isinstance(val, list) and val:
            if isinstance(val[0], dict): return val[0].get('text', str(val[0]))
            return str(val[0])
    return str(v) if v else ''

def fetch_shop_options():
    """Get valid Shop options of 210.6 to filter cascade-restricted shops."""
    res = lark('api','GET',
        f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_210_6}/fields',
        '--as','user','--params','{"page_size":100}')
    for f in res.get('data', {}).get('items') or []:
        if f.get('field_name') == 'Shop':
            opts = f.get('property', {}).get('options') or []
            return {o['name'] for o in opts}
    return set()

def main():
    dry = '--dry-run' in sys.argv

    # 1. Get (Shop, Kỳ theo tháng) from 210.4
    print('Loading 210.4 Transaction...', file=sys.stderr)
    rows_t = fetch_all(TBL_210_4, ['Shop','Kỳ theo tháng'])
    pairs_t = set()
    for f in rows_t:
        shop = first_text(f.get('Shop'))
        ky = first_text(f.get('Kỳ theo tháng'))
        if shop and ky:
            pairs_t.add((shop, ky))
    print(f"  210.4: {len(rows_t)} records → {len(pairs_t)} distinct (Shop, Kỳ)", file=sys.stderr)

    # 2. Get (Shop, Kỳ công nợ) from 210.6
    print('Loading 210.6 Công nợ Weekly...', file=sys.stderr)
    rows_c = fetch_all(TBL_210_6, ['Shop','Kỳ công nợ'])
    pairs_c = set()
    for f in rows_c:
        shop = first_text(f.get('Shop'))
        ky = first_text(f.get('Kỳ công nợ'))
        if shop and ky:
            pairs_c.add((shop, ky))
    print(f"  210.6: {len(rows_c)} records → {len(pairs_c)} distinct (Shop, Kỳ)", file=sys.stderr)

    # 2b. Get valid Shop options
    valid_shops = fetch_shop_options()

    # 3. Missing in 210.6
    all_missing = sorted(pairs_t - pairs_c)
    missing = [(s,k) for s,k in all_missing if s in valid_shops]
    invalid_shops = sorted({s for s,_ in all_missing if s not in valid_shops})
    print(f"\nMissing: {len(all_missing)} pairs ({len(missing)} valid, {len(invalid_shops)} shops not in option list)", file=sys.stderr)
    if invalid_shops:
        print(f"  Shops cần add option trước: {', '.join(invalid_shops[:10])}", file=sys.stderr)

    if not missing:
        result = {'status':'ok','created':0,'message':'no missing pairs'}
        print(json.dumps(result, ensure_ascii=False))
        return

    if dry:
        for s, k in missing[:30]:
            print(f"  + {k} | {s}", file=sys.stderr)
        if len(missing) > 30: print(f"  ... and {len(missing)-30} more", file=sys.stderr)
        result = {'status':'dry_run','would_create':len(missing),'preview':[{'Kỳ':k,'Shop':s} for s,k in missing[:30]]}
        print(json.dumps(result, ensure_ascii=False))
        return

    # 4. Batch create (max 500 per call)
    records = [{'fields':{'Kỳ công nợ':k,'Shop':s}} for s,k in missing]
    created = 0
    errors = []
    for i in range(0, len(records), 500):
        batch = records[i:i+500]
        try:
            res = lark('api','POST',
                f'/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{TBL_210_6}/records/batch_create',
                '--as','user','--data',json.dumps({'records':batch}, ensure_ascii=False))
            if res.get('code') == 0:
                created += len(res['data']['records'])
            else:
                errors.append(res.get('error') or res.get('msg'))
        except Exception as e:
            errors.append(str(e))

    result = {'status':'ok' if not errors else 'partial','created':created,'errors':errors,'skipped_invalid_shops':invalid_shops}
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
