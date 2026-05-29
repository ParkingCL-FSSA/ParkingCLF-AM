let userPass = ""; let selectedDays = []; 
let deferredPrompt; let currentPren = null;
let filtroPiantone = 'verificare'; let totaleScaduti = 0;
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
function formattaDataIT(data) {
    return fmtData(data);
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

    // 🌟 RESETTIAMO LA UI DEL PANNELLO QUANDO SI CAMBIA SCHEDA
    document.getElementById('box-verifica')?.classList.add('hidden');
    document.getElementById('panel-piantone')?.classList.add('hidden');
    const inputSearch = document.getElementById('search-p');
    if (inputSearch) inputSearch.value = '';
    currentPren = null;

    // === LOGICA DI TRANSIZIONE DEGLI STATI ===
    // Ordine: VERIFICARE -> SCADUTI -> ATTIVI -> TUTTI -> STORICO -> (ricomincia)

    // DA VERIFICARE
    if (filtroPiantone === 'verificare') {
        if (totaleScaduti > 0) {
            filtroPiantone = 'scaduti';
        } else {
            filtroPiantone = 'attivi';
        }
    }
    // SCADUTI
    else if (filtroPiantone === 'scaduti') {
        filtroPiantone = 'attivi';
    }
    // ATTIVI
    else if (filtroPiantone === 'attivi') {
        filtroPiantone = 'tutti';
    }
    // TUTTI
    else if (filtroPiantone === 'tutti') {
        filtroPiantone = 'storico';
    }
    // STORICO (Ricomincia il ciclo)
    else {
        if (totaleVerificare > 0) {
            filtroPiantone = 'verificare';
        } else if (totaleScaduti > 0) {
            filtroPiantone = 'scaduti';
        } else {
            filtroPiantone = 'attivi';
        }
    }

    // === AGGIORNAMENTO DEL BADGE COLORATO ===
    const statoTabella = document.getElementById('stato-tabella');

    if (statoTabella) {
        if (filtroPiantone === 'verificare') {
            statoTabella.innerHTML = "🚨 DA VERIFICARE";
            statoTabella.style.color = "#ea580c";
            statoTabella.style.background = "#ffedd5";
            statoTabella.style.borderColor = "#ea580c";
        }
        else if (filtroPiantone === 'scaduti') {
            statoTabella.innerHTML = "⏰ SCADUTI";
            statoTabella.style.color = "#dc2626";
            statoTabella.style.background = "#fee2e2";
            statoTabella.style.borderColor = "#dc2626";
        }
        else if (filtroPiantone === 'attivi') {
            statoTabella.innerHTML = "📋 ATTIVI";
            statoTabella.style.color = "#2563eb";
            statoTabella.style.background = "#dbeafe";
            statoTabella.style.borderColor = "#2563eb";
        }
        else if (filtroPiantone === 'tutti') {
            statoTabella.innerHTML = "📑 TUTTI";
            statoTabella.style.color = "#7c3aed";
            statoTabella.style.background = "#ede9fe";
            statoTabella.style.borderColor = "#7c3aed";
        }
        else {
            statoTabella.innerHTML = "🕘 STORICO";
            statoTabella.style.color = "#475569";
            statoTabella.style.background = "#e2e8f0";
            statoTabella.style.borderColor = "#475569";
        }
    }

    // Ricarica la lista veicoli in base al nuovo filtro
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
        
        // 1. PRIMA attendiamo ed estraiamo i dati dal server
        const data = await res.json();

        // 2. POI controlliamo se il pass è valido
        if (!data.valid) {
            alert("Accesso Negato");
            return;
        }

        // 3. ORA popoliamo il campo note (con controllo di sicurezza)
        const campoNote = document.getElementById('u-note');
        if (campoNote) {
            campoNote.value = data.note ? data.note : '';
        }
        // Nascondi l'avviso quando il login ha successo
        const avviso = document.getElementById('avviso-manutenzione');
        if (avviso) avviso.style.display = 'none';
        
        // Gestione dei ruoli
        if (data.ruolo === 'piantone') {
            show('view-piantone');
            try { aggiornaVeicoli(); } catch(e){ console.log(e); }
            try { aggiornaPostiLiberiPiantone(); } catch(e){ console.log(e); }
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

async function cercaPass(passManuale = null, idRecord = null) {

    const input = document.getElementById('search-p');
    document.getElementById('box-verifica')?.classList.add('hidden');
    if (!input) return;

    const p = (passManuale || input.value).trim().toUpperCase();
    input.value = p;
    if (!p) return;

    try {
        // 🚀 SE ABBIAMO L'ID, CHIEDIAMO AL SERVER IL RECORD PRECISO, ALTRIMENTI USIAMO IL PASS
        let url = `/api/piantone/cerca/${encodeURIComponent(p)}?auth=${userPass}`;
        if (idRecord) {
            url += `&id=${idRecord}`;
        }

        const res = await fetch(url);
        const data = await res.json();

        const btnIngresso = document.getElementById('btn-ingresso');
        const btnUscita = document.getElementById('btn-uscita');
        const boxVerifica = document.getElementById('box-verifica');

        // RESET UI
        btnIngresso.style.display = 'inline-block';
        btnUscita.style.display = 'inline-block';

        btnIngresso.disabled = true;
        btnUscita.disabled = true;

        btnIngresso.innerText = 'ENTRATA';
        btnUscita.innerText = 'USCITA';

        btnIngresso.style.background = '';
        btnUscita.style.background = '';

        // NASCONDI SEMPRE verifica all'apertura
        if (boxVerifica) {
            boxVerifica.classList.add('hidden');
        }

       if (data.trovato) {

            currentPren = data.prenotazione;
            
            if (!currentPren) {
                alert("Prenotazione non trovata");
                return;
            }
            
            // RESET PULSANTI
            btnIngresso.disabled = true;
            btnUscita.disabled = true;
            
            // 🚀 BLOCCO SICUREZZA: Controllo data futura (Lunga Sosta)
            const oggiStr = new Date().toISOString().split('T')[0]; // "2026-05-29"
            const dataInizioStr = currentPren.data_inizio.split('T')[0]; // "2026-06-05"

            if (oggiStr < dataInizioStr) {
                // Se oggi è prima della data di inizio, blocca l'ingresso
                btnIngresso.disabled = true;
                btnIngresso.innerText = 'PRENOTAZIONE FUTURA';
                btnIngresso.style.background = '#94a3b8'; // Colore grigio disattivato
                
                // Opzionale: un piccolo avviso visivo nel pannello
                document.getElementById('reg-e').innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Non è possibile registrare l'ingresso prima del ${fmtData(currentPren.data_inizio)}</span>`;
            }
            // PRENOTATO (Se siamo nelle date corrette)
            else if (currentPren.stato === 'PRENOTATO') {
                btnIngresso.disabled = false;
            }
            // ENTRATO
            else if (currentPren.stato === 'ENTRATO') {
                btnUscita.disabled = false;
            }
            // DA VERIFICARE
            else if (currentPren.stato === 'DA_VERIFICARE') {
                btnIngresso.style.display = 'inline-block';
                btnIngresso.disabled = true;
            
                btnUscita.disabled = false;
                btnUscita.style.display = 'inline-block';
                btnUscita.style.background = '#ea580c';
                btnUscita.innerText = 'VERIFICA';
            
                boxVerifica.classList.add('hidden');
            }
            // SCADUTO
            else if (currentPren.stato === 'SCADUTO') {
                btnUscita.disabled = false;
                btnUscita.style.background = '#ef4444';
                btnUscita.innerText = 'USCITA (SCADUTO)';
            }
            // USCITO
            else if (currentPren.stato === 'USCITO') {
                btnIngresso.disabled = true;
                btnUscita.disabled = true;
            }

            // UI PANNELLO (Mostra i dettagli del Pass)
            document.getElementById('panel-piantone').classList.remove('hidden');

            document.getElementById('lab-pass').innerHTML = `PASS: ${currentPren.npass}`;
            document.getElementById('lab-periodo').innerHTML = `(Periodo: ${fmtData(currentPren.data_inizio)} - ${fmtData(currentPren.data_fine)})`;

            // Mostra gli orari di ingresso/uscita solo se non abbiamo già stampato l'errore della data futura
            if (oggiStr >= dataInizioStr) {
                document.getElementById('reg-e').innerHTML = currentPren.orario_ingresso
                    ? `Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`
                    : "";
            }

            document.getElementById('reg-u').innerHTML = currentPren.orario_uscita
                ? `Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`
                : "";

        } else {
            alert("Nessuna prenotazione trovata per questo PASS.");
            document.getElementById('panel-piantone').classList.add('hidden');
        }

    } catch (err) {

        console.error("ERRORE CERCA PASS:", err);

        alert("Errore ricerca PASS");
    }
}

function getFlags(x) {
    const oggi = new Date().toISOString().split('T')[0];

    // 1. ENTRATO: Il veicolo è dentro il parcheggio
    const entrato = x.stato === 'ENTRATO';

    // 2. SCADUTO: Solo se il periodo è terminato del tutto o se forzato dal sistema
    const scaduto =
        (x.stato === 'PRENOTATO' && oggi > x.data_fine) ||
        x.stato === 'MAI_ENTRATO';

    // 3. PRENOTATO OGGI: In corso di validità (Blu)
    const prenotatoOggi =
        x.stato === 'PRENOTATO' &&
        oggi >= x.data_inizio &&
        oggi <= x.data_fine;

    // 4. DA VERIFICARE
    const daVerificare =
        x.stato === 'DA_VERIFICARE' &&
        x.orario_ingresso !== null &&
        x.orario_uscita === null &&
        oggi > x.data_fine;

    // 5. STORICO || ARCHIVIATO
    const storico = x.stato === 'USCITO' || x.stato === 'ARCHIVIATO';

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
    const inputSearch = document.getElementById('search-p'); // Recupero riferimento

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
                x.stato === 'DA_VERIFICARE' &&
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
    
    totale