terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "production"
}

# -------------------------------------------------------------
# VPC & Networking
# -------------------------------------------------------------
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "ai-customer-service-${var.environment}-vpc"
  }
}

# -------------------------------------------------------------
# Aurora PostgreSQL Serverless v2 or RDS Instance
# -------------------------------------------------------------
resource "aws_db_instance" "postgres" {
  identifier          = "ai-customer-service-pg-${var.environment}"
  allocated_storage   = 50
  engine              = "postgres"
  engine_version      = "16.1"
  instance_class      = "db.t4g.medium"
  db_name             = "customer_service"
  username            = "cs_admin"
  manage_master_user_password = true
  multi_az            = true
  skip_final_snapshot = false
  final_snapshot_identifier = "ai-cs-pg-final-snapshot"

  tags = {
    Environment = var.environment
  }
}

# -------------------------------------------------------------
# ElastiCache Redis Cluster for Distributed Idempotency
# -------------------------------------------------------------
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "ai-cs-redis-${var.environment}"
  engine               = "redis"
  node_type            = "cache.t4g.small"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
}

# -------------------------------------------------------------
# ECS Cluster & Fargate Tasks
# -------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "ai-customer-service-${var.environment}"
}

output "database_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "RDS PostgreSQL Endpoint"
}

output "redis_endpoint" {
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
  description = "ElastiCache Redis Endpoint"
}
