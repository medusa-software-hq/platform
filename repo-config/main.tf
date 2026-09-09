# Constants
locals {
  gh_organization_name = "medusa-software-hq"

  # GitHub Actions integration ID (magic value)
  gh_actions_integration_id = 15368
}

terraform {
  required_version = ">= 1.15"

  backend "gcs" {}

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.11"
    }
  }
}

#region Variables

variable "repo_name" {
  description = "Name of the repository being configured."
  type        = string
}

variable "required_checks" {
  description = "Status check contexts required before merging to the default branch."
  type        = list(string)
}

variable "gh_app_terraformer_app_pem" {
  description = "App Terraformer GitHub App PEM key contents."
  type        = string
  sensitive   = true
}

#endregion

provider "github" {
  owner = local.gh_organization_name

  app_auth {
    # https://github.com/organizations/medusa-software-hq/settings/apps/medusa-app-terraformer
    id = "4885090"
    # https://github.com/organizations/medusa-software-hq/settings/installations/160323124
    installation_id = "160323124"
    pem_file        = var.gh_app_terraformer_app_pem
  }
}
