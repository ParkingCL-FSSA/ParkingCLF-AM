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
app.use(express.static(__dirname)); 

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const LOGO_URL = "https://parkingclf-am.onrender.com/LogoCLF.png";

// Funzione Date definitiva (Gestisce i conflitti EN/IT)
const formattaDataIT = (data) => {
    if (!data) return "N/D";
    const d = new Date(data);
    if (isNaN(d.getTime())) return data; 
    return d.toLocaleDateString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
};

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

// 1. LE MIE PRENOTAZIONI
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const p = req.params.npass.trim().toUpperCase();
        const r = await pool.query(
            'SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', 
            [p]
        );
        const risultati = r.rows.map(row => ({
            ...row,
            data_inizio: formattaDataIT(row.data_inizio),
            data_fine: formattaDataIT(row.data_fine)
        }));
        res.json(risultati);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. PRENOTAZIONE (DOPPIA MAIL SEPARATA E CENTRATA)
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    try {
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];
        const p = npass.toUpperCase();
        const numGiorni = giorni.length;
        const elencoGiorni = sorted.map(d => formattaDataIT(d)).join(', ');

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', [p, dInizio, dFine, 'PRENOTATO']);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // --- MAIL UTENTE (Stile Screenshot 2026-04-27 211507.png) ---
            const htmlUtente = `
                <div style="font-family: Arial; text-align: center; border: 2px solid #4A90E2; padding: 25px; border-radius: 20px; max-width: 500px; margin: auto; color: #333;">
                    <img src="${LOGO_URL}" alt="Logo CLF" style="width:130px; margin-bottom: 20px;">
                    <h2 style="color: #4A90E2; margin-bottom: 10px;">🅿️ Prenotazione Confermata</h2>
                    <p>Gentile utente <b>${p}</b>, il tuo pass è stato generato con successo.</p>
                    <div style="background-color: #f4f8ff; padding: 15px; border-radius: 10px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><b>Dal:</b> ${formattaDataIT(dInizio)}</p>
                        <p style="margin: 5px 0;"><b>Al:</b> ${formattaDataIT(dFine)}</p>
                        <p style="margin: 5px 0;"><b>Giorni totali:</b> ${numGiorni}</p>
                    </div>
                    <p style="font-size: 13px; color: #555;"><b>Dettaglio date:</b><br>${elencoGiorni}</p>
                    <p style="font-size: 12px; color: #888; margin-top: 25px; border-top: 1px solid #eee; pt: 10px;">In allegato trovi il PDF da esporre sul parabrezza.</p>
                </div>`;
            await inviaMailBrevoAPI(email, `Conferma Prenotazione - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // --- MAIL PARCHEGGIO (Solo avviso amministrativo) ---
            const htmlAdmin = `
                <div style="font-family: Arial; text-align: center; border: 1px solid #ddd; padding: 25px; border-radius: 15px; max-width: 500px; margin: auto;">
                    <img src="${LOGO_URL}" alt="Logo CLF" style="width:100px; margin-bottom: 15px;">
                    <h2 style="color: #333;">🔔 Nuova Prenotazione</h2>
                    <p><b>Pass:</b> ${p}</p>
                    <p><b>Email Cliente:</b> ${email}</p>
                    <p><b>Periodo:</b> ${formattaDataIT(dInizio)} - ${formattaDataIT(dFine)}</p>
                    <p><b>Giorni:</b> ${numGiorni}</p>
                </div>`;
            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `Nuova Prenotazione: ${p}`, htmlAdmin);

            res.json({ success: true });
        });

        // PDF (Riquadro Blu Originale)
        doc.rect(40, 40, 515, 320).lineWidth(3).stroke('#4A90E2');
        doc.fontSize(22).fillColor('#4A90E2').text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fontSize(90).fillColor('black').text(p, 50, 140, { align: 'center' });
        doc.fontSize(20).text(`PERIODO DI SOSTA:`, 50, 260, { align: 'center' });
        doc.fontSize(24).text(`DAL ${formattaDataIT(dInizio)} AL ${formattaDataIT(dFine)}`, 50, 295, { align: 'center', bold: true });
        doc.end();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. LOGIN E ALTRI SERVIZI (Non toccati)
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    try {
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [p]).catch(e => console.error(e));
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else { res.json({ valid: false }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    try {
        const p = req.params.npass.trim().toUpperCase();
        const r = await pool.query("SELECT id, npass, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND CURRENT_DATE BETWEEN data_inizio AND data_fine ORDER BY id DESC LIMIT 1", [p]);
        res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    const nuovoStato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [nuovoStato, id]);
    res.json({ success: true });
});

app.get('/api/admin/cruscotto', async (req, res) => {
    const query = `WITH giorni AS (SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '44 days', '1 day')::date AS d)
                   SELECT g.d AS data, COUNT(p.id) AS occupati FROM giorni g LEFT JOIN prenotazioni p ON g.d BETWEEN p.data_inizio AND p.data_fine
                   GROUP BY g.d ORDER BY g.d;`;
    const r = await pool.query(query);
    res.json(r.rows.map(row => ({ data: formattaDataIT(row.data), occupati: parseInt(row.occupati), liberi: 120 - parseInt(row.occupati) })));
});

app.listen(process.env.PORT || 3000);