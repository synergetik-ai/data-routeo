# Protocole de mise à jour des données

Données de suivi tarifaire des modèles LLM consommées par Routéo
(`products/routeo/` dans le repo `agent-factory-os`).

Le fichier de données est `modeles.json`, à la racine. Il est régénéré
quotidiennement par le workflow `.github/workflows/data-sync.yml` et peut
être mis à jour manuellement selon la procédure ci-dessous.

---

## La consigne LLM

La consigne envoyée au modèle de vérification est canonique dans
[`consigne.txt`](consigne.txt). Le script d'automation
(`scripts/sync.mjs`) l'utilise telle quelle, suffixée par le jeu de
données courant. Toute modification de la consigne se fait dans
`consigne.txt` uniquement.

## Règles de mise à jour (issues de `meta.schema`)

- Ne jamais modifier un score (`scores`), `souverainete`, `poids_ouverts`,
  `europe`, `params_total`, `params_actifs`, `classe_materiel` ni
  `cas_usage[].melange_sortie` sans citer une source benchmark ou juridique
  datée dans le changelog. La validation automatisée refuse tout écart sur
  un champ verrouillé.
- Vérifier chaque prix sur la page listée dans `meta.sources_editeurs`,
  puis recouper avec `openrouter.ai/models`.
- Un modèle retiré passe en statut `retire`, il n'est jamais supprimé de
  la liste. La validation refuse la disparition d'une entrée.
- Un tarif promotionnel prend le statut `promo`, sa date de fin va dans
  le champ `note`.
- Écrire toutes les valeurs du JSON sans accents ; l'affichage accentué
  est géré par l'interface de l'application.
- Ajouter une entrée dans `meta.changelog` à chaque passage, même si rien
  n'a changé : elle date la dernière vérification.
- Les champs de dimensionnement (`params_*`, `classe_materiel`,
  `empreinte`) ne se modifient que sur la foi du model card de l'éditeur
  ou d'un guide de déploiement daté.

## Cadence

Automatique, quotidienne (cron 06h00 UTC dans `data-sync.yml`).
Déclenchement manuel possible : onglet **Actions** → **Mise a jour des
donnees** → **Run workflow**.

## Échéances déjà connues (au 2026-09-15)

- 16/10/2026 : retrait de Gemini 2.5 Flash-Lite.
- 21/11/2026 : fin de la garantie de prix sur GPT-5.6 Sol (plancher de
  garantie, pas une expiration).
- 31/12/2026 : fin du tarif introductif de la famille Gemini Flash,
  doublement au 1er janvier.
