const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CONFIGURAZIONE SMTP ROBUSTA (Per evitare Timeout)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, 
  auth: {
    user: 'parkingclf.am@gmail.com',
    pass: process.env.EMAIL_PASSWORD // Assicurati sia la nuova Password per le App
  },
  pool: true, 
  connectionTimeout: 20000, 
  greetingTimeout: 20000,
  socketTimeout: 30000
});

app.use(express.static(path.join(__dirname, 'public')));

// LOGIN
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    try {
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ultimo_accesso = NOW() WHERE UPPER(npass) = $1', [npass.trim().toUpperCase()]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PRENOTAZIONE + DOPPIA EMAIL (Utente e Admin separati)
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (giorni.length > 15) return res.status(400).json({ error: "Limite 15 giorni superato" });

    try {
        const sorted = giorni.sort();
        const dataInizio = sorted[0];
        const dataFine = sorted[sorted.length - 1];

        const insert = await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4) RETURNING id', 
            [npass.toUpperCase(), dataInizio, dataFine, 'PRENOTATO']);
        
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [npass.toUpperCase()]);

        // Generazione PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // 1. EMAIL PER L'UTENTE (Con Allegato e Privacy)
            const mailUtente = {
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma e PASS - ${npass.toUpperCase()}`,
                html: `
                    <div style="font-family:sans-serif; border:2px solid #3b82f6; border-radius:15px; padding:20px; max-width:600px;">
                        <h2 style="color:#3b82f6;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                        <p>Prenotazione confermata. In allegato il PASS da esporre.</p>
                        <p>Periodo: dal ${new Date(dataInizio).toLocaleDateString('it-IT')} al ${new Date(dataFine).toLocaleDateString('it-IT')}</p>
                        <div style="margin-top:30px; border-top:1px solid #eee; font-size:10px; color:#999;">
                            <p><i>Informativa: I dati sono trattati solo per la gestione tecnica della sosta aziendale.</i></p>
                        </div>
                    </div>`,
                attachments: [{ filename: `PASS_${npass.toUpperCase()}.pdf`, content: pdfData }]
            };

            // 2. NOTIFICA PER TE (Leggera, senza allegato)
            const mailAdmin = {
                from: '"Sistema Parcheggio" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `🔔 Nuova Prenotazione - ${npass.toUpperCase()}`,
                html: `<p><b>Pass:</b> ${npass.toUpperCase()}<br><b>Periodo:</b> ${new Date(dataInizio).toLocaleDateString('it-IT')} - ${new Date(dataFine).toLocaleDateString('it-IT')}<br><b>Email:</b> ${email}</p>`
            };

            try {
                await transporter.sendMail(mailUtente);
                await transporter.sendMail(mailAdmin);
            } catch (e) { console.error("Errore SMTP:", e.message); }

            res.json({ success: true });
        });

        // Contenuto Grafico PDF
        doc.rect(20, 20, 555, 300).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(25).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown();
        doc.fontSize(60).fillColor('black').text(npass.toUpperCase(), { align: 'center' });
        doc.moveDown();
        doc.fontSize(20).text(`DAL ${new Date(dataInizio).toLocaleDateString('it-IT')} AL ${new Date(dataFine).toLocaleDateString('it-IT')}`, { align: 'center' });
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DISDETTA CON NOTIFICA
app.post('/api/elimina-prenotazione', async (req, res) => {
    const { id, npass } = req.body;
    try {
        const info = await pool.query('SELECT data_inizio, data_fine FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);
        
        if (info.rows.length > 0) {
            const { data_inizio, data_fine } = info.rows[0];
            await pool.query('DELETE FROM prenotazioni WHERE id = $1 AND UPPER(npass) = $2', [id, npass.toUpperCase()]);

            await transporter.sendMail({
                from: '"Sistema Parcheggio" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `⚠️ DISDETTA - ${npass.toUpperCase()}`,
                html: `<p>Prenotazione cancellata per il Pass <b>${npass.toUpperCase()}</b>.<br>Periodo rimosso: ${new Date(data_inizio).toLocaleDateString('it-IT')} - ${new Date(data_fine).toLocaleDateString('it-IT')}</p>`
            });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GESTIONE VARCO E ADMIN (Invariate)
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
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    const stato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [stato, id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO'");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [cleanPass]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else res.json({ valid: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. PRENOTAZIONE (Logica Utente + Admin) ---
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    if (!giorni || giorni.length === 0) return res.status(400).json({ error: "Date non selezionate" });

    try {
        const cleanPass = npass.toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // CONTROLLO ACCAVALLAMENTO (Punto Critico)
        const check = await pool.query(
            "SELECT id FROM prenotazioni WHERE UPPER(npass) = $1 AND stato != 'USCITO' AND (data_inizio, data_fine) OVERLAPS ($2::DATE, $3::DATE)",
            [cleanPass, dInizio, dFine]
        );

        if (check.rows.length > 0) {
            return res.status(400).json({ error: "ERRORE: Date già occupate per questo PASS!" });
        }

        // SALVATAGGIO
        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        // RISPOSTA IMMEDIATA (Sito veloce)
        res.json({ success: true });

        // GESTIONE EMAIL (Senza attendere risposta)
        gestioneEmailBackground(cleanPass, dInizio, dFine, email);

    } catch (err) {
        console.error("Errore DB:", err.message);
        res.status(500).json({ error: "Errore interno" });
    }
});

async function gestioneEmailBackground(npass, inizio, fine, emailUtente) {
    try {
        const doc = new PDFDocument({ size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            // 1. MAIL PER L'UTENTE (Con PASS)
            const mailUtente = {
                from: '"Parking CLF" <parkingclf.am@gmail.com>',
                to: emailUtente,
                subject: `Conferma PASS ${npass}`,
                html: `<p>Prenotazione confermata per il PASS <b>${npass}</b>.</p><p>Valido dal ${inizio} al ${fine}.</p>`,
                attachments: [{ filename: `PASS_${npass}.pdf`, content: pdfData }]
            };

            // 2. MAIL PER L'AMMINISTRATORE (Notifica)
            const mailAdmin = {
                from: '"Sistema Parking" <parkingclf.am@gmail.com>',
                to: 'parkingclf.am@gmail.com',
                subject: `NUOVA PRENOTAZIONE: ${npass}`,
                text: `L'utente con PASS ${npass} ha prenotato dal ${inizio} al ${fine}. Email utente: ${emailUtente}`
            };

            // Invio protetto da timeout
            try { await transporter.sendMail(mailUtente); } catch (e) { console.log("Timeout Mail Utente ignorato."); }
            try { await transporter.sendMail(mailAdmin); } catch (e) { console.log("Timeout Mail Admin ignorato."); }
        });

        // Contenuto PDF
        doc.fontSize(20).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown().fontSize(50).text(npass, { align: 'center' });
        doc.fontSize(12).text(`Valido: ${inizio} / ${fine}`, { align: 'center' });
        doc.fontSize(8).text('Dati trattati solo per fini organizzativi.', 20, 350, { align: 'center' });
        doc.end();

    } catch (err) { console.error("Errore Background Process."); }
}

// --- 3. ALTRE ROTTE (Mie Prenotazioni, Piantone, Veicoli) ---
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query('SELECT id, data_inizio, data_fine FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC', [req.params.npass.toUpperCase()]);
    res.json(r.rows);
});

app.post('/api/elimina-prenotazione', async (req, res) => {
    await pool.query('DELETE FROM prenotazioni WHERE id = $1', [req.body.id]);
    res.json({ success: true });
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const r = await pool.query('SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE ORDER BY data_inizio ASC LIMIT 1', [req.params.npass.toUpperCase()]);
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const colonna = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    await pool.query(`UPDATE prenotazioni SET stato = $1, ${colonna} = NOW() WHERE id = $2`, [azione === 'E' ? 'INGRESSO' : 'USCITO', id]);
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, TO_CHAR(orario_ingresso, 'DD/MM HH24:MI') as data_accesso FROM prenotazioni WHERE stato = 'INGRESSO' ORDER BY orario_ingresso DESC");
    res.json(r.rows);
});

app.listen(process.env.PORT || 10000);
