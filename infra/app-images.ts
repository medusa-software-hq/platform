import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { centralProject, centralServices } from './central.ts';
import { APPS, type App } from './model.ts';
import { githubOrganization, organizationAdmins, primaryLocation } from './organization.ts';

/**
 * Where an app's images live, and what may push them.
 *
 * One registry per app, not per environment, so an image is built once and the same
 * digest is promoted from staging to production. Two registries would mean two builds
 * and no guarantee the thing tested is the thing released.
 *
 * This is the only cloud credential an app's GitHub Actions ever holds. Everything
 * else an app deploys goes through Pulumi Deployments, which federates on its own. The
 * credential is write-only, scoped to one registry: a compromised workflow can push a
 * bad image to that app and nothing more.
 */

const dependsOn = { dependsOn: centralServices };

/**
 * A separate pool from the one app stacks use. Different issuer, different trust —
 * and keeping them apart means a token minted for one can never satisfy the other.
 */
export const githubPool = new gcp.iam.WorkloadIdentityPool(
  'github-actions',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: 'github-actions',
    displayName: 'GitHub Actions',
    description: 'Identities issued by GitHub Actions for repositories in this organization.',
  },
  dependsOn,
);

export const githubPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  'github-actions',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: githubPool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: 'github-actions',
    displayName: 'GitHub Actions',

    attributeMapping: {
      'google.subject': 'assertion.sub',
      // Bound to per app below. Nothing maps the owner or the visibility: those would
      // be grantable principals covering every repository at once.
      'attribute.repository': 'assertion.repository',
    },

    attributeCondition: `assertion.repository_owner == '${githubOrganization}'`,

    oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
  },
  dependsOn,
);

export interface AppImages {
  registry: gcp.artifactregistry.Repository;
  pushServiceAccount: gcp.serviceaccount.Account;
}

const forApp = (app: App): AppImages => {
  const registry = new gcp.artifactregistry.Repository(
    app,
    {
      project: centralProject.projectId,
      location: primaryLocation,
      repositoryId: app,
      format: 'DOCKER',
      description: `Container images for ${app}.`,

      // A tag that exists cannot be moved. Without this, anything able to push could
      // replace the image a release is about to pull, under the tag it already trusts.
      dockerConfig: { immutableTags: true },
    },
    dependsOn,
  );

  const pushServiceAccount = new gcp.serviceaccount.Account(
    `${app}-push`,
    {
      project: centralProject.projectId,
      accountId: `${app}-push`,
      displayName: `${app} - push`,
      description: `Pushes ${app} images from GitHub Actions.`,
    },
    dependsOn,
  );

  new gcp.artifactregistry.RepositoryIamMember(`${app}-push-writer`, {
    project: centralProject.projectId,
    location: registry.location,
    repository: registry.name,
    role: 'roles/artifactregistry.writer',
    member: pushServiceAccount.member,
  });

  /**
   * Readable by whoever administers the organization.
   *
   * Central belongs to the account this stack deploys with, so nobody could look at
   * what the pipeline pushed — not the tags, not the digests, not whether an image
   * exists at all. The only way to find out was to read a workflow's log, which is
   * the wrong place to learn what is in a registry.
   *
   * Read and nothing else: what is in there is put there by the push identity, on a
   * merge, and a person reaching past that would be making the registry disagree with
   * the repository.
   */
  new gcp.artifactregistry.RepositoryIamMember(`${app}-registry-reader`, {
    project: centralProject.projectId,
    location: registry.location,
    repository: registry.name,
    role: 'roles/artifactregistry.reader',
    member: organizationAdmins,
  });

  // Impersonation, rather than granting the federated principal directly: pushing an
  // image needs an OAuth access token, and those are only issued for a service account.
  new gcp.serviceaccount.IAMMember(`${app}-push-workload-identity`, {
    serviceAccountId: pushServiceAccount.name,
    role: 'roles/iam.workloadIdentityUser',
    member: pulumi.interpolate`principalSet://iam.googleapis.com/${githubPool.name}/attribute.repository/${githubOrganization}/${app}`,
  });

  return { registry, pushServiceAccount };
};

export const appImages: Record<App, AppImages> = Object.fromEntries(
  APPS.map((app) => [app, forApp(app)]),
) as Record<App, AppImages>;
