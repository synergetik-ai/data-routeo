# data-routeo — données tarifaires LLM pour Routéo

Données de suivi tarifaire des modèles LLM consommées par l'application
**Routéo** (sources dans `agent-factory-os`, `products/routeo/`).

Ce repo contient uniquement les **données volatiles** : elles changent
régulièrement et ne constituent pas une connaissance à capitaliser dans
le repo principal (stratégie documentaire : ADR-005 « Stratégie
documentaire »). Le protocole de mise à jour, lui, est capitalisé ici.

## Structure

| Fichier | Rôle |
| --- | --- |
| `modeles.json` | Le jeu de données complet (écrasé à chaque vérification) |
| `protocole/consigne.txt` | Consigne LLM canonique, utilisée telle quelle par l'automation |
| `protocole/mise-a-jour.md` | Règles de mise à jour, cadence, échéances |
| `scripts/sync.mjs` | Automation : appel LLM → validation → écriture → résumé |
| `scripts/validate.mjs` | Validation de schéma (CLI ou import) |
| `.github/workflows/data-sync.yml` | Cron quotidien + déclenchement manuel |

## Consumption par l'application

L'application Routéo fetch le fichier en direct :

```
https://raw.githubusercontent.com/synergetik-ai/data-routeo/main/modeles.json
```

L'URL est déclarée dans `products/routeo/config.json` (repo principal) —
aucune URL n'est codée en dur dans le code de l'application. GitHub raw
sert le fichier avec les en-têtes CORS, donc aucun rebuild de l'application
n'est nécessaire quand les données changent.

## Mise en place (une seule fois)

1. Créer le repo `synergetik-ai/data-routeo` sur GitHub et pousser ce contenu.
2. **Secret** : `LLM_API_KEY` — clé API du fournisseur (OpenRouter ou
   équivalent). *Settings → Secrets and variables → Actions → Secrets.*
3. **Variables** : `LLM_MODEL` (ex. `openai/gpt-5.6-luna`) et
   `LLM_BASE_URL` (optionnel, défaut `https://openrouter.ai/api/v1`).
   *Settings → Secrets and variables → Actions → Variables.*
4. Vérifier que l'onglet **Actions** est actif sur le repo.
5. Lancer manuellement le workflow (**Actions → Mise a jour des donnees →
   Run workflow**) et contrôler le résumé du run (écarts constatés).

## Fonctionnement de l'automation

Quotidien à 06h00 UTC :

1. lecture de `modeles.json` + `protocole/consigne.txt` ;
2. appel LLM (température 0,1) avec le jeu de données courant ;
3. extraction du JSON de la réponse, puis validation stricte
   (`scripts/validate.mjs`) : structure, valeurs autorisées, prix
   numériques, champs verrouillés inchangés, aucun modèle supprimé,
   entrée de changelog présente et datée du jour ;
4. en cas d'échec : **aucune écriture**, le run échoue et affiche les
   erreurs dans son résumé ;
5. en cas de succès : `modeles.json` réécrit, écarts listés dans le
   résumé du run, commit + push si le fichier a changé.

Le résumé de chaque run est la piste d'audit : il liste les écarts
(modèle, champ, ancienne valeur, nouvelle valeur).

## Mise à jour manuelle (secours)

1. Ouvrir Routéo → panneau « Mettre à jour les données » → **Copier la
   consigne et les données**.
2. Coller dans une conversation avec un agent qui a accès au web. Il
   renvoie le JSON complet et la liste des écarts.
3. Contrôler les écarts, puis mettre à jour `modeles.json` via une PR
   (la validation s'exécute localement avec
   `node scripts/validate.mjs modeles.json <ancien-modeles.json>` ou se
   vérifie à la relecture).

## Variante PR (au lieu du push direct)

Par défaut, l'automation pousse directement sur `main` après validation.
Pour exiger une revue humaine, remplacer l'étape « Commit et push » du
workflow par l'action `peter-evans/create-pull-request` (branche
quotidienne + PR). Coût : un délai d'un jour avant publication.
