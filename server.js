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

const LOGO_URL = "https://parkingclf-am.onrender.com/LogoCLF.png";

// ⏰ JOB SCADENZA
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

const formattaDataIT = (data) => {
    return new Date(data).toLocaleDateString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
};

async function verificaRuolo(npass, ruoloRichiesto) {
    if (!npass) return false;
    const result = await pool.query(
        'SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1',
        [npass.trim().toUpperCase()]
    );
    if (result.rows.length === 0) return false;
    const ruoli = Array.isArray(ruoloRichiesto) ? ruoloRichiesto : [ruoloRichiesto];
    return ruoli.includes(result.rows[0].ruolo);
}

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

// --- 2. PRENOTAZIONE CON CONTROLLO QUOTE ENTE CORRETTO ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;

    if (!npass || !email) return res.status(400).json({ error: "Dati mancanti" });
    if (!Array.isArray(giorni) || giorni.length === 0) return res.status(400).json({ error: "Giorni non validi" });
    if (giorni.length > 15) return res.status(400).json({ error: "Limite 15 giorni superato" });

    try {
        const sorted = [...giorni].sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];
        const p = npass.trim().toUpperCase();
        const numGiorni = giorni.length;

        // CHECK 1: Sovrapposizione
        const overlap = await pool.query(
            `SELECT id FROM prenotazioni 
             WHERE UPPER(npass) = $1 
               AND stato IN ('PRENOTATO', 'INGRESSO')
               AND (
                   (data_inizio <= $2 AND data_fine >= $2) OR
                   (data_inizio <= $3 AND data_fine >= $3) OR
                   (data_inizio >= $2 AND data_fine <= $3)
               )`,
            [p, dataInizio, dataFine]
        );
        if (overlap.rows.length > 0) {
            return res.status(400).json({ 
                error: "Hai già una prenotazione attiva in questo periodo. Cancellala prima di prenotare nuovamente." 
            });
        }

        // CHECK 2: Limite 15gg/30gg
        const fineFinestra = new Date(dataInizio);
        fineFinestra.setDate(fineFinestra.getDate() + 29);
        const fineFinStr = fineFinestra.toISOString().split('T')[0];

        const giorniEsistenti = await pool.query(
            `SELECT data_inizio, data_fine FROM prenotazioni 
             WHERE UPPER(npass) = $1 
               AND stato IN ('PRENOTATO', 'INGRESSO')
               AND data_inizio <= $2
               AND data_fine >= $3`,
            [p, fineFinStr, dataInizio]
        );

        let giorniOccupati = 0;
        giorniEsistenti.rows.forEach(row => {
            const inizio = new Date(row.data_inizio) > new Date(dataInizio) 
                ? new Date(row.data_inizio) 
                : new Date(dataInizio);
            const fine = new Date(row.data_fine) < new Date(fineFinStr) 
                ? new Date(row.data_fine) 
                : new Date(fineFinStr);
            const diff = Math.ceil((fine - inizio) / (1000 * 60 * 60 * 24)) + 1;
            giorniOccupati += diff;
        });

        if (giorniOccupati + numGiorni > 15) {
            return res.status(400).json({ 
                error: `Limite superato: puoi prenotare massimo 15 giorni in una finestra di 30 giorni. Hai già ${giorniOccupati} giorni prenotati.` 
            });
        }

        // CHECK 3: Quote ENTE - FIX CRITICO
        const userInfo = await pool.query(
            `SELECT r.ente, a.posti 
             FROM registro_pass r
             LEFT JOIN assegnazioni a ON r.ente = a.ente
             WHERE UPPER(r.npass) = $1`,
            [p]
        );

        if (userInfo.rows.length === 0 || !userInfo.rows[0].ente) {
            return res.status(400).json({ error: "Configurazione utente non valida. Contatta l'amministratore." });
        }

        const userEnte = userInfo.rows[0].ente;
        const postiEnte = userInfo.rows[0].posti || 0;

        // Espandi prenotazione in singoli giorni
        const giorniRichiesti = [];
        for (let d = new Date(dataInizio); d <= new Date(dataFine); d.setDate(d.getDate() + 1)) {
            giorniRichiesti.push(d.toISOString().split('T')[0]);
        }

        // Verifica ogni giorno
        for (const giorno of giorniRichiesti) {
            const occupatiEnte = await pool.query(
                `SELECT COUNT(DISTINCT p.npass) as count
                 FROM prenotazioni p
                 JOIN registro_pass r ON UPPER(p.npass) = UPPER(r.npass)
                 WHERE r.ente = $1
                   AND UPPER(p.npass) != $2
                   AND p.stato IN ('PRENOTATO', 'INGRESSO')
                   AND $3 BETWEEN p.data_inizio AND p.data_fine`,
                [userEnte, p, giorno]
            );

            const count = parseInt(occupatiEnte.rows[0].count);
            
            if (count >= postiEnte) {
                return res.status(400).json({ 
                    error: "Non è possibile prenotare nelle giornate selezionate. Posti esauriti per questa prenotazione." 
                });
            }
        }

        // OK → Inserisci
        await pool.query(
            'INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)',
            [p, dataInizio, dataFine, 'PRENOTATO']
        );
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [p]).catch(e => console.log(e));

        // PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

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
        console.error('[PRENOTA]', err);
        res.status(500).json({ error: err.message });
    }
});

// --- 3. LE MIE PRENOTAZIONI ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const p = req.params.npass.toUpperCase();
        const r = await pool.query(
            `SELECT id, data_inizio, data_fine, stato FROM prenotazioni
             WHERE UPPER(npass) = $1 AND data_inizio >= CURRENT_DATE - interval '60 days'
             ORDER BY data_inizio DESC`,
            [p]
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. ELIMINA ---
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

// --- 5. VEICOLI DENTRO ---
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

// --- 6. PIANTONE CERCA ---
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

// --- 7. PIANTONE AZIONE ---
app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione, npass } = req.body;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }

    if (!id || !azione) {
        return res.status(400).json({ error: "Dati mancanti" });
    }

    try {
        const ora = new Date();

        if (azione === 'ingresso') {
            await pool.query(
                "UPDATE prenotazioni SET stato = 'INGRESSO', orario_ingresso = $1 WHERE id = $2",
                [ora, id]
            );
        } 
        else if (azione === 'uscita') {
            // ✅ USCITA SEMPRE CONSENTITA (anche se scaduto)
            await pool.query(
                "UPDATE prenotazioni SET stato = 'USCITO', orario_uscita = $1 WHERE id = $2 AND stato != 'USCITO'",
                [ora, id]
            );
        }

        res.json({ success: true });

    } catch (err) {
        console.error("Errore piantone:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- 7B. PIANTONE LIBERI ---
app.get('/api/piantone/liberi', async (req, res) => {
    try {
        const oggi = new Date().toISOString().split('T')[0];
        const r = await pool.query(
            `SELECT COUNT(*) as count
             FROM prenotazioni
             WHERE stato = 'INGRESSO'
             AND $1 BETWEEN data_inizio AND data_fine`,
            [oggi]
        );
        const dentro = parseInt(r.rows[0].count);
        const totaleLiberi = Math.max(0, 120 - dentro);
        res.json({ totaleLiberi, dentro });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- 8. ADMIN CRUSCOTTO OTTIMIZZATO ---
app.get('/api/admin/cruscotto', async (req, res) => {
    const npass = req.query.npass;
    if (!await verificaRuolo(npass, 'admin')) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }
    try {
        const query = `
            WITH giorni AS (
                SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '44 days', '1 day')::date AS giorno
            ),
            enti_posti AS (
                SELECT ente, posti FROM assegnazioni
            ),
            prenotazioni_attive AS (
                SELECT p.npass, p.data_inizio, p.data_fine, r.ente
                FROM prenotazioni p
                JOIN registro_pass r ON UPPER(p.npass) = UPPER(r.npass)
                WHERE p.stato IN ('PRENOTATO', 'INGRESSO')
            )
            SELECT 
                g.giorno,
                ep.ente,
                ep.posti,
                COUNT(DISTINCT pa.npass) as occupati
            FROM giorni g
            CROSS JOIN enti_posti ep
            LEFT JOIN prenotazioni_attive pa 
                ON pa.ente = ep.ente 
                AND g.giorno BETWEEN pa.data_inizio AND pa.data_fine
            GROUP BY g.giorno, ep.ente, ep.posti
            ORDER BY g.giorno, ep.ente;
        `;

        const result = await pool.query(query);
        
        const grouped = {};
        result.rows.forEach(row => {
            const giorno = row.giorno.toISOString().split('T')[0];
            if (!grouped[giorno]) {
                grouped[giorno] = { data: giorno, enti: {}, totaleOccupati: 0 };
            }
            const occupati = parseInt(row.occupati);
            const totale = parseInt(row.posti);
            grouped[giorno].enti[row.ente] = {
                occupati: occupati,
                totale: totale,
                liberi: totale - occupati
            };
            grouped[giorno].totaleOccupati += occupati;
        });

        const output = Object.values(grouped).map(day => ({
            ...day,
            totaleLiberi: 120 - day.totaleOccupati
        }));

        res.json(output);
    } catch (err) {
        console.error('[CRUSCOTTO]', err);
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/ritardi', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT npass, data_fine, orario_uscita,
                   (CURRENT_DATE - data_fine) as giorni_ritardo
            FROM prenotazioni
            WHERE stato = 'INGRESSO'
            AND CURRENT_DATE > data_fine
        `);

        res.json(r.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Server avviato`);
});
