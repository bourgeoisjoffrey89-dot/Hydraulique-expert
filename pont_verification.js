/**
 * pont_verification.js — Branche le moteur headless SANS rien casser, AVEC interface.
 *
 * Stratégie "strangler fig" : on ne remplace pas le calcul existant. On fait
 * tourner calculerBesoins EN PARALLÈLE et on compare ses débits à ceux que
 * l'appli a déjà calculés. Si ça diverge : soit bug moteur, soit bug appli.
 *
 * USAGE : un bouton "🔍 Vérif moteur" apparaît en bas à droite. Fais un calcul,
 *         clique le bouton -> un panneau affiche la comparaison. Pas de console.
 *
 * Purement additif : ne modifie jamais le comportement de calcul de l'appli.
 * Prérequis d'ordre : formulas.js -> besoins.js -> pont_verification.js
 */

// --- Traduit l'état live (2 tableaux + formulaire) vers le spec du moteur ---
function construireSpec() {
  const val = id => { const el = document.getElementById(id); return el ? parseFloat(el.value) : undefined; };
  const txt = id => document.getElementById(id)?.value;
  const qte = c => (typeof getQuantity === 'function' ? getQuantity(c) : (c.quantity ?? 1));
  const mode = c => (c.workMode === 'simultaneous' ? 'simultané' : 'alterné');
  const pressionGlobale = val('pressure') || val('workingPressure') || 0;

  const existants = (typeof cylinders !== 'undefined' ? cylinders : []).map(c => ({
    nom: c.name, type: 'existant', workMode: mode(c),
    bore: c.bore, rod: c.rod, stroke: c.stroke,
    pression: c.workPressure ?? pressionGlobale,
    timeOut: c.timeOut, timeIn: c.timeIn,
    quantite: qte(c), pressureHold: c.pressureHold, holdTime: c.holdTime
  }));
  const neufs = (typeof newCylinders !== 'undefined' ? newCylinders : []).map(c => ({
    nom: c.name, type: 'nouveau', workMode: mode(c),
    requiredForce: c.forceInput, forceUnit: c.forceUnit,
    pression: c.pressure ?? pressionGlobale, stroke: c.stroke,
    timeOut: c.timeOut, timeIn: c.timeIn, quantite: qte(c)
  }));

  return {
    systeme: { pression: pressionGlobale, rendement: (val('efficiency') || 90) / 100 },
    fluide: { grade: txt('fluidGrade'), viscosite: val('fluidViscosity'), densite: val('fluidDensity'),
              tempAmbiante: val('ambientTemp'), tempHuileMax: val('maxOilTemp'), coeffConvection: val('natCoolCoeff') },
    reservoir: { longueur: val('resLength'), largeur: val('resWidth'), hauteur: val('resHeight') },
    verins: [...existants, ...neufs]
  };
}

// --- Cœur : compare moteur vs appli (débits = pression-indépendants) ---
function calculerComparaison() {
  const spec = construireSpec();
  const besoins = calculerBesoins(spec);
  const sources = [
    ...(typeof cylinders !== 'undefined' ? cylinders : []),
    ...(typeof newCylinders !== 'undefined' ? newCylinders : [])
  ];
  const TOL = 0.01;
  const fluxAppli = c => Math.max(c.flowOut || 0, c.flowIn || 0) || (c.flowMax || 0);
  const lignes = besoins.verins.map((v, i) => {
    const c = sources[i] || {};
    const appli = fluxAppli(c);
    const moteur = v.flowMax || 0;
    const ecart = Math.abs(moteur - appli);
    return { verin: v.nom, appli, moteur, ecart, trouve: appli > 0, ok: appli > 0 && ecart <= TOL };
  });
  return { spec, besoins, lignes, toutOk: lignes.every(l => !l.trouve || l.ok) };
}

// --- Sélection : fait tourner l'orchestrateur avec les VRAIS sélecteurs de l'appli ---
function calculerSelection(besoins) {
  if (typeof selectionnerComposants !== 'function') return null;
  const selecteurs = {};
  if (typeof recommendPump === 'function')     selecteurs.pompe = recommendPump;
  if (typeof selectWEGMotor === 'function')    selecteurs.moteur = selectWEGMotor;
  if (typeof selectHydacCooler === 'function') selecteurs.refroidisseur = selectHydacCooler;

  let comp;
  try { comp = selectionnerComposants(besoins, selecteurs); }
  catch (e) { return { erreur: e.message }; }

  const appTop  = (typeof currentPumpRecommendations !== 'undefined' && currentPumpRecommendations[0])
    ? currentPumpRecommendations[0].reference : null;
  const appPick = (typeof selectedPump !== 'undefined' && selectedPump) ? selectedPump.reference : null;
  const pompeMoteur = comp.pompe ? comp.pompe.reference : null;

  return {
    pompeMoteur,
    appTop,
    appPick,
    pompeOk: appTop != null && pompeMoteur === appTop,
    pompeComparable: appTop != null,
    moteur: comp.moteur ? (comp.moteur.kW + ' kW' + (comp.moteur.poles ? ' ' + comp.moteur.poles + 'P' : '')) : null,
    refroidisseur: comp.refroidisseur
      ? (comp.refroidisseur.reference || comp.refroidisseur.modele || comp.refroidisseur.serie || '—') : null,
    notes: comp.notes || []
  };
}

// --- Version console (pour les power-users) ---
function verifierMoteur() {
  if (typeof calculerBesoins !== 'function') { console.error('besoins.js non chargé.'); return; }
  const { besoins, lignes } = calculerComparaison();
  console.table(lignes.map(l => ({ verin: l.verin, 'appli': +l.appli.toFixed(3),
    'moteur': +l.moteur.toFixed(3), 'écart': +l.ecart.toFixed(4), statut: !l.trouve ? '❔' : (l.ok ? '✅' : '❌') })));
  besoins.hypotheses.forEach(h => console.log('• ' + h));
  return calculerComparaison();
}

// --- Version visible : panneau à l'écran ---
function afficherPanneauVerification() {
  if (typeof calculerBesoins !== 'function') { alert('besoins.js non chargé (ordre des <script>).'); return; }
  let data;
  try { data = calculerComparaison(); }
  catch (e) { alert('Erreur de vérification : ' + e.message); return; }
  const { besoins, lignes } = data;
  const aKo = lignes.some(l => l.trouve && !l.ok);
  const aNd = lignes.some(l => !l.trouve);

  document.getElementById('pontVerifPanneau')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pontVerifPanneau';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;' +
    'display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';

  const rows = lignes.map(l => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:6px 10px">${l.verin}</td>
      <td style="padding:6px 10px;text-align:right">${l.trouve ? l.appli.toFixed(3) : 'n/d'}</td>
      <td style="padding:6px 10px;text-align:right">${l.moteur.toFixed(3)}</td>
      <td style="padding:6px 10px;text-align:right">${l.trouve ? l.ecart.toFixed(4) : '—'}</td>
      <td style="padding:6px 10px;text-align:center;font-weight:bold;color:${!l.trouve ? '#9ca3af' : (l.ok ? '#16a34a' : '#dc2626')}">
        ${!l.trouve ? '❔' : (l.ok ? '✅' : '❌')}</td>
    </tr>`).join('');

  const hyp = besoins.hypotheses.length
    ? `<div style="margin-top:12px"><b>Hypothèses du moteur (non inventé) :</b><ul style="margin:6px 0 0 18px;color:#555">${
        besoins.hypotheses.map(h => `<li style="margin:3px 0">${h}</li>`).join('')}</ul></div>` : '';

  const sel = calculerSelection(besoins);
  const selHtml = !sel ? '' : (sel.erreur
    ? `<div style="margin-top:14px;padding:10px;border-radius:8px;background:#fef2f2;color:#b91c1c">Sélection indisponible : ${sel.erreur}</div>`
    : `<div style="margin-top:14px;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
        <b>Composants recommandés par le moteur</b>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
          <tr><td style="padding:4px 6px;color:#666;width:140px">Pompe (moteur)</td>
              <td style="padding:4px 6px"><b>${sel.pompeMoteur || '—'}</b></td>
              <td style="padding:4px 6px;text-align:right">${
                sel.pompeComparable
                  ? (sel.pompeOk
                      ? '<span style="color:#16a34a;font-weight:bold">✅ = top appli</span>'
                      : '<span style="color:#9ca3af">≠ top appli (' + sel.appTop + ')</span>')
                  : '<span style="color:#9ca3af">top appli n/d</span>'}</td></tr>
          ${sel.appPick ? `<tr><td style="padding:4px 6px;color:#666">Ton choix écran</td><td style="padding:4px 6px" colspan="2">${sel.appPick}</td></tr>` : ''}
          <tr><td style="padding:4px 6px;color:#666">Moteur</td><td style="padding:4px 6px" colspan="2">${sel.moteur || '—'}</td></tr>
          <tr><td style="padding:4px 6px;color:#666">Refroidisseur</td><td style="padding:4px 6px" colspan="2">${sel.refroidisseur || 'non requis'}</td></tr>
        </table>
        ${sel.notes.length ? '<ul style="margin:8px 0 0 18px;color:#b45309">' + sel.notes.map(n => `<li>${n}</li>`).join('') + '</ul>' : ''}
      </div>`);

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:680px;width:92%;max-height:85vh;overflow:auto;
                padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <h2 style="margin:0;font-size:18px">🔍 Vérification moteur headless vs appli</h2>
        <button id="pontVerifClose" style="border:none;background:#eee;border-radius:8px;
                width:32px;height:32px;cursor:pointer;font-size:18px">×</button>
      </div>
      <p style="margin:0 0 14px;color:#666;font-size:13px">
        Débit (L/min) — indépendant de la pression. Tolérance 0,01.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f7f7f7;text-align:left">
          <th style="padding:8px 10px">Vérin</th>
          <th style="padding:8px 10px;text-align:right">Appli</th>
          <th style="padding:8px 10px;text-align:right">Moteur</th>
          <th style="padding:8px 10px;text-align:right">Écart</th>
          <th style="padding:8px 10px;text-align:center">Statut</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="5" style="padding:10px;color:#999">Aucun vérin. Fais d\'abord un calcul.</td></tr>'}</tbody>
      </table>
      <div style="margin-top:14px;padding:10px 12px;background:#f7f7f7;border-radius:8px;font-size:14px">
        Débit total moteur : <b>${besoins.systeme.debitTotal.toFixed(2)} L/min</b> &nbsp;·&nbsp;
        Puissance absorbée : <b>${besoins.systeme.puissanceAbsorbee.toFixed(2)} kW</b>
      </div>
      ${selHtml}
      ${hyp}
      <div style="margin-top:16px;padding:12px;border-radius:8px;font-weight:bold;text-align:center;
                  background:${aKo ? '#fee2e2' : '#dcfce7'};color:${aKo ? '#b91c1c' : '#15803d'}">
        ${aKo ? '❌ Divergence réelle — à investiguer (bug moteur OU bug appli).'
              : (aNd ? '✅ Concordance sur les valeurs lisibles. (Certains vérins ne stockent pas leur débit sur l\'objet — non comparés.)'
                     : '✅ Le moteur reproduit exactement les débits de l\'appli.')}
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const fermer = document.getElementById('pontVerifClose');
  if (fermer) fermer.onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

// --- Injection du bouton flottant (navigateur uniquement) ---
function injecterBoutonVerif() {
  if (document.getElementById('pontVerifBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'pontVerifBtn';
  btn.textContent = '🔍 Vérif moteur';
  btn.title = 'Comparer le moteur headless à l\'appli (outil de validation)';
  btn.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:99998;padding:10px 16px;' +
    'background:#7c3aed;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;' +
    'font-family:system-ui,sans-serif;box-shadow:0 6px 18px rgba(124,58,237,.4)';
  btn.onclick = afficherPanneauVerification;
  document.body.appendChild(btn);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
  if (document.body) injecterBoutonVerif();
  else window.addEventListener('DOMContentLoaded', injecterBoutonVerif);
}
