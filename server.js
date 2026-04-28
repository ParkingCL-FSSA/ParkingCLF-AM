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

// LOGIN con tracciamento accesso
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    try {
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
        if (result.rows.length > 0) {
            try {
                await pool.query('UPDATE registro_pass SET ultimo_accesso = NOW() WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
            } catch (e) { console.error("Errore aggiornamento ultimo_accesso:", e.message); }
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PRENOTAZIONE con invio PDF all'utente e notifica leggera a te
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (giorni.length > 15) return res.status(400).json({ error: "Limite 15 giorni superato" });

    try {
        const sorted = giorni.sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [npass.toUpperCase(), dataInizio, dataFine, 'PRENOTATO']);
        
        try {
            await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [npass.toUpperCase()]);
        } catch (e) { console.error("Errore aggiornamento ult_pren:", e.message); }

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            // 1. EMAIL PER L'UTENTE (Con Allegato)
            const mailUtente = {
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma e PASS - ${npass.toUpperCase()}`,
                html: `
                    <div style="font-family:sans-serif; border:2px solid #3b82f6; border-radius:15px; padding:20px; max-width:600px;">
                        <h2 style="color:#3b82f6;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                        <p>Gentile utente, la tua prenotazione è confermata.</p>
                        <p><b>In allegato trovi il PASS da stampare ed esporre sul parabrezza.</b></p>
                        <hr>
                        <p>Periodo: dal ${new Date(dataInizio).toLocaleDateString('it-IT')} al ${new Date(dataFine).toLocaleDateString('it-IT')}</p>
                        <div style="margin-top:30px; padding-top:10px; border-top:1px solid #eee; font-size:10px; color:#999;">
                            <p><i>Informativa: I dati forniti sono trattati esclusivamente per la gestione tecnica della sosta. Il sistema non profila gli utenti e non cede dati a terzi.</i></p>
                        </div>
                    </div>`,
                attachments: [{ filename: `PASS_${npass.toUpperCase()}.pdf`, content: pdfData }]
            };
            await transporter.sendMail(mailUtente);

            // 2. EMAIL DI NOTIFICA PER TE (Senza Allegato)
            const mailNotificaAdmin = {
                from: '"Sistema Parcheggio" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `🔔 Nuova Prenotazione - ${npass.toUpperCase()}`,
                html: `<h3>Nuova Prenotazione Ricevuta</h3><p><b>Pass:</b> ${npass.toUpperCase()}</p><p><b>Periodo:</b> dal ${new Date(dataInizio).toLocaleDateString('it-IT')} al ${new Date(dataFine).toLocaleDateString('it-IT')}</p><p><b>Email Utente:</b> ${email}</p>`
            };
            await transporter.sendMail(mailNotificaAdmin);

            res.json({ success: true });
        });

        // Generazione grafica del PDF
        doc.rect(20, 20, 555, 300).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown();
        doc.fontSize(60).fillColor('black').text(npass.toUpperCase(), { align: 'center' });
        doc.moveDown();
        doc.fontSize(20).text(`PERIODO DI SOSTA:`, { align: 'center' });
        doc.fontSize(22).text(`DAL ${new Date(dataInizio).toLocaleDateString('it-IT')} AL ${new Date(dataFine).toLocaleDateString('it-IT')}`, { align: 'center', bold: true });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DISDETTA con notifica email
app.post('/api/elimina-prenotazione', async (req, res) => {
    const { id, npass } = req.body;
    try {
        const info = await pool.query('SELECT data_inizio, data_fine FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);
        
        if (info.rows.length > 0) {
            const { data_inizio, data_fine } = info.rows[0];
            await pool.query('DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);

            const mailDisdetta = {
                from: '"Sistema Parcheggio" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `⚠️ DISDETTA - ${npass.toUpperCase()}`,
                html: `<h3 style="color:red;">Prenotazione Cancellata</h3><p>L'utente con Pass <b>${npass.toUpperCase()}</b> ha annullato la sosta dal ${new Date(data_inizio).toLocaleDateString('it-IT')} al ${new Date(data_fine).toLocaleDateString('it-IT')}.</p>`
            };
            await transporter.sendMail(mailDisdetta);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Altre rotte (mie-prenotazioni, piantone, admin) rimangono invariate...
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const ora = new Date();
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${azione === 'E' ? 'orario_ingresso' : 'orario_uscita'} = $2 WHERE id = $3`, [azione === 'E' ? 'INGRESSO' : 'USCITO', ora, id]);
    res.json({ success: true });
});

app.get('/api/admin/cruscotto', async (req, res) => {
    const query = `WITH giorni AS (SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '44 days', '1 day')::date AS d)
                   SELECT g.d AS data, COUNT(p.id) AS occupati FROM giorni g LEFT JOIN prenotazioni p ON g.d BETWEEN p.data_inizio AND p.data_fine
                   GROUP BY g.d ORDER BY g.d;`;
    const r = await pool.query(query);
    res.json(r.rows.map(row => ({ data: new Date(row.data).toLocaleDateString('it-IT'), occupati: parseInt(row.occupati), liberi: 120 - parseInt(row.occupati) })));
});

app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        // Recupera gli ultimi movimenti (sia dentro che usciti di recente per la cronologia)
        const r = await pool.query(`
            SELECT npass, 
                   TO_CHAR(orario_ingresso, 'DD/MM/YY') as data_accesso,
                   TO_CHAR(orario_ingresso, 'HH24:MI') as ora_ingresso,
                   TO_CHAR(orario_uscita, 'DD/MM/YY - HH24:MI') as data_ora_uscita
            FROM prenotazioni 
            WHERE stato IN ('INGRESSO', 'USCITO')
            ORDER BY orario_ingresso DESC LIMIT 10
        `);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000);