let userPass = ""; let selectedDays = []; 
let deferredPrompt; let currentPren = null;
let filtroPiantone = 'attivi'; 
// attivi = dentro (default)
// scaduti = solo scaduti
// tutti = tutto

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btnInstalla = document.getElementById('btnInstalla');
    if(btnInstalla) {
        btnInstalla.style.display = 'block'; // Mostra il tasto solo se installabile
        btnInstalla.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt = null;
                btnInstalla.style.display = 'none';
            }
        });
    }
});
document.getElementById('btnEsciApp').addEventListener('click', () => {
    // Chiude l'app se è aperta in modalità "standalone"
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        window.close();
    } else {
        // Se è aperta nel browser normale, window.close spesso è bloccato, 
        // quindi avvisiamo l'utente o puliamo la pagina
        alert("Per uscire chiudi la scheda del browser o l'app.");
    }
});
// FIX: helper che evita lo sfasamento UTC (new Date("YYYY-MM-DD") = mezzanotte UTC → giorno sbagliato in IT)
function fmtData(isoStr) {
    if (!isoStr) return '--';
    const p = isoStr.toString().split('T')[0].split('-');
    return `${p[2]}/${p[1]}/${p[0]}`;
}

function show(id) {
    document.querySelectorAll('.card > div').forEach(d => d.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function toggleScaduti() {
    if (filtroPiantone === 'attivi') {
        filtroPiantone = 'scaduti';
    } else if (filtroPiantone === 'scaduti') {
        filtroPiantone = 'tutti';
    } else {
        filtroPiantone = 'attivi';
    }
    const btn = document.getElementById('btn-filtro');
    if (filtroPiantone === 'attivi') {
        btn.innerText = "Mostra solo scaduti";
    } 
    else if (filtroPiantone === 'scaduti') {
        btn.innerText = "Mostra tutti";
    } 
    else {
        btn.innerText = "Mostra entrate";
    }
    aggiornaVeicoli();
}

async function doLogin() {
    userPass = document.getElementById('in-npass').value.trim().toUpperCase();
    if (!userPass) return;
    const res = await fetch('/api/valida-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ npass: userPass }) });
    const data = await res.json();
    if (data.valid) {
        if (data.ruolo === 'piantone') { 
            show('view-piantone'); 
            aggiornaVeicoli(); 
            aggiornaPostiLiberiPiantone();
            setInterval(aggiornaPostiLiberiPiantone, 10000); // ogni 10 sec
}
        else if (data.ruolo === 'admin') { show('view-admin'); mostraAdmin(); }
        else { show('view-user'); buildCal(); }
    } else alert("Accesso Negato");
}
// ✅ Nuova funzione per visualizzazione posti liberi totali al piantone
async function aggiornaPostiLiberiPiantone() {
    const res = await fetch('/api/piantone/liberi');
    const dati = await res.json();
    document.getElementById('total-free-display').innerHTML =
    `<b style="color:green">Liberi: ${dati.totaleLiberi}</b> 
     | <b>Dentro: ${dati.dentro}</b>`;
}
function buildCal() {
    const grid = document.getElementById('cal-grid'); grid.innerHTML = ""; selectedDays = [];
    let d = new Date();
    for (let i = 0; i < 45; i++) {
        const iso = d.toISOString().split('T')[0];
        const slot = document.createElement('div'); slot.className = "day-slot";
        slot.innerText = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
        slot.onclick = () => {
            slot.classList.toggle('selected');
            if (slot.classList.contains('selected')) selectedDays.push(iso);
            else selectedDays = selectedDays.filter(x => x !== iso);
        };
        grid.appendChild(slot); d.setDate(d.getDate() + 1);
    }
}
async function inviaPren() {
    const email = document.getElementById('u-email').value;
    if (!selectedDays.length || !email) return alert("Dati mancanti!");
    if (selectedDays.length > 15) return alert("Massimo 15 giorni selezionabili!");

    const res = await fetch('/api/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ npass: userPass, giorni: selectedDays, email: email }) });
    
    if (res.ok) {
        selectedDays.sort();
        document.getElementById('summary-details').innerHTML =
            `<b>Pass:</b> ${userPass}<br><b>Dal:</b> ${fmtData(selectedDays[0])}<br><b>Al:</b> ${fmtData(selectedDays[selectedDays.length - 1])}`;
        show('view-success');
    } else {
        // Gestisci errori di validazione dal server
        const err = await res.json();
        alert(err.error || "Errore durante la prenotazione.");
    }
}
// FIX: mostra storico (USCITO, SCADUTO) con stile diverso e senza cestino
async function mostraMie() {
    show('view-my-list');
    const res = await fetch(`/api/mie-prenotazioni/${userPass}`);
    const dati = await res.json();

    const statoColore = {
        'PRENOTATO': '#1e40af',
        'INGRESSO':  '#15803d',
        'USCITO':    '#b45309',
        'SCADUTO':   '#94a3b8'
    };
    const statoEmoji = {
        'PRENOTATO': '📅',
        'INGRESSO':  '🚗',
        'USCITO':    '✅',
        'SCADUTO':   '⏰'
    };

    const cancellabile = (stato) => stato === 'PRENOTATO' || stato === 'SCADUTO';

    document.getElementById('my-list-content').innerHTML = dati.map(p => {
        const colore = statoColore[p.stato] || '#64748b';
        const emoji  = statoEmoji[p.stato]  || '📅';
        const isStorico = p.stato === 'USCITO' || p.stato === 'SCADUTO';
        const cestino = cancellabile(p.stato)
            ? `<div style="color:red; cursor:pointer; font-size:20px;" onclick="eliminaPren(${p.id})">🗑️</div>`
            : `<div style="font-size:18px; color:#cbd5e1;" title="Non cancellabile">🔒</div>`;

        return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px;
            background:${isStorico ? '#f8fafc' : 'white'};
            border-radius:12px; margin-bottom:8px;
            border:1px solid ${isStorico ? '#e2e8f0' : '#bfdbfe'};
            opacity:${isStorico ? '0.75' : '1'};">
            <div>
                <div style="font-size:13px;">${emoji} Dal ${fmtData(p.data_inizio)} al ${fmtData(p.data_fine)}</div>
                <div style="font-weight:bold; font-size:12px; margin-top:4px; color:${colore};">
                    Stato: ${p.stato}
                </div>
            </div>
            ${cestino}
        </div>`;
    }).join('') || "<p style='color:#64748b; text-align:center;'>Nessuna prenotazione.</p>";
}

async function eliminaPren(id) {
    if (!confirm("Eliminare questa prenotazione?")) return;
    const res = await fetch('/api/elimina-prenotazione', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, npass: userPass }) });
    if (res.ok) {
        mostraMie();
    } else {
        const err = await res.json();
        alert(err.error || "Errore durante la cancellazione.");
    }
}

async function cercaPass() {
    const p = document.getElementById('search-p').value.trim().toUpperCase();
    if (!p) return;

    const res = await fetch(`/api/piantone/cerca/${p}?auth=${userPass}`);
    const data = await res.json();

    if (data.trovato) {
        currentPren = data.prenotazione;

        const btnEntrata = document.querySelector('.btn-green');
        const btnUscita = document.querySelector('.btn-orange');

        // RESET
        btnEntrata.disabled = false;
        btnUscita.disabled = false;

        // LOGICA STATI
        if (currentPren.stato === 'PRENOTATO') {
            btnEntrata.disabled = false;
            btnUscita.disabled = true;
        }

        if (currentPren.stato === 'INGRESSO') {
            btnEntrata.disabled = true;
            btnUscita.disabled = false;
        }
        // 🎨 COLORI DINAMICI BOTTONI
        const oggi = new Date().toISOString().split('T')[0];
        const scaduto = currentPren.stato === 'INGRESSO' && oggi > currentPren.data_fine;
        
        if (scaduto) {
            btnEntrata.style.background = '#9ca3af'; // grigio
            btnUscita.style.background = '#ef4444'; // rosso alert
            btnUscita.innerText = 'USCITA (SCADUTO)';
        } else {
            // reset colori originali
            btnEntrata.style.background = '';
            btnUscita.style.background = '';
            btnUscita.innerText = 'USCITA';
        }
        // ⚠️ SCADUTO MA DENTRO → USCITA SEMPRE POSSIBILE
        if (currentPren.stato === 'INGRESSO' && oggi > currentPren.data_fine) {
            btnUscita.disabled = false;
        }

        // UI
        document.getElementById('panel-piantone').classList.remove('hidden');
        document.getElementById('lab-pass').innerHTML = `PASS: ${currentPren.npass}`;
        document.getElementById('lab-periodo').innerHTML =
            `(Periodo: ${fmtData(currentPren.data_inizio)} - ${fmtData(currentPren.data_fine)})`;

        document.getElementById('reg-e').innerHTML = currentPren.orario_ingresso
            ? `Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}` : "";

        document.getElementById('reg-u').innerHTML = currentPren.orario_uscita
            ? `Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}` : "";

    } else {
        alert("Nessuna prenotazione trovata per questo PASS.");
        document.getElementById('panel-piantone').classList.add('hidden');
    }
}

// FIX: tabella a 4 colonne (PASS | Data Accesso | Ora Ingresso | Data e Ora Uscita)
// con gestione null su orario_ingresso e orario_uscita

async function aggiornaVeicoli() {
    const res = await fetch(`/api/veicoli-dentro?npass=${userPass}`);
    const dati = await res.json();
    const oggi = new Date().toISOString().split('T')[0];

    let countDentro = 0;
    let countScaduti = 0;

    dati.forEach(x => {
        const dentro = x.stato === 'INGRESSO';
        const scaduto = dentro && oggi > x.data_fine;

        if (dentro) countDentro++;
        if (scaduto) countScaduti++;
    });

    // 🎯 LABEL DINAMICA
    let label = "";
    if (filtroPiantone === 'attivi') label = "Dentro";
    else if (filtroPiantone === 'scaduti') label = "Scaduti";
    else label = "Totale";

    const badge = document.getElementById('badge-contatori');

    badge.innerHTML = `
        🚗 <b>${label}:</b> ${
            filtroPiantone === 'attivi' ? countDentro :
            filtroPiantone === 'scaduti' ? countScaduti :
            dati.length
        }
        &nbsp;&nbsp;|&nbsp;&nbsp;
        ⚠️ <b id="badge-scaduti" style="color:${countScaduti > 0 ? 'red' : 'black'}">
            Scaduti: ${countScaduti}
        </b>
    `;

    // 🔥 LAMPEGGIANTE (solo se ci sono scaduti)
    if (countScaduti > 0) {
        const el = document.getElementById('badge-scaduti');
        el.style.animation = 'blink 1s infinite';
    }

    // 🔥 FILTRO + ORDINAMENTO
    const lista = dati
        .filter(x => {
            const scaduto = x.stato === 'INGRESSO' && oggi > x.data_fine;
            const dentro = x.stato === 'INGRESSO';

            if (filtroPiantone === 'attivi') return dentro;
            if (filtroPiantone === 'scaduti') return scaduto;
            return true;
        })
        .sort((a, b) => {
            const scadA = a.stato === 'INGRESSO' && oggi > a.data_fine;
            const scadB = b.stato === 'INGRESSO' && oggi > b.data_fine;

            return scadB - scadA; // 🔴 scaduti sopra
        });

    // 🧾 RENDER
    document.getElementById('lista-veicoli').innerHTML = lista.map(x => {
        const ing = x.orario_ingresso ? new Date(x.orario_ingresso) : null;
        const usc = x.orario_uscita ? new Date(x.orario_uscita) : null;

        const dataIng = ing ? ing.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '--';
        const oraIng  = ing ? ing.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
        const dataUsc = usc ? usc.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
        const oraUsc  = usc ? usc.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';

        const scaduto = x.stato === 'INGRESSO' && oggi > x.data_fine;

        return `<tr style="${scaduto ? 'background:#fee2e2; color:#991b1b;' : ''}">
            <td style="font-weight:bold;">${x.npass}</td>
            <td>${dataIng}</td>
            <td style="font-weight:bold;">${oraIng}</td>
            <td>${scaduto ? 'SCADUTA' : dataUsc}</td>
            <td style="font-weight:bold;">${scaduto ? '' : oraUsc}</td>
        </tr>`;
    }).join('') || "<tr><td colspan='5' style='text-align:center; color:black; padding:16px;'>Nessun veicolo presente</td></tr>";
}
    async function mossa(tipo) {
    let azione = tipo;

    if (tipo === 'E') azione = 'ingresso';
    if (tipo === 'U') azione = 'uscita';

    await fetch('/api/piantone/azione', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: currentPren.id,
            azione: azione,
            npass: userPass
        })
    });
    cercaPass();
    aggiornaVeicoli();
}
async function mostraRitardi() {
    const res = await fetch('/api/admin/ritardi');
    const dati = await res.json();

    alert(
        dati.map(x =>
            `${x.npass} → ritardo ${x.giorni_ritardo} giorni`
        ).join('\n') || "Nessun ritardo"
    );
}
// ✅ Cruscotto admin con dettaglio ENTI e Colori Critici
async function mostraAdmin() {
    const res = await fetch(`/api/admin/cruscotto?npass=${userPass}`);
    const dati = await res.json();
    if (!dati?.length) return;

    const enti = Object.keys(dati[0].enti || {}).sort();
    let header = `<tr><th>Data</th><th style="color:var(--blue);">TOT LIBERI</th>`;
    enti.forEach(e => header += `<th>${e}</th>`);
    header += `</tr>`;

    const rows = dati.map(x => {
        let row = `<tr><td>${fmtData(x.data)}</td><td style="font-weight:bold; color:var(--green);">${x.totaleLiberi}/120</td>`;
        enti.forEach(ente => {
            const info = x.enti[ente] || { liberi: 0, totale: 0 };
            // Rosso se 0, Arancione se < 4
            const col = info.liberi === 0 ? 'var(--red)' : info.liberi < 4 ? 'var(--orange)' : 'var(--gray)';
            row += `<td style="color:${col}; font-weight:bold;">${info.liberi}/${info.totale}</td>`;
        });
        return row + `</tr>`;
    }).join('');

    document.getElementById('tab-admin').innerHTML = header + rows;
}
