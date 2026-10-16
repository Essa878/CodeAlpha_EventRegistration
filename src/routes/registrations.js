import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate } from '../auth.js';

const router = Router();

function registrationView(row) {
  return {
    id: row.id,
    status: row.status,
    registeredAt: row.created_at,
    event: {
      id: row.event_id,
      title: row.title,
      location: row.location,
      startsAt: row.starts_at,
    },
  };
}

const MY_QUERY = `
  SELECT r.*, e.title, e.location, e.starts_at
  FROM registrations r JOIN events e ON e.id = r.event_id
`;

router.get('/registrations/me', authenticate, (req, res) => {
  const rows = getDb()
    .prepare(`${MY_QUERY} WHERE r.user_id = ? ORDER BY e.starts_at ASC`)
    .all(req.user.id);
  res.json(rows.map(registrationView));
});

router.post('/events/:id/register', authenticate, (req, res, next) => {
  try {
    const db = getDb();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const existing = db
      .prepare('SELECT * FROM registrations WHERE event_id = ? AND user_id = ?')
      .get(event.id, req.user.id);

    if (existing && existing.status === 'registered') {
      return res.status(200).json({ ...registrationView({ ...existing, title: event.title, location: event.location, starts_at: event.starts_at }), alreadyRegistered: true });
    }

    if (!existing) {
      const count = db
        .prepare("SELECT COUNT(*) AS c FROM registrations WHERE event_id = ? AND status = 'registered'")
        .get(event.id).c;
      if (count >= event.capacity) {
        return res.status(409).json({ error: 'Event is full' });
      }
      const info = db
        .prepare('INSERT INTO registrations (event_id, user_id, status) VALUES (?, ?, ?)')
        .run(event.id, req.user.id, 'registered');
      const row = db.prepare(`${MY_QUERY} WHERE r.id = ?`).get(info.lastInsertRowid);
      return res.status(201).json(registrationView(row));
    }

    const count = db
      .prepare("SELECT COUNT(*) AS c FROM registrations WHERE event_id = ? AND status = 'registered'")
      .get(event.id).c;
    if (count >= event.capacity) {
      return res.status(409).json({ error: 'Event is full' });
    }
    db.prepare("UPDATE registrations SET status = 'registered' WHERE id = ?").run(existing.id);
    const row = db.prepare(`${MY_QUERY} WHERE r.id = ?`).get(existing.id);
    return res.status(200).json(registrationView(row));
  } catch (err) {
    return next(err);
  }
});

function cancelRegistration(req, res) {
  const db = getDb();
  const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(req.params.id);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  if (reg.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only manage your own registrations' });
  }
  db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(reg.id);
  return res.json({ id: reg.id, status: 'cancelled' });
}

router.delete('/registrations/:id', authenticate, cancelRegistration);
router.post('/registrations/:id/cancel', authenticate, cancelRegistration);

export default router;
