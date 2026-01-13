# Popcorn - AI Movie Recommender 

https://github.com/user-attachments/assets/978cf6f2-d854-4cf7-8d83-95857d8add4b


- Popcorn is a  movie recommendation system that turns natural-language queries (for example, “crazy funny”, “90s romantic comedies”, or “dark sci-fi with strong atmosphere”) into relevant movie suggestions.  
- The goal is to reduce decision fatigue by matching user intent semantically rather than relying on exact keywords.  
- The project focuses on semantic search, vector indexing, and cloud deployment using AWS infrastructure as code.

---

## Features

- Natural language semantic search  
  - Free-text queries are converted into embeddings and matched against a movie corpus using vector similarity.

- Vector-based recommendation engine  
  - Movie descriptions are embedded using OpenAI models and indexed with FAISS for fast nearest-neighbor search.
 
- Scalable cloud architecture  
  - Backend services are containerized and deployed on AWS using ECS Fargate and an Application Load Balancer.

- Local and cloud execution  
  - The same services can run locally for development or in production on AWS with minimal configuration changes.

---

## Repository Structure

- Project layout

.
├─ backend/
│  ├─ cognito-auth-api/     # Minimal auth and favorites API (Express)
│  └─ vector-service/       # FAISS vector service (Python)
├─ cdk/                     # AWS CDK v2 infrastructure
├─ tools/                   # Local semantic search tools and utilities
├─ Movie-data/              # Movie dataset, embeddings, and FAISS index
└─ scripts/                 # PowerShell scripts for local development

---

## Default Ports

- Auth API (local / mock)  
  - http://localhost:3001  

- Semantic search API  
  - http://localhost:3002  

- FAISS vector service  
  - http://localhost:8008  

---

## Requirements

- Runtime and tools  
  - Node.js 18 or newer  
  - Python 3.9+ (for vector service)  
  - npm  

- Optional for cloud deployment  
  - Docker Desktop  
  - AWS CLI (configured)  
  - AWS CDK v2  

---

## Manual Start (Local Backend)

- FAISS vector service

powershell -NoProfile -ExecutionPolicy Bypass  
-File .\scripts\run_vector_service_8008.ps1  

- Semantic search API

powershell -NoProfile -ExecutionPolicy Bypass  
-File .\scripts\run_semantic_search_api_3002.ps1  

- Auth backend (mock)

powershell -NoProfile -ExecutionPolicy Bypass  
-File .\backend\cognito-auth-api\scripts\run_mock_server.ps1  

---

## Environment Variables

- Common settings  

  - OPENAI_API_KEY  
    - OpenAI API key used for embedding generation in local mode.

  - LOCAL_DATA_PATH  
    - Path to the local movie dataset (defaults to `Movie-data/` if present).

- Cloud and security settings  

  - OpenAI key in AWS  
    - Loaded from AWS Secrets Manager during CDK deployment.

---

## API Reference

- Health check

GET /health  

- Semantic search

POST /search  
Content-Type: application/json  

- Request body

{
  "query": "romantic comedy from the 90s",
  "limit": 20
}

- Response  
  - A ranked list of movies based on semantic similarity scores.

---

## Dataset and Indexing

- Local data is stored under `Movie-data/`  

  - movies/movies.ndjson  
    - Movie metadata in NDJSON format.

  - vectors/  
    - Precomputed embeddings.

  - index/  
    - FAISS index files used by the vector service.

- Tooling is provided to rebuild embeddings, regenerate FAISS indexes, and benchmark search performance.

---

## Deployment (AWS)

- Cloud architecture  
  - Backend services are deployed on ECS Fargate behind an Application Load Balancer.  
  - Path-based routing forwards `/auth/*`, `/favorites/*`, and `/search*` to the appropriate services.  
  - Secrets (OpenAI API key) are stored in AWS Secrets Manager.

- Deployment steps  

cd cdk  
npm install  
npx cdk bootstrap  
npm run build  
npm run deploy  

- After deployment, CloudFormation outputs include the ALB DNS name and service endpoints.

---

## Troubleshooting

- Low-quality or unexpected search results  
  - This may occur if movie metadata is incomplete or embeddings were generated from sparse descriptions.

