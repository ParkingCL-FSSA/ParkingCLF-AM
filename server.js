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

// Configurazione Email (Porta 587 è più stabile su Render per evitare i Timeout)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // TLS
  auth: { 
    user: 'parkingclf.am@gmail.com', 
    pass: process.env.EMAIL_PASSWORD 
  },
  connectionTimeout: 10000,
  socketTimeout: 10000
});

app.use(express.static(path.join(__dirname, 'public')));

// --- 1. LOGIN ---
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

// --- 2. PRENOTAZIONE (VELOCE + ANTI-ACCAVALLAMENTO) ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (!giorni || giorni.length === 0) return res.status(400).json({ error: "Seleziona date" });

    try {
        const cleanPass = npass.toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // CONTROLLO ACCAVALLAMENTO (Punto 2)
        const check = await pool.query(
            "SELECT id FROM prenotazioni WHERE UPPER(npass) = $1 AND stato != 'USCITO' AND (data_inizio, data_fine) OVERLAPS ($2::DATE, $3::DATE)",
            [cleanPass, dInizio, dFine]
        );

        if (check.rows.length > 0) {
            return res.status(400).json({ error: "Periodo già occupato per questo PASS!" });
        }

        // SALVATAGGIO DB
        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        // RISPOSTA IMMEDIATA (Risolve la lentezza del sito)
        res.json({ success: true });

        // INVIO MAIL ASINCRONO (Background)
        inviaPassViaMail(cleanPass, dInizio, dFine, email).catch(e => console.error("Errore Mail Background:", e.message));

    } catch (err) {
        console.error("Errore Prenotazione:", err.message);
        res.status(500).json({ error: "Errore interno" });
    }
});

// Funzione Background Mail
async function inviaPassViaMail(npass, inizio, fine, email) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
        const pdfData = Buffer.concat(buffers);
        const mailOptions = {
            from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
            to: email,
            subject: `PASS ${npass} - Conferma Prenotazione`,
            html: `<h3>Prenotazione Confermata</h3><p>In allegato il PASS per ${npass}.</p>
                   <p>Dal ${new Date(inizio).toLocaleDateString('it-IT')} al ${new Date(fine).toLocaleDateString('it-IT')}</p>
                   <p style="font-size:10px; color:gray;">Informativa: I dati sono trattati solo per fini organizzativi. Non profiliamo né cediamo dati a terzi.</p>`,
            attachments: [{ filename: `PASS_${npass}.pdf`, content: pdfData }]
        };
        await transporter.sendMail(mailOptions);
        console.log(`✅ Mail inviata a ${email}`);
    });
    // Grafica PDF
    doc.rect(20, 20, 555, 300).lineWidth(3).stroke('#3b82f6');
    doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
    doc.moveDown().fontSize(60).fillColor('black').text(npass, { align: 'center' });
    doc.fontSize(10).fillColor('gray').text("Informativa: Dati trattati solo per fini organizzativi.", 20, 280, { align: 'center' });
    doc.end();
}

// --- 3. GESTIONE LISTE ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, data_inizio, data_fine FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [req.body.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. PIANTONE / CONTROLLO SBARRA ---
app.get('/api/piantone/cerca/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
        res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    const stato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    try {
        await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [stato, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT npass, 
            TO_CHAR(orario_ingresso, 'DD/MM/YY') as data_accesso, 
            TO_CHAR(orario_ingresso, 'HH24:MI') as ora_ingresso, 
            TO_CHAR(orario_uscita, 'DD/MM/YY - HH24:MI') as data_ora_uscita 
            FROM prenotazioni WHERE stato IN ('INGRESSO', 'USCITO') 
            ORDER BY orario_ingresso DESC LIMIT 15`);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Server avviato"));