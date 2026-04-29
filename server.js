const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); // Necessario per le API di Brevo
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connessione al Database (Supabase/PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * FUNZIONE PER INVIO MAIL TRAMITE API BREVO
 * Risolve i problemi di timeout e blocchi delle porte su Render
 */
async function inviaMailBrevoAPI(toEmail, subject, htmlContent, pdfBuffer = null, fileName = "") {
    try {
        const payload = {
            sender: { name: "Parcheggio C.L. Fontanarossa", email: "parkingclf.am@gmail.com" },
            to: [{ email: toEmail }],
            subject: subject,
            htmlContent: htmlContent
        };

        // Aggiunge l'allegato PDF se presente
        if (pdfBuffer) {
            payload.attachment = [{
                content: pdfBuffer.toString('base64'),
                name: fileName
            }];
        }

        await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
            headers: {
                'api-key': process.env.EMAIL_PASSWORD, // Qui deve esserci la CHIAVE API Th1zgx
                'Content-Type': 'application/json'
            }
        });
        console.log(`Email inviata con successo a: ${toEmail}`);
    } catch (error) {
        console.error("Errore invio mail API:", error.response ? error.response.data : error.message);
    }
}

// 1. LOGIN (Corretto: rimosse colonne inesistenti che causavano errori)
app.post('/api/valida-pass', async (req, res) => {
    try {
        const { npass } = req.body;
        if (!npass) return res.json({ valid: false });
        const cleanPass = npass.trim().toUpperCase();

        const result = await pool.query(
            'SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', 
            [cleanPass]
        );

        if (result.rows.length > 0) {
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) {
        console.error("Errore nel Login:", err.message);
        res.status(500).json({ error: "Errore interno del server" });
    }
});

// 2. PRENOTAZIONE CON INVIO PDF VIA API
app.post('/api/prenota', async (req, res) => {
    try {
        const { npass, giorni, email } = req.body;
        const p = npass.trim().toUpperCase();
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];

        // Salvataggio nel database
        await pool.query(
            'INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [p, dInizio, dFine, 'PRENOTATO']
        );

        // Creazione PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            
            // Invio Mail all'Utente
            await inviaMailBrevoAPI(
                email, 
                `Conferma Prenotazione e PASS - ${p}`, 
                `<h2>Prenotazione Confermata</h2><p>Il tuo PASS per il periodo ${dInizio} - ${dFine} è in allegato.</p>`,
                pdfData,
                `PASS_${p}.pdf`
            );

            // Invio Mail di notifica all'Admin
            await inviaMailBrevoAPI(
                "parkingclf.am@gmail.com",
                `🔔 Nuova Prenotazione: ${p}`,
                `<p>Il Pass <b>${p}</b> è stato prenotato da: ${email}</p><p>Periodo: ${dInizio} - ${dFine}</p>`
            );

            res.json({ success: true });
        });

        // Contenuto grafico del PDF
        doc.fontSize(25).text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown();
        doc.fontSize(70).text(p, { align: 'center', color: 'black' });
        doc.moveDown();
        doc.fontSize(20).text(`Valido dal: ${dInizio}`, { align: 'center' });
        doc.text(`Al: ${dFine}`, { align: 'center' });
        doc.end();

    } catch (err) {
        console.error("Errore prenotazione:", err.message);
        res.status(500).json({ error: "Impossibile salvare la prenotazione" });
    }
});

// 3. DISDETTA
app.post('/api/elimina-prenotazione', async (req, res) => {
    try {
        const { id, npass } = req.body;
        await pool.query('DELETE FROM prenotazioni WHERE id = $1', [id]);
        
        await inviaMailBrevoAPI(
            "parkingclf.am@gmail.com",
            `⚠️ DISDETTA PASS - ${npass.toUpperCase()}`,
            `<p>L'utente con Pass <b>${npass.toUpperCase()}</b> ha cancellato la sua prenotazione.</p>`
        );
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. ROTTE PER IL VARCO / PIANTONE
app.get('/api/mie-prenotazioni/:npass', async (req, res) => {
    const r = await pool.query(
        'SELECT id, data_inizio, data_fine, stato FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE', 
        [req.params.npass.toUpperCase()]
    );
    res.json(r.rows);
});

app.get('/api/piantone/cerca/:npass', async (req, res) => {
    const r = await pool.query(
        'SELECT * FROM prenotazioni WHERE UPPER(npass) = $1 AND data_fine >= CURRENT_DATE LIMIT 1', 
        [req.params.npass.toUpperCase()]
    );
    res.json(r.rows.length > 0 ? { trovato: true, prenotazione: r.rows[0] } : { trovato: false });
});

app.post('/api/piantone/azione', async (req, res) => {
    const { id, azione } = req.body;
    const nuovoStato = azione === 'E' ? 'INGRESSO' : 'USCITO';
    const colonnaOrario = azione === 'E' ? 'orario_ingresso' : 'orario_uscita';
    
    await pool.query(
        `UPDATE prenotazioni SET stato = $1, ${colonnaOrario} = NOW() WHERE id = $2`, 
        [nuovoStato, id]
    );
    res.json({ success: true });
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, orario_ingresso FROM prenotazioni WHERE stato = 'INGRESSO'");
    res.json(r.rows);
});

// Avvio Server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});
