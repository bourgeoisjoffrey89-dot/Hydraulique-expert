/**
 * besoins.js — Moteur de calcul headless (brique 1/2).
 *
 * calculerBesoins(spec) -> besoins
 *   Physique PURE : aucun DOM, aucun réseau, aucun catalogue.
 *   La sélection des composants (pompe/moteur/refroidisseur) est une brique
 *   séparée : selectionnerComposants(besoins, catalogue). [architecture B]
 *
 * Règles métier verrouillées :
 *   - Débit total = Σ(débits des vérins simultanés) + MAX(débits des vérins alternés).
 *   - Vérin 'existant' : bore/rod -> force.  Vérin 'nouveau' : force -> recommendedBore,
 *     puis convergence vers le même flux que l'existant.
 *   - Maintien de pression : ACCEPTÉ dans le spec, mais sa thermo (laminage pompe
 *     variable) n'est PAS modélisée en v1 -> signalée dans besoins.hypotheses,
 *     jamais inventée.
 *
 * Double usage navigateur / Node, comme formulas.js.
 */

const HF = (typeof HYDRAULIC_FORMULAS !== 'undefined')
  ? HYDRAULIC_FORMULAS
  : require('./formulas.js');

// Convertit une force exprimée en t / daN / kN / N vers des daN.
function forceEnDaN(valeur, unite) {
  switch ((unite || 'daN').toLowerCase()) {
    case 't': case 'tonnes': case 'tonne': return HF.conversion.tonnesToDaN(valeur);
    case 'kn': return valeur * 100;   // 1 kN = 100 daN
    case 'n':  return valeur / 10;    // 1 daN = 10 N
    default:   return valeur;         // déjà en daN
  }
}

// Diamètre (mm) donnant une surface cible (cm²) : aire = π(bore/10)²/4.
function boreDepuisAire(aireCm2) {
  return Math.sqrt((4 * aireCm2) / Math.PI) * 10;
}

function calculerVerin(v, hypotheses) {
  const r = { nom: v.nom, type: v.type, workMode: v.workMode, quantite: v.quantite ?? 1 };
  const pression = v.pression;

  // --- Résolution de la géométrie selon le type ---
  let bore = v.bore, rod = v.rod;
  if (v.type === 'nouveau') {
    const forceReqDaN = forceEnDaN(v.requiredForce, v.forceUnit);
    const aireRequise = pression > 0 ? forceReqDaN / pression : 0; // cm²
    bore = boreDepuisAire(aireRequise);
    r.recommendedBore = bore;          // théorique ; l'arrondi normalisé = étape sélection
    r.forceRequiseDaN = forceReqDaN;
    if (v.rod == null) {
      rod = null;                      // pas de tige fournie pour un vérin neuf
      hypotheses.push(`Vérin "${v.nom}" (nouveau) : tige non fournie -> côté annulaire (retour) non calculé.`);
    }
  }

  // --- Surfaces ---
  r.pistonArea = HF.cylinder.pistonArea(bore);                 // cm²
  r.annularArea = (rod != null) ? HF.cylinder.annularArea(bore, rod) : null;

  // --- Forces ---
  r.forcePush = HF.cylinder.forcePush(r.pistonArea, pression);                 // daN
  r.forcePull = (r.annularArea != null) ? HF.cylinder.forcePull(r.annularArea, pression) : null;
  r.tonnage = HF.conversion.daNToTonnes(r.forcePush);                          // t

  // --- Volumes (L) ---
  r.volumeOut = HF.cylinder.volumeOut(r.pistonArea, v.stroke);
  r.volumeIn = (r.annularArea != null) ? HF.cylinder.volumeIn(r.annularArea, v.stroke) : null;

  // --- Débits (L/min) ---
  r.flowOut = HF.cylinder.flowRate(r.volumeOut, v.timeOut);
  r.flowIn = (r.volumeIn != null) ? HF.cylinder.flowRate(r.volumeIn, v.timeIn) : 0;
  r.flowMax = Math.max(r.flowOut, r.flowIn);

  // --- Vitesse sortie (cm/s) ---
  r.speedOut = HF.cylinder.speed(r.flowOut, r.pistonArea);

  // --- Maintien de pression : accepté, thermo NON modélisée en v1 ---
  if (v.pressureHold) {
    r.pressureHold = true;
    r.holdTime = v.holdTime;
    hypotheses.push(`Vérin "${v.nom}" : maintien de pression déclaré (${v.holdTime ?? '?'} s) -> ` +
      `débit de maintien ≈ 0 pris en compte, MAIS chaleur de laminage pompe variable NON modélisée (v2).`);
  }

  return r;
}

function calculerBesoins(spec) {
  const hypotheses = [];
  const verins = (spec.verins || []).map(v => calculerVerin(v, hypotheses));

  // --- Débit total : Σ(simultanés) + MAX(alternés) ---
  let sommeSimultanes = 0;
  let maxAlterne = 0;
  for (const r of verins) {
    if (r.quantite === 0) continue;          // vérin désactivé -> exclu du débit (comme l'appli)
    if (r.workMode === 'alterné') maxAlterne = Math.max(maxAlterne, r.flowMax);
    else sommeSimultanes += r.flowMax * r.quantite;   // 'simultané' par défaut
  }
  const debitTotal = sommeSimultanes + maxAlterne;

  // --- Puissance ---
  const rendement = spec.systeme?.rendement ?? 0.9;
  const pressionSysteme = spec.systeme?.pression
    ?? Math.max(0, ...(spec.verins || []).map(v => v.pression || 0));
  const puissanceHydraulique = HF.power.hydraulic(pressionSysteme, debitTotal);
  const puissanceAbsorbee = HF.power.absorbed(puissanceHydraulique, rendement);
  const pertes = HF.power.losses(puissanceAbsorbee, puissanceHydraulique);

  // --- Réservoir (si géométrie ou volume fourni) ---
  let reservoir = null;
  const res = spec.reservoir;
  if (res) {
    if (res.volume != null) {
      reservoir = { volume: res.volume, surface: null };
      hypotheses.push('Réservoir : volume fourni directement, surface d\'échange non déduite.');
    } else if (res.hauteur && res.longueur && res.largeur) {
      const L = res.longueur / 1000, l = res.largeur / 1000, h = res.hauteur / 1000; // mm -> m
      reservoir = {
        volume: L * l * h * 1000,                       // m³ -> L
        surface: 2 * (L * l + L * h + l * h)             // m² (toutes faces)
      };
    }
  }

  // --- Thermique (bilan de base ; le maintien de pression n'y est pas inclus) ---
  const fluide = spec.fluide || {};
  const deltaT = (fluide.tempHuileMax != null && fluide.tempAmbiante != null)
    ? fluide.tempHuileMax - fluide.tempAmbiante : null;
  const coeff = fluide.coeffConvection ?? 0.010;
  const dissipationNaturelle = (reservoir?.surface != null && deltaT != null)
    ? HF.thermal.naturalDissipation(reservoir.surface, deltaT, coeff) : null;
  const chaleurGeneree = pertes; // kW, pertes de puissance = chaleur en régime continu
  const bilan = (dissipationNaturelle != null) ? chaleurGeneree - dissipationNaturelle : null;
  if (bilan != null && bilan > 0) {
    hypotheses.push(`Bilan thermique positif (${bilan.toFixed(2)} kW) -> refroidisseur requis (étape sélection).`);
  }

  return {
    verins,
    systeme: {
      debitTotal,
      debitSimultanes: sommeSimultanes,
      debitAlterneMax: maxAlterne,
      pression: pressionSysteme,
      rendement,
      puissanceHydraulique,
      puissanceAbsorbee,
      pertes,
      vitesseMoteur: spec.systeme?.vitesseMoteur ?? 1450,
      poles: spec.systeme?.poles ?? 4,
      typeUtilisation: spec.systeme?.typeUtilisation ?? 'continu'
    },
    reservoir,
    thermique: {
      deltaT,
      chaleurGeneree,
      dissipationNaturelle,
      bilan
    },
    hypotheses
  };
}

/**
 * selectionnerComposants(besoins, selecteurs) -> composants  [brique 2/2, archi B]
 *
 * Orchestrateur PUR : aucune logique de sélection à l'intérieur. Il appelle des
 * sélecteurs INJECTÉS (tes fonctions prouvées recommendPump / selectWEGMotor /
 * selectHydacCooler) avec les bonnes entrées tirées de besoins, et normalise
 * leurs retours. Zéro réécriture de ta logique catalogue, zéro divergence.
 *
 * Navigateur :
 *   selectionnerComposants(besoins, {
 *     pompe:         recommendPump,
 *     moteur:        selectWEGMotor,
 *     refroidisseur: selectHydacCooler
 *   })
 * Tests : on injecte des sélecteurs bidon (pas besoin des catalogues).
 */
function selectionnerComposants(besoins, selecteurs = {}) {
  const s = besoins.systeme || {};
  const t = besoins.thermique || {};
  const res = { pompe: null, moteur: null, refroidisseur: null, notes: [] };

  if (typeof selecteurs.pompe === 'function') {
    const reco = selecteurs.pompe(s.debitTotal, s.pression, s.vitesseMoteur, s.typeUtilisation);
    res.pompe = Array.isArray(reco) ? (reco[0] ?? null) : (reco ?? null);
    if (Array.isArray(reco) && reco.length === 0)
      res.notes.push('Aucune pompe ne couvre le débit/pression demandés.');
  }

  if (typeof selecteurs.moteur === 'function') {
    // Le moteur suit la pompe : on le dimensionne sur la puissance absorbée de la
    // pompe choisie (qui dépend de SON rendement), sinon sur l'absorbée système.
    const pAbs = (res.pompe && res.pompe.puissance_absorbee != null)
      ? parseFloat(res.pompe.puissance_absorbee) : s.puissanceAbsorbee;
    const m = selecteurs.moteur(pAbs, s.poles);
    res.moteur = (m && typeof m === 'object' && 'motor' in m) ? m.motor : (m ?? null);
    if (m && m.oversized)
      res.notes.push('Aucun moteur standard assez puissant : surdimensionnement requis.');
  }

  // Refroidisseur seulement si le bilan thermique l'exige
  if (typeof selecteurs.refroidisseur === 'function' && t.bilan != null && t.bilan > 0) {
    res.refroidisseur = selecteurs.refroidisseur(t.bilan, s.debitTotal) ?? null;
  }

  return res;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculerBesoins, selectionnerComposants, forceEnDaN, boreDepuisAire };
}
