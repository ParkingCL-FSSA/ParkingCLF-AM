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

// Configurazione Email - Usa porta 465 per evitare blocchi
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: { user: 'parkingclf.am@gmail.com', pass: process.env.EMAIL_PASSWORD },
  connectionTimeout: 20000 
});

app.use(express.static(path.join(__dirname, 'public')));

// 1. LOGIN
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    const cleanPass = npass.trim().toUpperCase();
    try {
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [cleanPass]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [cleanPass]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else { res.json({ valid: false }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. PRENOTAZIONE (Invio Mail + PDF + Informativa)
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    try {
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];
        const cleanPass = npass.toUpperCase();

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            const mailUtente = {
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma PASS - ${cleanPass}`,
                html: `<div style="font-family:sans-serif; border:2px solid #3b82f6; border-radius:15px; padding:20px;">
                        <h2 style="color:#3b82f6;">🅿️ Prenotazione Confermata</h2>
                        <p>Il tuo PASS <b>${cleanPass}</b> è in allegato.</p>
                        <p>Valido dal ${new Date(dInizio).toLocaleDateString('it-IT')} al ${new Date(dFine).toLocaleDateString('it-IT')}.</p>
                        <hr><p style="font-size:10px; color:#666;">Informativa: I dati sono trattati solo per fini organizzativi. Non profiliamo né cediamo dati a terzi.</p>
                       </div>`,
                attachments: [{ filename: `PASS_${cleanPass}.pdf`, content: pdfData }]
            };
            try { await transporter.sendMail(mailUtente); } catch (e) { console.error("Errore Mail:", e.message); }
            res.json({ success: true });
        });
        doc.rect(20, 20, 555, 350).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(70).fillColor('black').text(cleanPass, { align: 'center' });
        doc.fontSize(10).fillColor('#999').text("Informativa: I dati sono trattati solo per fini organizzativi...", 20, 340, { align: 'center', width: 555 });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. MIE PRENOTAZIONI (Quella che non vedevi più)
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, data_inizio, data_fine FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. ELIMINA PRENOTAZIONE
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [req.body.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. PIANTONE: CERCA
app.get('/api/piantone/cerca/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
        res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. PIANTONE: AZIONE (Entrata/Uscita)
app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    const stato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    try {
        await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [stato, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. VEICOLI DENTRO
app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        const r = await pool.query(`SELECT npass, TO_CHAR(orario_ingresso, 'DD/MM/YY') as data_accesso, TO_CHAR(orario_ingresso, 'HH24:MI') as ora_ingresso, TO_CHAR(orario_uscita, 'DD/MM/YY - HH24:MI') as data_ora_uscita FROM prenotazioni WHERE stato IN ('INGRESSO', 'USCITO') ORDER BY orario_ingresso DESC LIMIT 15`);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000);