/**
 * formulas.js — Source unique de vérité des formules hydrauliques.
 * Extrait de index_PDF_CLEAN.html (lignes 2723-2929).
 *
 * Compatible double usage :
 *  - Navigateur : chargé en <script src="formulas.js">, HYDRAULIC_FORMULAS
 *    devient une globale partagée entre les scripts classiques.
 *  - Node / Vitest : importé via require/import grace au footer d'export.
 *
 * REGLE CRITIQUE : Force = Surface(cm²) × Pression(bar) = daN. PAS de × 10.
 */

 const HYDRAULIC_FORMULAS = {
 // === CALCULS DES VERINS ===
 cylinder: {
 // Surface du piston (cm²)
 pistonArea: (boreMM) => Math.PI * Math.pow(boreMM / 10, 2) / 4,
 
 // Surface annulaire (cm²)
 annularArea: (boreMM, rodMM) => {
 const pistonArea = Math.PI * Math.pow(boreMM / 10, 2) / 4;
 const rodArea = Math.PI * Math.pow(rodMM / 10, 2) / 4;
 return pistonArea - rodArea;
 },
 
 // Force theorique en POUSSEE (daN)
 // FORMULE CORRECTE: F = S × P (PAS de × 10 !)
 // Avec S en cm² et P en bar, le resultat est directement en daN
 forcePush: (areaCm2, pressureBar) => areaCm2 * pressureBar,
 
 // Force theorique en TRACTION (daN)
 forcePull: (annularAreaCm2, pressureBar) => annularAreaCm2 * pressureBar,
 
 // Volume cote piston (L)
 volumeOut: (areaCm2, strokeMM) => (areaCm2 * strokeMM / 10) / 1000,
 
 // Volume cote annulaire (L)
 volumeIn: (annularAreaCm2, strokeMM) => (annularAreaCm2 * strokeMM / 10) / 1000,
 
 // Debit (L/min)
 flowRate: (volumeL, timeS) => timeS > 0 ? (volumeL / timeS) * 60 : 0,
 
 // Vitesse de deplacement (cm/s)
 speed: (flowLmin, areaCm2) => areaCm2 > 0 ? (flowLmin * 1000) / (60 * areaCm2) : 0,
 
 // Formule alternative vitesse (m/s)
 speedMS: (flowLmin, diameterMM) => {
 const areaCm2 = Math.PI * Math.pow(diameterMM / 10, 2) / 4;
 return (flowLmin / 60) / (areaCm2 / 10000); // conversion en m/s
 }
 },
 
 // === PRESSION ===
 pressure: {
 // Pression (bar) = Force (daN) / Surface (cm²)
 fromForce: (forceDaN, areaCm2) => areaCm2 > 0 ? forceDaN / areaCm2 : 0
 },
 
 // === PUISSANCE ===
 power: {
 // Puissance hydraulique (kW) = (P × Q) / 600
 hydraulic: (pressureBar, flowLmin) => (pressureBar * flowLmin) / 600,
 
 // Puissance hydraulique en ch (chevaux)
 hydraulicHP: (pressureBar, flowLmin) => (pressureBar * flowLmin) / 441.6,
 
 // Puissance absorbee (kW) = Puissance hydraulique / Rendement
 absorbed: (hydraulicPowerKW, efficiency) => efficiency > 0 ? hydraulicPowerKW / efficiency : 0,
 
 // Pertes thermiques (kW) = Puissance absorbee - Puissance hydraulique
 losses: (absorbedKW, hydraulicKW) => absorbedKW - hydraulicKW
 },
 
 // === COUPLE MOTEUR ===
 torque: {
 // Couple moteur hydraulique (m.daN) = 1.59 × p × q
 // p = pression (bar), q = cylindree (L/tr)
 hydraulicMotor: (pressureBar, displacementLtr) => 1.59 * pressureBar * displacementLtr
 },
 
 // === THERMIQUE ===
 thermal: {
 // Elevation de temperature par laminage (°C)
 tempRiseLamination: (pressureDropBar) => pressureDropBar / 16.8,
 
 // Dissipation naturelle par surface reservoir (kW)
 // Approximativement 15-20 W/m² par °C de difference
 naturalDissipation: (surfaceM2, deltaTempC, coefficient = 0.018) => {
 return surfaceM2 * deltaTempC * coefficient;
 }
 },
 
 // === PERTES DE CHARGE ===
 pressureDrop: {
 // Viscosite cinematique de l'huile (cSt = mm²/s) a une temperature donnee.
 // Modele de Walther (ASTM D341) cale sur une huile minerale VI~100.
 // isoGrade = viscosite a 40°C (ex: 46 pour ISO VG 46).
 // APPROXIMATION : pour un calcul critique, utiliser la fiche technique
 // de l'huile reelle (la viscosite varie enormement avec la temperature).
 oilViscosity: (isoGrade, tempC) => {
 const B = 3.69; // pente Walther typique huile minerale VI~100
 const loglog40 = Math.log10(Math.log10(isoGrade + 0.7));
 const A = loglog40 + B * Math.log10(313.15); // calage a 40°C
 const loglog = A - B * Math.log10(tempC + 273.15);
 return Math.pow(10, Math.pow(10, loglog)) - 0.7; // cSt
 },

 // Masse volumique de l'huile (kg/m³), correction lineaire en temperature.
 oilDensity: (tempC) => 875 - 0.65 * (tempC - 15),

 // Nombre de Reynolds (sans dimension). v en m/s, D en mm, nu en cSt.
 reynolds: (velocityMS, diameterMM, viscosityCSt) =>
 (1000 * velocityMS * diameterMM) / viscosityCSt,

 // Coefficient de frottement de Darcy (sans dimension).
 // Laminaire (Re<=2300) : 64/Re. Turbulent lisse (Re>=4000) : Blasius.
 // Transition : interpolation lineaire pour eviter la discontinuite.
 frictionFactor: (Re) => {
 if (Re < 1e-9) return 0;
 const lam = (r) => 64 / r;
 const turb = (r) => 0.316 / Math.pow(r, 0.25);
 if (Re <= 2300) return lam(Re);
 if (Re >= 4000) return turb(Re);
 const x = (Re - 2300) / 1700;
 return lam(2300) + (turb(4000) - lam(2300)) * x;
 },

 // Perte de charge par frottement dans une conduite droite (bar).
 // Darcy-Weisbach : Dp = lambda * (L/D) * (rho/2) * v².
 // Q en L/min, D interieur en mm, L en m, isoGrade (cSt a 40°C), T huile en °C.
 // NOTE : frottement en conduite droite uniquement. Pour les pertes
 // singulieres (coudes, vannes, raccords), ajouter des longueurs
 // equivalentes ou majorer de ~10-30%.
 line: (flowLmin, innerDiameterMM, lengthM, isoGrade, oilTempC) => {
 const pd = HYDRAULIC_FORMULAS.pressureDrop;
 const D_m = innerDiameterMM / 1000;
 const area = Math.PI * Math.pow(D_m / 2, 2);
 const v = (flowLmin / 60000) / area; // m/s
 const nu = pd.oilViscosity(isoGrade, oilTempC); // cSt
 const rho = pd.oilDensity(oilTempC); // kg/m³
 const Re = pd.reynolds(v, innerDiameterMM, nu);
 const lambda = pd.frictionFactor(Re);
 const dpPa = lambda * (lengthM / D_m) * (rho / 2) * v * v;
 return {
 velocity: v, // m/s
 reynolds: Re,
 regime: Re <= 2300 ? 'laminaire' : (Re >= 4000 ? 'turbulent' : 'transition'),
 viscosity: nu, // cSt a la temperature T
 density: rho, // kg/m³
 lambda: lambda,
 deltaP_bar: dpPa / 1e5
 };
 }
 },
 
 // === COMPRESSION ===
 compression: {
 // Variation de volume par compression (cm³)
 volumeChange: (pressureBar, volumeCm3) => (pressureBar * volumeCm3) / 15625,
 
 // Coefficient de compressibilite
 compressibilityCoeff: () => 1 / 15625 // pour huile hydraulique standard
 },
 
 // === DEBIT A TRAVERS ORIFICE ===
 orifice: {
 // Debit en mince paroi (L/min)
 flow: (coefficientC, sectionMm2, pressureDropBar, density) => {
 return coefficientC * sectionMm2 * Math.sqrt((2 * pressureDropBar) / density);
 },
 
 // Coefficient d'orifice standard
 standardCoeff: () => 0.64
 },
 
 // === EPAISSEUR TUYAU (DIN 2413) ===
 pipe: {
 // Epaisseur necessaire (mm)
 wallThickness: (outerDiameterMM, pressureBar, safetyFactor, resistanceFactor) => {
 return (outerDiameterMM * pressureBar * safetyFactor * 10) / (200 * resistanceFactor);
 },
 
 // Evasement sous pression (loi de Hooke) (mm)
 expansion: (pressureBar, innerDiameterMM, wallThicknessMM, elasticModulus = 206000) => {
 return (0.0425 * pressureBar * innerDiameterMM * (innerDiameterMM + wallThicknessMM)) / 
 (elasticModulus * wallThicknessMM);
 }
 },
 
 // === CONVERSIONS ===
 conversion: {
 tonnesToDaN: (tonnes) => tonnes * 980, // 1 tonne-force = 9.806 kN ≈ 980 daN
 daNToTonnes: (daN) => daN / 980,
 barToPa: (bar) => bar * 100000,
 paTomBar: (Pa) => Pa / 100000,
 kWToHP: (kW) => kW * 1.35962, // 1 kW = 1.35962 ch
 hpToKW: (hp) => hp / 1.35962
 },
 
 // === CONSTANTES ===
 constants: {
 PI: Math.PI,
 GRAVITY: 9.81, // m/s²
 DENSITY_OIL: 870, // kg/m³ (huile hydraulique typique)
 KINEMATIC_VISCOSITY_VG46: 46e-6, // m²/s a 40°C
 KINEMATIC_VISCOSITY_VG68: 68e-6, // m²/s a 40°C
 ELASTIC_MODULUS_STEEL: 206000, // N/mm² (module d'Young de l'acier)
 TONNEF_TO_DAN: 980, // 1 tonne-force = 980 daN
 BAR_TO_NCM2: 10 // 1 bar = 10 N/cm²
 },
 
 // === NOTES IMPORTANTES ===
 notes: {
 forceCylinder: "F = S × P (avec S en cm² et P en bar -> F en daN). PAS de multiplication par 10 !",
 units: "Toujours verifier la coherence des unites avant tout calcul",
 efficiency: "Appliquer un rendement de 0.90-0.95 pour passer des valeurs theoriques aux valeurs reelles",
 safety: "Prevoir des marges de securite : pression ×1.3, puissance ×1.1, debit ×1.15"
 }
 };

// --- Export pour Node / Vitest (ignore par le navigateur en script classique) ---
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HYDRAULIC_FORMULAS;
}
