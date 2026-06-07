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
// ============================================================
// 🏁 BLOCCO DI AVVIO UNICO AL CARICAMENTO DELLA PAGINA
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // 1. Esegui subito i calcoli grafici delle date e dei massimali
    inizializzaFinestraDate();
    aggiornaTestoFinestra();
    
    // 2. Genera la griglia del calendario
    if (typeof buildCal === "function") {
        buildCal();
    }

    // 3. Controllo se l'utente arriva dal QR code con mode=install
    if (urlParams.get('mode') === 'install') {
        setTimeout(() => {
            const btn = document.getElementById('btnInstalla');
            if (btn) {
                btn.style.border = "4px solid #3b82f6"; // Evidenzia il tasto
                alert("Benvenuto! Clicca sul tasto bianco e blu 'INSTALLA APP' per averla sempre sul telefono.");
            }
        }, 1500);
    }
});
    // ============================================================
    // 🎯 GESTIONE DINAMICA CAMBIO PROFILO (NUOVI LIMITI 45/30/15 GG)
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

        // 🔄 AGGIORNA IL TESTO DELLE DATE E RIGENERA LA GRIGLIA
        aggiornaTestoFinestra();
        buildCal();
        if (typeof aggiornaRiepilogoGiorni === 'function') aggiornaRiepilogoGiorni();
    });
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

    // 🎨 Aggiorna subito il testo e il colore del badge in base al nuovo filtro
    aggiornaGraficaBadge();

    // Ricarica la lista veicoli in base al nuovo filtro
    aggiornaVeicoli();
}

// Function creata per allineare al volo la grafica del badge (usata sia al click che all'avvio)
function aggiornaGraficaBadge() {
    const statoTabella = document.getElementById('stato-tabella');
    if (!statoTabella) return;

    // 1. Reset: rimuoviamo sempre l'animazione all'inizio
    statoTabella.classList.remove('badge-blink');
    statoTabella.classList.remove('badge-blink-2');
    
    // 🎯 FIX SPAZIATURA: Allineato al nuovo contenitore HTML centrato
    statoTabella.style.display = "inline-block"; 
    statoTabella.style.marginBottom = "0px"; 
    statoTabella.style.marginTop = "0px"; 
    statoTabella.style.padding = "8px 20px";
    statoTabella.style.borderRadius = "8px";
    statoTabella.style.borderWidth = "1px";
    statoTabella.style.borderStyle = "solid";
    statoTabella.style.textAlign = "center";
    statoTabella.style.fontWeight = "bold";
    
    // 2. Logica dei colori e testi
    if (filtroPiantone === 'verificare') {
        statoTabella.innerHTML = "🚨 DA VERIFICARE";
        statoTabella.style.color = "#ea580c";
        statoTabella.style.background = "#ffedd5";
        statoTabella.style.borderColor = "#ea580c";
        
        // Blink attivo solo per le criticità
       //  if (totaleVerificare > 0) {
       //     statoTabella.classList.add('badge-blink');
       //  }
    }
    else if (filtroPiantone === 'scaduti') {
        statoTabella.innerHTML = "⏰ SCADUTI";
        statoTabella.style.color = "#dc2626";
        statoTabella.style.background = "#fee2e2";
        statoTabella.style.borderColor = "#dc2626";
        
        // Blink attivo solo per le criticità
        // if (totaleScaduti > 0) {
        //    statoTabella.classList.add('badge-blink-2');
        // }
    }
    else if (filtroPiantone === 'attivi') {
        statoTabella.innerHTML = "📋 ATTIVI";
        statoTabella.style.color = "#2563eb";
        statoTabella.style.background = "#dbeafe";
        statoTabella.style.borderColor = "#2563eb";
        // NESSUN BLINK QUI
    }
    else if (filtroPiantone === 'tutti') {
        statoTabella.innerHTML = "📑 TUTTI";
        statoTabella.style.color = "#7c3aed";
        statoTabella.style.background = "#ede9fe";
        statoTabella.style.borderColor = "#7c3aed";
        // NESSUN BLINK QUI
    }
    else {
        statoTabella.innerHTML = "🕘 STORICO";
        statoTabella.style.color = "#475569";
        statoTabella.style.background = "#e2e8f0";
        statoTabella.style.borderColor = "#475569";
        // NESSUN BLINK QUI
    }
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
        
        // ============================================================
        // 🚨 GESTIONE DEI RUOLI CON ALLINEAMENTO DINAMICO DEI FILTRI
        // ============================================================
        if (data.ruolo === 'piantone') {
            show('view-piantone');
            
            try {
                // A. Scarichiamo i dati per popolare le variabili globali (totaleVerificare, ecc.)
                await aggiornaVeicoli();
                
                // B. Decidiamo lo stato di partenza in base alla situazione reale del parcheggio
                if (typeof totaleVerificare !== 'undefined' && totaleVerificare > 0) {
                    filtroPiantone = 'verificare';
                } else if (typeof totaleScaduti !== 'undefined' && totaleScaduti > 0) {
                    filtroPiantone = 'scaduti';
                } else {
                    filtroPiantone = 'attivi';
                }

                // C. Forziamo la UI a scriversi e colorarsi correttamente tramite la nuova funzione
                if (typeof aggiornaGraficaBadge === 'function') {
                    aggiornaGraficaBadge();
                }

                // D. Secondo refresh per disegnare la tabella filtrata e sincronizzata
                await aggiornaVeicoli();
            } catch(e) { 
                console.log("Errore inizializzazione dati piantone:", e); 
            }
            
            try { aggiornaPostiLiberiPiantone(); } catch(e){ console.log(e); }
        }
        else if (data.ruolo === 'admin') { 
            if (card) {
                card.classList.add('admin-wide');
            }
            show('view-admin'); 
            
            // Applichiamo la stessa logica di allineamento anche se l'admin guarda la visuale piantone
            try {
                await aggiornaVeicoli();
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
                await aggiornaVeicoli();
            } catch(e) {
                console.log(e);
            }

            try { mostraAdmin(); } catch(e){ console.log(e); }
        }
        else {
            show('view-user');
            try { buildCal(); aggiornaTestoFinestra(); } catch(e){ console.log(e); }
        }

    } catch (err) {
        console.error("ERRORE LOGIN:", err);
        alert("Errore login");
    }
}

// ============================================================
// 🗓️ FUNZIONE PER AGGIORNARE IL TESTO DELLE DATE DINAMICHE (45 GG)
// ============================================================
function aggiornaTestoFinestra() {
    const el = document.getElementById('testo-limite-giorni');
    if (!el) return;

    const selectProfilo = document.getElementById('select-profilo');
    const profilo = selectProfilo ? selectProfilo.value : 'STD';

    // Determina il Max in base al profilo
    let maxGg = 15;
    if (profilo === 'MIS') maxGg = 45;
    if (profilo === 'TRN') maxGg = 30;

    // Calcolo range date (Finestra fissa a 45 giorni totali)
    const oggi = new Date();
    const fineFinestra = new Date();
    fineFinestra.setDate(oggi.getDate() + 44); // +44 per includere oggi nel conteggio dei 45gg totali (Es. dal 05/06 al 19/07)

    // Formato giorno/mese a due cifre (es. 05/06)
    const dInizio = String(oggi.getDate()).padStart(2, '0');
    const mInizio = String(oggi.getMonth() + 1).padStart(2, '0');
    
    const dFine = String(fineFinestra.getDate()).padStart(2, '0');
    const mFine = String(fineFinestra.getMonth() + 1).padStart(2, '0');

    const strInizio = `${dInizio}/${mInizio}`;
    const strFine = `${dFine}/${mFine}`;

    // Genera la stringa completa unificata dentro l'elemento
    el.innerHTML = `Seleziona i giorni (Min 2 | <b>Max ${maxGg}</b>) dal <span style="font-weight: bold; color: #2563eb;">${strInizio}</span> al <span style="font-weight: bold; color: #2563eb;">${strFine}</span>`;
}

function buildCal() {
    const box = document.getElementById('cal-grid');
    if (!box) return;
    box.innerHTML = '';

    // Mostriamo SEMPRE l'intera griglia panoramica fissa di 45 giorni consecutivi
    const maxGiorniDaMostrare = 45;
    const oggi = new Date();

    // Genera tutti i quadratini consecutivi per i prossimi 45 giorni
    for (let i = 0; i < maxGiorniDaMostrare; i++) {
        const d = new Date(oggi);
        d.setDate(oggi.getDate() + i);

        const isoStr = d.toISOString().split('T')[0];

        const div = document.createElement('div');
        div.className = 'day-slot'; // <--- Assicurati che usi questa classe coordinata con il CSS sopra
        div.textContent = d.getDate();
        div.setAttribute('data-date', isoStr);

        // Se il giorno è già stato selezionato, mantiene la classe attiva
        if (selectedDays.includes(isoStr)) {
            div.classList.add('selected');
        }

        div.addEventListener('click', () => {
            if (div.classList.contains('selected')) {
                // Deselezione del giorno cliccato
                div.classList.remove('selected');
                selectedDays = selectedDays.filter(x => x !== isoStr);
            } else {
                // CONTROLLO DINAMICO DEL PROFILO E DEI NUOVI LIMITI PERSONALIZZATI
                const selectProfilo = document.getElementById('select-profilo');
                const profilo = selectProfilo ? selectProfilo.value : 'STD';
                
                // Imposta il tetto massimo specifico richiesto
                let limiteSelezionabili = 15; // Default Standard
                if (profilo === 'MIS') {
                    limiteSelezionabili = 45;
                } else if (profilo === 'TRN') {
                    limiteSelezionabili = 30;
                }

                if (selectedDays.length >= limiteSelezionabili) {
                    alert(`⚠️ Profilo ${profilo}: Puoi selezionare al massimo ${limiteSelezionabili} gg.!`);
                    return;
                }
                
                // Attiva visivamente il quadratino e inseriscilo nell'array
                div.classList.add('selected');
                selectedDays.push(isoStr);
            }
            if (typeof aggiornaRiepilogoGiorni === 'function') aggiornaRiepilogoGiorni();
        });

        box.appendChild(div);
    }
}

let loadingPrenotazione = false;

// ============================================================
// 🗓️ FUNZIONI DI CALCOLO DINAMICO (Definite prima dell'avvio)
// ============================================================
function inizializzaFinestraDate() {
 
    const oggi = new Date(); // Primo giorno disponibile
    const dataFineFinestra = new Date();
    dataFineFinestra.setDate(oggi.getDate() + 44); // Ultimo giorno disponibile (45gg)

    // Formattazione in GG/MM
    const opzioni = { day: '2-digit', month: '2-digit' };
    const strInizio = oggi.toLocaleDateString('it-IT', opzioni);
    const strFine = dataFineFinestra.toLocaleDateString('it-IT', opzioni);

    // Iniezione dinamica nei campi subito dopo il login
    const elInizio = document.getElementById('calendar-inizio');
    const elFine = document.getElementById('calendar-fine');

    if (elInizio) elInizio.innerText = strInizio;
    if (elFine) elFine.innerText = strFine;
}

async function inviaPren() {
    // Sicurezza secondaria per evitare doppi invii accidentali
    if (loadingPrenotazione) return;
    loadingPrenotazione = true;

    const btn = document.getElementById('btn-prenota');
    if (btn) btn.disabled = true;

    const modalLoading = document.getElementById('modal-loading');
    const email = document.getElementById('u-email').value.trim().toLowerCase();

    try {
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
            document.getElementById('summary-details').innerHTML =
                `<b>Pass:</b> ${userPass}<br><b>Dal:</b> ${fmtData(selectedDays[0])}<br><b>Al:</b> ${fmtData(selectedDays[selectedDays.length - 1])}`;
            
            // Spegne il caricamento prima di passare alla vista di successo
            if (modalLoading) modalLoading.style.display = 'none';
            
            show('view-success');
            
            setTimeout(() => {
                mostraMie();
            }, 5000);
        } else {
            // Gestisci gli errori di validazione provenienti dal server PostgreSQL/Node
            const err = await res.json();
            
            if (modalLoading) modalLoading.style.display = 'none';
            resetSelezione();
            alert(err.error || "Errore durante la prenotazione.");
        }
    } catch (error) {
        console.error("Errore di rete nell'invio:", error);
        if (modalLoading) modalLoading.style.display = 'none';
        alert("Errore di connessione durante l'invio dei dati.");
    } finally {
        loadingPrenotazione = false;
        if (btn) btn.disabled = false;
        // Chiusura di sicurezza del caricamento in ogni scenario rimasto scoperto
        if (modalLoading) modalLoading.style.display = 'none';
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
    
    // 🎯 RECUPERO ELEMENTI REALI
    const boxVerifica = document.getElementById('box-verifica');
    const regE = document.getElementById('reg-e');
    const regU = document.getElementById('reg-u');
    
    let boxVerificaScaduti = document.getElementById('box-verifica-scaduti');
    
    // PULIZIA INIZIALE AD OGNI RICERCA (Nascondiamo tutto all'inizio)
    if (boxVerifica) {
        boxVerifica.classList.add('hidden');
        boxVerifica.style.display = ''; // Resetta lo stile flex
        boxVerifica.innerHTML = `
            <button id="btn-presente" type="button" style="width: auto; padding:6px 10px; font-size:12px; border:none; border-radius:8px; background:#16a34a; color:white; margin:0; font-weight:bold;">
                ✅ PRESENTE
            </button>
            <button id="btn-non-presente" type="button" style="width: auto; padding:6px 10px; font-size:12px; border:none; border-radius:8px; background:#dc2626; color:white; margin:0; font-weight:bold;">
                ❌ NON PRESENTE
            </button>
        `;
    }
    if (boxVerificaScaduti) {
        boxVerificaScaduti.classList.add('hidden');
        boxVerificaScaduti.innerHTML = '';
    }
    if (regE) regE.innerHTML = '';
    if (regU) regU.innerHTML = '';

    if (!input) return;

    const p = (passManuale || input.value).trim().toUpperCase();
    input.value = p;
    
    if (!p) {
        document.getElementById('panel-piantone')?.classList.add('hidden');
        return;
    }

    try {
        let url = `/api/piantone/cerca/${encodeURIComponent(p)}?auth=${userPass}`;
        if (idRecord) url += `&id=${idRecord}`;

        const res = await fetch(url);
        const data = await res.json();

        const btnIngresso = document.getElementById('btn-ingresso');
        const btnUscita = document.getElementById('btn-uscita');

        // RESET BOTTONI STANDARD
        btnIngresso.style.display = 'inline-block';
        btnUscita.style.display = 'inline-block';
        btnIngresso.disabled = true;
        btnUscita.disabled = true;
        btnIngresso.innerText = 'ENTRATA';
        btnUscita.innerText = 'USCITA';
        btnIngresso.style.background = '';
        btnUscita.style.background = '';

        if (data.trovato) {
            currentPren = data.prenotazione;
            if (!currentPren) return alert("Prenotazione non trovata");
            
            const oggiStr = new Date().toISOString().split('T')[0];
            const dataInizioStr = currentPren.data_inizio.split('T')[0];
            const currentId = currentPren.id;

            // GENERATORE DINAMICO BOX SCADUTI SE ASSENTE
            if (!boxVerificaScaduti && boxVerifica) {
                boxVerificaScaduti = document.createElement('div');
                boxVerificaScaduti.id = 'box-verifica-scaduti';
                boxVerificaScaduti.classList.add('hidden');
                boxVerifica.parentNode.insertBefore(boxVerificaScaduti, boxVerifica.nextSibling);
            }

            // GESTIONE STATI
            if (oggiStr < dataInizioStr) {
                btnIngresso.disabled = true;
                btnIngresso.innerText = 'PRENOTAZIONE FUTURA';
                btnIngresso.style.background = '#94a3b8'; 
                if (regE) regE.innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Non prima del ${fmtData(currentPren.data_inizio)}</span>`;
            }
            else if (currentPren.stato === 'PRENOTATO') {
                btnIngresso.disabled = false;
            }
            else if (currentPren.stato === 'ENTRATO') {
                btnUscita.disabled = false;
            }
            
            // 🎯 STATO: DA VERIFICARE (Ottimizzato)
            else if (currentPren.stato === 'DA_VERIFICARE') {
                btnIngresso.style.display = 'inline-block';
                btnIngresso.disabled = true; // Bloccato, l'auto deve prima uscire o essere verificata
                
                btnUscita.disabled = false;
                btnUscita.style.display = 'inline-block';
                btnUscita.style.background = '#ea580c'; // Colore Arancione
                btnUscita.innerText = 'VERIFICA'; // Il tastone grande
            
                // Rimuoviamo l'ascolto precedente sul tastone per evitare duplicati
                const nuovoBtnUscita = btnUscita.cloneNode(true);
                btnUscita.parentNode.replaceChild(nuovoBtnUscita, btnUscita);
                
                // Quando si clicca sul tastone grande "VERIFICA"
                nuovoBtnUscita.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    if (boxVerifica) {
                        // Mostriamo i due pulsantini sotto solo adesso!
                        boxVerifica.style.display = 'flex';
                        boxVerifica.classList.remove('hidden');
                        
                        // Agganciamo i listener CSP sui pulsantini piccoli appena comparsi
                        document.getElementById('btn-presente')?.addEventListener('click', (ev) => { 
                            ev.preventDefault(); 
                            if (typeof window.azioneVerifica === 'function') window.azioneVerifica('si', currentId);
                        });
                        document.getElementById('btn-non-presente')?.addEventListener('click', (ev) => { 
                            ev.preventDefault(); 
                            if (typeof window.azioneVerifica === 'function') window.azioneVerifica('no', currentId);
                        });
                    }
                });
            }
            
            // MAI ENTRATO (ARCHIVIATO)
            else if (currentPren.stato === 'MAI_ENTRATO') {
                btnIngresso.style.display = 'none'; 
                btnUscita.style.display = 'none'; 

                if (boxVerificaScaduti) {
                    boxVerificaScaduti.innerHTML = `
                        <div style="background: #f8fafc; border: 1px solid #cbd5e1; color: #475569; border-radius: 12px; padding: 16px; text-align: center; margin-top: 15px; box-sizing: border-box; width: 100%;">
                            <span style="font-size: 22px;">📁</span>
                            <h4 style="margin: 6px 0 4px 0; font-size: 15px; font-weight: bold; color: #334155;">Prenotazione Scaduta: ARCHIVIATO</h4>
                            <p style="margin: 0; font-size: 13px; color: #64748b;">L'auto non si è presentata nei termini ed è nello storico.</p>
                        </div>
                    `;
                    boxVerificaScaduti.classList.remove('hidden');
                }
            }	
            // SCADUTO (Verifica Sanatoria - Pulsanti Grandi)
            else if (currentPren.stato === 'SCADUTO') {
                if (!currentPren.orario_ingresso) {
                    btnIngresso.style.display = 'none'; 
                    btnUscita.style.display = 'none'; 
                    
                    if (boxVerificaScaduti) {
                        boxVerificaScaduti.innerHTML = `
                            <div style="background: #fff5f5; border: 1px solid #feb2b2; border-radius: 12px; padding: 16px; text-align: center; margin-top: 15px; box-sizing: border-box; width: 100%;">
                                <h4 style="margin: 0 0 8px 0; font-size: 15px; font-weight: bold; color: #9b2c2c;">⚠️ Verifica Prenotazione Scaduta</h4>
                                <p style="margin: 0 0 12px 0; font-size: 13px; color: #9b2c2c;">L'auto è effettivamente presente nel parcheggio?</p>
                                <div style="display: flex; flex-direction: row; flex-wrap: nowrap; gap: 10px; justify-content: center; width: 100%; box-sizing: border-box;">
                                    <button id="btn-scaduto-dentro" type="button" style="flex: 1; background: #10b981; color: white; border: none; padding: 10px 4px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; min-width: 0; line-height: 1.3;">
                                        📩 SI - DENTRO<br><span style="font-size: 10px; font-weight: normal;">(Verificata Presenza)</span>
                                    </button>
                                    <button id="btn-scaduto-mai-entrato" type="button" style="flex: 1; background: #ef4444; color: white; border: none; padding: 10px 4px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; min-width: 0; line-height: 1.3;">
                                        ❌ MAI ENTRATO<br><span style="font-size: 10px; font-weight: normal;">(Annulla Prenotazione)</span>
                                    </button>
                                </div>
                            </div>
                        `;
                        boxVerificaScaduti.classList.remove('hidden');

                        document.getElementById('btn-scaduto-dentro')?.addEventListener('click', (e) => { e.preventDefault(); if (typeof window.eseguiScadutoDentro === 'function') window.eseguiScadutoDentro(); });
                        document.getElementById('btn-scaduto-mai-entrato')?.addEventListener('click', (e) => { e.preventDefault(); if (typeof window.eseguiScadutoMaiEntrato === 'function') window.eseguiScadutoMaiEntrato(); });
                    }
                } else {
                    btnIngresso.style.display = 'none';
                    btnUscita.disabled = false;
                    btnUscita.style.display = 'inline-block';
                    btnUscita.style.background = '#ef4444';
                    btnUscita.innerText = 'USCITA (SCADUTO)';
                }
            }
            else if (currentPren.stato === 'USCITO') {
                btnUscita.innerText = 'GIÀ USCITO';
                btnUscita.style.background = '#64748b';
            }

            // PANNELLO UI DETTAGLI
            document.getElementById('panel-piantone').classList.remove('hidden');
            document.getElementById('lab-pass').style.textAlign = 'center';
            document.getElementById('lab-pass').innerHTML = `
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 2px;">PASS: ${currentPren.npass}</div>
                <div style="font-size: 13px; color: #64748b; margin-bottom: 2px; font-weight: normal;">(Prenotazione: ${currentPren.id})</div>
            `;
            document.getElementById('lab-periodo').style.textAlign = 'center';
            document.getElementById('lab-periodo').innerHTML = `
                <div style="font-size: 13px; color: #64748b; font-weight: normal; margin-bottom: 6px;">
                    (Periodo: ${fmtData(currentPren.data_inizio)} - ${fmtData(currentPren.data_fine)})
                </div>
            `;
        
            if (oggiStr >= dataInizioStr && currentPren.stato !== 'SCADUTO' && currentPren.stato !== 'MAI_ENTRATO') {
                if (regE) regE.innerHTML = currentPren.orario_ingresso
                    ? `<div style="font-size: 14px; font-weight: bold; color: #1e293b; margin-top: 4px; text-align:center;">Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</div>`
                    : `<div style="font-size: 13px; color: #64748b; text-align:center;">Nessun ingresso registrato</div>`;
            }
            if (currentPren.stato !== 'SCADUTO' && currentPren.stato !== 'MAI_ENTRATO') {
                if (regU) regU.innerHTML = currentPren.orario_uscita
                    ? `<div style="font-size: 14px; font-weight: bold; color: #1e293b; margin-top: 4px; text-align:center;">Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</div>`
                    : "";
            }

            // GESTIONE BANNER STATO TABELLA SOTTOSTANTE
            const bannerCerca = document.getElementById('stato-tabella'); 
            const tabellaCorpo = document.getElementById('lista-veicoli');
            if (bannerCerca) {
                if (currentPren.stato === 'MAI_ENTRATO') {
                    bannerCerca.style.background = '#f1f5f9'; bannerCerca.style.color = '#475569'; bannerCerca.style.borderColor = '#cbd5e1'; bannerCerca.innerHTML = `📁 ARCHIVIATO (Trovato da Ricerca)`;
                } else if (currentPren.stato === 'SCADUTO') {
                    bannerCerca.style.background = '#fff5f5'; bannerCerca.style.color = '#ef4444'; bannerCerca.style.borderColor = '#fca5a5'; bannerCerca.innerHTML = `⏰ SCADUTO (Trovato da Ricerca)`;
                } else if (currentPren.stato === 'DA_VERIFICARE') {
                    bannerCerca.style.background = '#ffedd5'; bannerCerca.style.color = '#ea580c'; bannerCerca.style.borderColor = '#fdba74'; bannerCerca.innerHTML = `🚨 DA VERIFICARE (Trovato da Ricerca)`;
                } else {
                    bannerCerca.style.background = '#eff6ff'; bannerCerca.style.color = '#3b82f6'; bannerCerca.style.borderColor = '#93c5fd'; bannerCerca.innerHTML = `📋 ATTIVO (Trovato da Ricerca)`;
                }
            }

            if (data.storico && tabellaCorpo) {
                let righeDaMostrare = [];
                if (currentPren.stato === 'SCADUTO' || currentPren.stato === 'MAI_ENTRATO') {
                    righeDaMostrare = data.storico.filter(x => ['PRENOTATO', 'ENTRATO', 'DA_VERIFICARE'].includes(x.stato));
                } else if (currentPren.stato === 'DA_VERIFICARE') {
                    righeDaMostrare = data.storico.filter(x => x.stato !== 'DA_VERIFICARE');
                } else {
                    righeDaMostrare = data.storico.filter(x => ['SCADUTO', 'MAI_ENTRATO'].includes(x.stato));
                }
                if (typeof renderTabella === "function") renderTabella(righeDaMostrare);
                else if (typeof generaRigaTabella === "function") tabellaCorpo.innerHTML = righeDaMostrare.map(x => generaRigaTabella(x)).join('');
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
    
    // 🚀 Il flag scaduto ora si attiva se lo stato sul DB è 'SCADUTO'
    const scaduto = (x.stato === 'SCADUTO');

    const storico = x.stato === 'USCITO' || x.stato === 'ARCHIVIATO';

    const daVerificare = x.stato === 'DA_VERIFICARE' || 
                         (x.stato === 'PRENOTATO' && oggi > x.data_fine && x.orario_ingresso && !x.orario_uscita);

    return {
        prenotatoOggi,
        entrato,
        uscito,
        scaduto,
        storico,
        daVerificare
    };
}

// ✅ Visualizzazione totale al piantone (Aggiornata per V1P)
async function aggiornaPostiLiberiPiantone() {
    const res = await fetch(`/api/piantone/liberi`);
    const dati = await res.json();
    
    const display = document.getElementById('total-free-display');
    if (display) {
        display.innerHTML = `
            <b style="color:#16a34a; font-size: 16px;">Liberi: ${dati.totaleLiberi}</b> 
            &nbsp;|&nbsp; 
            <b style="color:#ea580c; font-size: 16px;">Dentro: ${dati.dentro}</b>
            ${dati.listaV1p > 0 ? `&nbsp;|&nbsp; <b style="color:#2563eb; font-size: 16px;">Lista: ${dati.listaV1p}</b>` : ''}
        `;
    }
}

async function aggiornaVeicoli() {
    // 🛡️ CONTROLLO DI SICUREZZA INTEGRATO: Se userPass è vuoto o non definito, interrompiamo subito
    if (typeof userPass === 'undefined' || !userPass || userPass.trim() === "") {
        console.warn("⚠️ Richiesta annullata: userPass non ancora disponibile (utente non loggato).");
        return;
    }

    try {
        const res = await fetch(`/api/veicoli-dentro?npass=${userPass}`);
        
        // Se il server risponde con un errore (es: 403 o 500), usciamo in sicurezza
        if (!res.ok) {
            console.warn(`⚠️ Impossibile recuperare i dati dei veicoli. Il server ha risposto con stato: ${res.status}`);
            return;
        }

        const dati = await res.json();
        
        // 🎯 PROTEZIONE CRASH: Verifichiamo che 'dati' sia effettivamente un array valido
        if (!Array.isArray(dati)) {
            console.error("💥 I dati ricevuti dal server non sono un array valido:", dati);
            return;
        }
        
        // Configurazione data odierna locale per i confronti
        const oraSolareOggi = new Date();
        oraSolareOggi.setHours(0, 0, 0, 0);
        const oggiTime = oraSolareOggi.getTime();
        const oggiString = oraSolareOggi.toISOString().split('T')[0];

        const inputSearch = document.getElementById('search-p');

        // ==========================================
        // ⚠️ INIZIALIZZAZIONE PULITA DEI CONTATORI
        // ==========================================
        let countDentro = 0; // Solo pass standard
        let countListaV1p = 0; // Solo pass che iniziano con V1P
        
        let countEntratiOggi = 0;
        let countPrenotatiOggi = 0;
        let countVerificare = 0;
        let countScaduti = 0; 
        
        // Elenco dei pass da archiviare sul DB in background
        const passDaArchiviareSuDB = [];

        dati.forEach(x => {
            const passCorrente = (x.npass || '').toUpperCase().trim();

            // Conversione date del DB per i confronti temporali
            const dataInizioData = x.data_inizio ? new Date(x.data_inizio) : null;
            if (dataInizioData) dataInizioData.setHours(0,0,0,0);
            const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;

            // Estrazione della data di fine prenotazione
            const dataFineData = x.data_fine ? new Date(x.data_fine) : null;
            if (dataFineData) dataFineData.setHours(0,0,0,0);
            const fineTime = dataFineData ? dataFineData.getTime() : 0;

            const dataIngressoString = x.orario_ingresso ? x.orario_ingresso.substring(0, 10) : '';

            // Separazione conteggio interni
            if (x.orario_ingresso && !x.orario_uscita) {
                if (passCorrente.startsWith('V1P')) {
                    countListaV1p++;
                } else {
                    countDentro++;
                }
            }

            if (x.orario_ingresso && dataIngressoString === oggiString) {
                countEntratiOggi++;
            }
            if (x.stato === 'PRENOTATO' && inizioTime === oggiTime) {
                countPrenotatiOggi++;
            }
            
            const f = getFlags(x);
            if (f.daVerificare) countVerificare++;
            
            // 🎯 LOGICA DI CONTROLLO SCADUTI SUL DB
            if (['SCADUTO', 'MAI_ENTRATO'].includes(x.stato) && !x.orario_ingresso) {
                if (fineTime && oggiTime > fineTime) {
                    if (x.stato === 'SCADUTO') {
                        passDaArchiviareSuDB.push({ id: x.id, npass: x.npass });
                    }
                } else {
                    countScaduti++;
                }
            }
        });
        
        totaleScaduti = countScaduti;
        totaleVerificare = countVerificare;
        
        // Matematica posti liberi
        const postiLiberi = 90 - countDentro; 

        // ================================================================
        // 🎯 NUOVA COSTRUZIONE STRINGA RINOMINATA IN ALTO (EX SBARRA)
        // ================================================================
        let stringaContatoriNuova = `
            <span style="display:inline-block; margin:0 3px; font-weight:600; color:#1e293b;">🚗 Dentro: <span style="color:#ea580c;">${countDentro}</span></span> | 
            <span style="display:inline-block; margin:0 3px; font-weight:600; color:#1e293b;">📅 Prenotati Oggi: <span style="color:#2563eb;">${countPrenotatiOggi}</span></span> | 
            <span style="display:inline-block; margin:0 3px; font-weight:600; color:#1e293b;">🅿️ Liberi: <span style="color:#16a34a;">${postiLiberi}</span></span>
        `;

        if (countListaV1p > 0) {
            stringaContatoriNuova += ` | <span style="display:inline-block; margin:0 3px; font-weight:600; color:#2563eb;">🔹 Lista V1P: <span style="font-weight:bold;">${countListaV1p}</span></span>`;
        }

        // Iniettiamo la nuova riga formattata al posto dei vecchi contatori "Liberi | Dentro"
        const displaySotto = document.getElementById('total-free-display');
        const cardSbarraAlto = document.getElementById('card-sbarra-alto') || document.getElementById('status-parcheggio');
        
        if (displaySotto) displaySotto.innerHTML = stringaContatoriNuova;
        if (cardSbarraAlto) cardSbarraAlto.innerHTML = stringaContatoriNuova;

        // Gestione testo centrale della sbarra (se presente nel template)
        const stringaSbarraCentro = document.getElementById('testo-sbarra-centro');
        if (stringaSbarraCentro) {
            let testoCentro = `🚧 CONTROLLO SBARRA | 🚗 Dentro: ${countDentro} | 📅 Prenotati Oggi: ${countPrenotatiOggi} | 🅿️ Liberi: ${postiLiberi}`;
            if (countListaV1p > 0) testoCentro += ` | 🔹 Lista V1P: ${countListaV1p}`;
            stringaSbarraCentro.innerHTML = testoCentro;
        }

        // ================================================================
        // 🎯 GESTIONE DINAMICA DEL BADGE SOTTO I PULSANTI (SOLO PER AVVISI CRITICI)
        // ================================================================
       const badgeContatori = document.getElementById('badge-contatori');
        if (badgeContatori) {
            // Verifichiamo se c'è almeno una delle due anomalie (dentro da verificare o scadenze non gestite)
            if (countVerificare > 0 || totaleScaduti > 0) {
                badgeContatori.style.margin = "10px 0";
                badgeContatori.style.paddingBottom = "10px";
                badgeContatori.style.borderBottom = "1px solid #cbd5e1"; 
                badgeContatori.style.textAlign = "center";
                badgeContatori.style.display = "block";
                
                badgeContatori.innerHTML = `
                    <div style="margin-top: 4px;">
                        <span class="badge-blink" style="display:inline-block; background:#fff7ed; color:#c2410c; padding:5px 14px; border-radius:8px; border:1px solid #fed7aa; font-weight:bold; font-size:13px;">
                            ⚠️ ATTENZIONE: Ci sono ${countVerificare} Veicoli Dentro e ${totaleScaduti} Prenotazioni Scadute da Verificare!
                        </span>
                    </div>
                `;
            } else {
                // Se non ci sono criticità, svuotiamo il div e lo nascondiamo completamente
                badgeContatori.innerHTML = "";
                badgeContatori.style.margin = "0";
                badgeContatori.style.padding = "0";
                badgeContatori.style.border = "none";
                badgeContatori.style.display = "none";
            }
        }
        
        // 🚀 PROCESSO DI ARCHIVIAZIONE AUTOMATICA SUL SERVER (BACKGROUND) 🚀
        if (passDaArchiviareSuDB.length > 0) {
            for (const item of passDaArchiviareSuDB) {
                console.log(`🤖 Sistema: Archiviazione automatica DB per il pass scaduto ${item.npass} (ID: ${item.id})`);
                try {
                    fetch('/api/piantone/scaduto-archivia', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: item.id, npass: item.npass })
                    }).then(response => {
                        if (!response.ok) console.warn(`⚠️ Errore archiviazione DB per pass ${item.npass}`);
                    });
                } catch (e) {
                    console.error("💥 Impossibile connettersi all'API di archiviazione:", e);
                }
            }
        }

        // --- FILTRAGGIO LOCALE DELLA LISTA CORRENTE ---
        const valeurCercato = inputSearch?.value?.trim()?.toUpperCase() || "";
        const statoTabella = document.getElementById('stato-tabella');

        const lista = dati.filter(x => {
            if (valeurCercato !== "") return x.npass?.toUpperCase() === valeurCercato;
            
            const f = getFlags(x);
            const dataInizioData = x.data_inizio ? new Date(x.data_inizio) : null;
            if (dataInizioData) dataInizioData.setHours(0,0,0,0);
            const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;

            const dataFineData = x.data_fine ? new Date(x.data_fine) : null;
            if (dataFineData) dataFineData.setHours(0,0,0,0);
            const fineTime = dataFineData ? dataFineData.getTime() : 0;

            const èScadutoOltreFine = (x.stato === 'SCADUTO' || x.stato === 'MAI_ENTRATO') && !x.orario_ingresso && fineTime && oggiTime > fineTime;

            if (filtroPiantone === 'verificare') return f.daVerificare;
            
            if (filtroPiantone === 'scaduti') {
                if (èScadutoOltreFine) return false; 
                return x.stato === 'SCADUTO' && !x.orario_ingresso;
            }      
            
            if (filtroPiantone === 'attivi') {
                if (f.daVerificare) return false;
                if (['SCADUTO', 'MAI_ENTRATO'].includes(x.stato)) return false; 
                if (x.orario_ingresso && !x.orario_uscita) return true; 
                return (x.stato === 'PRENOTATO' && inizioTime === oggiTime && !x.orario_ingresso);
            }
           
            if (filtroPiantone === 'storico') {
                return x.stato === 'USCITO' || x.stato === 'MAI_ENTRATO' || èScadutoOltreFine;
            }
            
            return true;
        })
        .sort((a, b) => {
            if (valeurCercato !== "") {
                const getPriorita = (item) => {
                    const f = getFlags(item);
                    const dataInizioData = item.data_inizio ? new Date(item.data_inizio) : null;
                    if (dataInizioData) dataInizioData.setHours(0,0,0,0);
                    const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;

                    if (f.daVerificare) return 1; 
                    if (f.entrato || (item.stato === 'PRENOTATO' && inizioTime === oggiTime)) return 2; 
                    if (['SCADUTO', 'MAI_ENTRATO'].includes(item.stato)) return 3;                
                    if (f.storico) return 4;                    
                    return 5;
                };
                const pesoA = getPriorita(a); const pesoB = getPriorita(b);
                if (pesoA !== pesoB) return pesoA - pesoB;
                return (b.id || 0) - (a.id || 0);
            } 
            if (filtroPiantone === 'attivi') {
                const dateA = a.orario_ingresso ? new Date(a.orario_ingresso).getTime() : 0;
                const dateB = b.orario_ingresso ? new Date(b.orario_ingresso).getTime() : 0;
                return dateB - dateA; 
            }
            if (filtroPiantone === 'verificare') {
                return (a.orario_ingresso ? new Date(a.orario_ingresso) : new Date(0)) - (b.orario_ingresso ? new Date(b.orario_ingresso) : new Date(0));
            }
            if (filtroPiantone === 'storico') {
                return (b.orario_ingresso ? new Date(b.orario_ingresso) : new Date(0)) - (a.orario_ingresso ? new Date(a.orario_ingresso) : new Date(0));
            }
            return (a.npass || "").localeCompare(b.npass || "", undefined, { numeric: true, sensitivity: 'base' });
        });

        // Banner per la ricerca testuale
        if (valeurCercato !== "") {
            let label = ""; let colore = "#334155"; let sfondo = "#f8fafc";
            if (lista.length > 0) {
                const veicoloTrovato = lista[0]; const f = getFlags(veicoloTrovato);
                const dataInizioData = veicoloTrovato.data_inizio ? new Date(veicoloTrovato.data_inizio) : null;
                if (dataInizioData) dataInizioData.setHours(0,0,0,0);
                const inizioTime = dataInizioData ? dataInizioData.getTime() : 0;
                
                if (f.daVerificare) { label = "🚨 DA VERIFICARE (Trovato da Ricerca)"; colore = "#ea580c"; sfondo = "#ffedd5"; } 
                else if (f.entrato || (veicoloTrovato.stato === 'PRENOTATO' && inizioTime === oggiTime)) { label = "📋 ATTIVO (Trovato da Ricerca)"; colore = "#2563eb"; sfondo = "#dbeafe"; } 
                else if (['SCADUTO', 'MAI_ENTRATO'].includes(veicoloTrovato.stato)) { label = `⏰ ${veicoloTrovato.stato} (Trovato da Ricerca)`; colore = "#dc2626"; sfondo = "#fee2e2"; } 
                else if (f.storico) { label = "🕘 STORICO (Trovato da Ricerca)"; colore = "#475569"; sfondo = "#e2e8f0"; }
            } else {
                label = "🔍 NESSUN RISULTATO"; colore = "#64748b"; sfondo = "#f1f5f9";
            }
            if (statoTabella) {
                statoTabella.style.color = colore; statoTabella.style.background = sfondo;
                statoTabella.style.borderColor = colore; statoTabella.innerHTML = label;
                // Disattiva animazione lampeggio sul badge di stato durante la ricerca
                statoTabella.classList.remove('badge-blink');
                statoTabella.classList.remove('badge-blink-2');
            }
        } else {
            // Se non c'è ricerca attiva, sincronizza l'ovale del badge di stato
            if (typeof aggiornaGraficaBadge === 'function') {
                aggiornaGraficaBadge();
            }
        }
        
        // --- INIEZIONE RIGHE IN TABELLA HTML ---
        document.getElementById('lista-veicoli').innerHTML = lista.map(x => {
            const ing = x.orario_ingresso ? new Date(x.orario_ingresso) : null;
            const usc = x.orario_uscita ? new Date(x.orario_uscita) : null;
            const dataIng = ing ? ing.toLocaleDateString('it-IT') : '--';
            const oraIng = ing ? ing.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
            const dataUsc = usc ? usc.toLocaleDateString('it-IT') : '--';
            const oraUsc = usc ? usc.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
            
            const dataFineData = x.data_fine ? new Date(x.data_fine) : null;
            if (dataFineData) dataFineData.setHours(0,0,0,0);
            const fineTime = dataFineData ? dataFineData.getTime() : 0;

            const evidenzia = x.npass === ultimoAggiornato; 
            const f = getFlags(x);
            
            const isMaiEntrato = x.stato === 'MAI_ENTRATO' || (x.stato === 'SCADUTO' && !x.orario_ingresso && fineTime && oggiTime > fineTime);
            const isScadutoEsplicito = x.stato === 'SCADUTO' && !isMaiEntrato;

            const wPass = 'width: 16%;';
            const wDataIng = 'width: 26%;';
            const wOraIng = 'width: 15%;';
            const wDataUsc = 'width: 28%;';
            const wOraUsc = 'width: 15%;';
        
            const baseStyle = 'padding: 8px 6px; text-align: left; vertical-align: middle; box-sizing: border-box;';
        
            return `<tr style="
                border-bottom: 1px solid #f1f5f9;
                ${isScadutoEsplicito ? 'background:#fee2e2; color:#991b1b;' : ''}
                ${isMaiEntrato ? 'background:#f8fafc; color:#64748b;' : ''} 
                ${f.storico && !isMaiEntrato ? 'background:#f1f5f9;' : ''}
                ${evidenzia ? 'background:#d1fae5; font-weight:bold;' : ''}
                ${f.daVerificare ? 'background:#fff7ed; color:#c2410c; font-weight:bold;' : ''}
            ">
                <td style="${baseStyle} ${wPass}">
                    <button class="btn-pass" data-pass="${x.npass}" data-id="${x.id}" type="button" 
                        style="border:none; background:none; color:#2563eb; font-weight:bold; cursor:pointer; text-decoration:underline; padding:0; margin:0; font-size:14px;">
                        ${x.npass}
                    </button>
                </td>
                <td style="${baseStyle} ${wDataIng}">${isMaiEntrato ? 'MAI PRESENTATO' : (isScadutoEsplicito ? 'NON ENTRATO' : dataIng)}</td>
                <td style="${baseStyle} ${wOraIng} font-weight:bold;">${isScadutoEsplicito || isMaiEntrato ? '' : oraIng}</td>
                <td style="${baseStyle} ${wDataUsc}">${dataUsc}</td>
                <td style="${baseStyle} ${wOraUsc} font-weight:bold;">${oraUsc}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" style="text-align:center; color:black; padding:16px;">Nessun veicolo presente</td></tr>`;
            
        // Aggancio eventi pulsanti lista
        document.querySelectorAll('.btn-pass').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pass = btn.dataset.pass; 
                const idRecord = btn.dataset.id; 
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

    btnIngresso.disabled = true;
    btnUscita.disabled = true;
    loadingAzione = true;

    try {
        const res = await fetch('/api/piantone/azione', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: currentPren.id,
                azione,
                npass: userPass
            })
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.error || 'Errore operazione');
            return;
        }

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
        loadingAzione = false;
        btnIngresso.disabled = false;
        btnUscita.disabled = false;
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
    if (typeof arriviVisible === 'undefined') {
        window.arriviVisible = false;
    } else {
        window.arriviVisible = arriviVisible;
    }

    const box = document.getElementById('box-arrivi-oggi');
    const btn = document.getElementById('btn-arrivi-oggi');
    const lista = document.getElementById('lista-arrivi-oggi');
    if (!box || !lista) return;

    if (window.arriviVisible) {
        box.classList.add('hidden');
        window.arriviVisible = false;
        if (typeof arriviVisible !== 'undefined') arriviVisible = false;
        btn.innerText = '📋 Arrivi di Oggi';
        return;
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
            
            // Allineamento perfetto a sinistra e larghezze 34% - 33% - 33%
            const cellStylePass = 'style="width: 34%; padding: 10px 6px; text-align: left; vertical-align: middle;"';
            const cellStyleDal = 'style="width: 33%; padding: 10px 6px; text-align: left; vertical-align: middle; color: #475569; font-weight: 500;"';
            const cellStyleAl = 'style="width: 33%; padding: 10px 6px; text-align: left; vertical-align: middle; color: #475569; font-weight: 500;"';

            dati.forEach(r => {
                // 1. Formattazione "Dal giorno" (data_inizio)
                const dInizio = r.data_inizio ? new Date(r.data_inizio) : null;
                const dataInizioStr = (dInizio && !isNaN(dInizio.getTime())) ? dInizio.toLocaleDateString('it-IT') : '--';

                // 2. Formattazione "Al giorno" (cerca data_fine, fine o scadenza)
                const campoFine = r.data_fine || r.fine || r.scadenza || r.data_scadenza;
                const dFine = campoFine ? new Date(campoFine) : null;
                const dataFineStr = (dFine && !isNaN(dFine.getTime())) ? dFine.toLocaleDateString('it-IT') : '--';

                htmlRighe += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td ${cellStylePass}>
                        <button class="btn-pass-diretto" data-pass="${r.npass}" data-id="${r.id || ''}" type="button" 
                            style="border:none; background:none; color:var(--blue); font-weight:bold; cursor:pointer; text-decoration:underline; font-size:14px; padding:0; margin:0; display:inline-block; text-align:left;">
                            ${r.npass}
                        </button>
                    </td>
                    <td ${cellStyleDal}>${dataInizioStr}</td>
                    <td ${cellStyleAl}>${dataFineStr}</td>
                </tr>`;
            });
            lista.innerHTML = htmlRighe;

            // Aggancio dei listener sui bottoni pass generati
            document.querySelectorAll('.btn-pass-diretto').forEach(b => {
                b.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const passClick = b.getAttribute('data-pass');
                    const idClick = b.getAttribute('data-id');
                    const inputSearch = document.getElementById('search-p');
                    if (inputSearch) inputSearch.value = passClick;
                    
                    await cercaPass(passClick, idClick);
                    document.getElementById('panel-piantone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        }
        box.classList.remove('hidden');
        window.arriviVisible = true;
        if (typeof arriviVisible !== 'undefined') arriviVisible = true;
        btn.innerText = '❌ Nascondi Arrivi di Oggi';
    } catch (err) {
        console.error("Errore Arrivi:", err);
        alert('Errore caricamento arrivi');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    // ============================================================
    // 🚀 INIZIALIZZAZIONE AUTOMATICA PROTETTA
    // ============================================================
    
    // 🛡️ CONTROLLO DI SICUREZZA: Eseguiamo il caricamento iniziale SOLO se c'è un pass valido 
    // e se l'utente è effettivamente loggato come piantone/admin.
    // Se la pagina si apre sulla schermata di Login speculare, questo evita il crash 403.
    if (typeof userPass !== 'undefined' && userPass && userPass.trim() !== "") {
        
        if (typeof aggiornaVeicoli === 'function') {
            await aggiornaVeicoli(); 
        }

        // Decidiamo lo stato di partenza esatto in base alla situazione reale del parcheggio
        if (typeof totaleVerificare !== 'undefined' && totaleVerificare > 0) {
            filtroPiantone = 'verificare';
        } else if (typeof totaleScaduti !== 'undefined' && totaleScaduti > 0) {
            filtroPiantone = 'scaduti';
        } else {
            filtroPiantone = 'attivi';
        }

        // Forziamo immediatamente la grafica del badge ad allinearsi
        if (typeof aggiornaGraficaBadge === 'function') {
            aggiornaGraficaBadge();
        }

        // Secondo refresh rapido per disegnare la tabella coerente
        if (typeof aggiornaVeicoli === 'function') {
            await aggiornaVeicoli();
        }
    } else {
        // Se non è loggato, impostiamo un filtro di default ma NON chiamiamo il server a vuoto
        filtroPiantone = 'verificare';
        // (Opzionale) Se hai una funzione di login, ti assicurerai di chiamare 
        // aggiornaVeicoli() subito DOPO che il login ha avuto successo.
    }

// ============================================================
// 📋 EVENT LISTENERS STANDARD DELLA PAGINA (Sbloccato e Coordinato)
// ============================================================
document.getElementById('btn-login')?.addEventListener('click', doLogin);
document.getElementById('btn-reset-days')?.addEventListener('click', resetSelezione);
document.getElementById('btn-mie')?.addEventListener('click', mostraMie);
document.getElementById('btn-back-user')?.addEventListener('click', () => { show('view-user'); });

// ============================================================
// 🎯 INTERCETTAZIONE E CONTROLLI PRIMA DEL BANNER REGOLE
// ============================================================
document.getElementById('btn-prenota')?.addEventListener('click', () => {
    if (loadingPrenotazione) return;

    // A. Controllo Selezione Giorni (Minimo 2)
    if (selectedDays.length === 0) { 
        alert("⚠️ Seleziona almeno un giorno sulla griglia del calendario prima di procedere!"); 
        return; 
    }
    if (selectedDays.length === 1) { 
        alert("Per il parcheggio【Lunga Sosta】il minimo di giorni prenotabili sono 2"); 
        return; 
    }

    // B. Controllo Email Privata e Validazioni Obbligatorie
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

    // C. Controllo Tetto Massimo Dinamico in base al Profilo
    const selectProfilo = document.getElementById('select-profilo');
    const profilo = selectProfilo ? selectProfilo.value : 'STD';
    
    let limiteMassimo = 15;
    if (profilo === 'MIS') {
        limiteMassimo = 45;
    } else if (profilo === 'TRN') {
        limiteMassimo = 30; // Copre sia Turnisti che Smart Working accorpati
    }

    if (selectedDays.length > limiteMassimo) {
        resetSelezione();
        alert(`⚠️ Profilo ${profilo}: Massimo ${limiteMassimo} giorni selezionabili!`);
        return;
    }

    // Se tutti i controlli preliminari sono superati, mostra il Banner di responsabilità
    const modalRegole = document.getElementById('modal-conferma-regole');
    if (modalRegole) {
        modalRegole.style.display = 'flex';
    }
});

// ============================================================
// ⚙️ GESTIONE PULSANTI INTERNI AL BANNER DI CONFERMA
// ============================================================

// AZIONE A: L'utente annulla per correggere la selezione
document.getElementById('modal-btn-annulla')?.addEventListener('click', () => {
    const modalRegole = document.getElementById('modal-conferma-regole');
    if (modalRegole) modalRegole.style.display = 'none';
});

// AZIONE B: L'utente accetta le condizioni -> Mostra caricamento ed ESEGUE L'INVIO
document.getElementById('modal-btn-accetta')?.addEventListener('click', () => {
    const modalRegole = document.getElementById('modal-conferma-regole');
    const modalLoading = document.getElementById('modal-loading');

    // Chiude il popup delle regole e attiva la rotellina fluida (senza blocco OK)
    if (modalRegole) modalRegole.style.display = 'none';
    if (modalLoading) modalLoading.style.display = 'flex';

    // Lancia l'invio nativo
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
    // Recupero dell'input per evitare errori di riferimento se non definito globalmente
    const inputSearch = document.getElementById('search-p');
    if (inputSearch) inputSearch.value = '';
    
    currentPren = null;
    filtroPiantone = 'attivi'; 
    
    // 🎯 NASCONDI TUTTI I BOX DI VERIFICA (Sia Standard che Scaduti)
    document.getElementById('panel-piantone')?.classList.add('hidden');
    
    // 🎯 AGGIORNATO: Resetta anche il display inline oltre a nasconderlo
    const boxVerifica = document.getElementById('box-verifica');
    if (boxVerifica) {
        boxVerifica.classList.add('hidden');
        boxVerifica.style.display = ''; // Pulizia dello stile flex/block precedente
    } 
    
    const boxScaduti = document.getElementById('box-verifica-scaduti');
    if (boxScaduti) {
        boxScaduti.classList.add('hidden');
        boxScaduti.innerHTML = ''; // 🧼 PULIZIA CRUCIALE: Svuota l'HTML dinamico (Archiviato/Pulsanti Grandi)
    }
    
    // 🧼 PULIZIA EXTRA: Svuota i vecchi testi dei timestamp e banner per sicurezza
    const regE = document.getElementById('reg-e');
    const regU = document.getElementById('reg-u');
    const bannerCerca = document.getElementById('stato-tabella');
    if (regE) regE.innerHTML = '';
    if (regU) regU.innerHTML = '';
    if (bannerCerca) bannerCerca.innerHTML = '';

    if (typeof aggiornaGraficaBadge === 'function') aggiornaGraficaBadge();
    
    // Ripristina la tabella reale
    if (typeof aggiornaVeicoli === 'function') {
        aggiornaVeicoli();
    }
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
            alert('Veicolo verificato');
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
    
// ============================================================
// ⚙️ GESTIONE STRUMENTO DI VERIFICA AUTO SCADUTE (OTTIMIZZATO)
// ============================================================

// AZIONE: SI - DENTRO (RIATTIVA PRENOTAZIONE)
async function eseguiScadutoDentro() {
    if (!currentPren) return;
    
    if (!confirm(`Confermi che il veicolo ${currentPren.npass} è già presente nel parcheggio?`)) return;

    try {
        const res = await fetch('/api/piantone/scaduto-riattiva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: currentPren.id,
                npass: currentPren.npass,
                auth: userPass, 
                data_verifica: new Date()
            })
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Errore del server');
        }

        const data = await res.json();

        if (data.success) {
            alert("Operazione completata con successo!");
            const schedaAttiva = typeof currentView !== 'undefined' ? currentView : (document.querySelector('.tab-link.active')?.dataset.view || 'scaduti');
            if (typeof caricaVeicoliDentro === 'function') {
                await caricaVeicoliDentro(schedaAttiva);
            }
            cercaPass(currentPren.npass);
        }
    } catch (err) {
        console.error(err);
        alert("Errore durante l'operazione: " + err.message);
    }
}

// AZIONE: NO - MAI ENTRATO (ARCHIVIA PRENOTAZIONE)
async function eseguiScadutoMaiEntrato() {
    if (!currentPren) return;

    if (!confirm(`Vuoi archiviare la prenotazione ${currentPren.id} come MAI ENTRATO? Il posto verrà liberato.`)) return;

    try {
        const res = await fetch('/api/piantone/scaduto-archivia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: currentPren.id,
                npass: currentPren.npass,
                auth: userPass 
            })
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Errore del server');
        }

        const data = await res.json();

        if (data.success) {
            alert("Operazione completata con successo!");
            const schedaAttiva = typeof currentView !== 'undefined' ? currentView : (document.querySelector('.tab-link.active')?.dataset.view || 'scaduti');
            if (typeof caricaVeicoliDentro === 'function') {
                await caricaVeicoliDentro(schedaAttiva);
            }
            cercaPass(currentPren.npass);
        }
    } catch (err) {
        console.error(err);
        alert("Errore durante l'archiviazione: " + err.message);
    }
}
    window.eseguiScadutoDentro = eseguiScadutoDentro;
    window.eseguiScadutoMaiEntrato = eseguiScadutoMaiEntrato;
    
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

    // ============================================================
    // 🎯 AUTOMAZIONE FOCUS AUTOMATICO AL RAGGIUNGIMENTO DELLE 5 CIFRE
    // ============================================================
    // 1. Sposta il focus sul tasto Login appena si inserisce il pass a 5 cifre
    const inputLogin = document.getElementById('in-npass');
    inputLogin?.addEventListener('input', () => {
        if (inputLogin.value.trim().length === 5) {
            document.getElementById('btn-login')?.focus();
        }
    });

    // 2. Sposta il focus sul tasto Cerca appena il piantone digita le 5 cifre del pass
    inputSearch?.addEventListener('input', () => {
        if (inputSearch.value.trim().length === 5) {
            document.getElementById('btn-cerca')?.focus();
        }
    });
});
