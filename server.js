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

// --- PRENOTAZIONE COMPLETA SICURA ---
app.post('/api/prenota', async (req, res) => {

    const { npass, giorni, email } = req.body;

    if (!npass || !email) {

        return res.status(400).json({
            error: "Dati mancanti"
        });
    }

    if (!Array.isArray(giorni) || giorni.length === 0) {

        return res.status(400).json({
            error: "Giorni non validi"
        });
    }

    if (giorni.length > 15) {

        return res.status(400).json({
            error: "Massimo 15 giorni"
        });
    }

    try {

        const p = clean(npass);

        // ordina giorni
        const sorted = [...giorni].sort();

        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];

        // controllo continuità giorni
        let tmp = new Date(dataInizio);

        for (let i = 0; i < sorted.length; i++) {

            const iso = tmp.toISOString().split('T')[0];

            if (iso !== sorted[i]) {

                return res.status(400).json({
                    error: "I giorni devono essere consecutivi"
                });
            }

            tmp.setDate(tmp.getDate() + 1);
        }

        // ---------------------------------------------------
        // RECUPERO UTENTE + ENTE
        // ---------------------------------------------------

        const userInfo = await pool.query(`
            SELECT
                r.ente,
                COALESCE(a.posti, 0) as posti

            FROM registro_pass r

            LEFT JOIN assegnazioni a
                ON a.ente = r.ente

            WHERE UPPER(r.npass) = $1

            LIMIT 1
        `, [p]);

        if (!userInfo.rows.length) {

            return res.status(400).json({
                error: "Utente non trovato"
            });
        }

        const ente = userInfo.rows[0].ente;
        const postiEnte = parseInt(userInfo.rows[0].posti || 0);

        if (!ente || postiEnte <= 0) {

            return res.status(400).json({
                error: "Ente non configurato"
            });
        }

        // ---------------------------------------------------
        // 🚫 controllo sovrapposizioni stesso utente
        // ---------------------------------------------------
const overlap = await pool.query(
    `SELECT id 
     FROM prenotazioni 
     WHERE UPPER(npass) = $1 
       AND stato IN ('PRENOTATO', 'ENTRATO')
       AND (
            data_inizio <= $3
            AND data_fine >= $2
        )`,
    [p, dataInizio, dataFine]
);

if (overlap.rows.length > 0) {

    return res.status(400).json({

        error: 'Hai già una prenotazione in queste date'

    });

}

        // ---------------------------------------------------
        // CHECK 15 GIORNI SU FINESTRA MOBILE
        // ---------------------------------------------------

        const finestraStart = new Date(dataInizio);
        finestraStart.setDate(finestraStart.getDate() - 44);

        const finestraEnd = new Date(dataInizio);
        finestraEnd.setDate(finestraEnd.getDate() + 44);

        const prenUtente = await pool.query(`
            SELECT
                data_inizio,
                data_fine

            FROM prenotazioni

            WHERE
                UPPER(npass) = $1

                AND stato IN (
                    'PRENOTATO',
                    'ENTRATO'
                )

                AND data_inizio <= $2
                AND data_fine >= $3
        `,
        [
            p,
            finestraEnd.toISOString().split('T')[0],
            finestraStart.toISOString().split('T')[0]
        ]);

        const giorniOccupati = new Set();

        prenUtente.rows.forEach(r => {

            let d = new Date(r.data_inizio);
            const end = new Date(r.data_fine);

            while (d <= end) {

                giorniOccupati.add(
                    d.toISOString().split('T')[0]
                );

                d.setDate(d.getDate() + 1);
            }
        });

        let check = new Date(dataInizio);

        while (check <= new Date(dataFine)) {

            giorniOccupati.add(
                check.toISOString().split('T')[0]
            );

            check.setDate(check.getDate() + 1);
        }

        if (giorniOccupati.size > 15) {

            return res.status(400).json({
                error: "Massimo 15 giorni prenotabili in 45 giorni"
            });
        }

        // ---------------------------------------------------
        // CHECK DISPONIBILITA ENTE
        // ---------------------------------------------------

        for (const giorno of giorniRichiesti) {

    const occupatiEnte = await pool.query(`
        SELECT COUNT(DISTINCT p.npass) as count
        FROM prenotazioni p
        JOIN registro_pass r ON UPPER(p.npass) = UPPER(r.npass)
        WHERE r.ente = $1
          AND p.stato IN ('PRENOTATO', 'ENTRATO')
          AND $2 BETWEEN p.data_inizio AND p.data_fine
    `, [userEnte, giorno]);

    const count = parseInt(occupatiEnte.rows[0].count);

    if (count >= postiEnte) {

        return res.status(400).json({
            error: `Posti esauriti per il giorno ${giorno}`
        });
    }
}

        // ---------------------------------------------------
        // INSERIMENTO
        // ---------------------------------------------------

        await pool.query(`

            INSERT INTO prenotazioni (
                npass,
                ente,
                data_inizio,
                data_fine,
                stato
            )

            VALUES (
                $1,
                $2,
                $3,
                $4,
                'PRENOTATO'
            )

        `,
        [
            p,
            ente,
            dataInizio,
            dataFine
        ]);

        // aggiorna ultimo utilizzo
        await pool.query(`
            UPDATE registro_pass
            SET ult_pren = NOW()
            WHERE UPPER(npass) = $1
        `, [p]).catch(e => console.log(e));

        // ---------------------------------------------------
        // PDF
        // ---------------------------------------------------

        const start = new Date(dataInizio);
        const end = new Date(dataFine);

        const numGiorni =
            Math.floor(
                (end - start) /
                (1000 * 60 * 60 * 24)
            ) + 1;

        const doc = new PDFDocument({
            size: 'A4',
            margin: 50
        });

        let buffers = [];

        doc.on('data', buffers.push.bind(buffers));

        doc.on('end', async () => {

            const pdfData = Buffer.concat(buffers);

            const htmlUtente = `
                <div style="font-family:sans-serif;">
                    <h2>Prenotazione Confermata</h2>

                    <p><b>PASS:</b> ${p}</p>

                    <p>
                        Dal
                        <b>${formattaDataIT(dataInizio)}</b>
                        al
                        <b>${formattaDataIT(dataFine)}</b>
                    </p>

                    <p>
                        Giorni totali:
                        <b>${numGiorni}</b>
                    </p>
                </div>
            `;

            await inviaMailBrevoAPI(
                email,
                `PASS ${p}`,
                htmlUtente,
                pdfData,
                `PASS_${p}.pdf`
            );

            res.json({
                success: true
            });

        });

        doc.rect(40, 40, 515, 320)
            .lineWidth(3)
            .stroke('#4A90E2');

        doc.fontSize(22)
            .fillColor('#4A90E2')
            .text(
                'PARCHEGGIO C.L. FONTANAROSSA',
                50,
                80,
                { align: 'center' }
            );

        doc.fontSize(90)
            .fillColor('black')
            .text(
                p,
                50,
                140,
                { align: 'center' }
            );

        doc.fontSize(24)
            .text(
                `DAL ${formattaDataIT(dataInizio)} AL ${formattaDataIT(dataFine)}`,
                50,
                295,
                { align: 'center' }
            );

        doc.end();

    } catch (err) {

        console.error('[PRENOTA]', err);

        res.status(500).json({
            error: "Errore prenotazione"
        });
    }
});

// --- 3. LE MIE PRENOTAZIONI ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    try {
        const p = req.params.npass.toUpperCase();
        const r = await pool.query(
            `SELECT
                id,
                data_inizio,
                data_fine,
                stato,
                orario_ingresso,
                orario_uscita
             FROM prenotazioni
             WHERE UPPER(npass) = $1 AND data_inizio >= CURRENT_DATE - interval '60 days'
             ORDER BY data_inizio DESC`,
            [p]
        );
        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
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
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }
    try {
        const r = await pool.query(
            "SELECT npass, data_fine, orario_ingresso, orario_uscita, stato FROM prenotazioni WHERE stato IN ('ENTRATO', 'USCITO') ORDER BY COALESCE(orario_uscita, orario_ingresso) DESC LIMIT 20"
        );
        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
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

        const oggi = new Date().toISOString().split('T')[0];

        let whereFiltro = "";

        // ATTIVI
        if (view === 'attivi') {

            whereFiltro = `
                AND (
                    (
                        stato = 'PRENOTATO'
                        AND CURRENT_DATE BETWEEN data_inizio AND data_fine
                    )
                    OR stato = 'ENTRATO'
                    OR (
                        stato = 'SCADUTO'
                        AND orario_uscita IS NULL
                    )
                )
            `;
        }

        // SCADUTI
        else if (view === 'scaduti') {

            whereFiltro = `
                AND stato = 'ENTRATO'
                AND CURRENT_DATE > data_fine
            `;
        }

        // STORICO
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
                    'SCADUTO'
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

                CASE
                    WHEN stato = 'ENTRATO' THEN 1
                    WHEN stato = 'PRENOTATO' THEN 2
                    WHEN stato = 'SCADUTO' THEN 3
                    WHEN stato = 'USCITO' THEN 4
                    ELSE 99
                END,

                data_inizio DESC

            LIMIT 1

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
            prenotazione: r.rows[0]
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
                    stato = 'USCITO',
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
        const r = await pool.query(
            `SELECT COUNT(*) as count
             FROM prenotazioni
             WHERE stato = 'ENTRATO'
             AND $1 BETWEEN data_inizio AND data_fine`,
            [oggi]
        );
        const dentro = parseInt(r.rows[0].count);
        const totaleLiberi = Math.max(0, 120 - dentro);
        res.json({ totaleLiberi, dentro });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
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
            WHERE orario_ingresso IS NOT NULL
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
      SELECT
        p.npass,
        r.ente,

        CASE
          WHEN p.stato = 'ENTRATO' THEN 'ENTRATO'
          WHEN CURRENT_DATE > p.data_fine THEN 'SCADUTO'
          ELSE 'PRENOTATO'
        END AS stato

      FROM prenotazioni p

      LEFT JOIN registro_pass r
        ON UPPER(p.npass) = UPPER(r.npass)

      WHERE CURRENT_DATE BETWEEN p.data_inizio AND p.data_fine
         OR CURRENT_DATE > p.data_fine

      ORDER BY p.npass
    `);

    res.json(r.rows);

  } catch (e) {

    console.error(e);
    res.status(500).json({ error: 'Errore server' });
  }
});

// --- DISPONIBILITA GIORNI PER ENTE ---
app.get('/api/disponibilita/:npass', async (req, res) => {
const npass = req.params.npass.toUpperCase();
    if (!npass) {
    return res.status(400).json({ error: "npass mancante" });
}
    try {     
        const utente = await pool.query(`
            SELECT ente
            FROM utenti
            WHERE UPPER(npass) = $1
            LIMIT 1
        `, [npass]);

        if (!utente.rows.length) {
            return res.json({});
        }

        const ente = utente.rows[0].ente;

        const enteCfg = await pool.query(`
            SELECT posti
            FROM enti
            WHERE nome = $1
            LIMIT 1
        `, [ente]);

        const totale = parseInt(enteCfg.rows[0]?.posti || 0);

        const pren = await pool.query(`
            SELECT 
                generate_series(
                    data_inizio::date,
                    data_fine::date,
                    interval '1 day'
                )::date as giorno
            FROM prenotazioni
            WHERE ente = $1
              AND stato IN ('PRENOTATO', 'ENTRATO')
        `, [ente]);

        const mappa = {};

        pren.rows.forEach(r => {

            // 🔥 FIX SICURO: evita toISOString
            const g = String(r.giorno).split('T')[0];

            mappa[g] = (mappa[g] || 0) + 1;
        });

        const out = {};

        Object.keys(mappa).forEach(g => {

            const prenotati = mappa[g];

            out[g] = {
                prenotati,
                liberi: Math.max(totale - prenotati, 0),
                totale
            };

        });

        res.json(out);

    } catch (err) {
        console.error("ERRORE disponibilità:", err);
        res.status(500).json({ error: "Errore server disponibilità" });
    }

});

//PORTA SERVER//
app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Server avviato`);
});
