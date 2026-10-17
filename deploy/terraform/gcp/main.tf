terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP Project ID"
}

variable "region" {
  type    = string
  default = "us-central1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# -------------------------------------------------------------
# Cloud SQL PostgreSQL 16
# -------------------------------------------------------------
resource "google_sql_database_instance" "postgres" {
  name             = "ai-customer-service-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = "db-custom-2-7680"
    availability_type = "REGIONAL"
    disk_size         = 50
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled    = true
      start_time = "02:00"
    }
  }
}

resource "google_sql_database" "database" {
  name     = "customer_service"
  instance = google_sql_database_instance.postgres.name
}

# -------------------------------------------------------------
# Memorystore Redis Instance
# -------------------------------------------------------------
resource "google_redis_instance" "cache" {
  name           = "ai-cs-redis"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region
  redis_version  = "REDIS_7_0"
}

# -------------------------------------------------------------
# Cloud Run Services
# -------------------------------------------------------------
resource "google_cloud_run_v2_service" "api" {
  name     = "ai-customer-service-api"
  location = var.region

  template {
    containers {
      image = "ghcr.io/adamblansett/ai-customer-service-api:latest"
      ports {
        container_port = 3001
      }
      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }
    }
    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }
  }
}

output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Cloud Run API Service URL"
}
