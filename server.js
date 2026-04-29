const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CONFIGURAZIONE BREVO (Addio Timeout Gmail)
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: "a9a951001@smtp-brevo.com",
    pass: process.env.EMAIL_PASSWORD // Assicurati di aver messo la chiave Brevo su Render
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// LOGIN CORRETTO (Senza colonne mancanti)
app.post('/api/valida-pass', async (req, res) => {
    try {
        const { npass } = req.body;
        if (!npass) return res.json({ valid: false });
        const cleanPass = npass.trim().toUpperCase();
        
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [cleanPass]);
        
        if (result.rows.length > 0) {
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) {
        console.error("Errore Login:", err.message);
        res.status(500).json({ error: "Errore database" });
    }
});

// PRENOTAZIONE
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const p = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            try {
                await transporter.sendMail({
                    from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                    to: email,
                    subject: `Conferma e PASS - ${p}`,
                    html: `<h2>Prenotazione Confermata</h2><p>PASS: <b>${p}</b></p>`,
                    attachments: [{ filename: `PASS_${p}.pdf`, content: pdfData }]
                });
            } catch (e) { console.error("Errore Mail:", e.message); }
            res.json({ success: true });
        });
        doc.fontSize(25).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(70).text(p, { align: 'center' });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DISDETTA
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
        try {
            await transporter.sendMail({
                from: '"Sistema" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `⚠️ DISDETTA - ${npass.toUpperCase()}`,
                html: `<p>Il Pass ${npass.toUpperCase()} ha cancellato.</p>`
            });
        } catch (e) {}
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// VARCO
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE LIMIT 1', [req.params.npass.toUpperCase()]);
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${azione === 'E' ? 'orario_ingresso' : 'orario_uscita'} = NOW() WHERE id = $2`, [azione === 'E' ? 'INGRESSO' : 'USCITO', id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO'");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);
