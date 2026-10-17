# Production Infrastructure as Code (Terraform / OpenTofu)

This directory contains modular Infrastructure-as-Code configurations for provisioning high-availability cloud infrastructure for the AI Customer Service platform.

---

## Directory Structure

```
deploy/
├── helm/
│   └── ai-customer-service/       # Kubernetes Helm Chart (API, Web, Ingress, HPA)
└── terraform/
    ├── aws/                        # AWS ECS Fargate, RDS PostgreSQL 16, ElastiCache Redis
    ├── gcp/                        # GCP Cloud Run v2, Cloud SQL PostgreSQL 16, Memorystore
    └── README.md
```

---

## 1. Kubernetes Deployment via Helm

```bash
# Add chart repository or package locally
helm package deploy/helm/ai-customer-service

# Deploy or upgrade release
helm upgrade --install ai-cs ./deploy/helm/ai-customer-service \
  --namespace customer-service \
  --create-namespace \
  --set ingress.hosts[0].host=contact-center.yourdomain.com \
  --set secrets.databaseUrl="postgresql://..." \
  --set secrets.jwtSecret="super_secret_jwt_key"
```

---

## 2. AWS Deployment (ECS + RDS + ElastiCache)

```bash
cd deploy/terraform/aws

# Initialize Terraform/OpenTofu
tofu init # or terraform init

# Preview changes
tofu plan -var="aws_region=us-east-1" -var="environment=production"

# Apply infrastructure
tofu apply
```

---

## 3. GCP Deployment (Cloud Run + Cloud SQL + Memorystore)

```bash
cd deploy/terraform/gcp

tofu init
tofu plan -var="project_id=your-gcp-project-id" -var="region=us-central1"
tofu apply
```
