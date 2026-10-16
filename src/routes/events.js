import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requireRole } from '../auth.js';

const router = Router();

function eventWithStats(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    capacity: row.capacity,
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    registeredCount: row.registered_count,
    spotsLeft: Math.max(row.capacity - row.registered_count, 0),
    createdAt: row.created_at,
  };
}

const BASE_QUERY = `
  SELECT e.*, u.name AS organizer_name,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') AS registered_count
  FROM events e
  JOIN users u ON u.id = e.organizer_id
`;

router.get('/', (req, res) => {
  const { search } = req.query;
  const db = getDb();
  let rows;
  if (search) {
    rows = db
      .prepare(`${BASE_QUERY} WHERE e.title LIKE ? OR e.location LIKE ? ORDER BY e.starts_at ASC`)
      .all(`%${search}%`, `%${search}%`);
  } else {
    rows = db.prepare(`${BASE_QUERY} ORDER BY e.starts_at ASC`).all();
  }
  res.json(rows.map(eventWithStats));
});

router.get('/:id', (req, res) => {
  const row = getDb().prepare(`${BASE_QUERY} WHERE e.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });
  res.json(eventWithStats(row));
});

router.post('/', authenticate, requireRole('organizer'), (req, res, next) => {
  try {
    const { title, description = '', location = '', startsAt, capacity = 100 } = req.body;
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
        'INSERT INTO events (organizer_id, title, description, location, starts_at, capacity) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(req.user.id, title, description, location, startsAt, cap);
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
    const { title = event.title, description = event.description, location = event.location, startsAt = event.starts_at, capacity = event.capacity } = req.body;
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap <= 0) {
      return res.status(400).json({ error: 'capacity must be a positive integer' });
    }
    const db = getDb();
    db.prepare('UPDATE events SET title = ?, description = ?, location = ?, starts_at = ?, capacity = ? WHERE id = ?')
      .run(title, description, location, startsAt, cap, event.id);
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
