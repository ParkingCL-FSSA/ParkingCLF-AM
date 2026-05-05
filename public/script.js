let userPass = ""; 
let selectedDays = [];

function show(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

async function doLogin() {
    userPass = document.getElementById('in-npass').value.trim().toUpperCase();
    const res = await fetch('/api/valida-pass', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({npass: userPass})});
    const data = await res.json();
    if(data.valid) {
        if(data.ruolo === 'admin') { show('view-admin'); mostraAdmin(); }
        else if(data.ruolo === 'piantone') { show('view-piantone'); aggiornaPostiPiantone(); }
        else { show('view-user'); buildCal(); }
    } else alert("Pass non valido");
}

async function aggiornaPostiPiantone() {
    const res = await fetch('/api/admin/cruscotto');
    const dati = await res.json();
    if(dati.length > 0) {
        document.getElementById('total-free-display').innerText = `Posti totali liberi oggi: ${dati[0].totaleLiberi} / 120`;
    }
}

async function mostraAdmin() {
    const res = await fetch('/api/admin/cruscotto');
    const dati = await res.json();
    const enti = Object.keys(dati[0].enti).sort();
    
    let html = `<thead><tr><th>Data</th><th>Totale</th>`;
    enti.forEach(e => html += `<th>${e}</th>`);
    html += `</tr></thead><tbody>`;

    dati.forEach(g => {
        html += `<tr><td>${g.data.split('-').reverse().join('/')}</td><td style="font-weight:bold; color:var(--blue)">${g.totaleLiberi}</td>`;
        enti.forEach(e => {
            const info = g.enti[e];
            const colore = info.liberi === 0 ? 'var(--red)' : (info.liberi < 3 ? 'var(--orange)' : 'var(--gray)');
            html += `<td style="color:${colore}; font-weight:bold;">${info.liberi}/${info.totale}</td>`;
        });
        html += `</tr>`;
    });
    document.getElementById('tab-admin').innerHTML = html + `</tbody>`;
}

// ... aggiungi qui le funzioni buildCal() e prenota() che avevi già ...
