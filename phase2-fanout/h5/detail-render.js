'use strict';
/* Render panel chi tiết phê duyệt — dùng chung cho approval-detail.html (standalone)
   và approval-center.html (pane phải). renderDetail(el, data, opts). */
(function (global) {
  const PILL = {
    approved:    { c:'var(--green)',  b:'var(--greenBg)'  },
    rejected:    { c:'var(--red)',    b:'var(--redBg)'    },
    in_progress: { c:'var(--orange)', b:'var(--orangeBg)' },
    pending:     { c:'var(--n6)',     b:'var(--n2)'       },
    canceled:    { c:'var(--n6)',     b:'var(--n2)'       },
    done:        { c:'var(--n6)',     b:'var(--n2)'       },
    cc:          { c:'var(--n6)',     b:'var(--n2)'       },
  };
  const AVA = ['#3370FF','#2EA121','#1FA1A1','#FF811A','#8B5CF6','#D83931','#0E73E8'];
  const initials = (n)=>{ if(!n)return'?'; const p=n.trim().split(/\s+/); return (p.length>1?p[0][0]+p[p.length-1][0]:n.slice(0,2)).toUpperCase(); };
  const avaColor = (n)=>{ let h=0; for(const c of(n||''))h=(h*31+c.charCodeAt(0))>>>0; return AVA[h%AVA.length]; };
  const isSystem = (n)=>/^system$/i.test((n||'').trim());
  function avatar(name, size){
    size=size||24;
    const st='width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*0.42)+'px;';
    if(isSystem(name)) return '<span class="ava" style="'+st+'background:#3370FF">'
      + '<svg width="'+Math.round(size*0.6)+'" height="'+Math.round(size*0.6)+'" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="9" rx="2" stroke="#fff" stroke-width="1.3"/><path d="M6 4V3h4v1" stroke="#fff" stroke-width="1.3"/></svg></span>';
    return '<span class="ava" style="'+st+'background:'+avaColor(name)+'">'+initials(name)+'</span>';
  }
  function pill(status, text){ const s=PILL[status]||PILL.pending; return '<span class="pill" style="color:'+s.c+';background:'+s.b+'">'+text+'</span>'; }
  function fieldValue(f){
    if(f.kind==='user') return '<span class="vtag">'+avatar(f.value,20)+f.value+'</span>';
    if(f.kind==='dept') return '<span class="dtag"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="5" width="10" height="7" rx="1" stroke="#8F959E" stroke-width="1.2"/><path d="M5 5V3h4v2" stroke="#8F959E" stroke-width="1.2"/></svg>'+f.value+'</span>';
    return f.value;
  }
  const statusLabel = (s)=> s==='rejected'?'Rejected':s==='approved'?'Approved':s==='in_progress'?'In progress':s==='canceled'?'Canceled':s;

  function renderDetail(el, d, opts){
    opts = opts || {};
    global.__detailClose = opts.onClose || (()=>history.back());
    global.scrollToSec = (id)=>{ const n=document.getElementById(id); if(n) n.scrollIntoView({behavior:'smooth',block:'start'}); };

    const detailsRows = (d.fields||[]).map(f =>
      '<div class="kv"><div class="k">'+f.label+'</div><div class="v">'+fieldValue(f)+'</div></div>'
    ).join('');
    const recRows = (d.steps||[]).map(st=>{
      const appr = '<div class="appr">'+avatar(st.name,28)
        + '<div class="info"><span>'+st.name+'</span>'+(st.sub?'<span class="sub">'+st.sub+'</span>':'')+'</div></div>';
      const result = st.result ? pill(st.status, st.result) : '';
      const time = '<div class="time-ago">'+(st.ago||'')+'</div>'+(st.time?'<div class="time-date">'+st.time+'</div>':'');
      return '<tr><td class="col-step">'+(st.sub?'':st.node)+'</td><td>'+appr+'</td><td>'+result+'</td>'
        + '<td>'+(st.comment||'')+'</td><td class="col-time">'+time+'</td></tr>';
    }).join('');

    const closeX = '<span class="close-x" onclick="__detailClose()"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="#8F959E" stroke-width="1.5" stroke-linecap="round"/></svg></span>';

    el.innerHTML =
      '<div class="topbar"><span>No. '+d.id+'</span><span class="icons">'
        + '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 5l3-3 3 3M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke="#8F959E" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="6" rx="1" stroke="#8F959E" stroke-width="1.3"/><path d="M4 7V3h8v4M5 10h6" stroke="#8F959E" stroke-width="1.3" stroke-linecap="round"/></svg>'
        + closeX + '</span></div>'
      + '<div class="h-title"><h1>'+d.title+'</h1>'+pill(d.status, statusLabel(d.status))+'</div>'
      + '<div class="sub-line">'+avatar(d.submitter.name,22)+'<span class="nm">'+d.submitter.name+'</span>'
        + (d.submitter.role?'<span>'+d.submitter.role+'</span>':'')+'<span class="sep">|</span>'
        + '<span>Submitted: '+(d.submitter.time||'')+'</span></div>'
      + '<div class="tabs">'
        + '<div class="tab active" onclick="scrollToSec(\'s-details\')">Details</div>'
        + '<div class="tab" onclick="scrollToSec(\'s-record\')">Approval Record</div>'
        + '<div class="tab" onclick="scrollToSec(\'s-comments\')">Comments</div></div>'
      + '<div class="sec" id="s-details"><div class="sec-h"><span class="bar"></span><span class="t">Details</span></div>'+detailsRows+'</div>'
      + '<div class="sec" id="s-record"><div class="sec-h"><span class="bar"></span><span class="t">Approval Record</span></div>'
        + '<table><thead><tr><th class="col-step">Step Name</th><th>Approver</th><th>Result</th><th>Comments</th><th class="col-time">Time</th></tr></thead>'
        + '<tbody>'+recRows+'</tbody></table></div>'
      + '<div class="sec" id="s-comments"><div class="sec-h"><span class="bar"></span><span class="t">Comments</span></div>'
        + '<div class="cbox">You can @mention related members<span class="ic">'
        + '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M12 6l-5 5a2 2 0 102.8 2.8L15 8.8a3.5 3.5 0 10-5-5L5 8.8" stroke="#BBBFC4" stroke-width="1.3" stroke-linecap="round"/></svg>'
        + '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="3.5" width="13" height="11" rx="2" stroke="#BBBFC4" stroke-width="1.3"/><circle cx="6.5" cy="7.5" r="1.3" stroke="#BBBFC4" stroke-width="1.1"/><path d="M3 12l4-3 3 2 2-2 3 3" stroke="#BBBFC4" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '</span></div></div>';

    // tab active theo scroll (trong scrollEl — window cho standalone, pane cho center)
    const scrollEl = opts.scrollEl || global;
    const tabs=[...el.querySelectorAll('.tab')];
    const secs=['s-details','s-record','s-comments'].map(id=>document.getElementById(id));
    const onScroll=()=>{ let idx=0; secs.forEach((s,i)=>{ if(s && s.getBoundingClientRect().top<140) idx=i; });
      tabs.forEach((t,i)=>t.classList.toggle('active',i===idx)); };
    scrollEl.addEventListener('scroll', onScroll, {passive:true});
  }

  global.renderDetail = renderDetail;
  global.detailAvatar = avatar;
  global.detailPill = pill;
})(window);
