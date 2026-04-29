const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); // Usiamo axios per le API di Brevo
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Configurazione Logo
const LOGO_URL = "https://parkingclf-am.onrender.com/public/LogoCLF.png";

// Funzione per formattare sempre in data italiana (GG/MM/AAAA)
const formattaDataIT = (data) => {
    return new Date(data).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

// FUNZIONE INVIO MAIL VIA API BREVO (Sostituisce transporter.sendMail)
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
        console.error("Errore invio mail API:", error.response ? error.response.data : error.message);
    }
}

// 1. LOGIN con tracciamento accesso (corretto in ult_accesso)
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    try {
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        if (result.rows.length > 0) {
            try {
                // Rinominato in ult_accesso come richiesto
                await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [p]);
            } catch (e) { console.error("Errore aggiornamento ult_accesso:", e.message); }
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. PRENOTAZIONE con PDF (riquadro blu) e Logo nelle Email
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (giorni.length > 15) return res.status(400).json({ error: "Limite 15 giorni superato" });

    try {
        const sorted = giorni.sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];
        const p = npass.toUpperCase();

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [p, dataInizio, dataFine, 'PRENOTATO']);
        
        try {
            await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [p]);
        } catch (e) { console.error("Errore aggiornamento ult_pren:", e.message); }

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            // HTML EMAIL UTENTE (Con Logo e Grafica Blu)
            const htmlUtente = `
                <div style="font-family:sans-serif; border:2px solid #3b82f6; border-radius:15px; padding:20px; max-width:600px;">
                    <div style="text-align:center; margin-bottom:15px;">
                        <img src="${LOGO_URL}" alt="Logo" style="width:120px;">
                    </div>
                    <h2 style="color:#3b82f6; text-align:center;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                    <p>Gentile utente <b>${p}</b>, la tua prenotazione è confermata.</p>
                    <p><b>In allegato trovi il PASS da stampare ed esporre sul parabrezza.</b></p>
                    <hr style="border:0; border-top:1px solid #eee;">
                    <p>Periodo: dal ${formattaDataIT(dataInizio)} al ${formattaDataIT(dataFine)}</p>
                </div>`;

            await inviaMailBrevoAPI(email, `Conferma e PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // NOTIFICA ADMIN (Senza email utente nel testo e senza allegato)
            const htmlAdmin = `
                <div style="font-family:sans-serif; padding:15px; border-left:4px solid #3b82f6;">
                    <h3>Nuova Prenotazione Ricevuta</h3>
                    <p><b>Pass:</b> ${p}</p>
                    <p><b>Periodo:</b> dal ${formattaDataIT(dataInizio)} al ${formattaDataIT(dataFine)}</p>
                </div>`;

            await inviaMailBrevoAPI('parkingclf.am@gmail.com', `🔔 Nuova Prenotazione - ${p}`, htmlAdmin);

            res.json({ success: true });
        });

        // GRAFICA PDF (Riquadro Blu e Date IT)
        doc.rect(40, 40, 515, 320).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(22).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.moveDown();
        doc.fontSize(90).fillColor('black').text(p, 50, 140, { align: 'center' });
        doc.fontSize(20).text(`PERIODO DI SOSTA:`, 50, 260, { align: 'center' });
        doc.fontSize(24).text(`DAL ${formattaDataIT(dataInizio)} AL ${formattaDataIT(dataFine)}`, 50, 295, { align: 'center', bold: true });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. DISDETTA
app.post('/api/elimina-prenotazione', async (req, res) => {
    const { id, npass } = req.body;
    try {
        const info = await pool.query('SELECT data_inizio, data_fine FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);
        if (info.rows.length > 0) {
            const { data_inizio, data_fine } = info.rows[0];
            await pool.query('DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);

            const htmlDisdetta = `
                <div style="font-family:sans-serif; border:2px solid #ef4444; padding:20px; border-radius:15px;">
                    <h3 style="color:#ef4444;">Prenotazione Cancellata</h3>
                    <p>L'utente con Pass <b>${npass.toUpperCase()}</b> ha annullato la sosta.</p>
                    <p>Periodo: dal ${formattaDataIT(data_inizio)} al ${formattaDataIT(data_fine)}</p>
                </div>`;
            
            await inviaMailBrevoAPI('parkingclf.am@gmail.com', `⚠️ DISDETTA - ${npass.toUpperCase()}`, htmlDisdetta);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. ALTRE ROTTE
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
    res.json(r.rows.map(row => ({ data: formattaDataIT(row.data), occupati: parseInt(row.occupati), liberi: 120 - parseInt(row.occupati) })));
});

app.get('/api/veicoli-dentro', async (req, res) => {
    try {
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
