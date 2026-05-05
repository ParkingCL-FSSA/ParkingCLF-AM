const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function verificaRuolo(npass, ruoloRichiesto) {
    const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.toUpperCase()]);
    if (result.rows.length === 0) return false;
    const ruoli = Array.isArray(ruoloRichiesto) ? ruoloRichiesto : [ruoloRichiesto];
    return ruoli.includes(result.rows[0].ruolo);
}

app.post('/api/valida-pass', async (req, res) => {
    const { npass } = req.body;
    const result = await pool.query('SELECT ruolo FROM registro_pass WHERE UPPER(npass) = $1', [npass.toUpperCase()]);
    res.json({ valid: result.rows.length > 0, ruolo: result.rows[0]?.ruolo });
});

app.post('/api/prenota', async (req, res) => {
    const { npass, giorni, email } = req.body;
    const p = npass.toUpperCase();
    const sorted = giorni.sort();
    
    // Check 15gg
    const resCount = await pool.query("SELECT COUNT(*) FROM prenotazioni WHERE UPPER(npass) = $1 AND stato != 'SCADUTO'", [p]);
    if (parseInt(resCount.rows[0].count) + giorni.length > 15) return res.status(400).json({ error: "Limite 15gg superato" });

    // Check Quote Ente[cite: 12]
    const userInfo = await pool.query("SELECT ente, a.posti FROM registro_pass r JOIN assegnazioni a ON r.ente = a.ente WHERE UPPER(npass) = $1", [p]);
    const { ente, posti } = userInfo.rows[0];

    for (const g of sorted) {
        const occ = await pool.query("SELECT COUNT(*) FROM prenotazioni p JOIN registro_pass r ON p.npass = r.npass WHERE r.ente = $1 AND $2 BETWEEN data_inizio AND data_fine", [ente, g]);
        if (parseInt(occ.rows[0].count) >= posti) return res.status(400).json({ error: "Posti esauriti per il tuo ente" });
    }

    await pool.query("INSERT INTO prenotazioni (npass, data_inizio, data_fine, stato, email) VALUES ($1, $2, $3, 'PRENOTATO', $4)", [p, sorted[0], sorted[sorted.length-1], email]);
    res.json({ success: true });
});

// CRUSCOTTO: Ora accessibile anche al piantone per il contatore[cite: 12]
app.get('/api/admin/cruscotto', async (req, res) => {
    const npass = req.query.npass;
    if (!await verificaRuolo(npass, ['admin', 'piantone'])) return res.status(403).json({ error: "No auth" });

    const enti = await pool.query('SELECT ente, posti FROM assegnazioni');
    const risultati = [];
    const oggi = new Date();
    for (let i = 0; i < 45; i++) {
        const d = new Date(oggi); d.setDate(oggi.getDate() + i);
        const giorno = d.toISOString().split('T')[0];
        const row = { data: giorno, enti: {}, totaleOccupati: 0 };
        for (const e of enti.rows) {
            const occ = await pool.query("SELECT COUNT(*) FROM prenotazioni p JOIN registro_pass r ON p.npass = r.npass WHERE r.ente = $1 AND $2 BETWEEN data_inizio AND data_fine", [e.ente, giorno]);
            const count = parseInt(occ.rows[0].count);
            row.enti[e.ente] = { liberi: e.posti - count, totale: e.posti };
            row.totaleOccupati += count;
        }
        row.totaleLiberi = 120 - row.totaleOccupati;
        risultati.push(row);
    }
    res.json(risultati);
});

app.get('/api/veicoli-dentro', async (req, res) => {
    const r = await pool.query("SELECT npass, stato FROM prenotazioni WHERE stato IN ('INGRESSO', 'USCITO') LIMIT 10");
    res.json(r.rows);
});

app.listen(process.env.PORT || 3000);