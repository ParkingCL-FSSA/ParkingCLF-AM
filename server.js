const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); // Per i nuovi progressi (Brevo)
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

// FUNZIONE DATE - Presa dalla logica del vecchio file che funzionava
const formattaDataIT = (data) => {
    if (!data) return "N/D";
    const d = new Date(data);
    if (isNaN(d.getTime())) return data; // Paracadute anti "Invalid Date"
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Integrazione Brevo (Nuovo Progresso)
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

// --- 1. LOGIN ---
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    try {
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [p]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else { res.json({ valid: false }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. LE MIE PRENOTAZIONI (Ripristinato come nel vecchio file) ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const p = req.params.npass.trim().toUpperCase();
        const r = await pool.query('SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [p]);
        // Restituiamo le righe pulite, la formattazione la fa la funzione helper
        res.json(r.rows.map(row => ({
            ...row,
            data_inizio: formattaDataIT(row.data_inizio),
            data_fine: formattaDataIT(row.data_fine)
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. ELIMINA PRENOTAZIONE (Corretta) ---
app.post('/api/elimina-prenotazione', async (req, res) => {
    const { id, npass } = req.body;
    try {
        await pool.query('DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. VEICOLI DENTRO (Presa dal file funzionante) ---
app.get('/api/veicoli-dentro', async (req, res) => {
    try {
        const r = await pool.query("SELECT npass, data_fine, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO'");
        res.json(r.rows.map(row => ({
            ...row,
            data_fine: formattaDataIT(row.data_fine),
            orario_ingresso: row.orario_ingresso ? new Date(row.orario_ingresso).toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'}) : "N/D"
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. PRENOTAZIONE (Nuovi Progressi: Logo e Layout Centrato) ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    try {
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];
        const p = npass.toUpperCase();

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // Layout Email Centrato con Logo (Screenshot 2026-04-29 203434.png)
            const htmlUtente = `
                <div style="font-family:Arial; text-align:center; border:2px solid #4A90E2; padding:25px; border-radius:20px; max-width:500px; margin:auto;">
                    <img src="${LOGO_URL}" style="width:130px; margin-bottom:20px;">
                    <h2 style="color:#4A90E2;">🅿️ Prenotazione Confermata</h2>
                    <p>Gentile utente <b>${p}</b>, il tuo pass è pronto.</p>
                    <p><b>Periodo:</b> dal ${formattaDataIT(dInizio)} al ${formattaDataIT(dFine)}</p>
                    <p style="font-size:12px; color:#666; margin-top:20px;">Esporre il PASS allegato sul parabrezza.</p>
                </div>`;
            
            await inviaMailBrevoAPI(email, `Conferma PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);
            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `Nuova Prenotazione: ${p}`, `<h3>Nuovo inserimento: ${p}</h3><p>Email: ${email}</p>`);

            res.json({ success: true });
        });

        // PDF con Riquadro Blu (Screenshot 2026-04-29 193425.png)
        doc.rect(40, 40, 515, 320).lineWidth(3).stroke('#4A90E2');
        doc.fontSize(22).fillColor('#4A90E2').text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fontSize(90).fillColor('black').text(p, 50, 140, { align: 'center' });
        doc.fontSize(20).text(`PERIODO DI SOSTA:`, 50, 260, { align: 'center' });
        doc.fontSize(24).text(`DAL ${formattaDataIT(dInizio)} AL ${formattaDataIT(dFine)}`, 50, 295, { align: 'center', bold: true });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 6. GESTIONE PIANTONE / ADMIN ---
app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const p = req.params.npass.toUpperCase();
    const r = await pool.query("SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND CURRENT_DATE BETWEEN data_inizio AND data_fine", [p]);
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const col = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${col} = NOW() WHERE id = $2`, [azione === 'E' ? 'INGRESSO' : 'USCITO', id]);
    res.json({ success: true });
});

app.get('/api/admin/cruscotto', async (req, res) => {
    const r = await pool.query(`SELECT g.d AS data, COUNT(p.id) AS occupati FROM (SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '44 days', '1 day')::date AS d) g LEFT JOIN prenotazioni p ON g.d BETWEEN p.data_inizio AND p.data_fine GROUP BY g.d ORDER BY g.d;`);
    res.json(r.rows.map(row => ({ data: formattaDataIT(row.data), occupati: parseInt(row.occupati), liberi: 120 - parseInt(row.occupati) })));
});

app.listen(process.env.PORT || 3000);