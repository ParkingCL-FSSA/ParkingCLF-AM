const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

// FIX 🔴: rimosso express.static(__dirname) che esponeva server.js e .env al pubblico.
// Tutti i file frontend (index.html, script.js, style.css, LogoCLF.png) vanno nella cartella /public.
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const LOGO_URL = "https://parkingclf-am.onrender.com/LogoCLF.png";

// ⏰ JOB SCADENZA: prenotazioni PRENOTATO con data_inizio già passata → SCADUTO
// Gira all'avvio e ogni ora. Libera i posti nel cruscotto.
async function scadenzaPrenotazioni() {
    try {
        const result = await pool.query(
            `UPDATE prenotazioni SET stato = 'SCADUTO'
             WHERE stato = 'PRENOTATO' AND data_inizio < CURRENT_DATE`
        );
        if (result.rowCount > 0)
            console.log(`[SCADENZA] ${result.rowCount} prenotazione/i scaduta/e.`);
    } catch (err) {
        console.error('[SCADENZA] Errore:', err.message);
    }
}
scadenzaPrenotazioni();
setInterval(scadenzaPrenotazioni, 60 * 60 * 1000);

// Helper per formattare le date in italiano (usato solo in PDF ed email, non nel frontend)
const formattaDataIT = (data) => {
    return new Date(data).toLocaleDateString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
};

// Helper: verifica che un npass abbia il ruolo richiesto (protezione endpoint sensibili)
// FIX 🟡: gli endpoint admin/piantone ora richiedono un npass valido con ruolo corretto.
async function verificaRuolo(npass, ruoloRichiesto) {
    if (!npass) return false;
    const result = await pool.query(
        'SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1',
        [npass.trim().toUpperCase()]
    );
    if (result.rows.length === 0) return false;
    // Se ruoloRichiesto è un array, accetta uno qualsiasi dei ruoli
    const ruoli = Array.isArray(ruoloRichiesto) ? ruoloRichiesto : [ruoloRichiesto];
    return ruoli.includes(result.rows[0].ruolo);
}

// Invio email tramite API Brevo
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
    if (!npass) return res.json({ valid: false });
    try {
        const p = npass.trim().toUpperCase();
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [p]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [p])
                .catch(e => console.log(e));
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. PRENOTAZIONE ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;

    // FIX 🔴: validazione input — evita crash se giorni non è un array
    if (!npass || !email) return res.status(400).json({ error: "Dati mancanti" });
    if (!Array.isArray(giorni) || giorni.length === 0) return res.status(400).json({ error: "Giorni non validi" });
    if (giorni.length > 15) return res.status(400).json({ error: "Limite 15 giorni superato" });

    try {
        const sorted = [...giorni].sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];
        const p = npass.trim().toUpperCase();
        const numGiorni = giorni.length;

        await pool.query(
            'INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)',
            [p, dataInizio, dataFine, 'PRENOTATO']
        );
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [p])
            .catch(e => console.log(e));

        // Generazione PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            // Mail all'utente
            const htmlUtente = `
                <div style="text-align:center; font-family:sans-serif; border:2px solid #4A90E2; padding:20px; border-radius:15px; max-width:500px; margin:auto;">
                    <img src="${LOGO_URL}" alt="Logo CLF" style="width:130px; margin-bottom:20px;">
                    <h2 style="color:#4A90E2;">Prenotazione Confermata</h2>
                    <p>Gentile utente <b>${p}</b>, il tuo pass è pronto.</p>
                    <div style="background-color:#f4f8ff; padding:10px; border-radius:10px; margin:15px 0;">
                        <p>Dal <b>${formattaDataIT(dataInizio)}</b> al <b>${formattaDataIT(dataFine)}</b></p>
                        <p><b>Giorni totali:</b> ${numGiorni}</p>
                    </div>
                    <p style="font-size:12px; color:#666;">In allegato il PDF da esporre sul parabrezza.</p>
                </div>`;
            await inviaMailBrevoAPI(email, `Il tuo PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);

            // Mail all'admin
            const htmlAdmin = `
                <div style="text-align:center; font-family:sans-serif; border:1px solid #ddd; padding:20px; border-radius:10px; max-width:400px; margin:auto;">
                    <img src="${LOGO_URL}" alt="Logo CLF" style="width:90px; margin-bottom:15px;">
                    <h3 style="color:#333;">🔔 Nuova Prenotazione</h3>
                    <p><b>Pass:</b> ${p}</p>
                    <p><b>Email:</b> ${email}</p>
                    <p><b>Periodo:</b> ${formattaDataIT(dataInizio)} - ${formattaDataIT(dataFine)}</p>
                    <p><b>Giorni:</b> ${numGiorni}</p>
                </div>`;
            await inviaMailBrevoAPI("parkingclf.am@gmail.com", `Nuova Prenotazione: ${p}`, htmlAdmin);

            res.json({ success: true });
        });

        doc.rect(40, 40, 515, 320).lineWidth(3).stroke('#4A90E2');
        doc.fontSize(22).fillColor('#4A90E2').text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fontSize(90).fillColor('black').text(p, 50, 140, { align: 'center' });
        doc.fontSize(24).text(`DAL ${formattaDataIT(dataInizio)} AL ${formattaDataIT(dataFine)}`, 50, 295, { align: 'center' });
        doc.end();

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. LE MIE PRENOTAZIONI (attive + storico ultimi 60 giorni) ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const p = req.params.npass.toUpperCase();
        const r = await pool.query(
            `SELECT id, data_inizio, data_fine, stato
             FROM prenotazioni
             WHERE UPPER(npass) = $1
               AND data_inizio >= CURRENT_DATE - interval '60 days'
             ORDER BY data_inizio DESC`,
            [p]
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. ELIMINA PRENOTAZIONE CON MAIL DI DISDETTA ---
app.post('/api/elimina-prenotazione', async (req, res) => {
    const { id, npass } = req.body;
    if (!id || !npass) return res.status(400).json({ error: "Dati mancanti" });
    try {
        const p = npass.toUpperCase();
        const info = await pool.query(
            'SELECT data_inizio, data_fine, stato FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2',
            [id, p]
        );
        if (info.rows.length === 0) return res.status(404).json({ error: "Prenotazione non trovata" });

        const { data_inizio, data_fine, stato } = info.rows[0];

        // 🔒 Blocca cancellazione se già entrato o uscito
        if (stato === 'INGRESSO' || stato === 'USCITO') {
            return res.status(400).json({ error: "Non cancellabile: veicolo già registrato." });
        }

        await pool.query('DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, p]);

        const htmlDisdetta = `
            <div style="text-align:center; font-family:sans-serif; border:2px solid red; padding:20px; border-radius:10px; max-width:400px; margin:auto;">
                <h3 style="color:red;">⚠️ Prenotazione Cancellata</h3>
                <p><b>Pass:</b> ${p}</p>
                <p><b>Periodo:</b> ${formattaDataIT(data_inizio)} al ${formattaDataIT(data_fine)}</p>
            </div>`;
        await inviaMailBrevoAPI("parkingclf.am@gmail.com", `⚠️ Disdetta: ${p}`, htmlDisdetta);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. VEICOLI DENTRO E MOVIMENTI RECENTI ---
// FIX 🟡: richiede npass con ruolo piantone o admin nel body
app.get('/api/veicoli-dentro', async (req, res) => {
    const npass = req.query.npass;
    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }
    try {
        const r = await pool.query(
            "SELECT npass, data_fine, orario_ingresso, orario_uscita, stato FROM prenotazioni WHERE stato IN ('INGRESSO', 'USCITO') ORDER BY COALESCE(orario_uscita, orario_ingresso) DESC LIMIT 20"
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. PIANTONE: CERCA PASS ---
// FIX 🟡: richiede npass del piantone come query param
app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const authPass = req.query.auth;
    if (!await verificaRuolo(authPass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }
    try {
        const r = await pool.query(
            'SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1',
            [req.params.npass.toUpperCase()]
        );
        res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. PIANTONE: REGISTRA ENTRATA/USCITA ---
app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione, npass } = req.body;
    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }
    if (!id || !azione) return res.status(400).json({ error: "Dati mancanti" });
    try {
        const ora = new Date();
        if (azione === 'E') {
            // ENTRATA: registra orario ingresso
            await pool.query(
                `UPDATE prenotazioni SET stato = 'INGRESSO', orario_ingresso = $1 WHERE id = $2`,
                [ora, id]
            );
        } else {
            // USCITA: registra orario uscita e tronca data_fine a oggi
            // → libera i posti per i giorni restanti del periodo originale
            await pool.query(
                `UPDATE prenotazioni SET stato = 'USCITO', orario_uscita = $1, data_fine = CURRENT_DATE WHERE id = $2`,
                [ora, id]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 8. ADMIN: CRUSCOTTO DISPONIBILITÀ ---
// FIX 🟡: verifica ruolo admin prima di restituire i dati
app.get('/api/admin/cruscotto', async (req, res) => {
    const npass = req.query.npass;
    if (!await verificaRuolo(npass, 'admin')) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }
    try {
        const query = `
            WITH giorni AS (
                SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '44 days', '1 day')::date AS d
            )
            SELECT g.d AS data, COUNT(p.id) AS occupati
            FROM giorni g
            LEFT JOIN prenotazioni p
                ON g.d BETWEEN p.data_inizio AND p.data_fine
                AND p.stato NOT IN ('SCADUTO')
            GROUP BY g.d
            ORDER BY g.d;
        `;
        const r = await pool.query(query);
        res.json(r.rows.map(row => ({
            data: row.data,
            occupati: parseInt(row.occupati),
            liberi: 120 - parseInt(row.occupati)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Server avviato sulla porta ${process.env.PORT || 3000}`);
});
