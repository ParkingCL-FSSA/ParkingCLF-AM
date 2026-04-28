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

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: { user: 'parkingclf.am@gmail.com', pass: process.env.EMAIL_PASSWORD },
  connectionTimeout: 20000 
});

app.use(express.static(path.join(__dirname, 'public')));

// LOGIN - Aggiornato con 'ult_accesso'
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    if (!npass) return res.json({ valid: false });
    const cleanPass = npass.trim().toUpperCase();
    try {
        const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [cleanPass]);
        if (result.rows.length > 0) {
            await pool.query('UPDATE registro_pass SET ult_accesso = NOW() WHERE UPPER(npass) = $1', [cleanPass]);
            res.json({ valid: true, ruolo: result.rows[0].ruolo });
        } else {
            res.json({ valid: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PRENOTAZIONE - Con Informativa inclusa
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    try {
        const sorted = giorni.sort();
        const dInizio = sorted[0];
        const dFine = sorted[sorted.length - 1];
        const cleanPass = npass.toUpperCase();

        await pool.query('INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4)', 
            [cleanPass, dInizio, dFine, 'PRENOTATO']);
        
        // Aggiornamento 'ult_pren'
        await pool.query('UPDATE registro_pass SET ult_pren = NOW() WHERE UPPER(npass) = $1', [cleanPass]);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);

            const mailUtente = {
                from: '"Parcheggio C.L. Fontanarossa" <parkingclf.am@gmail.com>',
                to: email,
                subject: `Conferma e PASS - ${cleanPass}`,
                html: `
                    <div style="font-family:sans-serif; border:2px solid #3b82f6; border-radius:15px; padding:20px; max-width:600px;">
                        <h2 style="color:#3b82f6;">🅿️ Parcheggio C.L. Fontanarossa</h2>
                        <p>La tua prenotazione è confermata. Trovi il PASS in allegato.</p>
                        <p><b>Periodo:</b> dal ${new Date(dInizio).toLocaleDateString('it-IT')} al ${new Date(dFine).toLocaleDateString('it-IT')}</p>
                        <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
                        <p style="font-size:11px; color:#666;">
                            <b>Informativa:</b> I dati forniti (nPass ed eMail) sono trattati esclusivamente per fini organizzativi e tecnici della sosta. 
                            Il sistema non profila gli utenti e non cede dati a terzi.
                        </p>
                    </div>`,
                attachments: [{ filename: `PASS_${cleanPass}.pdf`, content: pdfData }]
            };

            try { await transporter.sendMail(mailUtente); } catch (e) { console.error("Errore Mail:", e.message); }
            res.json({ success: true });
        });

        // Grafica PASS con Informativa in calce
        doc.rect(20, 20, 555, 350).lineWidth(3).stroke('#3b82f6');
        doc.fontSize(22).fillColor('#3b82f6').text('PARCHEGGIO C.L. FONTANAROSSA', { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(70).fillColor('black').text(cleanPass, { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(18).text(`DAL ${new Date(dInizio).toLocaleDateString('it-IT')} AL ${new Date(dFine).toLocaleDateString('it-IT')}`, { align: 'center' });
        
        doc.fontSize(9).fillColor('#999').text(
            "Informativa: I dati forniti sono trattati solo per fini organizzativi. Il sistema non profila gli utenti e non cede dati a terzi.",
            20, 340, { align: 'center', width: 555 }
        );
        doc.end();

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rotte Piantone e Admin invariate (usano orario_ingresso e orario_uscita)
app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query(`SELECT npass, TO_CHAR(orario_ingresso, 'DD/MM/YY') as data_accesso, TO_CHAR(orario_ingresso, 'HH24:MI') as ora_ingresso, TO_CHAR(orario_uscita, 'DD/MM/YY - HH24:MI') as data_ora_uscita FROM prenotazioni WHERE stato IN ('INGRESSO', 'USCITO') ORDER BY orario_ingresso DESC LIMIT 15`);
    res.json(r.rows);
});

app.listen(process.env.PORT || 3000);