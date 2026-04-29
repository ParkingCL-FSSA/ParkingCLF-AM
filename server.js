const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); // Più stabile per invio mail
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const LOGO_URL = "https://parkingclf-am.onrender.com/LogoCLF.png";

// Funzione helper per le date nelle email e PDF (mantenendo la logica del vecchio file)
const formattaDataIT = (data) => {
    return new Date(data).toLocaleDateString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
};

// Funzione invio Mail via Brevo
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
        console.error("Errore Mail:", error.response ? error.response.data : error.message);
    }
}

// 1. LOGIN
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    try {
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [p]).catch(e => console.log(e));
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else { res.json({ valid: false }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. PRENOTAZIONE (DOPPIA MAIL SEPARATA E CENTRATA)
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    try {
        const sorted = giorni.sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];
        const p = npass.toUpperCase();

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dataInizio, dataFine, 'PRENOTATO']);
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [p]).catch(e => console.log(e));

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // --- MAIL 1: PER L'UTENTE (Centrata con Logo) ---
            const htmlUtente = `
                <div style="text-align: center; font-family: sans-serif; border: 2px solid #4A90E2; padding: 20px; border-radius: 15px; max-width: 500px; margin: auto;">
                    <img src="${LOGO_URL}" alt="Logo CLF" style="width: 130px; margin-bottom: 20px;">
                    <h2 style="color: #4A90E2;">Prenotazione Confermata</h2>
                    <p>Gentile utente <b>${p}</b>, il tuo pass è pronto.</p>
                    <p>Valido dal <b>${formattaDataIT(dataInizio)}</b> al <b>${formattaDataIT(dataFine)}</b>.</p>
                    <p style="font-size: 12px; color: #666;">In allegato il PDF da esporre sul parabrezza.</p>
                </div>`;
            await inviaMailBrevoAPI(email, `Il tuo PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // --- MAIL 2: SOLO PER TE (Centrata con Logo) ---
            const htmlAdmin = `
                <div style="text-align: center; font-family: sans-serif; border: 1px solid #ddd; padding: 20px; border-radius: 10px; max-width: 400px; margin: auto;">
                    <img src="${LOGO_URL}" alt="Logo CLF" style="width: 90px; margin-bottom: 15px;">
                    <h3 style="color: #333;">Nuova Prenotazione Ricevuta</h3>
                    <p><b>Pass:</b> ${p}</p>
                    <p><b>Email:</b> ${email}</p>
                    <p><b>Periodo:</b> ${formattaDataIT(dataInizio)} - ${formattaDataIT(dataFine)}</p>
                </div>`;
            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `Nuova Prenotazione: ${p}`, htmlAdmin);

            res.json({ success: true });
        });

        // Generazione PDF (Riquadro Blu)
        doc.rect(40, 40, 515, 320).lineWidth(3).stroke('#4A90E2');
        doc.fontSize(22).fillColor('#4A90E2').text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fontSize(90).fillColor('black').text(p, 50, 140, { align: 'center' });
        doc.fontSize(24).text(`DAL ${formattaDataIT(dataInizio)} AL ${formattaDataIT(dataFine)}`, 50, 295, { align: 'center' });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. LE MIE PRENOTAZIONI (Ripristinata logica originale)
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
        res.json(r.rows); // Restituisce i dati puri come nel file vecchio
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. ELIMINA
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        await pool.query('DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [req.body.id, req.body.npass.toUpperCase()]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. VEICOLI DENTRO
app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        const r = await pool.query("SELECT npass, data_fine, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO' ORDER BY orario_ingresso DESC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. PIANTONE / CRUSCOTTO
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
    res.json(r.rows.map(row => ({ data: new Date(row.data).toLocaleDateString('it-IT'), occupati: parseInt(row.occupati), liberi: 120 - parseInt(row.occupati) })));
});

app.listen(process.env.PORT || 3000);