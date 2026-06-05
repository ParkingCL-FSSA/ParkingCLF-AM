let userPass = ""; let selectedDays = []; 
let deferredPrompt; let currentPren = null;
let filtroPiantone = 'verificare'; let totaleScaduti = 0;
let ultimoAggiornato = null;let totaleVerificare = 0;
// attivi = dentro (default)
// scaduti = solo scaduti
// tutti = tutto

// ============================================================
// 🗓️ FUNZIONI DI CALCOLO DINAMICO DATA (Dichiarate subito in cima)
// ============================================================
function inizializzaFinestraDate() {
    const oggi = new Date();
    const fineFinestra = new Date();
    fineFinestra.setDate(oggi.getDate() + 44); // Finestra fissa di 45 giorni totali da oggi

    // Formatta le date come Gg/Mm (es. 5/6 e 19/7)
    const strInizio = `${oggi.getDate()}/${oggi.getMonth() + 1}`;
    const strFine = `${fineFinestra.getDate()}/${fineFinestra.getMonth() + 1}`;

    const elInizio = document.getElementById('dinamico-inizio');
    const elFine = document.getElementById('dinamico-fine');
    
    if (elInizio) elInizio.textContent = strInizio;
    if (elFine) elFine.textContent = strFine;
}

function aggiornaSoloMax() {
    const elMax = document.getElementById('dinamico-max');
    if (!elMax) return;

    const selectProfilo = document.getElementById('select-profilo');
    const profilo = selectProfilo ? selectProfilo.value : 'STD';

    let maxGg = 15;
    if (profilo === 'MIS') maxGg = 45;
    if (profilo === 'TRN') maxGg = 30;

    elMax.innerHTML = `<b>Max ${maxGg}</b>`;
}

function aggiornaTestoFinestra() {
    const el = document.getElementById('testo-limite-giorni');
    if (!el) return;

    const selectProfilo = document.getElementById('select-profilo');
    const profilo = selectProfilo ? selectProfilo.value : 'STD';

    let maxGg = 15;
    if (profilo === 'MIS') maxGg = 45;
    if (profilo === 'TRN') maxGg = 30;

    const oggi = new Date();
    const fineFinestra = new Date();
    fineFinestra.setDate(oggi.getDate() + 44);

    const strInizio = `${oggi.getDate()}/${oggi.getMonth() + 1}`;
    const strFine = `${fineFinestra.getDate()}/${fineFinestra.getMonth() + 1}`;

    el.innerHTML = `Seleziona i giorni (Min 2 | <b>Max ${maxGg}</b>) dal <b>${strInizio}</b> al <b>${strFine}</b>`;
}

// PWA Installer Listener
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btnInstalla = document.getElementById('btnInstalla');
    if(btnInstalla) {
        btnInstalla.style.display = 'block';
        btnInstalla.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt = null;
                btnInstalla.style.display = 'none';
            }
        });
    }
});

// ============================================================
// 🏁 BLOCCO DI AVVIO UNICO E COERENTE AL CARICAMENTO DELLA PAGINA
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // A. Esegui IMMEDIATAMENTE i calcoli grafici delle date della finestra
    inizializzaFinestraDate();
    aggiornaSoloMax();
    
    // B. Genera la griglia iniziale del calendario se disponibile
    if (typeof buildCal === "function") {
        buildCal();
    }

    // C. Controllo Sicurezza / Caricamento dati per utenti già autorizzati (Piantone/Admin)
    if (typeof userPass !== 'undefined' && userPass && userPass.trim() !== "") {
        if (typeof aggiornaVeicoli === 'function') {
            await aggiornaVeicoli(); 
        }

        if (typeof totaleVerificare !== 'undefined' && totaleVerificare > 0) {
            filtroPiantone = 'verificare';
        } else if (typeof totaleScaduti !== 'undefined' && totaleScaduti > 0) {
            filtroPiantone = 'scaduti';
        } else {
            filtroPiantone = 'attivi';
        }

        if (typeof aggiornaGraficaBadge === 'function') {
            aggiornaGraficaBadge();
        }

        if (typeof aggiornaVeicoli === 'function') {
            await aggiornaVeicoli();
        }
    } else {
        filtroPiantone = 'verificare';
    }

    // D. Controllo se l'utente arriva dal QR code con mode=install
    if (urlParams.get('mode') === 'install') {
        setTimeout(() => {
            const btn = document.getElementById('btnInstalla');
            if (btn) {
                btn.style.border = "4px solid #3b82f6";
                alert("Benvenuto! Clicca sul tasto bianco e blu 'INSTALLA APP' per averla sempre sul telefono.");
            }
        }, 1500);
    }

    // ============================================================
    // 📋 REGISTRAZIONE EVENT LISTENERS STANDARD DELLA PAGINA
    // ============================================================
    document.getElementById('btn-login')?.addEventListener('click', doLogin);
    document.getElementById('btn-reset-days')?.addEventListener('click', resetSelezione);
    document.getElementById('btn-mie')?.addEventListener('click', mostraMie);
    document.getElementById('btn-back-user')?.addEventListener('click', () => { show('view-user'); });

    document.getElementById('btn-prenota')?.addEventListener('click', () => {
        if (loadingPrenotazione) return;

        if (selectedDays.length === 0) { 
            alert("⚠️ Seleziona almeno un giorno sulla griglia del calendario prima di procedere!"); 
            return; 
        }
        if (selectedDays.length === 1) { 
            alert("Per il parcheggio【Lunga Sosta】il minimo di giorni prenotabili sono 2"); 
            return; 
        }

        const emailInput = document.getElementById('u-email');
        if (!emailInput || !emailInput.value.trim()) {
            alert("⚠️ Inserisci il tuo indirizzo email per ricevere il PASS!");
            return;
        }
        const email = emailInput.value.trim().toLowerCase();
        if (email.includes('@') && email.endsWith('.difesa.it')) {
            alert('🚫 Inserisci la tua mail privata! Non sono ammessi indirizzi istituzionali.');
            return;
        }

        const selectProfilo = document.getElementById('select-profilo');
        const profilo = selectProfilo ? selectProfilo.value : 'STD';
        
        let limiteMassimo = 15;
        if (profilo === 'MIS') limiteMassimo = 45;
        if (profilo === 'TRN') limiteMassimo = 30;

        if (selectedDays.length > limiteMassimo) {
            resetSelezione();
            alert(`⚠️ Profilo ${profilo}: Massimo ${limiteMassimo} giorni selezionabili!`);
            return;
        }

        const modalRegole = document.getElementById('modal-conferma-regole');
        if (modalRegole) modalRegole.style.display = 'flex';
    });

    document.getElementById('modal-btn-annulla')?.addEventListener('click', () => {
        const modalRegole = document.getElementById('modal-conferma-regole');
        if (modalRegole) modalRegole.style.display = 'none';
    });

    document.getElementById('modal-btn-accetta')?.addEventListener('click', () => {
        const modalRegole = document.getElementById('modal-conferma-regole');
        const modalLoading = document.getElementById('modal-loading');

        if (modalRegole) modalRegole.style.display = 'none';
        if (modalLoading) modalLoading.style.display = 'flex';

        inviaPren();
    });

    document.getElementById('btn-invia-nota')?.addEventListener('click', async () => {
        const notaInput = document.getElementById('u-note'); 
        const notaTesto = notaInput ? notaInput.value.trim() : '';
        const emailUtente = document.getElementById('u-email')?.value.trim() || '';

        if (!notaTesto) {
            alert('Scrivi qualcosa nel campo suggerimenti prima di inviare!');
            return;
        }
        
        try {
            const res = await fetch('/api/user/salva-nota', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ npass: userPass, nota: notaTesto, email: emailUtente })
            });
            const data = await res.json();
            if (data.success) {
                alert('Suggerimento inviato con successo! Grazie per il tuo contributo. 💡');
                if (notaInput) notaInput.value = '';
            } else {
                alert('Errore durante l\'invio: ' + (data.error || 'Riprova più tardi.'));
            }
        } catch (err) {
            console.error(err);
            alert('Errore di connessione al server.');
        }
    });

    document.getElementById('btn-logout-user')?.addEventListener('click', () => { location.reload(); });
    
    const inputSearch = document.getElementById('search-p');
    document.getElementById('btn-cerca')?.addEventListener('click', () => { cercaPass(); });

    inputSearch?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            cercaPass();
        }
    });

    document.getElementById('btn-reset-search')?.addEventListener('click', () => {
        if (inputSearch) inputSearch.value = '';
        currentPren = null;
        filtroPiantone = 'attivi'; 
        document.getElementById('panel-piantone')?.classList.add('hidden');
        document.getElementById('box-verifica')?.classList.add('hidden'); 
        if (typeof aggiornaGraficaBadge === 'function') aggiornaGraficaBadge();
        aggiornaVeicoli();
    });

    document.getElementById('btn-presente')?.addEventListener('click', async () => {
        if (!currentPren) return;
        if (!confirm('Confermi che il veicolo è presente nel parcheggio?')) return;

        const res = await fetch('/api/piantone/azione', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentPren.id, azione: 'uscita', npass: userPass })
        });
        const data = await res.json();
        if (data.success) {
            alert('Veicolo verified');
            await aggiornaVeicoli();
            document.getElementById('box-verifica')?.classList.add('hidden');
            const btnUscita = document.getElementById('btn-uscita');
            if (btnUscita) {
                btnUscita.style.display = 'inline-block';
                btnUscita.disabled = true;
                btnUscita.innerText = 'VERIFICATO';
                btnUscita.style.background = '#64748b';
            }
        }
    });

    document.getElementById('btn-non-presente')?.addEventListener('click', async () => {
        if (!currentPren) return;
        if (!confirm('Confermi che il veicolo NON è presente nel parcheggio?')) return;

        const res = await fetch('/api/piantone/non-presente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentPren.id })
        });
        const data = await res.json();
        if (data.success) {
            alert('Veicolo segnato come NON presente');
            await aggiornaVeicoli();
            document.getElementById('box-verifica')?.classList.add('hidden');
            document.getElementById('panel-piantone')?.classList.add('hidden');
            currentPren = null;
            if (inputSearch) inputSearch.value = '';
        }
    });
    
    document.getElementById('btn-arrivi-oggi')?.addEventListener('click', mostraArriviOggi);
    document.getElementById('btn-ingresso')?.addEventListener('click', () => { mossa('E'); });

    const btnHomeSuccess = document.getElementById('btn-home-success');
    if (btnHomeSuccess) {
        btnHomeSuccess.addEventListener('click', () => { location.reload(); });
    }

    document.getElementById('btn-uscita')?.addEventListener('click', () => { mossa('U'); });
    document.getElementById('btn-filtro')?.addEventListener('click', toggleScaduti);
    document.getElementById('search-p')?.addEventListener('input', aggiornaVeicoli);
    document.getElementById('btn-logout-piantone')?.addEventListener('click', () => { location.reload(); });
    
    document.getElementById('btn-ritardi')?.addEventListener('click', mostraRitardi);
    document.getElementById('btn-logout-admin')?.addEventListener('click', () => { location.reload(); });

    // Inputs focus automations
    const inputLogin = document.getElementById('in-npass');
    inputLogin?.addEventListener('input', () => {
        if (inputLogin.value.trim().length === 5) {
            document.getElementById('btn-login')?.focus();
        }
    });

    inputSearch?.addEventListener('input', () => {
        if (inputSearch.value.trim().length === 5) {
            document.getElementById('btn-cerca')?.focus();
        }
    });
});

// ============================================================
// 🎯 GESTIONE DINAMICA CAMBIO PROFILO
// ============================================================
document.getElementById('select-profilo')?.addEventListener('change', (e) => {
    const profilo = e.target.value;
    const nota = document.getElementById('nota-responsabilita');
    
    let limiteMassimo = 15;

    if (profilo === 'MIS') {
        limiteMassimo = 45;
        if (nota) nota.style.display = 'block';
    } else if (profilo === 'TRN') {
        limiteMassimo = 30;
        if (nota) nota.style.display = 'block';
    } else {
        limiteMassimo = 15;
        if (nota) nota.style.display = 'none';
    }

    if (selectedDays.length > limiteMassimo) {
        selectedDays = [];
        alert(`Profilo modificato. La selezione precedente superava il limite di ${limiteMassimo} gg. ed è stata azzerata.`);
    }

    aggiornaSoloMax();
    buildCal();
    if (typeof aggiornaRiepilogoGiorni === 'function') aggiornaRiepilogoGiorni();
});

const btnEsci = document.getElementById('btnEsciApp');
const beepIngresso = new Audio('/beep_i.mp3');
const beepUscita = new Audio('/beep_u.mp3');

if (btnEsci) {
    btnEsci.addEventListener('click', () => {
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
            window.close();
        } else {
            alert("Per uscire chiudi la scheda del browser o l'app.");
        }
    });
}

function fmtData(isoStr) {
    if (!isoStr) return '--';
    const p = isoStr.toString().split('T')[0].split('-');
    return `${p[2]}/${p[1]}/${p[0]}`;
}
function formattaDataIT(data) { return fmtData(data); }

function resetSelezione() {
    selectedDays = [];
    document.querySelectorAll('.day-slot.selected').forEach(el => el.classList.remove('selected'));
}

function show(id) {
    document.querySelectorAll('[id^="view-"]').forEach(d => d.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function toggleScaduti() {
    document.getElementById('box-verifica')?.classList.add('hidden');
    document.getElementById('panel-piantone')?.classList.add('hidden');
    const inputSearch = document.getElementById('search-p');
    if (inputSearch) inputSearch.value = '';
    currentPren = null;

    if (filtroPiantone === 'verificare') {
        if (totaleScaduti > 0) { filtroPiantone = 'scaduti'; } else { filtroPiantone = 'attivi'; }
    } else if (filtroPiantone === 'scaduti') {
        filtroPiantone = 'attivi';
    } else if (filtroPiantone === 'attivi') {
        filtroPiantone = 'tutti';
    } else if (filtroPiantone === 'tutti') {
        filtroPiantone = 'storico';
    } else {
        if (totaleVerificare > 0) {
            filtroPiantone = 'verificare';
        } else if (totaleScaduti > 0) {
            filtroPiantone = 'scaduti';
        } else {
            filtroPiantone = 'attivi';
        }
    }

    aggiornaGraficaBadge();
    aggiornaVeicoli();
}

function aggiornaGraficaBadge() {
    const statoTabella = document.getElementById('stato-tabella');
    if (!statoTabella) return;

    statoTabella.classList.remove('badge-blink');
    statoTabella.classList.remove('badge-blink-2');
    
    if (filtroPiantone === 'verificare') {
        statoTabella.innerHTML = "🚨 DA VERIFICARE";
        statoTabella.style.color = "#ea580c";
        statoTabella.style.background = "#ffedd5";
        statoTabella.style.borderColor = "#ea580c";
        if (totaleVerificare > 0) statoTabella.classList.add('badge-blink');
    } else if (filtroPiantone === 'scaduti') {
        statoTabella.innerHTML = "⏰ SCADUTI";
        statoTabella.style.color = "#dc2626";
        statoTabella.style.background = "#fee2e2";
        statoTabella.style.borderColor = "#dc2626";
        if (totaleScaduti > 0) statoTabella.classList.add('badge-blink-2');
    } else if (filtroPiantone === 'attivi') {
        statoTabella.innerHTML = "📋 ATTIVI";
        statoTabella.style.color = "#2563eb";
        statoTabella.style.background = "#dbeafe";
        statoTabella.style.borderColor = "#2563eb";
    } else if (filtroPiantone === 'tutti') {
        statoTabella.innerHTML = "📑 TUTTI";
        statoTabella.style.color = "#7c3aed";
        statoTabella.style.background = "#ede9fe";
        statoTabella.style.borderColor = "#7c3aed";
    } else {
        statoTabella.innerHTML = "🕘 STORICO";
        statoTabella.style.color = "#475569";
        statoTabella.style.background = "#e2e8f0";
        statoTabella.style.borderColor = "#475569";
    }
}

async function doLogin() {
    const card = document.querySelector('.card');
    if (card) card.classList.remove('admin-wide');
    
    try {
        userPass = document.getElementById('in-npass').value.trim().toUpperCase();
        if (!userPass) return;

        const res = await fetch('/api/valida-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npass: userPass })
        });
        
        const data = await res.json();
        if (!data.valid) {
            alert("Accesso Negato");
            return;
        }

        const campoNote = document.getElementById('u-note');
        if (campoNote) campoNote.value = data.note ? data.note : '';
        
        const avviso = document.getElementById('avviso-manutenzione');
        if (avviso) avviso.style.display = 'none';
        
        if (data.ruolo === 'piantone') {
            show('view-piantone');
            try {
                await aggiornaVeicoli();
                if (typeof totaleVerificare !== 'undefined' && totaleVerificare > 0) {
                    filtroPiantone = 'verificare';
                } else if (typeof totaleScaduti !== 'undefined' && totaleScaduti > 0) {
                    filtroPiantone = 'scaduti';
                } else {
                    filtroPiantone = 'attivi';
                }
                if (typeof aggiornaGraficaBadge === 'function') aggiornaGraficaBadge();
                await aggiornaVeicoli();
            } catch(e) { console.log("Errore inizializzazione dati piantone:", e); }
            try { aggiornaPostiLiberiPiantone(); } catch(e){ console.log(e); }
        } else if (data.ruolo === 'admin') { 
            if (card) card.classList.add('admin-wide');
            show('view-admin'); 
            try {
                await aggiornaVeicoli();
                if (typeof totaleVerificare !== 'undefined' && totaleVerificare > 0) {
                    filtroPiantone = 'verificare';
                } else if (typeof totaleScaduti !== 'undefined' && totaleScaduti > 0) {
                    filtroPiantone = 'scaduti';
                } else {
                    filtroPiantone = 'attivi';
                }
                if (typeof aggiornaGraficaBadge === 'function') aggiornaGraficaBadge();
                await aggiornaVeicoli();
            } catch(e) { console.log(e); }
            try { mostraAdmin(); } catch(e){ console.log(e); }
        } else {
            show('view-user');
            try { buildCal(); } catch(e){ console.log(e); }
        }
    } catch (err) {
        console.error("ERRORE LOGIN:", err);
        alert("Errore login");
    }
}

function buildCal() {
    const box = document.getElementById('cal-grid');
    if (!box) return;
    box.innerHTML = '';

    const maxGiorniDaMostrare = 45;
    const oggi = new Date();

    for (let i = 0; i < maxGiorniDaMostrare; i++) {
        const d = new Date(oggi);
        d.setDate(oggi.getDate() + i);
        const isoStr = d.toISOString().split('T')[0];

        const div = document.createElement('div');
        div.className = 'day-slot';
        div.textContent = d.getDate();
        div.setAttribute('data-date', isoStr);

        if (selectedDays.includes(isoStr)) div.classList.add('selected');

        div.addEventListener('click', () => {
            if (div.classList.contains('selected')) {
                div.classList.remove('selected');
                selectedDays = selectedDays.filter(x => x !== isoStr);
            } else {
                const selectProfilo = document.getElementById('select-profilo');
                const profilo = selectProfilo ? selectProfilo.value : 'STD';
                
                let limiteSelezionabili = 15;
                if (profilo === 'MIS') limiteSelezionabili = 45;
                if (profilo === 'TRN') limiteSelezionabili = 30;

                if (selectedDays.length >= limiteSelezionabili) {
                    alert(`⚠️ Profilo ${profilo}: Puoi selezionare al massimo ${limiteSelezionabili} gg.!`);
                    return;
                }
                
                div.classList.add('selected');
                selectedDays.push(isoStr);
            }
            if (typeof aggiornaRiepilogoGiorni === 'function') aggiornaRiepilogoGiorni();
        });
        box.appendChild(div);
    }
}

let loadingPrenotazione = false;

async function inviaPren() {
    if (loadingPrenotazione) return;
    loadingPrenotazione = true;

    const btn = document.getElementById('btn-prenota');
    if (btn) btn.disabled = true;

    const modalLoading = document.getElementById('modal-loading');
    const email = document.getElementById('u-email').value.trim().toLowerCase();

    try {
        const res = await fetch('/api/prenota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npass: userPass, giorni: selectedDays, email: email })
        });

        if (res.ok) {
            selectedDays.sort();
            document.getElementById('summary-details').innerHTML =
                `<b>Pass:</b> ${userPass}<br><b>Dal:</b> ${fmtData(selectedDays[0])}<br><b>Al:</b> ${fmtData(selectedDays[selectedDays.length - 1])}`;
            if (modalLoading) modalLoading.style.display = 'none';
            show('view-success');
            setTimeout(() => { mostraMie(); }, 5000);
        } else {
            const err = await res.json();
            if (modalLoading) modalLoading.style.display = 'none';
            resetSelezione();
            alert(err.error || "Errore durante la prenotazione.");
        }
    } catch (error) {
        console.error("Errore di rete nell'invio:", error);
        if (modalLoading) modalLoading.style.display = 'none';
        alert("Errore di connessione durante l'invio dei dati.");
    } planetary {
        loadingPrenotazione = false;
        if (btn) btn.disabled = false;
        if (modalLoading) modalLoading.style.display = 'none';
    }
}

async function mostraMie() {
    show('view-my-list');
    const res = await fetch(`/api/mie-prenotazioni/${userPass}`);
    const dati = await res.json();

    const statoColore = { 'PRENOTATO': '#1e40af', 'ENTRATO': '#15803d', 'USCITO': '#b45309', 'SCADUTO': '#ef4444' };
    const statoEmoji = { 'PRENOTATO': '📅', 'ENTRATO': '🚗', 'USCITO': '✅', 'SCADUTO': '⏰' };
    const cancellabile = (p) => p.stato === 'PRENOTATO' && !p.orario_ingresso;

    document.getElementById('my-list-content').innerHTML = dati.map(p => {
        const colore = statoColore[p.stato] || '#64748b';
        const emoji = statoEmoji[p.stato] || '📅';
        const isStorico = p.stato === 'USCITO' || p.stato === 'SCADUTO';

        const cestino = cancellabile(p) ? 
            `<div class="btn-delete" data-id="${p.id}" style="color:red; cursor:pointer; font-size:20px; transition:0.2s;">🗑️</div>` : 
            `<div style="font-size:18px; color:#cbd5e1;" title="Prenotazione non eliminabile">🔒</div>`;

        const giorni = Math.ceil((new Date(p.data_fine) - new Date(p.data_inizio)) / (1000 * 60 * 60 * 24)) + 1;

        return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:${isStorico ? '#f8fafc' : 'white'}; border-radius:12px; margin-bottom:8px; border:1px solid ${isStorico ? '#e2e8f0' : '#bfdbfe'}; opacity:${isStorico ? '0.75' : '1'};">
            <div>
                <div style="font-size:13px;">${emoji} Dal ${fmtData(p.data_inizio)} al ${fmtData(p.data_fine)}</div>
                <div style="display:flex; gap:12px; margin-top:4px; font-size:11px; align-items:center; flex-wrap:wrap;">
                    <span style="font-weight:bold; color:${colore};">Stato: ${p.stato}</span>
                    <span style="color:#64748b;">Totale giorni: ${giorni}</span>
                </div>
            </div>
            ${cestino}
        </div>`;
    }).join('') || `<p style="color:#64748b; text-align:center;">Nessuna prenotazione.</p>`;

    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => { eliminaPren(btn.dataset.id); });
    });
}

async function eliminaPren(id) {
    if (!confirm("Eliminare questa prenotazione?")) return;
    const res = await fetch('/api/elimina-prenotazione', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, npass: userPass }) });
    if (res.ok) { mostraMie(); } else { const err = await res.json(); alert(err.error || "Errore durante la cancellazione."); }
}

async function cercaPass(passManuale = null, idRecord = null) {
    const input = document.getElementById('search-p');
    document.getElementById('box-verifica')?.classList.add('hidden');
    if (!input) return;

    const p = (passManuale || input.value).trim().toUpperCase();
    input.value = p;
    if (!p) return;

    try {
        let url = `/api/piantone/cerca/${encodeURIComponent(p)}?auth=${userPass}`;
        if (idRecord) url += `&id=${idRecord}`;

        const res = await fetch(url);
        const data = await res.json();

        const btnIngresso = document.getElementById('btn-ingresso');
        const btnUscita = document.getElementById('btn-uscita');
        const boxVerifica = document.getElementById('box-verifica');

        btnIngresso.style.display = 'inline-block';
        btnUscita.style.display = 'inline-block';
        btnIngresso.disabled = true;
        btnUscita.disabled = true;
        btnIngresso.innerText = 'ENTRATA';
        btnUscita.innerText = 'USCITA';
        btnIngresso.style.background = '';
        btnUscita.style.background = '';

        if (boxVerifica) boxVerifica.classList.add('hidden');

        if (data.trovato) {
            currentPren = data.prenotazione;
            if (!currentPren) { alert("Prenotazione non trovata"); return; }
            
            const oggiStr = new Date().toISOString().split('T')[0];
            const dataInizioStr = currentPren.data_inizio.split('T')[0];

            if (oggiStr < dataInizioStr) {
                btnIngresso.disabled = true;
                btnIngresso.innerText = 'PRENOTAZIONE FUTURA';
                btnIngresso.style.background = '#94a3b8'; 
                document.getElementById('reg-e').innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Non è possibile registrare l'ingresso prima del ${fmtData(currentPren.data_inizio)}</span>`;
            } else if (currentPren.stato === 'PRENOTATO') {
                btnIngresso.disabled = false;
            } else if (currentPren.stato === 'ENTRATO') {
                btnUscita.disabled = false;
            } else if (currentPren.stato === 'DA_VERIFICARE') {
                btnIngresso.style.display = 'inline-block'; btnIngresso.disabled = true;
                btnUscita.disabled = false; btnUscita.style.display = 'inline-block'; btnUscita.style.background = '#ea580c'; btnUscita.innerText = 'VERIFICA';
                boxVerifica.classList.add('hidden');
            } else if (currentPren.stato === 'SCADUTO') {
                if (!currentPren.orario_ingresso) {
                    btnIngresso.disabled = true; btnIngresso.innerText = 'PRENOTAZIONE SCADUTA'; btnIngresso.style.background = '#64748b'; 
                    btnUscita.style.display = 'none'; 
                    document.getElementById('reg-e').innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Termine d'ingresso superato. Posto liberato.</span>`;
                } else {
                    btnIngresso.disabled = true; btnIngresso.style.display = 'none';
                    btnUscita.disabled = false; btnUscita.style.display = 'inline-block'; btnUscita.style.background = '#ef4444'; btnUscita.innerText = 'USCITA (SCADUTO)';
                }
            } else if (currentPren.stato === 'USCITO') {
                btnIngresso.disabled = true; btnUscita.disabled = true; btnUscita.innerText = 'GIÀ USCITO'; btnUscita.style.background = '#64748b';
            }

            document.getElementById('panel-piantone').classList.remove('hidden');
            document.getElementById('lab-pass').style.textAlign = 'center';
            document.getElementById('lab-pass').innerHTML = `
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 2px;">PASS: ${currentPren.npass}</div>
                <div style="font-size: 13px; color: #64748b; margin-bottom: 2px; font-weight: normal;">(Prenotazione: ${currentPren.id})</div>
            `;

            document.getElementById('lab-periodo').style.textAlign = 'center';
            document.getElementById('lab-periodo').innerHTML = `
                <div style="font-size: 13px; color: #64748b; font-weight: normal; margin-bottom: 6px;">(Periodo: ${fmtData(currentPren.data_inizio)} - ${fmtData(currentPren.data_fine)})</div>
            `;
        
            if (oggiStr >= dataInizioStr && currentPren.stato !== 'SCADUTO') {
                document.getElementById('reg-e').style.textAlign = 'center';
                document.getElementById('reg-e').innerHTML = currentPren.orario_ingresso ? 
                    `<div style="font-size: 15px; font-weight: bold; color: #1e293b; margin-top: 4px;">Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</div>` : 
                    `<div style="font-size: 14px; color: #64748b;">Nessun ingresso registrato</div>`;
            }

            if (currentPren.stato !== 'SCADUTO') {
                document.getElementById('reg-u').style.textAlign = 'center';
                document.getElementById('reg-u').innerHTML = currentPren.orario_uscita ? 
                    `<div style="font-size: 15px; font-weight: bold; color: #1e293b; margin-top: 4px;">Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</div>` : "";
            }

            const bannerCerca = document.getElementById('stato-tabella'); 
            const tabellaCorpo = document.getElementById('lista-veicoli');
            const isScadutoCorrente = (currentPren.stato === 'SCADUTO');
            const isDaVerificareCorrente = (currentPren.stato === 'DA_VERIFICARE');

            if (bannerCerca) {
                if (isScadutoCorrente) {
                    bannerCerca.style.background = '#ffeeef'; bannerCerca.style.color = '#ef4444'; bannerCerca.style.borderColor = '#fca5a5'; bannerCerca.innerHTML = `⏰ SCADUTO (Trovato da Ricerca)`;
                } else if (isDaVerificareCorrente) {
                    bannerCerca.style.background = '#ffedd5'; bannerCerca.style.color = '#ea580c'; bannerCerca.style.borderColor = '#fdba74'; bannerCerca.innerHTML = `🚨 DA VERIFICARE (Trovato da Ricerca)`;
                } else {
                    bannerCerca.style.background = '#eff6ff'; bannerCerca.style.color = '#3b82f6'; bannerCerca.style.borderColor = '#93c5fd'; bannerCerca.innerHTML = `📋 ATTIVO (Trovato da Ricerca)`;
                }
            }

            if (data.storico && tabellaCorpo) {
                let righeDaMostrare = [];
                if (isScadutoCorrente) { righeDaMostrare = data.storico.filter(x => ['PRENOTATO', 'ENTRATO', 'DA_VERIFICARE'].includes(x.stato)); } 
                else if (isDaVerificareCorrente) { righeDaMostrare = data.storico.filter(x => x.stato !== 'DA_VERIFICARE'); } 
                else { righeDaMostrare = data.storico.filter(x => x.stato === 'SCADUTO'); }
                
                if (typeof renderTabella === "function") { renderTabella(righeDaMostrare); } 
                else if (typeof generaRigaTabella === "function") { tabellaCorpo.innerHTML = righeDaMostrare.map(x => generaRigaTabella(x)).join(''); }
            }
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
    const prenotatoOggi = x.stato === 'PRENOTATO' && oggi >= x.data_inizio && oggi <= x.data_fine;
    const entrato = x.stato === 'ENTRATO';
    const uscito = x.stato === 'USCITO';
    const scaduto = (x.stato === 'SCADUTO');
    const storico = x.stato === 'USCITO' || x.stato === 'ARCHIVIATO';
    const daVerificare = x.stato === 'DA_VERIFICARE' || (x.stato === 'PRENOTATO' && oggi > x.data_fine && x.orario_ingresso && !x.orario_uscita);

    return { prenotatoOggi, entrato, uscito, scaduto, storico, daVerificare };
}

async function aggiornaPostiLiberiPiantone() {
    const res = await fetch(`/api/piantone/liberi`);
    const dati = await res.json();
    const display = document.getElementById('total-free-display');
    if (display) {
        display.innerHTML = `
            <b style="color:#16a34a; font-size: 16px;">Liberi: ${dati.totaleLiberi}</b> &nbsp;|&nbsp; 
            <b style="color:#ea580c; font-size: 16px;">Dentro: ${dati.dentro}</b>
            ${dati.listaV1p > 0 ? `&nbsp;|&nbsp; <b style="color:#2563eb; font-size: 16px;">Lista: ${dati.listaV1p}</b>` : ''}
        `;
    }
}

async function aggiornaVeicoli() {
    if (typeof userPass === 'undefined' || !userPass || userPass.trim() === "") return;

    try {
        const res = await fetch(`/api/veicoli-dentro?npass=${userPass}`);
        if (!res.ok) return;

        const dati = await res.json();
        if (!Array.isArray(dati)) return;
        
        const oraSolareOggi = new Date();
        oraSolareOggi.setHours(0, 0, 0, 0);
        const oggiTime = oraSolareOggi.getTime();
        const oggiString = oraSolareOggi.toISOString().split('T')[0];
        const inputSearch = document.getElementById('search-p');

        let countDentro = 0; let countListaV1p = 0;
        let countEntratiOggi = 0; let countPrenotatiOggi = 0;
        let countVerificare = 0; let countScaduti = 0; 
        
        dati.forEach(x => {
            const passCorrente = (x.npass || '').toUpperCase().trim();
            const dataInizioData = x.data_inizio ? new Date(x.data_inizio) : null;
            if (dataInizioData) dataInizioData.setHours(0,0,0,0);
            const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;

            const dataFineData = x.data_fine ? new Date(x.data_fine) : null;
            if (dataFineData) dataFineData.setHours(0,0,0,0);
            const fineTime = dataFineData ? dataFineData.getTime() : 0;
            const dataIngressoString = x.orario_ingresso ? x.orario_ingresso.substring(0, 10) : '';

            if (x.orario_ingresso && !x.orario_uscita) {
                if (passCorrente.startsWith('V1P')) { countListaV1p++; } else { countDentro++; }
            }

            if (x.orario_ingresso && dataIngressoString === oggiString) countEntratiOggi++;
            if (x.stato === 'PRENOTATO' && inizioTime === oggiTime) countPrenotatiOggi++;
            
            const f = getFlags(x);
            if (f.daVerificare) countVerificare++;
            
            const èScadutoNelPeriodo = (x.stato === 'SCADUTO' || (oggiTime > inizioTime && oggiTime <= fineTime)) && !x.orario_ingresso;
            if (èScadutoNelPeriodo) countScaduti++;
        });
        
        totaleScaduti = countScaduti;
        totaleVerificare = countVerificare;
        const postiLiberi = 90 - countDentro; 

        let stringaColorata = `<span style="color:#16a34a; font-weight:bold;">Liberi: ${postiLiberi}</span> &nbsp;|&nbsp; <span style="color:#ea580c; font-weight:bold;">Dentro: ${countDentro}</span>`;
        if (countListaV1p > 0) stringaColorata += ` &nbsp;|&nbsp; <span style="color:#2563eb; font-weight:bold;">Lista: ${countListaV1p}</span>`;

        const displaySotto = document.getElementById('total-free-display');
        const cardSbarraAlto = document.getElementById('card-sbarra-alto') || document.getElementById('status-parcheggio');
        
        if (displaySotto) { displaySotto.innerHTML = stringaColorata; } 
        else if (cardSbarraAlto) { cardSbarraAlto.innerHTML = stringaColorata; }

        const stringaSbarraCentro = document.getElementById('testo-sbarra-centro');
        if (stringaSbarraCentro) {
            let testoCentro = `🚧 CONTROLLO SBARRA | 🅿️ Liberi: ${postiLiberi} | 🚘 Dentro: ${countDentro}`;
            if (countListaV1p > 0) testoCentro += ` | 🔹 Lista: ${countListaV1p}`;
            stringaSbarraCentro.innerHTML = testoCentro;
        }
        
        const badge = document.getElementById('badge-contatori');
        if (badge) {
            badge.innerHTML = `
            <div style="font-size: 13px; color: #475569; padding: 4px 0; font-weight: 500; text-align: center;">
                🚗 <b>Entrati:</b> <span style="color:#1e293b; font-weight:bold;">${countEntratiOggi}</span> &nbsp;|&nbsp;
                📅 <b>Prenotati:</b> <span style="color:#1e293b; font-weight:bold;">${countPrenotatiOggi}</span> &nbsp;|&nbsp;
                🚨 <b>Da verificare:</b> <span style="color:${countVerificare > 0 ? '#ea580c' : '#475569'}; font-weight:bold;">${countVerificare}</span> &nbsp;|&nbsp;
                ⏰ <b>Scaduti:</b> <span style="color:${countScaduti > 0 ? '#dc2626' : '#475569'}; font-weight:bold;">${countScaduti}</span>
            </div>`;
        }

        const elScaduti = document.getElementById('badge-scaduti');
        if (elScaduti && countScaduti > 0) elScaduti.style.color = '#ef4444';

        const valoreCercato = inputSearch?.value?.trim()?.toUpperCase() || "";
        const statoTabella = document.getElementById('stato-tabella');

        const lista = dati.filter(x => {
            if (valoreCercato !== "") return x.npass?.toUpperCase() === valoreCercato;
            const f = getFlags(x);
            const dataInizioData = x.data_inizio ? new Date(x.data_inizio) : null;
            if (dataInizioData) dataInizioData.setHours(0,0,0,0);
            const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;
            const dataFineData = x.data_fine ? new Date(x.data_fine) : null;
            if (dataFineData) dataFineData.setHours(0,0,0,0);
            const fineTime = dataFineData ? dataFineData.getTime() : 0;

            if (filtroPiantone === 'verificare') return f.daVerificare;
            if (filtroPiantone === 'scaduti') return (x.stato === 'SCADUTO' || (oggiTime > inizioTime && oggiTime <= fineTime)) && !x.orario_ingresso;
            if (filtroPiantone === 'attivi') {
                if (f.daVerificare) return false;
                if (x.orario_ingresso && !x.orario_uscita) return true;
                return (x.stato === 'PRENOTATO' && inizioTime === oggiTime && !x.orario_ingresso);
            }
            if (filtroPiantone === 'storico') return x.stato === 'USCITO';
            return true;
        })
        .sort((a, b) => {
            if (valoreCercato !== "") {
                const getPriorita = (item) => {
                    const f = getFlags(item);
                    const dataInizioData = item.data_inizio ? new Date(item.data_inizio) : null;
                    if (dataInizioData) dataInizioData.setHours(0,0,0,0);
                    const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;
                    if (f.daVerificare) return 1; 
                    if (f.entrato || (item.stato === 'PRENOTATO' && inizioTime === oggiTime)) return 2; 
                    if (f.scaduto) return 3;                
                    if (f.storico) return 4;                    
                    return 5;
                };
                const pesoA = getPriorita(a); const pesoB = getPriorita(b);
                if (pesoA !== pesoB) return pesoA - pesoB;
                return (b.id || 0) - (a.id || 0);
            } 
            if (filtroPiantone === 'attivi') {
                return (b.orario_ingresso ? new Date(b.orario_ingresso).getTime() : 0) - (a.orario_ingresso ? new Date(a.orario_ingresso).getTime() : 0);
            }
            if (filtroPiantone === 'verificare') {
                return (a.orario_ingresso ? new Date(a.orario_ingresso) : new Date(0)) - (b.orario_ingresso ? new Date(b.orario_ingresso) : new Date(0));
            }
            if (filtroPiantone === 'storico') {
                return (b.orario_ingresso ? new Date(b.orario_ingresso) : new Date(0)) - (a.orario_ingresso ? new Date(a.orario_ingresso) : new Date(0));
            }
            return (a.npass || "").localeCompare(b.npass || "", undefined, { numeric: true, sensitivity: 'base' });
        });

        if (valoreCercato !== "" && lista.length > 0) {
            let label = ""; let colore = "#334155"; let sfondo = "#f8fafc";
            const veicoloTrovato = lista[0]; const f = getFlags(veicoloTrovato);
            const dataInizioData = veicoloTrovato.data_inizio ? new Date(veicoloTrovato.data_inizio) : null;
            if (dataInizioData) dataInizioData.setHours(0,0,0,0);
            const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;
            
            if (f.daVerificare) { label = "🚨 DA VERIFICARE (Trovato da Ricerca)"; colore = "#ea580c"; sfondo = "#ffedd5"; } 
            else if (f.entrato || (veicoloTrovato.stato === 'PRENOTATO' && inizioTime === oggiTime)) { label = "📋 ATTIVO (Trovato da Ricerca)"; colore = "#2563eb"; sfondo = "#dbeafe"; } 
            else if (f.scaduto) { label = "⏰ SCADUTO (Trovato da Ricerca)"; colore = "#dc2626"; sfondo = "#fee2e2"; } 
            else if (f.storico) { label = "🕘 STORICO (Trovato da Ricerca)"; colore = "#475569"; sfondo = "#e2e8f0"; }
            
            if (statoTabella) {
                statoTabella.style.color = colore; statoTabella.style.background = sfondo;
                statoTabella.style.borderColor = colore; statoTabella.innerHTML = label;
            }
        }
            
        document.getElementById('lista-veicoli').innerHTML = lista.map(x => {
            const ing = x.orario_ingresso ? new Date(x.orario_ingresso) : null;
            const usc = x.orario_uscita ? new Date(x.orario_uscita) : null;
            const dataIng = ing ? ing.toLocaleDateString('it-IT') : '--';
            const oraIng = ing ? ing.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
            const dataUsc = usc ? usc.toLocaleDateString('it-IT') : '--';
            const oraUsc = usc ? usc.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
            const evidenzia = x.npass === ultimoAggiornato; const f = getFlags(x);
            
            const wPass = 'width: 16%;'; const wDataIng = 'width: 26%;'; const wOraIng = 'width: 15%;'; const wDataUsc = 'width: 28%;'; const wOraUsc = 'width: 15%;';
            const baseStyle = 'padding: 8px 6px; text-align: left; vertical-align: middle; box-sizing: border-box;';
        
            return `<tr style="border-bottom: 1px solid #f1f5f9; ${f.scaduto ? 'background:#fee2e2; color:#991b1b;' : ''} ${f.storico ? 'background:#f1f5f9;' : ''} ${evidenzia ? 'background:#d1fae5; font-weight:bold;' : ''} ${f.daVerificare ? 'background:#fff7ed; color:#c2410c; font-weight:bold;' : ''}">
                <td style="${baseStyle} ${wPass}">
                    <button class="btn-pass" data-pass="${x.npass}" data-id="${x.id}" type="button" style="border:none; background:none; color:#2563eb; font-weight:bold; cursor:pointer; text-decoration:underline; padding:0; margin:0; font-size:14px;">${x.npass}</button>
                </td>
                <td style="${baseStyle} ${wDataIng}">${f.scaduto ? 'NON ENTRATO' : dataIng}</td>
                <td style="${baseStyle} ${wOraIng} font-weight:bold;">${f.scaduto ? '' : oraIng}</td>
                <td style="${baseStyle} ${wDataUsc}">${dataUsc}</td>
                <td style="${baseStyle} ${wOraUsc} font-weight:bold;">${oraUsc}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" style="text-align:center; color:black; padding:16px;">Nessun veicolo presente</td></tr>`;
        
        document.querySelectorAll('.btn-pass').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pass = btn.dataset.pass; const idRecord = btn.dataset.id; 
                if (inputSearch) inputSearch.value = pass;
                await cercaPass(pass, idRecord);
                setTimeout(() => { document.getElementById('panel-piantone')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
            });
        });

        const btnFiltro = document.getElementById('btn-filtro');
        if (btnFiltro) btnFiltro.innerText = "MOSTRA STATI";
    } catch (err) {
        console.error("💥 Errore critico durante l'aggiornamento dei veicoli:", err);
    }
}

let loadingAzione = false;

async function mossa(tipo) {
    const btnIngresso = document.getElementById('btn-ingresso');
    const btnUscita = document.getElementById('btn-uscita');
    const boxVerifica = document.getElementById('box-verifica');
    if (loadingAzione) return;

    if (tipo === 'U' && currentPren?.stato === 'DA_VERIFICARE') {
        btnUscita.style.display = 'none';
        boxVerifica?.classList.remove('hidden');
        return;
    }

    let azione = tipo === 'E' ? 'ingresso' : 'uscita';
    if (tipo === 'U' && currentPren?.stato !== 'DA_VERIFICARE' && (currentPren?.stato === 'PRENOTATO' || !currentPren?.orario_ingresso)) {
        alert('Auto ancora non entrata');
        return;
    }

    btnIngresso.disabled = true; btnUscita.disabled = true;
    loadingAzione = true;

    try {
        const res = await fetch('/api/piantone/azione', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentPren.id, azione, npass: userPass })
        });
        const data = await res.json();
        if (!data.success) { alert(data.error || 'Errore operatione'); return; }

        if (tipo === 'E') { beepIngresso.play(); } else { beepUscita.play(); }
        ultimoAggiornato = currentPren.npass;
        await aggiornaVeicoli();

        if (tipo === 'U') {
            document.getElementById('panel-piantone').classList.add('hidden');
            document.getElementById('search-p').value = '';
            currentPren = null;
            boxVerifica?.classList.add('hidden');
        } else {
            await cercaPass(currentPren.npass, currentPren.id);
        }
    } catch (err) {
        console.error(err);
        alert('Errore rete/server');
    } finally {
        loadingAzione = false; btnIngresso.disabled = false; btnUscita.disabled = false;
    }
}

async function mostraRitardi() {
    const res = await fetch('/api/admin/ritardi');
    const dati = await res.json();
    alert(dati.map(x => `${x.npass} → ritardo ${x.giorni_ritardo} giorni`).join('\n') || "Nessun ritardo");
}

async function mostraAdmin() {
    const res = await fetch(`/api/admin/cruscotto?npass=${userPass}`);
    const dati = await res.json();
    if (!dati?.length) return;

    const enti = Object.keys(dati[0].enti || {}).sort();
    let header = `<tr><th>Data</th><th style="color:var(--blue);">TOT LIBERI</th>`;
    enti.forEach(e => header += `<th>${e}</th>`);
    header += `</tr>`;

    const rows = dati.map(x => {
        let row = `<tr><td>${fmtData(x.data)}</td><td style="font-weight:bold; color:var(--green);">${x.totaleLiberi}/90</td>`;
        enti.forEach(ente => {
            const info = x.enti[ente] || { liberi: 0, totale: 0 };
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
        return `<div style="padding:6px; border-bottom:1px solid #ddd;">🚗 <b>${x.npass}</b> - IN: ${x.orario_ingresso ? new Date(x.orario_ingresso).toLocaleString('it-IT') : '--'} OUT: ${x.orario_uscita ? new Date(x.orario_uscita).toLocaleString('it-IT') : '--'}</div>`;
    }).join('');
}

let arriviVisible = false;

async function mostraArriviOggi() {
    if (typeof arriviVisible === 'undefined') { window.arriviVisible = false; } else { window.arriviVisible = arriviVisible; }
    const box = document.getElementById('box-arrivi-oggi');
    const btn = document.getElementById('btn-arrivi-oggi');
    const lista = document.getElementById('lista-arrivi-oggi');
    if (!box || !lista) return;

    if (window.arriviVisible) {
        box.classList.add('hidden'); window.arriviVisible = false;
        if (typeof arriviVisible !== 'undefined') arriviVisible = false;
        btn.innerText = '📋 Arrivi di Oggi'; return;
    }

    try {
        const res = await fetch('/api/piantone/arrivi-oggi');
        if (!res.ok) throw new Error(`Risposta server KO: ${res.status}`);
        const dati = await res.json();
        lista.innerHTML = '';

        if (!dati || dati.length === 0) {
            lista.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:16px; color:var(--gray);">Nessun arrivo previsto oggi</td></tr>`;
        } else {
            let htmlRighe = '';
            const cellStylePass = 'style="width: 34%; padding: 10px 6px; text-align: left; vertical-align: middle;"';
            const cellStyleDal = 'style="width: 33%; padding: 10px 6px; text-align: left; vertical-align: middle; color: #475569; font-weight: 500;"';
            const cellStyleAl = 'style="width: 33%; padding: 10px 6px; text-align: left; vertical-align: middle; color: #475569; font-weight: 500;"';

            dati.forEach(r => {
                const dInizio = r.data_inizio ? new Date(r.data_inizio) : null;
                const dataInizioStr = (dInizio && !isNaN(dInizio.getTime())) ? dInizio.toLocaleDateString('it-IT') : '--';
                const campoFine = r.data_fine || r.fine || r.scadenza || r.data_scadenza;
                const dFine = campoFine ? new Date(campoFine) : null;
                const dataFineStr = (dFine && !isNaN(dFine.getTime())) ? dFine.toLocaleDateString('it-IT') : '--';

                htmlRighe += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td ${cellStylePass}>
                        <button class="btn-pass-diretto" data-pass="${r.npass}" data-id="${r.id || ''}" type="button" style="border:none; background:none; color:var(--blue); font-weight:bold; cursor:pointer; text-decoration:underline; font-size:14px; padding:0; margin:0; display:inline-block; text-align:left;">${r.npass}</button>
                    </td>
                    <td ${cellStyleDal}>${dataInizioStr}</td>
                    <td ${cellStyleAl}>${dataFineStr}</td>
                </tr>`;
            });
            lista.innerHTML = htmlRighe;

            document.querySelectorAll('.btn-pass-diretto').forEach(b => {
                b.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const passClick = b.getAttribute('data-pass'); const idClick = b.getAttribute('data-id');
                    const inputSearch = document.getElementById('search-p');
                    if (inputSearch) inputSearch.value = passClick;
                    await cercaPass(passClick, idClick);
                    document.getElementById('panel-piantone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        }
        box.classList.remove('hidden'); window.arriviVisible = true;
        if (typeof arriviVisible !== 'undefined') arriviVisible = true;
        btn.innerText = '❌ Nascondi Arrivi di Oggi';
    } catch (err) {
        console.error("Errore Arrivi:", err);
        alert('Errore caricamento arrivi');
    }
}
