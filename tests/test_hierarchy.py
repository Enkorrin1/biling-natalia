import unittest
from fastapi.testclient import TestClient
import test_flows

service = test_flows.service


class Hierarchy(unittest.TestCase):
    setUp = test_flows.Flows.setUp

    def setup_company(self):
        owner=self.customer.get('/api/me').json()['id']
        r=self.admin.post('/api/organizations',json={'name':'Компания проекта','owner_id':owner})
        self.assertEqual(r.status_code,201,r.text)
        oid=r.json()['id']
        self.admin.post(f'/api/organizations/{oid}/members',json={'email':'o@example.com','role':'member'}).raise_for_status()
        return oid

    def project(self, key, name='Интеграция CRM'):
        response=self.admin.post('/api/projects',json={'company_key':key,'name':name,'description':'Общий результат проекта'})
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def ticket(self, project=None, client=None, visibility='private'):
        payload={'title':'Проверка иерархии','description':'Результат для клиента','visibility':visibility}
        if project is not None:payload['project_id']=project['id']
        response=(client or self.customer).post('/api/tickets',json=payload)
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def test_customers_cannot_create_projects(self):
        cid = self.customer.get('/api/me').json()['id']
        oid = self.setup_company()
        for client in (self.customer, self.other):
            for key in (f'user:{cid}', f'org:{oid}'):
                with self.subTest(key=key, customer=client.get('/api/me').json()['id']):
                    before = self.admin.get('/api/projects').json()
                    response = client.post('/api/projects', json={'company_key': key, 'name': 'Новый проект'})
                    self.assertEqual(response.status_code, 403, response.text)
                    self.assertEqual(self.admin.get('/api/projects').json(), before)
            self.assertTrue(all(not c['can_create_project'] for c in client.get('/api/companies').json()))
        self.assertTrue(next(c for c in self.admin.get('/api/companies').json() if c['company_key'] == f'org:{oid}')['can_create_project'])
        p = self.project(f'org:{oid}')
        self.ticket(p)

    def test_individual_customer_cannot_create_projects(self):
        cid = self.customer.get('/api/me').json()['id']
        self.assertFalse(next(c for c in self.customer.get('/api/companies').json() if c['company_key'] == f'user:{cid}')['can_create_project'])
        response = self.customer.post('/api/projects', json={'company_key': f'user:{cid}', 'name': 'Новый проект'})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.customer.get('/api/projects').json(), [])
        self.ticket(self.project(f'user:{cid}'))

    def test_legacy_creation_and_migration_always_link_to_default_project(self):
        before=self.customer.get('/api/billing/overview').json()['balance_minutes']
        t=self.ticket()
        self.assertIsNotNone(t['project_id'])
        self.assertEqual(t['project_name'],'Общие обращения')
        service.init_db();service.init_db()
        after=self.customer.get(f"/api/tickets/{t['id']}").json()['ticket']
        self.assertEqual(after['project_id'],t['project_id'])
        self.assertEqual(self.customer.get('/api/billing/overview').json()['balance_minutes'],before)

    def test_company_project_ticket_context_and_private_visibility(self):
        oid=self.setup_company();p=self.project(f'org:{oid}')
        private=self.ticket(p)
        shared=self.ticket(p,visibility='organization')
        member=self.other.get(f"/api/projects/{p['id']}")
        self.assertEqual(member.status_code,200)
        self.assertEqual([t['id'] for t in member.json()['tickets']],[shared['id']])
        self.assertEqual(member.json()['project']['ticket_count'],1)
        self.assertEqual(self.other.get(f"/api/tickets/{private['id']}").status_code,404)
        self.assertEqual(shared['company_key'],f'org:{oid}')
        self.assertEqual(shared['project_id'],p['id'])

    def test_member_creates_requests_but_owner_manages_project(self):
        oid=self.setup_company();p=self.project(f'org:{oid}')
        self.ticket(p,self.other,'organization')
        payload={'name':'Изменено','description':'','state':'active','version':p['updated_at']}
        self.assertEqual(self.other.patch(f"/api/projects/{p['id']}",json=payload).status_code,403)
        self.assertEqual(self.other.post('/api/projects',json={'company_key':f'org:{oid}','name':'Новый проект'}).status_code,403)
        self.admin.patch(f'/api/organizations/{oid}/members/{self.other.get("/api/me").json()["id"]}',json={'role':'viewer'}).raise_for_status()
        self.assertEqual(self.other.post('/api/tickets',json={'title':'Нельзя создать','description':'Проверка наблюдателя','visibility':'organization','project_id':p['id']}).status_code,403)

    def test_cross_company_project_injection_rolls_back_request(self):
        cid=self.customer.get('/api/me').json()['id'];other=self.other.get('/api/me').json()['id']
        p=self.project(f'user:{other}')
        response=self.customer.post('/api/tickets',json={'title':'Чужой проект','description':'Не должен сохраняться','project_id':p['id']})
        self.assertIn(response.status_code,(404,422))
        self.assertEqual(self.customer.get('/api/tickets').json(),[])
        self.assertEqual(self.customer.get('/api/projects').json(),[])
        self.assertNotIn(f'user:{other}',[c['company_key'] for c in self.customer.get('/api/companies').json()])

    def test_staff_can_not_read_foreign_project_or_activity(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}')
        self.ticket(p)
        self.assertEqual(self.employee.get(f"/api/projects/{p['id']}").status_code,404)
        self.assertEqual(self.employee.get('/api/activity').json()['items'],[])

    def test_move_preserves_hours_and_history_and_forbids_other_company(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}');q=self.project(f'user:{cid}',name='Поддержка')
        t=self.ticket(p)
        self.admin.patch(f"/api/tickets/{t['id']}/assignee",json={'assignee_id':self.staff['id']}).raise_for_status()
        self.employee.post(f"/api/tickets/{t['id']}/estimates",json={'effort_minutes':120,'assessment_minutes':15}).raise_for_status()
        r=self.customer.put(f"/api/tickets/{t['id']}/project",json={'project_id':q['id']})
        self.assertEqual(r.status_code,200,r.text)
        detail=self.customer.get(f"/api/tickets/{t['id']}").json()
        self.assertEqual(detail['ticket']['project_id'],q['id']);self.assertEqual(len(detail['estimates']),1)
        self.assertEqual(detail['events'][-1]['kind'],'project_changed')
        other=self.other.get('/api/me').json()['id'];foreign=self.project(f'user:{other}')
        self.assertEqual(self.admin.put(f"/api/tickets/{t['id']}/project",json={'project_id':foreign['id']}).status_code,422)

    def test_archive_blocks_creation_preserves_existing_ticket_and_can_reopen(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}');t=self.ticket(p)
        path=f"/api/projects/{p['id']}";payload={'name':p['name'],'description':'','state':'completed','version':p['updated_at']}
        self.assertEqual(self.customer.patch(path,json=payload).status_code,409)
        payload['state']='archived';r=self.customer.patch(path,json=payload)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.customer.get(f"/api/tickets/{t['id']}").status_code,200)
        self.assertEqual(self.customer.post('/api/tickets',json={'title':'Новая работа','description':'В архивный проект','project_id':p['id']}).status_code,409)
        payload.update(state='active',version=r.json()['updated_at']);self.customer.patch(path,json=payload).raise_for_status()

    def test_stale_project_edit_does_not_overwrite_newer_changes(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}')
        payload={'name':'Первое изменение','description':'','state':'active','version':p['updated_at']}
        self.customer.patch(f"/api/projects/{p['id']}",json=payload).raise_for_status()
        payload['name']='Устаревшее изменение'
        self.assertEqual(self.customer.patch(f"/api/projects/{p['id']}",json=payload).status_code,409)

    def test_inbox_uses_unique_keys_and_read_scope_is_atomic(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}');t=self.ticket(p)
        self.admin.patch(f"/api/tickets/{t['id']}/assignee",json={'assignee_id':self.staff['id']}).raise_for_status()
        self.employee.post(f"/api/tickets/{t['id']}/messages",json={'body':'Ответ по работе','request_id':'hierarchy-message-1'}).raise_for_status()
        chat=self.customer.post('/api/chats').json();self.admin.patch(f"/api/chats/{chat['id']}/assignee",json={'assignee_id':self.staff['id']}).raise_for_status()
        self.employee.post(f"/api/chats/{chat['id']}/messages",json={'body':'Общий ответ','request_id':'hierarchy-chat-1'}).raise_for_status()
        notices=self.customer.get('/api/activity').json()
        keys=[n['event_key'] for n in notices['items']]
        self.assertEqual(len(keys),len(set(keys)))
        ticket_notice=next(n for n in notices['items'] if n['target']=='ticket')
        self.assertEqual(ticket_notice['project_id'],p['id'])
        self.assertEqual(ticket_notice['company_key'],f'user:{cid}')
        self.assertEqual(ticket_notice['target_url'],f"/#ticket/{t['id']}")
        before=notices['unread_total']
        self.assertEqual(self.customer.post('/api/activity/read',json={'keys':[keys[0],'ticket:999999']}).status_code,404)
        self.assertEqual(self.customer.get('/api/activity').json()['unread_total'],before)
        self.customer.post('/api/activity/read',json={'keys':keys}).raise_for_status()
        self.assertEqual(self.customer.get('/api/activity').json()['unread_total'],0)

    def test_revoked_company_member_loses_project_and_notifications(self):
        oid=self.setup_company();p=self.project(f'org:{oid}');t=self.ticket(p,visibility='organization')
        self.assertTrue(self.other.get('/api/activity').json()['items'])
        uid=self.other.get('/api/me').json()['id']
        self.admin.delete(f'/api/organizations/{oid}/members/{uid}').raise_for_status()
        self.assertEqual(self.other.get(f"/api/projects/{p['id']}").status_code,404)
        self.assertEqual(self.other.get('/api/activity').json()['items'],[])

    def test_financial_document_notices_belong_to_company_not_fake_project(self):
        cid=self.customer.get('/api/me').json()['id']
        response=self.admin.post('/api/billing/invoices',json={'doc_type':'invoice','client_type':'user','client_id':cid,'hours':5})
        self.assertEqual(response.status_code,201)
        notice=next(n for n in self.customer.get('/api/activity').json()['items'] if n['target']=='invoice')
        self.assertEqual(notice['company_key'],f'user:{cid}')
        self.assertIsNone(notice['project_id'])
        self.assertEqual(notice['target_url'],f"/#invoice/{response.json()['id']}")

    def test_read_only_ticket_participant_can_read_parent_and_mark_event(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}');t=self.ticket(p)
        self.admin.put(f"/api/team/tickets/{t['id']}/participants",json={'members':[{'user_id':self.staff['id'],'participation':'observer'}]}).raise_for_status()
        with service.db() as conn:service.notify(conn,self.staff['id'],t['id'],'message','Новое событие')
        self.assertEqual(self.employee.get(f"/api/projects/{p['id']}").status_code,200)
        self.assertIn(f'user:{cid}',[c['company_key'] for c in self.employee.get('/api/companies').json()])
        events=self.employee.get('/api/activity').json()['items']
        self.employee.post('/api/activity/read',json={'keys':[e['event_key'] for e in events]}).raise_for_status()

    def test_company_finance_scope_preserves_personal_account_after_joining_company(self):
        cid=self.customer.get('/api/me').json()['id']
        personal=self.admin.post('/api/billing/invoices',json={'doc_type':'invoice','client_type':'user','client_id':cid,'hours':2}).json()
        oid=self.setup_company()
        company=self.admin.post('/api/billing/invoices',json={'doc_type':'invoice','client_type':'org','client_id':oid,'hours':3}).json()
        roots=self.customer.get('/api/companies').json()
        self.assertIn(f'user:{cid}',[c['company_key'] for c in roots])
        self.assertFalse(next(c for c in roots if c['company_key']==f'user:{cid}')['can_create_ticket'])
        self.customer.get(f"/api/billing/invoices/{personal['id']}").raise_for_status()
        for client in (self.customer,self.admin):
            direct=client.get(f'/api/companies/user/{cid}/billing');direct.raise_for_status()
            shared=client.get(f'/api/companies/org/{oid}/billing');shared.raise_for_status()
            self.assertEqual([d['id'] for d in direct.json()['invoices']],[personal['id']])
            self.assertEqual([d['id'] for d in shared.json()['invoices']],[company['id']])
        self.assertEqual(self.other.get(f'/api/companies/user/{cid}/billing').status_code,404)
        self.assertEqual(self.employee.get(f'/api/companies/org/{oid}/billing').status_code,404)

    def test_payment_event_once_and_action_resolves_for_old_invoice_notice(self):
        cid=self.customer.get('/api/me').json()['id']
        doc=self.admin.post('/api/billing/invoices',json={'doc_type':'invoice','client_type':'user','client_id':cid,'hours':2}).json()
        first=self.customer.get('/api/activity').json()['items']
        self.assertTrue(next(n for n in first if n['target']=='invoice')['requires_action'])
        path=f"/api/billing/invoices/{doc['id']}/status"
        self.admin.patch(path,json={'status':'paid'}).raise_for_status()
        notices=self.customer.get('/api/activity').json()['items']
        self.assertFalse(any(n['requires_action'] for n in notices if n['target']=='invoice'))
        self.admin.patch(path,json={'status':'paid'}).raise_for_status()
        self.assertEqual(len(self.customer.get('/api/activity').json()['items']),len(notices))

    def test_chat_conversion_selects_project_and_notice_opens_created_request(self):
        cid=self.customer.get('/api/me').json()['id'];p=self.project(f'user:{cid}')
        chat=self.customer.post('/api/chats').json()
        message=self.customer.post(f"/api/chats/{chat['id']}/messages",json={'body':'Нужна интеграция портала','request_id':'hierarchy-convert'}).json()
        response=self.admin.post(f"/api/chats/{chat['id']}/tickets",json={'title':'Интеграция портала','message_id':message['id'],'project_id':p['id']})
        self.assertEqual(response.status_code,201,response.text)
        tid=response.json()['id']
        self.assertEqual(self.customer.get(f'/api/tickets/{tid}').json()['ticket']['project_id'],p['id'])
        notice=next(n for n in self.customer.get('/api/activity').json()['items'] if n['kind']=='ticket_created')
        self.assertEqual(notice['target'],'ticket')
        self.assertEqual(notice['record_id'],tid)
        self.assertEqual(notice['project_id'],p['id'])


if __name__=='__main__':unittest.main()
