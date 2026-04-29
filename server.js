const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

// Connessione Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Configurazione Mail (Ottimizzata per evitare i timeout visti nei log)
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

// --- 1. ROTTA LOGIN (CORRETTA) ---
app.post('/api/valida-pass', async (req, res) => {
    try {
        const { npass } = req.body;
        if (!npass) return res.json({ valid: false });
        
        const cleanPass = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [cleanPass]);
        
        if (result.rows.length > 0) {
            // Aggiorna ultimo accesso
            await pool.query('UPDATE registro_pass SET ultimo_accesso = NOW() WHERE UPPER(npass) = $1', [cleanPass]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) {
        console.error("Errore Login:", err);
        res.status(500).json({ error: "Errore database" });
    }
});

// --- 2. PRENOTAZIONE + DOPPIA MAIL ---
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const cleanPass = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // Inserimento DB
        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        // Generazione PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // Mail Utente (con PDF e Privacy)
            const mailUtente = {
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma e PASS - ${cleanPass}`,
                html: `<div style="font-family:sans-serif; border:2px solid #3b82f6; padding:20px; border-radius:15px;">
                        <h2>🅿️ Prenotazione Confermata</h2>
                        <p>In allegato il PASS per il periodo: <b>${new Date(dInizio).toLocaleDateString('it-IT')} - ${new Date(dFine).toLocaleDateString('it-IT')}</b></p>
                        <p style="font-size:10px; color:gray; margin-top:20px; border-top:1px solid #eee; padding-top:10px;">
                        <i>Informativa: I dati sono trattati esclusivamente per la gestione tecnica della sosta aziendale.</i></p>
                       </div>`,
                attachments: [{ filename: `PASS_${cleanPass}.pdf`, content: pdfData }]
            };

            // Notifica Admin (Leggera, senza PDF)
            const mailAdmin = {
                from: '"Sistema" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `🔔 Nuova: ${cleanPass}`,
                html: `<p>Nuova prenotazione: <b>${cleanPass}</b><br>Email: ${email}<br>Periodo: ${dInizio} / ${dFine}</p>`
            };

            try {
                await transporter.sendMail(mailUtente);
                await transporter.sendMail(mailAdmin);
            } catch (e) { console.error("Errore Invio Mail:", e.message); }

            res.json({ success: true });
        });

        // Grafica PDF
        doc.rect(20, 20, 555, 300).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(70).fillColor('black').text(cleanPass, { align: 'center' });
        doc.moveDown().fontSize(20).text(`${new Date(dInizio).toLocaleDateString('it-IT')} - ${new Date(dFine).toLocaleDateString('it-IT')}`, { align: 'center' });
        doc.end();

    } catch (err) {
        console.error("Errore Prenotazione:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- 3. DISDETTA CON NOTIFICA ---
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        const cleanPass = npass.trim().toUpperCase();

        const info = await pool.query('SELECT data_inizio, data_fine FROM prenotazioni WHERE id = $1', [id]);
        
        if (info.rows.length > 0) {
            await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
            
            // Notifica Disdetta a te
            await transporter.sendMail({
                from: '"Sistema" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `⚠️ DISDETTA - ${cleanPass}`,
                html: `<p>L'utente <b>${cleanPass}</b> ha cancellato la prenotazione per il periodo richiesto.</p>`
            });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. GESTIONE VARCO E UTENTE ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
        res.json(r.rows);
    } catch (err) { res.status(500).json([]); }
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
        res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
    } catch (err) { res.status(500).json({ trovato: false }); }
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    const stato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [stato, id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO' ORDER BY orario_ingresso DESC");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000, () => {
    console.log("Server in esecuzione sulla porta 10000");
});
