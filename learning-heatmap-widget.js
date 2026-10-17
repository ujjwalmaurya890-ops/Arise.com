(function(){if(!window.__ARISE_LEARNING_HEATMAP__){window.__ARISE_LEARNING_HEATMAP__=!0;var I="learning-heatmap-style",S=864e5,N=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],E=null,x=null;window.__mountLearningHeatmap=function(a){if(a){E=a,(function(){if(!document.getElementById(I)){var d=document.createElement("style");d.id=I,d.textContent=`
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
    `,document.head.appendChild(d)}})();var t=document.createElement("div");t.className="learning-heatmap-container",a.appendChild(t),E=t,_(),x&&clearInterval(x),x=setInterval(function(){document.hidden||_()},5e3),window.addEventListener("storage",z),window.addEventListener("focus",H),window.addEventListener("studySessions:updated",z)}},window.__unmountLearningHeatmap=function(a){x&&(clearInterval(x),x=null),window.removeEventListener("storage",z),window.removeEventListener("focus",H),window.removeEventListener("studySessions:updated",z),a&&(a.innerHTML=""),E=null}}function y(a,t){try{var d=localStorage.getItem(a);if(!d)return t;var g=JSON.parse(d);return g??t}catch{return t}}function w(a){return a.toISOString().split("T")[0]}function h(a,t){return new Date(a.getTime()+t*S)}function b(){return a=new Date,new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate()));var a}function U(a){var t=w(a),d=y("studySessions",[]),g=y("dsaQuestions",[]),i=y("revisionSystemProgress",{}),p=y("smartLearningPathProgress",{}),c=0;Array.isArray(d)&&d.forEach(function(r){r&&r.date===t&&(c+=Number(r.minutes)||0)});var f=0;p&&typeof p=="object"&&Object.keys(p).forEach(function(r){var l=p[r];l&&l.lastActionAt&&l.lastActionAt.split("T")[0]===t&&f++});var e=0;Array.isArray(g)&&g.forEach(function(r){r&&r.solved&&r.solvedDate&&r.solvedDate.split("T")[0]===t&&e++});var n,s=0;return i&&typeof i=="object"&&Object.keys(i).forEach(function(r){var l=i[r];l&&Array.isArray(l.history)&&l.history.forEach(function(m){m.split("T")[0]===t&&s++})}),{date:t,studyMinutes:c,studyHours:(n=c/60,Math.round(10*(Number(n)||0))/10),topicsCompleted:f,problemsSolved:e,revisionsDone:s,totalActivity:c+30*f+20*e+15*s}}function R(a){var t="";return a.forEach(function(d,g){d.forEach(function(i){var p,c,f=i.inRange?(p=i.studyMinutes)<=0?0:p<=30?1:p<=90?2:p<=180?3:4:-1,e=Math.min(10*g,480)+2*(i.dow||0);if(f<0)t+="<span class='lh-cell lh-cell-pad'></span>";else{var n=i.date;i.metrics?(n+=": "+i.metrics.studyHours+"h study",i.metrics.topicsCompleted>0&&(n+=", "+i.metrics.topicsCompleted+" topics"),i.metrics.problemsSolved>0&&(n+=", "+i.metrics.problemsSolved+" problems"),i.metrics.revisionsDone>0&&(n+=", "+i.metrics.revisionsDone+" revisions")):n+=": no activity",t+="<span class='lh-cell' data-level='"+f+"' style='animation-delay:"+e+"ms' title='"+(c=n,String(c??"").replace(/[&<>"']/g,function(s){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s]})+"'></span>")}})}),"<div class='lh-grid' style='grid-template-columns:repeat("+a.length+",13px);grid-template-rows:repeat(7,13px)'>"+t+"</div>"}function _(){if(E){var a=y("studySessions",[]),t={};Array.isArray(a)&&a.forEach(function(e){e&&e.date&&(t[e.date]||(t[e.date]=U(new Date(e.date+"T00:00:00Z"))))});var d=y("dsaQuestions",[]);Array.isArray(d)&&d.forEach(function(e){if(e&&e.solvedDate){var n=e.solvedDate.split("T")[0];t[n]||(t[n]=U(new Date(n+"T00:00:00Z")))}});var g=(function(e){var n=Object.keys(e).filter(function(L){return e[L].studyMinutes>0}).sort();if(n.length===0)return{current:0,weekly:0,monthly:0,longest:0,consistency:0};var s={};n.forEach(function(L){s[L]=!0});for(var r=1,l=1,m=1;m<n.length;m++){var T=new Date(n[m-1]+"T00:00:00Z"),v=new Date(n[m]+"T00:00:00Z");Math.round((v.getTime()-T.getTime())/S)===1?l++:l=1,l>r&&(r=l)}var u=b();s[w(u)]||(u=h(u,-1));for(var A=0;s[w(u)];)A++,u=h(u,-1);for(var k=0,o=h(b(),-6);o.getTime()<=b().getTime();o=h(o,1))s[w(o)]&&k++;var M=0;for(o=h(b(),-29);o.getTime()<=b().getTime();o=h(o,1))s[w(o)]&&M++;var D=Math.round((b().getTime()-new Date(n[0]+"T00:00:00Z").getTime())/S)+1,C=D>0?Math.round(n.length/D*100):0;return{current:A,weekly:k,monthly:M,longest:r,consistency:Math.min(100,C)}})(t),i=b(),p=h(i,-370),c=(function(e,n,s){for(var r=h(n,-n.getUTCDay()),l=h(s,6-s.getUTCDay()),m=Math.round((l.getTime()-r.getTime())/S)+1,T=[],v=[],u=-1,A=[],k=0;k<m;k++){var o=h(r,k),M=o.getTime()>=n.getTime()&&o.getTime()<=s.getTime(),D=w(o),C=M&&e[D]||null,L=C?C.studyMinutes:0;v.length===0&&o.getUTCMonth()!==u&&(u=o.getUTCMonth(),A.push({weekIndex:T.length,label:N[o.getUTCMonth()]})),v.push({date:D,studyMinutes:L,metrics:C,inRange:M,dow:o.getUTCDay()}),v.length===7&&(T.push(v),v=[])}return v.length&&T.push(v),{weeks:T,monthLabels:A}})(t,p,i),f="<div class='lh-title'>📊 Learning Heatmap</div>"+(function(e){return"<div class='lh-topbar'><div class='lh-stats'><div class='lh-stat'><div class='lh-stat-value'>🔥 "+e.current+"<span class='lh-stat-unit'>d</span></div><div class='lh-stat-label'>Current streak</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.weekly+"<span class='lh-stat-unit'>/7</span></div><div class='lh-stat-label'>This week</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.monthly+"<span class='lh-stat-unit'>/30</span></div><div class='lh-stat-label'>This month</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.longest+"<span class='lh-stat-unit'>d</span></div><div class='lh-stat-label'>Longest streak</div></div><div class='lh-stat'><div class='lh-stat-value'>"+e.consistency+"<span class='lh-stat-unit'>%</span></div><div class='lh-stat-label'>Consistency</div></div></div></div>"})(g)+(function(e,n){var s="",r={};e.forEach(function(m){r[m.weekIndex]=m.label});for(var l=0;l<n;l++)s+="<span class='lh-month-label'>"+(r[l]||"")+"</span>";return"<div class='lh-months' style='grid-template-columns:repeat("+n+",13px)'>"+s+"</div>"})(c.monthLabels,c.weeks.length)+R(c.weeks)+(function(){for(var e="",n=0;n<=4;n++)e+="<span class='lh-cell lh-legend-cell' data-level='"+n+"'></span>";return"<div class='lh-legend'><span>Less</span>"+e+"<span>More</span></div>"})();E.innerHTML=f}}function z(){_()}function H(){_()}})();
