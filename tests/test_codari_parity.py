"""Codari-specific regressions around the adapted reference workflows."""
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient
import test_flows

service = test_flows.service


class CodariParity(unittest.TestCase):
    setUp = test_flows.Flows.setUp

    def ticket(self, customer=None, complete=False):
        customer = customer or self.customer
        response = customer.post('/api/tickets', json={
            'title': 'Проверка согласованной работы', 'description': 'Результат для клиента',
        })
        self.assertEqual(response.status_code, 201)
        tid = response.json()['id']
        self.admin.patch(f'/api/tickets/{tid}/assignee', json={'assignee_id': self.staff['id']}).raise_for_status()
        estimate = self.employee.post(f'/api/tickets/{tid}/estimates', json={
            'effort_minutes': 120, 'assessment_minutes': 10,
        })
        estimate.raise_for_status()
        customer.post(f'/api/tickets/{tid}/estimates/decision', json={
            'estimate_id': estimate.json()['id'], 'action': 'approve',
        }).raise_for_status()
        if complete:
            self.employee.patch(f'/api/tickets/{tid}/status', json={'status': 'working'}).raise_for_status()
            self.employee.post(f'/api/tickets/{tid}/time-entries', json={
                'minutes': 60, 'note': 'Выполнена работа',
            }).raise_for_status()
            self.employee.patch(f'/api/tickets/{tid}/status', json={'status': 'done'}).raise_for_status()
        return tid

    def act(self, tids):
        cid = self.customer.get('/api/me').json()['id']
        return self.admin.post('/api/billing/invoices', json={
            'doc_type': 'act', 'client_type': 'user', 'client_id': cid,
            'ticket_ids': tids, 'service_entry_ids': [],
        })

    def test_act_rejects_foreign_and_unfinished_tickets_without_balance_change(self):
        foreign = self.ticket(self.other, complete=True)
        unfinished = self.ticket()
        before = self.customer.get('/api/billing/overview').json()['balance_minutes']
        for tid in (foreign, unfinished, 999999):
            self.assertEqual(self.act([tid]).status_code, 422)
        self.assertEqual(self.customer.get('/api/billing/overview').json()['balance_minutes'], before)
        with service.db() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM invoices').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM billing_transactions').fetchone()[0], 0)

    def test_act_links_completed_ticket_once_and_rejects_second_act(self):
        tid = self.ticket(complete=True)
        response = self.act([tid, tid])
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['total_minutes'], 120)
        self.assertEqual(self.act([tid]).status_code, 422)
        self.assertEqual(self.customer.get('/api/billing/overview').json()['balance_minutes'], -120)

    def test_local_landing_lead_capture_and_workspace_assets_are_preserved(self):
        guest = TestClient(service.app)
        self.assertIn('Codari', guest.get('/landing').text)
        for path in ('/landing.js', '/workspace.css', '/codari.css', '/tour.css', '/tour.js',
                     '/team.js', '/tasks.js', '/icons/icon-192.png'):
            self.assertEqual(guest.get(path).status_code, 200, path)
        payload = {'name': 'Ирина', 'company': 'Студия', 'contact': '@irina',
                   'team_size': '6–20', 'consent': True}
        self.assertEqual(guest.post('/api/demo-requests', json=payload).status_code, 200)
        self.assertEqual(guest.post('/api/demo-requests', json={**payload, 'consent': False}).status_code, 400)

    def test_database_migrations_preserve_existing_work_and_balances(self):
        tid = self.ticket(complete=True)
        self.act([tid]).raise_for_status()
        service.init_db()
        service.init_db()
        self.assertEqual(self.customer.get('/api/billing/overview').json()['balance_minutes'], -120)
        self.assertEqual(self.customer.get(f'/api/tickets/{tid}').status_code, 200)

    def test_billing_is_available_by_default_and_can_be_disabled(self):
        with mock.patch.dict(os.environ):
            os.environ.pop('BILLING_ENABLED', None)
            self.assertTrue(self.customer.get('/api/public/settings').json()['billing_enabled'])
            self.assertEqual(self.customer.get('/api/billing/overview').status_code, 200)
            os.environ['BILLING_ENABLED'] = '0'
            self.assertEqual(self.customer.get('/api/billing/overview').status_code, 404)


if __name__ == '__main__':
    unittest.main()
