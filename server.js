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

// Funzione per formattare sempre in data italiana (GG/MM/AAAA)
const formattaDataIT = (data) => {
    return new Date(data).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

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

// 1. DISPONIBILITÀ POSTI 
app.get('/api/posti-disponibili', async (req, res) => {
    try {
        const totalePosti = 120; 
        const result = await pool.query("SELECT COUNT(*) FROM log_accessi WHERE data_uscita IS NULL");
        const occupati = parseInt(result.rows[0].count);
        res.json({ disponibili: totalePosti - occupati, totali: totalePosti });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. LOGIN CON CORREZIONE 'ult_accesso'
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    try {
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        
        if (result.rows.length > 0) {
            // Utilizzo 'ult_accesso' come richiesto
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [p]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. CONTROLLO SBARRA 
app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        const r = await pool.query("SELECT npass, data_entrata, ora_entrata, data_uscita, ora_uscita FROM log_accessi ORDER BY id DESC LIMIT 10");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/registra-ingresso', async (req, res) => {
    const { npass } = req.body;
    const oggi = formattaDataIT(new Date());
    const ora = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    try {
        await pool.query("INSERT INTO log_accessi (npass, data_entrata, ora_entrata) VALUES ($1, $2, $3)", [npass.toUpperCase(), oggi, ora]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/registra-uscita', async (req, res) => {
    const { npass } = req.body;
    const oggi = formattaDataIT(new Date());
    const ora = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    try {
        await pool.query("UPDATE log_accessi SET data_uscita = $1, ora_uscita = $2 WHERE UPPER(npass) = $3 AND data_uscita IS NULL", [oggi, ora, npass.toUpperCase()]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. PRENOTAZIONE E PDF CON DATE ITALIANE E RIQUADRO 
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const p = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = formattaDataIT(sorted[0]);
        const dFine = formattaDataIT(sorted[sorted.length - 1]);

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // Email Utente con date italiane
            const htmlUtente = `
                <div style="font-family:sans-serif;border:2px solid #4A90E2;padding:20px;border-radius:15px;">
                    <h2 style="color:#4A90E2;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                    <p>Gentile utente <b>${p}</b>, prenotazione confermata.</p>
                    <p><b>Periodo:</b> dal ${dInizio} al ${dFine}</p>
                </div>`;
            
            await inviaMailBrevoAPI(email, `Conferma - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);
            
            // Email Admin (Senza email utente nel testo)
            const htmlAdmin = `<h3>🔔 Nuova Prenotazione: ${p}</h3><p>Periodo: ${dInizio} - ${dFine}</p>`;
            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `🔔 Nuova: ${p}`, htmlAdmin);
            
            res.json({ success: true });
        });

        // Generazione PDF (Rif. image_7c9afa.png)
        doc.lineWidth(3).rect(40, 40, 515, 320).stroke('#4A90E2');
        doc.fillColor('#4A90E2').fontSize(22).text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fillColor('black').fontSize(90).text(p, 50, 150, { align: 'center' });
        doc.fontSize(20).text('PERIODO DI SOSTA:', 50, 265, { align: 'center' });
        doc.fontSize(24).text(`DAL ${dInizio} AL ${dFine}`, 50, 300, { align: 'center' });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 10000);