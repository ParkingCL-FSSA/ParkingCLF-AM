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

// FUNZIONE INVIO MAIL (BREVO API)
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

// 1. VISUALIZZAZIONE POSTI (Risolve IMG 1000319256.jpg)
app.get('/api/posti-disponibili', async (req, res) => {
    try {
        const totalePosti = 100; 
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

// 2. PRENOTAZIONE E GENERAZIONE PDF CON RIQUADRO (Risolve image_7c9afa.png)
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const p = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // EMAIL UTENTE (Grafica Originale)
            const htmlUtente = `
                <div style="font-family: sans-serif; border: 2px solid #007bff; padding: 20px; border-radius: 15px; max-width: 500px;">
                    <h2 style="color: #007bff;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                    <p>Gentile utente <b>${p}</b>, la tua prenotazione è confermata.</p>
                    <p><b>Periodo:</b> dal ${dInizio} al ${dFine}</p>
                </div>`;
            
            await inviaMailBrevoAPI(email, `Conferma Prenotazione - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // MAIL ADMIN (Pulita, senza email mittente nel testo)
            const htmlAdmin = `<h3>🔔 Nuova Prenotazione: ${p}</h3><p>Periodo: ${dInizio} - ${dFine}</p>`;
            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `🔔 Nuova: ${p}`, htmlAdmin);

            res.json({ success: true });
        });

        // COSTRUZIONE PDF CON RIQUADRO (Riferimento image_7c9afa.png)
        doc.lineWidth(3).rect(40, 40, 515, 300).stroke('#4A90E2'); // Riquadro blu
        doc.fillColor('#4A90E2').fontSize(20).text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fillColor('black').fontSize(80).text(p, 50, 140, { align: 'center' });
        doc.fontSize(18).text('PERIODO DI SOSTA:', 50, 250, { align: 'center' });
        doc.fontSize(22).text(`DAL ${dInizio} AL ${dFine}`, 50, 280, { align: 'center' });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. CONTROLLO SBARRA / LOGIN (Correzione errore "ultimo_accesso" - Risolve 1000319118.jpg)
app.post('/api/valida-pass', async (req, res) => {
    try {
        const { npass } = req.body;
        // Rimosso il riferimento a 'ultimo_accesso' che causava il crash
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
        
        if (result.rows.length > 0) {
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) {
        console.error("Errore validazione:", err.message);
        res.status(500).json({ error: "Errore database" });
    }
});

// 4. DISDETTA
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
        const htmlDisdetta = `<h2 style="color:red;">⚠️ DISDETTA PASS: ${npass.toUpperCase()}</h2>`;
        await inviaMailBrevoAPI("parkingclf.am@gmail.com", `⚠️ DISDETTA: ${npass}`, htmlDisdetta);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);