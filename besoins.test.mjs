/**
 * besoins.test.mjs — Tests bout-en-bout du moteur headless.
 * Exécution : node --test
 * Valeurs attendues calculées à la main (référence physique).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { calculerBesoins } = require('./besoins.js');

const close = (a, b, rel = 1e-4) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-6),
            `attendu ${b}, obtenu ${a}`);

// ============================================================
// Scénario 1 : un vérin existant, simultané
// ============================================================
test('[S1] vérin existant 100/56, 500mm, 160 bar', () => {
  const b = calculerBesoins({
    systeme: { pression: 160, rendement: 0.9 },
    verins: [{ nom: 'V1', type: 'existant', workMode: 'simultané',
               bore: 100, rod: 56, stroke: 500, pression: 160,
               timeOut: 5, timeIn: 5, quantite: 1 }]
  });
  const v = b.verins[0];
  close(v.pistonArea, 78.53982);
  close(v.annularArea, 53.90973);
  close(v.forcePush, 12566.37);
  close(v.forcePull, 8625.557);
  close(v.tonnage, 12.8228);
  close(v.volumeOut, 3.926991);
  close(v.flowOut, 47.12389);
  close(v.flowIn, 32.34584);
  close(v.flowMax, 47.12389);
  close(v.speedOut, 10.0);
  close(b.systeme.debitTotal, 47.12389);
  close(b.systeme.puissanceHydraulique, 12.5664);
  close(b.systeme.puissanceAbsorbee, 13.9626);
  close(b.systeme.pertes, 1.39626);
});

// ============================================================
// Scénario 2 : règle de débit  Σ(simultanés) + MAX(alternés)
// ============================================================
test('[S2] Q = Σ(simultané) + MAX(alterné)', () => {
  const b = calculerBesoins({
    systeme: { pression: 200, rendement: 0.9 },
    verins: [
      { nom: 'A', type: 'existant', workMode: 'simultané', bore: 80,  rod: 45, stroke: 400, pression: 200, timeOut: 4, timeIn: 4 },
      { nom: 'B', type: 'existant', workMode: 'alterné',   bore: 63,  rod: 36, stroke: 300, pression: 200, timeOut: 3 },
      { nom: 'C', type: 'existant', workMode: 'alterné',   bore: 100, rod: 56, stroke: 500, pression: 200, timeOut: 5 }
    ]
  });
  close(b.systeme.debitSimultanes, 30.1593);          // A seul
  close(b.systeme.debitAlterneMax, 47.12389);          // max(B=18.70, C=47.12)
  close(b.systeme.debitTotal, 77.2832);                // 30.16 + 47.12
});

// ============================================================
// Scénario 3 : vérin NEUF dimensionné depuis la force (120 t)
// ============================================================
test('[S3] vérin nouveau : force -> recommendedBore (round-trip)', () => {
  const b = calculerBesoins({
    systeme: { pression: 250, rendement: 0.9 },
    verins: [{ nom: 'N1', type: 'nouveau', workMode: 'simultané',
               requiredForce: 120, forceUnit: 't', pression: 250, stroke: 800, timeOut: 8 }]
  });
  const v = b.verins[0];
  close(v.recommendedBore, 244.73, 1e-3);
  close(v.forcePush, 117600);            // doit redonner exactement la force requise
  close(v.tonnage, 120.0);
  close(v.volumeOut, 37.632);
  close(v.flowOut, 282.24);
  assert.equal(v.annularArea, null);     // pas de tige fournie
  assert.equal(v.flowIn, 0);
  assert.ok(b.hypotheses.some(h => h.includes('tige non fournie')),
            'doit signaler la tige manquante');
});

// ============================================================
// Scénario 4 : maintien de pression accepté mais thermo non modélisée
// ============================================================
test('[S4] maintien de pression : drapeau + hypothèse explicite', () => {
  const b = calculerBesoins({
    systeme: { pression: 250, rendement: 0.9 },
    verins: [{ nom: 'H1', type: 'existant', workMode: 'simultané',
               bore: 80, rod: 45, stroke: 400, pression: 250,
               timeOut: 4, timeIn: 4, pressureHold: true, holdTime: 10 }]
  });
  assert.equal(b.verins[0].pressureHold, true);
  assert.ok(b.hypotheses.some(h => h.includes('laminage') && h.includes('NON modélisée')),
            'doit signaler que la chaleur de laminage n\'est pas modélisée');
});

// ============================================================
// Scénario 5 : réservoir + bilan thermique de base
// ============================================================
test('[S5] réservoir géométrique -> volume, surface, dissipation', () => {
  const b = calculerBesoins({
    systeme: { pression: 160, rendement: 0.9 },
    fluide: { tempHuileMax: 60, tempAmbiante: 20, coeffConvection: 0.010 },
    reservoir: { longueur: 1000, largeur: 800, hauteur: 600 }, // mm
    verins: [{ nom: 'V1', type: 'existant', workMode: 'simultané',
               bore: 100, rod: 56, stroke: 500, pression: 160, timeOut: 5, timeIn: 5 }]
  });
  close(b.reservoir.volume, 480.0);                 // 1×0.8×0.6 m³ = 0.48 m³ = 480 L
  close(b.reservoir.surface, 2 * (0.8 + 0.6 + 0.48)); // = 3.76 m²
  close(b.thermique.deltaT, 40);
  close(b.thermique.dissipationNaturelle, 3.76 * 40 * 0.010); // = 1.504 kW
});

// ============================================================
// Scénario 6 : vérin désactivé (quantité 0) exclu du débit
// ============================================================
test('[S6] qty=0 exclut le vérin du débit (alterné inclus)', () => {
  const b = calculerBesoins({
    systeme: { pression: 200, rendement: 0.9 },
    verins: [
      { nom: 'actif',    type: 'existant', workMode: 'alterné', bore: 100, rod: 56, stroke: 500, pression: 200, timeOut: 5, quantite: 1 },
      { nom: 'desactive',type: 'existant', workMode: 'alterné', bore: 200, rod: 90, stroke: 800, pression: 200, timeOut: 5, quantite: 0 }
    ]
  });
  // le gros vérin désactivé ne doit PAS imposer son flowMax au MAX alterné
  close(b.systeme.debitAlterneMax, 47.12389);  // celui du vérin actif seul
});
