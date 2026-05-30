let userPass = ""; let selectedDays = []; 
let deferredPrompt; let currentPren = null;
let filtroPiantone = 'verificare'; let totaleScaduti = 0;
let ultimoAggiornato = null;let totaleVerificare = 0;
let arriviVisible = false;

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

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'install') {
        setTimeout(() => {
            const btn = document.getElementById('btnInstalla');
            if (btn) {
                btn.style.border = "4px solid #3b82f6";
                alert("Benvenuto! Clicca sul tasto 'INSTALLA APP' per salvare l'applicazione sulla schermata home del tuo telefono.");
            }
        }, 1000);
    }
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker registrato', reg))
      .catch(err => console.error('Errore SW', err));
  });
}

// LOGIN
document.getElementById('btn-login')?.addEventListener('click', async () => {
    const pass = document.getElementById('in-npass').value.trim().toUpperCase();
    if (!pass) return alert("Inserisci codice!");

    try {
        const res = await fetch(`/api/login?pass=${encodeURIComponent(pass)}`);
        const data = await res.json();

        if (data.success) {
            userPass = pass;
            document.getElementById('view-login').classList.add('hidden');
            
            if(document.getElementById('avviso-manutenzione')){
               document.getElementById('avviso-manutenzione').style.display = 'none';
            }

            if (data.ruolo === 'admin') {
                document.getElementById('view-admin').classList.remove('hidden');
                document.querySelector('.card').classList.add('admin-wide');
                caricaTabellaAdmin();
            } else if (data.ruolo === 'piantone') {
                document.getElementById('view-piantone').classList.remove('hidden');
                document.querySelector('.card').classList.add('admin-wide');
                await aggiornaVeicoli();
                setInterval(aggiornaVeicoli, 7000);
            } else {
                document.getElementById('view-user').classList.remove('hidden');
                document.getElementById('user-title').innerText = `📅 Salve, ${data.nome || pass}`;
                generaCalendario(data.giorniDisponibili, data.giorniPrenotati, data.giorniScaduti, data.giorniVerificare);
            }
        } else {
            alert(data.msg || "Codice errato o non abilitato");
        }
    } catch (err) {
        console.error(err);
        alert("Errore di connessione");
    }
});

// CALENDARIO USER
function generaCalendario(disponibili, prenotati, scaduti, verificare) {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    grid.innerHTML = '';
    selectedDays = [];

    disponibili.forEach(g => {
        const div = document.createElement('div');
        div.className = 'day-slot';
        
        let dFmt = fmtData(g.data);
        div.innerHTML = `<strong>${dFmt}</strong><br><small style="color:var(--green)">Libre: ${g.posti}</small>`;

        if (g.posti <= 0) {
            div.style.background = '#f1f5f9';
            div.style.color = '#94a3b8';
            div.style.cursor = 'not-allowed';
            div.innerHTML = `<strong>${dFmt}</strong><br><small style="color:var(--red)">Completo</small>`;
            grid.appendChild(div);
            return; 
        }

        const giaPrenotato = prenotati.some(p => p.split('T')[0] === g.data.split('T')[0]);
        const giaScaduto = scaduti.some(s => s.split('T')[0] === g.data.split('T')[0]);
        const giaVerificare = verificare.some(v => v.split('T')[0] === g.data.split('T')[0]);

        if (giaPrenotato) {
            div.style.background = '#bbf7d0';
            div.style.color = '#166534';
            div.style.cursor = 'not-allowed';
            div.innerHTML = `<strong>${dFmt}</strong><br><small style="font-weight:bold;">PRENOTATO</small>`;
        } else if (giaVerificare) {
            div.style.background = '#fed7aa';
            div.style.color = '#9a3412';
            div.style.cursor = 'not-allowed';
            div.innerHTML = `<strong>${dFmt}</strong><br><small style="font-weight:bold;">VERIFICA</small>`;
        } else if (giaScaduto) {
            div.style.background = '#fee2e2';
            div.style.color = '#991b1b';
            div.style.cursor = 'not-allowed';
            div.innerHTML = `<strong>${dFmt}</strong><br><small style="font-weight:bold;">SCADUTO</small>`;
        } else {
            div.onclick = () => toggleGiorno(g.data, div);
        }

        grid.appendChild(div);
    });
}

function toggleGiorno(dateStr, element) {
    const idx = selectedDays.indexOf(dateStr);
    if (idx > -1) {
        selectedDays.splice(idx, 1);
        element.classList.remove('selected');
    } else {
        selectedDays.push(dateStr);
        element.classList.add('selected');
    }
}

document.getElementById('btn-reset-days')?.addEventListener('click', () => {
    document.querySelectorAll('.day-slot.selected').forEach(el => {
        el.classList.remove('selected');
    });
    selectedDays = [];
});

// PRENOTA
document.getElementById('btn-prenota')?.addEventListener('click', async () => {
    if (selectedDays.length < 2 || selectedDays.length > 15) {
        return alert("Devi selezionare un periodo continuo di minimo 2 giorni e massimo 15 giorni!");
    }
    
    selectedDays.sort();
    for (let i = 0; i < selectedDays.length - 1; i++) {
        const d1 = new Date(selectedDays[i]);
        const d2 = new Date(selectedDays[i+1]);
        const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
        if (diffDays > 1) {
            return alert("ATTENZIONE: I giorni selezionati devono essere consecutivi!");
        }
    }

    const email = document.getElementById('u-email').value.trim();
    if (!email) return alert("Inserisci la tua email per ricevere il PASS!");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return alert("Inserisci un indirizzo email valido!");

    try {
        const res = await fetch('/api/prenota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass: userPass, giorni: selectedDays, email })
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById('view-user').classList.add('hidden');
            document.getElementById('view-success').classList.remove('hidden');
            
            document.getElementById('summary-details').innerHTML = `
                <strong>Codice Utente:</strong> ${userPass}<br>
                <strong>PASS Generato:</strong> ${data.npass}<br>
                <strong>Periodo Prenotato:</strong> dal ${fmtData(selectedDays[0])} al ${fmtData(selectedDays[selectedDays.length - 1])}<br>
                <strong>Totale Giorni:</strong> ${selectedDays.length}<br>
                <strong>Inviato a:</strong> ${email}
            `;
        } else {
            alert(data.msg || "Errore durante la prenotazione");
        }
    } catch (err) {
        console.error(err);
        alert("Errore di rete");
    }
});

// DIALOG COMMENTI
document.getElementById('btn-invia-nota')?.addEventListener('click', async () => {
    const nota = document.getElementById('u-note').value.trim();
    if (!nota) return alert("Scrivi un commento prima di inviare!");

    try {
        const res = await fetch('/api/user/nota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass: userPass, nota: nota })
        });
        const data = await res.json();
        if (data.success) {
            alert("Grazie! Il tuo suggerimento è stato inviato.");
            document.getElementById('u-note').value = '';
        } else {
            alert("Errore durante l'invio della nota.");
        }
    } catch (err) {
        console.error(err);
        alert("Errore connessione.");
    }
});

// LE MIE PRENOTAZIONI USER
document.getElementById('btn-mie')?.addEventListener('click', async () => {
    try {
        const res = await fetch(`/api/user/mie?pass=${userPass}`);
        const data = await res.json();
        
        document.getElementById('view-user').classList.add('hidden');
        document.getElementById('view-my-list').classList.remove('hidden');

        const cont = document.getElementById('my-list-content');
        cont.innerHTML = '';

        if (!data.lungaSosta || data.lungaSosta.length === 0) {
            cont.innerHTML = '<p style="color:var(--gray);">Nessuna prenotazione attiva trovata.</p>';
            return;
        }

        data.lungaSosta.forEach(p => {
            const div = document.createElement('div');
            div.style = "background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:10px; text-align:left; font-size:13px; position:relative;";
            let badgeCol = p.stato === 'PRENOTATO' ? 'var(--orange)' : p.stato === 'ENTRATO' ? 'var(--green)' : 'var(--gray)';
            
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--blue); margin-bottom:4px;">PASS LUNGA SOSTA: ${p.npass}</div>
                <div><strong>Periodo:</strong> ${fmtData(p.data_inizio)} - ${fmtData(p.data_fine)}</div>
                <div><strong>Stato:</strong> <span style="color:${badgeCol}; font-weight:bold;">${p.stato}</span></div>
            `;

            if (p.stato === 'PRENOTATO' || p.stato === 'DA_VERIFICARE' || p.stato === 'SCADUTO') {
                const btnCanc = document.createElement('button');
                btnCanc.innerText = "❌ CANCELLA";
                btnCanc.className = "btn-red";
                btnCanc.style = "position:absolute; right:10px; bottom:10px; width:auto; padding:6px 12px; font-size:11px; margin:0; border-radius:6px;";
                btnCanc.onclick = () => cancellaPrenotazione(p.id);
                div.appendChild(btnCanc);
            }
            cont.appendChild(div);
        });
    } catch (err) {
        console.error(err);
        alert("Errore recupero prenotazioni");
    }
});

async function cancellaPrenotazione(id) {
    if (!confirm("Sei sicuro di voler cancellare questa prenotazione?")) return;
    try {
        const res = await fetch('/api/user/cancella', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass: userPass, id })
        });
        const data = await res.json();
        if (data.success) {
            alert("Prenotazione cancellata con successo.");
            document.getElementById('btn-mie').click();
        } else {
            alert(data.msg || "Impossibile cancellare la prenotazione.");
        }
    } catch (err) {
        console.error(err);
        alert("Errore di rete");
    }
}

document.getElementById('btn-back-user')?.addEventListener('click', () => {
    document.getElementById('view-my-list').classList.add('hidden');
    document.getElementById('view-user').classList.remove('hidden');
});

document.getElementById('btn-logout-user')?.addEventListener('click', () => {
    location.reload();
});

// PIANTONE
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
            if (!currentPren) return alert("Prenotazione non trovata");
            
            const oggiStr = new Date().toISOString().split('T')[0];
            const dataInizioStr = currentPren.data_inizio.split('T')[0];

            if (oggiStr < dataInizioStr) {
                btnIngresso.disabled = true;
                btnIngresso.innerText = 'PRENOTAZIONE FUTURA';
                btnIngresso.style.background = '#94a3b8'; 
                document.getElementById('reg-e').innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Non è possibile registrare l'ingresso prima del ${fmtData(currentPren.data_inizio)}</span>`;
            }
            else if (currentPren.stato === 'PRENOTATO') {
                btnIngresso.disabled = false;
            }
            else if (currentPren.stato === 'ENTRATO') {
                btnUscita.disabled = false;
            }
            else if (currentPren.stato === 'DA_VERIFICARE') {
                btnIngresso.style.display = 'inline-block';
                btnIngresso.disabled = true;
                btnUscita.disabled = false;
                btnUscita.style.display = 'inline-block';
                btnUscita.style.background = '#ea580c';
                btnUscita.innerText = 'VERIFICA';
                if (boxVerifica) boxVerifica.classList.remove('hidden');
            }
            else if (currentPren.stato === 'SCADUTO') {
                if (!currentPren.orario_ingresso) {
                    btnIngresso.disabled = true;
                    btnIngresso.innerText = 'PRENOTAZIONE SCADUTA';
                    btnIngresso.style.background = '#64748b'; 
                    btnUscita.style.display = 'none'; 
                    document.getElementById('reg-e').innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Termine d'ingresso superato. Posto liberato.</span>`;
                } else {
                    btnIngresso.disabled = true;
                    btnIngresso.style.display = 'none';
                    btnUscita.disabled = false;
                    btnUscita.style.display = 'inline-block';
                    btnUscita.style.background = '#ef4444';
                    btnUscita.innerText = 'USCITA (SCADUTO)';
                }
            }
            else if (currentPren.stato === 'USCITO') {
                btnIngresso.disabled = true;
                btnUscita.disabled = true;
                btnUscita.innerText = 'GIÀ USCITO';
                btnUscita.style.background = '#64748b';
            }

            document.getElementById('panel-piantone').classList.remove('hidden');

            document.getElementById('lab-pass').innerHTML = `
                <div style="font-size: 18px; font-weight: bold; text-align:center;">PASS: ${currentPren.npass}</div>
                <div style="font-size: 13px; color: #64748b; text-align:center;">(Prenotazione: ${currentPren.id})</div>
            `;

            document.getElementById('lab-periodo').innerHTML = `
                <div style="font-size: 13px; color: #64748b; text-align:center; margin-bottom: 6px;">
                    (Periodo: ${fmtData(currentPren.data_inizio)} - ${fmtData(currentPren.data_fine)})
                </div>
            `;
        
            if (oggiStr >= dataInizioStr && currentPren.stato !== 'SCADUTO') {
                document.getElementById('reg-e').innerHTML = currentPren.orario_ingresso
                    ? `<div style="font-size: 15px; font-weight: bold; color: #1e293b; text-align:center; margin-top: 4px;">
                        Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                       </div>`
                    : `<div style="font-size: 14px; color: #64748b; text-align:center;">Nessun ingresso registrato</div>`;
            }

            if (currentPren.stato !== 'SCADUTO') {
                document.getElementById('reg-u').innerHTML = currentPren.orario_uscita
                    ? `<div style="font-size: 15px; font-weight: bold; color: #1e293b; text-align:center; margin-top: 4px;">
                        Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                       </div>`
                    : "";
            }

            const bannerCerca = document.getElementById('stato-tabella'); 
            const tabellaCorpo = document.getElementById('lista-veicoli');
            const isScadutoCorrente = (currentPren.stato === 'SCADUTO');

            if (bannerCerca) {
                if (isScadutoCorrente) {
                    bannerCerca.style.background = '#ffeeef'; bannerCerca.style.color = '#ef4444'; bannerCerca.style.borderColor = '#fca5a5';
                    bannerCerca.innerHTML = `⏰ SCADUTO (Trovato da Ricerca)`;
                } else {
                    bannerCerca.style.background = '#eff6ff'; bannerCerca.style.color = '#3b82f6'; bannerCerca.style.borderColor = '#93c5fd';
                    bannerCerca.innerHTML = `📋 ATTIVO (Trovato da Ricerca)`;
                }
            }

            if (data.storico && tabellaCorpo) {
                let righeDaMostrare = isScadutoCorrente 
                    ? data.storico.filter(x => ['PRENOTATO', 'ENTRATO', 'DA_VERIFICARE'].includes(x.stato))
                    : data.storico.filter(x => x.stato === 'SCADUTO');
                tabellaCorpo.innerHTML = righeDaMostrare.map(x => generaRigaTabella(x)).join('');
            }
        } else {
            alert("Nessuna prenotazione trovata per questo PASS.");
            document.getElementById('panel-piantone').classList.add('hidden');
        }
    } catch (err) {
        console.error(err);
        alert("Errore ricerca PASS");
    }
}

function toggleScaduti() {
    const btn = document.getElementById('btn-filtro');
    const label = document.getElementById('stato-tabella');

    if (filtroPiantone === 'verificare') {
        filtroPiantone = 'attivi';
        btn.innerText = 'MOSTRA SCADUTI';
        label.innerText = '📋 ATTIVI DENTRO';
        label.style.borderColor = 'var(--green)'; label.style.background = '#f0fdf4'; label.style.color = '#166534';
    } else if (filtroPiantone === 'attivi') {
        filtroPiantone = 'scaduti';
        btn.innerText = 'MOSTRA DA VERIFICARE';
        label.innerText = '⏰ SOLO SCADUTI / MAI ENTRATI';
        label.style.borderColor = 'var(--red)'; label.style.background = '#fef2f2'; label.style.color = '#991b1b';
    } else {
        filtroPiantone = 'verificare';
        btn.innerText = 'MOSTRA ATTIVI DENTRO';
        label.innerText = '⚠️ DA VERIFICARE / RITARDI';
        label.style.borderColor = 'var(--orange)'; label.style.background = '#fff7ed'; label.style.color = '#c2410c';
    }
    aggiornaVeicoli();
}

async function aggiornaVeicoli() {
    try {
        const queryPass = document.getElementById('search-p').value.trim().toUpperCase();
        let url = `/api/piantone/veicoli?filtro=${filtroPiantone}&auth=${userPass}`;
        if (queryPass) url += `&searchPass=${encodeURIComponent(queryPass)}`;

        const res = await fetch(url);
        const data = await res.json();

        const dispDisplay = document.getElementById('total-free-display');
        if(dispDisplay && data.postiLiberiOggi !== undefined) {
             dispDisplay.innerHTML = `Posti Liberi Oggi: <span style="font-size:16px; font-weight:bold; color:var(--blue);">${data.postiLiberiOggi}</span>`;
        }

        totaleScaduti = data.totaleScaduti || 0;
        totaleVerificare = data.totaleVerificare || 0;

        const badgeContatori = document.getElementById('badge-contatori');
        if (badgeContatori) {
            badgeContatori.innerHTML = `
               <span style="display:inline-block; margin:4px 8px; font-weight:500;">🚘 Dentro: <strong>${data.totaleDentro || 0}</strong></span> | 
               <span style="display:inline-block; margin:4px 8px; font-weight:500;">📅 Prenotati oggi: <strong>${data.totaleAttesiOggi || 0}</strong></span> | 
               <span style="display:inline-block; margin:4px 8px; font-weight:500;">🅿️ Liberi: <strong>${data.postiLiberiOggi !== undefined ? data.postiLiberiOggi : '--'}</strong></span><br>
               <span style="display:inline-block; background:#fff7ed; color:#c2410c; padding:4px 10px; border-radius:8px; border:1px solid #fed7aa; margin-top:5px; font-weight:bold; animation: blink 2s infinite;">
                  🚨 Da verificare: ${totaleVerificare}
               </span>
            `;
        }

        const tbody = document.getElementById('lista-veicoli');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!data.veicoli || data.veicoli.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--gray); padding:15px;">Nessun veicolo in questa lista</td></tr>`;
            return;
        }

        data.veicoli.forEach(v => { tbody.innerHTML += generaRigaTabella(v); });
    } catch (err) {
        console.error(err);
    }
}

function generaRigaTabella(v) {
    let stileStato = ''; let notaRitardo = '';
    if (v.stato === 'DA_VERIFICARE') {
        stileStato = 'background-color: #fff7ed; font-weight: bold; color: #c2410c;';
        notaRitardo = `<br><span style="font-size:10px; color:#ea580c; font-weight:normal;">⚠️ Mancata uscita</span>`;
    } else if (v.stato === 'SCADUTO') {
        stileStato = 'background-color: #fef2f2; color: #b91c1c;';
        notaRitardo = `<br><span style="font-size:10px; color:#dc2626; font-weight:bold;">NON ENTRATO</span>`;
    } else if (v.stato === 'ENTRATO') {
        stileStato = 'background-color: #f0fdf4; color: #166534; font-weight:500;';
    }

    let oraIngresso = v.orario_ingresso ? new Date(v.orario_ingresso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
    let oraUscita = v.orario_uscita ? new Date(v.orario_uscita).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';

    return `
      <tr style="${stileStato}">
        <td>
          <a href="#" onclick="cercaPass('${v.npass}', ${v.id}); return false;" style="font-weight:bold; color:var(--blue); text-decoration:underline; font-size:14px;">
             ${v.npass}
          </a>
          ${notaRitardo}
        </td>
        <td>${fmtData(v.data_inizio)}</td>
        <td style="color:var(--green); font-weight:bold;">${oraIngresso}</td>
        <td>${fmtData(v.data_fine)}</td>
        <td style="color:var(--orange); font-weight:bold;">${oraUscita}</td>
      </tr>
    `;
}

// ARRIVI OGGI
async function mostraArriviOggi() {
    const box = document.getElementById('box-arrivi-oggi');
    const btn = document.getElementById('btn-arrivi-oggi');
    const lista = document.getElementById('lista-arrivi-oggi');
    if (!box || !lista) return;

    if (arriviVisible) {
        box.classList.add('hidden');
        arriviVisible = false;
        btn.innerText = '📋 Arrivi di Oggi';
        return;
    }

    try {
        const res = await fetch('/api/piantone/arrivi-oggi');
        const dati = await res.json();
        lista.innerHTML = '';

        if (!dati || dati.length === 0) {
            lista.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:12px; color:var(--gray);">Nessun arrivo previsto oggi</td></tr>`;
        } else {
            let htmlRighe = '';
            dati.forEach(r => {
                let badge = r.stato === 'PRENOTATO' ? `<span class="badge-stato"><span class="dot dot-orange"></span>Deve Entrare</span>` :
                            r.stato === 'ENTRATO' ? `<span class="badge-stato"><span class="dot dot-green"></span>Entrato</span>` :
                            r.stato === 'DA_VERIFICARE' ? `<span class="badge-stato"><span class="dot dot-orange" style="background-color: #ea580c;"></span>Da Verificare</span>` :
                            `<span class="badge-stato"><span class="dot dot-red"></span>Scaduto</span>`;

                htmlRighe += `
                <tr>
                    <td style="padding: 10px 6px;">
                        <button class="btn-pass-diretto" data-pass="${r.npass}" data-id="${r.id}" type="button" style="border:none; background:none; color:var(--blue); font-weight:bold; cursor:pointer; text-decoration:underline; font-size:15px; padding:0;">
                            ${r.npass}
                        </button>
                    </td>
                    <td style="padding: 10px 6px;">${badge}</td>
                </tr>`;
            });
            lista.innerHTML = htmlRighe;

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
        arriviVisible = true;
        btn.innerText = '❌ Nascondi Arrivi di Oggi';
    } catch (err) {
        console.error(err);
        alert('Errore caricamento arrivi');
    }
}

async function mossa(tipo) {
    if (!currentPren) return;
    if (tipo === 'E' && currentPren.stato === 'SCADUTO' && !currentPren.orario_ingresso) {
         return alert("OPERAZIONE BLOCCATA: Questo pass è scaduto senza mai effettuare l'accesso nei giorni stabiliti.");
    }

    try {
        const res = await fetch('/api/piantone/mossa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentPren.id, tipo, auth: userPass })
        });
        const data = await res.json();

        if (data.success) {
            alert(tipo === 'E' ? "Ingresso registrato!" : "Uscita registrata!");
            await cercaPass(currentPren.npass, currentPren.id);
            await aggiornaVeicoli();
        } else {
            alert(data.msg || "Errore durante la registrazione");
        }
    } catch (err) {
        console.error(err);
        alert("Errore invio mossa");
    }
}

// ADMIN
async function caricaTabellaAdmin() {
    try {
        const res = await fetch('/api/admin/giorni');
        const data = await res.json();
        const tab = document.getElementById('tab-admin');
        if (!tab) return;

        tab.innerHTML = `<thead><tr><th>Data</th><th>Posti Liberi</th><th>Occupati (L.S.)</th></tr></thead><tbody>`;
        data.forEach(g => {
            tab.innerHTML += `<tr><td><strong>${fmtData(g.data)}</strong></td><td style="color:var(--green); font-weight:bold;">${g.posti}</td><td style="color:var(--gray);">${g.occupati}</td></tr>`;
        });
        tab.innerHTML += '</tbody>';
    } catch (err) {
        console.error(err);
    }
}

async function mostraRitardi() {
    try {
        const res = await fetch('/api/admin/ritardi');
        const data = await res.json();
        if(!data.ritardi || data.ritardi.length === 0) return alert("Nessun veicolo in ritardo rilevato.");

        let report = "⚠️ VEICOLI IN RITARDO DETTAGLI:\n\n";
        data.ritardi.forEach(r => { report += `• PASS: ${r.npass} | Scadenza: ${fmtData(r.data_fine)} | Stato: ${r.stato}\n`; });
        alert(report);
    } catch (err) {
        console.error(err);
        alert("Errore generazione report ritardi");
    }
}

function fmtData(isoStr) {
    if (!isoStr) return '--';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// LISTENERS
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-cerca')?.addEventListener('click', () => cercaPass());

    const btnResetSearch = document.getElementById('btn-reset-search');
    const inputSearch = document.getElementById('search-p');
    if (btnResetSearch && inputSearch) {
        btnResetSearch.addEventListener('click', () => {
            inputSearch.value = '';
            document.getElementById('panel-piantone')?.classList.add('hidden');
            document.getElementById('box-verifica')?.classList.add('hidden');
            currentPren = null;
            const bannerCerca = document.getElementById('stato-tabella');
            if (bannerCerca) {
                bannerCerca.style.background = '#f8fafc'; bannerCerca.style.color = '#334155'; bannerCerca.style.borderColor = '#cbd5e1';
                bannerCerca.innerHTML = `📋 ATTIVI`;
            }
            aggiornaVeicoli();
        });
    }

    // 🚀 RIPRISTINO LOGICA VERIFICA ORIGINALE RIGIDA PER EVITARE CRASH NETWORK LATO SERVER
    document.getElementById('btn-presente')?.addEventListener('click', async () => {
        if (!currentPren) return;
        const res = await fetch('/api/piantone/verifica-risolvi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: current
