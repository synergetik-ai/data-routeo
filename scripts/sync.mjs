// sync.mjs — verification LLM et regeneration du jeu de donnees Routéo
//
// Execute par le workflow data-sync.yml (cron quotidien ou manuel).
// 1. Lit modeles.json + la consigne canonique (protocole/consigne.txt)
// 2. Appelle une API compatible OpenAI / OpenRouter
// 3. Nettoie la reponse, la parse, la valide (scripts/validate.mjs)
// 4. Ecrit modeles.json et resume les ecarts dans $GITHUB_STEP_SUMMARY
//
// Variables requises :
//   secret LLM_API_KEY  — cle API (OpenRouter ou equivalent)
//   var    LLM_MODEL    — identifiant du modele (ex. openai/gpt-5.6-luna)
//   var    LLM_BASE_URL — optionnel (defaut : https://openrouter.ai/api/v1)

import { readFileSync, writeFileSync } from 'node:fs';

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

const message = consigne +
  '\n\n===== JEU DE DONNEES ACTUEL (version ' + actuel.meta.version +
  ', verifie le ' + actuel.meta.date_verification + ') =====\n\n' +
  JSON.stringify(actuel);

// --- 2. Appel LLM -----------------------------------------------------------
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

// --- 3. Extraction et validation --------------------------------------------
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

const { erreurs, avertissements } = valider(candidat, actuel);
const ecartsListe = ecarts(actuel, candidat);

if (erreurs.length) {
  let sortie = '## ❌ Validation échouée — données non appliquées\n\n';
  sortie += erreurs.map((x) => '- ' + x).join('\n');
  resume(sortie);
  fail(erreurs.length + ' erreur(s) de validation, modeles.json non modifie.');
}

// --- 4. Ecriture ------------------------------------------------------------
writeFileSync(racine(FICHIER), JSON.stringify(candidat, null, 2) + '\n');

let sortie = '## ✅ Données Routéo mises à jour\n\n';
sortie += '- Version : ' + actuel.meta.version + ' → **' + candidat.meta.version + '**\n';
sortie += '- Vérification : ' + candidat.meta.date_verification + '\n';
sortie += '- Modèles : ' + candidat.modeles.length + ' · Cas d\'usage : ' + candidat.cas_usage.length + '\n\n';
sortie += '### Écarts constatés (' + ecartsListe.length + ')\n\n';
sortie += ecartsListe.length
  ? ecartsListe.map((x) => '- ' + x).join('\n')
  : '_Aucun écart : tarifs confirmés sans changement._';
if (avertissements.length) {
  sortie += '\n\n### Avertissements (' + avertissements.length + ')\n\n' +
    avertissements.map((x) => '- ' + x).join('\n');
}
resume(sortie);
console.log('SYNC OK — version ' + candidat.meta.version + ' écrite.');
