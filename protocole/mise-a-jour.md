# Protocole de mise à jour des données

Données de suivi tarifaire des modèles LLM consommées par Routéo
(`products/routeo/` dans le repo `agent-factory-os`).

Le fichier de données est `modeles.json`, à la racine. Il est rapproché
quotidiennement des données machine d'OpenRouter par le workflow
`.github/workflows/data-sync.yml`, et peut être mis à jour manuellement
selon la procédure ci-dessous.

---

## Deux chemins, deux consignes

L'automatisation et la passe manuelle n'opèrent pas dans les mêmes
conditions, et leurs consignes sont donc distinctes :

| Chemin | Accès web | Consigne | Source de vérité |
| --- | --- | --- | --- |
| **Automation** (workflow quotidien) | Non — appel API brut | [`consigne.txt`](consigne.txt) : réconciliation avec l'extrait machine de l'API publique OpenRouter (`/api/v1/models`), fourni par `scripts/sync.mjs` | Tarifs et contextes OpenRouter |
| **Manuel** (passe de fond, hebdomadaire conseillée) | Oui — agent avec navigation | Prompt intégré au panneau « Mettre à jour les données » de l'application | Pages tarifaires des éditeurs + recoupement OpenRouter |

> Leçon du 2026-09-15 : un appel `chat/completions` n'a **aucun accès
> web**. La première version de l'automation demandait au modèle de
> « vérifier sur les pages des éditeurs » — il a correctement refusé
> plutôt que d'inventer. L'automation fournit désormais les données
> machine au modèle ; la vérification éditoriale (pages des éditeurs,
> nuances promo/palier/notes) reste une passe humaine périodique.

## Règles de mise à jour (issues de `meta.schema`)

- Ne jamais modifier un score (`scores`), `souverainete`, `poids_ouverts`,
  `europe`, `params_total`, `params_actifs`, `classe_materiel` ni
  `cas_usage[].melange_sortie` sans citer une source benchmark ou juridique
  datée dans le changelog. La validation automatisée refuse tout écart sur
  un champ verrouillé.
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
- Garde-fous de la validation : variation individuelle de prix ≥ ×5 ou
  ≤ ÷5 → avertissement en tête de résumé ; plus de 25 % des prix modifiés
  en un passage → avertissement (symptôme possible d'invention). Ces
  passages méritent une relecture avant d'être considérés comme fiables.

## Cadence

- **Rapprochement machine** : automatique, quotidien (cron 06h00 UTC).
  Déclenchement manuel : onglet **Actions** → **Mise a jour des donnees**
  → **Run workflow**.
- **Passe éditoriale** (pages des éditeurs, notes, statuts promo) :
  hebdomadaire conseillée, via le panneau de l'application.

## Échéances déjà connues (au 2026-09-15)

- 16/10/2026 : retrait de Gemini 2.5 Flash-Lite.
- 21/11/2026 : fin de la garantie de prix sur GPT-5.6 Sol (plancher de
  garantie, pas une expiration).
- 31/12/2026 : fin du tarif introductif de la famille Gemini Flash,
  doublement au 1er janvier.
