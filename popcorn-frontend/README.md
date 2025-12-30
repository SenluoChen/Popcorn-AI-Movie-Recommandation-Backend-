# Popcorn – Natural Language Movie Recommender

## Présentation
Application React/TypeScript qui transforme une description en langage naturel (ex : "Je recherche des comédies romantiques des années 90.") en recommandations de films, puis affiche les plateformes disponibles (watch providers) selon la région.

## Fonctionnalités
- Recommandation par langage naturel (règles/keywords) → TMDb search/discover
- Liste de résultats avec affiches
- Page détail film avec plateformes disponibles (stream / rent / buy)

## Setup
1) Installer

```bash
npm install
```

2) Configurer `.env`

```dotenv
REACT_APP_TMDB_API_KEY=YOUR_TMDB_V3_KEY
```

3) Lancer

```bash
npm start
```

## Notes
Les plateformes dépendent du pays/région (déduit via `navigator.language`, fallback `US`).
