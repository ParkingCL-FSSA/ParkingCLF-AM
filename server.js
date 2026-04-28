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

// Configurazione Mail con Timeout estremo e fallback sulla 587
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // STARTTLS
  auth: { 
    user: 'parkingclf.am@gmail.com', 
    pass: process.env.EMAIL_PASSWORD 
  },
  connectionTimeout: 5000, // Non aspettare più di 5 secondi
  greetingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// --- 1. LOGIN (Corretto con ult_accesso) ---
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

// --- 2. PRENOTAZIONE (Anti-Accavallamento + Risposta Rapida) ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (!giorni || giorni.length === 0) return res.status(400).json({ error: "Date mancanti" });

    try {
        const cleanPass = npass.toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // CONTROLLO SOVRAPPOSIZIONE RIGIDO
        const check = await pool.query(
            `SELECT id FROM prenotazioni 
             WHERE UPPER(npass) = $1 
             AND stato != 'USCITO' 
             AND NOT (data_fine < $2::DATE OR data_inizio > $3::DATE)`,
            [cleanPass, dInizio, dFine]
        );

        if (check.rows.length > 0) {
            return res.status(400).json({ error: "Attenzione: Hai già una prenotazione attiva che si sovrappone a queste date!" });
        }

        // SALVATAGGIO DB
        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        // RISPOSTA IMMEDIATA AL SITO
        res.json({ success: true });

        // TENTATIVO INVIO MAIL IN "FIRE AND FORGET" (Non blocca il server)
        inviaMailSilenziosa(cleanPass, dInizio, dFine, email);

    } catch (err) {
        console.error("Errore critico:", err.message);
        res.status(500).json({ error: "Errore durante il salvataggio" });
    }
});

// Funzione interna per gestire la mail senza crashare se c'è timeout
async function inviaMailSilenziosa(npass, inizio, fine, email) {
    try {
        const doc = new PDFDocument();
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            try {
                await transporter.sendMail({
                    from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                    to: email,
                    subject: `Conferma PASS ${npass}`,
                    html: `<p>Prenotazione confermata per <b>${npass}</b> dal ${inizio} al ${fine}.</p><br><small>Informativa: Dati trattati solo per fini organizzativi.</small>`,
                    attachments: [{ filename: `PASS_${npass}.pdf`, content: pdfData }]
                });
                console.log("✅ Mail inviata con successo.");
            } catch (e) { console.error("⚠️ Mail non inviata (Timeout/SMTP), ma prenotazione salvata."); }
        });
        doc.text(`PASS PARCHEGGIO: ${npass}`, { align: 'center', size: 30 });
        doc.end();
    } catch (err) { console.error("❌ Errore generazione PDF."); }
}

// --- 3. ALTRE FUNZIONI (Ripristinate e Pulite) ---
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
    const r = await pool.query(`SELECT npass, TO_CHAR(orario_ingresso, 'DD/MM HH24:MI') as data_accesso FROM prenotazioni WHERE stato = 'INGRESSO' ORDER BY orario_ingresso DESC`);
    res.json(r.rows);
});

app.listen(process.env.PORT || 3000);