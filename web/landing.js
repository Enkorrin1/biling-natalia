(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Тень у шапки после начала прокрутки
  const header = document.getElementById('header');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Мобильное меню
  const menuBtn = document.getElementById('menu-btn');
  const nav = document.getElementById('nav');
  const setMenu = open => {
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });

  // Появление блоков при прокрутке
  const revealed = document.querySelectorAll('.reveal, .phone-chat');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealed.forEach(el => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealed.forEach(el => io.observe(el));
  }

  // Вкладки «Интерфейс»
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const note = document.getElementById('tour-note');
  const selectTab = tab => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      if (on) {
        panel.classList.remove('swap');
        void panel.offsetWidth;
        panel.classList.add('swap');
        note.textContent = panel.dataset.note;
      }
    });
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', e => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });

  // Cookie: выбор запоминается в браузере
  const cookie = document.getElementById('cookie');
  let consent = null;
  try { consent = localStorage.getItem('codari-cookie'); } catch (e) { /* хранилище недоступно */ }
  if (!consent) cookie.hidden = false;
  cookie.addEventListener('click', e => {
    const choice = e.target.closest('[data-cookie]')?.dataset.cookie;
    if (!choice) return;
    try { localStorage.setItem('codari-cookie', choice); } catch (err) { /* хранилище недоступно */ }
    cookie.hidden = true;
  });

  // Кнопки тарифов подставляют тариф в форму
  const form = document.getElementById('demo-form');
  const status = document.getElementById('form-status');
  let plan = '';
  document.querySelectorAll('[data-plan]').forEach(a => a.addEventListener('click', () => { plan = a.dataset.plan; }));

  // Отправка формы демо
  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.className = 'form-status';
    status.textContent = '';
    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      status.classList.add('err');
      status.textContent = invalid?.name === 'consent' ? 'Отметьте согласие на обработку персональных данных.' : 'Заполните имя и контакт для связи.';
      invalid?.focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    const body = {
      name: data.name.trim(),
      company: [data.company.trim(), plan && `тариф: ${plan}`].filter(Boolean).join(' · '),
      contact: data.contact.trim(),
      team_size: data.team_size,
      consent: true
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Отправляем…';
    try {
      const res = await fetch('/api/demo-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      form.classList.add('sent');
    } catch (err) {
      status.classList.add('err');
      status.textContent = 'Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.';
    } finally {
      button.disabled = false;
      button.textContent = 'Запросить демо';
    }
  });
})();
