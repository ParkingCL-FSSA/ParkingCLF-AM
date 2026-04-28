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
  service: 'gmail',
  auth: { user: 'parkingclf.am@gmail.com', pass: process.env.EMAIL_PASSWORD }
});

app.use(express.static(path.join(__dirname, 'public')));

// LOGIN con aggiornamento database
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    try {
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
        if (result.rows.length > 0) {
            try {
                await pool.query('UPDATE registro_pass SET ultimo_accesso = NOW() WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
            } catch (e) { console.error("Errore update ultimo_accesso:", e.message); }
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PRENOTAZIONE con controllo sovrapposizione e doppia email
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    try {
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // CONTROLLO SOVRAPPOSIZIONE (Punto 2 richiesto)
        const check = await pool.query(
            'SELECT id FROM prenotazioni WHERE UPPER(npass) = $1 AND stato != $2 AND (data_inizio, data_fine) OVERLAPS ($3, $4)',
            [npass.toUpperCase(), 'USCITO', dInizio, dFine]
        );
        if (check.rows.length > 0) return res.status(400).json({ error: "Hai già una prenotazione in questo periodo!" });

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [npass.toUpperCase(), dInizio, dFine, 'PRENOTATO']);
        
        try {
            await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [npass.toUpperCase()]);
        } catch (e) { console.error("Errore update ult_pren:", e.message); }

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            const mailUtente = {
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma e PASS - ${npass.toUpperCase()}`,
                html: `<h3>Prenotazione Confermata</h3><p>In allegato il tuo PASS per il periodo ${new Date(dInizio).toLocaleDateString('it-IT')} - ${new Date(dFine).toLocaleDateString('it-IT')}.</p>`,
                attachments: [{ filename: `PASS_${npass.toUpperCase()}.pdf`, content: pdfData }]
            };
            await transporter.sendMail(mailUtente);

            const mailNotificaAdmin = {
                from: '"Sistema Parcheggio" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `🔔 Nuova Prenotazione - ${npass.toUpperCase()}`,
                html: `<p><b>Pass:</b> ${npass.toUpperCase()}<br><b>Periodo:</b> ${new Date(dInizio).toLocaleDateString('it-IT')} al ${new Date(dFine).toLocaleDateString('it-IT')}<br><b>Email:</b> ${email}</p>`
            };
            await transporter.sendMail(mailNotificaAdmin);

            res.json({ success: true });
        });

        doc.rect(20, 20, 555, 300).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown();
        doc.fontSize(60).fillColor('black').text(npass.toUpperCase(), { align: 'center' });
        doc.moveDown();
        doc.fontSize(22).text(`DAL ${new Date(dInizio).toLocaleDateString('it-IT')} AL ${new Date(dFine).toLocaleDateString('it-IT')}`, { align: 'center', bold: true });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ELIMINA e Notifica
app.post('/api/elimina-prenotazione', async (req, res) => {
    const { id, npass } = req.body;
    try {
        const info = await pool.query('SELECT data_inizio, data_fine FROM prenotazioni WHERE id = $1', [id]);
        if (info.rows.length > 0) {
            await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
            const mailDisdetta = {
                from: '"Sistema Parcheggio" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `⚠️ DISDETTA - ${npass}`,
                html: `<p>Cancellata prenotazione Pass ${npass} del periodo ${new Date(info.rows[0].data_inizio).toLocaleDateString('it-IT')} - ${new Date(info.rows[0].data_fine).toLocaleDateString('it-IT')}.</p>`
            };
            await transporter.sendMail(mailDisdetta);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// VEICOLI DENTRO (Aggiornato per Immagine 2)
app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT npass, 
                   TO_CHAR(orario_ingresso, 'DD/MM/YY') as data_accesso,
                   TO_CHAR(orario_ingresso, 'HH24:MI') as ora_ingresso,
                   TO_CHAR(orario_uscita, 'DD/MM/YY - HH24:MI') as data_ora_uscita
            FROM prenotazioni 
            WHERE stato IN ('INGRESSO', 'USCITO')
            ORDER BY orario_ingresso DESC LIMIT 15
        `);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${azione === 'E' ? 'orario_ingresso' : 'orario_uscita'} = NOW() WHERE id = $2`, [azione === 'E' ? 'INGRESSO' : 'USCITO', id]);
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000);