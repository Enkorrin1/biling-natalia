const app = document.querySelector('#app');
const state = { user: null, profile: null, tickets: [], chats: [], queue: [], staff: [], customers: [], organizations: [], notifications: [], current: null, currentChat: null, view: 'tickets', filter: 'all', search: '', authMode: 'login', error: '', internalNotes: [], cannedResponses: [], analytics: null, kbCategories: [], kbArticles: [], kbActiveCategory: null, kbSearch: '', kbReadingArticle: null, kbEditingArticle: null, gitLinks: [], webhooks: [], billing: null, billingTab: 'docs', billingFilter: 'all', billingModal: null };
const statusNames = { new: 'Новая', working: 'В работе', waiting: 'Ожидает заказчика', done: 'Выполнена', closed: 'Закрыта' };
const estimateNames = {pending:'Ожидает решения',approved:'Одобрена',rejected:'Отклонена',revision_requested:'Запрошена корректировка'};
const serviceNames = {development:'Доработка',integration:'Интеграция',support:'Поддержка',consultation:'Консультация',other:'Другое'};
const serviceHints = {development:'Что нужно изменить? Как должен выглядеть готовый результат? Где это работает сейчас?',integration:'Какие системы нужно связать? Какие данные передавать и в каком направлении? Есть ли документация API?',support:'Что не работает? Когда возникла проблема? Какие действия её повторяют?',consultation:'По какому вопросу нужна помощь? Какое решение вы хотите принять?',other:'Что нужно сделать? Какой результат вы ожидаете?'};
const hours = minutes => `${(minutes/60).toLocaleString('ru-RU',{maximumFractionDigits:2})} ч`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avatar = (person, extra='') => `<span class="person-avatar ${extra}">${person?.avatar_url?`<img src="${esc(person.avatar_url)}" alt="">`:esc((person?.name||'?').trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase())}</span>`;
const date = value => new Date(value).toLocaleString('ru-RU', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});

let audioCtx = null;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.08, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);
  } catch (e) {}
}

function showBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/icon.svg' });
    } catch (e) {}
  }
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h} ч ${m} м` : `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} д ${h % 24} ч`;
}

function ticketSlaBadges(t) {
  const badges = [];
  const now = Date.now();
  if (!t.first_staff_response_at && t.response_due_at) {
    const diff = new Date(t.response_due_at).getTime() - now;
    if (diff < 0) {
      badges.push(`<span class="sla-pill sla-overdue" title="Срок ответа: ${date(t.response_due_at)}">Ответ: -${formatDuration(Math.abs(diff))}</span>`);
    } else {
      const cls = diff < 2 * 3600 * 1000 ? 'sla-urgent' : 'sla-ontrack';
      badges.push(`<span class="sla-pill ${cls}" title="Срок ответа: ${date(t.response_due_at)}">Ответ: ${formatDuration(diff)}</span>`);
    }
  }
  if (!t.effort_minutes && t.estimate_due_at) {
    const diff = new Date(t.estimate_due_at).getTime() - now;
    if (diff < 0) {
      badges.push(`<span class="sla-pill sla-overdue" title="Срок оценки: ${date(t.estimate_due_at)}">Оценка: -${formatDuration(Math.abs(diff))}</span>`);
    } else {
      const cls = diff < 4 * 3600 * 1000 ? 'sla-urgent' : 'sla-ontrack';
      badges.push(`<span class="sla-pill ${cls}" title="Срок оценки: ${date(t.estimate_due_at)}">Оценка: ${formatDuration(diff)}</span>`);
    }
  }
  if (t.delivery_due_at && t.status !== 'done' && t.status !== 'closed') {
    const diff = new Date(t.delivery_due_at).getTime() - now;
    if (diff < 0) {
      badges.push(`<span class="sla-pill sla-overdue" title="Срок сдачи: ${date(t.delivery_due_at)}">Сдача: -${formatDuration(Math.abs(diff))}</span>`);
    } else {
      const cls = diff < 24 * 3600 * 1000 ? 'sla-urgent' : 'sla-ontrack';
      badges.push(`<span class="sla-pill ${cls}" title="Срок сдачи: ${date(t.delivery_due_at)}">Сдача: ${formatDuration(diff)}</span>`);
    }
  }
  return badges.join(' ');
}

let eventSource = null;
function initRealtime() {
  if (eventSource) {
    try { eventSource.close(); } catch(e) {}
    eventSource = null;
  }
  if (!state.user) return;
  try {
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('update', async (e) => {
      try {
        const data = JSON.parse(e.data);
        playNotificationSound();
        if (data.type === 'notification') {
          showBrowserNotification('Codari · Новое уведомление', data.text);
          await loadNotifications();
        } else if (data.type === 'ticket_message') {
          if (state.view === 'detail' && state.current && state.current.ticket.id === data.ticket_id) {
            const textarea = document.querySelector('#message-form textarea');
            if (!textarea || !textarea.value) {
              await openTicket(data.ticket_id);
            }
          }
          await loadNotifications();
        } else if (data.type === 'chat_message') {
          if (state.view === 'chat' && state.currentChat && state.currentChat.chat.id === data.chat_id) {
            const textarea = document.querySelector('#chat-message-form textarea');
            if (!textarea || !textarea.value) {
              const fresh = await api(`/chats/${data.chat_id}`);
              state.currentChat = fresh;
              renderChatDetail();
            }
          }
          await loadNotifications();
        } else if (data.type === 'internal_note') {
          if (state.view === 'detail' && state.current && state.current.ticket.id === data.ticket_id) {
            await loadInternalNotes(data.ticket_id);
          }
        } else if (data.type === 'ticket_rated') {
          if (state.view === 'detail' && state.current && state.current.ticket.id === data.ticket_id) {
            await openTicket(data.ticket_id);
          }
        } else if (data.type === 'git_link_added') {
          if (state.view === 'detail' && state.current && state.current.ticket.id === data.ticket_id) {
            await loadGitLinks(data.ticket_id);
          }
        }
      } catch (err) {}
    });
  } catch (e) {}
}
async function api(path, options={}) {
  const response = await fetch('/api' + path, {headers:{'Content-Type':'application/json'}, ...options});
  if (!response.ok) { const data = await response.json().catch(()=>({})); throw new Error(typeof data.detail === 'string' ? data.detail : `Ошибка ${response.status}`); }
  return response.json();
}
function notice() { return state.error ? `<div class="notice" role="alert">${esc(state.error)}</div>` : ''; }
async function upload(path, file, extra={}) {
  const body=new FormData();body.append('file',file);Object.entries(extra).forEach(([key,value])=>body.append(key,value));
  const response=await fetch('/api'+path,{method:'POST',body});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:`Ошибка ${response.status}`);}
  return response.json();
}
function showError(error) { state.error = error.message || String(error); render(); }
function setView(view) { state.view=view; state.error=''; render(); }
async function loadNotifications() {
  if (!state.user) return;
  const incoming = [
    ...(await api('/notifications')).map(n=>({...n,target:'ticket'})),
    ...(await api('/chat-notifications')).map(n=>({...n,target:'chat'})),
  ].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const changed = JSON.stringify(incoming) !== JSON.stringify(state.notifications);
  state.notifications = incoming;
  const unread = state.notifications.filter(n=>!n.read_at).length;
  const count = document.querySelector('#notification-count');
  if (count) count.textContent = unread ? String(unread) : '';
  if (changed && state.view === 'notifications') renderNotifications();
}
async function refresh() {
  state.tickets = await api('/tickets');
  state.chats = await api('/chats');
  state.organizations = await api('/organizations');
  state.profile=await api(state.user.role==='customer'?'/customer-profile/me':'/profile/me');
  state.user.name=state.profile.name;
  if (state.user.role !== 'customer') {state.staff = await api('/staff');state.customers = await api('/customers');state.queue = await api('/work-queue');}
  state.notifications = [
    ...(await api('/notifications')).map(n=>({...n,target:'ticket'})),
    ...(await api('/chat-notifications')).map(n=>({...n,target:'chat'})),
  ].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  render();
}
function renderAuth() {
  const registration = state.authMode === 'register';
  app.innerHTML = `<div class="auth"><div class="panel auth-card"><div class="brand auth-brand"><span class="brand-mark" aria-hidden="true">C</span><span>Codari<span class="brand-dot">.</span></span></div><h1>${registration?'Создать кабинет':'Войти в кабинет'}</h1><div class="muted">Заявки и общение с командой в одном месте</div>${notice()}<form class="form" id="auth-form">${registration?'<label>Ваше имя<input class="field" name="name" required minlength="2" maxlength="100" autocomplete="name"></label>':''}<label>Email<input class="field" name="email" type="email" required autocomplete="email"></label><label>Пароль<input class="field" name="password" type="password" required minlength="8" autocomplete="${registration?'new-password':'current-password'}"></label><button class="button primary">${registration?'Зарегистрироваться':'Войти'}</button></form><button class="auth-switch" id="auth-switch">${registration?'Уже есть кабинет? Войти':'Нет кабинета? Зарегистрироваться'}</button></div></div>`;
  document.querySelector('#auth-switch').onclick=()=>{state.authMode=registration?'login':'register';state.error='';renderAuth();};
  document.querySelector('#auth-form').onsubmit=async e=>{e.preventDefault(); const button=e.target.querySelector('button');button.disabled=true;const data=Object.fromEntries(new FormData(e.target));try{state.user=await api(registration?'/register':'/login',{method:'POST',body:JSON.stringify(data)});state.view=state.user.role==='customer'?'tickets':'queue';state.error='';await refresh();await openHash();}catch(error){showError(error);}};
}
function shell(title, action, body) {
  const staff=state.user.role!=='customer';
  app.innerHTML=`<div class="shell"><aside><div class="brand"><span class="brand-mark" aria-hidden="true">C</span><span>Codari<span class="brand-dot">.</span></span></div><nav class="nav"><button class="${state.view==='tickets'||state.view==='detail'?'active':''}" id="nav-tickets">Заявки</button>${staff&&state.user.role==='admin'?'<button class="'+(state.view==='team'?'active':'')+'" id="nav-team">Команда</button>':''}</nav><div class="aside-bottom"><div class="aside-user">${avatar(state.profile)}<div class="aside-user-meta"><strong>${esc(state.user.name)}</strong><small>${esc(staff?(state.profile?.job_title||'Сотрудник'):(state.organizations[0]?.name||state.profile?.company_name||'Заказчик'))}</small></div></div><button id="logout" class="aside-logout">Выйти</button></div></aside><main><div class="top"><div><div class="eyebrow">${staff?'Рабочее место':'Личный кабинет'}</div><h1>${esc(title)}</h1></div>${action||''}</div>${notice()}${body}</main></div>`;
  const viewKey=`${state.view}:${title}`;
  if(shell.lastViewKey!==viewKey){shell.lastViewKey=viewKey;app.querySelector('.shell').classList.add('view-enter');}
  const unread = state.notifications.filter(n=>!n.read_at).length;
  if(staff) document.querySelector('#nav-tickets').insertAdjacentHTML('beforebegin',`<button class="${state.view==='queue'?'active':''}" id="nav-queue">Дашборд</button>`);
  document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='chats'||state.view==='chat'?'active':''}" id="nav-chats">Общий чат</button>`);
  document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='notifications'?'active':''}" id="nav-notifications">Уведомления <span class="nav-count" id="notification-count">${unread||''}</span></button>`);
  document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='profile'?'active':''}" id="nav-profile">Мой профиль</button>`);
  if((staff&&(state.user.role==='admin'||state.user.is_manager))||(!staff&&state.organizations.length)) document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='organizations'?'active':''}" id="nav-organizations">${staff?'Компании':'Моя компания'}</button>`);
  if(staff&&(state.user.role==='admin'||state.user.is_manager)) {
    document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='analytics'?'active':''}" id="nav-analytics">Аналитика</button>`);
    document.querySelector('#nav-analytics')?.addEventListener('click',()=>openAnalytics());
  }
  document.querySelector('#nav-tickets').onclick=()=>setView('tickets');
  document.querySelector('#nav-queue')?.addEventListener('click',()=>setView('queue'));
  document.querySelector('#nav-team')?.addEventListener('click',()=>setView('team'));
  document.querySelector('#nav-chats').onclick=async()=>{
    if(state.user.role==='customer'){
      try{const chat=await api('/chats',{method:'POST'});await refresh();await openChat(chat.id);}catch(error){showError(error);}
    }else setView('chats');
  };
  document.querySelector('#nav-notifications').onclick=()=>setView('notifications');
  document.querySelector('#nav-profile')?.addEventListener('click',()=>setView('profile'));
  document.querySelector('#nav-organizations')?.addEventListener('click',()=>setView('organizations'));
  document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='kb'?'active':''}" id="nav-kb">База знаний</button>`);
  document.querySelector('#nav-kb')?.addEventListener('click',()=>openKb());
  document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='billing'?'active':''}" id="nav-billing">Биллинг и счета</button>`);
  document.querySelector('#nav-billing')?.addEventListener('click',()=>openBilling());
  if(staff&&state.user.role==='admin') {
    document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='webhooks'?'active':''}" id="nav-webhooks">Вебхуки</button>`);
    document.querySelector('#nav-webhooks')?.addEventListener('click',()=>openWebhooks());
  }
  document.querySelector('.nav').insertAdjacentHTML('beforeend',`<button class="${state.view==='messengers'?'active':''}" id="nav-messengers">Мессенджеры</button>`);
  document.querySelector('#nav-messengers').onclick=()=>openMessengers();
  const navPaths = {
    queue:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    tickets:'M9 11l3 3L22 4 M21 12v8H3V4h12',
    chats:'M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z',
    notifications:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    profile:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3',
    organizations:'M4 21V3h12v18 M16 9h4v12 M8 7h4 M8 11h4 M8 15h4 M2 21h20',
    team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 8',
    analytics:'M3 3v18h18 M7 14v3 M12 9v8 M17 5v12',
    kb:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16',
    billing:'M6 2h12v20l-3-2-3 2-3-2-3 2z M15 7h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9 M12 5v12',
    webhooks:'M8 8l-5 4 5 4 M16 8l5 4-5 4 M14 4l-4 16',
    messengers:'M22 2 9 15 M22 2l-8 20-5-7-7-5z'
  };
  document.querySelectorAll('.nav button').forEach(button=>{
    const path=navPaths[button.id.replace('nav-','')];
    if(path) button.insertAdjacentHTML('afterbegin',`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`);
  });
  document.querySelector('#logout').onclick=async()=>{await api('/logout',{method:'POST'});state.user=null;state.current=null;state.bots=null;state.pairings={};state.pendingOps={};state.error='';renderAuth();};
}
function recentActivity() {
  const items=state.notifications.slice(0,3).map(n=>`<div class="activity-item"><span class="activity-dot ${n.read_at?'':'fresh'}"></span><div><strong>${esc(n.text)}</strong><small>${date(n.created_at)}</small></div></div>`).join('');
  return `<section class="activity-panel"><div class="activity-heading"><h2>Последние события</h2><span>${state.notifications.length}</span></div>${items||'<p class="muted">Новых событий пока нет.</p>'}</section>`;
}
function portfolioOverview() { return queueOverview(); }
function queueOverview() {
  const cards=[
    {label:'Активные заявки',value:state.tickets.filter(t=>!['done','closed'].includes(t.status)).length,hint:state.user.role==='customer'?`В работе: ${state.tickets.filter(t=>t.status==='working').length}`:`${state.queue.filter(item=>item.priority<=1).length} требуют внимания`,tone:'blue',path:'M8 6V3h8v3 M3 6h18v15H3z M8 6v15 M16 6v15'},
    {label:'Согласовано часов',value:hours(state.tickets.filter(t=>t.estimate_state==='approved').reduce((sum,t)=>sum+(t.effort_minutes||0),0)),hint:'По одобренным оценкам',tone:'violet',path:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2'},
    {label:'Ожидают согласования',value:state.tickets.filter(t=>t.estimate_state==='pending').length,hint:'Оценки отправлены заказчикам',tone:'green',path:'M14 2H5v20h14V7z M14 2v5h5 M8 12h8 M8 16h8'}
  ];
  return `<section class="codari-stats" aria-label="Сводка рабочей очереди">${cards.map(card=>`<div class="codari-stat"><span class="stat-icon ${card.tone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${card.path}"/></svg></span><span class="overview-kicker">${card.label}</span><strong>${card.value}</strong><small>${card.hint}</small></div>`).join('')}</section>`;
}
function workloadPanel(){
  const people=state.staff.filter(person=>person.role!=='admin'||state.queue.some(item=>item.assignee_id===person.id));
  const rows=people.map(person=>{const assigned=state.queue.filter(item=>item.source==='ticket'&&item.assignee_id===person.id);const urgent=assigned.filter(item=>item.priority<=1).length;return `<div class="workload-person"><span>${avatar(person)}<strong>${esc(person.name)}</strong></span><span><b>${assigned.length}</b> заявок${urgent?` · <b class="workload-urgent">${urgent} срочно</b>`:''}</span></div>`;}).join('');
  const overdue=state.queue.filter(item=>item.overdue).length;
  return `<section class="activity-panel"><div class="activity-heading"><h2>Нагрузка команды</h2><span>${overdue?`${overdue} просрочено`:state.queue.filter(item=>item.source==='ticket').length+' заявок'}</span></div>${rows||'<p class="muted">Нет назначенных заявок.</p>'}</section>`;
}
function renderTickets() {
  const staff=state.user.role!=='customer';
  const dispatcher=state.user.role==='admin'||state.user.is_manager;
  const visible=state.tickets.filter(t=>state.filter==='all'||(state.filter==='mine'&&t.assignee_id===state.user.id)||(state.filter==='unassigned'&&!t.assignee_id)||t.status===state.filter);
  const ticketRow=t=>{
    const sla=ticketSlaBadges(t);
    return `<button class="ticket-row" data-ticket="${t.id}"><span><strong>№${t.id} · ${esc(t.title)}</strong><small>${esc(t.next_step||t.customer_name)} · ${date(t.updated_at)} ${sla?`· ${sla}`:''}</small></span><span class="badge ${esc(t.status)}">${statusNames[t.status]}</span><span class="muted hide-mobile">${esc(t.assignee_name||'Без ответственного')}</span><span class="muted hide-mobile">${date(t.created_at)}</span></button>`;
  };
  const focusCard=t=>t?`<section class="focus-panel"><span class="focus-overline">${staff?'Актуальная заявка':'Ваше обращение'} · №${t.id}</span><h2>${esc(t.title)}</h2><p>${esc(t.next_step||statusNames[t.status])}</p><div class="focus-facts"><div><span>Статус</span><strong>${statusNames[t.status]}</strong></div><div><span>Ответственный</span><strong>${esc(t.assignee_name||'Назначается')}</strong></div></div><button class="focus-link" id="focus-ticket">Открыть заявку <span aria-hidden="true">↗</span></button></section>`:'';
  shell('Заявки','<button class="button primary" id="new-ticket">+ Новая заявка</button>',`${portfolioOverview()}<div class="workspace-grid"><div class="panel"><div class="toolbar ticket-toolbar"><strong>${staff?(dispatcher?'Очередь заявок':'Мои заявки'):'Мои обращения'} <span class="ticket-count" id="ticket-count"></span></strong><div class="ticket-tools"><input class="field ticket-search" id="ticket-search" type="search" maxlength="100" aria-label="Поиск по заявкам" placeholder="Поиск по заявкам" value="${esc(state.search)}"><select id="filter" aria-label="Фильтр заявок"><option value="all">Все заявки</option>${staff?'<option value="mine">Мои заявки</option>':''}${dispatcher?'<option value="unassigned">Без ответственного</option>':''}${Object.entries(statusNames).map(([key,value])=>`<option value="${key}">${value}</option>`).join('')}</select></div></div><div id="ticket-list"></div></div><div class="context-stack"><div id="ticket-focus"></div>${recentActivity()}</div></div>`);
  const updateList=()=>{
    const query=state.search.trim().toLocaleLowerCase('ru-RU');
    const matches=query?visible.filter(t=>[t.id,t.title,t.description,t.customer_name,t.customer_company,t.assignee_name,statusNames[t.status]].some(value=>String(value||'').toLocaleLowerCase('ru-RU').includes(query))):visible;
    document.querySelector('#ticket-count').textContent=`${matches.length}`;
    document.querySelector('#ticket-list').innerHTML=matches.map(ticketRow).join('')||(query?'<div class="empty"><strong>Ничего не найдено</strong>Попробуйте другой запрос или фильтр.</div>':'<div class="empty"><strong>Заявок пока нет</strong>Создайте новую заявку или выберите другой фильтр.</div>');
    const focus=matches.find(t=>!['done','closed'].includes(t.status))||matches[0];
    document.querySelector('#ticket-focus').innerHTML=focusCard(focus);
    document.querySelector('#ticket-focus').hidden=!focus;
    document.querySelector('#focus-ticket')?.addEventListener('click',()=>openTicket(focus.id));
    document.querySelectorAll('#ticket-list [data-ticket]').forEach(el=>el.onclick=()=>openTicket(Number(el.dataset.ticket)));
  };
  document.querySelector('#filter').value=state.filter;
  document.querySelector('#filter').onchange=e=>{state.filter=e.target.value;renderTickets();};
  document.querySelector('#ticket-search').oninput=e=>{state.search=e.target.value;updateList();};
  updateList();
  document.querySelectorAll('[data-overview-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.overviewFilter;renderTickets();});
  document.querySelector('#new-ticket')?.addEventListener('click',()=>setView('new'));
}
function renderQueue() {
  const needs=state.queue.filter(item=>item.priority<3).length;
  const rows=state.queue.map(item=>`<button class="ticket-row queue-row" data-source="${item.source}" data-record="${item.id}"><span><strong>${item.source==='chat'?'Чат':'№'+item.id+' · '+esc(item.title)}</strong><small>${esc(item.customer_name)} · ${date(item.updated_at)}</small></span><span class="queue-action ${item.priority<3?'actionable':''}">${esc(item.next_action)}</span><span class="muted hide-mobile">${esc(item.assignee_name||'Без ответственного')}</span></button>`).join('');
  const focus=state.queue[0];
  const focusCard=focus?`<section class="focus-panel"><span class="focus-overline">СЛЕДУЮЩЕЕ ДЕЙСТВИЕ · ${focus.source==='chat'?'Общий чат':'ЗАЯВКА №'+focus.id}</span><h2>${esc(focus.source==='chat'?focus.customer_name:focus.title)}</h2><p>${esc(focus.next_action)}</p><div class="focus-facts"><div><span>Заказчик</span><strong>${esc(focus.customer_name)}</strong></div><div><span>Ответственный</span><strong>${esc(focus.assignee_name||'Не назначен')}</strong></div></div><button class="focus-link" id="focus-queue">Открыть ${focus.source==='chat'?'чат':'заявку'} <span aria-hidden="true">↗</span></button></section>`:'';
  shell('Дашборд','<button class="button primary" id="new-ticket">+ Новая заявка</button>',`${queueOverview()}<div class="workspace-grid"><div class="panel"><div class="toolbar"><strong>Заявки и общие чаты</strong><span class="muted">${needs?`Требуют внимания: ${needs}`:'Сначала срочные действия'}</span></div>${rows||'<div class="empty"><strong>Очередь пуста</strong>Новых обращений пока нет.</div>'}</div><div class="context-stack">${focusCard}${workloadPanel()}${recentActivity()}</div></div>`);
  document.querySelector('#new-ticket').onclick=()=>setView('new');
  document.querySelector('#focus-queue')?.addEventListener('click',()=>focus.source==='chat'?openChat(focus.id):openTicket(focus.id));
  document.querySelectorAll('.queue-row').forEach(el=>el.onclick=()=>el.dataset.source==='chat'?openChat(Number(el.dataset.record)):openTicket(Number(el.dataset.record)));
}
function renderNotifications() {
  const rows=state.notifications.map(n=>`<button class="ticket-row notification-row ${n.read_at?'':'unread'}" data-notice="${n.id}" data-target="${n.target}" data-record="${n.target==='chat'?n.chat_id:n.ticket_id}"><span><strong>${esc(n.text)}</strong><small>${n.target==='chat'?'Общий чат':'Заявка №'+n.ticket_id} · ${date(n.created_at)}</small></span><span class="muted">${n.read_at?'Прочитано':'Новое'}</span></button>`).join('');
  shell('Уведомления','',`<div class="panel">${rows||'<div class="empty"><strong>Уведомлений пока нет</strong>Здесь появятся события по вашим заявкам.</div>'}</div>`);
  document.querySelectorAll('[data-notice]').forEach(el=>el.onclick=async()=>{try{await api(`/${el.dataset.target==='chat'?'chat-notifications':'notifications'}/${el.dataset.notice}/read`,{method:'POST'});await refresh();if(el.dataset.target==='chat')await openChat(Number(el.dataset.record));else await openTicket(Number(el.dataset.record));}catch(error){showError(error);}});
}
function renderNew() {
  const staff=state.user.role!=='customer';
  const dispatcher=state.user.role==='admin'||state.user.is_manager;
  const customerField=staff?`<label>Заказчик<select class="field" name="customer_id" required><option value="">Выберите заказчика</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></label>`:'';
  const assigneeField=dispatcher?`<label>Ответственный<select class="field" name="assignee_id"><option value="">Назначить позже</option>${state.staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`:staff?'<p class="muted">Вы будете назначены ответственным за эту заявку.</p>':'';
  const help=staff?['Выберите заказчика, которому нужна помощь.','Опишите задачу его словами — он увидит текст в своём кабинете.','После создания заказчик получит уведомление.']:['Коротко назовите задачу, чтобы её было легко найти.','Напишите, какой результат нужен и какие детали важны.','Команда оценит трудозатраты в часах; решение останется за вами.'];
  shell('Новая заявка','',`<button class="back" id="back">← К заявкам</button><div class="form-layout"><div class="panel content"><h2>${staff?'Создать заявку для заказчика':'Опишите задачу'}</h2>${staff&&!state.customers.length?'<div class="notice">Нет доступных заказчиков. Менеджер или администратор может создать заявку для любого зарегистрированного заказчика.</div>':''}<form class="form" id="ticket-form">${customerField}<label>Тема<input class="field" name="title" required minlength="3" maxlength="140" placeholder="Коротко о задаче"></label><div id="kb-suggest-box" class="kb-suggest-box" style="display:none"></div><label>Описание<textarea name="description" required minlength="5" maxlength="10000" placeholder="Что нужно сделать? Укажите важные детали."></textarea></label>${assigneeField}<button class="button primary" ${staff&&!state.customers.length?'disabled':''}>Создать заявку</button></form></div><div class="form-help"><span>ПОДСКАЗКА</span><h2>Чтобы быстрее начать</h2>${help.map((item,index)=>`<div class="help-step"><b>${String(index+1).padStart(2,'0')}</b><p>${item}</p></div>`).join('')}</div></div>`);
  document.querySelector('#ticket-form [name="title"]').parentElement.insertAdjacentHTML('beforebegin',`<label>Тип задачи<select class="field" name="service_type">${Object.entries(serviceNames).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>`);
  document.querySelector('#ticket-form [name="service_type"]').onchange=e=>{document.querySelector('#ticket-form [name="description"]').placeholder=serviceHints[e.target.value];document.querySelector('.form-help h2').textContent=serviceNames[e.target.value];};
  document.querySelector('#ticket-form [name="service_type"]').dispatchEvent(new Event('change'));
  const titleInput = document.querySelector('#ticket-form [name="title"]');
  const suggestBox = document.querySelector('#kb-suggest-box');
  let suggestTimer = null;
  titleInput?.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = titleInput.value.trim();
    if (q.length < 3) {
      if (suggestBox) { suggestBox.style.display = 'none'; suggestBox.innerHTML = ''; }
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        const list = await api(`/kb/suggest?q=${encodeURIComponent(q)}`);
        if (!list || !list.length) {
          if (suggestBox) { suggestBox.style.display = 'none'; suggestBox.innerHTML = ''; }
          return;
        }
        if (suggestBox) {
          suggestBox.innerHTML = `
            <div class="kb-suggest-header">
              <span>💡 Возможно, ответ уже есть в базе знаний:</span>
            </div>
            <div class="kb-suggest-list">
              ${list.map(s => `
                <button type="button" class="kb-suggest-item" data-suggest-id="${s.id}">
                  <strong>${esc(s.title)}</strong>
                  <small>${esc(s.category_name)} · ${esc(s.snippet)}</small>
                </button>
              `).join('')}
            </div>
          `;
          suggestBox.style.display = 'block';
          suggestBox.querySelectorAll('[data-suggest-id]').forEach(btn => {
            btn.onclick = async () => {
              await readKbArticle(Number(btn.dataset.suggestId));
            };
          });
        }
      } catch (e) {
        if (suggestBox) suggestBox.style.display = 'none';
      }
    }, 250);
  });
  document.querySelector('#ticket-form button').insertAdjacentHTML('beforebegin',`<label id="visibility-field" ${!staff&&!state.organizations.length?'hidden':''}>Кому видна заявка<select class="field" name="visibility"><option value="organization">Всей компании</option><option value="private">Только автору</option></select></label><label>Файлы к заявке<input class="field" name="files" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.zip"><small>До 10 МБ на файл. Можно приложить после создания.</small></label>`);
  if(!staff&&state.organizations[0]?.members.some(m=>m.user_id===state.user.id&&m.role==='viewer')){document.querySelector('#visibility-field').hidden=true;document.querySelector('#visibility-field select').value='private';}
  if(staff)document.querySelector('#ticket-form [name="customer_id"]').onchange=e=>{const member=state.organizations.some(o=>o.members.some(m=>m.user_id===Number(e.target.value)));document.querySelector('#visibility-field').hidden=!member;document.querySelector('#visibility-field select').value=member?'organization':'private';};
  document.querySelector('#back').onclick=()=>setView('tickets');
  document.querySelector('#ticket-form').onsubmit=async e=>{e.preventDefault();const files=[...e.target.elements.files.files];const data=Object.fromEntries(new FormData(e.target));delete data.files;if(document.querySelector('#visibility-field').hidden)data.visibility='private';if(staff){data.customer_id=Number(data.customer_id);if(dispatcher)data.assignee_id=data.assignee_id?Number(data.assignee_id):null;}e.target.querySelector('button').disabled=true;try{const ticket=await api('/tickets',{method:'POST',body:JSON.stringify(data)});const failed=[];for(const file of files){try{await upload(`/tickets/${ticket.id}/attachments`,file);}catch(error){failed.push(file.name);}}await refresh();await openTicket(ticket.id);if(failed.length){state.error=`Заявка создана, но файлы не загрузились: ${failed.join(', ')}. Прикрепите их в карточке.`;render();}}catch(error){showError(error);}};
}
async function openTicket(id) {try{state.current=await api(`/tickets/${id}`);state.current.assignee_profile=state.current.ticket.assignee_id?await api(`/staff/${state.current.ticket.assignee_id}/profile`).catch(()=>null):null;state.gitLinks=await api(`/tickets/${id}/git-links`).catch(()=>[]);state.view='detail';state.error='';render();}catch(error){showError(error);}}
function ticketProgress(ticket, estimates) {
  const estimate=estimates[0];
  const step=['done','closed'].includes(ticket.status)?4:['working','waiting'].includes(ticket.status)?3:estimate?.state==='approved'?2:estimate?1:0;
  const steps=['Создана','Оценка','Согласовано','В работе','Готово'];
  return `<section class="ticket-progress" aria-label="Этапы заявки"><div class="ticket-progress-top"><span class="overview-kicker">Ход заявки</span><strong class="ticket-progress-status">${steps[step]}</strong></div><ol>${steps.map((label,index)=>`<li class="${index<step?'passed':index===step?'current':''}" ${index===step?'aria-current="step"':''}><span class="step-dot">${index<step?'✓':index+1}</span><span class="step-label">${label}</span></li>`).join('')}</ol></section>`;
}
function renderCsat(t, staff) {
  if (!['done', 'closed'].includes(t.status)) return '';
  if (!staff) {
    if (t.rating) {
      return `<div class="csat-box"><div class="csat-title">Ваша оценка работы</div><div class="csat-stars">${[1,2,3,4,5].map(s=>`<span class="csat-star active">${s<=t.rating?'★':'☆'}</span>`).join('')}</div>${t.rating_comment?`<p style="margin:6px 0;font-size:13px">«${esc(t.rating_comment)}»</p>`:''}<div class="csat-result">✓ Спасибо за вашу оценку!</div></div>`;
    }
    return `<div class="csat-box" id="csat-form-wrap"><div class="csat-title">Оцените качество решения задачи</div><div class="csat-subtitle">Поставьте оценку от 1 до 5 звёзд</div><div class="csat-stars" id="csat-star-picker">${[1,2,3,4,5].map(s=>`<span class="csat-star" data-val="${s}">★</span>`).join('')}</div><textarea class="csat-comment" id="csat-comment" placeholder="Что вам понравилось или что улучшить? (необязательно)" maxlength="2000"></textarea><div><button class="button primary" id="csat-submit" disabled>Отправить оценку</button></div></div>`;
  }
  if (t.rating) {
    return `<section class="panel content" style="margin-top:18px"><div class="row"><h2>Оценка заказчика</h2><span class="csat-result">★ ${t.rating} из 5</span></div>${t.rating_comment?`<p style="margin:8px 0 4px;font-size:13.5px">«${esc(t.rating_comment)}»</p>`:''}<small class="muted">Оценено ${date(t.rated_at)}</small></section>`;
  }
  return '';
}

function attachCsatHandlers(t) {
  let selectedStar = 0;
  const picker = document.querySelector('#csat-star-picker');
  if (!picker) return;
  const stars = picker.querySelectorAll('.csat-star');
  stars.forEach(star => {
    star.onmouseenter = () => {
      const val = Number(star.dataset.val);
      stars.forEach(s => s.classList.toggle('active', Number(s.dataset.val) <= val));
    };
    star.onclick = () => {
      selectedStar = Number(star.dataset.val);
      document.querySelector('#csat-submit').disabled = false;
      stars.forEach(s => s.classList.toggle('active', Number(s.dataset.val) <= selectedStar));
    };
  });
  picker.onmouseleave = () => {
    stars.forEach(s => s.classList.toggle('active', Number(s.dataset.val) <= selectedStar));
  };
  document.querySelector('#csat-submit')?.addEventListener('click', async () => {
    if (!selectedStar) return;
    const comment = document.querySelector('#csat-comment')?.value || '';
    document.querySelector('#csat-submit').disabled = true;
    try {
      await api(`/tickets/${t.id}/rate`, {
        method: 'POST',
        body: JSON.stringify({ rating: selectedStar, comment })
      });
      await refresh();
      await openTicket(t.id);
    } catch(err) {
      showError(err);
    }
  });
}

async function loadInternalNotes(ticketId) {
  if (state.user.role === 'customer') return;
  try {
    state.internalNotes = await api(`/tickets/${ticketId}/internal-notes`);
    renderInternalNotes(ticketId);
  } catch(e) {}
}

function renderInternalNotes(ticketId) {
  const container = document.querySelector('#internal-notes-container');
  if (!container) return;
  const notes = state.internalNotes || [];
  container.innerHTML = `
    <section class="internal-notes-panel">
      <div class="internal-notes-header">
        <div class="internal-notes-title">
          <span>🔒 Заметки команды</span>
          <span class="internal-notes-badge">${notes.length}</span>
        </div>
        <small class="muted">Видны только сотрудникам</small>
      </div>
      <div class="internal-notes-notice">
        <span>🛡️ Закрытый служебный блок: заказчик не видит эту переписку.</span>
      </div>
      <div class="internal-notes-list">
        ${notes.map(n => `
          <div class="internal-note-item">
            <div class="internal-note-meta">
              <strong>${esc(n.author_name)} (${n.author_role === 'admin' ? 'Администратор' : 'Сотрудник'})</strong>
              <span>${date(n.created_at)}</span>
            </div>
            <div>${esc(n.body)}</div>
          </div>
        `).join('') || '<div class="muted" style="font-size:12.5px;padding:4px 0">Заметок пока нет. Зафиксируйте технические детали, пароли или ход задачи.</div>'}
      </div>
      <form class="internal-note-form" id="internal-note-form">
        <textarea name="body" required placeholder="Добавить внутреннюю заметку..." maxlength="5000"></textarea>
        <button class="button">Записать</button>
      </form>
    </section>
  `;
  container.querySelector('#internal-note-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = new FormData(e.target).get('body');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api(`/tickets/${ticketId}/internal-notes`, {
        method: 'POST',
        body: JSON.stringify({ body })
      });
      await loadInternalNotes(ticketId);
    } catch(err) {
      showError(err);
    }
  });
}

async function renderCannedTrigger() {
  const composer = document.querySelector('#message-form');
  if (!composer) return;
  if (!state.cannedResponses.length) {
    try {
      state.cannedResponses = await api('/canned-responses');
    } catch(e) {}
  }
  const buttonWrap = document.createElement('div');
  buttonWrap.className = 'canned-wrap';
  buttonWrap.innerHTML = `
    <button type="button" class="button canned-btn" id="canned-toggle">Быстрые ответы ⚡</button>
    <div class="canned-menu" id="canned-menu" hidden>
      ${renderCannedMenuItems()}
    </div>
  `;
  composer.querySelector('button')?.insertAdjacentElement('beforebegin', buttonWrap);
  const toggle = buttonWrap.querySelector('#canned-toggle');
  const menu = buttonWrap.querySelector('#canned-menu');
  toggle.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', () => { if (menu) menu.hidden = true; });
  menu.onclick = (e) => e.stopPropagation();
  menu.querySelectorAll('[data-canned-body]').forEach(item => {
    item.onclick = () => {
      const textarea = composer.querySelector('textarea');
      if (textarea) {
        textarea.value = (textarea.value ? textarea.value + '\n\n' : '') + item.dataset.cannedBody;
        textarea.focus();
      }
      menu.hidden = true;
    };
  });
}

function renderCannedMenuItems() {
  const groups = {};
  for (const c of state.cannedResponses) {
    groups[c.category] = groups[c.category] || [];
    groups[c.category].push(c);
  }
  return Object.entries(groups).map(([cat, list]) => `
    <div class="canned-category">${esc(cat)}</div>
    ${list.map(item => `
      <button type="button" class="canned-item" data-canned-body="${esc(item.body)}">
        <strong>${esc(item.title)}</strong>
        <small>${esc(item.body)}</small>
      </button>
    `).join('')}
  `).join('');
}

function renderDetail() {
  const {ticket:t,messages,events,estimates=[]}=state.current;
  const staff=state.user.role!=='customer';
  const viewer=!staff&&t.visibility==='organization'&&state.organizations.some(o=>o.id===t.organization_id&&o.members.some(m=>m.user_id===state.user.id&&m.role==='viewer'));
  const canStatus=staff&&(state.user.role==='admin'||t.assignee_id===state.user.id);
  const assignee=state.user.role==='admin'||state.user.is_manager?`<select id="assignee"><option value="">Без ответственного</option>${state.staff.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>`:`<strong>${esc(t.assignee_name||'Не назначен')}</strong>`;
  const status=canStatus?`<select id="status">${Object.entries(statusNames).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select>`:`<strong><span class="badge ${esc(t.status)}">${statusNames[t.status]}</span></strong>`;
  const chat=messages.map(m=>`<div class="message ${m.author_id===state.user.id?'mine':''}"><small>${esc(m.author_name)} · ${date(m.created_at)}</small>${esc(m.body)}</div>`).join('')||'<div class="empty">Сообщений пока нет. Напишите первое сообщение.</div>';
  const history=events.map(e=>`<li>${date(e.created_at)} · ${esc(e.actor_name)}: ${e.kind==='status'?'статус изменён на '+(statusNames[e.new_value]||e.new_value):'ответственный изменён'}</li>`).join('');
  const person=state.current.assignee_profile;
  shell(`Заявка №${t.id}`,'',`<button class="back" id="back">← К заявкам</button><div class="detail-grid"><div><section class="panel content" style="margin-bottom:18px"><h2>${esc(t.title)}</h2><p class="description">${esc(t.description)}</p></section><section class="panel"><div class="toolbar"><strong>Переписка</strong><span class="muted">${messages.length} сообщений</span></div><div class="messages">${chat}</div>${t.status!=='closed'?'<form class="composer" id="message-form"><textarea name="body" required maxlength="10000" aria-label="Сообщение" placeholder="Напишите сообщение..."></textarea><button class="button primary">Отправить</button></form>':'<div class="content muted">Заявка закрыта. Переписка доступна для чтения.</div>'}</section>${staff?'<div id="internal-notes-container"></div>':''}${renderCsat(t, staff)}</div><div><section class="panel content"><h2>Информация</h2><div class="meta"><div><label>Заказчик</label><strong>${esc(t.customer_name)}</strong></div><div><label>Ответственный</label>${assignee}</div><div><label>Статус</label>${status}</div><div><label>Создана</label><strong>${date(t.created_at)}</strong></div></div></section>${history?`<section class="panel content" style="margin-top:18px"><h2>История</h2><ol class="events">${history}</ol></section>`:''}</div></div>`);
  if(viewer){document.querySelector('#message-form')?.remove();document.querySelector('.detail-grid>div:first-child>.panel:not(.content)').insertAdjacentHTML('beforeend','<div class="content muted">У вас доступ к просмотру заявки.</div>');}
  document.querySelector('.detail-grid>div:first-child').insertAdjacentHTML('afterbegin',ticketProgress(t,estimates));
  const sla=ticketSlaBadges(t);
  if(sla) document.querySelector('.detail-grid .meta').insertAdjacentHTML('afterbegin',`<div><label>SLA сроки</label><div>${sla}</div></div>`);
  if(staff&&t.customer_company)document.querySelector('.detail-grid .meta>div:first-child').insertAdjacentHTML('beforeend',`<small class="customer-company">${esc(t.customer_company)}</small>`);
  if(person)document.querySelector('.detail-grid>div:last-child').insertAdjacentHTML('beforeend',`<section class="panel content assigned-person"><div class="person-heading">${avatar(person)}<div><span class="eyebrow">Ваш специалист</span><h2>${esc(person.name)}</h2><p>${esc(person.job_title||'Сотрудник команды')}</p></div></div>${person.bio?`<p class="person-bio">${esc(person.bio)}</p>`:''}</section>`);
  if(t.created_by_name) document.querySelector('.detail-grid .meta').insertAdjacentHTML('beforeend',`<div><label>Создал</label><strong>${esc(t.created_by_name)}</strong></div>`);
  document.querySelector('.detail-grid .meta').insertAdjacentHTML('afterbegin',`<div><label>Тип задачи</label><strong>${serviceNames[t.service_type]||'Другое'}</strong></div>${t.organization_id?`<div><label>Видимость</label><strong>${t.visibility==='organization'?'Вся компания':'Личная заявка'}</strong></div>`:''}`);
  if(t.next_step) document.querySelector('.detail-grid>div:first-child').insertAdjacentHTML('afterbegin',`<div class="next-step"><span>Следующий шаг</span><strong>${esc(t.next_step)}</strong></div>`);
  if(state.current.linked_chat){document.querySelector('.detail-grid>div:first-child>.panel.content').insertAdjacentHTML('beforeend',`<button class="button linked-chat" id="linked-chat">Обсуждение в общем чате</button>`);document.querySelector('#linked-chat').onclick=()=>openChat(state.current.linked_chat.chat_id);}
  renderEstimate(t, estimates, staff);
  renderOperations();
  document.querySelector('#back').onclick=()=>setView('tickets');
  if(state.user.role==='admin'||state.user.is_manager) document.querySelector('#assignee').value=t.assignee_id||'';
  if(canStatus) document.querySelector('#status').value=t.status;
  document.querySelector('#assignee')?.addEventListener('change',async e=>{try{await api(`/tickets/${t.id}/assignee`,{method:'PATCH',body:JSON.stringify({assignee_id:e.target.value?Number(e.target.value):null})});await refresh();await openTicket(t.id);}catch(error){showError(error);}});
  document.querySelector('#status')?.addEventListener('change',async e=>{try{await api(`/tickets/${t.id}/status`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});await refresh();await openTicket(t.id);}catch(error){showError(error);}});
  document.querySelector('#message-form')?.addEventListener('submit',async e=>{e.preventDefault();const body=new FormData(e.target).get('body');e.target.querySelector('button').disabled=true;try{await api(`/tickets/${t.id}/messages`,{method:'POST',body:JSON.stringify({body,request_id:crypto.randomUUID()})});await refresh();await openTicket(t.id);}catch(error){showError(error);}});
  if(staff) {
    loadInternalNotes(t.id);
    if(t.status!=='closed') renderCannedTrigger();
  }
  attachCsatHandlers(t);
}
function renderEstimate(ticket, estimates, staff) {
  const latest=estimates[0];
  const legacy=latest&&latest.effort_minutes===null;
  const canCreate=staff&&ticket.assignee_id===state.user.id&&ticket.status!=='closed'&&(!latest||legacy||['rejected','revision_requested'].includes(latest.state));
  const canDecide=!staff&&(ticket.visibility!=='organization'||!state.organizations.some(o=>o.id===ticket.organization_id&&o.members.some(m=>m.user_id===state.user.id&&m.role==='viewer')))&&(ticket.customer_id===state.user.id||state.organizations.some(o=>o.id===ticket.organization_id&&o.members.some(m=>m.user_id===state.user.id&&m.role==='owner')))&&latest?.state==='pending'&&!legacy&&ticket.status!=='closed';
  const history=estimates.map(e=>`<div class="estimate-version"><div class="row"><strong>Версия ${e.version} · ${e.effort_minutes===null?'Старая оценка без часов':hours(e.effort_minutes)}</strong><span class="badge">${estimateNames[e.state]||'Требуется новая оценка'}</span></div><div class="muted">Оценил ${esc(e.author_name)} · ${date(e.created_at)} · на оценку потрачено ${e.assessment_minutes} мин.</div>${e.note?`<p>${esc(e.note)}</p>`:''}${e.customer_comment?`<p>Комментарий заказчика: ${esc(e.customer_comment)}</p>`:''}${e.proposed_effort_minutes!==null?`<p>Предложение заказчика: ${hours(e.proposed_effort_minutes)}</p>`:''}</div>`).join('');
  const create=canCreate?`<form class="form" id="estimate-form"><label>Плановые трудозатраты, часов<input class="field" name="effort_hours" type="number" min="0.25" max="1666" step="0.25" required></label><label>Потрачено на оценку, минут<input class="field" name="minutes" type="number" min="1" max="100000" step="1" required></label><label>Пояснение к оценке<textarea name="note" maxlength="3000" placeholder="Что входит в работу"></textarea></label><button class="button primary">Отправить оценку заказчику</button></form>`:'';
  const decide=canDecide?`<div class="row estimate-actions"><button class="button primary" id="approve-estimate">Одобрить</button><button class="button" id="reject-estimate">Отклонить</button></div><form class="form" id="revision-form"><label>Ваш вариант, часов (необязательно)<input class="field" name="effort_hours" type="number" min="0.25" max="1666" step="0.25"></label><label>Что скорректировать<textarea name="comment" maxlength="3000" placeholder="Напишите ваши пожелания"></textarea></label><button class="button">Запросить корректировку</button></form>`:'';
  document.querySelector('.detail-grid>div:first-child>.panel.content').insertAdjacentHTML('afterend',`<section class="panel content estimate-panel"><h2>Оценка трудозатрат</h2>${legacy?'<div class="notice">Старая оценка была указана в деньгах. Нужна новая оценка в часах.</div>':''}${latest?history:'<p class="muted">Оценка ещё не подготовлена.</p>'}${create}${decide}</section>`);
  const update=async(path,data)=>{try{await api(path,{method:'POST',body:JSON.stringify(data)});await refresh();await openTicket(ticket.id);}catch(error){showError(error);}};
  document.querySelector('#estimate-form')?.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.target);update(`/tickets/${ticket.id}/estimates`,{effort_minutes:Math.round(Number(data.get('effort_hours'))*60),assessment_minutes:Number(data.get('minutes')),note:data.get('note')});});
  document.querySelector('#approve-estimate')?.addEventListener('click',()=>update(`/tickets/${ticket.id}/estimates/decision`,{estimate_id:latest.id,action:'approve'}));
  document.querySelector('#reject-estimate')?.addEventListener('click',()=>update(`/tickets/${ticket.id}/estimates/decision`,{estimate_id:latest.id,action:'reject'}));
  document.querySelector('#revision-form')?.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.target);update(`/tickets/${ticket.id}/estimates/decision`,{estimate_id:latest.id,action:'request_revision',comment:data.get('comment'),proposed_effort_minutes:data.get('effort_hours')===''?null:Math.round(Number(data.get('effort_hours'))*60)});});
}
function renderOperations(){
  const {ticket:t,time_entries=[],hour_requests=[],attachments=[]}=state.current;
  const staff=state.user.role!=='customer';
  const assigned=staff&&t.assignee_id===state.user.id;
  const viewer=!staff&&t.visibility==='organization'&&state.organizations.some(o=>o.id===t.organization_id&&o.members.some(m=>m.user_id===state.user.id&&m.role==='viewer'));
  const canDecide=!staff&&!viewer&&(t.customer_id===state.user.id||state.organizations.some(o=>o.id===t.organization_id&&o.members.some(m=>m.user_id===state.user.id&&m.role==='owner')));
  const remaining=Math.max(0,(t.approved_minutes||0)-(t.actual_minutes||0));
  const progress=t.approved_minutes?Math.min(100,Math.round(t.actual_minutes/t.approved_minutes*100)):0;
  const requests=hour_requests.map(r=>`<div class="hours-request"><div class="row"><strong>+${hours(r.minutes)}</strong><span class="badge">${r.state==='approved'?'Одобрено':r.state==='rejected'?'Отклонено':'На согласовании'}</span></div><p>${esc(r.reason)}</p><small>${esc(r.author_name)} · ${date(r.created_at)}</small>${r.state==='pending'&&canDecide?`<div class="row"><button class="button primary" data-hours-approve="${r.id}">Одобрить часы</button><button class="button" data-hours-reject="${r.id}">Отклонить</button></div>`:''}</div>`).join('');
  const entries=time_entries.map(w=>`<div class="time-entry"><div class="row"><strong>${hours(w.minutes)}</strong><small>${date(w.created_at)}</small></div><p>${esc(w.note)}</p><small>${esc(w.author_name)}</small></div>`).join('');
  const logForm=assigned&&['working','waiting','done'].includes(t.status)&&t.approved_minutes?`<form class="form" id="time-entry-form"><label>Фактически потрачено, часов<input class="field" type="number" name="hours" min="0.25" step="0.25" max="${remaining/60}" required></label><label>Что сделано<textarea name="note" required minlength="3" maxlength="2000" placeholder="Кратко опишите результат работы"></textarea></label><button class="button primary" ${remaining<15?'disabled':''}>Внести время</button></form>`:'';
  const requestForm=assigned&&['working','waiting'].includes(t.status)&&t.approved_minutes&&!t.pending_hour_request?`<form class="form" id="hour-request-form"><label>Дополнительные часы<input class="field" type="number" name="hours" min="0.25" step="0.25" required></label><label>Почему нужны дополнительные часы<textarea name="reason" required minlength="3" maxlength="2000"></textarea></label><button class="button">Запросить согласование</button></form>`:'';
  const deadlines=`<div class="meta deadline-meta"><div><label>Ответ клиенту</label><strong>${t.first_staff_response_at?'Ответили':t.response_due_at?date(t.response_due_at):'Не задано'}</strong></div><div><label>Оценка до</label><strong>${t.estimate_due_at?date(t.estimate_due_at):'Не задано'}</strong></div><div><label>Срок выполнения</label><strong>${t.delivery_due_at?date(t.delivery_due_at):'Не задан'}</strong></div></div>`;
  const deadlineForm=staff&&(state.user.role==='admin'||state.user.is_manager)?`<form class="deadline-form" id="deadline-form"><label>Установить срок выполнения<input class="field" type="datetime-local" name="due_at" value="${t.delivery_due_at?new Date(t.delivery_due_at).toLocaleString('sv-SE').replace(' ','T').slice(0,16):''}"></label><button class="button">Сохранить срок</button></form>`:'';
  document.querySelector('.detail-grid>div:last-child').insertAdjacentHTML('beforeend',`<section class="panel content operations-panel"><h2>Сроки и контроль</h2>${deadlines}${deadlineForm}</section>`);
  document.querySelector('.detail-grid>div:last-child').insertAdjacentHTML('beforeend', `<div id="git-links-container">${renderGitLinksPanel(t.id, staff)}</div>`);
  const rateRub = t.hourly_rate_rub || 3000;
  const costRub = t.cost_rub || Math.round((t.approved_minutes || 0) / 60 * rateRub);
  const actBadge = t.act_invoice ? `<span style="margin: 0 10px; color: var(--line)">|</span><a href="/api/billing/invoices/${t.act_invoice.id}/print" target="_blank" class="billing-doc-pill act" title="Открыть печатную форму акта">Акт №${esc(t.act_invoice.number)} ✓</a>` : '';
  const financeHtml = `<div class="hours-finance"><span>Ставка: <strong>${rateRub.toLocaleString('ru-RU')} ₽/ч</strong></span><span style="margin: 0 10px; color: var(--line)">|</span><span>Стоимость: <strong>${costRub.toLocaleString('ru-RU')} ₽</strong></span>${actBadge}</div>`;
  document.querySelector('.detail-grid>div:first-child').insertAdjacentHTML('beforeend',`<section class="panel content operations-panel"><h2>Фактические трудозатраты</h2><div class="hours-summary"><div><small>Согласовано</small><strong>${hours(t.approved_minutes||0)}</strong></div><div><small>Выполнено</small><strong>${hours(t.actual_minutes||0)}</strong></div><div><small>Осталось</small><strong>${hours(remaining)}</strong></div></div><div class="work-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="Использовано согласованных часов"><span style="width:${progress}%"></span></div>${financeHtml}${logForm}${entries?`<h3>Записи времени</h3>${entries}`:'<p class="muted">Фактическое время пока не внесено.</p>'}${requests?`<h3>Дополнительные часы</h3>${requests}`:''}${requestForm}</section><section class="panel content operations-panel"><h2>Файлы</h2>${attachments.map(a=>`<a class="attachment-link" href="/api/attachments/${a.id}"><span>↧ ${esc(a.filename)}</span><small>${Math.ceil(a.size/1024)} КБ</small></a>`).join('')||'<p class="muted">Файлов пока нет.</p>'}${t.status!=='closed'&&!viewer?'<label class="upload-label">Прикрепить файл<input id="ticket-file" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.zip"></label>':''}</section>`);
  state.pendingOps ||= {};
  const submit=async(path,data,key)=>{try{await api(path,{method:'POST',body:JSON.stringify(data)});if(key)delete state.pendingOps[key];await refresh();await openTicket(t.id);}catch(error){showError(error);}};
  document.querySelector('#time-entry-form')?.addEventListener('submit',e=>{e.preventDefault();e.target.querySelector('button').disabled=true;const form=new FormData(e.target);const key=`time-${t.id}`;const request_id=state.pendingOps[key] ||= crypto.randomUUID();submit(`/tickets/${t.id}/time-entries`,{minutes:Math.round(Number(form.get('hours'))*60),note:form.get('note'),request_id},key);});
  document.querySelector('#hour-request-form')?.addEventListener('submit',e=>{e.preventDefault();e.target.querySelector('button').disabled=true;const form=new FormData(e.target);const key=`hours-${t.id}`;const request_id=state.pendingOps[key] ||= crypto.randomUUID();submit(`/tickets/${t.id}/hour-requests`,{minutes:Math.round(Number(form.get('hours'))*60),reason:form.get('reason'),request_id},key);});
  document.querySelectorAll('[data-hours-approve],[data-hours-reject]').forEach(button=>button.onclick=()=>submit(`/tickets/${t.id}/hour-requests/${button.dataset.hoursApprove||button.dataset.hoursReject}/decision`,{action:button.dataset.hoursApprove?'approve':'reject'}));
  document.querySelector('#ticket-file')?.addEventListener('change',async e=>{try{for(const file of e.target.files)await upload(`/tickets/${t.id}/attachments`,file);await refresh();await openTicket(t.id);}catch(error){showError(error);}});
  document.querySelector('#deadline-form')?.addEventListener('submit',async e=>{e.preventDefault();const raw=e.target.elements.due_at.value;try{await api(`/tickets/${t.id}/deadline`,{method:'PATCH',body:JSON.stringify({due_at:raw?new Date(raw).toISOString():null})});await refresh();await openTicket(t.id);}catch(error){showError(error);}});
}
function renderChats() {
  const rows=state.chats.map(c=>`<button class="ticket-row chat-row" data-chat="${c.id}"><span><strong>${esc(c.customer_name)}</strong><small>${esc(c.last_message||'Диалог пока пуст')} · ${date(c.updated_at)}</small></span><span class="muted">${esc(c.assignee_name||'Без ответственного')}</span></button>`).join('');
  const focus=state.chats[0];
  const focusCard=focus?`<section class="focus-panel"><span class="focus-overline">Последний диалог</span><h2>${esc(focus.customer_name)}</h2><p>${esc(focus.last_message||'Сообщений пока нет')}</p><div class="focus-facts"><div><span>Ответственный</span><strong>${esc(focus.assignee_name||'Не назначен')}</strong></div><div><span>Обновлён</span><strong>${date(focus.updated_at)}</strong></div></div><button class="focus-link" id="focus-chat">Открыть диалог <span aria-hidden="true">↗</span></button></section>`:'';
  shell('Общий чат','',`<div class="workspace-grid"><div class="panel"><div class="toolbar"><strong>Диалоги с заказчиками</strong><span class="muted">${state.chats.length}</span></div>${rows||'<div class="empty"><strong>Диалогов пока нет</strong>Когда заказчик напишет в общий чат, он появится здесь.</div>'}</div><div class="context-stack">${focusCard}${recentActivity()}</div></div>`);
  document.querySelector('#focus-chat')?.addEventListener('click',()=>openChat(focus.id));
  document.querySelectorAll('[data-chat]').forEach(el=>el.onclick=()=>openChat(Number(el.dataset.chat)));
}
async function openChat(id) {
  try{state.currentChat=await api(`/chats/${id}`);state.view='chat';state.error='';render();}
  catch(error){showError(error);}
}
function renderChatDetail() {
  const {chat,messages,linked_tickets=[],attachments=[]}=state.currentChat;
  const staff=state.user.role!=='customer';
  const dispatcher=state.user.role==='admin'||state.user.is_manager;
  const assignee=dispatcher?`<select id="chat-assignee" aria-label="Ответственный за чат"><option value="">Без ответственного</option>${state.staff.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>`:`<strong>${esc(chat.assignee_name||'Не назначен')}</strong>`;
  const items=messages.map(m=>`<div class="message ${m.author_id===state.user.id?'mine':''}"><small>${esc(m.author_name)} · ${date(m.created_at)}</small>${esc(m.body)}${attachments.filter(a=>a.chat_message_id===m.id).map(a=>`<a class="attachment-link" href="/api/attachments/${a.id}">↧ ${esc(a.filename)}</a>`).join('')}</div>`).join('')||'<div class="empty">Начните разговор. Сообщение увидит наша команда.</div>';
  shell(staff?`Чат · ${chat.customer_name}`:'Чат с компанией','',`${staff?'<button class="back" id="back-chats">← К диалогам</button>':''}<div class="detail-grid"><section class="panel"><div class="toolbar"><strong>Общий чат</strong><span class="muted">${messages.length} сообщений</span></div><div class="messages" id="chat-messages">${items}</div><form class="composer" id="chat-message-form"><textarea name="body" required maxlength="10000" aria-label="Сообщение" placeholder="Напишите сообщение..."></textarea><label class="upload-label">Файлы<input name="files" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.zip"></label><button class="button primary">Отправить</button></form></section><section class="panel content chat-info"><h2>Участники</h2><div class="meta"><div><label>Заказчик</label><strong>${esc(chat.customer_name)}</strong></div><div><label>Ответственный</label>${assignee}</div></div></section></div>`);
  if(linked_tickets.length){document.querySelector('#chat-messages').insertAdjacentHTML('beforebegin',`<div class="linked-list"><strong>Заявки из этого чата</strong>${linked_tickets.map(t=>`<button class="button" data-linked-ticket="${t.id}">№${t.id} · ${esc(t.title)}</button>`).join('')}</div>`);document.querySelectorAll('[data-linked-ticket]').forEach(el=>el.onclick=()=>openTicket(Number(el.dataset.linkedTicket)));}
  if(staff){
    document.querySelectorAll('#chat-messages .message').forEach((el,index)=>{
      const msg=messages[index];
      if(msg.author_id===chat.customer_id&&!linked_tickets.some(t=>t.source_message_id===msg.id)){
        el.insertAdjacentHTML('beforeend',`<button class="chat-to-ticket" data-message="${msg.id}">Создать заявку из сообщения</button>`);
      }
    });
    document.querySelector('#chat-message-form').insertAdjacentHTML('afterend','<form class="form chat-ticket-form" id="chat-ticket-form" hidden><strong>Новая заявка из чата</strong><label>Тема<input class="field" name="title" required minlength="3" maxlength="140"></label><input type="hidden" name="message_id"><div class="row"><button class="button primary">Создать заявку</button><button class="button" type="button" id="cancel-chat-ticket">Отмена</button></div></form>');
    document.querySelectorAll('[data-message]').forEach(el=>el.onclick=()=>{const msg=messages.find(m=>m.id===Number(el.dataset.message));const form=document.querySelector('#chat-ticket-form');form.hidden=false;form.elements.message_id.value=msg.id;form.elements.title.value=msg.body.slice(0,100);form.elements.title.focus();});
    document.querySelector('#cancel-chat-ticket').onclick=()=>document.querySelector('#chat-ticket-form').hidden=true;
    document.querySelector('#chat-ticket-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));const ticket=await api(`/chats/${chat.id}/tickets`,{method:'POST',body:JSON.stringify({title:data.title,message_id:Number(data.message_id)})});await refresh();await openTicket(ticket.id);}catch(error){showError(error);}};
  }
  document.querySelector('#back-chats')?.addEventListener('click',()=>setView('chats'));
  if(dispatcher){document.querySelector('#chat-assignee').value=chat.assignee_id||'';document.querySelector('#chat-assignee').onchange=async e=>{try{await api(`/chats/${chat.id}/assignee`,{method:'PATCH',body:JSON.stringify({assignee_id:e.target.value?Number(e.target.value):null})});await refresh();await openChat(chat.id);}catch(error){showError(error);}};}
  document.querySelector('#chat-message-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;const requestId=e.target.dataset.requestId||(e.target.dataset.requestId=crypto.randomUUID());try{const files=[...e.target.elements.files.files];const message=await api(`/chats/${chat.id}/messages`,{method:'POST',body:JSON.stringify({body:new FormData(e.target).get('body'),request_id:requestId})});for(const file of files)await upload(`/chats/${chat.id}/attachments`,file,{message_id:message.id});await refresh();await openChat(chat.id);}catch(error){state.error=error.message;button.disabled=false;const alert=document.querySelector('.notice');if(alert)alert.textContent=state.error;else document.querySelector('main .top').insertAdjacentHTML('afterend',notice());}};
  document.querySelector('#chat-messages').scrollTop=document.querySelector('#chat-messages').scrollHeight;
}
function renderTeam() {
  shell('Команда','',`<div class="detail-grid"><section class="panel content"><h2>Сотрудники</h2>${state.staff.map(x=>`<div class="team-person">${avatar(x)}<span><strong>${esc(x.name)}</strong><small>${esc(x.job_title||x.email)}</small></span><span class="badge">${x.role==='admin'?'Администратор':'Сотрудник'}</span></div>`).join('')}</section><section class="panel content"><h2>Добавить сотрудника</h2><form class="form" id="staff-form"><label>Имя<input class="field" name="name" required minlength="2"></label><label>Email<input class="field" name="email" type="email" required></label><label>Временный пароль<input class="field" name="password" type="password" required minlength="8"></label><button class="button primary">Добавить</button></form></section></div>`);
  document.querySelector('#staff-form button').insertAdjacentHTML('beforebegin','<label>Роль<select class="field" name="staff_role"><option value="employee">Сотрудник · только свои заявки</option><option value="manager">Менеджер · вся очередь и назначение</option></select></label>');
  document.querySelectorAll('.team-person .badge').forEach((badge,index)=>{
    if(state.staff[index]?.is_manager) badge.textContent='Менеджер';
  });
  document.querySelector('#staff-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('/staff',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.error='';await refresh();}catch(error){showError(error);}};
}
function renderProfile(){
  const p=state.profile;
  if(!p)return;
  if(state.user.role==='customer'){
    shell('Мой профиль','',`<div class="profile-layout"><section class="panel content profile-main"><div class="profile-heading customer-profile-heading">${avatar(p,'large')}<div><span class="eyebrow">Кабинет заказчика</span><h2>${esc(p.name)}</h2><p>${esc(p.company_name||'Добавьте название компании')}</p><small>${esc(p.email)}</small></div></div><form class="form" id="customer-profile-form"><label>Ваше имя<input class="field" name="name" required minlength="2" maxlength="100" autocomplete="name" value="${esc(p.name)}"></label><label>Компания или команда<input class="field" name="company_name" maxlength="150" autocomplete="organization" placeholder="Например, Студия Север" value="${esc(p.company_name)}"></label><label>Контактный телефон<input class="field" name="phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+7 999 123-45-67" value="${esc(p.phone)}"></label><p class="profile-hint">Email для входа: <strong>${esc(p.email)}</strong></p><div class="profile-actions"><button class="button primary">Сохранить изменения</button><span id="profile-saved" role="status"></span></div></form></section><div class="profile-note"><span class="eyebrow">НА СВЯЗИ С КОМАНДОЙ</span><h2>Ваши обращения в одном месте</h2><p>Имя и название компании помогут команде узнавать ваши задачи в заявках и общем чате. Контактный телефон доступен только вам в этом кабинете.</p><div class="profile-facts"><div><strong>${state.tickets.length}</strong><span>заявок</span></div><div><strong>${state.chats.length}</strong><span>общих чатов</span></div></div></div></div>`);
    if(state.organizations[0]){document.querySelector('.customer-profile-heading p').textContent=state.organizations[0].name;document.querySelector('#customer-profile-form [name="company_name"]').parentElement.innerHTML=`Компания <strong>${esc(state.organizations[0].name)}</strong><input type="hidden" name="company_name" value="${esc(p.company_name)}"><small>Состав компании управляется в разделе «Моя компания».</small>`;}
    document.querySelector('#customer-profile-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{state.profile=await api('/customer-profile/me',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.user.name=state.profile.name;state.error='';renderProfile();document.querySelector('#profile-saved').textContent='Изменения сохранены';}catch(error){showError(error);}};
    return;
  }
  shell('Мой профиль','',`<div class="profile-layout"><section class="panel content profile-main"><div class="profile-heading"><div>${avatar(p,'large')}<label class="avatar-upload" for="avatar-file">Загрузить фото</label><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>${p.avatar_url?'<button class="avatar-remove" id="avatar-remove">Удалить фото</button>':''}</div><div><span class="eyebrow">Профиль сотрудника</span><h2>${esc(p.name)}</h2><p>${esc(p.job_title||'Укажите должность')}</p><small>${esc(p.email)}</small></div></div><form class="form" id="profile-form"><label>ФИО<input class="field" name="name" required minlength="2" maxlength="100" autocomplete="name" value="${esc(p.name)}"></label><label>Должность<input class="field" name="job_title" maxlength="100" placeholder="Например, ведущий разработчик" value="${esc(p.job_title)}"></label><label>О себе<textarea name="bio" maxlength="1000" placeholder="Чем вы помогаете заказчикам, ваш опыт и специализация">${esc(p.bio)}</textarea></label><div class="profile-actions"><button class="button primary">Сохранить изменения</button><span id="profile-saved" role="status"></span></div></form></section><aside class="profile-note"><span class="eyebrow">Как это работает</span><h2>Знакомое лицо в каждой заявке</h2><p>Заказчик увидит ваше имя, должность, описание и фотографию в заявках, за которые вы отвечаете. Это помогает понимать, с кем идёт работа.</p><p>Подойдёт PNG, JPEG или WebP до 2 МБ. Изображение автоматически подстроится под кабинет.</p></aside></div>`);
  document.querySelector('#profile-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{state.profile=await api('/profile/me',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.user.name=state.profile.name;state.error='';renderProfile();document.querySelector('#profile-saved').textContent='Изменения сохранены';}catch(error){showError(error);}};
  document.querySelector('#avatar-file').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>2_000_000){showError(new Error('Фото должно быть меньше 2 МБ'));return;}try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file);});state.profile=await api('/profile/me/avatar',{method:'POST',body:JSON.stringify({data_url:dataUrl})});await refresh();setView('profile');}catch(error){showError(error);}};
  document.querySelector('#avatar-remove')?.addEventListener('click',async()=>{try{state.profile=await api('/profile/me/avatar',{method:'DELETE'});await refresh();setView('profile');}catch(error){showError(error);}});
}
async function openMessengers(){try{state.bots=await api('/bots');state.view='messengers';state.error='';render();}catch(error){showError(error);}}
function renderMessengers(){
  const info=state.bots;
  if(!info)return;
  const labels={telegram:'Telegram',max:'MAX',both:'Оба мессенджера',off:'Выключены'};
  const cards=info.providers.map(p=>{
    const link=info.links.find(l=>l.provider===p.provider);
    const pairing=state.pairings?.[p.provider];
    return `<section class="panel content messenger-card"><div class="messenger-header"><h2>${labels[p.provider]}</h2><span class="badge ${link?'working':'waiting'}">${link?'Подключён':p.configured?'Доступен':'Не настроен'}</span></div><p>${link?`Подключён: <strong>${esc(link.display_name)}</strong>. ${link.enabled?'Аккаунт связан с кабинетом.':'Доставка остановлена. Откройте бота и отправьте /start.'}`:p.configured?'Заявки и переписка в вашем мессенджере.':'Бот пока не настроен. После подключения администратором здесь появится кнопка.'}</p>${link?`<button class="button" data-unlink="${p.provider}">Отключить ${labels[p.provider]}</button>`:p.configured?`<button class="button primary" data-pair="${p.provider}">${pairing?'Получить новый код':'Подключить '+labels[p.provider]}</button>`:''}${pairing?`<div class="form"><p>1. <a href="${esc(pairing.url)}" target="_blank" rel="noopener noreferrer">Откройте бота</a> и отправьте ему команду ниже. Она действует 10 минут.</p><label>Команда подключения<input class="field" readonly value="${esc(pairing.command)}" aria-label="Команда подключения ${labels[p.provider]}"></label><p>2. Бот пришлёт код подтверждения. Введите его здесь, чтобы завершить подключение.</p></div>`:''}${!link&&p.configured&&(pairing||info.pending.some(x=>x.provider===p.provider))?`<form class="form" style="margin-top:18px" data-confirm="${p.provider}"><label>Код подтверждения из бота<input class="field" name="code" required minlength="6" maxlength="6" pattern="[a-fA-F0-9]{6}" autocomplete="off" placeholder="6 символов"></label><button class="button">Подтвердить подключение</button></form>`:''}</section>`;
  }).join('');
  const available=new Set(info.links.map(l=>l.provider));
  shell('Мессенджеры','',`<p class="muted">Подключите ботов к этому кабинету. Заявки и история переписки будут общими для сайта, Telegram и MAX.</p><div class="detail-grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">${cards}</div><section class="panel content" style="margin-top:18px"><h2>Куда отправлять уведомления</h2><form class="form" id="bot-preferences"><label>Канал<select class="field" name="channel">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${key===info.channel?'selected':''} ${key==='both'?available.size<2?'disabled':'':key!=='off'&&!available.has(key)?'disabled':''}>${label}</option>`).join('')}</select></label><p class="muted">Уведомления внутри кабинета сохраняются при любом выборе.</p><button class="button primary">Сохранить</button><span id="bot-saved" role="status"></span></form></section>`);
  document.querySelectorAll('[data-pair]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const p=button.dataset.pair;const pairing=await api(`/bots/${p}/pairing`,{method:'POST'});state.pairings={...state.pairings,[p]:pairing};state.error='';renderMessengers();}catch(error){showError(error);}});
  document.querySelectorAll('[data-confirm]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();form.querySelector('button').disabled=true;try{const p=form.dataset.confirm;await api(`/bots/${p}/confirm`,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});if(state.pairings)delete state.pairings[p];await openMessengers();}catch(error){showError(error);}});
  document.querySelectorAll('[data-unlink]').forEach(button=>button.onclick=async()=>{const p=button.dataset.unlink;if(!confirm(`Отключить ${labels[p]} от кабинета? Доступ бота и доставка уведомлений прекратятся.`))return;button.disabled=true;try{await api(`/bots/${p}`,{method:'DELETE'});if(state.pairings)delete state.pairings[p];await openMessengers();}catch(error){showError(error);}});
  document.querySelector('#bot-preferences').onsubmit=async event=>{event.preventDefault();const form=event.target;form.querySelector('button').disabled=true;try{await api('/bots/preferences',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(form)))});state.bots.channel=form.elements.channel.value;document.querySelector('#bot-saved').textContent='Настройки сохранены';}catch(error){showError(error);}finally{form.querySelector('button').disabled=false;}};
}
function renderOrganizations(){
  const dispatcher=state.user.role==='admin'||state.user.is_manager;
  const cards=state.organizations.map(org=>`<section class="panel content organization-card"><div class="row"><h2>${esc(org.name)}</h2><span class="badge">${org.members.length} участников</span></div><div class="org-members">${org.members.map(m=>`<div class="team-person org-person"><span><strong>${esc(m.name)}</strong><small>${esc(m.email)}</small></span>${dispatcher?`<span class="org-person-actions"><select class="field" data-member-role="${m.user_id}" data-org="${org.id}" aria-label="Роль ${esc(m.name)}"><option value="owner" ${m.role==='owner'?'selected':''}>Владелец</option><option value="member" ${m.role==='member'?'selected':''}>Участник</option><option value="viewer" ${m.role==='viewer'?'selected':''}>Наблюдатель</option></select><button class="button" data-remove-member="${m.user_id}" data-org="${org.id}" aria-label="Удалить ${esc(m.name)} из компании">Убрать</button></span>`:`<span class="badge">${m.role==='owner'?'Владелец':m.role==='viewer'?'Наблюдатель':'Участник'}</span>`}</div>`).join('')}</div>${dispatcher?`<form class="form org-member-form" data-org="${org.id}"><label>Email зарегистрированного заказчика<input class="field" name="email" type="email" required></label><label>Роль<select class="field" name="role"><option value="member">Участник</option><option value="viewer">Наблюдатель</option><option value="owner">Владелец</option></select></label><button class="button">Добавить в компанию</button></form>`:''}</section>`).join('');
  const create=dispatcher?`<section class="panel content"><h2>Создать компанию заказчика</h2><p class="muted">Владелец и участники должны иметь отдельные зарегистрированные кабинеты.</p><form class="form" id="org-form"><label>Название компании<input class="field" name="name" minlength="2" maxlength="150" required></label><label>Владелец<select class="field" name="owner_id" required><option value="">Выберите заказчика</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></label><button class="button primary">Создать компанию</button></form></section>`:'';
  shell(dispatcher?'Компании заказчиков':'Моя компания','',`<p class="muted">Заявки компании видны её участникам, если при создании выбрана видимость «Вся компания». Личные заявки видит только их автор.</p><div class="org-grid">${cards||`<div class="panel content empty">${dispatcher?'Компаний пока нет. Создайте первую справа.':'Вы пока не состоите в компании. Менеджер добавит вас после регистрации.'}</div>`}${create}</div>`);
  document.querySelector('#org-form')?.addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));try{await api('/organizations',{method:'POST',body:JSON.stringify({name:data.name,owner_id:Number(data.owner_id)})});await refresh();setView('organizations');}catch(error){showError(error);}});
  document.querySelectorAll('.org-member-form').forEach(form=>form.onsubmit=async e=>{e.preventDefault();try{await api(`/organizations/${form.dataset.org}/members`,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});await refresh();setView('organizations');}catch(error){showError(error);}});
  document.querySelectorAll('[data-member-role]').forEach(select=>select.onchange=async()=>{try{await api(`/organizations/${select.dataset.org}/members/${select.dataset.memberRole}`,{method:'PATCH',body:JSON.stringify({role:select.value})});await refresh();setView('organizations');}catch(error){showError(error);}});
  document.querySelectorAll('[data-remove-member]').forEach(button=>button.onclick=async()=>{if(!confirm('Убрать участника из компании? Доступ к общим заявкам прекратится.'))return;try{await api(`/organizations/${button.dataset.org}/members/${button.dataset.removeMember}`,{method:'DELETE'});await refresh();setView('organizations');}catch(error){showError(error);}});
}
async function openAnalytics(){
  setView('analytics');
  try{
    state.analytics=await api('/analytics/summary');
    renderAnalytics();
  }catch(err){
    showError(err);
  }
}
function renderAnalytics(){
  if(!state.analytics){
    shell('Аналитика и SLA','','<div class="panel content"><p class="muted">Загрузка аналитики...</p></div>');
    return;
  }
  const a=state.analytics;
  const staffTable=(a.staff_stats||[]).map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td class="muted">${esc(s.job_title)}</td><td><strong>${s.active_tickets}</strong></td><td>${s.closed_tickets}</td><td><strong>${hours(s.logged_minutes)}</strong></td><td>${s.avg_rating?`<span style="color:#d97706;font-weight:800">★ ${s.avg_rating}</span>`:'<span class="muted">—</span>'}</td></tr>`).join('');
  const csatTotal=a.total_ratings||1;
  const csatBars=[5,4,3,2,1].map(stars=>{
    const count=a.csat_distribution[stars]||0;
    const pct=Math.round(count/csatTotal*100);
    return `<div class="csat-bar-row"><span>${stars} ★</span><div class="csat-bar-track"><div class="csat-bar-fill" style="width:${pct}%"></div></div><span class="muted">${count}</span></div>`;
  }).join('');
  const feedbackList=(a.recent_feedback||[]).map(f=>`<div class="activity-item"><span class="activity-dot fresh"></span><div><div class="row"><strong>№${f.ticket_id} · ${esc(f.customer_name)}</strong><span style="color:#d97706;font-weight:800">★ ${f.rating}</span></div><p style="margin:4px 0 2px;font-size:13px">«${esc(f.comment)}»</p><small class="muted">${date(f.rated_at)}</small></div></div>`).join('');
  const serviceRows=Object.entries(a.service_breakdown||{}).map(([k,cnt])=>`<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><span>${serviceNames[k]||k}</span><strong>${cnt}</strong></div>`).join('');
  const body=`<div class="analytics-top-bar"><span class="muted">Комплексная сводка по SLA, качеству сервиса и эффективности</span><a class="button primary" href="/api/analytics/export.csv" download>📥 Скачать отчёт (CSV)</a></div><div class="analytics-grid"><div class="kpi-card"><span class="kpi-label">Всего заявок</span><div class="kpi-val accent">${a.total_tickets}</div><div class="kpi-hint">${a.open_tickets} в работе · ${a.done_tickets} закрыто</div></div><div class="kpi-card"><span class="kpi-label">Первый ответ (FRT)</span><div class="kpi-val">${a.avg_response_minutes<60?`${a.avg_response_minutes} мин`:`${(a.avg_response_minutes/60).toFixed(1)} ч`}</div><div class="kpi-hint">Соблюдение SLA: <strong>${a.sla_response_met_pct}%</strong></div></div><div class="kpi-card"><span class="kpi-label">Соблюдение оценки</span><div class="kpi-val">${a.sla_estimate_met_pct}%</div><div class="kpi-hint">Подготовка оценки трудозатрат</div></div><div class="kpi-card"><span class="kpi-label">Соблюдение сдачи</span><div class="kpi-val">${a.sla_delivery_met_pct}%</div><div class="kpi-hint">Завершение заявок до дедлайна</div></div><div class="kpi-card"><span class="kpi-label">Индекс CSAT</span><div class="kpi-val" style="color:#d97706">${a.avg_csat?`★ ${a.avg_csat}`:'—'}</div><div class="kpi-hint">${a.total_ratings} ${a.total_ratings===1?'оценка':'оценок'} от заказчиков</div></div></div><div class="analytics-split"><section class="panel content"><h2>Эффективность и нагрузка специалистов</h2><table class="staff-table"><thead><tr><th>Сотрудник</th><th>Роль</th><th>В работе</th><th>Закрыто</th><th>Списано</th><th>CSAT</th></tr></thead><tbody>${staffTable||'<tr><td colspan="6" class="muted">Нет данных</td></tr>'}</tbody></table></section><div class="context-stack"><section class="panel content"><h2>Удовлетворённость (CSAT)</h2><div class="csat-bars">${csatBars}</div></section><section class="panel content"><h2>Услуги по направлениям</h2><div style="margin-top:10px">${serviceRows||'<p class="muted">Пока нет данных</p>'}</div></section></div></div>${feedbackList?`<section class="activity-panel" style="margin-top:20px"><div class="activity-heading"><h2>Отзывы и комментарии заказчиков</h2><span>${(a.recent_feedback||[]).length}</span></div>${feedbackList}</section>`:''}`;
  shell('Аналитика и SLA','',body);
}
function renderGitLinksPanel(ticketId, staff) {
  const links = state.gitLinks || [];
  return `
    <section class="panel content git-panel">
      <div class="row" style="align-items:center;margin-bottom:10px">
        <h2>Git & Релизы</h2>
        <span class="badge">${links.length}</span>
      </div>
      <div class="git-links-list">
        ${links.map(g => `
          <div class="git-link-item">
            <div class="git-link-main">
              <span class="git-pill ${esc(g.ref_type)}">${g.ref_type === 'pr' ? 'PR' : g.ref_type === 'commit' ? 'Commit' : 'Branch'}</span>
              <div class="git-link-text">
                <a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">
                  ${esc(g.repo)} · <strong>${esc(g.ref_id)}</strong> ↗
                </a>
                ${g.title ? `<div style="font-size:12px;color:var(--muted)">${esc(g.title)}</div>` : ''}
                <small class="muted">${esc(g.author_name)} · ${date(g.created_at)}</small>
              </div>
            </div>
            ${staff ? `<button type="button" class="git-delete-btn" data-delete-git="${g.id}" title="Удалить">×</button>` : ''}
          </div>
        `).join('') || '<p class="muted" style="font-size:13px">К этой заявке пока не привязаны ветки или пулл-реквесты.</p>'}
      </div>
      ${staff ? `
        <details style="margin-top:12px;font-size:13px">
          <summary style="cursor:pointer;font-weight:700;color:var(--accent)">+ Привязать ветку / PR / коммит</summary>
          <form class="form" id="git-link-form" style="margin-top:10px">
            <label>Репозиторий<input class="field" name="repo" required placeholder="например: backend / frontend"></label>
            <label>Тип ссылки
              <select class="field" name="ref_type">
                <option value="branch">Ветка (branch)</option>
                <option value="pr">Пулл-реквест (PR)</option>
                <option value="commit">Коммит (commit)</option>
              </select>
            </label>
            <label>Идентификатор<input class="field" name="ref_id" required placeholder="например: feat/billing-v2 или PR #14"></label>
            <label>URL ссылки<input class="field" name="url" required type="url" placeholder="https://github.com/..."></label>
            <label>Комментарий / Описание (необязательно)<input class="field" name="title" placeholder="Краткая суть изменений"></label>
            <button class="button primary" style="margin-top:6px">Привязать к заявке</button>
          </form>
        </details>
      ` : ''}
    </section>
  `;
}

async function loadGitLinks(ticketId) {
  try {
    state.gitLinks = await api(`/tickets/${ticketId}/git-links`);
    const container = document.querySelector('#git-links-container');
    if (container) {
      container.innerHTML = renderGitLinksPanel(ticketId, state.user.role !== 'customer');
      attachGitLinkHandlers(ticketId);
    }
  } catch(e) {}
}

function attachGitLinkHandlers(ticketId) {
  const form = document.querySelector('#git-link-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      repo: fd.get('repo'),
      ref_type: fd.get('ref_type'),
      ref_id: fd.get('ref_id'),
      url: fd.get('url'),
      title: fd.get('title') || ''
    };
    e.target.querySelector('button').disabled = true;
    try {
      await api(`/tickets/${ticketId}/git-links`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      await loadGitLinks(ticketId);
    } catch(err) {
      showError(err);
      e.target.querySelector('button').disabled = false;
    }
  });

  document.querySelectorAll('[data-delete-git]').forEach(btn => {
    btn.onclick = async () => {
      const linkId = Number(btn.dataset.deleteGit);
      if (!confirm('Удалить привязку к Git?')) return;
      try {
        await api(`/tickets/${ticketId}/git-links/${linkId}`, { method: 'DELETE' });
        await loadGitLinks(ticketId);
      } catch(err) {
        showError(err);
      }
    };
  });
}

async function openKb() {
  setView('kb');
  try {
    state.kbCategories = await api('/kb/categories');
    state.kbArticles = await api('/kb/articles' + (state.kbActiveCategory ? `?category_id=${state.kbActiveCategory}` : ''));
    state.kbReadingArticle = null;
    state.kbEditingArticle = null;
    renderKb();
  } catch(e) {
    showError(e);
  }
}

async function readKbArticle(articleId) {
  try {
    const article = await api(`/kb/articles/${articleId}`);
    state.kbReadingArticle = article;
    state.kbEditingArticle = null;
    setView('kb');
    renderKb();
  } catch(e) {
    showError(e);
  }
}

function renderKb() {
  const staff = state.user.role !== 'customer';
  if (state.kbEditingArticle) {
    return renderKbEditor();
  }
  if (state.kbReadingArticle) {
    return renderKbReader();
  }

  const allCount = (state.kbCategories || []).reduce((sum, c) => sum + (c.article_count || 0), 0);
  const chips = [
    `<button class="kb-chip ${state.kbActiveCategory === null ? 'active' : ''}" data-kb-cat="all">Все статьи <span class="kb-chip-count">${allCount}</span></button>`,
    ...(state.kbCategories || []).map(c => `
      <button class="kb-chip ${state.kbActiveCategory === c.id ? 'active' : ''}" data-kb-cat="${c.id}">
        ${esc(c.name)} <span class="kb-chip-count">${c.article_count}</span>
      </button>
    `)
  ].join('');

  const articles = state.kbArticles || [];
  const q = (state.kbSearch || '').trim().toLowerCase();
  const filtered = q ? articles.filter(a => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)) : articles;

  const cards = filtered.map(a => `
    <article class="kb-card" data-read-article="${a.id}">
      <div class="kb-card-head">
        <span class="kb-cat-badge">${esc(a.category_name)}</span>
        ${a.is_internal ? '<span class="kb-internal-badge">🔒 Только для команды</span>' : ''}
      </div>
      <h3 class="kb-card-title">${esc(a.title)}</h3>
      <p class="kb-card-snippet">${esc(a.snippet)}</p>
      <div class="kb-card-foot">
        <span>👁️ ${a.views_count} просмотров</span>
        <span>👍 ${a.helpful_yes} · 👎 ${a.helpful_no}</span>
      </div>
    </article>
  `).join('');

  const topAction = staff ? `<button class="button primary" id="kb-create-btn">+ Создать статью</button>` : '';

  const body = `
    <div class="kb-topbar">
      <div class="kb-search-wrap">
        <input class="field" id="kb-search-input" type="search" placeholder="Поиск по статьям и инструкциям..." value="${esc(state.kbSearch || '')}">
      </div>
    </div>
    <div class="kb-cat-chips">${chips}</div>
    <div class="kb-grid">
      ${cards || '<div class="empty"><strong>Статей не найдено</strong>Попробуйте изменить категорию или поисковый запрос.</div>'}
    </div>
  `;

  shell('База знаний и регламенты', topAction, body);

  document.querySelector('#kb-create-btn')?.addEventListener('click', () => {
    state.kbEditingArticle = { id: null, category_id: state.kbCategories[0]?.id || 1, title: '', content: '', is_internal: false };
    renderKb();
  });

  document.querySelectorAll('[data-kb-cat]').forEach(btn => {
    btn.onclick = async () => {
      const cat = btn.dataset.kbCat === 'all' ? null : Number(btn.dataset.kbCat);
      state.kbActiveCategory = cat;
      state.kbArticles = await api('/kb/articles' + (cat ? `?category_id=${cat}` : ''));
      renderKb();
    };
  });

  const searchInput = document.querySelector('#kb-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      state.kbSearch = e.target.value;
      const qVal = state.kbSearch.trim().toLowerCase();
      const list = qVal ? state.kbArticles.filter(a => a.title.toLowerCase().includes(qVal) || a.content.toLowerCase().includes(qVal)) : state.kbArticles;
      const container = document.querySelector('.kb-grid');
      if (container) {
        container.innerHTML = list.map(a => `
          <article class="kb-card" data-read-article="${a.id}">
            <div class="kb-card-head">
              <span class="kb-cat-badge">${esc(a.category_name)}</span>
              ${a.is_internal ? '<span class="kb-internal-badge">🔒 Только для команды</span>' : ''}
            </div>
            <h3 class="kb-card-title">${esc(a.title)}</h3>
            <p class="kb-card-snippet">${esc(a.snippet)}</p>
            <div class="kb-card-foot">
              <span>👁️ ${a.views_count} просмотров</span>
              <span>👍 ${a.helpful_yes} · 👎 ${a.helpful_no}</span>
            </div>
          </article>
        `).join('') || '<div class="empty"><strong>Статей не найдено</strong>Попробуйте изменить поисковый запрос.</div>';
        container.querySelectorAll('[data-read-article]').forEach(c => {
          c.onclick = () => readKbArticle(Number(c.dataset.readArticle));
        });
      }
    };
  }

  document.querySelectorAll('[data-read-article]').forEach(c => {
    c.onclick = () => readKbArticle(Number(c.dataset.readArticle));
  });
}

function renderKbReader() {
  const a = state.kbReadingArticle;
  const staff = state.user.role !== 'customer';
  const actions = `
    <div style="display:flex;gap:8px">
      <button class="button" id="kb-back-btn">← Все статьи</button>
      ${staff ? `<button class="button" id="kb-edit-btn">Редактировать</button><button class="button" id="kb-delete-btn" style="color:#ef4444">Удалить</button>` : ''}
    </div>
  `;
  const body = `
    <div class="kb-reader">
      <div style="margin-bottom:14px;display:flex;gap:8px;align-items:center">
        <span class="kb-cat-badge">${esc(a.category_name)}</span>
        ${a.is_internal ? '<span class="kb-internal-badge">🔒 Внутренний регламент команды</span>' : ''}
        <small class="muted" style="margin-left:auto">${date(a.updated_at)} · 👁️ ${a.views_count} просмотров</small>
      </div>
      <section class="panel content">
        <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">${esc(a.title)}</h1>
        <div class="kb-reader-body">${esc(a.content)}</div>
        <div class="kb-feedback-box" id="kb-feedback-box">
          <div>
            <strong>Была ли эта статья полезна?</strong>
            <div class="muted" style="font-size:12px;margin-top:2px">Ваша оценка помогает улучшать базу знаний</div>
          </div>
          <div class="kb-feedback-actions">
            <button class="kb-feedback-btn" id="kb-vote-yes">👍 Да (${a.helpful_yes})</button>
            <button class="kb-feedback-btn" id="kb-vote-no">👎 Нет (${a.helpful_no})</button>
          </div>
        </div>
      </section>
    </div>
  `;
  shell(a.title, actions, body);
  document.querySelector('#kb-back-btn')?.addEventListener('click', () => {
    state.kbReadingArticle = null;
    openKb();
  });
  document.querySelector('#kb-edit-btn')?.addEventListener('click', () => {
    state.kbEditingArticle = { ...a };
    renderKb();
  });
  document.querySelector('#kb-delete-btn')?.addEventListener('click', async () => {
    if (!confirm('Удалить эту статью из базы знаний?')) return;
    try {
      await api(`/kb/articles/${a.id}`, { method: 'DELETE' });
      state.kbReadingArticle = null;
      await openKb();
    } catch(err) {
      showError(err);
    }
  });
  const vote = async (helpful) => {
    try {
      const res = await api(`/kb/articles/${a.id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ helpful })
      });
      document.querySelector('#kb-feedback-box').innerHTML = `<span style="color:#059669;font-weight:700">✓ Спасибо за обратную связь!</span><div class="muted" style="font-size:12px">👍 ${res.helpful_yes} · 👎 ${res.helpful_no}</div>`;
    } catch(err) {
      showError(err);
    }
  };
  document.querySelector('#kb-vote-yes')?.addEventListener('click', () => vote(true));
  document.querySelector('#kb-vote-no')?.addEventListener('click', () => vote(false));
}

function renderKbEditor() {
  const a = state.kbEditingArticle;
  const isNew = !a.id;
  const body = `
    <div class="kb-reader">
      <button class="button" id="kb-cancel-edit" style="margin-bottom:16px">← Отмена</button>
      <section class="panel content">
        <h2>${isNew ? 'Новая статья базы знаний' : 'Редактирование статьи'}</h2>
        <form class="form" id="kb-editor-form">
          <label>Категория
            <select class="field" name="category_id" required>
              ${state.kbCategories.map(c => `<option value="${c.id}" ${c.id === a.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>Заголовок статьи
            <input class="field" name="title" required minlength="3" maxlength="200" value="${esc(a.title)}" placeholder="Например: Как передать доступы к API">
          </label>
          <label>Текст статьи / инструкции
            <textarea name="content" required minlength="5" style="min-height:240px" placeholder="Опишите шаги, регламент или решение проблемы...">${esc(a.content)}</textarea>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
            <input type="checkbox" name="is_internal" ${a.is_internal ? 'checked' : ''}>
            <span>🔒 Только для команды (скрыть от заказчиков)</span>
          </label>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="button primary">Сохранить статью</button>
            <button type="button" class="button" id="kb-cancel-form">Отмена</button>
          </div>
        </form>
      </section>
    </div>
  `;
  shell(isNew ? 'Новая статья' : 'Редактирование', '', body);
  const cancel = () => {
    state.kbEditingArticle = null;
    renderKb();
  };
  document.querySelector('#kb-cancel-edit')?.addEventListener('click', cancel);
  document.querySelector('#kb-cancel-form')?.addEventListener('click', cancel);
  document.querySelector('#kb-editor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      category_id: Number(fd.get('category_id')),
      title: fd.get('title'),
      content: fd.get('content'),
      is_internal: fd.get('is_internal') === 'on'
    };
    e.target.querySelector('button.primary').disabled = true;
    try {
      if (isNew) {
        const created = await api('/kb/articles', { method: 'POST', body: JSON.stringify(data) });
        state.kbEditingArticle = null;
        await readKbArticle(created.id);
      } else {
        const updated = await api(`/kb/articles/${a.id}`, { method: 'PATCH', body: JSON.stringify(data) });
        state.kbEditingArticle = null;
        await readKbArticle(updated.id);
      }
    } catch(err) {
      showError(err);
      e.target.querySelector('button.primary').disabled = false;
    }
  });
}

async function openWebhooks() {
  setView('webhooks');
  try {
    state.webhooks = await api('/webhooks');
    renderWebhooks();
  } catch(err) {
    showError(err);
  }
}

function renderWebhooks() {
  const list = state.webhooks || [];
  const allEvents = [
    ['ticket.created', 'Создание заявки'],
    ['ticket.status_changed', 'Смена статуса заявки'],
    ['estimate.decided', 'Решение по оценке'],
    ['internal_note.created', 'Внутренняя заметка'],
    ['ticket.rated', 'Оценка CSAT'],
  ];

  const cards = list.map(w => `
    <div class="webhook-card" id="webhook-${w.id}">
      <div class="webhook-card-head">
        <div>
          <div class="webhook-url">${esc(w.url)}</div>
          ${w.description ? `<div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(w.description)}</div>` : ''}
        </div>
        <span class="badge ${w.is_active ? 'working' : 'closed'}">${w.is_active ? 'Активен' : 'Отключен'}</span>
      </div>
      <div class="webhook-events-list">
        ${(w.events || []).map(ev => `<span class="webhook-ev-badge">${esc(ev)}</span>`).join('')}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">
        <span>Секретный ключ (HMAC): <code>${esc(w.secret.slice(0, 6))}••••••••</code></span> ·
        <span>Доставок: <strong>${w.total_deliveries}</strong></span>
        ${w.last_status_code ? ` · Код: <strong>${w.last_status_code}</strong>` : ''}
      </div>
      <div class="webhook-actions">
        <button class="button small-btn" data-wh-test="${w.id}">Тестовый запрос</button>
        <button class="button small-btn" data-wh-toggle="${w.id}">${w.is_active ? 'Приостановить' : 'Активировать'}</button>
        <button class="button small-btn" data-wh-logs="${w.id}">Журнал доставок</button>
        <button class="button small-btn" data-wh-delete="${w.id}" style="color:#ef4444;margin-left:auto">Удалить</button>
      </div>
      <div class="webhook-logs-drawer" id="wh-logs-${w.id}" style="display:none"></div>
    </div>
  `).join('');

  const body = `
    <div class="workspace-grid">
      <div class="panel content">
        <div class="row" style="margin-bottom:12px">
          <h2>Настроенные вебхуки</h2>
          <span class="badge">${list.length}</span>
        </div>
        <p class="muted" style="font-size:13.5px;margin-bottom:16px">
          Поддержка HMAC-SHA256 подписи в заголовке <code>X-Signature-SHA256</code> для безопасной интеграции с CI/CD, CRM и мессенджерами.
        </p>
        <div class="webhooks-list">
          ${cards || '<div class="empty"><strong>Вебхуков пока нет</strong>Добавьте первый URL для отправки системных событий.</div>'}
        </div>
      </div>
      <div class="context-stack">
        <section class="panel content">
          <h2>+ Добавить вебхук</h2>
          <form class="form" id="create-webhook-form" style="margin-top:12px">
            <label>URL обработчика (Endpoint)
              <input class="field" name="url" required type="url" placeholder="https://api.yourdomain.com/webhook">
            </label>
            <label>Описание (необязательно)
              <input class="field" name="description" placeholder="например: Telegram бот оповещений или Jira Sync">
            </label>
            <label>Секретный ключ (опционально)
              <input class="field" name="secret" placeholder="Оставьте пустым для автогенерации">
            </label>
            <label>События для подписки:
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;font-size:13px">
                ${allEvents.map(([ev, label]) => `
                  <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" name="events" value="${ev}" ${['ticket.created','ticket.status_changed'].includes(ev)?'checked':''}>
                    <span><code>${ev}</code> — ${label}</span>
                  </label>
                `).join('')}
              </div>
            </label>
            <button class="button primary" style="margin-top:10px">Подключить вебхук</button>
          </form>
        </section>
      </div>
    </div>
  `;

  shell('Вебхуки и интеграции (DevOps Gateway)', '', body);

  document.querySelector('#create-webhook-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const checkedEvents = fd.getAll('events');
    if (!checkedEvents.length) {
      alert('Выберите хотя бы одно событие для подписки');
      return;
    }
    const data = {
      url: fd.get('url'),
      description: fd.get('description'),
      secret: fd.get('secret') || null,
      events: checkedEvents
    };
    e.target.querySelector('button').disabled = true;
    try {
      await api('/webhooks', { method: 'POST', body: JSON.stringify(data) });
      await openWebhooks();
    } catch(err) {
      showError(err);
      e.target.querySelector('button').disabled = false;
    }
  });

  document.querySelectorAll('[data-wh-test]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.whTest);
      btn.disabled = true;
      btn.textContent = 'Отправка...';
      try {
        const res = await api(`/webhooks/${id}/test`, { method: 'POST' });
        btn.textContent = res.log?.status_code ? `✓ Код ${res.log.status_code} (${res.log.duration_ms} мс)` : '✓ Отправлено';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Тестовый запрос'; }, 3000);
      } catch(err) {
        showError(err);
        btn.disabled = false;
        btn.textContent = 'Тестовый запрос';
      }
    };
  });

  document.querySelectorAll('[data-wh-toggle]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.whToggle);
      const wh = state.webhooks.find(x => x.id === id);
      if (!wh) return;
      try {
        await api(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !wh.is_active }) });
        await openWebhooks();
      } catch(err) {
        showError(err);
      }
    };
  });

  document.querySelectorAll('[data-wh-delete]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Удалить этот вебхук?')) return;
      const id = Number(btn.dataset.whDelete);
      try {
        await api(`/webhooks/${id}`, { method: 'DELETE' });
        await openWebhooks();
      } catch(err) {
        showError(err);
      }
    };
  });

  document.querySelectorAll('[data-wh-logs]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.whLogs);
      const drawer = document.querySelector(`#wh-logs-${id}`);
      if (!drawer) return;
      if (drawer.style.display !== 'none') {
        drawer.style.display = 'none';
        return;
      }
      drawer.style.display = 'block';
      drawer.innerHTML = '<div class="muted">Загрузка журнала доставок...</div>';
      try {
        const logs = await api(`/webhooks/${id}/logs`);
        if (!logs.length) {
          drawer.innerHTML = '<div class="muted">Запросов по этому вебхуку ещё не было.</div>';
          return;
        }
        drawer.innerHTML = `
          <strong>Последние доставки (${logs.length}):</strong>
          <div style="margin-top:6px">
            ${logs.map(l => `
              <div class="webhook-log-row">
                <span><code>${esc(l.event)}</code></span>
                <span class="webhook-log-status ${l.status_code && l.status_code < 400 ? 'ok' : 'err'}">
                  ${l.status_code || 'Err'} (${l.duration_ms} мс)
                </span>
                <small class="muted">${date(l.created_at)}</small>
              </div>
            `).join('')}
          </div>
        `;
      } catch(err) {
        drawer.innerHTML = `<div class="muted" style="color:#ef4444">Ошибка загрузки: ${esc(err.message)}</div>`;
      }
    };
  });
}

function formatRuDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString('ru-RU');
}

async function openBilling() {
  setView('billing');
  location.hash = '#billing';
  try {
    state.billing = await api('/billing/overview');
    if (state.user.role !== 'customer') {
      state.billingClients = await api('/billing/clients');
    }
    renderBilling();
  } catch(err) {
    showError(err);
  }
}

function renderBilling() {
  const staff = state.user.role !== 'customer';
  const b = state.billing || {};

  let kpis = '';
  if (staff) {
    const clients = b.clients || state.billingClients || [];
    const totalPaid = b.total_paid_rub ?? b.total_paid_rub_month ?? 0;
    const totalUnbilled = b.total_unbilled_minutes ?? clients.reduce((acc, c) => acc + (c.unbilled_minutes || c.unbilled_done_minutes || 0), 0);
    const totalClients = clients.length || b.total_clients || 0;
    const withDebt = clients.filter(c => (c.balance_minutes || 0) < 0).length || b.clients_with_debt || 0;
    const withDeposit = clients.filter(c => (c.balance_minutes || 0) > 0).length || b.clients_with_positive_balance || 0;

    kpis = `
      <div class="billing-kpi-grid">
        <div class="billing-kpi positive">
          <span class="billing-kpi-label">Поступило за месяц</span>
          <strong class="billing-kpi-value">${totalPaid.toLocaleString('ru-RU')} ₽</strong>
          <span class="billing-kpi-hint">Оплаченные счета клиентов</span>
        </div>
        <div class="billing-kpi">
          <span class="billing-kpi-label">К закрытию в акты</span>
          <strong class="billing-kpi-value">${hours(totalUnbilled)}</strong>
          <span class="billing-kpi-hint">Выполненные задачи без акта</span>
        </div>
        <div class="billing-kpi">
          <span class="billing-kpi-label">Клиенты на обслуживании</span>
          <strong class="billing-kpi-value">${totalClients}</strong>
          <span class="billing-kpi-hint">${withDeposit} с активным депозитом</span>
        </div>
        <div class="billing-kpi ${withDebt ? 'danger' : ''}">
          <span class="billing-kpi-label">Задолженность часов</span>
          <strong class="billing-kpi-value">${withDebt}</strong>
          <span class="billing-kpi-hint">${withDebt ? 'Баланс ушёл в минус' : 'Все балансы в норме'}</span>
        </div>
      </div>
    `;
  } else {
    const balMins = b.balance_minutes || 0;
    const balHours = b.balance_hours ?? (balMins / 60.0);
    const balRub = b.balance_rub ?? b.balance_rub_equiv ?? Math.round(balHours * (b.hourly_rate_rub || 3000));
    const activeMins = b.in_progress_minutes ?? b.active_billable_minutes ?? 0;
    const unbilledMins = b.unbilled_minutes ?? b.unbilled_done_minutes ?? 0;
    const isPos = balMins > 0;
    const isNeg = balMins < 0;

    kpis = `
      <div class="billing-kpi-grid">
        <div class="billing-kpi ${isPos ? 'positive' : isNeg ? 'danger' : ''}">
          <span class="billing-kpi-label">Баланс депозита</span>
          <strong class="billing-kpi-value">${balHours.toLocaleString('ru-RU', {maximumFractionDigits: 1})} ч</strong>
          <span class="billing-kpi-hint">Эквивалент: ${balRub.toLocaleString('ru-RU')} ₽</span>
        </div>
        <div class="billing-kpi">
          <span class="billing-kpi-label">Тарифная ставка</span>
          <strong class="billing-kpi-value">${(b.hourly_rate_rub || 3000).toLocaleString('ru-RU')} ₽/ч</strong>
          <span class="billing-kpi-hint">Фиксированная ставка по договору</span>
        </div>
        <div class="billing-kpi">
          <span class="billing-kpi-label">Часы в работе</span>
          <strong class="billing-kpi-value">${hours(activeMins)}</strong>
          <span class="billing-kpi-hint">Согласованные активные заявки</span>
        </div>
        <div class="billing-kpi">
          <span class="billing-kpi-label">Готово к актированию</span>
          <strong class="billing-kpi-value">${hours(unbilledMins)}</strong>
          <span class="billing-kpi-hint">Выполненные задачи без акта</span>
        </div>
      </div>
    `;
  }

  const actions = staff ? `
    <div class="row" style="gap:8px; flex-wrap:wrap">
      <button class="button primary" id="btn-create-act">+ Сформировать акт</button>
      <button class="button" id="btn-create-invoice">+ Выставить счёт</button>
      <button class="button" id="btn-create-deposit">+ Пополнить баланс</button>
    </div>
  ` : `
    <div class="row" style="gap:8px">
      <button class="button primary" id="btn-customer-deposit">+ Купить пакет часов</button>
    </div>
  `;

  const activeTab = state.billingTab || 'docs';
  const tabs = `
    <div class="billing-tabs">
      <button class="billing-tab ${activeTab === 'docs' ? 'active' : ''}" data-tab="docs">Документы (Счета и Акты)</button>
      ${staff ? `<button class="billing-tab ${activeTab === 'clients' ? 'active' : ''}" data-tab="clients">Клиенты и тарифы (${(b.clients || state.billingClients)?.length || 0})</button>` : ''}
      <button class="billing-tab ${activeTab === 'tx' ? 'active' : ''}" data-tab="tx">История операций</button>
    </div>
  `;

  let content = '';
  if (activeTab === 'docs') {
    let docs = b.invoices || b.recent_documents || [];
    const filter = state.billingFilter || 'all';
    if (filter === 'invoice') docs = docs.filter(d => d.doc_type === 'invoice');
    else if (filter === 'act') docs = docs.filter(d => d.doc_type === 'act');
    else if (filter === 'issued') docs = docs.filter(d => d.status === 'issued');
    else if (filter === 'paid') docs = docs.filter(d => d.status === 'paid');

    const filterBar = `
      <div class="billing-filter-bar">
        <button class="billing-filter-pill ${filter === 'all' ? 'active' : ''}" data-filter="all">Все документы</button>
        <button class="billing-filter-pill ${filter === 'invoice' ? 'active' : ''}" data-filter="invoice">Счета на оплату</button>
        <button class="billing-filter-pill ${filter === 'act' ? 'active' : ''}" data-filter="act">Акты выполненных работ</button>
        <button class="billing-filter-pill ${filter === 'issued' ? 'active' : ''}" data-filter="issued">Ожидают оплаты</button>
        <button class="billing-filter-pill ${filter === 'paid' ? 'active' : ''}" data-filter="paid">Оплаченные</button>
      </div>
    `;

    const statusPill = (st) => {
      if (st === 'paid') return '<span class="billing-status paid">Оплачен ✓</span>';
      if (st === 'issued') return '<span class="billing-status issued">Выставлен ⏳</span>';
      return '<span class="billing-status cancelled">Аннулирован ✕</span>';
    };

    const docRows = docs.map(d => {
      const typeBadge = d.doc_type === 'act'
        ? '<span class="billing-doc-pill act">Акт</span>'
        : '<span class="billing-doc-pill invoice">Счёт</span>';
      const clientName = d.organization_name || d.customer_name || d.client_name || 'Клиент';
      const periodStr = d.period_start && d.period_end ? `<br><small class="muted">${formatRuDate(d.period_start)} – ${formatRuDate(d.period_end)}</small>` : '';

      let actionButtons = `
        <a href="/api/billing/invoices/${d.id}/print" target="_blank" class="billing-btn-sm" title="Печатная форма / PDF">
          Печать ⎙
        </a>
      `;
      if (staff && d.status === 'issued') {
        actionButtons += `
          <button class="billing-btn-sm primary" data-mark-paid="${d.id}" title="Отметить оплаченным">
            Оплачен ✓
          </button>
          <button class="billing-btn-sm danger" data-mark-cancel="${d.id}" title="Аннулировать документ">
            ✕
          </button>
        `;
      }
      if (!staff && d.status === 'issued' && d.doc_type === 'invoice') {
        actionButtons += `
          <button class="billing-btn-sm primary" data-customer-pay="${d.id}" title="Оплатить онлайн">
            Оплатить онлайн (демо)
          </button>
        `;
      }

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px">
              ${typeBadge}
              <strong>${esc(d.number)}</strong>
            </div>
          </td>
          ${staff ? `<td><strong>${esc(clientName)}</strong></td>` : ''}
          <td>${date(d.created_at)}</td>
          <td>${hours(d.total_minutes)}${periodStr}</td>
          <td><strong>${(d.total_rub || 0).toLocaleString('ru-RU')} ₽</strong></td>
          <td>${statusPill(d.status)}</td>
          <td>
            <div style="display:flex; gap:6px; flex-wrap:wrap">
              ${actionButtons}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    content = `
      <section class="panel content" style="padding: 20px">
        ${filterBar}
        ${docs.length ? `
          <div style="overflow-x:auto">
            <table class="billing-table">
              <thead>
                <tr>
                  <th>№ и Тип</th>
                  ${staff ? '<th>Клиент</th>' : ''}
                  <th>Дата</th>
                  <th>Объём / Период</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                ${docRows}
              </tbody>
            </table>
          </div>
        ` : '<div class="muted" style="text-align:center; padding: 40px 0">Документов по выбранному фильтру не найдено.</div>'}
      </section>
    `;
  } else if (activeTab === 'clients' && staff) {
    const clients = state.billingClients || b.clients || [];
    const clientRows = clients.map(c => `
      <tr>
        <td>
          <strong>${esc(c.name)}</strong>
          <div class="billing-client-meta">${c.client_type === 'org' || c.client_type === 'organization' ? 'Организация' : 'Физлицо / Прямой клиент'}</div>
        </td>
        <td>
          <div>${c.inn ? `ИНН: ${esc(c.inn)}` : '<span class="muted">ИНН не указан</span>'}</div>
          ${c.legal_address ? `<div class="billing-client-meta">${esc(c.legal_address)}</div>` : ''}
        </td>
        <td>
          <strong>${(c.hourly_rate_rub || 3000).toLocaleString('ru-RU')} ₽/ч</strong>
        </td>
        <td>
          <strong style="color: ${(c.balance_minutes || 0) < 0 ? '#ef4444' : 'var(--ink)'}">${(c.balance_hours ?? ((c.balance_minutes || 0) / 60)).toLocaleString('ru-RU', {maximumFractionDigits: 1})} ч</strong>
          <div class="billing-client-meta">${(c.balance_rub ?? c.balance_rub_equiv ?? Math.round(((c.balance_minutes || 0) / 60) * (c.hourly_rate_rub || 3000))).toLocaleString('ru-RU')} ₽</div>
        </td>
        <td>
          <strong>${hours(c.unbilled_minutes ?? c.unbilled_done_minutes ?? 0)}</strong>
        </td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap">
            <button class="billing-btn-sm" data-edit-client="${c.client_type}:${c.client_id}">Реквизиты и тариф</button>
            <button class="billing-btn-sm primary" data-act-client="${c.client_type}:${c.client_id}">+ Акт</button>
            <button class="billing-btn-sm" data-deposit-client="${c.client_type}:${c.client_id}">+ Часы</button>
          </div>
        </td>
      </tr>
    `).join('');

    content = `
      <section class="panel content" style="padding: 20px">
        <div style="overflow-x:auto">
          <table class="billing-table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Реквизиты</th>
                <th>Ставка</th>
                <th>Баланс депозита</th>
                <th>К актированию</th>
                <th>Управление</th>
              </tr>
            </thead>
            <tbody>
              ${clientRows || '<tr><td colspan="6" class="muted" style="text-align:center; padding:30px">Нет зарегистрированных клиентов.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  } else if (activeTab === 'tx') {
    const txs = b.transactions || b.recent_transactions || [];
    const txRows = txs.map(t => {
      let badgeCls = 'deposit';
      let badgeLabel = 'Пополнение';
      if (t.tx_type === 'charge') {
        badgeCls = 'charge';
        badgeLabel = 'Списание';
      } else if (t.tx_type === 'refund') {
        badgeCls = 'refund';
        badgeLabel = 'Возврат';
      }

      const clientName = t.organization_name || t.customer_name || t.client_name || 'Клиент';
      const sign = t.minutes > 0 ? '+' : '';
      const minColor = t.minutes > 0 ? '#15803d' : t.minutes < 0 ? '#b91c1c' : 'inherit';

      return `
        <tr>
          <td>${date(t.created_at)}</td>
          ${staff ? `<td><strong>${esc(clientName)}</strong></td>` : ''}
          <td><span class="billing-tx-badge ${badgeCls}">${badgeLabel}</span></td>
          <td><strong style="color:${minColor}">${sign}${hours(t.minutes)}</strong></td>
          <td><strong>${(t.amount_rub || 0).toLocaleString('ru-RU')} ₽</strong></td>
          <td>${esc(t.description || '—')}</td>
          <td><small class="muted">${esc(t.created_by_name || 'Система')}</small></td>
        </tr>
      `;
    }).join('');

    content = `
      <section class="panel content" style="padding: 20px">
        ${txs.length ? `
          <div style="overflow-x:auto">
            <table class="billing-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  ${staff ? '<th>Клиент</th>' : ''}
                  <th>Операция</th>
                  <th>Объём</th>
                  <th>Сумма</th>
                  <th>Основание</th>
                  <th>Автор</th>
                </tr>
              </thead>
              <tbody>
                ${txRows}
              </tbody>
            </table>
          </div>
        ` : '<div class="muted" style="text-align:center; padding: 40px 0">Операций по балансу пока не зафиксировано.</div>'}
      </section>
    `;
  }

  shell('Биллинг и счета', actions, `
    <div style="max-width: 1200px">
      ${kpis}
      ${tabs}
      ${content}
    </div>
    <div id="billing-modal-slot"></div>
  `);

  attachBillingHandlers();
}

function attachBillingHandlers() {
  document.querySelectorAll('.billing-tab').forEach(btn => {
    btn.onclick = () => {
      state.billingTab = btn.dataset.tab;
      renderBilling();
    };
  });

  document.querySelectorAll('.billing-filter-pill').forEach(btn => {
    btn.onclick = () => {
      state.billingFilter = btn.dataset.filter;
      renderBilling();
    };
  });

  document.querySelectorAll('[data-mark-paid]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.markPaid);
      try {
        await api(`/billing/invoices/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'paid' })
        });
        await openBilling();
      } catch(err) {
        showError(err);
      }
    };
  });

  document.querySelectorAll('[data-mark-cancel]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Аннулировать этот документ? Если это акт, списанные часы будут возвращены на баланс клиента.')) return;
      const id = Number(btn.dataset.markCancel);
      try {
        await api(`/billing/invoices/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'cancelled' })
        });
        await openBilling();
      } catch(err) {
        showError(err);
      }
    };
  });

  document.querySelectorAll('[data-customer-pay]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.customerPay);
      if (!confirm('Подтвердить оплату счёта онлайн (демо)? Депозит часов будет сразу зачислен на ваш баланс.')) return;
      try {
        await api(`/billing/invoices/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'paid' })
        });
        alert('Оплата успешно подтверждена! Часы зачислены на ваш баланс.');
        await openBilling();
      } catch(err) {
        showError(err);
      }
    };
  });

  document.querySelector('#btn-create-act')?.addEventListener('click', () => openActModal());
  document.querySelector('#btn-create-invoice')?.addEventListener('click', () => openInvoiceModal());
  document.querySelector('#btn-create-deposit')?.addEventListener('click', () => openDepositModal());
  document.querySelector('#btn-customer-deposit')?.addEventListener('click', () => openCustomerInvoiceModal());

  document.querySelectorAll('[data-edit-client]').forEach(btn => {
    btn.onclick = () => {
      const [type, id] = btn.dataset.editClient.split(':');
      const c = state.billingClients.find(x => x.client_type === type && x.client_id === Number(id));
      if (c) openClientRateModal(c);
    };
  });

  document.querySelectorAll('[data-act-client]').forEach(btn => {
    btn.onclick = () => openActModal(btn.dataset.actClient);
  });

  document.querySelectorAll('[data-deposit-client]').forEach(btn => {
    btn.onclick = () => openDepositModal(btn.dataset.depositClient);
  });
}

async function openActModal(preselectedKey = '') {
  const slot = document.querySelector('#billing-modal-slot');
  if (!slot) return;
  const clients = state.billingClients || [];

  slot.innerHTML = `
    <div class="billing-modal-backdrop" id="billing-modal">
      <div class="billing-modal-card">
        <div class="billing-modal-head">
          <h2>Сформировать акт выполненных работ</h2>
          <button class="billing-modal-close" id="modal-close">&times;</button>
        </div>
        <form id="act-form" class="form">
          <label>Клиент
            <select class="field" name="client_key" id="act-client-select" required>
              <option value="">-- Выберите организацию или клиента --</option>
              ${clients.map(c => `
                <option value="${c.client_type}:${c.client_id}" ${preselectedKey === `${c.client_type}:${c.client_id}` ? 'selected' : ''}>
                  ${esc(c.name)} (${c.client_type === 'organization' ? 'Организация' : 'Физлицо'}, ставка ${c.hourly_rate_rub} ₽/ч)
                </option>
              `).join('')}
            </select>
          </label>
          <div style="font-weight:700; margin-top:8px; font-size:13px">Завершённые заявки для включения в акт:</div>
          <div id="act-tickets-box" class="billing-ticket-list">
            <div class="muted">Выберите клиента для отображения не выставленных заявок</div>
          </div>
          <div class="row">
            <label style="flex:1">Период с
              <input class="field" type="date" name="period_start">
            </label>
            <label style="flex:1">по
              <input class="field" type="date" name="period_end">
            </label>
          </div>
          <label>Предмет акта / Примечание
            <textarea class="field" name="notes" placeholder="Оказание услуг по технической поддержке и сопровождению..."></textarea>
          </label>
          <div id="act-totals-bar" style="padding:10px 14px; background:var(--accent-soft); border-radius:var(--radius-sm); font-size:13.5px; margin: 10px 0">
            Выбрано заявок: <strong>0</strong> | Трудозатраты: <strong>0 ч</strong> | Сумма к списанию: <strong>0 ₽</strong>
          </div>
          <button class="button primary" id="act-submit-btn" disabled>Сформировать акт и списать часы</button>
        </form>
      </div>
    </div>
  `;

  const modal = slot.querySelector('#billing-modal');
  slot.querySelector('#modal-close').onclick = () => { slot.innerHTML = ''; };
  modal.onclick = (e) => { if (e.target === modal) slot.innerHTML = ''; };

  const select = slot.querySelector('#act-client-select');
  const ticketsBox = slot.querySelector('#act-tickets-box');
  const totalsBar = slot.querySelector('#act-totals-bar');
  const submitBtn = slot.querySelector('#act-submit-btn');

  let currentTickets = [];

  async function loadTickets(key) {
    if (!key) {
      ticketsBox.innerHTML = '<div class="muted">Выберите клиента</div>';
      submitBtn.disabled = true;
      return;
    }
    const [cType, cId] = key.split(':');
    ticketsBox.innerHTML = '<div class="muted">Загрузка заявок...</div>';
    try {
      currentTickets = await api(`/billing/unbilled-tickets?client_type=${cType}&client_id=${cId}`);
      if (!currentTickets.length) {
        ticketsBox.innerHTML = '<div class="muted">У этого клиента нет завершённых не выставленных в акт заявок.</div>';
        submitBtn.disabled = true;
        recalc();
        return;
      }
      ticketsBox.innerHTML = `
        <div style="padding-bottom:6px; margin-bottom:6px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between">
          <label style="font-weight:700; cursor:pointer"><input type="checkbox" id="act-select-all" checked> Выбрать все</label>
          <small class="muted">${currentTickets.length} заявок</small>
        </div>
        ${currentTickets.map(t => {
          const mins = t.actual_minutes || t.approved_minutes || 0;
          return `
            <div class="billing-ticket-item">
              <input type="checkbox" class="act-ticket-cb" value="${t.id}" data-mins="${mins}" checked id="act-cb-${t.id}">
              <label for="act-cb-${t.id}">
                <span><strong>№${t.id}</strong>: ${esc(t.title)}</span>
                <strong>${hours(mins)}</strong>
              </label>
            </div>
          `;
        }).join('')}
      `;
      slot.querySelector('#act-select-all').onchange = (e) => {
        slot.querySelectorAll('.act-ticket-cb').forEach(cb => { cb.checked = e.target.checked; });
        recalc();
      };
      slot.querySelectorAll('.act-ticket-cb').forEach(cb => {
        cb.onchange = () => recalc();
      });
      recalc();
    } catch(err) {
      ticketsBox.innerHTML = `<div class="muted" style="color:#ef4444">Ошибка: ${esc(err.message)}</div>`;
    }
  }

  function recalc() {
    const key = select.value;
    if (!key) return;
    const [cType, cId] = key.split(':');
    const client = clients.find(x => x.client_type === cType && x.client_id === Number(cId));
    const rate = client ? client.hourly_rate_rub : 3000;
    const checked = Array.from(slot.querySelectorAll('.act-ticket-cb:checked'));
    let totalMins = 0;
    checked.forEach(cb => { totalMins += Number(cb.dataset.mins || 0); });
    const rub = Math.round(totalMins / 60 * rate);
    totalsBar.innerHTML = `Выбрано заявок: <strong>${checked.length}</strong> | Трудозатраты: <strong>${hours(totalMins)}</strong> | Сумма к списанию: <strong>${rub.toLocaleString('ru-RU')} ₽</strong>`;
    submitBtn.disabled = checked.length === 0;
  }

  select.onchange = () => loadTickets(select.value);
  if (select.value) loadTickets(select.value);

  slot.querySelector('#act-form').onsubmit = async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    const form = new FormData(e.target);
    const [client_type, client_id_str] = form.get('client_key').split(':');
    const ticket_ids = Array.from(slot.querySelectorAll('.act-ticket-cb:checked')).map(cb => Number(cb.value));
    try {
      const doc = await api('/billing/invoices', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: 'act',
          client_type,
          client_id: Number(client_id_str),
          period_start: form.get('period_start') || null,
          period_end: form.get('period_end') || null,
          notes: form.get('notes') || '',
          ticket_ids
        })
      });
      slot.innerHTML = '';
      await openBilling();
      window.open(`/api/billing/invoices/${doc.id}/print`, '_blank');
    } catch(err) {
      showError(err);
      submitBtn.disabled = false;
    }
  };
}

async function openInvoiceModal(preselectedKey = '') {
  const slot = document.querySelector('#billing-modal-slot');
  if (!slot) return;
  const clients = state.billingClients || [];

  slot.innerHTML = `
    <div class="billing-modal-backdrop" id="billing-modal">
      <div class="billing-modal-card">
        <div class="billing-modal-head">
          <h2>Выставить счёт на оплату часов</h2>
          <button class="billing-modal-close" id="modal-close">&times;</button>
        </div>
        <form id="invoice-form" class="form">
          <label>Клиент
            <select class="field" name="client_key" id="inv-client-select" required>
              <option value="">-- Выберите организацию или клиента --</option>
              ${clients.map(c => `
                <option value="${c.client_type}:${c.client_id}" ${preselectedKey === `${c.client_type}:${c.client_id}` ? 'selected' : ''}>
                  ${esc(c.name)} (ставка ${c.hourly_rate_rub} ₽/ч, баланс ${c.balance_hours} ч)
                </option>
              `).join('')}
            </select>
          </label>
          <label>Количество часов в пакете
            <input class="field" type="number" name="deposit_hours" id="inv-hours" min="1" max="1000" step="1" value="10" required>
          </label>
          <div id="inv-preview-bar" style="padding:10px 14px; background:var(--accent-soft); border-radius:var(--radius-sm); font-size:14px; margin: 8px 0">
            Итого к оплате: <strong>30 000 ₽</strong>
          </div>
          <label>Назначение платежа / Примечание
            <textarea class="field" name="notes" placeholder="Предоплата пакета 10 часов технической поддержки и доработок"></textarea>
          </label>
          <button class="button primary" id="inv-submit-btn">Выставить счёт</button>
        </form>
      </div>
    </div>
  `;

  const modal = slot.querySelector('#billing-modal');
  slot.querySelector('#modal-close').onclick = () => { slot.innerHTML = ''; };
  modal.onclick = (e) => { if (e.target === modal) slot.innerHTML = ''; };

  const select = slot.querySelector('#inv-client-select');
  const hoursInput = slot.querySelector('#inv-hours');
  const previewBar = slot.querySelector('#inv-preview-bar');

  function updateSum() {
    const key = select.value;
    const hoursVal = Number(hoursInput.value || 0);
    let rate = 3000;
    if (key) {
      const [cType, cId] = key.split(':');
      const c = clients.find(x => x.client_type === cType && x.client_id === Number(cId));
      if (c) rate = c.hourly_rate_rub;
    }
    const sum = Math.round(hoursVal * rate);
    previewBar.innerHTML = `Ставка: <strong>${rate.toLocaleString('ru-RU')} ₽/ч</strong> | Итого к оплате: <strong>${sum.toLocaleString('ru-RU')} ₽</strong>`;
  }

  select.onchange = updateSum;
  hoursInput.oninput = updateSum;
  updateSum();

  slot.querySelector('#invoice-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const [client_type, client_id_str] = form.get('client_key').split(':');
    const deposit_hours = Number(form.get('deposit_hours'));
    try {
      const doc = await api('/billing/invoices', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: 'invoice',
          client_type,
          client_id: Number(client_id_str),
          deposit_hours,
          notes: form.get('notes') || ''
        })
      });
      slot.innerHTML = '';
      await openBilling();
      window.open(`/api/billing/invoices/${doc.id}/print`, '_blank');
    } catch(err) {
      showError(err);
    }
  };
}

async function openDepositModal(preselectedKey = '') {
  const slot = document.querySelector('#billing-modal-slot');
  if (!slot) return;
  const clients = state.billingClients || [];

  slot.innerHTML = `
    <div class="billing-modal-backdrop" id="billing-modal">
      <div class="billing-modal-card">
        <div class="billing-modal-head">
          <h2>Прямое пополнение депозита часов</h2>
          <button class="billing-modal-close" id="modal-close">&times;</button>
        </div>
        <form id="deposit-form" class="form">
          <label>Клиент
            <select class="field" name="client_key" id="dep-client-select" required>
              <option value="">-- Выберите организацию или клиента --</option>
              ${clients.map(c => `
                <option value="${c.client_type}:${c.client_id}" ${preselectedKey === `${c.client_type}:${c.client_id}` ? 'selected' : ''}>
                  ${esc(c.name)} (текущий баланс: ${c.balance_hours} ч)
                </option>
              `).join('')}
            </select>
          </label>
          <div class="row">
            <label style="flex:1">Количество часов
              <input class="field" type="number" name="hours" id="dep-hours" min="0.25" max="1000" step="0.25" value="10" required>
            </label>
            <label style="flex:1">Сумма (₽)
              <input class="field" type="number" name="amount_rub" id="dep-amount" min="0" max="10000000" step="100" value="30000" required>
            </label>
          </div>
          <label>Основание пополнения
            <input class="field" type="text" name="description" placeholder="Банковский платёж по договору №... / Бонусные часы" required>
          </label>
          <button class="button primary">Зачислить на баланс</button>
        </form>
      </div>
    </div>
  `;

  const modal = slot.querySelector('#billing-modal');
  slot.querySelector('#modal-close').onclick = () => { slot.innerHTML = ''; };
  modal.onclick = (e) => { if (e.target === modal) slot.innerHTML = ''; };

  const select = slot.querySelector('#dep-client-select');
  const hoursInput = slot.querySelector('#dep-hours');
  const amountInput = slot.querySelector('#dep-amount');

  function updateDepositPreview() {
    const key = select.value;
    const hoursVal = Number(hoursInput.value || 0);
    if (key) {
      const [cType, cId] = key.split(':');
      const c = clients.find(x => x.client_type === cType && x.client_id === Number(cId));
      if (c) {
        amountInput.value = Math.round(hoursVal * c.hourly_rate_rub);
      }
    }
  }

  select.onchange = updateDepositPreview;
  hoursInput.oninput = updateDepositPreview;

  slot.querySelector('#deposit-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const [client_type, client_id_str] = form.get('client_key').split(':');
    const hoursVal = Number(form.get('hours'));
    const amount_rub = Number(form.get('amount_rub'));
    const description = form.get('description');
    try {
      await api('/billing/deposit', {
        method: 'POST',
        body: JSON.stringify({
          client_type,
          client_id: Number(client_id_str),
          minutes: Math.round(hoursVal * 60),
          amount_rub,
          description
        })
      });
      slot.innerHTML = '';
      await openBilling();
    } catch(err) {
      showError(err);
    }
  };
}

function openClientRateModal(c) {
  const slot = document.querySelector('#billing-modal-slot');
  if (!slot) return;

  slot.innerHTML = `
    <div class="billing-modal-backdrop" id="billing-modal">
      <div class="billing-modal-card">
        <div class="billing-modal-head">
          <h2>Тариф и реквизиты: ${esc(c.name)}</h2>
          <button class="billing-modal-close" id="modal-close">&times;</button>
        </div>
        <form id="rate-form" class="form">
          <label>Почасовая ставка (₽/час)
            <input class="field" type="number" name="hourly_rate_rub" min="500" max="100000" step="100" value="${c.hourly_rate_rub || 3000}" required>
          </label>
          <div class="row">
            <label style="flex:1">ИНН
              <input class="field" type="text" name="inn" maxlength="20" value="${esc(c.inn || '')}" placeholder="7701234567">
            </label>
            <label style="flex:1">КПП
              <input class="field" type="text" name="kpp" maxlength="20" value="${esc(c.kpp || '')}" placeholder="770101001">
            </label>
          </div>
          <label>Юридический адрес
            <textarea class="field" name="legal_address" placeholder="125009, г. Москва, ул. Тверская, д. 1...">${esc(c.legal_address || '')}</textarea>
          </label>
          <button class="button primary">Сохранить изменения</button>
        </form>
      </div>
    </div>
  `;

  const modal = slot.querySelector('#billing-modal');
  slot.querySelector('#modal-close').onclick = () => { slot.innerHTML = ''; };
  modal.onclick = (e) => { if (e.target === modal) slot.innerHTML = ''; };

  slot.querySelector('#rate-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api(`/billing/clients/${c.client_type}/${c.client_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          hourly_rate_rub: Number(form.get('hourly_rate_rub')),
          inn: form.get('inn') || '',
          kpp: form.get('kpp') || '',
          legal_address: form.get('legal_address') || ''
        })
      });
      slot.innerHTML = '';
      await openBilling();
    } catch(err) {
      showError(err);
    }
  };
}

function openCustomerInvoiceModal() {
  const slot = document.querySelector('#billing-modal-slot');
  if (!slot) return;
  const b = state.billing || {};
  const rate = b.hourly_rate_rub || 3000;

  slot.innerHTML = `
    <div class="billing-modal-backdrop" id="billing-modal">
      <div class="billing-modal-card">
        <div class="billing-modal-head">
          <h2>Заказ пакета часов поддержки</h2>
          <button class="billing-modal-close" id="modal-close">&times;</button>
        </div>
        <form id="cust-invoice-form" class="form">
          <p class="muted" style="margin-bottom:12px">
            Выберите желаемый объём часов. Система сформирует официальный счёт для безналичной оплаты или мгновенного онлайн-платежа.
          </p>
          <label>Пакет часов
            <select class="field" name="deposit_hours" id="cust-hours-select">
              <option value="5">5 часов (${(5 * rate).toLocaleString('ru-RU')} ₽)</option>
              <option value="10" selected>10 часов (${(10 * rate).toLocaleString('ru-RU')} ₽)</option>
              <option value="20">20 часов (${(20 * rate).toLocaleString('ru-RU')} ₽)</option>
              <option value="50">50 часов (${(50 * rate).toLocaleString('ru-RU')} ₽)</option>
            </select>
          </label>
          <div id="cust-inv-preview" style="padding:10px 14px; background:var(--accent-soft); border-radius:var(--radius-sm); font-size:14px; margin: 8px 0">
            Ваша ставка: <strong>${rate.toLocaleString('ru-RU')} ₽/ч</strong> | К оплате: <strong>${(10 * rate).toLocaleString('ru-RU')} ₽</strong>
          </div>
          <button class="button primary">Сформировать счёт</button>
        </form>
      </div>
    </div>
  `;

  const modal = slot.querySelector('#billing-modal');
  slot.querySelector('#modal-close').onclick = () => { slot.innerHTML = ''; };
  modal.onclick = (e) => { if (e.target === modal) slot.innerHTML = ''; };

  const select = slot.querySelector('#cust-hours-select');
  const preview = slot.querySelector('#cust-inv-preview');

  select.onchange = () => {
    const h = Number(select.value);
    preview.innerHTML = `Ваша ставка: <strong>${rate.toLocaleString('ru-RU')} ₽/ч</strong> | К оплате: <strong>${(h * rate).toLocaleString('ru-RU')} ₽</strong>`;
  };

  slot.querySelector('#cust-invoice-form').onsubmit = async (e) => {
    e.preventDefault();
    const h = Number(select.value);
    try {
      const doc = await api('/billing/invoices', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: 'invoice',
          client_type: b.client_type,
          client_id: b.client_id,
          deposit_hours: h,
          notes: `Предоплата пакета ${h} часов технической поддержки`
        })
      });
      slot.innerHTML = '';
      await openBilling();
      window.open(`/api/billing/invoices/${doc.id}/print`, '_blank');
    } catch(err) {
      showError(err);
    }
  };
}

async function openHash(){
  if(!state.user)return;
  const match=location.hash.match(/^#(ticket|chat)\/(\d+)$/);
  if(match)return match[1]==='ticket'?openTicket(Number(match[2])):openChat(Number(match[2]));
  if(location.hash==='#messengers')return openMessengers();
  if(location.hash==='#analytics')return openAnalytics();
  if(location.hash==='#kb')return openKb();
  if(location.hash==='#webhooks')return openWebhooks();
  if(location.hash==='#billing')return openBilling();
}
function render() {if(!state.user)return renderAuth();if(state.view==='organizations')return renderOrganizations();if(state.view==='profile')return renderProfile();if(state.view==='messengers')return renderMessengers();if(state.view==='queue')return renderQueue();if(state.view==='new')return renderNew();if(state.view==='detail'&&state.current)return renderDetail();if(state.view==='team')return renderTeam();if(state.view==='notifications')return renderNotifications();if(state.view==='chats')return renderChats();if(state.view==='chat'&&state.currentChat)return renderChatDetail();if(state.view==='analytics')return renderAnalytics();if(state.view==='kb')return renderKb();if(state.view==='webhooks')return renderWebhooks();if(state.view==='billing')return renderBilling();renderTickets();}
async function start(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  try{
    state.user=await api('/me');
    state.view=state.user.role==='customer'?'tickets':'queue';
    initRealtime();
    await refresh();
    await openHash();
  }catch{
    state.user=null;
    renderAuth();
  }
}
window.addEventListener('hashchange',()=>openHash());
start();
setInterval(()=>loadNotifications().catch(()=>{}),15000);
setInterval(async()=>{
  if(state.view!=='chat'||!state.currentChat||document.querySelector('#chat-message-form textarea')?.value) return;
  try{
    const fresh=await api(`/chats/${state.currentChat.chat.id}`);
    if(fresh.messages.length!==state.currentChat.messages.length||fresh.chat.assignee_id!==state.currentChat.chat.assignee_id){state.currentChat=fresh;renderChatDetail();}
  }catch{}
},15000);

