// validate.mjs — validation du jeu de donnees Routéo
//
// Usage programme : import { valider } from './validate.mjs'
// Usage CLI       : node scripts/validate.mjs [chemin/modeles.json]
//
// Verifie la structure, les valeurs autorisees (meta.schema), les champs
// numeriques, et — si un jeu de reference est fourni (2e argument ou
// export) — les champs verrouilles et la non-disparition des modeles.

import { readFileSync } from 'node:fs';

/** Champs que la mise a jour n'a pas le droit de modifier sans source datee. */
const CHAMPS_VERROUILLES = [
  'souverainete', 'poids_ouverts', 'europe',
  'params_total', 'params_actifs', 'classe_materiel',
];

const CHAMPS_REQUIS = [
  'id', 'nom', 'editeur', 'slug', 'palier', 'prix_entree', 'prix_sortie',
  'contexte', 'poids_ouverts', 'europe', 'souverainete', 'licence',
  'vitesse', 'statut', 'scores',
];

const ENUMS_A_VERIFIER = ['palier', 'statut', 'vitesse', 'souverainete'];

/**
 * Valide un jeu de donnees candidat.
 * @param {object} ap       Jeu candidat (issu du LLM).
 * @param {object|null} av  Jeu de reference (donnees actuelles) ou null.
 * @returns {{erreurs: string[], avertissements: string[]}}
 */
export function valider(ap, av = null) {
  const e = [];
  const w = [];

  // --- structure de base -------------------------------------------------
  if (!ap || typeof ap !== 'object' || Array.isArray(ap)) {
    return { erreurs: ['Le JSON ne decrit pas un objet.'], avertissements: [] };
  }
  if (!ap.meta || !ap.meta.version) e.push('meta.version est absent.');
  if (!ap.meta.date_verification) e.push('meta.date_verification est absent.');
  if (!Array.isArray(ap.meta.changelog) || ap.meta.changelog.length === 0) {
    e.push('meta.changelog est absent ou vide.');
  } else {
    const derniere = ap.meta.changelog[ap.meta.changelog.length - 1];
    if (!derniere.date || !derniere.resume) {
      e.push('meta.changelog : la derniere entree n a ni date ni resume.');
    } else if (ap.meta.date_verification && derniere.date !== ap.meta.date_verification) {
      e.push('meta.changelog : la derniere entree (' + derniere.date +
        ') ne correspond pas a meta.date_verification (' + ap.meta.date_verification + ').');
    }
  }
  if (!Array.isArray(ap.cas_usage) || ap.cas_usage.length === 0) {
    e.push('cas_usage est absent ou vide.');
  }
  if (!Array.isArray(ap.modeles) || ap.modeles.length === 0) {
    e.push('modeles est absent ou vide.');
  }
  if (e.length) return { erreurs: e, avertissements: w };

  // --- valeurs autorisees ------------------------------------------------
  const vals = (ap.meta.schema && ap.meta.schema.valeurs_autorisees) ||
    (av && av.meta && av.meta.schema && av.meta.schema.valeurs_autorisees) || {};
  const idsCas = ap.cas_usage.map((c) => c.id);

  ap.cas_usage.forEach((c) => {
    if (!c.id || !c.nom) e.push('cas_usage : une entree n a ni id ni nom.');
    if (typeof c.melange_sortie !== 'number') {
      e.push('cas_usage « ' + (c.id || '?') + ' » : melange_sortie absent ou non numerique.');
    }
  });

  // --- modeles -----------------------------------------------------------
  const vus = new Set();
  ap.modeles.forEach((m) => {
    const nom = m.id || m.nom || 'modele sans id';
    if (vus.has(m.id)) e.push(nom + ' : identifiant en double.');
    vus.add(m.id);

    CHAMPS_REQUIS.forEach((k) => {
      if (!(k in m)) e.push(nom + ' : champ ' + k + ' absent.');
    });
    ENUMS_A_VERIFIER.forEach((k) => {
      if (m[k] && vals[k] && Array.isArray(vals[k]) && !vals[k].includes(m[k])) {
        e.push(nom + ' : ' + k + ' vaut « ' + m[k] + ' », hors valeurs autorisees ' +
          JSON.stringify(vals[k]) + '.');
      }
    });
    if (typeof m.prix_entree !== 'number' || typeof m.prix_sortie !== 'number') {
      e.push(nom + ' : prix_entree / prix_sortie non numeriques.');
    } else if (m.prix_entree < 0 || m.prix_sortie < 0) {
      e.push(nom + ' : prix negatif.');
    }
    if (!m.scores || typeof m.scores !== 'object') {
      e.push(nom + ' : scores absent.');
    } else {
      idsCas.forEach((c) => {
        if (typeof m.scores[c] !== 'number') {
          e.push(nom + ' : score absent ou non numerique pour le cas « ' + c + ' ».');
        }
      });
    }
    if (m.verifie_le && !/^\d{4}-\d{2}-\d{2}$/.test(m.verifie_le)) {
      e.push(nom + ' : verifie_le n est pas au format AAAA-MM-JJ.');
    }
  });

  // --- comparaison au jeu de reference ------------------------------------
  if (av && Array.isArray(av.modeles)) {
    const avant = new Map(av.modeles.map((m) => [m.id, m]));

    // modeles supprimes : interdit (passer en statut retire)
    av.modeles.forEach((m) => {
      if (!vus.has(m.id)) {
        e.push(m.nom + ' : modele supprime du jeu. Interdit — passer son statut a « retire ».');
      }
    });

    // champs verrouilles : toute difference est refusee
    ap.modeles.forEach((m) => {
      const a = avant.get(m.id);
      if (!a) return; // ajout : autorise
      CHAMPS_VERROUILLES.forEach((k) => {
        if (String(a[k]) !== String(m[k])) {
          e.push(m.nom + ' : champ verrouille ' + k + ' modifie (' +
            JSON.stringify(a[k]) + ' vers ' + JSON.stringify(m[k]) +
            '). Exige une source datee dans le changelog — refuse par la validation.');
        }
      });
      if (a.licence !== m.licence && !m.verifie_le) {
        w.push(m.nom + ' : licence modifiee sans verifie_le.');
      }
    });
  }

  return { erreurs: e, avertissements: w };
}

/** Liste lisible des ecarts entre deux jeux (pour le resume de run). */
export function ecarts(av, ap) {
  const L = [];
  if (!av) return L;
  if (av.meta.version !== ap.meta.version) {
    L.push('Version : ' + av.meta.version + ' vers ' + ap.meta.version);
  }
  if (av.meta.date_verification !== ap.meta.date_verification) {
    L.push('Date de verification : ' + av.meta.date_verification +
      ' vers ' + ap.meta.date_verification);
  }
  const index = new Map(av.modeles.map((m) => [m.id, m]));
  ap.modeles.forEach((m) => {
    const a = index.get(m.id);
    if (!a) {
      L.push('Ajout : ' + m.nom + ' (' + m.prix_entree + ' / ' + m.prix_sortie + ')');
      return;
    }
    ['prix_entree', 'prix_sortie', 'contexte', 'statut', 'licence',
      'classe_materiel', 'params_total'].forEach((k) => {
      if (String(a[k]) !== String(m[k])) {
        L.push(m.nom + ' · ' + k + ' : ' + a[k] + ' vers ' + m[k]);
      }
    });
    index.delete(m.id);
  });
  index.forEach((m) => L.push('Disparu du nouveau jeu : ' + m.nom));
  return L;
}

// --- CLI ------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) {
  const chemin = process.argv[2] || 'modeles.json';
  try {
    const data = JSON.parse(readFileSync(chemin, 'utf8'));
    const { erreurs, avertissements } = valider(data, null);
    avertissements.forEach((x) => console.warn('AVERTISSEMENT : ' + x));
    if (erreurs.length) {
      erreurs.forEach((x) => console.error('ERREUR : ' + x));
      process.exit(1);
    }
    console.log('Validation OK — ' + data.modeles.length + ' modeles, ' +
      data.cas_usage.length + ' cas d usage, version ' + data.meta.version + '.');
  } catch (err) {
    console.error('Impossible de valider : ' + err.message);
    process.exit(1);
  }
}
