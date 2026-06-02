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

function formattaDataIT(isoStr) {
    if (!isoStr) return '--/--/----';
    const d = new Date(isoStr);
    const giorno = String(d.getDate()).padStart(2, '0');
    const mese = String(d.getMonth() + 1).padStart(2, '0');
    const anno = d.getFullYear();
    return `${giorno}/${mese}/${anno}`;
}

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
                -- Il periodo prenotato è COMPLETAMENTE SUPERATO e l'auto non è mai entrata.
                -- Diventa ARCHIVIATO e sparisce dalle liste operative del piantone.
                WHEN stato IN ('PRENOTATO', 'SCADUTO')
                     AND data_fine < CURRENT_DATE
                     AND orario_ingresso IS NULL
                THEN 'ARCHIVIATO'

                -- Il periodo è superato, l'auto risulta ENTRATA ma non è mai stata registrata l'uscita.
                -- Diventa DA_VERIFICARE (va nei ritardi effettivi del piantone/admin).
                WHEN stato = 'ENTRATO'
                     AND data_fine < CURRENT_DATE
                     AND orario_uscita IS NULL
                THEN 'DA_VERIFICARE'

                ELSE stato
            END
            WHERE
                (
                    stato IN ('PRENOTATO', 'SCADUTO')
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
            console.log(`[SCADENZA] ${result.rowCount} prenotazioni aggiornate nei record storici`);
        }
    } catch (err) {
        console.error('[SCADENZA] Errore:', err.message);
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
        const numGiorni = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;

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
        
        const finestraStart = new Date(inizioNuova);
        finestraStart.setDate(finestraStart.getDate() - 44);
        
        const finestraEnd = new Date(inizioNuova);
        finestraEnd.setDate(finestraEnd.getDate() + 44);
        
        const finestraStartStr = finestraStart.toISOString().split('T')[0];
        const finestraEndStr = finestraEnd.toISOString().split('T')[0];
        
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

        const giorniOccupati = new Set();
        
        prenEsistenti.rows.forEach(row => {
            let d = new Date(row.data_inizio);
            const end = new Date(row.data_fine);
            while (d <= end) {
                giorniOccupati.add(d.toISOString().split('T')[0]);
                d.setDate(d.getDate() + 1);
            }
        });
        
        let d = new Date(inizioNuova);
        while (d <= fineNuova) {
            giorniOccupati.add(d.toISOString().split('T')[0]);
            d.setDate(d.getDate() + 1);
        }
        
        if (giorniOccupati.size > 15) {
            return res.status(400).json({
                error: `Limite superato: massimo 15 giorni prenotabili in qualunque finestra di 45 giorni consecutivi.`
            });
        }

        // CHECK 3: Quote ENTE
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

        const giorniRichiesti = [];
        for (let d = new Date(dataInizio); d <= new Date(dataFine); d.setDate(d.getDate() + 1)) {
            giorniRichiesti.push(d.toISOString().split('T')[0]);
        }

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
        <div style="text-align:center; border:2px solid #4A90E2; padding:20px; border-radius:15px; background:#ffffff;">
            <img src="${LOGO_URL}" alt="Logo CLF" style="width:130px; margin-bottom:20px;">
            <h2 style="color:#4A90E2; margin-bottom:10px;">Prenotazione Confermata</h2>
            <p style="font-size:15px; color:#111827;">Gentile utente <b>${p}</b>,</p>
            <p style="margin:0px;">il tuo pass <b>[Lunga Sosta]</b> è pronto.</p>
            <div style="background-color:#f4f8ff; padding:14px; border-radius:12px; margin:20px 0; line-height:1.8;">
                <p style="margin:0; line-height:1.8;">
                Dal <b>${formattaDataIT(dataInizio)}</b> al <b>${formattaDataIT(dataFine)}</b><br>
                <b>Giorni totali:</b> ${numGiorni}</p>
            </div>
            <p style="font-size:12px; color:#666; line-height:1.6; margin-top:15px;">
                In allegato trovi il PDF da esporre sul parabrezza, unitamente al tuo Pass “Permanente”.
            </p>
        </div>
        <div style="margin-top:16px; padding:14px; background:#f0fdf4; border:1px solid #86efac; border-radius:12px; font-size:11px; color:#166534; line-height:1.7; text-align:justify;">
            🛡️ <strong>Privacy & Sicurezza (GDPR)</strong><br><br>
            Usiamo la tua email esclusivamente per l’invio del ticket tramite infrastrutture sicure (Brevo & Google).<br><br>
            Il dato non viene archiviato per scopi pubblicitari e sarà cancellato automaticamente al termine della tua sosta.
        </div>
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
            SELECT id, npass, data_inizio, data_fine, orario_ingresso, orario_uscita, stato, data_inserimento
            FROM prenotazioni
            WHERE UPPER(npass) = $1
            ORDER BY data_inserimento DESC, id DESC
        `, [p]);
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
        if (stato !== 'PRENOTATO') {
            return res.status(400).json({ error: "Prenotazione non cancellabile." });
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

// 🌟 API SALVATAGGIO SUGGERIMENTO / NOTA ED INVIO EMAIL
app.post('/api/user/salva-nota', async (req, res) => {
    const { npass, nota, email } = req.body;
    if (!npass) return res.status(400).json({ success: false, error: 'Pass mancante' });

    try {
        await pool.query(`
            UPDATE registro_pass 
            SET note = $1 
            WHERE UPPER(npass) = UPPER($2)
        `, [nota, npass]);

        console.log("✉️ Invio email a parkingclf.am@gmail.com per il suggerimento del pass:", npass);
        res.json({ success: true });
    } catch (e) {
        console.error('Errore durante il salvataggio del suggerimento:', e);
        res.status(500).json({ success: false, error: 'Errore interno del server' });
    }
});

// --- 5. VEICOLI DENTRO (CORRETTO PER SCADUTI IMMEDIATI) ---
app.get('/api/veicoli-dentro', async (req, res) => {
    const npass = req.query.npass;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }

    try {
        const oggi = new Date().toISOString().split('T')[0];
        
        // 🚀 MODIFICA: Usiamo <= per includere subito chi doveva entrare ieri (Inizio + 1 giorno <= Oggi)
        await pool.query(`
            UPDATE prenotazioni 
            SET stato = 'SCADUTO' 
            WHERE stato = 'PRENOTATO' 
              AND (data_inizio + INTERVAL '1 day') <= $1 
              AND orario_ingresso IS NULL
              AND data_fine >= $1
        `, [oggi]);

        // Archiviazione a fine periodo
        await pool.query(`
            UPDATE prenotazioni 
            SET stato = 'ARCHIVIATO' 
            WHERE stato = 'SCADUTO' 
              AND data_fine < $1
        `, [oggi]);
        
        const r = await pool.query(`
            SELECT id, npass, data_inizio, data_fine, orario_ingresso, orario_uscita, data_inserimento, stato
            FROM prenotazioni
            WHERE stato IN ('PRENOTATO', 'ENTRATO', 'DA_VERIFICARE', 'SCADUTO')
               OR (stato = 'USCITO' AND orario_uscita::date = CURRENT_DATE)
            ORDER BY data_inizio ASC, orario_ingresso ASC
            LIMIT 300
        `);

        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore interno" });
    }
});

// --- PIANTONE CERCA (AGGIORNATO E ISOLATO) ---
app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const authPass = req.query.auth;
    const view = req.query.view || 'all'; // Default broad se non specificato
    const idSelezionato = req.query.id;   // 🚀 Fondamentale: Intercettiamo l'ID cliccato dalla tabella

    if (!await verificaRuolo(authPass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }

    try {
        let query = "";
        let params = [];
        let whereFiltro = "";

        // Generiamo il filtro in base alla scheda (view) per usarlo in entrambi i casi
        if (view === 'attivi') {
            // 🚀 ISOLATO: Rimosso 'DA_VERIFICARE' dagli attivi reali
            whereFiltro = `AND stato IN ('PRENOTATO', 'ENTRATO')`;
        } else if (view === 'scaduti') {
            whereFiltro = `AND stato = 'SCADUTO'`;
        } else if (view === 'verificare') {
            // Ora quando clicchi qui, la ricerca sa che deve cercare solo tra questi
            whereFiltro = `AND stato = 'DA_VERIFICARE'`;
        } else if (view === 'storico') {
            whereFiltro = `AND stato IN ('USCITO', 'ARCHIVIATO')`;
        } else {
            whereFiltro = `AND stato IN ('PRENOTATO', 'ENTRATO', 'USCITO', 'DA_VERIFICARE', 'SCADUTO', 'ARCHIVIATO')`;
        }

        // 🚀 CASO A: Il piantone ha CLICCATO su una riga specifica della tabella (Abbiamo l'ID univoco)
        if (idSelezionato) {
            query = `
                SELECT id, npass, data_inizio, data_fine, orario_ingresso, orario_uscita, stato, note
                FROM prenotazioni
                WHERE id = $1 AND UPPER(npass) = $2 ${whereFiltro}
            `;
            params = [idSelezionato, req.params.npass.toUpperCase()];
        } 
        // 🔍 CASO B: Il piantone ha SCRITTO a mano il pass nella barra di ricerca (Senza ID)
        else {
            query = `
                SELECT id, npass, data_inizio, data_fine, orario_ingresso, orario_uscita, stato, note
                FROM prenotazioni
                WHERE UPPER(npass) = $1 ${whereFiltro}
                ORDER BY
                    CASE
                        WHEN stato = 'ENTRATO' THEN 1
                        WHEN stato = 'DA_VERIFICARE' THEN 2
                        WHEN CURRENT_DATE BETWEEN data_inizio AND data_fine AND stato = 'PRENOTATO' THEN 3
                        WHEN data_inizio >= CURRENT_DATE AND stato = 'PRENOTATO' THEN 4
                        ELSE 5
                    END ASC,
                    data_inizio DESC,
                    id DESC
            `;
            params = [req.params.npass.toUpperCase()];
        }

        const r = await pool.query(query, params);

        if (!r.rows.length) {
            return res.json({ trovato: false });
        }

        // Restituiamo l'elemento trovato (il primo secondo l'ordinamento o l'ID esatto)
        return res.json({
            trovato: true,
            prenotazione: r.rows[0],
            storico: r.rows // Mantenuto per compatibilità se serve al client
        });

    } catch (err) {
        console.error("ERRORE CERCA PASS:", err);
        return res.status(500).json({ error: "Errore interno server" });
    }
});

// --- PIANTONE AZIONE ---
app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione, npass } = req.body;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }

    if (!id || !azione) return res.status(400).json({ error: "Dati mancanti" });

    try {
        const ora = new Date();
        const prenRes = await pool.query("SELECT * FROM prenotazioni WHERE id = $1", [id]);

        if (prenRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Prenotazione non trovata" });
        }

        const pren = prenRes.rows[0];

        if (azione === 'uscita' && !pren.orario_ingresso) {
            return res.status(400).json({ success: false, error: "Auto mai entrata" });
        }
        if (azione === 'ingresso' && pren.orario_ingresso) {
            return res.status(400).json({ success: false, error: "Ingresso già registrato" });
        }
        if (azione === 'uscita' && pren.orario_uscita) {
            return res.status(400).json({ success: false, error: "Uscita già registrata" });
        }

        if (azione === 'ingresso') {
            await pool.query(
                `UPDATE prenotazioni SET stato = 'ENTRATO', orario_ingresso = $1 WHERE id = $2`,
                [ora, id]
            );
            return res.json({ success: true });
        }

        if (azione === 'uscita') {
            await pool.query(
                `UPDATE prenotazioni 
                 SET stato = CASE WHEN stato = 'DA_VERIFICARE' THEN 'SCADUTO' ELSE 'USCITO' END, 
                     orario_uscita = $1 
                 WHERE id = $2`,
                [ora, id]
            );
            return res.json({ success: true });
        }

        return res.status(400).json({ success: false, error: "Azione non valida" });

    } catch (err) {
        console.error("Errore piantone:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 7B. PIANTONE LIBERI (CON ESCLUSIONE V1P E CONTEGGIO LISTA) ---
app.get('/api/piantone/liberi', async (req, res) => {
    try {
        // Estraiamo tutti i veicoli attualmente dentro (orario_uscita IS NULL)
        const result = await pool.query(`
            SELECT npass 
            FROM prenotazioni
            WHERE orario_ingresso IS NOT NULL 
              AND orario_uscita IS NULL
        `);
        
        let dentroStandard = 0;
        let listaV1p = 0;

        result.rows.forEach(row => {
            const pass = (row.npass || '').toUpperCase().trim();
            if (pass.startsWith('V1P')) {
                listaV1p++; // Conta quanti V1P sono dentro
            } else {
                dentroStandard++; // Conta i veicoli standard dentro
            }
        });
        
        // Calcolo pulito: i V1P non toccano i 90 posti standard
        const totaleLiberi = 90 - dentroStandard;

        res.json({ 
            dentro: dentroStandard, 
            totaleLiberi: totaleLiberi,
            listaV1p: listaV1p
        });
    } catch (err) {
        console.error("💥 ERRORE CONTEGGIO LIBERI:", err);
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
            SELECT g.giorno, ep.ente, ep.posti, COUNT(DISTINCT pa.npass) as occupati
            FROM giorni g
            CROSS JOIN enti_posti ep
            LEFT JOIN prenotazioni_attive pa 
                ON pa.ente = ep.ente AND g.giorno BETWEEN pa.data_inizio AND pa.data_fine
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
            totaleLiberi: 90 - day.totaleOccupati
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
            SELECT npass, data_fine, orario_uscita, (CURRENT_DATE - data_fine) as giorni_ritardo
            FROM prenotazioni
            WHERE stato = 'ENTRATO' AND CURRENT_DATE > data_fine
        `);
        res.json(r.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PIANTONE STORICO (OTTIMIZZATO - MOSTRA USCITI E ARCHIVIATI DELL'ULTIMA SETTIMANA) 
app.get('/api/piantone/storico', async (req, res) => {
    const npass = req.query.npass;

    if (!await verificaRuolo(npass, ['piantone', 'admin'])) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
    }

    try {
        // 1. Includiamo sia lo stato 'USCITO' che lo stato 'ARCHIVIATO'
        // 2. Filtriamo per mostrare solo i record degli ultimi 7 giorni (data_fine >= CURRENT_DATE - INTERVAL '7 days')
        // 3. Ordiniamo dinamicamente usando COALESCE per gestire i campi orario vuoti
        const r = await pool.query(`
            SELECT npass, orario_ingresso, orario_uscita, stato, data_inizio, data_fine
            FROM prenotazioni
            WHERE stato IN ('USCITO', 'ARCHIVIATO')
              AND data_fine >= CURRENT_DATE - INTERVAL '7 days'
            ORDER BY COALESCE(orario_uscita, orario_ingresso, data_fine::timestamp) DESC
            LIMIT 100
        `);
        res.json(r.rows);
    } catch (err) {
        console.error("💥 ERRORE STORICO:", err);
        res.status(500).json({ error: "Errore interno server dello storico" });
    }
});

// --- PIANTONE ARRIVI OGGI ---
app.get('/api/piantone/arrivi-oggi', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT ON (UPPER(p.npass))
        p.id,
        UPPER(p.npass) AS npass,
        r.ente,
        'PRENOTATO' AS stato,
        p.data_inizio,
        p.data_fine
      FROM prenotazioni p
      LEFT JOIN registro_pass r ON UPPER(p.npass) = UPPER(r.npass)
      WHERE p.data_inizio = CURRENT_DATE 
        AND p.stato = 'PRENOTATO'
      ORDER BY UPPER(p.npass), p.id DESC
    `);

    // Ordina i risultati (essendo tutti oggi l'ordinamento rimane coerente)
    const righeOrdinate = r.rows.sort((a, b) => new Date(a.data_inizio) - new Date(b.data_inizio));
    res.json(righeOrdinate);
  } catch (e) {
    console.error("Errore endpoint arrivi-oggi:", e);
    res.status(500).json({ error: 'Errore server' });
  }
});

app.post('/api/piantone/non-presente', async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query(`UPDATE prenotazioni SET stato = 'USCITO' WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// avvio immediato job scadenze
scadenzaPrenotazioni();
// ogni 5 minuti
setInterval(scadenzaPrenotazioni, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Server avviato`);
});
