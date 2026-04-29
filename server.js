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

// FUNZIONE INVIO MAIL (API BREVO)
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

// 1. ROTTA POSTI DISPONIBILI (VISIBILE A TUTTI, ADMIN INCLUSI)
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

// 2. ROTTA PRENOTAZIONE (CON GRAFICA ORIGINALE)
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const p = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];
        const numGiorni = giorni.length;

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // GRAFICA ORIGINALE (IMG Screenshot 2026-04-25 190234.png)
            const htmlUtente = `
                <div style="font-family: Arial, sans-serif; border: 2px solid #4A90E2; padding: 25px; border-radius: 20px; max-width: 600px; color: #333;">
                    <h2 style="color: #4A90E2; display: flex; align-items: center;">
                        <span style="background: #4A90E2; color: white; padding: 2px 8px; border-radius: 4px; margin-right: 10px;">P</span> 
                        Parcheggio C.L. Fontanarossa
                    </h2>
                    <p>Gentile utente <b>${p}</b>, la tua prenotazione è confermata.</p>
                    <p><b>Periodo:</b> dal ${dInizio} al ${dFine}</p>
                    <p><b>Giorni:</b> ${numGiorni} (${sorted.join(', ')})</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #888;">Sistema di prenotazione Parcheggio C.L. Fontanarossa</p>
                </div>`;
            
            await inviaMailBrevoAPI(email, `Conferma Prenotazione C.L. Fontanarossa - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // MAIL ADMIN SENZA INDIRIZZO MITTENTE NEL TESTO
            const htmlAdmin = `
                <div style="font-family: Arial, sans-serif; padding: 15px; border-left: 5px solid #28a745; background: #f9f9f9;">
                    <h3 style="color: #28a745;">🔔 Nuova Prenotazione Ricevuta</h3>
                    <p>Il PASS <b>${p}</b> è stato appena registrato nel sistema.</p>
                    <p><b>Periodo:</b> ${dInizio} - ${dFine}</p>
                    <p><b>Durata:</b> ${numGiorni} giorni</p>
                </div>`;

            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `🔔 Nuova Prenotazione: ${p}`, htmlAdmin);
            res.json({ success: true });
        });

        doc.fontSize(25).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(60).text(p, { align: 'center' });
        doc.moveDown().fontSize(20).text(`Valido: ${dInizio} - ${dFine}`, { align: 'center' });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. DISDETTA CON MAIL PULITA
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
        
        const htmlDisdetta = `
            <div style="font-family: Arial, sans-serif; border: 2px solid #dc3545; padding: 20px; border-radius: 15px;">
                <h2 style="color: #dc3545;">⚠️ Disdetta PASS ${npass.toUpperCase()}</h2>
                <p>Una prenotazione è stata cancellata correttamente dal database.</p>
                <p>Il posto è nuovamente disponibile per la data indicata.</p>
            </div>`;
            
        await inviaMailBrevoAPI("parkingclf.am@gmail.com", `⚠️ DISDETTA PASS - ${npass.toUpperCase()}`, htmlDisdetta);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. LOGIN E ALTRE FUNZIONI
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
    res.json({ valid: result.rows.length > 0, ruolo: result.rows[0]?.ruolo });
});

app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);