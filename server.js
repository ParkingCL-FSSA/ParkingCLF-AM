const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// FUNZIONE INVIO MAIL CON GRAFICA
async function inviaMailBrevoAPI(toEmail, subject, htmlContent, pdfBuffer = null, fileName = "") {
    try {
        const payload = {
            sender: { name: "Parcheggio C.L. Fontanarossa", email: "parkingclf.am@gmail.com" },
            to: [{ email: toEmail }],
            subject: subject,
            htmlContent: htmlContent
        };
        if (pdfBuffer) {
            payload.attachment = [{ content: pdfBuffer.toString('base64'), name: fileName }];
        }
        await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
            headers: { 'api-key': process.env.EMAIL_PASSWORD, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Errore invio mail:", error.response ? error.response.data : error.message);
    }
}

// --- ROTTE ---

// 1. POSTI DISPONIBILI (Risolve IMG 3)
app.get('/api/posti-disponibili', async (req, res) => {
    try {
        const totalePosti = 100; // Cambia con il tuo numero reale
        const oggi = new Date().toISOString().split('T')[0];
        const result = await pool.query(
            "SELECT COUNT(*) FROM prenotazioni WHERE data_inizio <= $1 AND data_fine >= $1", 
            [oggi]
        );
        const occupati = parseInt(result.rows[0].count);
        res.json({ disponibili: totalePosti - occupati, totali: totalePosti });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. PRENOTAZIONE CON GRAFICA (Risolve IMG 1 e 2)
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
            
            // EMAIL UTENTE (Con Grafica Blu)
            const htmlUtente = `
                <div style="font-family: sans-serif; border: 2px solid #007bff; padding: 20px; border-radius: 15px; max-width: 500px;">
                    <h2 style="color: #007bff;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                    <p>Prenotazione confermata. In allegato il PASS da esporre.</p>
                    <p style="background: #f8f9fa; padding: 10px;"><b>Periodo:</b> dal ${dInizio} al ${dFine}</p>
                    <p><i>Ti preghiamo di stampare l'allegato o mostrarlo al piantone.</i></p>
                </div>`;
            
            await inviaMailBrevoAPI(email, `Conferma e PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // EMAIL ADMIN (Semplice)
            const htmlAdmin = `
                <div style="font-family: sans-serif; padding: 15px; border-left: 5px solid #ffc107;">
                    <h3>🔔 Nuova Prenotazione: ${p}</h3>
                    <p>Effettuata da: <b>${email}</b></p>
                    <p>Periodo: ${dInizio} - ${dFine}</p>
                </div>`;

            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `🔔 Nuova: ${p}`, htmlAdmin);
            res.json({ success: true });
        });

        doc.fontSize(25).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(60).text(p, { align: 'center' });
        doc.moveDown().fontSize(20).text(`Valido: ${dInizio} - ${dFine}`, { align: 'center' });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. LOGIN
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    const p = npass.trim().toUpperCase();
    const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
    res.json({ valid: result.rows.length > 0, ruolo: result.rows[0]?.ruolo });
});

// (Mantieni le altre rotte: /api/mie-prenotazioni, /api/piantone/azione, ecc. come prima)
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);
