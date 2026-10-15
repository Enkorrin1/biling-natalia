import unittest
import test_flows

service = test_flows.service


class AdminFeedback(unittest.TestCase):
    setUp = test_flows.Flows.setUp

    def tearDown(self):
        # Other suites share this test database and do not create these records.
        with service.db() as conn:
            conn.execute('DELETE FROM ticket_git_links')
            conn.execute('DELETE FROM invoices')

    def test_price_visibility_enforced_across_api_and_restored(self):
        owner = self.customer.get('/api/me').json()['id']
        org = self.admin.post('/api/organizations', json={'name': 'Компания', 'owner_id': owner}).json()['id']
        self.admin.post(f'/api/organizations/{org}/members', json={'email': 'o@example.com'}).raise_for_status()
        ticket = self.other.post('/api/tickets', json={'title': 'Общая заявка', 'description': 'Описание', 'visibility': 'organization'}).json()['id']
        with service.db() as conn:
            conn.execute("""INSERT INTO estimates(ticket_id,author_id,version,amount_minor,assessment_minutes,note,created_at)
                VALUES(?,?,1,900000,20,'Старая денежная оценка',?)""", (ticket, self.staff['id'], service.now()))
        invoice = self.admin.post('/api/billing/invoices', json={'doc_type': 'invoice', 'client_type': 'org', 'client_id': org, 'minutes': 60}).json()['id']
        path = f'/api/organizations/{org}/price-visibility'
        self.assertEqual(self.other.patch(path, json={'hide_prices_from_members': True}).status_code, 403)
        self.assertEqual(self.employee.patch(path, json={'hide_prices_from_members': True}).status_code, 403)
        self.assertEqual(self.other.get(f'/api/tickets/{ticket}').json()['ticket']['hourly_rate_rub'], 3000)
        self.customer.patch(path, json={'hide_prices_from_members': True}).raise_for_status()
        for role in ('member', 'viewer'):
            self.admin.patch(f'/api/organizations/{org}/members/{self.other.get("/api/me").json()["id"]}', json={'role': role}).raise_for_status()
            data = self.other.get(f'/api/tickets/{ticket}').json()['ticket']
            self.assertFalse(data['can_view_prices'])
            legacy = self.other.get(f'/api/tickets/{ticket}').json()['estimates'][0]
            self.assertNotIn('amount_minor', legacy)
            self.assertNotIn('proposed_amount_minor', legacy)
            self.assertIn('approved_minutes', data)
            for key in ('hourly_rate_rub', 'cost_rub', 'service_cost_rub', 'total_cost_rub', 'act_invoice'):
                self.assertNotIn(key, data)
            self.assertNotIn('hourly_rate_rub', self.other.get('/api/organizations').json()[0])
            for url in ('/api/billing/overview', '/api/billing/invoices', f'/api/billing/invoices/{invoice}', f'/api/billing/invoices/{invoice}/print', f'/api/companies/org/{org}/billing'):
                self.assertEqual(self.other.get(url).status_code, 403, url)
                self.assertEqual(self.customer.get(url).status_code, 200, url)
                self.assertEqual(self.admin.get(url).status_code, 200, url)
            self.assertFalse(next(c for c in self.other.get('/api/companies').json() if c['company_key'] == f'org:{org}')['can_view_prices'])
        # The owner can restore access without losing financial or ticket data.
        self.customer.patch(path, json={'hide_prices_from_members': False}).raise_for_status()
        self.assertEqual(self.other.get('/api/billing/overview').status_code, 200)
        self.assertEqual(self.other.get(f'/api/tickets/{ticket}').json()['ticket']['hourly_rate_rub'], 3000)

    def test_git_links_are_internal(self):
        ticket = self.customer.post('/api/tickets', json={'title': 'Ссылки разработки', 'description': 'Описание'}).json()['id']
        self.admin.post(f'/api/tickets/{ticket}/git-links', json={'repo': 'backend', 'ref_type': 'pr', 'ref_id': '42', 'url': 'https://github.com/example/repo/pull/42'}).raise_for_status()
        self.assertEqual(self.customer.get(f'/api/tickets/{ticket}/git-links').status_code, 403)
        self.assertEqual(len(self.admin.get(f'/api/tickets/{ticket}/git-links').json()), 1)
