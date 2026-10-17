import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requireRole, optionalAuth } from '../auth.js';

const router = Router();

const BASE_QUERY = `
  SELECT e.*, u.name AS organizer_name,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') AS registered_count
  FROM events e
  JOIN users u ON u.id = e.organizer_id
`;

function eventWithStats(row, { userId = null } = {}) {
  const view = {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    category: row.category,
    startsAt: row.starts_at,
    capacity: row.capacity,
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    registeredCount: row.registered_count,
    spotsLeft: Math.max(row.capacity - row.registered_count, 0),
    isPast: new Date(row.starts_at).getTime() < Date.now(),
    createdAt: row.created_at,
  };
  if (userId != null) {
    const reg = getDb()
      .prepare("SELECT id, status FROM registrations WHERE event_id = ? AND user_id = ?")
      .get(row.id, userId);
    view.isRegistered = !!(reg && reg.status === 'registered');
    view.myRegistrationId = reg && reg.status === 'registered' ? reg.id : null;
  }
  return view;
}

router.get('/', optionalAuth, (req, res) => {
  const { search, category, when, organizerId } = req.query;
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ? OR e.category LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (category) {
    clauses.push('e.category LIKE ?');
    params.push(`%${category}%`);
  }
  if (when === 'upcoming') clauses.push('e.starts_at >= datetime(\'now\')');
  if (when === 'past') clauses.push('e.starts_at < datetime(\'now\')');
  if (organizerId) {
    clauses.push('e.organizer_id = ?');
    params.push(Number(organizerId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().prepare(`${BASE_QUERY} ${where} ORDER BY e.starts_at ASC`).all(...params);
  res.json(rows.map((row) => eventWithStats(row, { userId: req.user?.id ?? null })));
});

router.get('/mine', authenticate, requireRole('organizer'), (req, res) => {
  const rows = getDb()
    .prepare(`${BASE_QUERY} WHERE e.organizer_id = ? ORDER BY e.starts_at ASC`)
    .all(req.user.id);
  res.json(rows.map((row) => eventWithStats(row)));
});

router.get('/stats', authenticate, requireRole('organizer'), (req, res) => {
  const db = getDb();
  const events = db.prepare('SELECT id, starts_at FROM events WHERE organizer_id = ?').all(req.user.id);
  const ids = events.map((e) => e.id);
  let totalRegistrations = 0;
  let totalAttendees = 0;
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    totalRegistrations = db
      .prepare(`SELECT COUNT(*) AS c FROM registrations WHERE event_id IN (${placeholders}) AND status = 'registered'`)
      .get(...ids).c;
    totalAttendees = db
      .prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM registrations WHERE event_id IN (${placeholders}) AND status = 'registered'`)
      .get(...ids).c;
  }
  const now = Date.now();
  res.json({
    totalEvents: events.length,
    upcomingEvents: events.filter((e) => new Date(e.starts_at).getTime() >= now).length,
    pastEvents: events.filter((e) => new Date(e.starts_at).getTime() < now).length,
    totalRegistrations,
    uniqueAttendees: totalAttendees,
  });
});

router.get('/:id', optionalAuth, (req, res) => {
  const row = getDb().prepare(`${BASE_QUERY} WHERE e.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });
  res.json(eventWithStats(row, { userId: req.user?.id ?? null }));
});

router.post('/', authenticate, requireRole('organizer'), (req, res, next) => {
  try {
    const { title, description = '', location = '', category = '', startsAt, capacity = 100 } = req.body;
    if (!title || !startsAt) {
      return res.status(400).json({ error: 'title and startsAt are required' });
    }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap <= 0) {
      return res.status(400).json({ error: 'capacity must be a positive integer' });
    }
    const db = getDb();
    const info = db
      .prepare(
        'INSERT INTO events (organizer_id, title, description, location, category, starts_at, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(req.user.id, title, description, location, category, startsAt, cap);
    const row = db.prepare(`${BASE_QUERY} WHERE e.id = ?`).get(info.lastInsertRowid);
    res.status(201).json(eventWithStats(row));
  } catch (err) {
    next(err);
  }
});

function loadOwnedEvent(req, res) {
  const event = getDb().prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return null;
  }
  if (event.organizer_id !== req.user.id) {
    res.status(403).json({ error: 'You can only manage your own events' });
    return null;
  }
  return event;
}

router.put('/:id', authenticate, requireRole('organizer'), (req, res, next) => {
  try {
    const event = loadOwnedEvent(req, res);
    if (!event) return undefined;
    const {
      title = event.title,
      description = event.description,
      location = event.location,
      category = event.category,
      startsAt = event.starts_at,
      capacity = event.capacity,
    } = req.body;
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap <= 0) {
      return res.status(400).json({ error: 'capacity must be a positive integer' });
    }
    const db = getDb();
    db.prepare('UPDATE events SET title = ?, description = ?, location = ?, category = ?, starts_at = ?, capacity = ? WHERE id = ?')
      .run(title, description, location, category, startsAt, cap, event.id);
    const row = db.prepare(`${BASE_QUERY} WHERE e.id = ?`).get(event.id);
    return res.json(eventWithStats(row));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', authenticate, requireRole('organizer'), (req, res) => {
  const event = loadOwnedEvent(req, res);
  if (!event) return undefined;
  getDb().prepare('DELETE FROM events WHERE id = ?').run(event.id);
  return res.json({ deleted: true, id: event.id });
});

router.get('/:id/registrations', authenticate, requireRole('organizer'), (req, res) => {
  const event = loadOwnedEvent(req, res);
  if (!event) return undefined;
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.status, r.created_at, u.id AS user_id, u.name, u.email
       FROM registrations r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? ORDER BY r.created_at ASC`
    )
    .all(event.id);
  return res.json(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      registeredAt: r.created_at,
      user: { id: r.user_id, name: r.name, email: r.email },
    }))
  );
});

export default router;
