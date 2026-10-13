"""Enrich the isolated Codari review database without touching production data."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['APP_DB'] = str(ROOT / 'output' / 'codari-review.db')
os.environ['BACKGROUND_JOBS'] = '0'
os.environ['BILLING_ENABLED'] = '1'

import app as domain
from fastapi.testclient import TestClient


def account(email):
    client = TestClient(domain.app)
    client.post('/api/login', json={'email': email, 'password': 'TeamReview123!'}).raise_for_status()
    return client


admin = account('admin@team.demo')
customer = account('client@team.demo')
worker = account('developer@team.demo')
cid = customer.get('/api/me').json()['id']
wid = worker.get('/api/me').json()['id']
with domain.db() as conn:
    membership = domain.customer_organization(conn, cid)
if not membership:
    response = admin.post('/api/organizations', json={'name': 'Северная студия', 'owner_id': cid})
    response.raise_for_status()
    oid = response.json()['id']
else:
    oid = membership['id']

for title, desired in [('Интеграция CRM с кабинетом', 'working'),
                       ('Ежемесячный отчёт по услугам', 'done'),
                       ('Настройка уведомлений команды', 'pending'),
                       ('Доступ к мобильному кабинету', 'new')]:
    with domain.db() as conn:
        existing = conn.execute('SELECT id FROM tickets WHERE title=?', (title,)).fetchone()
    if existing:
        tid = existing['id']
    else:
        response = customer.post('/api/tickets', json={
            'title': title, 'description': 'Согласовать детали и подготовить результат. Обсуждение и файлы сохраняются в карточке заявки.',
            'service_type': 'integration' if desired == 'working' else 'support', 'visibility': 'organization',
        })
        response.raise_for_status()
        tid = response.json()['id']
    admin.patch(f'/api/tickets/{tid}/assignee', json={'assignee_id': wid}).raise_for_status()
    worker.post(f'/api/tickets/{tid}/messages', json={
        'body': 'Изучили задачу. Уточнили объём и подготовили план следующего этапа.',
        'request_id': f'codari-review-worker-{tid}',
    }).raise_for_status()
    customer.post(f'/api/tickets/{tid}/messages', json={
        'body': 'Спасибо! Важно сохранить историю текущих обращений.',
        'request_id': f'codari-review-client-{tid}',
    }).raise_for_status()
    detail = customer.get(f'/api/tickets/{tid}').json()
    if desired != 'new' and not detail['estimates']:
        response = worker.post(f'/api/tickets/{tid}/estimates', json={
            'effort_minutes': 240 if desired == 'working' else 120, 'assessment_minutes': 15,
            'note': 'Подготовка, настройка и проверка результата.',
        })
        response.raise_for_status()
        if desired != 'pending':
            customer.post(f'/api/tickets/{tid}/estimates/decision', json={
                'estimate_id': response.json()['id'], 'action': 'approve',
            }).raise_for_status()
            worker.patch(f'/api/tickets/{tid}/status', json={'status': 'working'}).raise_for_status()
            worker.post(f'/api/tickets/{tid}/time-entries', json={'minutes': 60, 'note': 'Настройка и проверка интеграции'}).raise_for_status()
            if desired == 'done':
                worker.patch(f'/api/tickets/{tid}/status', json={'status': 'done'}).raise_for_status()

chat = customer.post('/api/chats')
chat.raise_for_status()
customer.post(f"/api/chats/{chat.json()['id']}/messages", json={
    'body': 'Добрый день! Можно уточнить план работ на следующую неделю?', 'request_id': 'codari-review-chat-initial',
}).raise_for_status()
with domain.db() as conn:
    exists = conn.execute('SELECT 1 FROM invoices WHERE organization_id=?', (oid,)).fetchone()
if not exists:
    admin.post('/api/billing/invoices', json={
        'doc_type': 'invoice', 'client_type': 'org', 'client_id': oid, 'hours': 20,
        'description': 'Пакет обслуживания на месяц',
    }).raise_for_status()
print('Fictional tickets, company chat and financial documents are ready.')
