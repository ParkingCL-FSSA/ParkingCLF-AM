const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// JOB SCADENZA: Libera i posti se la data inizio è passata e non sono entrati
async function scadenzaPrenotazioni() {
    try {
        await pool.query("UPDATE prenotazioni SET stato = 'SCADUTO' WHERE stato = 'PRENOTATO' AND data_inizio < CURRENT_DATE");
    } catch (err) { console.error('Errore scadenza:', err.message); }
}
setInterval(scadenzaPrenotazioni, 1000 * 60 * 60);

// API LOGIN E VALIDAZIONE
app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    const result = await pool.query("SELECT * FROM registro_pass WHERE UPPER(npass) = $1", [npass.toUpperCase()]);
    if (result.rows.length > 0) {
        res.json({ valid: true, ruolo: result.rows[0].ruolo, ente: result.rows[0].ente });
    } else {
        res.json({ valid: false });
    }
});

// API PRENOTA CON CONTROLLO QUOTE ENTE E LIMITE 15GG
app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    const p = npass.toUpperCase();
    const sorted = giorni.sort();
    const dataInizio = sorted[0];
    const dataFine = sorted[sorted.length - 1];

    try {
        // 1. Info Ente e Posti Assegnati
        const resEnte = await pool.query(
            "SELECT r.ente, a.posti FROM registro_pass r JOIN assegnazioni a ON r.ente = a.ente WHERE UPPER(r.npass) = $1", [p]
        );
        if (resEnte.rows.length === 0) return res.status(400).json({ error: "Ente non configurato" });
        const { ente, posti } = resEnte.rows[0];

        // 2. Controllo Limite 15gg in finestra di 30gg
        const resCount = await pool.query(
            `SELECT COUNT(*) as totale FROM (
                SELECT generate_series(data_inizio::date, data_fine::date, '1 day'::interval) as g 
                FROM prenotazioni WHERE UPPER(npass) = $1 AND stato != 'SCADUTO'
            ) t WHERE g >= $2::date AND g <= ($2::date + interval '29 days')`, [p, dataInizio]
        );
        if (parseInt(resCount.rows[0].totale) + giorni.length > 15) {
            return res.status(400).json({ error: "Hai superato il limite di 15gg mensili." });
        }

        // 3. Controllo disponibilità per ENTE giorno per giorno
        for (let g of giorni) {
            const resOcc = await pool.query(
                `SELECT COUNT(*) FROM prenotazioni p JOIN registro_pass r ON p.npass = r.npass 
                 WHERE r.ente = $1 AND p.stato != 'SCADUTO' AND $2 BETWEEN p.data_inizio AND p.data_fine`, [ente, g]
            );
            if (parseInt(resOcc.rows[0].count) >= posti) {
                return res.status(400).json({ error: "Posti esauriti per il tuo ente nelle date scelte." });
            }
        }

        await pool.query("INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato, email) VALUES ($1, $2, $3, 'PRENOTATO', $4)", [p, dataInizio, dataFine, email]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CRUSCOTTO ADMIN
app.get('/api/admin/cruscotto', async (req, res) => {
    try {
        const enti = await pool.query("SELECT * FROM assegnazioni");
        const giorni = [];
        const oggi = new Date();
        for(let i=0; i<14; i++) {
            const d = new Date(oggi); d.setDate(oggi.getDate()+i);
            giorni.push(d.toISOString().split('T')[0]);
        }

        const report = [];
        for(let g of giorni) {
            let r = { data: g, enti: {}, totaleLiberi: 120 };
            let occTot = 0;
            for(let e of enti.rows) {
                const occ = await pool.query(
                    `SELECT COUNT(*) FROM prenotazioni p JOIN registro_pass r ON p.npass = r.npass 
                     WHERE r.ente = $1 AND p.stato != 'SCADUTO' AND $2 BETWEEN p.data_inizio AND p.data_fine`, [e.ente, g]
                );
                const count = parseInt(occ.rows[0].count);
                r.enti[e.ente] = { liberi: e.posti - count, totale: e.posti };
                occTot += count;
            }
            r.totaleLiberi = 120 - occTot;
            report.push(r);
        }
        res.json(report);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000);
