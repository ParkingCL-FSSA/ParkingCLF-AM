let userPass = ""; let selectedDays = []; let currentPren = null;

function show(id) {
    document.querySelectorAll('.card > div').forEach(d => d.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

async function doLogin() {
    userPass = document.getElementById('in-npass').value.trim().toUpperCase();
    if(!userPass) return;
    const res = await fetch('/api/valida-pass', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({npass:userPass}) });
    const data = await res.json();
    if(data.valid) {
        if(data.ruolo === 'piantone') { show('view-piantone'); aggiornaVeicoli(); }
        else if(data.ruolo === 'admin') { show('view-admin'); mostraAdmin(); }
        else { show('view-user'); buildCal(); }
    } else alert("Accesso Negato");
}

function buildCal() {
    const grid = document.getElementById('cal-grid'); grid.innerHTML = ""; selectedDays = [];
    let d = new Date();
    for(let i=0; i<45; i++) {
        const iso = d.toISOString().split('T')[0];
        const slot = document.createElement('div'); slot.className = "day-slot";
        slot.innerText = d.toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit'});
        slot.onclick = () => { 
            slot.classList.toggle('selected'); 
            if(slot.classList.contains('selected')) selectedDays.push(iso); 
            else selectedDays = selectedDays.filter(x => x !== iso); 
        };
        grid.appendChild(slot); d.setDate(d.getDate() + 1);
    }
}

async function inviaPren() {
    const email = document.getElementById('u-email').value;
    if(!selectedDays.length || !email) return alert("Dati mancanti!");
    const res = await fetch('/api/prenota', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({npass:userPass, giorni:selectedDays, email:email}) });
    if(res.ok) {
        selectedDays.sort();
        document.getElementById('summary-details').innerHTML = `<b>Pass:</b> ${userPass}<br><b>Email:</b> ${email}<br><b>Date:</b> ${selectedDays.map(d => new Date(d).toLocaleDateString('it-IT')).join(', ')}`;
        show('view-success');
    } else {
        const error = await res.json();
        alert(error.error || "Errore durante la prenotazione");
    }
}

async function mostraMie() {
    show('view-my-list');
    const res = await fetch(`/api/mie-prenotazioni/${userPass}`);
    const dati = await res.json();
    document.getElementById('my-list-content').innerHTML = dati.map(p => `
        <div class="pren-row">
            <div>📅 Dal ${new Date(p.data_inizio).toLocaleDateString('it-IT')} al ${new Date(p.data_fine).toLocaleDateString('it-IT')}</div>
            <div class="btn-delete" onclick="eliminaPren(${p.id}, '${userPass}')">✖</div>
        </div>
    `).join('') || "Nessuna prenotazione attiva.";
}

async function eliminaPren(id, npass) {
    if(!confirm("Annullare questa prenotazione?")) return;
    const res = await fetch('/api/elimina-prenotazione', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id, npass }) });
    if(res.ok) {
        alert("Prenotazione annullata");
        mostraMie(); // Ricarica subito la lista (Punto 4)
    }
}

async function aggiornaVeicoli() {
    const res = await fetch('/api/veicoli-dentro');
    const dati = await res.json();
    document.getElementById('body-dentro').innerHTML = dati.map(v => `
        <tr>
            <td class="txt-bold">${v.npass}</td>
            <td>${v.data_accesso || '-'}</td>
            <td>${v.ora_ingresso || '-'}</td>
            <td>${v.data_ora_uscita || '-'}</td>
        </tr>
    `).join('') || "<tr><td colspan='4'>Nessun movimento recente</td></tr>";
}

async function cercaPass() {
    const p = document.getElementById('search-p').value.trim().toUpperCase();
    if(!p) return;
    const res = await fetch(`/api/piantone/cerca/${p}`);
    const data = await res.json();
    if(data.trovato) {
        currentPren = data.prenotazione;
        document.getElementById('panel-piantone').classList.remove('hidden');
        document.getElementById('lab-pass').innerHTML = `PASS: ${currentPren.npass}`;
        document.getElementById('lab-periodo').innerHTML = `(Periodo: ${new Date(currentPren.data_inizio).toLocaleDateString('it-IT')} - ${new Date(currentPren.data_fine).toLocaleDateString('it-IT')})`;
        document.getElementById('reg-e').innerHTML = currentPren.orario_ingresso ? `Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT')}` : "";
        document.getElementById('reg-u').innerHTML = currentPren.orario_uscita ? `Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT')}` : "";
    } else alert("Nessuna prenotazione trovata");
}

async function mossa(tipo) {
    if(!currentPren) return;
    await fetch('/api/piantone/azione', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:currentPren.id, azione:tipo}) });
    cercaPass(); aggiornaVeicoli();
}

async function mostraAdmin() {
    const res = await fetch('/api/admin/cruscotto');
    const dati = await res.json();
    document.getElementById('tab-admin').innerHTML = dati.map(x => `<tr><td>${x.data}</td><td>${x.liberi} / 120</td></tr>`).join('');
}