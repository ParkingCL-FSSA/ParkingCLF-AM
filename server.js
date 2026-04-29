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

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, 
  auth: {
    user: 'parkingclf.am@gmail.com',
    pass: process.env.EMAIL_PASSWORD 
  },
  pool: true,
  connectionTimeout: 10000,
  socketTimeout: 20000
});

app.use(express.static(path.join(__dirname, 'public')));

// LOGIN CORRETTO (Senza la colonna mancante ultimo_accesso)
app.post('/api/valida-pass', async (req, res) => {
    try {
        const { npass } = req.body;
        if (!npass) return res.json({ valid: false });
        
        const cleanPass = npass.trim().toUpperCase();
        // Cerchiamo solo il ruolo, senza provare a fare UPDATE
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [cleanPass]);
        
        if (result.rows.length > 0) {
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) {
        console.error("Errore Login:", err);
        res.status(500).json({ error: "Errore database" });
    }
});

// PRENOTAZIONE
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const cleanPass = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            await transporter.sendMail({
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma e PASS - ${cleanPass}`,
                html: `<div style="font-family:sans-serif; border:2px solid #3b82f6; padding:20px; border-radius:15px;">
                        <h2>🅿️ Prenotazione Confermata</h2>
                        <p>In allegato il PASS per: <b>${new Date(dInizio).toLocaleDateString('it-IT')} - ${new Date(dFine).toLocaleDateString('it-IT')}</b></p>
                       </div>`,
                attachments: [{ filename: `PASS_${cleanPass}.pdf`, content: pdfData }]
            });

            await transporter.sendMail({
                from: '"Sistema" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `🔔 Nuova: ${cleanPass}`,
                html: `<p>Prenotazione: <b>${cleanPass}</b> (${email})</p>`
            });

            res.json({ success: true });
        });

        doc.rect(20, 20, 555, 300).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(70).fillColor('black').text(cleanPass, { align: 'center' });
        doc.moveDown().fontSize(20).text(`${new Date(dInizio).toLocaleDateString('it-IT')} - ${new Date(dFine).toLocaleDateString('it-IT')}`, { align: 'center' });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DISDETTA
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
        await transporter.sendMail({
            from: '"Sistema" <parkingclf.am@gmail.com>',
            to: 'parkingclf.am@gmail.com',
            subject: `⚠️ DISDETTA - ${npass.toUpperCase()}`,
            html: `<p>Il Pass <b>${npass.toUpperCase()}</b> ha cancellato la prenotazione.</p>`
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ROTTE VARCO
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
    const stato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [stato, id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO'");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);
          
