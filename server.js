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

// CONFIGURAZIONE PORTA 587 (Spesso più stabile su Render rispetto alla 465)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // false per porta 587
  auth: {
    user: 'parkingclf.am@gmail.com',
    pass: process.env.EMAIL_PASSWORD 
  },
  tls: {
    rejectUnauthorized: false // Evita blocchi sui certificati
  },
  connectionTimeout: 10000 // Se non risponde in 10 secondi, rinuncia invece di crashare
});

app.use(express.static(path.join(__dirname, 'public')));

// LOGIN SEMPLIFICATO (Senza update che causano errori)
app.post('/api/valida-pass', async (req, res) => {
    try {
        const { npass } = req.body;
        if (!npass) return res.json({ valid: false });
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        res.json({ valid: result.rows.length > 0, ruolo: result.rows[0]?.ruolo });
    } catch (err) {
        console.error("Errore DB:", err.message);
        res.status(500).json({ error: "Errore database" });
    }
});

// PRENOTAZIONE CON GESTIONE ERRORE MAIL
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const p = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // Usiamo try/catch interno per le mail: se falliscono, l'utente vede comunque "Successo" sul sito
            try {
                await transporter.sendMail({
                    from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                    to: email,
                    subject: `Conferma PASS - ${p}`,
                    html: `<p>Prenotazione confermata per ${p}</p>`,
                    attachments: [{ filename: `PASS_${p}.pdf`, content: pdfData }]
                });

                await transporter.sendMail({
                    from: '"Sistema" <parkingclf.am@gmail.com>',
                    to: 'parkingclf.am@gmail.com',
                    subject: `🔔 Nuova: ${p}`,
                    html: `<p>Nuova prenotazione: ${p} (${email})</p>`
                });
            } catch (mailErr) {
                console.error("Mail non inviata (Timeout), ma prenotazione salvata:", mailErr.message);
            }

            res.json({ success: true });
        });

        doc.fontSize(25).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.fontSize(60).text(p, { align: 'center' });
        doc.fontSize(20).text(`${dInizio} - ${dFine}`, { align: 'center' });
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
                html: `<p>Pass ${npass.toUpperCase()} ha cancellato.</p>`
            });
        } catch (e) {}
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ALTRE ROTTE
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
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [azione === 'E' ? 'INGRESSO' : 'USCITO', id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO'");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000, () => console.log("Server Online"));
                  
