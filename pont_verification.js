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
  const lignes = besoins.verins.map((v, i) => {
    const c = sources[i] || {};
    const ecart = Math.abs((v.flowMax || 0) - (c.flowMax || 0));
    return { verin: v.nom, appli: c.flowMax || 0, moteur: v.flowMax || 0, ecart, ok: ecart <= TOL };
  });
  return { spec, besoins, lignes, toutOk: lignes.every(l => l.ok) };
}

// --- Version console (pour les power-users) ---
function verifierMoteur() {
  if (typeof calculerBesoins !== 'function') { console.error('besoins.js non chargé.'); return; }
  const { besoins, lignes } = calculerComparaison();
  console.table(lignes.map(l => ({ verin: l.verin, 'appli': +l.appli.toFixed(3),
    'moteur': +l.moteur.toFixed(3), 'écart': +l.ecart.toFixed(4), statut: l.ok ? '✅' : '❌' })));
  besoins.hypotheses.forEach(h => console.log('• ' + h));
  return calculerComparaison();
}

// --- Version visible : panneau à l'écran ---
function afficherPanneauVerification() {
  if (typeof calculerBesoins !== 'function') { alert('besoins.js non chargé (ordre des <script>).'); return; }
  let data;
  try { data = calculerComparaison(); }
  catch (e) { alert('Erreur de vérification : ' + e.message); return; }
  const { besoins, lignes, toutOk } = data;

  document.getElementById('pontVerifPanneau')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pontVerifPanneau';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;' +
    'display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';

  const rows = lignes.map(l => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:6px 10px">${l.verin}</td>
      <td style="padding:6px 10px;text-align:right">${l.appli.toFixed(3)}</td>
      <td style="padding:6px 10px;text-align:right">${l.moteur.toFixed(3)}</td>
      <td style="padding:6px 10px;text-align:right">${l.ecart.toFixed(4)}</td>
      <td style="padding:6px 10px;text-align:center;font-weight:bold;color:${l.ok ? '#16a34a' : '#dc2626'}">
        ${l.ok ? '✅' : '❌'}</td>
    </tr>`).join('');

  const hyp = besoins.hypotheses.length
    ? `<div style="margin-top:12px"><b>Hypothèses du moteur (non inventé) :</b><ul style="margin:6px 0 0 18px;color:#555">${
        besoins.hypotheses.map(h => `<li style="margin:3px 0">${h}</li>`).join('')}</ul></div>` : '';

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
      ${hyp}
      <div style="margin-top:16px;padding:12px;border-radius:8px;font-weight:bold;text-align:center;
                  background:${toutOk ? '#dcfce7' : '#fee2e2'};color:${toutOk ? '#15803d' : '#b91c1c'}">
        ${toutOk ? '✅ Le moteur reproduit exactement les débits de l\'appli.'
                 : '❌ Divergence détectée — à investiguer (bug moteur OU bug appli).'}
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
