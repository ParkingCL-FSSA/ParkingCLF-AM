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

// Configurazione Mail - Porta 587 con timeout brevi per evitare blocchi del server
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: { user: 'parkingclf.am@gmail.com', pass: process.env.EMAIL_PASSWORD },
  connectionTimeout: 5000, 
  socketTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// --- 1. LOGIN ---
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    const cleanPass = npass?.trim().toUpperCase();
    if (!cleanPass) return res.json({ valid: false });
    try {
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [cleanPass]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [cleanPass]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else res.json({ valid: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. PRENOTAZIONE (Logica Utente + Admin) ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (!giorni || giorni.length === 0) return res.status(400).json({ error: "Date non selezionate" });

    try {
        const cleanPass = npass.toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // CONTROLLO ACCAVALLAMENTO (Punto Critico)
        const check = await pool.query(
            "SELECT id FROM prenotazioni WHERE UPPER(npass) = $1 AND stato != 'USCITO' AND (data_inizio, data_fine) OVERLAPS ($2::DATE, $3::DATE)",
            [cleanPass, dInizio, dFine]
        );

        if (check.rows.length > 0) {
            return res.status(400).json({ error: "ERRORE: Date già occupate per questo PASS!" });
        }

        // SALVATAGGIO
        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        // RISPOSTA IMMEDIATA (Sito veloce)
        res.json({ success: true });

        // GESTIONE EMAIL (Senza attendere risposta)
        gestioneEmailBackground(cleanPass, dInizio, dFine, email);

    } catch (err) {
        console.error("Errore DB:", err.message);
        res.status(500).json({ error: "Errore interno" });
    }
});

async function gestioneEmailBackground(npass, inizio, fine, emailUtente) {
    try {
        const doc = new PDFDocument({ size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            // 1. MAIL PER L'UTENTE (Con PASS)
            const mailUtente = {
                from: '"Parking CLF" <parkingclf.am@gmail.com>',
                to: emailUtente,
                subject: `Conferma PASS ${npass}`,
                html: `<p>Prenotazione confermata per il PASS <b>${npass}</b>.</p><p>Valido dal ${inizio} al ${fine}.</p>`,
                attachments: [{ filename: `PASS_${npass}.pdf`, content: pdfData }]
            };

            // 2. MAIL PER L'AMMINISTRATORE (Notifica)
            const mailAdmin = {
                from: '"Sistema Parking" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `NUOVA PRENOTAZIONE: ${npass}`,
                text: `L'utente con PASS ${npass} ha prenotato dal ${inizio} al ${fine}. Email utente: ${emailUtente}`
            };

            // Invio protetto da timeout
            try { await transporter.sendMail(mailUtente); } catch (e) { console.log("Timeout Mail Utente ignorato."); }
            try { await transporter.sendMail(mailAdmin); } catch (e) { console.log("Timeout Mail Admin ignorato."); }
        });

        // Contenuto PDF
        doc.fontSize(20).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(50).text(npass, { align: 'center' });
        doc.fontSize(12).text(`Valido: ${inizio} / ${fine}`, { align: 'center' });
        doc.fontSize(8).text('Dati trattati solo per fini organizzativi.', 20, 350, { align: 'center' });
        doc.end();

    } catch (err) { console.error("Errore Background Process."); }
}

// --- 3. ALTRE ROTTE (Mie Prenotazioni, Piantone, Veicoli) ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.post('/api/elimina-prenotazione', async (req, res) => {
    await pool.query('DELETE FROM prenotazioni WHERE id = $1', [req.body.id]);
    res.json({ success: true });
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [azione === 'E' ? 'INGRESSO' : 'USCITO', id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, TO_CHAR(orario_ingresso, 'DD/MM HH24:MI') as data_accesso FROM prenotazioni WHERE stato = 'INGRESSO' ORDER BY orario_ingresso DESC");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);