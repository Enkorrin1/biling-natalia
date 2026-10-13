/* Пошаговая навигация по кабинету для заказчиков. Подсвечивает элемент интерфейса и объясняет, зачем он нужен.
   Запускается сам при первом входе заказчика и повторно — кнопкой «Как пользоваться» в боковом меню. */
const clientTour = (() => {
  const steps = [
    {title:'Добро пожаловать в Codari',text:'Здесь вы обсуждаете задачи, согласуете объём работы и проверяете результат.'},
    {target:'#top-new-ticket',title:'Создайте обращение',text:'Сначала выберите компанию и проект, затем опишите задачу и ожидаемый результат. При необходимости приложите файлы.'},
    {title:'Компания → проект → заявка',text:'Компания объединяет проекты, участников, общий чат и финансы. В проекте собраны заявки и результаты. Навигационная цепочка позволяет вернуться на любой уровень.'},
    {title:'Согласование и приёмка',text:'До начала работы одобрите оценку. Когда результат готов, примите его или верните на доработку с комментарием. Общие заявки согласует владелец компании.'},
    {target:'.nav-cluster',title:'Все разделы рядом',text:'В разделе «Обращения» находятся заявки и переписка. В «Финансах» — баланс, счета и акты. В «Настройках» можно подключить мессенджеры.'},
    {target:'[data-nav="notifications"]',title:'Следующий шаг',text:'События сгруппированы по компаниям, проектам и заявкам. Фильтр «Требуют действия» показывает текущие согласования. Открытие события ведёт прямо к нужной записи.'},
    {title:'Начните с первой заявки',text:'Вернуться к обучению можно в любой момент. Команда уже готова помочь.',final:true},
  ];
  let active = [];
  let index = 0;
  let root = null;
  let observer = null;
  let frame = 0;
  let returnFocus = null;

  const doneKey = () => `codari-tour-done:${state.user?.id ?? ''}`;
  const isDone = () => { try { return localStorage.getItem(doneKey()) === '1'; } catch { return true; } };
  const markDone = () => { try { localStorage.setItem(doneKey(), '1'); } catch {} };
  const target = step => { const el=step.target?document.querySelector(step.target):null; return el && el.getBoundingClientRect().width>0 ? el:null; };

  function start() {
    if (!state.user || state.user.role !== 'customer') return;
    if (!['companies','company','project'].includes(state.view)) setView('companies');
    active = steps.filter(step => !step.target || target(step));
    index = 0;
    returnFocus = document.activeElement;
    if (!root) build();
    show();
  }

  function autostart() { if (state.user?.role === 'customer' && !isDone() && !root) start(); }

  function build() {
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `<div class="tour-blocker"></div><div class="tour-spot" aria-hidden="true"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" tabindex="-1"><div class="tour-head"><span class="tour-step" id="tour-step"></span><button class="tour-close" id="tour-close" type="button" aria-label="Закрыть обучение">×</button></div><h2 id="tour-title"></h2><p id="tour-text"></p><div class="tour-dots" id="tour-dots" aria-hidden="true"></div><div class="tour-actions"><button class="button tour-back" id="tour-back" type="button">Назад</button><button class="button primary" id="tour-next" type="button">Далее</button></div></div>`;
    document.body.append(root);
    root.querySelector('#tour-close').onclick = finish;
    root.querySelector('#tour-back').onclick = () => go(index - 1);
    root.querySelector('#tour-next').onclick = () => {
      if (!active[index].final) return go(index + 1);
      finish();
      HierarchyUI.fromView();
    };
    root.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    // Кабинет перерисовывается при обновлениях — после перерисовки находим подсвеченный элемент заново.
    observer = new MutationObserver(schedule);
    observer.observe(document.querySelector('#app'), {childList:true, subtree:true});
  }

  function go(next) {
    if (next < 0 || next >= active.length) return;
    index = next;
    show();
  }

  function show() {
    const step = active[index];
    const card = root.querySelector('.tour-card');
    root.querySelector('#tour-step').textContent = `Шаг ${index + 1} из ${active.length}`;
    root.querySelector('#tour-title').textContent = step.title;
    root.querySelector('#tour-text').textContent = step.text;
    root.querySelector('#tour-dots').innerHTML = active.map((_, i) => `<span class="${i === index ? 'current' : i < index ? 'passed' : ''}"></span>`).join('');
    root.querySelector('#tour-back').hidden = index === 0;
    root.querySelector('#tour-next').textContent = step.final ? 'Создать заявку' : index === 0 ? 'Начать' : 'Далее';
    root.querySelector('#tour-close').setAttribute('aria-label', step.final ? 'Закрыть' : 'Пропустить обучение');
    // Мгновенно: плавная прокрутка из CSS при быстром переключении шагов обрывается на полпути.
    target(step)?.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
    card.classList.remove('tour-enter');
    void card.offsetWidth;
    card.classList.add('tour-enter');
    position();
    root.querySelector('#tour-next').focus({preventScroll:true});
  }

  function schedule() {
    if (!root || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; position(); });
  }

  function position() {
    if (!root) return;
    const step = active[index];
    const el = target(step);
    const spot = root.querySelector('.tour-spot');
    const card = root.querySelector('.tour-card');
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14, edge = 16;
    const rect = el?.getBoundingClientRect();
    if (!rect || !rect.width) {
      spot.classList.add('tour-spot-empty');
      Object.assign(spot.style, {left:`${vw / 2}px`, top:`${vh / 2}px`, width:'0px', height:'0px'});
      card.style.left = `${Math.max(edge, (vw - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(edge, (vh - card.offsetHeight) / 2)}px`;
      return;
    }
    const pad = 6;
    spot.classList.remove('tour-spot-empty');
    Object.assign(spot.style, {left:`${rect.left - pad}px`, top:`${rect.top - pad}px`, width:`${rect.width + pad * 2}px`, height:`${rect.height + pad * 2}px`});
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const clampX = x => Math.min(Math.max(edge, x), vw - cw - edge);
    const clampY = y => Math.min(Math.max(edge, y), vh - ch - edge);
    let left, top;
    if (vw - rect.right - pad - gap >= cw + edge) { left = rect.right + pad + gap; top = clampY(rect.top + rect.height / 2 - ch / 2); }
    else if (vh - rect.bottom - pad - gap >= ch + edge) { left = clampX(rect.left); top = rect.bottom + pad + gap; }
    else if (rect.top - pad - gap >= ch + edge) { left = clampX(rect.left); top = rect.top - pad - gap - ch; }
    else if (rect.left - pad - gap >= cw + edge) { left = rect.left - pad - gap - cw; top = clampY(rect.top + rect.height / 2 - ch / 2); }
    else { left = clampX((vw - cw) / 2); top = vh - ch - edge; }
    card.style.left = `${clampX(left)}px`;
    card.style.top = `${clampY(top)}px`;
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
    else if (event.key === 'ArrowRight' && !active[index].final) go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'Tab') {
      const items = [...root.querySelectorAll('.tour-card button:not([hidden])')];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  function finish() {
    markDone();
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    root?.remove();
    root = null;
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }

  return {start, autostart};
})();
