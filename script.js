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
    if(selectedDays.length > 15) return alert("Massimo 15 giorni selezionabili!");

    const res = await fetch('/api/prenota', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({npass:userPass, giorni:selectedDays, email:email}) });
    if(res.ok) {
        selectedDays.sort();
        document.getElementById('summary-details').innerHTML = `<b>Pass:</b> ${userPass}<br><b>Dal:</b> ${new Date(selectedDays[0]).toLocaleDateString('it-IT')}<br><b>Al:</b> ${new Date(selectedDays[selectedDays.length-1]).toLocaleDateString('it-IT')}`;
        show('view-success');
    }
}

async function mostraMie() {
    show('view-my-list');
    const res = await fetch(`/api/mie-prenotazioni/${userPass}`);
    const dati = await res.json();
    document.getElementById('my-list-content').innerHTML = dati.map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8fafc; border-radius:12px; margin-bottom:8px; border:1px solid #e2e8f0;">
            <div>📅 ${new Date(p.data_inizio).toLocaleDateString('it-IT')} - ${new Date(p.data_fine).toLocaleDateString('it-IT')}</div>
            <div style="color:red; cursor:pointer; font-size:20px;" onclick="eliminaPren(${p.id})">🗑️</div>
        </div>
    `).join('') || "Nessuna prenotazione attiva.";
}

async function eliminaPren(id) {
    if(!confirm("Eliminare questa prenotazione?")) return;
    const res = await fetch('/api/elimina-prenotazione', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, npass:userPass}) });
    if(res.ok) mostraMie();
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
        
        // Formatta periodo
        const d1 = new Date(currentPren.data_inizio).toLocaleDateString('it-IT');
        const d2 = new Date(currentPren.data_fine).toLocaleDateString('it-IT');
        document.getElementById('lab-periodo').innerHTML = `(Periodo: ${d1} - ${d2})`;
        
        // Gestione orari sotto pulsanti (se presenti nel DB)
        document.getElementById('reg-e').innerHTML = currentPren.orario_ingresso ? 
            `Registrato il ${new Date(currentPren.orario_ingresso).toLocaleString('it-IT', {dateStyle:'short', timeStyle:'short'})}` : "";
        document.getElementById('reg-u').innerHTML = currentPren.orario_uscita ? 
            `Registrato il ${new Date(currentPren.orario_uscita).toLocaleString('it-IT', {dateStyle:'short', timeStyle:'short'})}` : "";
            
    } else {
        alert("Nessuna prenotazione trovata per questo PASS.");
        document.getElementById('panel-piantone').classList.add('hidden');
    }
}

async function aggiornaVeicoli() {
    const res = await fetch('/api/veicoli-dentro');
    const dati = await res.json();
    document.getElementById('lista-veicoli').innerHTML = dati.map(x => `
        <tr>
            <td style="font-weight:bold;">${x.npass}</td>
            <td>${new Date(x.orario_ingresso).toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'})}</td>
        </tr>
    `).join('') || "<tr><td colspan='2' style='text-align:center;'>Nessun veicolo presente</td></tr>";
}

async function mossa(tipo) {
    await fetch('/api/piantone/azione', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:currentPren.id, azione:tipo}) });
    cercaPass(); aggiornaVeicoli();
}

async function mostraAdmin() {
    const res = await fetch('/api/admin/cruscotto');
    const dati = await res.json();
    document.getElementById('tab-admin').innerHTML = dati.map(x => `<tr><td>${x.data}</td><td>${x.liberi} / 120</td></tr>`).join('');
}