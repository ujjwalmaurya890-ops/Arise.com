(function(){if(!window.__ARISE_LEARNING_HEATMAP__){window.__ARISE_LEARNING_HEATMAP__=!0;var U="learning-heatmap-style",I=864e5,R=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],T=null,M=null;window.__mountLearningHeatmap=function(t){if(t){T=t,(function(){if(!document.getElementById(U)){var i=document.createElement("style");i.id=U,i.textContent=`
      .learning-heatmap-container {
        width: 100%;
        padding: 1.5rem;
        border-radius: 1.25rem;
        background: var(--surface, rgba(15, 23, 42, 0.8));
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        box-shadow: var(--shadow-md, 0 4px 24px rgba(0, 0, 0, 0.3));
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
        animation: lh-fade-in 0.5s ease-out;
      }

      @keyframes lh-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .lh-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary, #e2e8f0);
        margin-bottom: 1.5rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .lh-topbar {
        margin-bottom: 2rem;
      }

      .lh-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .lh-stat {
        padding: 1rem;
        border-radius: 0.75rem;
        background: var(--surface-hover, rgba(30, 30, 60, 0.6));
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        text-align: center;
        transition: all 0.3s ease;
      }

      .lh-stat:hover {
        border-color: var(--primary, var(--info));
        background: var(--surface-hover, rgba(30, 30, 60, 0.8));
        transform: translateY(-2px);
      }

      .lh-stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--primary, var(--info));
        margin-bottom: 0.25rem;
        font-family: 'JetBrains Mono', monospace;
      }

      .lh-stat-unit {
        font-size: 0.75rem;
        opacity: 0.7;
        margin-left: 0.25rem;
      }

      .lh-stat-label {
        font-size: 0.75rem;
        color: var(--text-secondary, var(--text-tertiary));
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
      }

      .lh-months {
        display: grid;
        gap: 2px;
        margin-bottom: 0.5rem;
        padding-left: 32px;
      }

      .lh-month-label {
        font-size: 0.65rem;
        color: var(--text-tertiary, #64748b);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        height: 13px;
        display: flex;
        align-items: center;
      }

      .lh-grid {
        display: grid;
        gap: 2px;
        padding-left: 32px;
        margin-bottom: 1.5rem;
      }

      .lh-cell {
        width: 13px;
        height: 13px;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid rgba(255, 255, 255, 0.1);
        animation: lh-cell-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      @keyframes lh-cell-pop {
        from { transform: scale(0); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }

      .lh-cell-pad {
        background: transparent;
        border: none;
        cursor: default;
      }

      .lh-cell[data-level="0"] {
        background: color-mix(in srgb, var(--info) 8%, transparent);
        border-color: color-mix(in srgb, var(--info) 15%, transparent);
      }

      .lh-cell[data-level="1"] {
        background: color-mix(in srgb, var(--info) 25%, transparent);
        border-color: color-mix(in srgb, var(--info) 35%, transparent);
        box-shadow: 0 0 8px color-mix(in srgb, var(--info) 20%, transparent);
      }

      .lh-cell[data-level="2"] {
        background: color-mix(in srgb, var(--info) 45%, transparent);
        border-color: color-mix(in srgb, var(--info) 55%, transparent);
        box-shadow: 0 0 12px color-mix(in srgb, var(--info) 35%, transparent);
      }

      .lh-cell[data-level="3"] {
        background: color-mix(in srgb, var(--info) 65%, transparent);
        border-color: color-mix(in srgb, var(--info) 75%, transparent);
        box-shadow: 0 0 16px color-mix(in srgb, var(--info) 50%, transparent);
      }

      .lh-cell[data-level="4"] {
        background: color-mix(in srgb, var(--info) 85%, transparent);
        border-color: color-mix(in srgb, var(--info) 95%, transparent);
        box-shadow: 0 0 20px color-mix(in srgb, var(--info) 70%, transparent);
      }

      .lh-cell:hover {
        transform: scale(1.2);
        z-index: 10;
      }

      .lh-legend {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.75rem;
        color: var(--text-tertiary, #64748b);
        padding-left: 32px;
        margin-bottom: 1rem;
      }

      .lh-legend-cell {
        width: 13px;
        height: 13px;
        border-radius: 3px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .learning-heatmap-container {
          padding: 1rem;
        }

        .lh-stats {
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 0.75rem;
        }

        .lh-stat {
          padding: 0.75rem;
        }

        .lh-stat-value {
          font-size: 1.25rem;
        }

        .lh-cell {
          width: 11px;
          height: 11px;
          border-radius: 2px;
        }

        .lh-grid {
          gap: 1px;
          padding-left: 24px;
        }

        .lh-months {
          padding-left: 24px;
          gap: 1px;
        }

        .lh-legend {
          padding-left: 24px;
        }
      }

      @media (max-width: 480px) {
        .learning-heatmap-container {
          padding: 0.75rem;
        }

        .lh-title {
          font-size: 1rem;
          margin-bottom: 1rem;
        }

        .lh-stats {
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
        }

        .lh-stat {
          padding: 0.5rem;
        }

        .lh-stat-value {
          font-size: 1rem;
        }

        .lh-stat-label {
          font-size: 0.65rem;
        }

        .lh-cell {
          width: 9px;
          height: 9px;
          border-radius: 2px;
        }

        .lh-grid {
          gap: 1px;
          padding-left: 20px;
        }

        .lh-months {
          padding-left: 20px;
          gap: 1px;
        }

        .lh-legend {
          padding-left: 20px;
          gap: 0.5rem;
        }

        .lh-legend-cell {
          width: 9px;
          height: 9px;
        }
      }
    `,document.head.appendChild(i)}})();var n=document.createElement("div");n.className="learning-heatmap-container",t.appendChild(n),T=n,z(),M&&clearInterval(M),M=setInterval(function(){document.hidden||z()},5e3),window.addEventListener("storage",P),window.addEventListener("focus",N),window.addEventListener("studySessions:updated",P)}},window.__unmountLearningHeatmap=function(t){M&&(clearInterval(M),M=null),window.removeEventListener("storage",P),window.removeEventListener("focus",N),window.removeEventListener("studySessions:updated",P),t&&(t.innerHTML=""),T=null}}function y(t,n){try{var i=localStorage.getItem(t);if(!i)return n;var h=JSON.parse(i);return h??n}catch{return n}}function k(t){return t.toISOString().split("T")[0]}function m(t,n){return new Date(t.getTime()+n*I)}function w(){return t=new Date,new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate()));var t}function H(t,n){n=n||{};var i=k(t),h=n.d||y("studySessions",[]),s=n.g||y("dsaQuestions",[]),p=n.i||y("revisionSystemProgress",{}),g=n.p||y("smartLearningPathProgress",{}),u=0;Array.isArray(h)&&h.forEach(function(r){r&&r.date===i&&(u+=Number(r.minutes)||0)});var v=0;g&&typeof g=="object"&&Object.keys(g).forEach(function(r){var l=g[r];l&&l.lastActionAt&&l.lastActionAt.split("T")[0]===i&&v++});var d=0;Array.isArray(s)&&s.forEach(function(r){r&&r.solved&&r.solvedDate&&r.solvedDate.split("T")[0]===i&&d++});var e,a=0;return p&&typeof p=="object"&&Object.keys(p).forEach(function(r){var l=p[r];l&&Array.isArray(l.history)&&l.history.forEach(function(c){c.split("T")[0]===i&&a++})}),{date:i,studyMinutes:u,studyHours:(e=u/60,Math.round(10*(Number(e)||0))/10),topicsCompleted:v,problemsSolved:d,revisionsDone:a,totalActivity:u+30*v+20*d+15*a}}function j(t){var n="";return t.forEach(function(i,h){i.forEach(function(s){var p,g,u=s.inRange?(p=s.studyMinutes)<=0?0:p<=30?1:p<=90?2:p<=180?3:4:-1,v=Math.min(10*h,480)+2*(s.dow||0);if(u<0)n+="<span class='lh-cell lh-cell-pad'></span>";else{var d=s.date;s.metrics?(d+=": "+s.metrics.studyHours+"h study",s.metrics.topicsCompleted>0&&(d+=", "+s.metrics.topicsCompleted+" topics"),s.metrics.problemsSolved>0&&(d+=", "+s.metrics.problemsSolved+" problems"),s.metrics.revisionsDone>0&&(d+=", "+s.metrics.revisionsDone+" revisions")):d+=": no activity",n+="<span class='lh-cell' data-level='"+u+"' style='animation-delay:"+v+"ms' title='"+(g=d,String(g??"").replace(/[&<>"']/g,function(e){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[e]})+"'></span>")}})}),"<div class='lh-grid' style='grid-template-columns:repeat("+t.length+",13px);grid-template-rows:repeat(7,13px)'>"+n+"</div>"}function z(){if(T){var t="";try{t=k(w())+"|"+(localStorage.getItem("studySessions")||"")+"|"+(localStorage.getItem("dsaQuestions")||"")+"|"+(localStorage.getItem("revisionSystemProgress")||"")+"|"+(localStorage.getItem("smartLearningPathProgress")||"")}catch{}if(t&&T.__lhSig===t)return;T.__lhSig=t;var n=y("studySessions",[]),i=y("dsaQuestions",[]),h={d:n,g:i,i:y("revisionSystemProgress",{}),p:y("smartLearningPathProgress",{})},s={};Array.isArray(n)&&n.forEach(function(e){e&&e.date&&(s[e.date]||(s[e.date]=H(new Date(e.date+"T00:00:00Z"),h)))}),Array.isArray(i)&&i.forEach(function(e){if(e&&e.solvedDate){var a=e.solvedDate.split("T")[0];s[a]||(s[a]=H(new Date(a+"T00:00:00Z"),h))}});var p=(function(e){var a=Object.keys(e).filter(function(C){return e[C].studyMinutes>0}).sort();if(a.length===0)return{current:0,weekly:0,monthly:0,longest:0,consistency:0};var r={};a.forEach(function(C){r[C]=!0});for(var l=1,c=1,f=1;f<a.length;f++){var A=new Date(a[f-1]+"T00:00:00Z"),b=new Date(a[f]+"T00:00:00Z");Math.round((b.getTime()-A.getTime())/I)===1?c++:c=1,c>l&&(l=c)}var x=w();r[k(x)]||(x=m(x,-1));for(var _=0;r[k(x)];)_++,x=m(x,-1);for(var D=0,o=m(w(),-6);o.getTime()<=w().getTime();o=m(o,1))r[k(o)]&&D++;var E=0;for(o=m(w(),-29);o.getTime()<=w().getTime();o=m(o,1))r[k(o)]&&E++;var L=Math.round((w().getTime()-new Date(a[0]+"T00:00:00Z").getTime())/I)+1,S=L>0?Math.round(a.length/L*100):0;return{current:_,weekly:D,monthly:E,longest:l,consistency:Math.min(100,S)}})(s),g=w(),u=m(g,-370),v=(function(e,a,r){for(var l=m(a,-a.getUTCDay()),c=m(r,6-r.getUTCDay()),f=Math.round((c.getTime()-l.getTime())/I)+1,A=[],b=[],x=-1,_=[],D=0;D<f;D++){var o=m(l,D),E=o.getTime()>=a.getTime()&&o.getTime()<=r.getTime(),L=k(o),S=E&&e[L]||null,C=S?S.studyMinutes:0;b.length===0&&o.getUTCMonth()!==x&&(x=o.getUTCMonth(),_.push({weekIndex:A.length,label:R[o.getUTCMonth()]})),b.push({date:L,studyMinutes:C,metrics:S,inRange:E,dow:o.getUTCDay()}),b.length===7&&(A.push(b),b=[])}return b.length&&A.push(b),{weeks:A,monthLabels:_}})(s,u,g),d="<div class='lh-title'>📊 Learning Heatmap</div>"+(function(e){return"<div class='lh-topbar'><div class='lh-stats'><div class='lh-stat'><div class='lh-stat-value'>🔥 "+e.current+"<span class='lh-stat-unit'>d</span></div><div class='lh-stat-label'>Current streak</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.weekly+"<span class='lh-stat-unit'>/7</span></div><div class='lh-stat-label'>This week</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.monthly+"<span class='lh-stat-unit'>/30</span></div><div class='lh-stat-label'>This month</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.longest+"<span class='lh-stat-unit'>d</span></div><div class='lh-stat-label'>Longest streak</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.consistency+"<span class='lh-stat-unit'>%</span></div><div class='lh-stat-label'>Consistency</div></div></div></div>"})(p)+(function(e,a){var r="",l={};e.forEach(function(f){l[f.weekIndex]=f.label});for(var c=0;c<a;c++)r+="<span class='lh-month-label'>"+(l[c]||"")+"</span>";return"<div class='lh-months' style='grid-template-columns:repeat("+a+",13px)'>"+r+"</div>"})(v.monthLabels,v.weeks.length)+j(v.weeks)+(function(){for(var e="",a=0;a<=4;a++)e+="<span class='lh-cell lh-legend-cell' data-level='"+a+"'></span>";return"<div class='lh-legend'><span>Less</span>"+e+"<span>More</span></div>"})();T.innerHTML=d}}function P(){z()}function N(){z()}})();
