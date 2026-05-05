let userPass = ""; let selectedDays = []; let currentPren = null;

function fmtData(isoStr) {
    if (!isoStr) return '--';
    const p = isoStr.split('T')[0].split('-');
    return `${p[2]}/${p[1]}/${p[0]}`;
}

function show(id) {
    document.querySelectorAll('.card > div').forEach(d => d.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

async function doLogin() {
    userPass = document.getElementById('in-npass').value.trim().toUpperCase();
    if (!userPass) return;
    const res = await fetch('/api/valida-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ npass: userPass }) });
    const data = await res.json();
    if (data.valid) {
        if (data.ruolo === 'piantone') { show('view-piantone'); aggiornaPostiLiberiPiantone(); aggiornaVeicoli(); }
        else if (data.ruolo === 'admin') { show('view-admin'); mostraAdmin(); }
        else { show('view-user'); buildCal(); }
    } else alert("Accesso Negato");
}

async function aggiornaPostiLiberiPiantone() {
    const res = await fetch(`/api/admin/cruscotto?npass=${userPass}`);
    const dati = await res.json();
    if (dati.length > 0) {
        // Mostra i posti liberi totali calcolati dal server
        document.getElementById('total-free-display').innerText = `Posti totali liberi oggi: ${dati[0].totaleLiberi} / 120`;
    }
}

async function mostraAdmin() {
    const res = await fetch(`/api/admin/cruscotto?npass=${userPass}`);
    const dati = await res.json();
    if (!dati?.length) return;

    const enti = Object.keys(dati[0].enti || {}).sort();
    let header = `<tr><th>Data</th><th>TOT</th>`;
    enti.forEach(e => header += `<th>${e}</th>`);
    header += `</tr>`;

    const rows = dati.map(x => {
        let row = `<tr><td>${fmtData(x.data)}</td><td style="font-weight:bold; color:var(--blue);">${x.totaleLiberi}</td>`;
        enti.forEach(ente => {
            const info = x.enti[ente];
            const col = info.liberi === 0 ? 'var(--red)' : info.liberi < 3 ? 'var(--orange)' : 'var(--gray)';
            row += `<td style="color:${col}; font-weight:bold;">${info.liberi}/${info.totale}</td>`;
        });
        return row + `</tr>`;
    }).join('');
    document.getElementById('tab-admin').innerHTML = header + rows;
}

function buildCal() {
    const grid = document.getElementById('cal-grid'); grid.innerHTML = "";
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
    const res = await fetch('/api/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ npass: userPass, giorni: selectedDays, email: email }) });
    if (res.ok) alert("Prenotazione inviata! Controlla la mail.");
    else { const err = await res.json(); alert(err.error); }
}

async function aggiornaVeicoli() {
    const res = await fetch(`/api/veicoli-dentro?npass=${userPass}`);
    const dati = await res.json();
    document.getElementById('lista-veicoli').innerHTML = dati.map(x => `<tr><td>${x.npass}</td><td>${x.stato}</td></tr>`).join('');
}