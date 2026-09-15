// sync.mjs — rapprochement quotidien des donnees Routéo
//
// Execute par le workflow data-sync.yml (cron quotidien ou manuel).
// 1. Lit modeles.json + la consigne canonique (protocole/consigne.txt)
// 2. Fetch l API publique OpenRouter (/api/v1/models) : tarifs et
//    contextes machine-readable — le modele LLM n a PAS d acces web,
//    on lui fournit donc les donnees source (lecon du 2026-09-15 :
//    un appel chat/completions ne peut pas « verifier sur les pages » ;
//    sans donnees fournies, le modele refuse ou — pire — invente).
// 3. Appelle l API (compatible OpenAI / OpenRouter) pour la
//    reconciliation, nettoie la reponse, la valide strictement
// 4. Ecrit modeles.json et resume les ecarts dans $GITHUB_STEP_SUMMARY
//
// Variables requises :
//   secret LLM_API_KEY  — cle API (OpenRouter ou equivalent)
//   var    LLM_MODEL    — identifiant du modele (ex. z-ai/glm-5.3-flash)
//   var    LLM_BASE_URL — optionnel (defaut : https://openrouter.ai/api/v1)
//   var    OPENROUTER_MODELS_URL — optionnel (defaut : API publique OpenRouter)

import { readFileSync, writeFileSync } from 'node:fs';
import { valider, ecarts } from './validate.mjs';

const FICHIER = 'modeles.json';
const CONSIGNE = 'protocole/consigne.txt';

const racine = (rel) => new URL('../' + rel, import.meta.url);

function fail(msg) {
  console.error('SYNC ÉCHOUÉ : ' + msg);
  process.exit(1);
}

function resume(texte) {
  const cible = process.env.GITHUB_STEP_SUMMARY;
  if (cible) {
    writeFileSync(cible, texte + '\n', { flag: 'a' });
  }
  console.log(texte);
}

// --- 0. Environnement ------------------------------------------------------
const cle = process.env.LLM_API_KEY;
const modele = process.env.LLM_MODEL;
const baseUrl = (process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const modelsUrl = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';
if (!cle) fail('secret LLM_API_KEY absent — Settings > Secrets and variables > Actions.');
if (!modele) fail('variable LLM_MODEL absente — Settings > Secrets and variables > Actions > Variables.');

// --- 1. Lecture des entrees ------------------------------------------------
let actuel;
try {
  actuel = JSON.parse(readFileSync(racine(FICHIER), 'utf8'));
} catch (err) {
  fail('modeles.json illisible : ' + err.message);
}
let consigne;
try {
  consigne = readFileSync(racine(CONSIGNE), 'utf8').trim();
} catch (err) {
  fail('protocole/consigne.txt illisible : ' + err.message);
}

// --- 2. Donnees machine OpenRouter ------------------------------------------
let extrait;
try {
  const r = await fetch(modelsUrl, { headers: { 'User-Agent': 'routeo-data-sync' } });
  if (!r.ok) fail('API OpenRouter models en echec : HTTP ' + r.status);
  const j = await r.json();
  const slugs = new Set(actuel.modeles.map((m) => m.slug));
  extrait = (j.data || [])
    .filter((m) => slugs.has(m.id))
    .map((m) => ({
      id: m.id,
      prix_par_token: {
        entree: m.pricing && m.pricing.prompt,
        sortie: m.pricing && m.pricing.completion,
      },
      contexte: m.context_length,
    }));
  console.log('API OpenRouter : ' + (j.data || []).length + ' modeles, ' +
    extrait.length + ' correspondent au jeu courant (' + actuel.modeles.length + ').');
} catch (err) {
  fail('API OpenRouter models injoignable : ' + err.message);
}
if (!extrait.length) {
  fail('aucune correspondance entre les slugs du jeu courant et l API OpenRouter — verifier les slugs.');
}

// --- 3. Appel LLM (reconciliation, sans web) --------------------------------
const message = consigne +
  '\n\n===== JEU DE DONNEES ACTUEL (version ' + actuel.meta.version +
  ', verifie le ' + actuel.meta.date_verification + ') =====\n\n' +
  JSON.stringify(actuel) +
  '\n\n===== EXTRAIT MACHINE OPENROUTER (' + extrait.length +
  ' modeles, prix en USD PAR TOKEN) =====\n\n' +
  JSON.stringify(extrait);

console.log('Appel du modele ' + modele + ' sur ' + baseUrl + ' ...');
let reponse;
try {
  const r = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + cle,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modele,
      temperature: 0.1,
      messages: [{ role: 'user', content: message }],
    }),
  });
  if (!r.ok) fail('appel API en echec : HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 400));
  reponse = await r.json();
} catch (err) {
  fail('appel API en echec : ' + err.message);
}

const brut = reponse?.choices?.[0]?.message?.content;
if (!brut) fail('reponse LLM vide ou inattendue : ' + JSON.stringify(reponse).slice(0, 400));

// --- 4. Extraction et validation --------------------------------------------
const texte = brut
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();

let candidat;
try {
  candidat = JSON.parse(texte);
} catch (err) {
  fail('la reponse du modele n est pas du JSON valide : ' + err.message +
    '\n--- debut de reponse ---\n' + brut.slice(0, 600));
}

const { erreurs, avertissements } = validerAvecGardes(candidat, actuel);
const ecartsListe = ecarts(actuel, candidat);

if (erreurs.length) {
  let sortie = '## ❌ Validation échouée — données non appliquées\n\n';
  sortie += erreurs.map((x) => '- ' + x).join('\n');
  resume(sortie);
  fail(erreurs.length + ' erreur(s) de validation, modeles.json non modifié.');
}

// --- 5. Ecriture ------------------------------------------------------------
writeFileSync(racine(FICHIER), JSON.stringify(candidat, null, 2) + '\n');

let sortie = '## ✅ Données Routéo mises à jour\n\n';
sortie += '- Version : ' + actuel.meta.version + ' → **' + candidat.meta.version + '**\n';
sortie += '- Vérification : ' + candidat.meta.date_verification + '\n';
sortie += '- Modèles : ' + candidat.modeles.length + ' · Correspondances OpenRouter : ' + extrait.length + '\n\n';
sortie += '### Écarts constatés (' + ecartsListe.length + ')\n\n';
sortie += ecartsListe.length
  ? ecartsListe.map((x) => '- ' + x).join('\n')
  : '_Aucun écart : tarifs confirmés sans changement._';
const slugs = new Set(actuel.modeles.map((m) => m.slug));
const matchIds = new Set(extrait.map((x) => x.id));
const sansCorrespondance = [...slugs].filter((s) => !matchIds.has(s));
if (sansCorrespondance.length) {
  sortie += '\n\n### Sans correspondance OpenRouter (' + sansCorrespondance.length +
    ') — inchangés, à couvrir par la passe éditoriale\n\n' +
    sansCorrespondance.map((x) => '- `' + x + '`').join('\n');
}
if (avertissements.length) {
  sortie += '\n\n### ⚠️ Avertissements (' + avertissements.length + ') — à relire\n\n' +
    avertissements.map((x) => '- ' + x).join('\n');
}
resume(sortie);
console.log('SYNC OK — version ' + candidat.meta.version + ' écrite.');

// --- gardes anti-hallucination (import tardif pour lisibilite) --------------
function validerAvecGardes(candidat, actuel) {
  const base = valider(candidat, actuel);
  // Variation de prix forte : legitimement possible (marche volatil) mais
  // signal d'alerte prioritaire — surtout en serie (symptome d'invention).
  if (actuel && Array.isArray(actuel.modeles)) {
    const avant = new Map(actuel.modeles.map((m) => [m.id, m]));
    let modifies = 0;
    candidat.modeles.forEach((m) => {
      const a = avant.get(m.id);
      if (!a) return;
      const bouge = (k) => a[k] !== m[k] && typeof m[k] === 'number';
      if (bouge('prix_entree') || bouge('prix_sortie')) modifies++;
      ['prix_entree', 'prix_sortie'].forEach((k) => {
        if (!bouge(k) || a[k] === 0) return;
        const ratio = m[k] / a[k];
        if (ratio >= 5 || ratio <= 0.2) {
          base.avertissements.push(m.nom + ' : ' + k + ' varie fortement (' +
            a[k] + ' vers ' + m[k] + ', ×' + ratio.toFixed(2) + ') — relier a une source avant diffusion.');
        }
      });
    });
    const part = modifies / actuel.modeles.length;
    if (part > 0.25) {
      base.avertissements.push(Math.round(part * 100) + '% des modeles ont change de prix en un seul passage (' +
        modifies + '/' + actuel.modeles.length + ') — symptome possible d invention, relire le resume.');
    }
  }
  return base;
}
