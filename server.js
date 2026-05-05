require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SECRET = process.env.JWT_SECRET;

// --- AUTH ---
function authAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role !== 'admin') throw new Error();
    next();
  } catch {
    return res.status(403).json({ error: 'Accesso negato' });
  }
}

// --- LOGIN ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }

  res.status(401).json({ error: 'Credenziali non valide' });
});

// --- PRENOTAZIONE ---
app.post('/api/prenota', async (req, res) => {
  const client = await pool.connect();

  try {
    const { npass, giorni } = req.body;
    const sorted = giorni.sort();
    const dataInizio = sorted[0];
    const dataFine = sorted[sorted.length - 1];

    await client.query('BEGIN');

    const user = await client.query(
      `SELECT r.ente, a.posti
       FROM registro_pass r
       JOIN assegnazioni a ON r.ente=a.ente
       WHERE UPPER(r.npass)=$1 FOR UPDATE`,
      [npass.toUpperCase()]
    );

    if (!user.rows.length) throw new Error('Utente non valido');

    const ente = user.rows[0].ente;
    const postiEnte = user.rows[0].posti;

    const check = await client.query(
      `SELECT COUNT(*) FROM prenotazioni p
       JOIN registro_pass r ON p.npass=r.npass
       WHERE r.ente=$1
       AND p.stato IN ('PRENOTATO','INGRESSO')
       AND $2 BETWEEN p.data_inizio AND p.data_fine`,
      [ente, dataInizio]
    );

    if (parseInt(check.rows[0].count) >= postiEnte)
      throw new Error('Posti esauriti');

    await client.query(
      `INSERT INTO prenotazioni (npass,data_inizio,data_fine,stato)
       VALUES ($1,$2,$3,'PRENOTATO')`,
      [npass, dataInizio, dataFine]
    );

    await client.query('COMMIT');

    broadcast();
    res.json({ success: true });

  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// --- ADMIN ---
app.get('/api/admin/cruscotto', authAdmin, async (req, res) => {
  const r = await pool.query(`SELECT COUNT(*) FROM prenotazioni`);
  res.json({ totale: r.rows[0].count });
});

// --- PIANTONE ---
app.get('/api/piantone/liberi', async (req, res) => {
  const r = await pool.query(
    `SELECT COUNT(*) FROM prenotazioni
     WHERE CURRENT_DATE BETWEEN data_inizio AND data_fine`
  );

  const occupati = parseInt(r.rows[0].count);
  res.json({ totaleLiberi: 120 - occupati });
});

// --- REALTIME ---
async function broadcast() {
  const r = await pool.query(
    `SELECT COUNT(*) FROM prenotazioni
     WHERE CURRENT_DATE BETWEEN data_inizio AND data_fine`
  );

  const occupati = parseInt(r.rows[0].count);
  io.emit('update', { totaleLiberi: 120 - occupati });
}

io.on('connection', () => {
  console.log('Client connesso');
});

server.listen(process.env.PORT);