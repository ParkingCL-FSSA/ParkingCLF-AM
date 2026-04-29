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

// FUNZIONE INVIO MAIL VIA API (Brevo)
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

// --- 1. ROTTA POSTI DISPONIBILI (Risolve l'assenza del riquadro nel sito) ---
app.get('/api/posti-disponibili', async (req, res) => {
    try {
        const totalePosti = 100; // Il numero totale dei tuoi posti
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

// --- 2. ROTTA PRENOTAZIONE (Con PDF e Grafica Blu) ---
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
            
            const htmlUtente = `
                <div style="font-family: sans-serif; border: 2px solid #007bff; padding: 20px; border-radius: 15px; max-width: 500px;">
                    <h2 style="color: #007bff;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                    <p>Prenotazione confermata. In allegato il PASS da esporre.</p>
                    <p style="background: #f8f9fa; padding: 10px;"><b>Periodo:</b> dal ${dInizio} al ${dFine}</p>
                </div>`;
            
            await inviaMailBrevoAPI(email, `Conferma e PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            const htmlAdmin = `<div style="font-family: sans-serif; padding: 15px; border-left: 5px solid #28a745;">
                <h3>🔔 Nuova Prenotazione: ${p}</h3>
                <p>Email: ${email} | Periodo: ${dInizio} - ${dFine}</p>
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

// --- 3. ROTTA DISDETTA (Rimuove dal DB e invia la mail a te) ---
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        
        // 1. Elimina la prenotazione dal database
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
        
        // 2. Invia mail di notifica a te (Admin)
        const htmlDisdetta = `
            <div style="font-family: sans-serif; border: 2px solid #dc3545; padding: 20px; border-radius: 15px; max-width: 500px;">
                <h2 style="color: #dc3545;">⚠️ Disdetta Prenotazione</h2>
                <p>L'utente con PASS <b>${npass.toUpperCase()}</b> ha appena cancellato la sua prenotazione.</p>
                <p>Il posto è tornato disponibile nel sistema.</p>
            </div>`;
            
        await inviaMailBrevoAPI("parkingclf.am@gmail.com", `⚠️ DISDETTA PASS - ${npass.toUpperCase()}`, htmlDisdetta);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Errore disdetta:", err.message);
        res.status(500).json({ error: "Errore durante la cancellazione" });
    }
});

// --- 4. ALTRE ROTTE DI SERVIZIO ---
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
    res.json({ valid: result.rows.length > 0, ruolo: result.rows[0]?.ruolo });
});

app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

// Avvio
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
          
