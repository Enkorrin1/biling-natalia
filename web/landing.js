(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  // Часы в формате 7:00, минус — через типографский знак
  const fmtHours = minutes => {
    const sign = minutes < 0 ? '−' : '';
    const m = Math.abs(Math.round(minutes));
    return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  };
  const fmtRub = n => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

  // Плавный счёт числа: from → to за duration, отрисовка через render
  const tween = (from, to, duration, render) => new Promise(resolve => {
    if (reduceMotion) { render(to); resolve(); return; }
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      render(from + (to - from) * easeOut(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });

  // Вызывает cb при первом появлении элемента на экране
  const onceVisible = (el, cb, threshold = 0.3) => {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { cb(); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); cb(); }
    }, { threshold });
    io.observe(el);
  };
  // Следит, виден ли элемент сейчас
  const watchVisible = (el, cb, threshold = 0.25) => {
    if (!el || !('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(entries => entries.forEach(e => cb(e.isIntersecting)), { threshold }).observe(el);
  };

  /* Шапка: тень, прогресс чтения, кнопка «наверх» */
  const header = $('header');
  const progress = $('scroll-progress');
  const toTop = $('to-top');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      header.classList.toggle('scrolled', y > 8);
      progress.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
      toTop.classList.toggle('show', y > 900);
      ticking = false;
    });
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  toTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    document.querySelector('.brand')?.focus({ preventScroll: true });
  });

  /* Мобильное меню */
  const menuBtn = $('menu-btn');
  const nav = $('nav');
  const setMenu = open => {
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });

  /* Подсветка текущего раздела в меню */
  const navLinks = [...nav.querySelectorAll('a[href^="#"]')];
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navLinks.forEach(a => {
          const on = a.getAttribute('href') === `#${entry.target.id}`;
          a.classList.toggle('active', on);
          if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    navLinks.forEach(a => { const s = document.querySelector(a.getAttribute('href')); if (s) spy.observe(s); });
  }

  /* Появление блоков при прокрутке */
  const revealed = document.querySelectorAll('.reveal');
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

  /* Первый экран: счётчики часов */
  setTimeout(() => {
    document.querySelectorAll('.hero-visual [data-count]').forEach(el => {
      const target = Number(el.dataset.count);
      tween(0, target, 1400, v => { el.textContent = fmtHours(v); });
    });
  }, reduceMotion ? 0 : 500);

  /* Первый экран: наклон карточки за курсором */
  const tilt = $('tilt');
  const heroVisual = document.querySelector('.hero-visual');
  if (finePointer && !reduceMotion && tilt) {
    heroVisual.addEventListener('pointermove', e => {
      const r = heroVisual.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tilt.classList.add('moving');
      tilt.style.transform = `rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 8).toFixed(2)}deg)`;
    });
    heroVisual.addEventListener('pointerleave', () => {
      tilt.classList.remove('moving');
      tilt.style.transform = '';
    });
  }

  /* Первый экран: живая карточка оценки */
  const estimate = $('hero-estimate');
  const estimateText = $('hero-estimate-text');
  estimate?.addEventListener('click', e => {
    const action = e.target.closest('[data-est]')?.dataset.est;
    if (!action) return;
    if (action === 'reset') {
      estimate.classList.remove('approved');
      estimate.querySelector('[data-est="ok"]').focus();
      return;
    }
    estimateText.textContent = action === 'ok' ? 'Оценка одобрена — работа начнётся' : 'Запрос на уточнение отправлен';
    estimate.classList.add('approved');
    estimate.querySelector('[data-est="reset"]').focus();
  });

  /* «Магнитная» кнопка и подсветка карточек за курсором */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('.magnetic').forEach(btn => {
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${(x * 0.18).toFixed(1)}px, ${(y * 0.25).toFixed(1)}px)`;
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
    document.querySelectorAll('.spot').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  }

  /* «Как это работает»: шаги переключаются сами, клик фиксирует шаг */
  const stepsEl = $('steps');
  const steps = stepsEl ? [...stepsEl.querySelectorAll('li.card')] : [];
  let stepIndex = 0, stepTimer = null, stepsAuto = true, stepsVisible = false;
  const setStep = i => {
    stepIndex = i;
    steps.forEach((s, k) => {
      s.classList.toggle('active', k === i);
      s.classList.toggle('passed', k < i);
      if (k === i) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
    });
    stepsEl.style.setProperty('--sp', steps.length > 1 ? i / (steps.length - 1) : 1);
    stepsEl.querySelector('.steps-line i').style.transform = `scaleX(${steps.length > 1 ? i / (steps.length - 1) : 1})`;
  };
  const runSteps = () => {
    clearTimeout(stepTimer);
    if (!stepsAuto || !stepsVisible || reduceMotion) return;
    stepTimer = setTimeout(() => { setStep((stepIndex + 1) % steps.length); runSteps(); }, 2600);
  };
  if (steps.length) {
    setStep(0);
    steps.forEach((s, i) => {
      s.tabIndex = 0;
      const pick = () => { stepsAuto = false; clearTimeout(stepTimer); setStep(i); };
      s.addEventListener('click', pick);
      s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    watchVisible(stepsEl, v => { stepsVisible = v; runSteps(); }, 0.4);
  }

  /* Вкладки «Интерфейс»: автопрокрутка, пауза при наведении, клавиши-стрелки */
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const tablist = document.querySelector('.tabs');
  const tour = $('tour');
  const note = $('tour-note');
  const TAB_MS = 6000;
  let tabTimer = null, tabAuto = !reduceMotion, tourVisible = false, tourHover = false;
  tablist.style.setProperty('--tab-ms', `${TAB_MS}ms`);
  const selectTab = tab => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = $(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      if (on) {
        panel.classList.remove('swap');
        void panel.offsetWidth;
        panel.classList.add('swap');
        note.textContent = panel.dataset.note;
      }
    });
    // перезапуск полоски-таймера
    tablist.classList.remove('autoplay');
    void tablist.offsetWidth;
    if (tabAuto) tablist.classList.add('autoplay');
  };
  const scheduleTab = () => {
    clearTimeout(tabTimer);
    tablist.classList.toggle('paused', tourHover || !tourVisible);
    if (!tabAuto || !tourVisible || tourHover) return;
    tabTimer = setTimeout(() => {
      const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
      selectTab(tabs[(i + 1) % tabs.length]);
      scheduleTab();
    }, TAB_MS);
  };
  const stopTabAuto = () => { tabAuto = false; clearTimeout(tabTimer); tablist.classList.remove('autoplay'); };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => { stopTabAuto(); selectTab(tab); });
    tab.addEventListener('keydown', e => {
      const stepKey = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!stepKey) return;
      stopTabAuto();
      const next = tabs[(i + stepKey + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });
  tour.addEventListener('pointerenter', () => { tourHover = true; scheduleTab(); });
  tour.addEventListener('pointerleave', () => { tourHover = false; scheduleTab(); });
  tour.addEventListener('focusin', () => { tourHover = true; scheduleTab(); });
  tour.addEventListener('focusout', () => { tourHover = false; scheduleTab(); });
  if (tabAuto) tablist.classList.add('autoplay');
  watchVisible(tour, v => { tourVisible = v; scheduleTab(); }, 0.35);

  /* Баланс часов: проигрывание примера по шагам */
  const ledger = $('ledger');
  const ledgerRows = ledger ? [...ledger.querySelectorAll('.ledger-row')] : [];
  const ledgerBalance = $('ledger-balance');
  const balances = [600, 600, 600, 420];
  let ledgerRun = 0;
  const playLedger = async () => {
    const run = ++ledgerRun;
    ledgerRows.forEach(r => r.classList.remove('on'));
    let current = 0;
    ledgerBalance.textContent = fmtHours(0);
    for (let i = 0; i < ledgerRows.length; i++) {
      await wait(i ? 900 : 300);
      if (run !== ledgerRun) return;
      ledgerRows[i].classList.add('on');
      await tween(current, balances[i], 700, v => { if (run === ledgerRun) ledgerBalance.textContent = fmtHours(v); });
      current = balances[i];
    }
  };
  if (ledger) {
    if (reduceMotion) ledgerRows.forEach(r => r.classList.add('on'));
    else onceVisible(ledger, playLedger, 0.4);
    $('ledger-replay').addEventListener('click', playLedger);
  }

  /* Калькулятор баланса */
  const c = { rate: $('c-rate'), pack: $('c-pack'), used: $('c-used'), work: $('c-work') };
  if (c.rate) {
    const paint = input => {
      const p = (input.value - input.min) / (input.max - input.min) * 100;
      input.style.setProperty('--fill', `${p}%`);
    };
    let shownBalance = null;
    const calc = () => {
      const rate = +c.rate.value, pack = +c.pack.value, used = +c.used.value, work = +c.work.value;
      Object.values(c).forEach(paint);
      $('o-rate').textContent = fmtRub(rate);
      $('o-pack').textContent = `${pack} ч`;
      $('o-used').textContent = `${used} ч`;
      $('o-work').textContent = `${work} ч`;
      const balance = (pack - used) * 60;
      const free = balance - work * 60;
      const from = shownBalance ?? balance;
      shownBalance = balance;
      tween(from, balance, 350, v => { $('r-balance').textContent = fmtHours(v); });
      $('r-balance').style.color = balance < 0 ? '#ffb59a' : '#fff';
      $('r-invoice').textContent = fmtRub(pack * rate);
      $('r-used').textContent = fmtRub(used * rate);
      $('r-free').textContent = fmtHours(free);
      const total = Math.max(pack, used + work, 1);
      const usedPart = Math.min(used, total), workPart = Math.min(work, Math.max(total - usedPart, 0));
      $('b-used').style.width = `${usedPart / total * 100}%`;
      $('b-work').style.width = `${workPart / total * 100}%`;
      $('b-free').style.width = `${Math.max(pack - used - work, 0) / total * 100}%`;
      $('r-warn').textContent = balance < 0
        ? `Баланс в минусе на ${fmtHours(-balance)} — понадобится пополнение на ${fmtRub(-balance / 60 * rate)}.`
        : free < 0 ? `Текущих работ больше остатка на ${fmtHours(-free)} — пакет закончится до их завершения.` : '';
    };
    Object.values(c).forEach(input => input.addEventListener('input', calc));
    calc();
  }

  /* Бот: можно выбрать ответ */
  const feed = $('bot-feed');
  const quick = $('bot-quick');
  const botReset = $('bot-reset');
  const initialFeed = feed?.innerHTML;
  const initialQuick = quick?.innerHTML;
  const addBubble = (html, me = false) => {
    const b = document.createElement('div');
    b.className = me ? 'bubble me' : 'bubble';
    b.innerHTML = html;
    feed.appendChild(b);
  };
  const botSay = async html => {
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.setAttribute('aria-label', 'Бот печатает');
    typing.innerHTML = '<i></i><i></i><i></i>';
    feed.appendChild(typing);
    await wait(900);
    typing.remove();
    addBubble(html);
  };
  const setQuick = buttons => {
    quick.innerHTML = buttons.map(([key, label]) => `<button type="button" data-reply="${key}">${label}</button>`).join('');
    quick.hidden = !buttons.length;
  };
  const replies = {
    ok: { me: 'Одобрить', bot: 'Готово. Оценка <strong>4:00</strong> одобрена — исполнитель начнёт работу и сообщит о результате.', end: true },
    fix: { me: 'Корректировка', bot: 'Сколько часов вы готовы согласовать?', next: [['h3', '3 часа'], ['chat', 'Обсудим в чате']] },
    h3: { me: '3 часа', bot: 'Передал исполнителю: желаемый объём — <strong>3:00</strong>. Новая версия оценки придёт сюда же.', end: true },
    chat: { me: 'Обсудим в чате', bot: 'Хорошо, исполнитель напишет вам в переписке по заявке № 1045.', end: true },
    no: { me: 'Отклонить', bot: 'Оценка отклонена. Исполнитель свяжется, чтобы обсудить объём работ.', end: true }
  };
  quick?.addEventListener('click', async e => {
    const key = e.target.closest('[data-reply]')?.dataset.reply;
    const r = replies[key];
    if (!r) return;
    quick.querySelectorAll('button').forEach(b => { b.disabled = true; });
    addBubble(r.me, true);
    setQuick([]);
    await botSay(r.bot);
    if (r.next) { setQuick(r.next); quick.querySelector('button')?.focus(); }
    if (r.end) { botReset.hidden = false; botReset.focus(); }
  });
  botReset?.addEventListener('click', () => {
    feed.innerHTML = initialFeed;
    quick.innerHTML = initialQuick;
    quick.hidden = false;
    botReset.hidden = true;
    quick.querySelector('button')?.focus();
  });

  /* Cookie: выбор запоминается в браузере */
  const cookie = $('cookie');
  let consent = null;
  try { consent = localStorage.getItem('codari-cookie'); } catch (e) { /* хранилище недоступно */ }
  if (!consent) cookie.hidden = false;
  cookie.addEventListener('click', e => {
    const choice = e.target.closest('[data-cookie]')?.dataset.cookie;
    if (!choice) return;
    try { localStorage.setItem('codari-cookie', choice); } catch (err) { /* хранилище недоступно */ }
    cookie.hidden = true;
  });

  /* Форма демо: тариф из карточки подставляется в заявку */
  const form = $('demo-form');
  const status = $('form-status');
  let plan = '';
  document.querySelectorAll('[data-plan]').forEach(a => a.addEventListener('click', () => { plan = a.dataset.plan; }));
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
