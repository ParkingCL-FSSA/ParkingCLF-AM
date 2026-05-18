const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors({
    origin: ['https://parkingclf-am.onrender.com']
}));
const helmet = require('helmet');
app.use(helmet());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 60, // max 60 richieste/minuto per IP
    message: "Troppe richieste, rallenta."
});

app.use(limiter);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('💥 ERRORE DB:', err);
});

const LOGO_URL = "https://parkingclf-am.onrender.com/LogoCLF.png";

function clean(input) {
    return input
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .substring(0, 5);
}

// ⏰ JOB SCADENZA
async function scadenzaPrenotazioni() {

    try {

        const result = await pool.query(`

            UPDATE prenotazioni

            SET stato = CASE

                -- prenotazione mai usata
                WHEN stato = 'PRENOTATO'
                     AND data_fine < CURRENT_DATE
                     AND orario_ingresso IS NULL
                THEN 'MAI_ENTRATO'

                -- entrato ma mai uscito
                WHEN stato = 'ENTRATO'
                     AND data_fine < CURRENT_DATE
                     AND orario_uscita IS NULL
                THEN 'DA_VERIFICARE'

                ELSE stato

            END

            WHERE

                (
                    stato = 'PRENOTATO'
                    AND data_fine < CURRENT_DATE
                )

                OR

                (
                    stato = 'ENTRATO'
                    AND data_fine < CURRENT_DATE
                    AND orario_uscita IS NULL
                )

        `);

        if (result.rowCount > 0) {

            console.log(
                `[SCADENZA] ${result.rowCount} prenotazioni aggiornate`
            );
        }

    } catch (err) {

        console.error(
            '[SCADENZA] Errore:',
            err.message
        );
    }
}

async function verificaRuolo(npass, ruoloRichiesto) {
    if (!npass) return false;
    const result = await pool.query(
        'SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1',
        [clean(npass)]
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
        const p = clean(npass);

        const result = await pool.query(
            'SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1',
            [p]
        );

        if (result.rows.length > 0) {
            await pool.query(
                'UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1',
                [p]
            );

            return res.json({ valid: true, ruolo: result.rows[0].ruolo });
        }

        res.json({ valid: false });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
    }
});

// --- 2. PRENOTAZIONE CON CONTROLLO QUOTE ENTE CORRETTO ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    const p = clean(npass);
    
    if (!npass || !email) return res.status(400).json({ error: "Inserisci la tua email" });
    if (giorni.length === 1) {
        return res.status(400).json({ 
            error: "Per il parcheggio 【Lunga Sosta】 il minimo di giorni prenotabili sono 2" 
        });
    }
    if (!Array.isArray(giorni) || giorni.length === 0) return res.status(400).json({ error: "Giorni non validi" });
    if (giorni.length > 15) return res.status(400).json({ error: "Limite 15 giorni superato" });

    try {
        const sorted = [...giorni].sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];
        const p = clean(npass);
        const start = new Date(dataInizio);
        const end = new Date(dataFine);
        const numGiorni =
            Math.floor(
                (end - start) / (1000 * 60 * 60 * 24)
            ) + 1;

        // CHECK 1: Sovrapposizione
        const overlap = await pool.query(
            `SELECT id FROM prenotazioni 
             WHERE UPPER(npass) = $1 
               AND stato IN ('PRENOTATO', 'ENTRATO')
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

        // CHECK 2: massimo 15 giorni cumulativi in 45 giorni
        
        const inizioNuova = new Date(dataInizio);
        const fineNuova = new Date(dataFine);
        
        // finestra mobile di 45 giorni
        const finestraStart = new Date(inizioNuova);
        finestraStart.setDate(finestraStart.getDate() - 44);
        
        const finestraEnd = new Date(inizioNuova);
        finestraEnd.setDate(finestraEnd.getDate() + 44);
        
        const finestraStartStr = finestraStart.toISOString().split('T')[0];
        const finestraEndStr = finestraEnd.toISOString().split('T')[0];
        
        // recupera tutte le prenotazioni che toccano la finestra
        const prenEsistenti = await pool.query(
            `
            SELECT data_inizio, data_fine
            FROM prenotazioni
            WHERE UPPER(npass) = $1
              AND stato IN ('PRENOTATO', 'ENTRATO')
              AND data_inizio <= $2
              AND data_fine >= $3
            `,
            [p, finestraEndStr, finestraStartStr]
        );

        // uso Set per evitare doppi conteggi
        const giorniOccupati = new Set();
        
        // aggiungi giorni già prenotati
        prenEsistenti.rows.forEach(row => {
        
            let d = new Date(row.data_inizio);
            const end = new Date(row.data_fine);
        
            while (d <= end) {
        
                giorniOccupati.add(
                    d.toISOString().split('T')[0]
                );
        
                d.setDate(d.getDate() + 1);
            }
        });
        
        // aggiungi nuova richiesta
        let d = new Date(inizioNuova);
        
        while (d <= fineNuova) {
        
            giorniOccupati.add(
                d.toISOString().split('T')[0]
            );
        
            d.setDate(d.getDate() + 1);
        }
        
        // controllo finale
        if (giorniOccupati.size > 15) {
        
            return res.status(400).json({
                error: `Limite superato: massimo 15 giorni prenotabili in qualunque finestra di 45 giorni consecutivi.`
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
                   AND p.stato IN ('PRENOTATO', 'ENTRATO')
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
    <div style="font-family:sans-serif; max-width:520px; margin:auto;">

        <!-- BOX PRINCIPALE -->
        <div style="
            text-align:center;
            border:2px solid #4A90E2;
            padding:20px;
            border-radius:15px;
            background:#ffffff;
        ">
            <img 
                src="${LOGO_URL}" 
                alt="Logo CLF" 
                style="width:130px; margin-bottom:20px;"
            >
            <h2 style="color:#4A90E2; margin-bottom:10px;">
                Prenotazione Confermata
            </h2>
            <p style="font-size:15px; color:#111827;">
                Gentile utente <b>${p}</b>,</p>
               <p style="margin:0px;">il tuo pass <b>[Lunga Sosta]</b> è pronto.
            </p>
            <div style="
                background-color:#f4f8ff;
                padding:14px;
                border-radius:12px;
                margin:20px 0;
                line-height:1.8;
            ">
                <p style="margin:0; line-height:1.8;">
    Dal <b>${formattaDataIT(dataInizio)}</b>
    al <b>${formattaDataIT(dataFine)}</b><br>
    <b>Giorni totali:</b> ${numGiorni}</p>
            </div>
            <p style="
                font-size:12px;
                color:#666;
                line-height:1.6;
                margin-top:15px;
            ">
                In allegato trovi il PDF da esporre sul parabrezza,
                unitamente al tuo Pass “Permanente”.
            </p>

        </div>

        <!-- GDPR FUORI DAL BOX -->
        <div style="
            margin-top:16px;
            padding:14px;
            background:#f0fdf4;
            border:1px solid #86efac;
            border-radius:12px;
            font-size:11px;
            color:#166534;
            line-height:1.7;
            text-align:justify;
        ">
            🛡️ <strong>Privacy & Sicurezza (GDPR)</strong><br><br>
            Usiamo la tua email esclusivamente per l’invio del ticket
            tramite infrastrutture sicure (Brevo & Google).
            <br><br>
            Il dato non viene archiviato per scopi pubblicitari
            e sarà cancellato automaticamente al termine della tua sosta.
        </div>
    </div>
`;
await inviaMailBrevoAPI(email,`Il tuo PASS - ${p}`, htmlUtente, pdfData, `PASS_${p}.pdf`);
            
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
        doc.fontSize(28).fillColor('#4A90E2').text('PARCHEGGIO C.L. FONTANAROSSA', 50, 80, { align: 'center' });
        doc.fontSize(90).fillColor('black').text(p, 50, 140, { align: 'center' });
        doc.fontSize(32).fillColor('black').text('[LUNGA SOSTA]', 50, 235, { align: 'center' });
        doc.fontSize(28).text(`DAL  ${formattaDataIT(dataInizio)}  AL  ${formattaDataIT(dataFine)}`, 50, 295, { align: 'center' });
        doc.end();

    } catch (err) {
        console.error('[PRENOTA]', err);
        res.status(500).json({ error: err.message });
    }
});

// --- 3. LE MIE PRENOTAZIONI ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {

    try {

        const p = clean(req.params.npass);

        const r = await pool.query(`

            SELECT
                id,
                npass,
                data_inizio,
                data_fine,
                orario_ingresso,
                orario_uscita,
                stato,
                data_inserimento

            FROM prenotazioni

            WHERE UPPER(npass) = $1

            ORDER BY
                data_inserimento DESC,
                id DESC

        `, [p]);

        res.json(r.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Errore interno"
        });
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
       if (
            stato !== 'PRENOTATO'
        ) {
            return res.status(400).json({
                error: "Prenotazione non cancellabile."
            });
        }
        
        await pool.query(
            'DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2',
            [id, p]
        );

        const htmlDisdetta = `
            <div style="text-align:center; font-family:sans-serif; border:2px solid red; padding:20px; border-radius:10px; max-width:400px; margin:auto;">
                <h3 style="color:red;">⚠️ Prenotazione Cancellata</h3>
                <p><b>Pass:</b> ${p}</p>
                <p><b>Periodo:</b> ${formattaDataIT(data_inizio)} al ${formattaDataIT(data_fine)}</p>
            </div>`;
        await inviaMailBrevoAPI("parkingclf.am@gmail.com", `⚠️ Disdetta: ${p}`, htmlDisdetta);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
    }
});

// --- 5. VEICOLI DENTRO ---
app.get('/api/veicoli-dentro', async (req, res) => {

    const npass = req.query.npass;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({
            error: "Accesso non autorizzato"
        });
    }

    try {

        const r = await pool.query(`

            SELECT
                npass,
                data_inizio,
                data_fine,
                orario_ingresso,
                orario_uscita,
                data_inserimento,
                stato

            FROM prenotazioni

            WHERE stato IN (
                'PRENOTATO',
                'ENTRATO',
                'USCITO',
                'DA_VERIFICARE',
                'MAI_ENTRATO'
            )

            ORDER BY
                data_inserimento DESC,
                id DESC

            LIMIT 300

        `);

        res.json(r.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Errore interno"
        });
    }
});

// --- PIANTONE CERCA ---
app.get('/api/piantone/cerca/:npass', async (req, res) => {

    const authPass = req.query.auth;
    const view = req.query.view || 'attivi';

    if (!await verificaRuolo(authPass, ['piantone', 'admin'])) {

        return res.status(403).json({
            error: "Accesso non autorizzato"
        });
    }

    try {

        //const oggi = new Date().toISOString().split('T')[0];

        let whereFiltro = "";

    // ATTIVI = dentro OR prenotati validi oggi
       if (view === 'attivi') {
    
        whereFiltro = `
            AND (
                stato = 'PRENOTATO'
                OR stato = 'ENTRATO'
            )
        `;
    }   
   // SCADUTI
else if (view === 'scaduti') {

    whereFiltro = `
        AND (
            stato = 'DA_VERIFICARE'
            OR stato = 'MAI_ENTRATO'
        )
    `;
}
 else if (view === 'verificare') {

    whereFiltro = `
        AND stato = 'DA_VERIFICARE'
    `;
}   
    // STORICO = usciti
    else if (view === 'storico') {
    
        whereFiltro = `
            AND stato = 'USCITO'
        `;
    }
    
    // TUTTI
    else {
    
        whereFiltro = `
            AND stato IN (
    'PRENOTATO',
    'ENTRATO',
    'USCITO',
    'DA_VERIFICARE',
    'MAI_ENTRATO'
)
        `;
    }
        const query = `

            SELECT *

            FROM prenotazioni

            WHERE
                UPPER(npass) = $1
                ${whereFiltro}

           ORDER BY
            data_inserimento DESC,
            id DESC
        `;

        const r = await pool.query(query, [
            req.params.npass.toUpperCase()
        ]);

        if (!r.rows.length) {

            return res.json({
                trovato: false
            });
        }

        return res.json({
        trovato: true,
        prenotazione: r.rows[0],
        storico: r.rows
        });

    } catch (err) {

        console.error("ERRORE CERCA PASS:", err);

        return res.status(500).json({
            error: "Errore interno server"
        });
    }
});

// --- PIANTONE AZIONE ---
app.post('/api/piantone/azione', async (req, res) => {

    const { id, azione, npass } = req.body;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({
            error: "Accesso non autorizzato"
        });
    }

    if (!id || !azione) {
        return res.status(400).json({
            error: "Dati mancanti"
        });
    }

    try {

        const ora = new Date();

        // 🔍 recupera prenotazione reale
        const prenRes = await pool.query(
            "SELECT * FROM prenotazioni WHERE id = $1",
            [id]
        );

        if (prenRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Prenotazione non trovata"
            });
        }

        const pren = prenRes.rows[0];

        // 🚫 uscita senza ingresso
        if (
            azione === 'uscita' &&
            !pren.orario_ingresso
        ) {
            return res.status(400).json({
                success: false,
                error: "Auto mai entrata"
            });
        }

        // 🚫 doppio ingresso
        if (
            azione === 'ingresso' &&
            pren.orario_ingresso
        ) {
            return res.status(400).json({
                success: false,
                error: "Ingresso già registrato"
            });
        }

        // 🚫 doppia uscita
        if (
            azione === 'uscita' &&
            pren.orario_uscita
        ) {
            return res.status(400).json({
                success: false,
                error: "Uscita già registrata"
            });
        }

        // ✅ INGRESSO
        if (azione === 'ingresso') {

            await pool.query(
                `
                UPDATE prenotazioni
                SET
                    stato = 'ENTRATO',
                    orario_ingresso = $1
                WHERE id = $2
                `,
                [ora, id]
            );

            return res.json({
                success: true
            });
        }

        // ✅ USCITA
        if (azione === 'uscita') {

            await pool.query(
                `
                UPDATE prenotazioni
                SET
                    stato = CASE
                        WHEN stato = 'DA_VERIFICARE'
                        THEN 'SCADUTO'
                        ELSE 'USCITO'
                    END,
                    orario_uscita = $1
                WHERE id = $2
                `,
                [ora, id]
            );

            return res.json({
                success: true
            });
        }

        // 🚫 azione non valida
        return res.status(400).json({
            success: false,
            error: "Azione non valida"
        });

    } catch (err) {

        console.error("Errore piantone:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// --- 7B. PIANTONE LIBERI ---
app.get('/api/piantone/liberi', async (req, res) => {

    try {

        const oggi = new Date().toISOString().split('T')[0];

        const result = await pool.query(`
        SELECT COUNT(DISTINCT npass) as dentro
        FROM prenotazioni
        WHERE
        stato = 'ENTRATO'
        OR (
            stato = 'SCADUTO'
            AND orario_uscita IS NULL
        )
        `);

        const dentro = parseInt(result.rows[0].dentro) || 0;

        res.json({
            dentro,
            totaleLiberi: 120 - dentro
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Errore interno"
        });
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
                WHERE p.stato IN ('PRENOTATO', 'ENTRATO')
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
            WHERE stato = 'ENTRATO'
            AND CURRENT_DATE > data_fine
        `);

        res.json(r.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/piantone/storico', async (req, res) => {
    const npass = req.query.npass;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }

    try {
        const r = await pool.query(`
            SELECT npass, orario_ingresso, orario_uscita, stato
            FROM prenotazioni
            WHERE stato = 'USCITO'
            ORDER BY orario_ingresso DESC
            LIMIT 30
        `);

        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
    }
});

// --- PIANTONE ARRIVI OGGI ---
app.get('/api/piantone/arrivi-oggi', async (req, res) => {

  try {

    const r = await pool.query(`

      SELECT DISTINCT ON (UPPER(p.npass))

        UPPER(p.npass) AS npass,
        r.ente,
        'PRENOTATO' AS stato

      FROM prenotazioni p

      LEFT JOIN registro_pass r
        ON UPPER(p.npass) = UPPER(r.npass)

      WHERE
        CURRENT_DATE BETWEEN p.data_inizio AND p.data_fine
        AND p.stato = 'PRENOTATO'

      ORDER BY
        UPPER(p.npass),
        p.data_inizio DESC,
        p.id DESC

    `);

    res.json(r.rows);

  } catch (e) {

    console.error(e);
    res.status(500).json({ error: 'Errore server' });
  }
});

app.post('/api/piantone/non-presente', async (req, res) => {

    const { id } = req.body;

    try {

        await pool.query(`
            UPDATE prenotazioni
            SET stato = 'USCITO'
            WHERE id = $1
        `, [id]);

        res.json({ success: true });

    } catch (err) {

        res.status(500).json({
            error: err.message
        });
    }
});

// avvio immediato
scadenzaPrenotazioni();
// ogni 5 minuti
setInterval(scadenzaPrenotazioni, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Server avviato`);
});
