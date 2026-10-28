# QR Suisse — agents

[Français](#français) · [English](#english)

## Français

QR Suisse est un générateur de QR codes dynamiques édité par Skyday Sàrl (Valais). Les QR codes,
leurs statistiques et les données des comptes sont hébergés en Suisse, chez Infomaniak (exceptions
détaillées dans la [politique de confidentialité](https://www.qrsuisse.ch/legal/confidentialite)).
Les plans Pro et Entreprise donnent accès à une API REST publique (v1).

Ce dépôt ne contient aucun code de l'application. Il fournit aux agents IA de quoi utiliser
l'API QR Suisse au nom d'un utilisateur :

- [`AGENTS.md`](AGENTS.md) : instructions pour les agents (droits, quotas, erreurs,
  `Idempotency-Key`, précautions), reprises de https://www.qrsuisse.ch/agents.md, qui fait foi
  (la spécification OpenAPI prévalant en cas de doute) ;
- [`plugin.json`](plugin.json) : manifeste au format [Agent Plugins 1.0.0](https://agent-plugins.org/specification) ;
- [`skills/qrsuisse-create-qr-code`](skills/qrsuisse-create-qr-code/SKILL.md) : compétence
  « créer un QR code via l'API » au format [Agent Skills](https://agentskills.io/specification).

Ce dépôt ne déclare aucun serveur MCP : QR Suisse ne propose pas de serveur MCP. Les agents
appellent directement l'API REST.
Une clé API se crée uniquement depuis le tableau de bord QR Suisse ; ne la versionnez jamais et ne
la collez jamais dans une conversation.

Liens : [documentation de l'API](https://www.qrsuisse.ch/documentation-api) ·
[OpenAPI (JSON)](https://www.qrsuisse.ch/openapi.json) ·
[OpenAPI (YAML)](https://www.qrsuisse.ch/openapi.yaml) ·
[auth.md](https://www.qrsuisse.ch/auth.md) ·
[agents.md](https://www.qrsuisse.ch/agents.md) ·
[llms.txt](https://www.qrsuisse.ch/llms.txt) ·
[conditions générales](https://www.qrsuisse.ch/legal/cgu) ·
[politique de confidentialité](https://www.qrsuisse.ch/legal/confidentialite)

## English

QR Suisse is a dynamic QR code generator published by Skyday Sàrl (Valais, Switzerland). QR codes,
their statistics and account data are hosted in Switzerland, at Infomaniak (exceptions detailed in
the [privacy policy](https://www.qrsuisse.ch/en/legal/privacy-policy)). The Pro and Entreprise plans
include a public REST API (v1).

This repository contains no application code. It gives AI agents what they need to use the
QR Suisse API on behalf of a user:

- [`AGENTS.md`](AGENTS.md): instructions for agents (rights, quotas, errors, `Idempotency-Key`,
  precautions), taken from https://www.qrsuisse.ch/agents.md, which prevails (the OpenAPI
  specification prevails in case of doubt);
- [`plugin.json`](plugin.json): manifest in the [Agent Plugins 1.0.0](https://agent-plugins.org/specification) format;
- [`skills/qrsuisse-create-qr-code`](skills/qrsuisse-create-qr-code/SKILL.md): "create a QR code
  through the API" skill in the [Agent Skills](https://agentskills.io/specification) format.

This repository declares no MCP server: QR Suisse does not offer an MCP server. Agents call the
REST API directly.
An API key can only be created from the QR Suisse dashboard; never commit it and never paste it
into a conversation.

Links: [API documentation](https://www.qrsuisse.ch/en/api-documentation) ·
[OpenAPI (JSON)](https://www.qrsuisse.ch/openapi.json) ·
[OpenAPI (YAML)](https://www.qrsuisse.ch/openapi.yaml) ·
[auth.md](https://www.qrsuisse.ch/auth.md) ·
[agents.md](https://www.qrsuisse.ch/agents.md) ·
[llms.txt](https://www.qrsuisse.ch/llms.txt) ·
[Terms and Conditions](https://www.qrsuisse.ch/en/legal/terms-of-use) ·
[Privacy Policy](https://www.qrsuisse.ch/en/legal/privacy-policy)

## Contributions

**Français.** Les contributions externes ne sont pas acceptées : le contenu de ce dépôt suit
https://www.qrsuisse.ch/agents.md. Pour une question, écrivez à contact@qrsuisse.ch ; pour une
vulnérabilité, voir [SECURITY.md](SECURITY.md). N'envoyez jamais de clé API, de donnée personnelle
ou de donnée de vos clients.

**English.** External contributions are not accepted: the content of this repository follows
https://www.qrsuisse.ch/agents.md. For a question, write to contact@qrsuisse.ch; to report a
vulnerability, see [SECURITY.md](SECURITY.md). Never send an API key, personal data or your
customers' data.

## Éditeur / Publisher

Skyday Sàrl, Rue de Lousse 32a, 1987 Hérémence, Suisse / Switzerland ·
IDE / UID : CHE-347.343.213 · contact@qrsuisse.ch ·
[Mentions légales](https://www.qrsuisse.ch/legal/mentions-legales) /
[Legal notice](https://www.qrsuisse.ch/en/legal/legal-notice)

Le seul dépôt officiel est `github.com/skyday-sarl/qrsuisse-agents`. /
The only official repository is `github.com/skyday-sarl/qrsuisse-agents`.

## Licence / License

**Français.** Le contenu de ce dépôt est publié sous [licence MIT](LICENSE). Cette licence porte
uniquement sur les fichiers de ce dépôt. Elle ne donne aucun droit d'utiliser le service QR Suisse,
qui nécessite un compte et est régi par ses [conditions générales](https://www.qrsuisse.ch/legal/cgu)
et sa [politique de confidentialité](https://www.qrsuisse.ch/legal/confidentialite), ni aucun droit
sur le nom ou le logo QR Suisse (voir ci-dessous).

**English.** The content of this repository is published under the [MIT License](LICENSE). This
license covers the files in this repository only. It grants no right to use the QR Suisse service,
which requires an account and is governed by its [Terms and Conditions](https://www.qrsuisse.ch/en/legal/terms-of-use)
and [Privacy Policy](https://www.qrsuisse.ch/en/legal/privacy-policy), and no right to the
QR Suisse name or logo (see below).

## Nom et logo / Name and logo

**Français.** « QR Suisse » et le logo QR Suisse sont des signes distinctifs de Skyday Sàrl. La
licence MIT ne s'applique pas à eux. Leur usage est régi par la page
[Marque](https://www.qrsuisse.ch/marque). Une copie modifiée de ce dépôt ne doit pas se présenter
comme publiée, approuvée ou maintenue par Skyday Sàrl ou par QR Suisse.

**English.** "QR Suisse" and the QR Suisse logo are distinctive signs of Skyday Sàrl. The MIT
License does not apply to them. Their use is governed by the [Brand](https://www.qrsuisse.ch/en/brand)
page. A modified copy of this repository must not present itself as published, endorsed or
maintained by Skyday Sàrl or QR Suisse.
