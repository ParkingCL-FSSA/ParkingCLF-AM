let userPass = ""; let selectedDays = []; 
let deferredPrompt; let currentPren = null;
let filtroPiantone = 'attivi'; let totaleScaduti = 0;
let ultimoAggiornato = null;let totaleVerificare = 0;
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
// Quando la pagina si carica...
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Se l'utente è arrivato tramite il QR code con mode=install
    if (urlParams.get('mode') === 'install') {
        // Aspettiamo un secondo e poi mostriamo un avviso o evidenziamo il tasto installa
        setTimeout(() => {
            const btn = document.getElementById('btnInstalla');
            if (btn) {
                btn.style.border = "4px solid #3b82f6"; // Lo rendiamo più visibile
                alert("Benvenuto! Clicca sul tasto bianco e blu 'INSTALLA APP' per averla sempre sul telefono.");
            }
        }, 1500);
    }
};

const btnEsci = document.getElementById('btnEsciApp');
const beepIngresso = new Audio('/beep_i.mp3');
const beepUscita = new Audio('/beep_u.mp3');

if (btnEsci) {
    btnEsci.addEventListener('click', () => {

        if (
            window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true
        ) {
            window.close();
        } else {
            alert("Per uscire chiudi la scheda del browser o l'app.");
        }

    });
}

// FIX: helper che evita lo sfasamento UTC (new Date("YYYY-MM-DD") = mezzanotte UTC → giorno sbagliato in IT)
function fmtData(isoStr) {
    if (!isoStr) return '--';
    const p = isoStr.toString().split('T')[0].split('-');
    return `${p[2]}/${p[1]}/${p[0]}`;
}
function resetSelezione() {

    selectedDays = [];

    document
        .querySelectorAll('.day-slot.selected')
        .forEach(el => el.classList.remove('selected'));
}
function show(id) {

    document
        .querySelectorAll('[id^="view-"]')
        .forEach(d => d.classList.add('hidden'));

    const el = document.getElementById(id);

    if (el) {
        el.classList.remove('hidden');
    }
}

function toggleScaduti() {

    // ATTIVI
    if (filtroPiantone === 'attivi') {

        if (totaleScaduti > 0) {

            filtroPiantone = 'scaduti';

        } 
        else if (totaleVerificare > 0) {

            filtroPiantone = 'verificare';

        } 
        else {

            filtroPiantone = 'tutti';
        }
    }

    // SCADUTI
    else if (filtroPiantone === 'scaduti') {

        if (totaleVerificare > 0) {

            filtroPiantone = 'verificare';

        } 
        else {

            filtroPiantone = 'tutti';
        }
    }

    // DA VERIFICARE
    else if (filtroPiantone === 'verificare') {

        filtroPiantone = 'tutti';
    }

    // TUTTI
    else if (filtroPiantone === 'tutti') {

        filtroPiantone = 'storico';
    }

    // STORICO
    else {

        filtroPiantone = 'attivi';
    }

    const btn = document.getElementById('btn-filtro');

    // ===== TESTO PULSANTE =====

    if (filtroPiantone === 'attivi') {

        if (totaleScaduti > 0) {

            btn.innerText = "Mostra scaduti";

        } 
        else if (totaleVerificare > 0) {

            btn.innerText = "Mostra verificare";

        } 
        else {

            btn.innerText = "Mostra tutti";
        }
    }

    else if (filtroPiantone === 'scaduti') {

        if (totaleVerificare > 0) {

            btn.innerText = "Mostra verificare";

        } 
        else {

            btn.innerText = "Mostra tutti";
        }
    }

    else if (filtroPiantone === 'verificare') {

        btn.innerText = "Mostra tutti";
    }

    else if (filtroPiantone === 'tutti') {

        btn.innerText = "Mostra storico";
    }

    else {

        btn.innerText = "Mostra attivi";
    }

    // ===== LABEL STATO =====

    const statoTabella = document.getElementById('stato-tabella');

    if (statoTabella) {

        // ATTIVI
        if (filtroPiantone === 'attivi') {

            statoTabella.innerHTML = "📋 ATTIVI";
            statoTabella.style.color = "#2563eb";
            statoTabella.style.background = "#dbeafe";
            statoTabella.style.borderColor = "#2563eb";
        }

        // SCADUTI
        else if (filtroPiantone === 'scaduti') {

            statoTabella.innerHTML = "⏰ SCADUTI";
            statoTabella.style.color = "#dc2626";
            statoTabella.style.background = "#fee2e2";
            statoTabella.style.borderColor = "#dc2626";
        }

        // DA VERIFICARE
        else if (filtroPiantone === 'verificare') {

            statoTabella.innerHTML = "🚨 DA VERIFICARE";
            statoTabella.style.color = "#ea580c";
            statoTabella.style.background = "#ffedd5";
            statoTabella.style.borderColor = "#ea580c";
        }

        // TUTTI
        else if (filtroPiantone === 'tutti') {

            statoTabella.innerHTML = "📑 TUTTI";
            statoTabella.style.color = "#7c3aed";
            statoTabella.style.background = "#ede9fe";
            statoTabella.style.borderColor = "#7c3aed";
        }

        // STORICO
        else {

            statoTabella.innerHTML = "🕘 STORICO";
            statoTabella.style.color = "#475569";
            statoTabella.style.background = "#e2e8f0";
            statoTabella.style.borderColor = "#475569";
        }
    }

    aggiornaVeicoli();
}

async function doLogin() {
    const card = document.querySelector('.card');
        if (card) {
            card.classList.remove('admin-wide');
        }
    try {
            userPass = document
                .getElementById('in-npass')
                .value
                .trim()
                .toUpperCase();
    
            if (!userPass) return;
    
            const res = await fetch('/api/valida-pass', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    npass: userPass
                })
            });
    
            const data = await res.json();
    
           // console.log("LOGIN:", data);
    
            if (!data.valid) {
                alert("Accesso Negato");
                return;
            }
    
            if (data.ruolo === 'piantone') {
    
                show('view-piantone');
    
                try { aggiornaVeicoli(); } catch(e){ console.log(e); }
                try { aggiornaPostiLiberiPiantone(); } catch(e){ console.log(e); }
               // try { caricaStorico(); } catch(e){ console.log(e); }
    
            }
            else if (data.ruolo === 'admin') { 
                if (card) {
                    card.classList.add('admin-wide');
                }
                show('view-admin'); 
                try { mostraAdmin(); } catch(e){ console.log(e); }
            }

        else {

            show('view-user');

            try { buildCal(); } catch(e){ console.log(e); }

        }

    } catch (err) {

        console.error("ERRORE LOGIN:", err);
        alert("Errore login");

    }
}
// ✅ Nuova funzione per visualizzazione posti liberi totali al piantone
async function aggiornaPostiLiberiPiantone() {
    const res = await fetch(`/api/piantone/liberi?npass=${userPass}`);
    const dati = await res.json();
    document.getElementById('total-free-display').innerHTML =
    `<b style="color:green">Liberi: ${dati.totaleLiberi}</b> 
     | <b>Dentro: ${dati.dentro}</b>`;
}

function buildCal() {
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = "";
    selectedDays = [];
    let d = new Date();
    for (let i = 0; i < 45; i++) {
        const iso = d.toISOString().split('T')[0];
        const slot = document.createElement('div');
        slot.className = "day-slot";
        slot.innerText = d.toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit'
        });
        slot.addEventListener('click', () => {
            slot.classList.toggle('selected');
            if (slot.classList.contains('selected')) {
                if (!selectedDays.includes(iso)) {
                    selectedDays.push(iso);
                }
            } else {
                selectedDays =
                    selectedDays.filter(x => x !== iso);
            }
        });
        grid.appendChild(slot);
        d.setDate(d.getDate() + 1);
    }
}

let loadingPrenotazione = false;

async function inviaPren() {
     if (loadingPrenotazione) return;

    loadingPrenotazione = true;

    const btn = document.getElementById('btn-prenota');
    btn.disabled = true;

    try {
    const email = document.getElementById('u-email').value.trim().toLowerCase();
    // 🚫 blocco mail difesa
    if (email.includes('@') && email.endsWith('.difesa.it')) {
        alert('Inserisci la tua mail privata!');
        return;
    }
    if (!email) { return alert("Inserisci la tua email!"); }
    if (selectedDays.length === 0) { return alert("Seleziona almeno 2 giorni"); }
    if (selectedDays.length === 1) { return alert("Per il parcheggio【Lunga Sosta】il minimo di giorni prenotabili sono 2"); }
    if (selectedDays.length > 15) { 
        resetSelezione();
        return alert("Massimo 15 giorni selezionabili!"); 
    }

   const res = await fetch('/api/prenota', {

    method: 'POST',

    headers: {
        'Content-Type': 'application/json'
    },

    body: JSON.stringify({
        npass: userPass,
        giorni: selectedDays,
        email: email
    })

});
    if (res.ok) {
        selectedDays.sort();
        //const totaleGiorni = selectedDays.length;
        document.getElementById('summary-details').innerHTML =
            `<b>Pass:</b> ${userPass}<br><b>Dal:</b> ${fmtData(selectedDays[0])}<br><b>Al:</b> ${fmtData(selectedDays[selectedDays.length - 1])}`;
        show('view-success');
         setTimeout(() => {
         mostraMie();
         }, 10000);
    } else {
        // Gestisci errori di validazione dal server
        const err = await res.json();
        resetSelezione();
        alert(err.error || "Errore durante la prenotazione.");
    }
} finally {

        loadingPrenotazione = false;
        btn.disabled = false;
    }
}

async function mostraMie() {

    show('view-my-list');

    const res = await fetch(`/api/mie-prenotazioni/${userPass}`);
    const dati = await res.json();

    const statoColore = {
        'PRENOTATO': '#1e40af',
        'ENTRATO': '#15803d',
        'USCITO': '#b45309',
        'SCADUTO': '#ef4444'
    };

    const statoEmoji = {
        'PRENOTATO': '📅',
        'ENTRATO': '🚗',
        'USCITO': '✅',
        'SCADUTO': '⏰'
    };

    const cancellabile = (p) => {
        return p.stato === 'PRENOTATO' && !p.orario_ingresso;
    };

    document.getElementById('my-list-content').innerHTML = dati.map(p => {

        const colore = statoColore[p.stato] || '#64748b';
        const emoji = statoEmoji[p.stato] || '📅';

        const isStorico =
            p.stato === 'USCITO' ||
            p.stato === 'SCADUTO';

        const cestino = cancellabile(p)
            ? `
                <div
                    class="btn-delete"
                    data-id="${p.id}"
                    style="
                        color:red;
                        cursor:pointer;
                        font-size:20px;
                        transition:0.2s;
                    ">
                    🗑️
                </div>
              `
            : `
                <div
                    style="font-size:18px; color:#cbd5e1;"
                    title="Prenotazione non eliminabile">
                    🔒
                </div>
              `;

        const giorni =
            Math.ceil(
                (new Date(p.data_fine) - new Date(p.data_inizio))
                / (1000 * 60 * 60 * 24)
            ) + 1;

        return `
        <div style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            padding:12px;
            background:${isStorico ? '#f8fafc' : 'white'};
            border-radius:12px;
            margin-bottom:8px;
            border:1px solid ${isStorico ? '#e2e8f0' : '#bfdbfe'};
            opacity:${isStorico ? '0.75' : '1'};
        ">
            <div>
                <div style="font-size:13px;">
                    ${emoji} Dal ${fmtData(p.data_inizio)} al ${fmtData(p.data_fine)}
                </div>

                <div style="
                    display:flex;
                    gap:12px;
                    margin-top:4px;
                    font-size:11px;
                    align-items:center;
                    flex-wrap:wrap;
                ">
                    <span style="font-weight:bold; color:${colore};">
                        Stato: ${p.stato}
                    </span>

                    <span style="color:#64748b;">
                        Totale giorni: ${giorni}
                    </span>
                </div>
            </div>

            ${cestino}
        </div>`;
    }).join('') || `
        <p style="color:#64748b; text-align:center;">
            Nessuna prenotazione.
        </p>
    `;

    // ✅ EVENTI DOPO IL RENDER
    document.querySelectorAll('.btn-delete').forEach(btn => {

        btn.addEventListener('click', () => {

            eliminaPren(btn.dataset.id);

        });

    });
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

async function cercaPass(passManuale = null) {

    const input = document.getElementById('search-p');
    document.getElementById('box-verifica')?.classList.add('hidden');
    if (!input) {
        alert("Campo ricerca non trovato");
        return;
    }

    const p = (
        passManuale ||
        input.value
    )
    .trim()
    .toUpperCase();

    // aggiorna il campo visivamente
    input.value = p;

    if (!p) return;

    try {

        const res = await fetch(
            `/api/piantone/cerca/${encodeURIComponent(p)}?auth=${userPass}&view=${filtroPiantone}`
        );
        const data = await res.json();

const btnIngresso = document.getElementById('btn-ingresso');
const btnUscita = document.getElementById('btn-uscita');
const boxVerifica = document.getElementById('box-verifica');

// RESET UI
btnIngresso.style.display = 'inline-block';
btnUscita.style.display = 'inline-block';

btnIngresso.innerText = 'ENTRATA';
btnUscita.innerText = 'USCITA';

btnIngresso.style.background = '';
btnUscita.style.background = '';

boxVerifica?.classList.add('hidden');

        if (data.trovato) {

            currentPren = data.prenotazione;
            
            if (!currentPren) {
            
                alert("Prenotazione non trovata");
            
                return;
            }
           
            // SEMPRE NASCOSTO ALL'APERTURA
            boxVerifica.classList.add('hidden');
            
           // RESET
            btnIngresso.disabled = true;
            btnUscita.disabled = true;
            
            // PRENOTATO
            if (
                currentPren.stato === 'PRENOTATO'
            ) {
            
                btnIngresso.disabled = false;
            }
            
            // ENTRATO
            else if (
                currentPren.stato === 'ENTRATO'
            ) {
            
                btnUscita.disabled = false;
            }
            else if (
                currentPren.stato === 'DA_VERIFICARE'
            ) {
            
                // ENTRATA visibile
                btnIngresso.style.display = 'inline-block';
                btnIngresso.disabled = true;
            
                // VERIFICATO
                btnUscita.disabled = false;
                btnUscita.style.display = 'inline-block';
                btnUscita.style.background = '#ea580c';
                btnUscita.innerText = 'VERIFICATO';
            }
            // SCADUTO
            else if (
                currentPren.stato === 'SCADUTO'
            ) {
            
                btnUscita.disabled = false;
            
                btnUscita.style.background = '#ef4444';
                btnUscita.innerText = 'USCITA (SCADUTO)';
            }
            
            // USCITO
            else if (
                currentPren.stato === 'USCITO'
            ) {
            
                btnIngresso.disabled = true;
                btnUscita.disabled = true;
            }
            // UI
            document
                .getElementById('panel-piantone')
                .classList
                .remove('hidden');

            document.getElementById('lab-pass').innerHTML =
                `PASS: ${currentPren.npass}`;

            document.getElementById('lab-periodo').innerHTML =
                `(Periodo: ${fmtData(currentPren.data_inizio)} - ${fmtData(currentPren.data_fine)})`;

            document.getElementById('reg-e').innerHTML =
                currentPren.orario_ingresso
                    ? `Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', {
                        dateStyle: 'short',
                        timeStyle: 'short'
                    })}`
                    : "";

            document.getElementById('reg-u').innerHTML =
                currentPren.orario_uscita
                    ? `Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', {
                        dateStyle: 'short',
                        timeStyle: 'short'
                    })}`
                    : "";

        } else {

            alert("Nessuna prenotazione trovata per questo PASS.");

            document
                .getElementById('panel-piantone')
                .classList
                .add('hidden');
        }

    } catch (err) {

        console.error("ERRORE CERCA PASS:", err);

        alert("Errore ricerca PASS");
    }
}

// FIX: tabella a 4 colonne (PASS | Data Accesso | Ora Ingresso | Data e Ora Uscita)
// con gestione null su orario_ingresso e orario_uscita
function getFlags(x) {

    const oggi = new Date().toISOString().split('T')[0];

    const entrato = x.stato === 'ENTRATO';

    const scaduto =
        (x.stato === 'PRENOTATO' && oggi > x.data_fine) ||
        x.stato === 'MAI_ENTRATO';

    const prenotatoOggi =
        x.stato === 'PRENOTATO' &&
        oggi >= x.data_inizio &&
        oggi <= x.data_fine;

    // 🔴 VERIFICARE
const daVerificare =
    x.stato === 'DA_VERIFICARE' &&
    x.orario_ingresso !== null &&
    x.orario_uscita === null &&
    oggi > x.data_fine;

    const storico = x.stato === 'USCITO';

    return {
        entrato,
        scaduto,
        prenotatoOggi,
        daVerificare,
        storico
    };
}

async function aggiornaVeicoli() {

    const res = await fetch(`/api/veicoli-dentro?npass=${userPass}`);
    const dati = await res.json();
    const oggi = new Date().toISOString().split('T')[0];

let countDentro = 0;
let countPrenotati = 0;
let countScaduti = 0;
let countVerificare = 0;
    
dati.forEach(x => {

    const prenotatoOggi =
        x.stato === 'PRENOTATO' &&
        oggi >= x.data_inizio &&
        oggi <= x.data_fine;

    const dentro =
    (
        x.stato === 'ENTRATO'
        ||
        (
            x.stato === 'SCADUTO' &&
            x.orario_ingresso &&
            !x.orario_uscita
        )
    );
    
    const maiEntrato =
        x.stato === 'MAI_ENTRATO';

    const scaduto =
        (x.stato === 'PRENOTATO' && oggi > x.data_fine) ||
        x.stato === 'MAI_ENTRATO';

    if (dentro) countDentro++;
    if (prenotatoOggi) countPrenotati++;
    if (scaduto) countScaduti++;
    const f = getFlags(x);
        if (f.daVerificare) countVerificare++;
});
    totaleScaduti = countScaduti;
    totaleVerificare = countVerificare;
    
let label = "";
let colore = "#334155";
let sfondo = "#f8fafc";

if (filtroPiantone === 'attivi') {

    label = "📋 ATTIVI";
    colore = "#2563eb";
    sfondo = "#dbeafe";
}

else if (filtroPiantone === 'scaduti') {

    label = "⏰ SCADUTI";
    colore = "#dc2626";
    sfondo = "#fee2e2";
}

else if (filtroPiantone === 'verificare') {

    label = "🚨 DA VERIFICARE";
    colore = "#ea580c";
    sfondo = "#ffedd5";
}

else if (filtroPiantone === 'storico') {

    label = "🕘 STORICO";
    colore = "#475569";
    sfondo = "#e2e8f0";
}

else {

    label = "📑 TUTTI";
    colore = "#7c3aed";
    sfondo = "#ede9fe";
}
    // BADGE
    const badge = document.getElementById('badge-contatori');
    const statoTabella = document.getElementById('stato-tabella');
    
    if (statoTabella) {
    
        statoTabella.innerHTML = label;
    
        statoTabella.style.color = colore;
        statoTabella.style.background = sfondo;
        statoTabella.style.borderColor = colore;
    }
    
   badge.innerHTML = `
<div>
    🚗 <b>Dentro:</b> ${countDentro}
    &nbsp;&nbsp;|&nbsp;&nbsp;
    📅 <b>Prenotati oggi:</b> ${countPrenotati}
    &nbsp;&nbsp;|&nbsp;&nbsp;
    🅿️ <b>Liberi:</b> ${120 - countDentro}
</div>

<div style="
    margin-top:6px;
    font-size:15px;
    font-weight:bold;
">
    🚨 <b>Da verificare:</b> ${countVerificare}

    ${
        countScaduti > 0
        ? `
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <span id="badge-scaduti">
            ⏰ <b>Scaduti:</b> ${countScaduti}
        </span>
        `
        : ''
    }
</div>
`;

    // LAMPEGGIO SOLO SCADUTI
const elScaduti = document.getElementById('badge-scaduti');

if (elScaduti && countScaduti > 0) {

    elScaduti.style.animation = 'blink 1s infinite';
    elScaduti.style.color = '#ef4444';
}

 // FILTRI
const lista = dati.filter(x => {

    const f = getFlags(x);

    if (filtroPiantone === 'attivi')
    return (
        f.entrato ||
        f.prenotatoOggi ||
        f.daVerificare
    );

    if (filtroPiantone === 'scaduti')
        return f.scaduto;

    if (filtroPiantone === 'verificare')
        return f.daVerificare;

    if (filtroPiantone === 'storico')
        return f.storico;

    return true;
})
    .sort((a, b) => {
        const prenA = a.stato === 'PRENOTATO';
        const prenB = b.stato === 'PRENOTATO';
        const fa = getFlags(a);
        const fb = getFlags(b);

        if (prenA && prenB) {
            return new Date(a.data_inizio) - new Date(b.data_inizio);
        }

        if (prenA && !prenB) return -1;
        if (!prenA && prenB) return 1;

        return new Date(b.data_inserimento || 0) -
               new Date(a.data_inserimento || 0);
    });
    
    // RENDER
    document.getElementById('lista-veicoli').innerHTML = lista.map(x => {

        const ing = x.orario_ingresso
            ? new Date(x.orario_ingresso)
            : null;

        const usc = x.orario_uscita
            ? new Date(x.orario_uscita)
            : null;

        const dataIng = ing
            ? ing.toLocaleDateString('it-IT')
            : '--';

        const oraIng = ing
            ? ing.toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit'
            })
            : '--';

        const dataUsc = usc
            ? usc.toLocaleDateString('it-IT')
            : '';

        const oraUsc = usc
            ? usc.toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit'
            })
            : '';
        
        const evidenzia =
            x.npass === ultimoAggiornato;
        
        const scaduto =
            (x.stato === 'PRENOTATO' && oggi > x.data_fine) ||
            x.stato === 'MAI_ENTRATO';

        const daVerificare =
            x.stato === 'DA_VERIFICARE' &&
            x.orario_ingresso !== null &&
            x.orario_uscita === null &&
            oggi > x.data_fine;
        const maiEntrato = x.stato === 'MAI_ENTRATO';
        const storico = x.stato === 'USCITO';
        const uscitoScaduto =
            x.stato === 'USCITO' &&
            x.data_fine < oggi;
        
        const f = getFlags(x);
        
           return `<tr style="
        ${scaduto ? 'background:#fee2e2; color:#991b1b;' : ''}
        ${uscitoScaduto ? 'background:#fee2e2; color:#991b1b;' : ''}
        ${storico ? 'background:#f1f5f9;' : ''}
        ${evidenzia ? 'background:#d1fae5; font-weight:bold;' : ''}
        ${daVerificare ? 'background:#fff7ed; color:#c2410c; font-weight:bold;' : ''}
        ${maiEntrato ? 'background:#fee2e2; color:#991b1b;' : ''}
    ">
<td>
    <button
        class="btn-pass"
        data-pass="${x.npass}"
        type="button"
        style="
            border:none;
            background:none;
            color:#2563eb;
            font-weight:bold;
            cursor:pointer;
            text-decoration:underline;
        "
    >
        ${x.npass}
    </button>
</td>
            <td>
                ${dataIng}
            </td>

            <td style="font-weight:bold;">
                ${oraIng}
            </td>

            <td>
                ${scaduto ? 'SCADUTA' : dataUsc}
            </td>

            <td style="font-weight:bold;">
                ${scaduto ? '' : oraUsc}
            </td>

        </tr>`;

    }).join('') || `
        <tr>
            <td colspan="5"
                style="
                    text-align:center;
                    color:black;
                    padding:16px;
                ">
                Nessun veicolo presente
            </td>
        </tr>
    `;
    document.querySelectorAll('.btn-pass').forEach(btn => {

    btn.addEventListener('click', async () => {

        const pass = btn.dataset.pass;

        document.getElementById('search-p').value = pass;

        await cercaPass(pass);

        setTimeout(() => {

            document
                .getElementById('panel-piantone')
                ?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

        }, 100);

    });

});
}
    
let loadingAzione = false;

async function mossa(tipo) {

    if (loadingAzione) return;

    let azione = tipo;

    if (tipo === 'E') azione = 'ingresso';
    if (tipo === 'U') {

    // caso DA_VERIFICARE
   if (currentPren.stato === 'DA_VERIFICARE') {

    // nasconde il bottone VERIFICA
    document.getElementById('btn-uscita').style.display = 'none';

    // mostra PRESENTE / NON PRESENTE
    document
        .getElementById('box-verifica')
        ?.classList.remove('hidden');

    return;
}

    azione = 'uscita';
    }
    
    // 🚫 uscita senza ingresso
    if (
        tipo === 'U' &&
        currentPren.stato !== 'DA_VERIFICARE' &&
        (
            currentPren.stato === 'PRENOTATO' ||
            !currentPren.orario_ingresso
        )
    ) {
        alert("Auto ancora non entrata");
        return;
    }
    const btnIngresso = document.getElementById('btn-ingresso');
    const btnUscita = document.getElementById('btn-uscita');

    btnIngresso.disabled = true;
    btnUscita.disabled = true;

    loadingAzione = true;

    try {

        const res = await fetch('/api/piantone/azione', {

            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                id: currentPren.id,
                azione: azione,
                npass: userPass
            })

        });

        const data = await res.json();

        if (!data.success) {

            alert(data.error || "Errore operazione");
            return;

        }

        // 🔊 suoni
        if (tipo === 'E') {

            beepIngresso.play();

        } else {

            beepUscita.play();

        }

        ultimoAggiornato = currentPren.npass;

        await aggiornaVeicoli();

        // uscita
        if (tipo === 'U') {

            document
                .getElementById('panel-piantone')
                .classList
                .add('hidden');

            document.getElementById('search-p').value = '';

            currentPren = null;

        } else {

            await cercaPass();

        }

    } catch (err) {

        console.error(err);

        alert("Errore rete/server");

    } finally {

        loadingAzione = false;

        btnIngresso.disabled = false;
        btnUscita.disabled = false;

    }
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

async function caricaStorico() {
    const res = await fetch(`/api/piantone/storico?npass=${userPass}`);
    const dati = await res.json();

    document.getElementById('storico').innerHTML = dati.map(x => {
        return `
        <div style="padding:6px; border-bottom:1px solid #ddd;">
            🚗 <b>${x.npass}</b> -
            IN: ${x.orario_ingresso ? new Date(x.orario_ingresso).toLocaleString('it-IT') : '--'}
            OUT: ${x.orario_uscita ? new Date(x.orario_uscita).toLocaleString('it-IT') : '--'}
        </div>`;
    }).join('');
}
let arriviVisible = false;

async function mostraArriviOggi() {

    const box = document.getElementById('box-arrivi-oggi');
    const btn = document.getElementById('btn-arrivi-oggi');

    // TOGGLE HIDE
    if (arriviVisible) {

        box.classList.add('hidden');

        arriviVisible = false;

        btn.innerText = 'Mostra Arrivi Oggi';

        return;
    }

    try {

        const res = await fetch('/api/piantone/arrivi-oggi');

        const dati = await res.json();

        const lista = document.getElementById('lista-arrivi-oggi');

        lista.innerHTML = '';

        if (!dati.length) {

            lista.innerHTML = `
                <tr>
                    <td colspan="2">
                        Nessun arrivo previsto oggi
                    </td>
                </tr>
            `;

        } else {

            dati.forEach(r => {

                let badge = '';

                if (r.stato === 'PRENOTATO') {

                    badge = `
                        <span class="badge-stato">
                            <span class="dot dot-orange"></span>
                            Deve Entrare
                        </span>
                    `;

                } else if (r.stato === 'ENTRATO') {

                    badge = `
                        <span class="badge-stato">
                            <span class="dot dot-green"></span>
                            Entrato
                        </span>
                    `;

                } else {

                    badge = `
                        <span class="badge-stato">
                            <span class="dot dot-red"></span>
                            Scaduto
                        </span>
                    `;
                }

                lista.innerHTML += `
                    <tr>
                        <td>${r.npass}</td>
                        <td>${badge}</td>
                    </tr>
                `;
            });
        }

        box.classList.remove('hidden');

        arriviVisible = true;

        btn.innerText = 'Nascondi Arrivi Oggi';

    } catch (err) {

        console.error(err);

        alert('Errore caricamento arrivi');
    }
}

window.addEventListener('DOMContentLoaded', () => {

    // LOGIN
    document.getElementById('btn-login')?.addEventListener('click', doLogin);

    // USER
    document.getElementById('btn-prenota')?.addEventListener('click', inviaPren);
    document.getElementById('btn-reset-days')?.addEventListener('click', resetSelezione);
    document.getElementById('btn-mie')?.addEventListener('click', mostraMie);

    document.getElementById('btn-back-user')?.addEventListener('click', () => {
        show('view-user');
    });

    document.getElementById('btn-logout-user')?.addEventListener('click', () => {
        location.reload();
    });
// PIANTONE

const inputSearch = document.getElementById('search-p');
document.getElementById('btn-cerca')?.addEventListener('click', () => {
    cercaPass();

});
inputSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        cercaPass();
    }

});

document.getElementById('btn-reset-search')
?.addEventListener('click', () => {
    if (inputSearch) {
        inputSearch.value = '';
        inputSearch.focus();
    }

    currentPren = null;

    document.getElementById('panel-piantone')?.classList.add('hidden');

});
document.getElementById('btn-presente')
?.addEventListener('click', async () => {

    if (!currentPren) return;

    const res = await fetch(
        '/api/piantone/azione',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: currentPren.id,
                azione: 'uscita',
                npass: userPass
            })
        }
    );

    const data = await res.json();

    if (data.success) {

        alert('Veicolo verificato');

        aggiornaVeicoli();

        document
            .getElementById('panel-piantone')
            .classList
            .add('hidden');
    }
});
document.getElementById('btn-non-presente')
?.addEventListener('click', async () => {

    if (!currentPren) return;
    if (!confirm(
        'Confermi che il veicolo NON è presente nel parcheggio?'
    )) return;

    const res = await fetch(
        '/api/piantone/non-presente',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: currentPren.id
            })
        }
    );
    const data = await res.json();

    if (data.success) {
        alert('Segnato come USCITO');
        aggiornaVeicoli();
        document
            .getElementById('panel-piantone')
            .classList
            .add('hidden');
    }
});
    document.getElementById('btn-arrivi-oggi')?.addEventListener('click', mostraArriviOggi);
    document.getElementById('btn-ingresso')?.addEventListener('click', () => {
        mossa('E');
    });
    const btnHomeSuccess = document.getElementById('btn-home-success');
    
    if (btnHomeSuccess) {
        btnHomeSuccess.addEventListener('click', () => {
            location.reload();
        });
    }
    document.getElementById('btn-uscita')?.addEventListener('click', () => {
        mossa('U');
    });

    document.getElementById('btn-filtro')?.addEventListener('click', toggleScaduti);
    document.getElementById('btn-logout-piantone')?.addEventListener('click', () => {
        location.reload();
    });
    
    // ADMIN
    document.getElementById('btn-ritardi')?.addEventListener('click', mostraRitardi);

    document.getElementById('btn-logout-admin')?.addEventListener('click', () => {
        location.reload();
    });

});
