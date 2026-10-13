"""Client/company -> project -> ticket hierarchy and a single scoped activity inbox.

Company keys reuse existing billing ownership (org:<id> or user:<id>), so adding
projects never changes account balances or the visibility of existing tickets.
"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Cookie, HTTPException
from pydantic import BaseModel, Field


def init_schema(conn):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS client_projects (
            id INTEGER PRIMARY KEY,
            organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','completed','archived')),
            default_key TEXT UNIQUE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK((organization_id IS NULL) != (customer_id IS NULL))
        );
        CREATE TABLE IF NOT EXISTS hierarchy_events (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id INTEGER REFERENCES client_projects(id) ON DELETE CASCADE,
            organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
        );
    ''')
    columns = {r[1] for r in conn.execute('PRAGMA table_info(tickets)')}
    if 'project_id' not in columns:
        conn.execute('ALTER TABLE tickets ADD COLUMN project_id INTEGER REFERENCES client_projects(id) ON DELETE SET NULL')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id,status)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_hierarchy_events_user ON hierarchy_events(user_id,read_at,id)')
    # Only unlinked records are migrated; user-chosen projects survive every restart.
    for ticket in conn.execute('SELECT id,organization_id,customer_id FROM tickets WHERE project_id IS NULL').fetchall():
        pid = default_project(conn, ticket['organization_id'], ticket['customer_id'])
        conn.execute('UPDATE tickets SET project_id=? WHERE id=?', (pid, ticket['id']))


def default_project(conn, organization_id, customer_id):
    key = f'org:{organization_id}' if organization_id else f'user:{customer_id}'
    row = conn.execute('SELECT id FROM client_projects WHERE default_key=?', (key,)).fetchone()
    if row:
        return row['id']
    stamp = datetime.now(timezone.utc).isoformat()
    return conn.execute('''INSERT INTO client_projects(organization_id,customer_id,name,description,default_key,created_at,updated_at)
        VALUES(?,?,'Общие обращения','Обращения без отдельного проекта',?,?,?)''',
        (organization_id, None if organization_id else customer_id, key, stamp, stamp)).lastrowid


def company_key(row):
    return f"org:{row['organization_id']}" if row['organization_id'] else f"user:{row['customer_id']}"


def company_context(conn, key):
    try:
        kind, raw = key.split(':')
        cid = int(raw)
        if cid <= 0 or kind not in ('org', 'user'):
            raise ValueError()
    except (ValueError, AttributeError):
        raise HTTPException(422, 'Некорректная компания')
    if kind == 'org':
        row = conn.execute('SELECT id,name FROM organizations WHERE id=?', (cid,)).fetchone()
    else:
        row = conn.execute("SELECT u.id,COALESCE(NULLIF(p.company_name,''),u.name) AS name FROM users u LEFT JOIN customer_profiles p ON p.user_id=u.id WHERE u.id=? AND u.role='customer'", (cid,)).fetchone()
    if not row:
        raise HTTPException(404, 'Компания не найдена')
    return {'company_key': key, 'company_name': row['name'], 'client_type': kind, 'client_id': cid,
            'organization_id': cid if kind == 'org' else None, 'customer_id': cid if kind == 'user' else None,
            'account_type': 'company' if kind == 'org' else 'individual'}


def can_company(conn, user, key, domain, write=False):
    ctx = company_context(conn, key)
    if user['role'] == 'customer':
        if ctx['client_type'] == 'user':
            return ctx['client_id'] == user['id']
        member = conn.execute('SELECT role FROM organization_members WHERE organization_id=? AND user_id=?', (ctx['client_id'], user['id'])).fetchone()
        return bool(member and (not write or member['role'] != 'viewer'))
    if domain.team_management.privileged(user):
        return True
    cids = [ctx['client_id']] if ctx['client_type'] == 'user' else [r[0] for r in conn.execute('SELECT user_id FROM organization_members WHERE organization_id=?', (ctx['client_id'],))]
    return (not write or domain.team_management.has_permission(conn, user, 'tasks')) and any(domain.team_management.client_visible(conn, user, cid) for cid in cids)


def project_for(conn, user, pid, domain, write=False):
    row = conn.execute('SELECT * FROM client_projects WHERE id=?', (pid,)).fetchone()
    if not row:
        raise HTTPException(404, 'Проект не найден')
    accessible = can_company(conn, user, company_key(row), domain, write)
    if not accessible and not write and user['role'] != 'customer':
        for ticket in conn.execute('SELECT id FROM tickets WHERE project_id=?', (pid,)):
            try:
                domain.ticket_for(conn, ticket['id'], user, write=False)
                accessible = True
                break
            except HTTPException:
                pass
    if not accessible:
        raise HTTPException(404, 'Проект не найден')
    return row


def ticket_context(conn, ticket):
    item = dict(ticket)
    key = company_key(ticket)
    ctx = company_context(conn, key)
    project = conn.execute('SELECT id,name,state FROM client_projects WHERE id=?', (item.get('project_id'),)).fetchone()
    return {**ctx, 'project_id': project['id'] if project else None,
            'project_name': project['name'] if project else None, 'project_state': project['state'] if project else None,
            'ticket_title': item.get('title', ''), 'target_url': f"/#ticket/{item['id']}"}


def assign_ticket(conn, ticket_id, user, domain, project_id=None):
    ticket = conn.execute('SELECT * FROM tickets WHERE id=?', (ticket_id,)).fetchone()
    if project_id is None:
        pid = default_project(conn, ticket['organization_id'], ticket['customer_id'])
    else:
        project = project_for(conn, user, project_id, domain, write=True)
        if project['state'] != 'active':
            raise HTTPException(409, 'Новые заявки создаются только в активном проекте')
        if company_key(project) != company_key(ticket):
            raise HTTPException(422, 'Проект должен принадлежать компании выбранного заказчика')
        pid = project['id']
    conn.execute('UPDATE tickets SET project_id=? WHERE id=?', (pid, ticket_id))
    return pid


def visible_tickets(conn, user, pid, domain):
    result = []
    for row in conn.execute('SELECT id FROM tickets WHERE project_id=? ORDER BY updated_at DESC,id DESC', (pid,)):
        try:
            result.append(dict(domain.ticket_for(conn, row['id'], user, write=False)))
        except HTTPException:
            pass
    return result


def project_data(conn, row, user, domain):
    tickets = visible_tickets(conn, user, row['id'], domain)
    return {**dict(row), **company_context(conn, company_key(row)),
            'ticket_count': len(tickets), 'open_count': sum(t['status'] != 'closed' for t in tickets),
            'approved_minutes': sum(domain.approved_minutes(conn, t['id']) for t in tickets),
            'actual_minutes': sum(domain.actual_minutes(conn, t['id']) for t in tickets),
            'can_manage': domain.team_management.privileged(user) or can_company(conn, user, company_key(row), domain, True),
            'can_create_ticket': row['state'] == 'active' and can_company(conn, user, company_key(row), domain, True)}


def publish(conn, domain, key, kind, text, actor_id, project_id=None, invoice_id=None):
    ctx = company_context(conn, key)
    recipients = {r[0] for r in conn.execute("SELECT id FROM users WHERE active=1 AND (role='admin' OR is_manager=1)")}
    if ctx['client_type'] == 'org':
        recipients.update(r[0] for r in conn.execute('SELECT user_id FROM organization_members WHERE organization_id=?', (ctx['client_id'],)))
    else:
        recipients.add(ctx['client_id'])
    for uid in recipients - {actor_id}:
        conn.execute('''INSERT INTO hierarchy_events(user_id,project_id,organization_id,customer_id,invoice_id,kind,text,created_at)
            VALUES(?,?,?,?,?,?,?,?)''', (uid,project_id,ctx['organization_id'],ctx['customer_id'],invoice_id,kind,text,domain.now()))
        domain.realtime_bus.publish(uid, {'type': 'notification', 'target': 'project' if project_id else 'invoice' if invoice_id else 'company', 'kind': kind, 'text': text})


class ProjectCreate(BaseModel):
    company_key: str = Field(max_length=50)
    name: str = Field(min_length=2, max_length=140)
    description: str = Field(default='', max_length=5000)


class ProjectPatch(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    description: str = Field(default='', max_length=5000)
    state: Literal['active','completed','archived'] = 'active'
    version: str


class TicketProject(BaseModel):
    project_id: int = Field(gt=0)


class ReadActivity(BaseModel):
    keys: list[str] = Field(max_length=2000)


def inbox(conn, user, domain):
    items = []
    for row in conn.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC', (user['id'],)):
        try:
            ticket = domain.ticket_for(conn, row['ticket_id'], user, write=False)
            ctx = ticket_context(conn, ticket)
            estimate = domain.latest_estimate(conn, ticket['id'])
            action = bool(domain.customer_can_decide(conn,ticket,user) and (ticket['status']=='done' or estimate and estimate['state']=='pending' or conn.execute("SELECT 1 FROM hour_requests WHERE ticket_id=? AND state='pending'", (ticket['id'],)).fetchone())) if user['role']=='customer' else bool(ticket['assignee_id']==user['id'] and ticket['status'] not in ('done','closed'))
            items.append({**dict(row), **ctx, 'target':'ticket','record_id':ticket['id'],
                          'event_key':f"ticket:{row['id']}",'text':domain.customer_notification_text(row['text'],user), 'requires_action':action})
        except HTTPException:
            continue
    for row in conn.execute('SELECT * FROM chat_notifications WHERE user_id=? ORDER BY id DESC', (user['id'],)):
        try:
            chat = domain.chat_for(conn,row['chat_id'],user)
            ctx = company_context(conn, company_key(chat))
            items.append({**dict(row),**ctx,'project_id':None,'project_name':None,'target':'chat','record_id':chat['id'],
                          'event_key':f"chat:{row['id']}",'target_url':f"/#chat/{chat['id']}",'text':domain.customer_notification_text(row['text'],user),'requires_action':False})
        except HTTPException:
            continue
    if user['role'] != 'customer':
        for row in conn.execute('SELECT * FROM team_notifications WHERE user_id=? ORDER BY id DESC',(user['id'],)):
            kind = row['entity']
            if kind not in ('tasks','meetings','deals'):
                continue
            try:
                record = domain.team_record_for(conn,user,kind,row['entity_id'])
                ctx = {'company_key':'internal','company_name':'Внутренняя работа','project_id':None,'project_name':None}
                if record['customer_id']:
                    membership = domain.customer_organization(conn,record['customer_id'])
                    ctx = company_context(conn, f"org:{membership['id']}" if membership else f"user:{record['customer_id']}")
                if kind in ('tasks','meetings') and record['ticket_id']:
                    try:
                        ctx = ticket_context(conn,domain.ticket_for(conn,record['ticket_id'],user,write=False))
                    except HTTPException:
                        pass
                items.append({**dict(row),**ctx,'target':kind,'record_id':record['id'],'event_key':f"team:{row['id']}",
                              'text':record['title'],'kind':dict(row).get('event_kind') or 'assignment',
                              'target_url':f"/#task/{record['id']}" if kind=='tasks' else f"/#team/{kind}/{record['id']}",'requires_action':True})
            except HTTPException:
                continue
    for row in conn.execute('SELECT * FROM hierarchy_events WHERE user_id=? ORDER BY id DESC',(user['id'],)):
        try:
            ctx = company_context(conn,company_key(row))
            if not can_company(conn,user,ctx['company_key'],domain):
                continue
            target, rid, url = 'company',ctx['company_key'],f"/#company/{ctx['company_key']}"
            if row['project_id']:
                p = project_for(conn,user,row['project_id'],domain)
                ctx.update(project_id=p['id'],project_name=p['name'])
                target,rid,url='project',p['id'],f"/#project/{p['id']}"
            elif row['invoice_id']:
                if user['role']!='customer':
                    domain.require_finance(user)
                target,rid,url='invoice',row['invoice_id'],f"/#invoice/{row['invoice_id']}"
            items.append({**dict(row),**ctx,'target':target,'record_id':rid,'event_key':f"workspace:{row['id']}",'target_url':url,'requires_action':False})
        except HTTPException:
            continue
    return sorted(items,key=lambda r:(r['created_at'],r['event_key']),reverse=True)


def install_routes(app, domain):
    router = APIRouter(prefix='/api')

    @router.get('/companies')
    def companies(desk_session: str | None = Cookie(default=None)):
        user = domain.current_user(desk_session)
        with domain.db() as conn:
            keys = [f"org:{r[0]}" for r in conn.execute('SELECT id FROM organizations')]
            keys += [f"user:{r[0]}" for r in conn.execute("SELECT u.id FROM users u WHERE role='customer' AND (NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.user_id=u.id) OR EXISTS(SELECT 1 FROM tickets t WHERE t.customer_id=u.id AND t.organization_id IS NULL) OR EXISTS(SELECT 1 FROM client_projects p WHERE p.customer_id=u.id))")]
            result = []
            for key in keys:
                if not can_company(conn,user,key,domain):
                    continue
                ctx = company_context(conn,key)
                rows = conn.execute('SELECT * FROM client_projects WHERE organization_id=?' if ctx['client_type']=='org' else 'SELECT * FROM client_projects WHERE customer_id=?',(ctx['client_id'],)).fetchall()
                projects = [project_data(conn,p,user,domain) for p in rows]
                result.append({**ctx,'projects':projects,'project_count':len(projects),
                               'open_count':sum(p['open_count'] for p in projects),
                               'can_create_project':can_company(conn,user,key,domain,True)})
            return sorted(result,key=lambda c:c['company_name'].casefold())

    @router.get('/projects')
    def projects(company: str | None = None, desk_session: str | None = Cookie(default=None)):
        user = domain.current_user(desk_session)
        with domain.db() as conn:
            result = []
            for row in conn.execute('SELECT * FROM client_projects ORDER BY updated_at DESC,id DESC'):
                if company and company_key(row)!=company:
                    continue
                try:
                    project_for(conn,user,row['id'],domain)
                    result.append(project_data(conn,row,user,domain))
                except HTTPException:
                    pass
            return result

    @router.post('/projects', status_code=201)
    def create_project(data: ProjectCreate, desk_session: str | None = Cookie(default=None)):
        user = domain.current_user(desk_session)
        name = data.name.strip()
        if len(name)<2:
            raise HTTPException(422,'Укажите название проекта')
        with domain.db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            ctx = company_context(conn,data.company_key)
            if not can_company(conn,user,data.company_key,domain,True):
                raise HTTPException(403,'Нет права создавать проекты компании')
            duplicate = conn.execute('SELECT 1 FROM client_projects WHERE COALESCE(organization_id,0)=? AND COALESCE(customer_id,0)=? AND lower(name)=lower(?) AND state!=\'archived\'',(ctx['organization_id'] or 0,ctx['customer_id'] or 0,name)).fetchone()
            if duplicate:
                raise HTTPException(409,'В компании уже есть проект с таким названием')
            stamp=domain.now()
            pid=conn.execute('INSERT INTO client_projects(organization_id,customer_id,name,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(ctx['organization_id'],ctx['customer_id'],name,data.description.strip(),user['id'],stamp,stamp)).lastrowid
            publish(conn,domain,data.company_key,'project_created',f'Создан проект «{name}»',user['id'],pid)
            return project_data(conn,project_for(conn,user,pid,domain),user,domain)

    @router.get('/projects/{pid}')
    def read_project(pid: int, desk_session: str | None = Cookie(default=None)):
        user=domain.current_user(desk_session)
        with domain.db() as conn:
            p=project_for(conn,user,pid,domain)
            ids={t['id'] for t in visible_tickets(conn,user,pid,domain)}
            # The ticket list uses the established visibility and calculation rules.
        tickets=[t for t in domain.tickets(desk_session) if t['id'] in ids]
        with domain.db() as conn:
            p=project_for(conn,user,pid,domain)
            return {'project':project_data(conn,p,user,domain),'tickets':tickets}

    @router.patch('/projects/{pid}')
    def update_project(pid: int, data: ProjectPatch, desk_session: str | None = Cookie(default=None)):
        user=domain.current_user(desk_session)
        with domain.db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row=project_for(conn,user,pid,domain,True)
            if row['updated_at']!=data.version:
                raise HTTPException(409,'Проект изменён другим пользователем. Обновите страницу')
            if len(data.name.strip())<2:
                raise HTTPException(422,'Укажите название проекта')
            if data.state=='completed' and conn.execute("SELECT 1 FROM tickets WHERE project_id=? AND status!='closed'",(pid,)).fetchone():
                raise HTTPException(409,'Сначала закройте все заявки проекта и получите приёмку')
            conn.execute('UPDATE client_projects SET name=?,description=?,state=?,updated_at=? WHERE id=?',(data.name.strip(),data.description.strip(),data.state,domain.now(),pid))
            publish(conn,domain,company_key(row),'project_changed',f'Обновлён проект «{data.name.strip()}»',user['id'],pid)
            return project_data(conn,project_for(conn,user,pid,domain),user,domain)

    @router.put('/tickets/{tid}/project')
    def move_ticket(tid: int, data: TicketProject, desk_session: str | None = Cookie(default=None)):
        user=domain.current_user(desk_session)
        with domain.db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            ticket=domain.ticket_for(conn,tid,user,write=False)
            if not domain.team_management.privileged(user) and not domain.customer_can_decide(conn,ticket,user):
                raise HTTPException(403,'Проект заявки меняет руководитель или согласующий заказчик')
            if ticket['project_id']==data.project_id:
                return dict(ticket)
            assign_ticket(conn,tid,user,domain,data.project_id)
            conn.execute('INSERT INTO ticket_events(ticket_id,actor_id,kind,old_value,new_value,created_at) VALUES(?,?,?,?,?,?)',(tid,user['id'],'project_changed',str(ticket['project_id']),str(data.project_id),domain.now()))
            for uid in domain.customer_recipients(conn,ticket):
                if uid!=user['id']:
                    domain.notify(conn,uid,tid,'project_changed',f'Заявка №{tid} перенесена в другой проект')
            return dict(domain.ticket_for(conn,tid,user,write=False))

    @router.get('/activity')
    def activity(desk_session: str | None = Cookie(default=None)):
        user=domain.current_user(desk_session)
        with domain.db() as conn:
            items=inbox(conn,user,domain)
            return {'items':items,'unread_total':sum(not n['read_at'] for n in items)}

    @router.post('/activity/read')
    def read_activity(data: ReadActivity, desk_session: str | None = Cookie(default=None)):
        user=domain.current_user(desk_session)
        with domain.db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            visible={n['event_key'] for n in inbox(conn,user,domain)}
            if any(key not in visible for key in data.keys):
                raise HTTPException(404,'Уведомление недоступно. Обновите список')
            tables={'ticket':'notifications','chat':'chat_notifications','team':'team_notifications','workspace':'hierarchy_events'}
            for key in set(data.keys):
                kind,rid=key.split(':')
                conn.execute(f'UPDATE {tables[kind]} SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?',(domain.now(),int(rid),user['id']))
            domain.realtime_bus.publish(user['id'],{'type':'activity_read'})
        return {'read':len(set(data.keys))}

    app.include_router(router)
