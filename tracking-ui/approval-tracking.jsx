import { useState } from "react";

/* ─── Lark Design Tokens ───────────────────────────────────────────────────── */
const L = {
  primary:    "#1456F0",
  primaryHov: "#0E47D6",
  primaryBg:  "#EEF3FF",
  success:    "#1CB87E",
  successBg:  "#E8F9F2",
  warn:       "#FF8800",
  warnBg:     "#FFF4E5",
  danger:     "#F54A45",
  dangerBg:   "#FFF0EF",
  neutral9:   "#1F2329",
  neutral8:   "#3D3D3D",
  neutral7:   "#51545B",
  neutral6:   "#646A73",
  neutral5:   "#8F959E",
  neutral4:   "#B2B8C0",
  neutral3:   "#DEE0E3",
  neutral2:   "#F3F4F5",
  neutral1:   "#F9FAFB",
  white:      "#FFFFFF",
  font:       "'PingFang SC', 'SF Pro Text', -apple-system, 'Helvetica Neue', sans-serif",
  radius:     8,
  radiusLg:   12,
  shadow:     "0 2px 8px rgba(31,35,41,0.10), 0 0 1px rgba(31,35,41,0.08)",
  shadowLg:   "0 8px 24px rgba(31,35,41,0.12), 0 2px 6px rgba(31,35,41,0.06)",
};

/* ─── Mock Data ─────────────────────────────────────────────────────────────── */
const DATA = {
  id: "APP-2025-0612",
  title: "Đề xuất mua thiết bị văn phòng Q3",
  type: "Mua sắm / Procurement",
  submitter: { name: "Nguyễn Minh Tuấn", dept: "Operations", avatar: "NMT", time: "06/06/2025 08:32" },
  amount: "48.500.000 ₫",
  summary: "Mua 5 màn hình 27\" 4K, 3 bàn phím cơ, 1 laptop dự phòng cho team Dev.",
  steps: [
    { level: 1, role: "Quản lý trực tiếp", name: "Trần Thị Lan",  dept: "Operations Lead", avatar: "TTL", status: "approved",    time: "06/06 09:14", comment: "Đồng ý, cần thiết cho Q3." },
    { level: 2, role: "Kiểm soát tài chính", name: "Lê Văn Hùng",   dept: "Finance Dept",    avatar: "LVH", status: "approved",    time: "06/06 10:45", comment: "Budget Q3 còn margin, approved." },
    { level: 3, role: "Giám đốc bộ phận",  name: "Phạm Quốc Dũng", dept: "COO Office",      avatar: "PQD", status: "in_progress", time: null,          comment: null },
    { level: 4, role: "CEO / Phê duyệt cuối", name: "Ngô Thanh Hà",  dept: "Executive Office",avatar: "NTH", status: "pending",     time: null,          comment: null },
  ],
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
const AVATAR_COLORS = { NMT:"#1456F0", TTL:"#1CB87E", LVH:"#00AAFF", PQD:"#FF8800", NTH:"#8B5CF6" };

const STATUS_MAP = {
  approved:    { label:"Đã duyệt",   color: L.success, bg: L.successBg, icon: "✓",  border: L.success },
  in_progress: { label:"Đang duyệt", color: L.warn,    bg: L.warnBg,    icon: "···", border: L.warn },
  rejected:    { label:"Từ chối",    color: L.danger,  bg: L.dangerBg,  icon: "✕",  border: L.danger },
  pending:     { label:"Chờ duyệt",  color: L.neutral5,bg: L.neutral2,  icon: "",    border: L.neutral3 },
};

function Avatar({ id, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: AVATAR_COLORS[id] || L.primary,
      color: "#fff", fontWeight: 600,
      fontSize: size * 0.34, display: "flex",
      alignItems: "center", justifyContent: "center",
      flexShrink: 0, letterSpacing: 0.2,
      fontFamily: L.font,
    }}>{id}</div>
  );
}

function Tag({ children, color = L.primary, bg = L.primaryBg }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 4,
      background: bg, color: color,
      fontSize: 11, fontWeight: 500, lineHeight: "18px",
      fontFamily: L.font,
    }}>{children}</span>
  );
}

function StatusTag({ status }) {
  const s = STATUS_MAP[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4,
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 500, lineHeight: "18px",
      fontFamily: L.font,
    }}>
      {status === "approved" && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke={s.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      {status === "in_progress" && <span style={{fontSize:10,letterSpacing:1}}>•••</span>}
      {status === "rejected" && <span style={{fontSize:10}}>✕</span>}
      {s.label}
    </span>
  );
}

/* ─── Overall progress bar ──────────────────────────────────────────────────── */
function ProgressBar({ steps }) {
  const done = steps.filter(s => s.status === "approved").length;
  const pct = (done / steps.length) * 100;
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 6 }}>
        <span style={{ fontSize:12, color: L.neutral6, fontFamily: L.font }}>Tiến độ phê duyệt</span>
        <span style={{ fontSize:12, color: L.primary, fontWeight: 600, fontFamily: L.font }}>{done}/{steps.length} cấp</span>
      </div>
      <div style={{ height: 4, background: L.neutral2, borderRadius: 99, overflow:"hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 99,
          background: `linear-gradient(90deg, ${L.primary}, #4F8BFF)`,
          transition: "width .6s cubic-bezier(.4,0,.2,1)",
        }}/>
      </div>
    </div>
  );
}

/* ─── Step node icons ───────────────────────────────────────────────────────── */
function StepDot({ status, level }) {
  const s = STATUS_MAP[status];
  const isPending = status === "pending";
  const isActive = status === "in_progress";
  return (
    <div style={{
      width: 24, height: 24, borderRadius: "50%",
      background: isPending ? "#fff" : s.bg,
      border: `2px solid ${s.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, position: "relative", zIndex: 2,
      boxShadow: isActive ? `0 0 0 3px ${L.warnBg}` : "none",
      transition: "all .2s",
    }}>
      {status === "approved" && (
        <svg width="11" height="11" viewBox="0 0 11 11">
          <polyline points="1.5,5.5 4.5,8.5 9.5,2.5" fill="none" stroke={L.success} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {status === "in_progress" && (
        <div style={{ display:"flex", gap:1.5 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{
              width:3,height:3,borderRadius:"50%",background:L.warn,
              animation:`larkDot .9s ${i*0.2}s ease-in-out infinite`,
            }}/>
          ))}
        </div>
      )}
      {status === "rejected" && <span style={{color:L.danger,fontSize:10,fontWeight:700}}>✕</span>}
      {status === "pending" && (
        <span style={{color:L.neutral4,fontSize:10,fontWeight:600,fontFamily:L.font}}>{level}</span>
      )}
    </div>
  );
}

/* ─── Card (Lark chat message) ──────────────────────────────────────────────── */
function LarkCard({ onDetail }) {
  const current = DATA.steps.find(s => s.status === "in_progress");
  const done    = DATA.steps.filter(s => s.status === "approved").length;

  return (
    <div style={{
      width: 360, background: L.white,
      borderRadius: L.radiusLg, border: `1px solid ${L.neutral3}`,
      boxShadow: L.shadow, overflow: "hidden",
      fontFamily: L.font,
    }}>
      {/* ── Card header bar ── */}
      <div style={{
        background: L.primary, padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="2" fill="none" stroke="#fff" strokeWidth="1.4"/>
          <path d="M4 6h8M4 9h5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span style={{ color:"#fff", fontSize:13, fontWeight:600, flex:1 }}>Yêu cầu phê duyệt</span>
        <StatusTag status="in_progress" />
      </div>

      {/* ── Title + meta ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ fontSize:14, fontWeight:600, color: L.neutral9, lineHeight: 1.5, marginBottom: 8 }}>
          {DATA.title}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
          <Tag>{DATA.type}</Tag>
          <Tag color={L.warn} bg={L.warnBg}>{DATA.amount}</Tag>
          <Tag color={L.neutral6} bg={L.neutral2}>{DATA.id}</Tag>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height:1, background: L.neutral2, margin: "0 16px" }}/>

      {/* ── Submitter row ── */}
      <div style={{ padding: "10px 16px", display:"flex", alignItems:"center", gap:8 }}>
        <Avatar id="NMT" size={28}/>
        <div>
          <span style={{ fontSize:12, color: L.neutral8, fontWeight:500 }}>{DATA.submitter.name}</span>
          <span style={{ fontSize:12, color: L.neutral5 }}> · {DATA.submitter.dept}</span>
        </div>
        <span style={{ marginLeft:"auto", fontSize:11, color: L.neutral4 }}>{DATA.submitter.time}</span>
      </div>

      <div style={{ height:1, background: L.neutral2, margin: "0 16px" }}/>

      {/* ── Progress ── */}
      <div style={{ padding:"12px 16px 8px" }}>
        <ProgressBar steps={DATA.steps}/>
      </div>

      {/* ── Mini step track ── */}
      <div style={{ padding: "8px 16px 0", display:"flex", alignItems:"center" }}>
        {DATA.steps.map((step, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", flex: i < DATA.steps.length-1 ? 1 : "none" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
              <StepDot status={step.status} level={step.level}/>
              <span style={{ fontSize:10, color: STATUS_MAP[step.status].color, fontWeight:500, whiteSpace:"nowrap", maxWidth:60, textAlign:"center", overflow:"hidden", textOverflow:"ellipsis" }}>
                {step.name.split(" ").pop()}
              </span>
            </div>
            {i < DATA.steps.length-1 && (
              <div style={{
                flex:1, height:1.5, margin:"0 2px", marginBottom:16,
                background: step.status==="approved" ? L.success : L.neutral3,
              }}/>
            )}
          </div>
        ))}
      </div>

      {/* ── Current approver callout ── */}
      {current && (
        <div style={{
          margin:"10px 16px 0",
          padding:"8px 12px", borderRadius: L.radius,
          background: L.warnBg, border:`1px solid #FFD591`,
          display:"flex", alignItems:"center", gap:8,
        }}>
          <Avatar id={current.avatar} size={26}/>
          <div>
            <div style={{ fontSize:11, color: L.warn, fontWeight:600 }}>Đang chờ phê duyệt</div>
            <div style={{ fontSize:12, color: L.neutral8 }}>
              <strong>{current.name}</strong>
              <span style={{ color: L.neutral5 }}> — {current.role}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
        <button
          onClick={onDetail}
          style={{
            flex:1, padding:"7px 0", borderRadius: L.radius,
            background: L.primary, border:"none", color:"#fff",
            fontSize:13, fontWeight:500, cursor:"pointer", fontFamily: L.font,
            transition:"background .15s",
          }}
          onMouseEnter={e=>e.currentTarget.style.background=L.primaryHov}
          onMouseLeave={e=>e.currentTarget.style.background=L.primary}
        >
          Xem chi tiết
        </button>
        <button style={{
          padding:"7px 14px", borderRadius: L.radius,
          border:`1px solid ${L.neutral3}`, background:"#fff",
          color: L.neutral7, fontSize:13, cursor:"pointer", fontFamily: L.font,
        }}>
          Nhắc nhở
        </button>
      </div>
    </div>
  );
}

/* ─── H5 Detail ─────────────────────────────────────────────────────────────── */
function H5Detail({ onClose }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={{
      width: 420, background: L.neutral1,
      borderRadius: L.radiusLg, border:`1px solid ${L.neutral3}`,
      boxShadow: L.shadowLg, overflow:"hidden",
      display:"flex", flexDirection:"column", maxHeight:700,
      fontFamily: L.font,
    }}>
      {/* Nav bar */}
      <div style={{
        background: L.white, borderBottom:`1px solid ${L.neutral3}`,
        padding:"0 16px", height:48,
        display:"flex", alignItems:"center", gap:8, flexShrink:0,
      }}>
        <button
          onClick={onClose}
          style={{
            background:"none",border:"none",cursor:"pointer",
            color: L.neutral6, padding:4, borderRadius:6,
            display:"flex",alignItems:"center",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 4L6 9l5 5" stroke={L.neutral6} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize:15, fontWeight:600, color: L.neutral9, flex:1 }}>Chi tiết phê duyệt</span>
        <StatusTag status="in_progress"/>
      </div>

      {/* Scrollable */}
      <div style={{ flex:1, overflowY:"auto", padding:"0 0 16px" }}>

        {/* ── Info card ── */}
        <div style={{
          background: L.white, borderBottom:`1px solid ${L.neutral3}`,
          padding:"16px",
        }}>
          <div style={{ fontSize:16, fontWeight:600, color: L.neutral9, lineHeight:1.5, marginBottom:10 }}>
            {DATA.title}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            <Tag>{DATA.type}</Tag>
            <Tag color={L.warn} bg={L.warnBg}>{DATA.amount}</Tag>
            <Tag color={L.neutral6} bg={L.neutral2}>{DATA.id}</Tag>
          </div>
          {/* Meta rows */}
          {[
            ["Người gửi", <span style={{display:"flex",alignItems:"center",gap:6}}><Avatar id="NMT" size={20}/><span style={{fontSize:12,color:L.neutral8}}>{DATA.submitter.name} · {DATA.submitter.dept}</span></span>],
            ["Thời gian gửi", DATA.submitter.time],
            ["Mô tả", DATA.summary],
          ].map(([k,v],i)=>(
            <div key={i} style={{ display:"flex", gap:12, padding:"6px 0", borderTop:i>0?`1px solid ${L.neutral2}`:"none" }}>
              <span style={{ width:88, flexShrink:0, fontSize:12, color: L.neutral5 }}>{k}</span>
              <span style={{ fontSize:12, color: L.neutral8, lineHeight:1.6 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* ── Progress summary ── */}
        <div style={{ padding:"14px 16px 0" }}>
          <div style={{ fontSize:13, fontWeight:600, color: L.neutral9, marginBottom:10 }}>
            Quy trình phê duyệt
          </div>
          <ProgressBar steps={DATA.steps}/>
        </div>

        {/* ── Timeline ── */}
        <div style={{ padding:"14px 16px 0", position:"relative" }}>
          {DATA.steps.map((step, i) => {
            const s   = STATUS_MAP[step.status];
            const exp = expanded === i;
            const isLast = i === DATA.steps.length - 1;

            return (
              <div key={i} style={{ display:"flex", gap:12, position:"relative" }}>
                {/* Left column: dot + line */}
                <div style={{ display:"flex",flexDirection:"column",alignItems:"center",width:24,flexShrink:0 }}>
                  <StepDot status={step.status} level={step.level}/>
                  {!isLast && (
                    <div style={{
                      width:1.5, flex:1, minHeight:20,
                      background: step.status==="approved"
                        ? `linear-gradient(${L.success},${L.neutral3})` : L.neutral3,
                      margin:"4px 0",
                    }}/>
                  )}
                </div>

                {/* Right column: card */}
                <div style={{ flex:1, paddingBottom: isLast?0:10 }}>
                  <div
                    onClick={() => step.comment && setExpanded(exp?null:i)}
                    style={{
                      background: L.white,
                      border:`1px solid ${exp ? s.border : L.neutral3}`,
                      borderRadius: L.radius,
                      padding:"10px 12px",
                      cursor: step.comment ? "pointer":"default",
                      transition:"border-color .15s, box-shadow .15s",
                      boxShadow: exp ? `0 2px 8px ${s.bg}` : "none",
                    }}
                    onMouseEnter={e=>{if(step.comment){e.currentTarget.style.borderColor=s.border}}}
                    onMouseLeave={e=>{if(!exp){e.currentTarget.style.borderColor=L.neutral3}}}
                  >
                    {/* Step header */}
                    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
                      <Avatar id={step.avatar} size={28}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:L.neutral9}}>{step.name}</div>
                        <div style={{fontSize:11,color:L.neutral5}}>{step.role} · {step.dept}</div>
                      </div>
                      <StatusTag status={step.status}/>
                    </div>

                    {/* Time row */}
                    {step.time && (
                      <div style={{
                        display:"flex",alignItems:"center",gap:4,
                        fontSize:11,color:L.neutral5,marginBottom: step.comment?6:0,
                      }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <circle cx="6" cy="6" r="4.5" stroke={L.neutral4} strokeWidth="1.2"/>
                          <path d="M6 3.5V6l1.5 1.5" stroke={L.neutral4} strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                        {step.time}
                      </div>
                    )}

                    {/* Comment (expandable) */}
                    {step.comment && (
                      <div style={{
                        maxHeight: exp?"100px":"0",
                        overflow:"hidden",
                        transition:"max-height .3s ease",
                      }}>
                        <div style={{
                          padding:"7px 10px",
                          background: s.bg,
                          borderRadius:6,
                          fontSize:12,color:L.neutral8,lineHeight:1.6,
                          borderLeft:`3px solid ${s.color}`,
                        }}>
                          {step.comment}
                        </div>
                      </div>
                    )}

                    {/* Expand hint */}
                    {step.comment && (
                      <div style={{
                        marginTop:4,fontSize:11,color:L.primary,
                        display:"flex",alignItems:"center",gap:2,
                      }}>
                        {exp ? "Thu gọn" : "Xem nhận xét"}
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                          style={{transform:exp?"rotate(180deg)":"none",transition:"transform .2s"}}>
                          <path d="M2 4l3 3 3-3" stroke={L.primary} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}

                    {/* Pending placeholder */}
                    {step.status==="pending" && (
                      <div style={{fontSize:12,color:L.neutral4,fontStyle:"italic"}}>
                        Chưa đến lượt phê duyệt
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background:L.white,borderTop:`1px solid ${L.neutral3}`,
        padding:"10px 16px",display:"flex",gap:8,flexShrink:0,
      }}>
        <button style={{
          flex:1,padding:"8px",borderRadius:L.radius,border:"none",
          background:L.primary,color:"#fff",fontSize:13,fontWeight:500,
          cursor:"pointer",fontFamily:L.font,
        }}>Nhắc người duyệt</button>
        <button style={{
          padding:"8px 16px",borderRadius:L.radius,
          border:`1px solid ${L.neutral3}`,background:"#fff",
          color:L.neutral7,fontSize:13,cursor:"pointer",fontFamily:L.font,
        }}>Rút đơn</button>
      </div>
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────────────────────────────── */
export default function App() {
  const [show, setShow] = useState(false);

  return (
    <div style={{
      minHeight:"100vh",
      background:"#E8ECF2",
      display:"flex",alignItems:"center",justifyContent:"center",
      padding:32,gap:24,flexWrap:"wrap",fontFamily:L.font,
    }}>
      <style>{`
        @keyframes larkDot {
          0%,80%,100%{transform:scale(0.7);opacity:.5}
          40%{transform:scale(1.1);opacity:1}
        }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${L.neutral3};border-radius:4px}
        button{font-family:${L.font}}
      `}</style>

      {/* Left: chat context */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:8}}>
        {/* Label */}
        <div style={{
          display:"inline-flex",alignItems:"center",gap:6,
          background:L.white,border:`1px solid ${L.neutral3}`,
          borderRadius:6,padding:"3px 10px",
          fontSize:11,color:L.neutral6,fontWeight:500,marginBottom:2,
          boxShadow:"0 1px 3px #0000000a",
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="1" width="10" height="10" rx="2.5" fill={L.primary} opacity=".15"/>
            <rect x="1" y="1" width="10" height="10" rx="2.5" stroke={L.primary} strokeWidth="1.2" fill="none"/>
            <path d="M3 6h6M3 4h4M3 8h3" stroke={L.primary} strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
          Lark Chat — Interactive Card
        </div>

        {/* Chat sim */}
        <div style={{
          background:"#EEF0F4",borderRadius:12,
          padding:"14px 14px 10px",border:`1px solid #DDE0E6`,
        }}>
          {/* Bot row */}
          <div style={{
            display:"flex",alignItems:"center",gap:8,marginBottom:10,
          }}>
            <div style={{
              width:32,height:32,borderRadius:8,
              background:L.primary,display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="3" width="14" height="10" rx="2" stroke="#fff" strokeWidth="1.4" fill="none"/>
                <path d="M5 7h8M5 10h5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M6 13v2M12 13v2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:L.neutral9}}>Approval Bot</div>
              <div style={{fontSize:11,color:L.neutral5}}>Hôm nay lúc 08:32</div>
            </div>
          </div>
          <LarkCard onDetail={()=>setShow(true)}/>
        </div>
      </div>

      {/* Arrow */}
      {show && (
        <div style={{
          display:"flex",flexDirection:"column",alignItems:"center",gap:4,
          color:L.neutral5,fontSize:20,
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 10h12M11 5l5 5-5 5" stroke={L.primary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{fontSize:10,color:L.neutral5,fontWeight:500}}>Mở H5</span>
        </div>
      )}

      {/* Right: H5 detail */}
      {show && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:8}}>
          <div style={{
            display:"inline-flex",alignItems:"center",gap:6,
            background:L.white,border:`1px solid ${L.neutral3}`,
            borderRadius:6,padding:"3px 10px",
            fontSize:11,color:L.neutral6,fontWeight:500,marginBottom:2,
            boxShadow:"0 1px 3px #0000000a",
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="1" width="9" height="10" rx="1.5" stroke={L.primary} strokeWidth="1.2" fill="none"/>
              <rect x="1.5" y="1" width="9" height="3" rx="1.5" fill={L.primary} opacity=".2"/>
            </svg>
            H5 MiniApp — Approval Detail
          </div>
          <H5Detail onClose={()=>setShow(false)}/>
        </div>
      )}

      {!show && (
        <div style={{
          display:"flex",flexDirection:"column",alignItems:"center",
          gap:8,color:L.neutral5,
        }}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke={L.neutral3} strokeWidth="1.5"/>
            <path d="M12 18h12M19 13l5 5-5 5" stroke={L.neutral4} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{fontSize:12,color:L.neutral5,textAlign:"center",maxWidth:120}}>
            Nhấn <strong style={{color:L.primary}}>Xem chi tiết</strong><br/>để mở H5 panel
          </span>
        </div>
      )}
    </div>
  );
}
